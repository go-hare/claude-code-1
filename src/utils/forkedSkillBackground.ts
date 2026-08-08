/**
 * densable 2.1.218: `context: fork` skills default to background agents that
 * report via task-notification. Shared by processSlashCommand (user `/skill`)
 * and SkillTool (model invoke) so both share the same Cvo/wvo/gsd shape.
 *
 * densable symbols:
 * - Cvo(e,t) → shouldBackgroundForkedSkill — `e.background ?? true`, false when
 *   non-interactive, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, or caller forces sync
 * - gsd → formatForkedSkillLaunchMarker — `<forked-skill-launch>{json}</…>`
 * - wvo → launchBackgroundForkedSkill — registerAsyncAgent + runAsyncAgentLifecycle
 */
import {
  getIsNonInteractiveSession,
  getMainThreadAgentId,
  getSdkAgentProgressSummariesEnabled,
} from '../bootstrap/state.js'
import { getCommandName } from '../commands.js'
import { FORKED_SKILL_LAUNCH_TAG } from '../constants/xml.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { AppState } from '../state/AppState.js'
import {
  isLocalAgentTask,
  registerAsyncAgent,
  resolvePanelOwnerAgentId,
} from '../tasks/LocalAgentTask/LocalAgentTask.js'
import { isTerminalTaskStatus } from '../Task.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { isBuiltInAgent } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { runAsyncAgentLifecycle } from '@claude-code/builtin-tools/tools/AgentTool/agentToolUtils.js'
import { runAgent } from '@claude-code/builtin-tools/tools/AgentTool/runAgent.js'
import type { ToolUseContext } from '../Tool.js'
import type { CommandBase, PromptCommand } from '../types/command.js'
import type { AgentId } from '../types/ids.js'
import { asAgentId } from '../types/ids.js'
import type { Message } from '../types/message.js'
import {
  getAgentContext,
  runWithAgentContext,
  type SubagentContext,
} from './agentContext.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import type { ModelAlias } from './model/aliases.js'
import { getParentSessionId } from './teammate.js'
import { escapeXml } from './xml.js'

const FORKED_SKILL_LAUNCH_DESCRIPTION_MAX = 4096

export type ForkedSkillLaunchMarker = {
  agentId: string
  skillName: string
  description: string
}

/**
 * densable Cvo(e, t):
 * - forceSync (t) → false
 * - non-interactive or CLAUDE_CODE_DISABLE_BACKGROUND_TASKS → false
 * - else `command.background ?? true` (fork skills default true)
 */
export function shouldBackgroundForkedSkill(
  command: CommandBase & PromptCommand,
  forceSync = false,
): boolean {
  if (forceSync) return false
  if (getIsNonInteractiveSession()) return false
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS)) {
    return false
  }
  // densable: e.background ?? !0  — undefined means default true for fork path
  return command.background !== false
}

/** densable gsd — truncate description then wrap JSON in forked-skill-launch. */
export function formatForkedSkillLaunchMarker(
  payload: ForkedSkillLaunchMarker,
): string {
  const description =
    payload.description.length > FORKED_SKILL_LAUNCH_DESCRIPTION_MAX
      ? payload.description.slice(0, FORKED_SKILL_LAUNCH_DESCRIPTION_MAX)
      : payload.description
  const body = JSON.stringify({
    agentId: payload.agentId,
    skillName: payload.skillName,
    description,
  })
  return `<${FORKED_SKILL_LAUNCH_TAG}>${escapeXml(body)}</${FORKED_SKILL_LAUNCH_TAG}>`
}

function truncateDescription(description: string, max = 50): string {
  if (description.length <= max) return description
  return `${description.slice(0, max - 1)}…`
}

function allocateDisplayName(
  baseName: string,
  registry: Map<string, AgentId>,
): string {
  // densable refuses reserved "main"
  const seed = baseName === 'main' || baseName.length === 0 ? 'skill' : baseName
  if (!registry.has(seed)) return seed
  let i = 2
  while (registry.has(`${seed}-${i}`)) i++
  return `${seed}-${i}`
}

export type LaunchBackgroundForkedSkillParams = {
  agentId: string
  agentDefinition: AgentDefinition
  command: CommandBase & PromptCommand
  description: string
  prompt: string
  promptMessages: Message[]
  context: ToolUseContext
  canUseTool: CanUseToolFn
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
}

export type LaunchBackgroundForkedSkillResult = {
  agentId: string
  name: string
}

/**
 * densable wvo — spawn a background local_agent for a forked skill.
 * Returns null on live-duplicate (same forkedSkillName still running).
 */
export async function launchBackgroundForkedSkill({
  agentId,
  agentDefinition,
  command,
  description,
  prompt,
  promptMessages,
  context,
  canUseTool,
  getAppState,
  setAppState,
}: LaunchBackgroundForkedSkillParams): Promise<LaunchBackgroundForkedSkillResult | null> {
  const startTime = Date.now()
  const shortDescription = truncateDescription(description)
  const appState = getAppState()

  // densable: live-duplicate of same forked skill → null (caller falls through
  // to sync path / records invocation).
  for (const task of Object.values(appState.tasks ?? {})) {
    if (
      isLocalAgentTask(task) &&
      !isTerminalTaskStatus(task.status) &&
      task.forkedSkillName === command.name
    ) {
      logForDebugging(
        `Forked skill /${command.name} already live as agent ${task.agentId}; skipping background launch`,
      )
      return null
    }
  }

  if (context.abortController.signal.aborted) {
    throw context.abortController.signal.reason instanceof Error
      ? context.abortController.signal.reason
      : new Error('Aborted')
  }

  const parentAgentId = context.agentId
  const ownerId =
    resolvePanelOwnerAgentId(parentAgentId, getAppState) ??
    getMainThreadAgentId()

  const displayName = allocateDisplayName(
    getCommandName(command),
    appState.agentNameRegistry ?? new Map(),
  )

  const resolvedModel =
    (typeof agentDefinition.model === 'string' && agentDefinition.model) ||
    command.model ||
    undefined

  const agentBackgroundTask = registerAsyncAgent({
    agentId,
    description: shortDescription,
    prompt,
    selectedAgent: agentDefinition,
    setAppState,
    // Background forked skills survive main-thread ESC (same as AgentTool async).
    toolUseId: context.toolUseId,
    ownerAgentId: ownerId,
    notificationTargetAgentId: asAgentId(ownerId),
    parentAgentId,
    forkedSkillName: command.name,
    model: resolvedModel,
  })

  // Register name → agentId for SendMessage routing
  if (displayName !== 'main') {
    setAppState(prev => {
      const next = new Map(prev.agentNameRegistry)
      next.set(displayName, asAgentId(agentId))
      return { ...prev, agentNameRegistry: next }
    })
  }

  const parentCtx = getAgentContext()
  const parentDepth =
    parentCtx && typeof parentCtx.depth === 'number' ? parentCtx.depth : 0
  const childDepth = parentDepth + 1

  const asyncAgentContext: SubagentContext = {
    agentId,
    parentSessionId: getParentSessionId(),
    agentType: 'subagent',
    subagentName: agentDefinition.agentType,
    isBuiltIn: isBuiltInAgent(agentDefinition),
    invocationKind: 'spawn',
    invocationEmitted: false,
    isBackgroundAgent: true,
    depth: childDepth,
  }

  const metadata = {
    prompt,
    resolvedAgentModel: resolvedModel ?? agentDefinition.agentType ?? 'unknown',
    isBuiltInAgent: isBuiltInAgent(agentDefinition),
    startTime,
    agentType: agentDefinition.agentType,
    isAsync: true as const,
  }

  void runWithAgentContext(asyncAgentContext, () =>
    runAsyncAgentLifecycle({
      taskId: agentBackgroundTask.agentId,
      abortController: agentBackgroundTask.abortController!,
      makeStream: onCacheSafeParams =>
        runAgent({
          agentDefinition,
          promptMessages,
          toolUseContext: {
            ...context,
            getAppState,
          },
          canUseTool,
          isAsync: true,
          querySource: 'agent:custom',
          model: command.model as ModelAlias | undefined,
          availableTools: context.options.tools,
          override: {
            agentId: asAgentId(agentBackgroundTask.agentId),
            abortController: agentBackgroundTask.abortController!,
          },
          onCacheSafeParams,
          description: shortDescription,
          name: displayName,
        }),
      metadata,
      description: shortDescription,
      toolUseContext: context,
      rootSetAppState: setAppState,
      agentIdForCleanup: agentId,
      enableSummarization: getSdkAgentProgressSummariesEnabled(),
      getWorktreeResult: async () => ({}),
    }),
  )

  logForDebugging(
    `Background forked skill /${command.name} launched as @${displayName} (agent ${agentId})`,
  )

  return { agentId, name: displayName }
}
