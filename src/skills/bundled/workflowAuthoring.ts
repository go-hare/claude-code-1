import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { SKILL_TOOL_NAME } from '@claude-code/builtin-tools/tools/SkillTool/constants.js'
import {
  addInvokedSkill,
  getInvokedSkillsForAgent,
} from '../../bootstrap/state.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { logEvent } from '../../services/analytics/index.js'
import { toolMatchesName } from '../../Tool.js'
import { logForDebugging } from '../../utils/debug.js'
import { createUserMessage, getContentText } from '../../utils/messages.js'
import { isBundledSkillsDisabled } from '../../utils/residualFinalEnvGates.js'
import { isWorkflowFeatureEnabled } from '../../utils/workflowDisableGate.js'
import { registerBundledSkill } from '../bundledSkills.js'
import {
  WORKFLOW_AUTHORING_MENU_DESCRIPTION,
  WORKFLOW_AUTHORING_PROMPT,
  WORKFLOW_AUTHORING_SKILL_DESCRIPTION,
  WORKFLOW_AUTHORING_SKILL_NAME,
} from './workflowAuthoringContent.js'

/** Official $w */
export const WORKFLOW_AUTHORING_SKILL = WORKFLOW_AUTHORING_SKILL_NAME

/** Official gTt */
export function getWorkflowAuthoringPromptBlocks(): ContentBlockParam[] {
  return [{ type: 'text', text: WORKFLOW_AUTHORING_PROMPT }]
}

/**
 * Official e() / eJ — skill can autoload / slim the Workflow tool prompt.
 * xu() && !gme() (gme is `return !1` in 248) plus bundled-skill / override /
 * local-agent / Skill-tool gates from the eJ module.
 */
export function isWorkflowAuthoringSkillAvailable(
  tools?: ReadonlyArray<{ name: string; aliases?: string[] }>,
): boolean {
  if (!isWorkflowFeatureEnabled()) return false
  try {
    const { getInitialSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/settings/settings.js') as typeof import('../../utils/settings/settings.js')
    const settings = getInitialSettings()
    if (
      isBundledSkillsDisabled({
        settingsDisableBundledSkills: settings.disableBundledSkills,
      })
    ) {
      return false
    }
    const override = settings.skillOverrides?.[WORKFLOW_AUTHORING_SKILL_NAME]
    if (override === 'off' || override === 'user-invocable-only') {
      return false
    }
  } catch {
    if (isBundledSkillsDisabled()) return false
  }
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent') return false
  if (tools !== undefined) {
    return tools.some(t => toolMatchesName(t, SKILL_TOOL_NAME))
  }
  return true
}

type AutoloadMessage = {
  type?: string
  uuid?: string
  message?: { content?: string | ContentBlockParam[] }
  attachment?: {
    type?: string
    reminderType?: string
    skills?: Array<{ content?: string }>
  }
}

function isNewAttachment(
  message: AutoloadMessage,
  history: readonly AutoloadMessage[] | undefined,
  match: (attachment: NonNullable<AutoloadMessage['attachment']>) => boolean,
): boolean {
  return (
    message.type === 'attachment' &&
    message.attachment !== undefined &&
    match(message.attachment) &&
    !history?.some(h => h.uuid === message.uuid)
  )
}

/** Official IWe — skill body already in transcript (user text or invoked_skills). */
function findExistingAuthoringContent(
  history: readonly AutoloadMessage[] | undefined,
  content: string,
): 'body' | 'attachment' | null {
  if (!history) return null
  let foundAttachment = false
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (!msg) continue
    if (msg.type === 'attachment') {
      const skills = msg.attachment?.skills
      if (
        !foundAttachment &&
        msg.attachment?.type === 'invoked_skills' &&
        skills?.some(s => s.content === content)
      ) {
        foundAttachment = true
      }
      continue
    }
    const body =
      typeof msg.message?.content === 'string'
        ? msg.message.content
        : getContentText(msg.message?.content ?? [])
    if (body === content) return 'body'
  }
  return foundAttachment ? 'attachment' : null
}

/**
 * Official T / getWorkflowAuthoringAutoloadMessages.
 * Trigger: new workflow_keyword_request, or ultra_effort_enter reminderType=full.
 */
export async function getWorkflowAuthoringAutoloadMessages(
  turnMessages: readonly AutoloadMessage[],
  history: readonly AutoloadMessage[] | undefined,
  tools?: ReadonlyArray<{ name: string; aliases?: string[] }>,
): Promise<ReturnType<typeof createUserMessage>[]> {
  const trigger = turnMessages.some(e =>
    isNewAttachment(e, history, a => a.type === 'workflow_keyword_request'),
  )
    ? 'keyword'
    : turnMessages.some(e =>
          isNewAttachment(
            e,
            history,
            a => a.type === 'ultra_effort_enter' && a.reminderType === 'full',
          ),
        )
      ? 'ultracode'
      : undefined
  if (trigger === undefined || !isWorkflowAuthoringSkillAvailable(tools)) {
    return []
  }
  const blocks = getWorkflowAuthoringPromptBlocks()
  const content = blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n\n')
  const invokedKey = `:${WORKFLOW_AUTHORING_SKILL_NAME}`
  const already = findExistingAuthoringContent(history ?? [], content)
  if (already !== null) {
    if (getInvokedSkillsForAgent(null).get(invokedKey)?.content !== content) {
      addInvokedSkill(
        WORKFLOW_AUTHORING_SKILL_NAME,
        `bundled:${WORKFLOW_AUTHORING_SKILL_NAME}`,
        content,
        null,
      )
    }
    return []
  }
  addInvokedSkill(
    WORKFLOW_AUTHORING_SKILL_NAME,
    `bundled:${WORKFLOW_AUTHORING_SKILL_NAME}`,
    content,
    null,
  )
  logEvent('tengu_workflow_authoring_skill_autoload', {
    trigger:
      trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  logForDebugging('workflow_authoring_autoload')
  const { formatSkillLoadingMetadata } = await import(
    '../../utils/processUserInput/processSlashCommand.js'
  )
  return [
    createUserMessage({
      content: formatSkillLoadingMetadata(WORKFLOW_AUTHORING_SKILL_NAME),
      isMeta: true,
      turnCompanion: true,
    }),
    createUserMessage({
      content: blocks,
      isMeta: true,
      turnCompanion: true,
    }),
  ]
}

/** Official Fmr — register workflow-authoring. isEnabled: xu() && !gme(). */
export function registerWorkflowAuthoringSkill(): void {
  registerBundledSkill({
    name: WORKFLOW_AUTHORING_SKILL_NAME,
    description: WORKFLOW_AUTHORING_SKILL_DESCRIPTION,
    menuDescription: WORKFLOW_AUTHORING_MENU_DESCRIPTION,
    userInvocable: true,
    isEnabled: () => isWorkflowFeatureEnabled(),
    async getPromptForCommand() {
      return getWorkflowAuthoringPromptBlocks()
    },
  })
}
