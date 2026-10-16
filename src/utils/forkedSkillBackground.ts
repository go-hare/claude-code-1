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
import { overlayForkedCommandAppState } from './forkedAgent.js'
import { parseToolListFromCLI } from './permissions/permissionSetup.js'
import { resolveTrustedSkillAllowedTools } from './permissions/skillAllowedToolsTrust.js'
import { isSyncSkillsEnabled } from './residualFinalEnvGates.js'
import { isForkCapableSkill } from './skills/skillExecutionContext.js'
import type { AgentId } from '../types/ids.js'
import { asAgentId } from '../types/ids.js'
import type { Message } from '../types/message.js'
import type { FileStateCache } from './fileStateCache.js'
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

/**
 * densable Ywo tail — resolve a fork-capable skill and its permission overlay
 * (ije allowed tools / frozenCommandDenies / Jbn). Disk scoping/provenance
 * (W3e/fIt/Kwo) lives in `forkedSkillScoping.ts`; resumeAgent reads it first.
 *
 * Never export minify `Ywo` / `Z7` / `ije` / `Jbn`.
 */
export class ForkedSkillResumeRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ForkedSkillResumeRefusedError'
  }
}

export type ForkedSkillResumeOverlay = {
  allowedTools: string[]
  disallowedTools: string[]
  frozenCommandDenies: string[]
  wrapToolUseContext: (context: ToolUseContext) => ToolUseContext
}

export async function assertForkedSkillResumeAllowed(input: {
  agentId: string
  forkedSkillName?: string
  cwd?: string
  getAppState?: () => AppState
  /** densable `_.frozenCommandDenies` from disk scoping when status==="valid". */
  frozenCommandDenies?: string[]
}): Promise<ForkedSkillResumeOverlay | undefined> {
  // No live or sidecar witness → not a forked-skill agent (skip).
  // Cold resume must pass sidecar forkedSkillName; omitting it is the skip.
  if (input.forkedSkillName === undefined) return undefined
  const skillName = input.forkedSkillName
  const { getCwd } = await import('./cwd.js')
  const { getSkillToolCommands } = await import('../commands.js')
  const cwd = input.cwd ?? getCwd()
  const listed = await getSkillToolCommands(cwd)
  const mcpPromptCommands =
    input
      .getAppState?.()
      .mcp.commands.filter(
        cmd => cmd.type === 'prompt' && cmd.loadedFrom === 'mcp',
      ) ?? []
  const skill = [...listed, ...mcpPromptCommands].find(
    cmd => cmd.name === skillName && cmd.type === 'prompt',
  ) as (CommandBase & PromptCommand) | undefined
  // Gold: a?.type!=="prompt"||a.context!=="fork"&&a.getContext===void 0
  if (skill?.type !== 'prompt' || !isForkCapableSkill(skill)) {
    throw new ForkedSkillResumeRefusedError(
      'forked_skill_resume_skill_unresolved',
      `Agent ${input.agentId} ran as forked skill ${skillName}, which no longer resolves to a fork-capable skill; refusing to resume it without its permission scoping.`,
    )
  }
  // Gold Z7() — skills sync currently off / denied by policy.
  if (skill.loadedFrom === 'syncedSkills' && !isSyncSkillsEnabled()) {
    throw new ForkedSkillResumeRefusedError(
      'forked_skill_resume_sync_vetoed',
      `Agent ${input.agentId} ran as forked skill ${skillName}, an account-synced skill that is currently disabled (skills sync turned off or denied by policy); refusing to resume it.`,
    )
  }
  let allowedTools: string[]
  try {
    // Gold ije — getAllowedTools ?? allowedTools; untrusted source → [].
    allowedTools = parseToolListFromCLI(
      await resolveTrustedSkillAllowedTools(skill),
    )
  } catch (err) {
    throw new ForkedSkillResumeRefusedError(
      'forked_skill_resume_allowed_tools_failed',
      err instanceof Error ? err.message : String(err),
    )
  }
  const disallowedTools = parseToolListFromCLI(skill.disallowedTools ?? [])
  // Gold yt=_?.frozenCommandDenies??session.alwaysDenyRules.command??[]
  const frozenCommandDenies =
    input.frozenCommandDenies ??
    input.getAppState?.().toolPermissionContext.alwaysDenyRules.command ??
    []
  const layers = [
    ...(allowedTools.length === 0
      ? []
      : [{ kind: 'allowed_tools' as const, allowedTools }]),
    ...(disallowedTools.length === 0
      ? []
      : [{ kind: 'disallowed_tools' as const, disallowedTools }]),
  ]
  return {
    allowedTools,
    disallowedTools,
    frozenCommandDenies,
    wrapToolUseContext(context) {
      // Gold Jbn(..., {replaceCommandRules:!0, frozenCommandDenies:yt})
      return {
        ...context,
        getAppState: overlayForkedCommandAppState(
          context.getAppState,
          allowedTools,
          disallowedTools,
          {
            replaceCommandRules: true,
            frozenCommandDenies,
          },
        ),
        permissionLayers:
          layers.length > 0
            ? [...(context.permissionLayers ?? []), ...layers]
            : context.permissionLayers,
      }
    },
  }
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
  availableTools?: ToolUseContext['options']['tools']
  webFetchReadmissionAllowed?: boolean
  /** Official Lto `forkReadFileState` (`g`) → R2i `readFileState`. */
  readFileState?: FileStateCache
  /** Official R2i `recordInvocationOnSuccess` → zqe `onTerminalSuccess`. */
  recordInvocationOnSuccess?: () => void
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
  availableTools,
  webFetchReadmissionAllowed,
  readFileState,
  recordInvocationOnSuccess,
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

  // densable Kwo — write scoping + provenance marker next to transcript
  // before register; write failure → null (forked_skill_scoping_write_failed).
  try {
    const { writeForkedSkillScoping } = await import('./forkedSkillScoping.js')
    await writeForkedSkillScoping(agentId, {
      skillName: command.name,
      attributionName: command.name,
      ...(agentDefinition.effort !== undefined
        ? { effort: agentDefinition.effort as string | number }
        : {}),
    })
  } catch (err) {
    logForDebugging(
      `Failed to write forked-skill scoping sidecar: ${err instanceof Error ? err.message : String(err)}`,
      { level: 'warn' },
    )
    return null
  }

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
            permissionLayers: context.permissionLayers,
          },
          canUseTool,
          isAsync: true,
          querySource: 'agent:custom',
          model: command.model as ModelAlias | undefined,
          availableTools: availableTools ?? context.options.tools,
          webFetchReadmissionAllowed,
          override: {
            agentId: asAgentId(agentBackgroundTask.agentId),
            abortController: agentBackgroundTask.abortController!,
            ...(readFileState !== undefined && { readFileState }),
          },
          onCacheSafeParams,
          description: shortDescription,
          name: displayName,
          forkedSkillName: command.name,
        }),
      metadata,
      description: shortDescription,
      toolUseContext: context,
      rootSetAppState: setAppState,
      agentIdForCleanup: agentId,
      enableSummarization: getSdkAgentProgressSummariesEnabled(),
      getWorktreeResult: async () => ({}),
      onTerminalSuccess: recordInvocationOnSuccess,
    }),
  )

  logForDebugging(
    `Background forked skill /${command.name} launched as @${displayName} (agent ${agentId})`,
  )

  return { agentId, name: displayName }
}
