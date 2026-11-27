import { promises as fsp } from 'fs'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import {
  getMainThreadAgentId,
  getSdkAgentProgressSummariesEnabled,
} from 'src/bootstrap/state.js'
import { getSystemPrompt } from 'src/constants/prompts.js'
import { isCoordinatorMode } from 'src/coordinator/coordinatorMode.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import type { ToolUseContext } from 'src/Tool.js'
import type { InternalPermissionMode } from 'src/types/permissions.js'
import {
  enqueueMainAgentTakeoverNotice,
  registerAsyncAgent,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import { assembleToolPool } from 'src/tools.js'
import { filterParentToolsForFork } from 'src/utils/agentToolFilter.js'
import { asAgentId, toAgentId } from 'src/types/ids.js'
import { MAIN_RECIPIENT_NAME } from 'src/utils/swarm/constants.js'
import { runWithAgentContext } from 'src/utils/agentContext.js'
import {
  hasMatchingFunctionHook,
  isInsideAgentSpawnLaunch,
  runFunctionHookChain,
} from 'src/utils/plugins/functionHooksModules.js'
import { getCwd, runWithCwdOverride } from 'src/utils/cwd.js'
import {
  isHardIsolationPinRefuse,
  liveLaunchDirs,
  probeIsolationWorktreePin,
  processLaunchCwd,
  uniqueLiveRoots,
} from 'src/utils/isolationWorktreePin.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  DisklessRefusalError,
  isDisklessActive,
} from 'src/utils/disklessGuards.js'
import {
  isDisklessForSession,
  type RemoteNativeToolSession,
} from 'src/utils/toolCreateRuntime.js'
import { extractTextContent } from 'src/utils/messages.js'
import { truncateCodeUnitsSafe } from 'src/utils/stringUtils.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  createUserMessage,
  filterOrphanedThinkingOnlyMessages,
  filterUnresolvedToolUses,
  filterWhitespaceOnlyAssistantMessages,
  isMetaVisibleOrigin,
  rewriteResumedSubagentShutdownToolResults,
  wrapResumePromptOrigin,
} from 'src/utils/messages.js'
import { getAgentModel } from 'src/utils/model/agent.js'
import { waitForInitialPluginsLoaded } from 'src/utils/plugins/pluginLoader.js'
import { getQuerySourceForAgent } from 'src/utils/promptCategory.js'
import { getBootstrapSession, RootSessionSlot } from 'src/utils/sessionHost.js'
import {
  getAgentTranscript,
  readAgentMetadata,
  writeAgentMetadata,
} from 'src/utils/sessionStorage.js'
import { createAgentId } from 'src/utils/uuid.js'
import { buildEffectiveSystemPrompt } from 'src/utils/systemPrompt.js'
import type { SystemPrompt } from 'src/utils/systemPromptType.js'
import { getTaskOutputPath } from 'src/utils/task/diskOutput.js'
import { getParentSessionId } from 'src/utils/teammate.js'
import { reconstructForSubagentResume } from 'src/utils/toolResultStorage.js'
import {
  applyObserverExactToolPool,
  resolveAgentTools,
  runAsyncAgentLifecycle,
} from './agentToolUtils.js'
import { resolveAgentDefinitionModel } from './built-in/exploreAgent.js'
import { GENERAL_PURPOSE_AGENT } from './built-in/generalPurposeAgent.js'
import { isBuiltInWebFetchAgent } from './built-in/webFetchAgent.js'
import {
  getBackgroundLaunchRule,
  isBackgroundAgentLaunchBlocked,
} from 'src/utils/sessionBackgroundGates.js'
import {
  assertForkedSkillResumeAllowed,
  ForkedSkillResumeRefusedError,
} from 'src/utils/forkedSkillBackground.js'
import {
  readForkedSkillProvenanceSkillName,
  readForkedSkillScoping,
} from 'src/utils/forkedSkillScoping.js'
import { webFetchSavedFilesForAgent } from 'src/utils/subagentSpawnLedger.js'
import { FORK_AGENT, isForkSubagentProductEnabled } from './forkSubagent.js'
import type { AgentDefinition } from './loadAgentsDir.js'
import { isBuiltInAgent } from './loadAgentsDir.js'
import { runAgent } from './runAgent.js'
import { isAgentStoppedByPerson } from 'src/utils/sessionHost.js'
import { SubagentHandbackTool } from '../SubagentHandbackTool/SubagentHandbackTool.js'

export type ResumeAgentResult = {
  agentId: string
  description: string
  outputFile: string
  /**
   * When continueInterruptedTurn and the sidechain already ends on an
   * assistant turn, skip re-run and only report completion (orphan path).
   */
  alreadyCompleted?: boolean
  /**
   * densable Y8a/X8a `finalText` — only set when awaitCompletion awaited the
   * lifecycle. Present (possibly empty string) → SendMessage D5f "Resumed…Result".
   * Absent → D5f "Resuming…".
   */
  finalText?: string
}

/**
 * densable `D5f(e,t)` — short SendMessage resume surface for completed bg agents.
 *
 * - `resultText === undefined` → `Resuming agent ${display}`
 * - otherwise → `Resumed agent ${display}. Result:\n${text||"(no text output)"}`
 * - agent-id shaped names are truncated to 7 code units (`hi(e,7)` / `truncateCodeUnitsSafe`)
 */
export function formatResumedAgentMessage(
  agentName: string,
  resultText?: string,
): string {
  const hasResult = resultText !== undefined
  const display = toAgentId(agentName)
    ? truncateCodeUnitsSafe(agentName, 7)
    : agentName
  if (hasResult) {
    return `Resumed agent ${display}. Result:\n${resultText || '(no text output)'}`
  }
  return `Resuming agent ${display}`
}
/** Concurrent resume / already running / setup failures. */
export class ResumeAgentStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResumeAgentStateError'
  }
}

/**
 * User-stopped agents refuse auto-resume. Outer catch swallows this class
 * (covers CAS races and stopped-by-user; no stranded-resume warning).
 */
export class AgentStoppedByUserError extends ResumeAgentStateError {
  constructor(message: string) {
    super(message)
    this.name = 'AgentStoppedByUserError'
  }
}

/** densable U6 — retryable setup (worktree unverifiable, sidecar read). */
export class AgentResumeTransientError extends ResumeAgentStateError {
  constructor(message: string) {
    super(message)
    this.name = 'AgentResumeTransientError'
  }
}

/** densable jAe — session rule / permanently refused. */
export class AgentResumePermanentlyRefusedError extends ResumeAgentStateError {
  constructor(message: string) {
    super(message)
    this.name = 'AgentResumePermanentlyRefusedError'
  }
}

/** densable O5 — already running / being resumed. */
export class AgentResumeInProgressError extends ResumeAgentStateError {
  constructor(message: string) {
    super(message)
    this.name = 'AgentResumeInProgressError'
  }
}

/**
 * densable Fle — still stopping.
 *
 * Gold zt throws this at two resume-entry sites (wired via agentStopBag):
 * 1. resumer `toolUseContext.agentId` is stop-pending
 * 2. target is stop-pending, OR kill loop still live while status terminal
 */
export class AgentStillStoppingError extends ResumeAgentStateError {
  constructor(message: string) {
    super(message)
    this.name = 'AgentStillStoppingError'
  }
}

const resumesInFlightBySession = new RootSessionSlot<Set<string>>(
  () => new Set<string>(),
)

export function clearResumesInFlightForTests(): void {
  resumesInFlightBySession.peek(getBootstrapSession())?.clear()
}

/**
 * Resume prompt origin — object form (kind + extras). When set, resume
 * prompt is mid-turn-wrapped and stamped origin + isMeta:true.
 */
export type ResumePromptOrigin = {
  kind: string
  [key: string]: unknown
}

/**
 * densable `eyl` — permission-mode permissiveness ranks (higher = wider).
 * Used by `resolveWorkerPermissionMode` (MJe).
 */
export const PERMISSION_MODE_RANK: Readonly<Record<string, number>> = {
  plan: 0,
  bubble: 1,
  default: 1,
  dontAsk: 1,
  acceptEdits: 2,
  auto: 3,
  bypassPermissions: 4,
}

/**
 * densable MJe(e, t): cap worker/arming permission mode to the current session.
 *
 * - missing arming → undefined
 * - session `auto` + arming `acceptEdits` → undefined (special case)
 * - arming rank ≤ session rank → arming; else undefined
 *
 * Callers typically do `resolveWorkerPermissionMode(...) ?? sessionMode`
 * (observer deliver / spawnFirstRun: `MJe(d,y) ?? y`).
 */
export function resolveWorkerPermissionMode(
  armingMode: string | undefined,
  sessionMode: InternalPermissionMode | undefined,
): InternalPermissionMode | undefined {
  if (!armingMode) return undefined
  if (sessionMode === 'auto' && armingMode === 'acceptEdits') return undefined
  const armRank = PERMISSION_MODE_RANK[armingMode]
  const sessionRank =
    sessionMode !== undefined ? PERMISSION_MODE_RANK[sessionMode] : undefined
  // densable: eyl[e]<=eyl[t] — missing keys → undefined comparison → reject
  if (armRank === undefined || sessionRank === undefined) return undefined
  if (armRank <= sessionRank) {
    return armingMode as InternalPermissionMode
  }
  return undefined
}

export type ResumePromptContent = string | ContentBlockParam[]

function resumePromptToPlainText(prompt: ResumePromptContent): string {
  if (typeof prompt === 'string') return prompt
  return prompt
    .filter(
      (b): b is Extract<ContentBlockParam, { type: 'text' }> =>
        b.type === 'text',
    )
    .map(b => b.text)
    .join('\n')
}

function wrapResumePromptContent(
  prompt: ResumePromptContent,
  origin: ResumePromptOrigin | undefined,
): ResumePromptContent {
  if (typeof prompt === 'string') {
    return wrapResumePromptOrigin(prompt, origin)
  }
  const textPart = resumePromptToPlainText(prompt)
  const nonTextBlocks = prompt.filter(b => b.type !== 'text')
  return [
    { type: 'text', text: wrapResumePromptOrigin(textPart, origin) },
    ...nonTextBlocks,
  ]
}

/**
 * Official 2.1.327 (#424 / #510) — detect when a finished subagent is resumed
 * by a sibling subagent (caller is a subagent and is not the target's parent).
 */
export function isSiblingSubagentResume(
  callerAgentId: string | undefined,
  targetParentAgentId: string | undefined,
  isObserver: boolean,
): boolean {
  return (
    callerAgentId !== undefined &&
    callerAgentId !== targetParentAgentId &&
    !isObserver
  )
}

const SIBLING_STRIPPED_LAYER_KINDS = new Set([
  'effort',
  'model',
  'allowed_tools',
  'permission_mode',
  'permission_mode_cap',
])

/**
 * Official `ze` + `T0o` (2.1.327 #424 / #510): when a sibling subagent resumes
 * a finished subagent via SendMessage, strip the sibling's model/effort layers
 * (`#424`) and reset permission layers/mode back to the session's permission
 * settings (`#510`) so the resumed subagent does not inherit the sibling's
 * model, effort, or permission grants.
 */
export function buildSiblingResumeToolUseContext(
  toolUseContext: ToolUseContext,
  sessionMainLoopModel: string,
  sessionPermissionMode?: InternalPermissionMode,
): ToolUseContext {
  const filteredLayers = toolUseContext.permissionLayers?.filter(
    layer => !SIBLING_STRIPPED_LAYER_KINDS.has(layer.kind),
  )
  const nextLayers: NonNullable<ToolUseContext['permissionLayers']> = [
    ...(filteredLayers ?? []),
    { kind: 'model', mainLoopModel: sessionMainLoopModel },
  ]
  const baseGetAppState = toolUseContext.getAppState
  const wrappedGetAppState: ToolUseContext['getAppState'] =
    sessionPermissionMode !== undefined
      ? () => {
          const state = baseGetAppState()
          if (state.toolPermissionContext.mode === sessionPermissionMode) {
            return state
          }
          return {
            ...state,
            toolPermissionContext: {
              ...state.toolPermissionContext,
              mode: sessionPermissionMode,
            },
          }
        }
      : baseGetAppState
  return {
    ...toolUseContext,
    getAppState: wrappedGetAppState,
    permissionLayers: nextLayers,
    options: {
      ...toolUseContext.options,
      mainLoopModel: sessionMainLoopModel,
    },
  }
}

export async function resumeAgentBackground({
  agentId,
  prompt,
  toolUseContext,
  canUseTool,
  invokingRequestId,
  continueInterruptedTurn,
  promptIsMeta,
  userInitiated,
  promptOrigin,
  promptOriginKind,
  suppressOwnerNotification,
  awaitCompletion,
  workerPermissionMode,
  resumeSurface,
  callerAgentId,
  sessionMainLoopModel,
  sessionPermissionMode,
}: {
  agentId: string
  prompt: ResumePromptContent
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  invokingRequestId?: string
  /**
   * Orphan auto-resume / send-message resume. When true and the filtered
   * transcript is already complete (ends on assistant), return
   * alreadyCompleted without spawning. Also skips re-appending the resume
   * prompt to promptMessages.
   */
  continueInterruptedTurn?: boolean
  /**
   * When no promptOrigin, stamp isMeta on the resume user message. With
   * promptOrigin, always uses isMeta:true.
   */
  promptIsMeta?: boolean
  /**
   * When true, allow resume even if sidecar has stoppedByUser and clear the
   * disk marker. Auto-resume paths omit this and throw AgentStoppedByUserError.
   */
  userInitiated?: boolean
  /**
   * Full origin object for mid-turn wrap + message.origin.
   */
  promptOrigin?: ResumePromptOrigin
  /**
   * Convenience / back-compat when only kind is known. Prefer `promptOrigin`
   * when available.
   */
  promptOriginKind?: string
  /**
   * After re-register, mark notified so the owner is not notified for
   * observer-activity digests.
   */
  suppressOwnerNotification?: boolean
  /**
   * Await the lifecycle run. When true, finally marks notified + grace.
   */
  awaitCompletion?: boolean
  /**
   * densable Aye workerPermissionMode (armingPermissionMode for observer deliver).
   * Capped to current session mode via resolveWorkerPermissionMode (MJe).
   */
  workerPermissionMode?: string
  /**
   * densable Me surface: notification (H5 default) / inline (Svr) / reply (k$n).
   * Aut() resume-in-background refuse applies unless inline/reply.
   */
  resumeSurface?: 'notification' | 'inline' | 'reply'
  /** Official 2.1.327 (#424 / #510): explicit caller agent ID when resumed by a sibling subagent. */
  callerAgentId?: string
  /** Official 2.1.327 (#424): session mainLoopModel used instead of a sibling's model layer. */
  sessionMainLoopModel?: string
  /** Official 2.1.327 (#510): session permission mode used instead of a sibling's mode layer. */
  sessionPermissionMode?: InternalPermissionMode
}): Promise<ResumeAgentResult> {
  if (
    isDisklessActive() ||
    isDisklessForSession(
      toolUseContext.session as RemoteNativeToolSession | undefined,
    )
  ) {
    throw new DisklessRefusalError(
      'teammate resume refused in a session with no disk',
    )
  }
  const startTime = Date.now()
  const appState = toolUseContext.getAppState()
  // In-process teammates get a no-op setAppState; setAppStateForTasks
  // reaches the root store so task registration/progress/kill stay visible.
  const rootSetAppState =
    toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState
  const sessionMode = appState.toolPermissionContext?.mode

  // densable Fle — before CAS. Import bag lazily to keep resumeAgent
  // free of hard cycles with task framework.
  const {
    isAgentStopPending,
    isAgentKillLoopSettled,
    isTerminalAgentTaskStatus,
  } = await import('src/utils/agentStopBag.js')
  const resumerId = toolUseContext.agentId
  if (resumerId !== undefined && isAgentStopPending(resumerId)) {
    throw new AgentStillStoppingError(
      'This agent has been stopped and its stop is still completing; it cannot resume other agents.',
    )
  }
  const targetStatus = appState.tasks?.[agentId]?.status
  if (
    isAgentStopPending(agentId) ||
    (!isAgentKillLoopSettled(agentId) &&
      isTerminalAgentTaskStatus(targetStatus))
  ) {
    throw new AgentStillStoppingError(
      `Agent ${agentId} is still stopping — its previous run was stopped but has not exited. Re-run TaskStop on it or wait for it to exit before resuming.`,
    )
  }

  // CAS at entry (before disk reads): claim resuming; else throw already
  // running/being resumed. clearResuming on setup failure paths.
  const { tryClaimAgentResume, clearAgentResuming } = await import(
    'src/tasks/LocalAgentTask/LocalAgentTask.js'
  )
  const resumesInFlight = resumesInFlightBySession.of(getBootstrapSession())
  if (resumesInFlight.has(agentId)) {
    throw new AgentResumeInProgressError(
      `Agent ${agentId} is already running or being resumed`,
    )
  }
  resumesInFlight.add(agentId)
  if (
    !tryClaimAgentResume(agentId, rootSetAppState, () =>
      toolUseContext.getAppState(),
    )
  ) {
    resumesInFlight.delete(agentId)
    throw new AgentResumeInProgressError(
      `Agent ${agentId} is already running or being resumed`,
    )
  }
  const clearResuming = (): void => {
    clearAgentResuming(agentId, rootSetAppState)
  }

  // Safety net: any throw between claim and register must clear resuming so
  // a mid-setup failure cannot stick the CAS (double-clear is idempotent).
  const resolvedOrigin: ResumePromptOrigin | undefined =
    promptOrigin ??
    (promptOriginKind !== undefined ? { kind: promptOriginKind } : undefined)
  try {
    return await resumeAgentBackgroundAfterClaim({
      agentId,
      prompt,
      toolUseContext,
      canUseTool,
      invokingRequestId,
      continueInterruptedTurn,
      promptIsMeta,
      userInitiated,
      promptOrigin: resolvedOrigin,
      suppressOwnerNotification,
      awaitCompletion,
      workerPermissionMode,
      resumeSurface,
      callerAgentId,
      sessionMainLoopModel,
      sessionPermissionMode,
      startTime,
      appState,
      rootSetAppState,
      sessionMode,
      clearResuming,
    })
  } catch (err) {
    clearResuming()
    throw err
  } finally {
    resumesInFlight.delete(agentId)
  }
}

/** Setup + spawn body after resume CAS claim. */
async function resumeAgentBackgroundAfterClaim({
  agentId,
  prompt,
  toolUseContext,
  canUseTool,
  invokingRequestId,
  continueInterruptedTurn,
  promptIsMeta,
  userInitiated,
  promptOrigin,
  suppressOwnerNotification,
  awaitCompletion,
  workerPermissionMode,
  resumeSurface,
  callerAgentId,
  sessionMainLoopModel,
  sessionPermissionMode,
  startTime,
  appState,
  rootSetAppState,
  sessionMode,
  clearResuming,
}: {
  agentId: string
  prompt: ResumePromptContent
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  invokingRequestId?: string
  continueInterruptedTurn?: boolean
  promptIsMeta?: boolean
  userInitiated?: boolean
  promptOrigin?: ResumePromptOrigin
  suppressOwnerNotification?: boolean
  awaitCompletion?: boolean
  workerPermissionMode?: string
  resumeSurface?: 'notification' | 'inline' | 'reply'
  callerAgentId?: string
  sessionMainLoopModel?: string
  sessionPermissionMode?: InternalPermissionMode
  startTime: number
  appState: ReturnType<ToolUseContext['getAppState']>
  rootSetAppState: NonNullable<
    ToolUseContext['setAppStateForTasks'] | ToolUseContext['setAppState']
  >
  sessionMode: ReturnType<
    ToolUseContext['getAppState']
  >['toolPermissionContext']['mode']
  clearResuming: () => void
}): Promise<ResumeAgentResult> {
  const promptOriginKind = promptOrigin?.kind
  let transcript: Awaited<ReturnType<typeof getAgentTranscript>>
  let meta: Awaited<ReturnType<typeof readAgentMetadata>>
  try {
    ;[transcript, meta] = await Promise.all([
      getAgentTranscript(asAgentId(agentId)),
      readAgentMetadata(asAgentId(agentId)),
    ])
  } catch (err) {
    clearResuming()
    throw err instanceof ResumeAgentStateError
      ? err
      : new AgentResumeTransientError(
          err instanceof Error ? err.message : String(err),
        )
  }
  // densable Aye / #985 / Official 2.1.331 `Jo` (@324587300): disk missing or
  // partial → merge/fallback to in-memory `AppState.transcripts[agentId]`
  // (or legacy `task.messages`) mirrored during the run.
  const appStateForMirror = toolUseContext.getAppState()
  const transcriptMirror = appStateForMirror.transcripts?.[agentId]?.messages
  const task = appStateForMirror.tasks?.[agentId]
  const legacyTaskMessages =
    task &&
    typeof task === 'object' &&
    'messages' in task &&
    Array.isArray(task.messages) &&
    task.messages.length > 0
      ? (task.messages as NonNullable<typeof transcript>['messages'])
      : undefined
  const mirrored =
    transcriptMirror && transcriptMirror.length > 0
      ? (transcriptMirror as NonNullable<typeof transcript>['messages'])
      : legacyTaskMessages
  if (!transcript && mirrored) {
    logForDebugging(
      `[resumeAgentBackground ${agentId}] disk transcript missing; using ${mirrored.length} in-memory messages mirrored during the run`,
    )
    transcript = {
      messages: mirrored,
      contentReplacements: [],
    }
  } else if (
    transcript &&
    mirrored &&
    mirrored.length > transcript.messages.length
  ) {
    const diskUuids = new Set(transcript.messages.map(m => m.uuid))
    const missing = mirrored.filter(m => !diskUuids.has(m.uuid))
    if (missing.length > 0) {
      logForDebugging(
        `[resumeAgentBackground ${agentId}] disk transcript partial (${transcript.messages.length}); appending ${missing.length} in-memory messages`,
      )
      transcript = {
        ...transcript,
        messages: [...transcript.messages, ...missing],
      }
    } else if (mirrored.length > transcript.messages.length) {
      transcript = {
        ...transcript,
        messages: mirrored,
      }
    }
  }
  if (!transcript) {
    // densable me(e,t) → logEvent('tengu_feature_bad', {feature_name:Se(e), error_code:t})
    logEvent('tengu_feature_bad', {
      feature_name:
        'subagent_launch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'subagent_resume_transcript_missing' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    clearResuming()
    throw new ResumeAgentStateError(
      `No transcript found for agent ID: ${agentId}`,
    )
  }

  // stoppedByUser (except observer-activity): refuse unless userInitiated,
  // else clear disk marker and proceed. Official #1913 consults stoppedByPerson.
  if (
    isAgentStoppedByPerson(agentId, meta?.stoppedByUser) &&
    promptOriginKind !== 'observer-activity'
  ) {
    if (!userInitiated) {
      clearResuming()
      throw new AgentStoppedByUserError(
        `Agent ${agentId} was stopped by the user and won't be resumed. Treat its work as cancelled; only launch a new agent if the user explicitly asks.`,
      )
    }
    try {
      const { clearAgentStoppedByUser } = await import(
        'src/tasks/LocalAgentTask/LocalAgentTask.js'
      )
      await clearAgentStoppedByUser(agentId)
    } catch (err) {
      logForDebugging(
        `failed to clear stop marker for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // continueInterruptedTurn: strip incomplete trailing turns; if filtered
  // transcript already complete → alreadyCompleted (no re-run).
  let rawForResume = transcript.messages as Array<{
    type?: string
    message?: { content?: unknown; stop_reason?: string | null }
    [key: string]: unknown
  }>
  if (continueInterruptedTurn) {
    const { stripInterruptedTrailingTurns } = await import(
      'src/utils/orphanAgentResume.js'
    )
    rawForResume = stripInterruptedTrailingTurns(rawForResume)
  } else {
    rawForResume = rewriteResumedSubagentShutdownToolResults(
      rawForResume as never,
    ) as typeof rawForResume
  }
  const resumedMessages = filterWhitespaceOnlyAssistantMessages(
    filterOrphanedThinkingOnlyMessages(
      filterUnresolvedToolUses(rawForResume as never),
    ),
  )
  if (continueInterruptedTurn && resumedMessages.length > 0) {
    const { isAgentTranscriptIncomplete } = await import(
      'src/utils/orphanAgentResume.js'
    )
    if (!isAgentTranscriptIncomplete(resumedMessages as never)) {
      // alreadyCompleted: mark notified + grace, return without re-run.
      // Always clearResuming() after — setAppState best-effort must not stick CAS.
      try {
        const { PANEL_GRACE_MS } = await import('src/utils/task/framework.js')
        rootSetAppState(prev => {
          const tasks = prev.tasks
          const task = tasks?.[agentId]
          if (!task || !tasks) return prev
          const retain =
            'retain' in task
              ? Boolean((task as { retain?: boolean }).retain)
              : false
          const nextTask = {
            ...task,
            resuming: false,
            adoptResumePending: false,
            notified: true as const,
            evictAfter: retain
              ? (task as { evictAfter?: number }).evictAfter
              : Date.now() + PANEL_GRACE_MS,
          }
          return {
            ...prev,
            tasks: {
              ...tasks,
              [agentId]: nextTask as typeof task,
            },
          }
        })
      } catch {
        /* best-effort — task may not be registered on orphan cold resume */
      }
      // densable Ce("subagent_launch") → tengu_feature_ok
      logEvent('tengu_feature_ok', {
        feature_name:
          'subagent_launch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      clearResuming()
      return {
        agentId,
        description: meta?.description ?? '(resumed)',
        outputFile: getTaskOutputPath(agentId),
        alreadyCompleted: true,
      }
    }
  }
  const resumedReplacementState = reconstructForSubagentResume(
    toolUseContext.contentReplacementState,
    resumedMessages,
    transcript.contentReplacements,
  )
  // Best-effort: if the original worktree was removed externally, fall back
  // to parent cwd rather than crashing on chdir later.
  const resumedWorktreePath = meta?.worktreePath
    ? await fsp.stat(meta.worktreePath).then(
        s => (s.isDirectory() ? meta.worktreePath : undefined),
        () => {
          logForDebugging(
            `Resumed worktree ${meta.worktreePath} no longer exists; falling back to parent cwd`,
          )
          return undefined
        },
      )
    : undefined
  if (resumedWorktreePath) {
    // densable 2.1.238 ODt parked-agent resume (both self-owning flags)
    const launchCwd = getCwd()
    const launchReal = await fsp.realpath(launchCwd).catch(() => launchCwd)
    const processCwd = processLaunchCwd()
    const pin = await probeIsolationWorktreePin(
      resumedWorktreePath,
      liveLaunchDirs(launchCwd),
      uniqueLiveRoots([launchReal, processCwd, ...liveLaunchDirs(processCwd)]),
      {
        requireWitnessForSelfOwningPins: true,
        declineSelfOwningPinUnderLiveRoot: true,
      },
    )
    if (!pin.ok) {
      if (isHardIsolationPinRefuse(pin.reason)) {
        logEvent('git_worktree_create_root_rejected', {})
        logForDebugging(
          `[worktree] refusing to resume parked agent into ${resumedWorktreePath} (${pin.reason}): ${pin.message}`,
          { level: 'error' },
        )
        throw new Error(
          `This agent cannot be resumed: its worktree was refused (${pin.reason}). ${pin.message}`,
        )
      }
      logForDebugging(
        `[worktree] could not verify parked agent worktree ${resumedWorktreePath} this attempt; the resume will retry: ${pin.message}`,
      )
      throw new Error(
        `Cannot resume this agent right now: its worktree could not be verified (${pin.reason}). Re-run once git can answer.`,
      )
    }
    // Bump mtime so stale-worktree cleanup doesn't delete a just-resumed worktree (#22355)
    const now = new Date()
    await fsp.utimes(resumedWorktreePath, now, now)
  }

  // densable Aye agent identity restore (changelog #7):
  //   j = isFork===true ? void 0 : agentType lookup in activeAgents
  //   B = isFork===true || (!j && isFork===void 0 && agentType===fork)
  //   G = j ?? (B ? FORK_AGENT : GENERAL_PURPOSE)
  // Explicit isFork short-circuits lookup so custom agents named "fork"
  // cannot steal the fork pool; missing isFork + agentType "fork" still
  // treats as fork (legacy sidecars before isFork field).
  const foundByType =
    meta?.isFork === true
      ? undefined
      : meta?.agentType
        ? toolUseContext.options.agentDefinitions.activeAgents.find(
            a => a.agentType === meta.agentType,
          )
        : undefined
  const isResumedFork =
    meta?.isFork === true ||
    (!foundByType &&
      meta?.isFork === undefined &&
      meta?.agentType === FORK_AGENT.agentType)
  const selectedAgent: AgentDefinition =
    foundByType ?? (isResumedFork ? FORK_AGENT : GENERAL_PURPOSE_AGENT)

  const uiDescription = meta?.description ?? '(resumed)'

  // densable z = ae==="inline" || ae==="reply" && (gZ()||Mv)
  const surface = resumeSurface ?? 'notification'
  const inlineOrReply =
    surface === 'inline' ||
    (surface === 'reply' &&
      (isBuiltInWebFetchAgent(selectedAgent) ||
        isBackgroundAgentLaunchBlocked()))
  if (!inlineOrReply && getBackgroundLaunchRule() !== undefined) {
    logEvent('tengu_feature_bad', {
      feature_name:
        'subagent_launch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'subagent_resume_background_rule' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    clearResuming()
    throw new AgentResumePermanentlyRefusedError(
      'This agent cannot be resumed in the background in this session. Start a new agent instead.',
    )
  }

  const liveTask = toolUseContext.getAppState().tasks?.[agentId]
  const liveForkedSkillName =
    liveTask &&
    typeof liveTask === 'object' &&
    'forkedSkillName' in liveTask &&
    typeof (liveTask as { forkedSkillName?: string }).forkedSkillName ===
      'string'
      ? (liveTask as { forkedSkillName: string }).forkedSkillName
      : undefined
  // densable Ywo cold witness — sidecar forkedSkillName when the live task
  // is gone (process restart / adopt). Do not skip just because live is empty.
  const forkedSkillName = liveForkedSkillName ?? meta?.forkedSkillName

  // densable Ywo: F()&&storageV5&&keys → x; else disk fIt.
  const scopingRead = await readForkedSkillScoping(
    agentId,
    toolUseContext.storageV5,
  )
  const scopingRefuseError =
    'transientRead' in scopingRead && scopingRead.transientRead
      ? AgentResumeTransientError
      : AgentResumePermanentlyRefusedError
  const refuseScoping = (code: string, message: string): never => {
    logEvent('tengu_feature_bad', {
      feature_name:
        'subagent_launch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    clearResuming()
    throw new scopingRefuseError(message)
  }
  if (scopingRead.status === 'malformed') {
    refuseScoping(
      'forked_skill_resume_scoping_invalid',
      `Agent ${agentId} has a malformed forked-skill scoping record; refusing to resume it without the skill's permission scoping.`,
    )
  }
  if (
    (scopingRead.status === 'absent' ||
      scopingRead.status === 'absent-but-marked') &&
    liveForkedSkillName !== undefined
  ) {
    refuseScoping(
      'forked_skill_resume_scoping_missing',
      `Agent ${agentId} ran as a forked skill but its scoping record is missing; refusing to resume it without the skill's permission scoping.`,
    )
  }
  if (scopingRead.status === 'absent-but-marked') {
    refuseScoping(
      'forked_skill_resume_scoping_missing_cold',
      `Agent ${agentId} carries a forked-skill provenance marker but its scoping record is missing; refusing to resume it without the skill's permission scoping.`,
    )
  }
  if (scopingRead.status === 'valid' && liveForkedSkillName !== undefined) {
    if (liveForkedSkillName !== scopingRead.scoping.skillName) {
      logEvent('tengu_feature_bad', {
        feature_name:
          'subagent_launch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'forked_skill_resume_scoping_mismatch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      clearResuming()
      throw new AgentResumePermanentlyRefusedError(
        `Agent ${agentId} has a forked-skill scoping record that does not match its task record; refusing to resume it.`,
      )
    }
  } else if (scopingRead.status === 'valid') {
    const markerSkill = await readForkedSkillProvenanceSkillName(
      agentId,
      toolUseContext.storageV5,
    )
    if (markerSkill !== scopingRead.scoping.skillName) {
      logEvent('tengu_feature_bad', {
        feature_name:
          'subagent_launch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'forked_skill_resume_cold_witness_mismatch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      clearResuming()
      throw new AgentResumePermanentlyRefusedError(
        `Agent ${agentId} has a forked-skill scoping record with no matching provenance-marker witness; refusing to resume it on a cold path without a corroborated fork identity.`,
      )
    }
  }
  const diskForkedSkillName =
    scopingRead.status === 'valid' ? scopingRead.scoping.skillName : undefined
  const resolvedForkedSkillName = forkedSkillName ?? diskForkedSkillName

  let forkedSkillResumeOverlay:
    | Awaited<ReturnType<typeof assertForkedSkillResumeAllowed>>
    | undefined
  try {
    forkedSkillResumeOverlay = await assertForkedSkillResumeAllowed({
      agentId,
      forkedSkillName: resolvedForkedSkillName,
      getAppState: toolUseContext.getAppState,
      frozenCommandDenies:
        scopingRead.status === 'valid'
          ? scopingRead.scoping.frozenCommandDenies
          : undefined,
    })
  } catch (err) {
    clearResuming()
    if (err instanceof ForkedSkillResumeRefusedError) {
      logEvent('tengu_feature_bad', {
        feature_name:
          'subagent_launch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          err.code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      throw new AgentResumePermanentlyRefusedError(err.message)
    }
    throw err
  }
  // Gold Jbn wrap of getAppState + permissionLayers after Ywo overlay.
  if (forkedSkillResumeOverlay) {
    toolUseContext = forkedSkillResumeOverlay.wrapToolUseContext(toolUseContext)
  }

  let forkParentSystemPrompt: SystemPrompt | undefined
  if (isResumedFork) {
    if (toolUseContext.renderedSystemPrompt) {
      forkParentSystemPrompt = toolUseContext.renderedSystemPrompt
    } else {
      const mainThreadAgentDefinition = appState.agent
        ? appState.agentDefinitions.activeAgents.find(
            a => a.agentType === appState.agent,
          )
        : undefined
      const additionalWorkingDirectories = Array.from(
        appState.toolPermissionContext.additionalWorkingDirectories.keys(),
      )
      const defaultSystemPrompt = await getSystemPrompt(
        toolUseContext.options.tools,
        toolUseContext.options.mainLoopModel,
        additionalWorkingDirectories,
        toolUseContext.options.mcpClients,
      )
      forkParentSystemPrompt = buildEffectiveSystemPrompt({
        mainThreadAgentDefinition,
        toolUseContext,
        customSystemPrompt: toolUseContext.options.customSystemPrompt,
        defaultSystemPrompt,
        appendSystemPrompt: toolUseContext.options.appendSystemPrompt,
      })
    }
    if (!forkParentSystemPrompt) {
      // densable me("subagent_launch","subagent_resume_fork_prompt_missing")
      logEvent('tengu_feature_bad', {
        feature_name:
          'subagent_launch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'subagent_resume_fork_prompt_missing' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      clearResuming()
      throw new ResumeAgentStateError(
        'Cannot resume fork agent: unable to reconstruct parent system prompt',
      )
    }
  }

  // observer-activity requires sidecar isObserver confirmation
  if (promptOriginKind === 'observer-activity' && meta?.isObserver !== true) {
    clearResuming()
    throw new ResumeAgentStateError(
      `Observer sidecar for ${agentId} missing or did not confirm isObserver; refusing delivery`,
    )
  }

  // densable Aye + 2.1.327 (#424 / #510 / #522 / #524):
  //   y = session mode
  //   J = isObserver ? MJe(workerPermissionMode, y) ?? y : void 0
  //   mode = J ?? workerPermissionMode ?? spawnMode ?? agent.permissionMode ?? "acceptEdits"
  // MJe only applies when sidecar isObserver (observer deliver path).
  const isObserverSidecar = meta?.isObserver === true
  const liveTaskForSibling = toolUseContext.getAppState().tasks?.[agentId] as
    | { parentAgentId?: string }
    | undefined
  const targetParentAgentId =
    typeof liveTaskForSibling?.parentAgentId === 'string'
      ? liveTaskForSibling.parentAgentId
      : meta?.parentAgentId
  const effectiveCallerAgentId = callerAgentId ?? toolUseContext.agentId
  const effectiveSessionPermissionMode = (sessionPermissionMode ??
    sessionMode) as InternalPermissionMode
  const siblingResume = isSiblingSubagentResume(
    effectiveCallerAgentId,
    targetParentAgentId,
    isObserverSidecar,
  )
  if (siblingResume) {
    const rootModel =
      sessionMainLoopModel ??
      appState.mainLoopModelForSession ??
      appState.mainLoopModel ??
      toolUseContext.options.mainLoopModel
    toolUseContext = buildSiblingResumeToolUseContext(
      toolUseContext,
      rootModel,
      effectiveSessionPermissionMode,
    )
  }

  // Official 2.1.327 (#524): restarted background subagents wait for initial
  // plugins to finish loading before assembling their tool pool or running.
  if (!isResumedFork) {
    await waitForInitialPluginsLoaded(toolUseContext.abortController.signal)
  }

  const observerCappedMode = isObserverSidecar
    ? (resolveWorkerPermissionMode(workerPermissionMode, sessionMode) ??
      sessionMode)
    : undefined
  const metaSpawnMode =
    typeof meta?.spawnMode === 'string'
      ? (meta.spawnMode as InternalPermissionMode)
      : undefined
  // Official 2.1.327 (#510): when resumed by a sibling's message, drop the
  // sibling's workerPermissionMode so the target agent's own metaSpawnMode and
  // selectedAgent.permissionMode take precedence before falling back to the
  // session's permission mode.
  const effectiveWorkerPermissionMode = siblingResume
    ? undefined
    : (workerPermissionMode as InternalPermissionMode | undefined)
  const resolvedWorkerMode: InternalPermissionMode =
    observerCappedMode ??
    effectiveWorkerPermissionMode ??
    metaSpawnMode ??
    (selectedAgent.permissionMode as InternalPermissionMode | undefined) ??
    (siblingResume ? effectiveSessionPermissionMode : 'acceptEdits')

  // Resolve model for analytics metadata (runAgent resolves its own internally).
  // Official 2.1.327 (#522): keep the full model ID or alias saved in sidecar
  // metadata when resuming non-fork/non-observer subagents (even after /model);
  // forks inherit parent model.
  const resumeModelSpec = isObserverSidecar
    ? undefined
    : isResumedFork
      ? 'inherit'
      : typeof meta?.model === 'string' && meta.model.length > 0
        ? meta.model
        : undefined
  const resolvedAgentModel = getAgentModel(
    resolveAgentDefinitionModel(
      selectedAgent,
      toolUseContext.options.mainLoopModel,
    ),
    toolUseContext.options.mainLoopModel,
    resumeModelSpec,
    sessionMode,
  )

  const workerPermissionContext = {
    ...appState.toolPermissionContext,
    mode: resolvedWorkerMode,
  }

  const promptText = resumePromptToPlainText(prompt)

  // #683 (SEA `Sdo` / `bdo`): dispatch `agent.spawn` with `resume: { agentId }`
  // so mod hooks can observe or refuse a resumed agent's run (rewrites ignored).
  if (hasMatchingFunctionHook('agent.spawn') && !isInsideAgentSpawnLaunch()) {
    const spawn = {
      subagentType: selectedAgent.agentType,
      prompt: promptText,
      description: uiDescription,
      model: resumeModelSpec ?? resolvedAgentModel,
      permissionMode: resolvedWorkerMode,
      background: true,
      fork: isResumedFork,
      resume: Object.freeze({ agentId }),
      name: selectedAgent.agentType,
      cwd: resumedWorktreePath ?? getCwd(),
    }
    const answered = await runFunctionHookChain(
      'agent.spawn',
      spawn,
      async event => event,
      undefined,
      undefined,
      {
        signal: toolUseContext.abortController.signal,
      },
    )
    const rec =
      answered && typeof answered === 'object'
        ? (answered as Record<string, unknown>)
        : undefined
    const deny =
      rec && typeof rec.deny === 'string'
        ? rec.deny
        : answered === undefined ||
            (rec && 'deny' in rec && rec.deny !== undefined)
          ? 'agent.spawn: a hook answered without passing the spawn on'
          : undefined
    if (deny !== undefined) {
      logForDebugging(
        `agent.spawn ${selectedAgent.agentType} (resume): refused by a hook (${deny})`,
      )
      throw new AgentResumePermanentlyRefusedError(
        `a plugin declined the resume: ${deny}`,
      )
    }
  }
  // densable Aye:
  //   G = parent tools.filter(IH)  (MCP subset; local uses full assemble)
  //   ae = fork? parent tools : pz(X, l1e(mcp+G))
  //   se = isObserver ? Lco(WJ(j, pz(X,l1e(G)), !0,...).resolvedTools) : ae
  //   ...(fork || isObserver) && { useExactTools: true }
  //   model: isObserver ? void 0 : meta.model
  const workerTools = (() => {
    if (isResumedFork) {
      return filterParentToolsForFork(toolUseContext.options.tools)
    }
    const pool = assembleToolPool(workerPermissionContext, appState.mcp.tools)
    if (!isObserverSidecar) return pool
    return applyObserverExactToolPool(
      resolveAgentTools(
        selectedAgent,
        pool,
        true, // isAsync
        false, // isMainThread
        true, // isObserverAgent
      ).resolvedTools,
    )
  })()

  // Resume user message: with origin → mid-turn wrap + isMeta; else raw
  // prompt (+ isMeta when promptIsMeta). continueInterruptedTurn skips re-append.
  // MessageOrigin in model-provider is a loose alias; runtime origin is an object.
  const resumeUserMessage =
    promptOrigin !== undefined
      ? createUserMessage({
          content: wrapResumePromptContent(prompt, promptOrigin),
          origin:
            promptOrigin as unknown as import('src/types/message.js').MessageOrigin,
          isMeta: true,
        })
      : createUserMessage({
          content: prompt,
          ...(promptIsMeta ? { isMeta: true as const } : {}),
        })
  const resumeQuerySource = isObserverSidecar
    ? (`agent:observer:${selectedAgent.agentType}` as Parameters<
        typeof runAgent
      >[0]['querySource'])
    : getQuerySourceForAgent(
        selectedAgent.agentType,
        isBuiltInAgent(selectedAgent),
      )
  const runAgentParams: Parameters<typeof runAgent>[0] = {
    agentDefinition: selectedAgent,
    promptMessages: continueInterruptedTurn
      ? [...resumedMessages]
      : [...resumedMessages, resumeUserMessage],
    toolUseContext,
    canUseTool,
    isAsync: true,
    querySource: resumeQuerySource,
    // densable + 2.1.327 (#522): keep saved model (full ID or alias) on resume
    model: resumeModelSpec,
    isResume: true,
    // Fork resume: pass parent's system prompt (cache-identical prefix).
    // Non-fork: undefined → runAgent recomputes under wrapWithCwd so
    // getCwd() sees resumedWorktreePath.
    override: isResumedFork
      ? { systemPrompt: forkParentSystemPrompt }
      : undefined,
    availableTools: workerTools,
    // Transcript already contains the parent context slice from the
    // original fork. Re-supplying it would cause duplicate tool_use IDs.
    forkContextMessages: undefined,
    // densable: (fork || isObserver) → useExactTools so Lco / fork pool sticks
    ...((isResumedFork || isObserverSidecar) && { useExactTools: true }),
    // Re-persist so metadata survives runAgent's writeAgentMetadata overwrite
    worktreePath: resumedWorktreePath,
    worktreeBranch: meta?.worktreeBranch,
    // densable W = S?.cwd ?? q
    cwd: meta?.cwd ?? resumedWorktreePath,
    spawnMode: metaSpawnMode,
    description: meta?.description,
    name: meta?.name,
    toolUseId: meta?.toolUseId ?? toolUseContext.toolUseId,
    parentAgentId: meta?.parentAgentId,
    spawnDepth: meta?.spawnDepth,
    contentReplacementState: resumedReplacementState,
    // densable 205709525: handbackOptIn:!(fork||observer)
    handbackOptIn: !(isResumedFork || isObserverSidecar),
    handbackTool: SubagentHandbackTool,
    ...(resolvedForkedSkillName !== undefined
      ? { forkedSkillName: resolvedForkedSkillName }
      : {}),
  }

  // Resume re-arm observer pairing from agent metadata pointer
  // (observerTaskId / armingPermissionMode) when observed declares observer.
  try {
    const { ensureObservedAgentObserver } = await import(
      'src/utils/observerAgents.js'
    )
    const { installAgentObserverRuntimeHost } = await import(
      './observerRuntimeHost.js'
    )
    const { readAgentMetadata: readObsMeta } = await import(
      'src/utils/sessionStorage.js'
    )
    // Install runtime host before re-arm so first post-resume delivery can fork.
    await installAgentObserverRuntimeHost({
      toolUseContext,
      canUseTool,
      setAppState: rootSetAppState,
      log: msg => logForDebugging(msg),
    })
    // Prefer meta already loaded above; re-read only if fields missing (older files).
    const observedMeta = {
      ...(meta?.observerTaskId ? { observerTaskId: meta.observerTaskId } : {}),
      ...(meta?.armingPermissionMode
        ? { armingPermissionMode: meta.armingPermissionMode }
        : {}),
    }
    // If metadata lacked observer fields, try a fresh read (same path).
    if (!observedMeta.observerTaskId) {
      const fresh = await readObsMeta(asAgentId(agentId))
      if (fresh?.observerTaskId) {
        observedMeta.observerTaskId = fresh.observerTaskId
      }
      if (fresh?.armingPermissionMode) {
        observedMeta.armingPermissionMode = fresh.armingPermissionMode
      }
    }
    const { toolMatchesName } = await import('src/Tool.js')
    const { AGENT_TOOL_NAME, LEGACY_AGENT_TOOL_NAME } = await import(
      './constants.js'
    )
    const rearmed = await ensureObservedAgentObserver({
      observedTaskId: agentId,
      observedDefinition: {
        agentType: selectedAgent.agentType,
        ...('observer' in selectedAgent && selectedAgent.observer
          ? { observer: selectedAgent.observer as string }
          : {}),
        ...('observerMessage' in selectedAgent &&
        typeof selectedAgent.observerMessage === 'string'
          ? { observerMessage: selectedAgent.observerMessage }
          : {}),
      },
      observedName: selectedAgent.agentType,
      observedMeta:
        observedMeta.observerTaskId || observedMeta.armingPermissionMode
          ? observedMeta
          : null,
      activeAgents: toolUseContext.options.agentDefinitions.activeAgents,
      armingToolUseContext: toolUseContext,
      canUseTool,
      setAppState: rootSetAppState,
      // Match AgentTool o5r arm gate density (tools + AgentTool.checkPermissions).
      tools: toolUseContext.options.tools?.map(t => ({
        name: t.name,
        ...(t.aliases ? { aliases: t.aliases } : {}),
      })),
      gateCanUseTool: async ({
        subagentType,
        description: gateDesc,
        prompt: gatePrompt,
      }) => {
        const agentTool = toolUseContext.options.tools.find(
          t =>
            toolMatchesName(t, AGENT_TOOL_NAME) ||
            toolMatchesName(t, LEGACY_AGENT_TOOL_NAME),
        )
        if (!agentTool) return 'deny'
        try {
          const result = await agentTool.checkPermissions(
            {
              description: gateDesc,
              prompt: gatePrompt,
              subagent_type: subagentType,
              run_in_background: true,
            },
            toolUseContext,
          )
          if (result.behavior === 'allow') return 'allow'
          if (result.behavior === 'deny') return 'deny'
          if (result.behavior === 'ask') return 'ask'
          return 'allow'
        } catch {
          return 'error'
        }
      },
      // Cold resume: prior observer process is not live → firstRunDone=false
      // + fresh observerTaskId (avoids re-register under residual dead id).
      isObserverProcessRunning: observerTaskId => {
        try {
          const tasks = toolUseContext.getAppState().tasks
          const task = tasks?.[observerTaskId] as
            | { type?: string; status?: string }
            | undefined
          return task?.type === 'local_agent' && task.status === 'running'
        } catch {
          return false
        }
      },
      generateObserverTaskId: () => createAgentId(),
      // Official KOu loadSidecar — feed observerStopped so reattach blocks.
      reattach: {
        priorObserverTaskId: observedMeta.observerTaskId,
        declaredObserverType:
          'observer' in selectedAgent &&
          typeof selectedAgent.observer === 'string'
            ? selectedAgent.observer
            : selectedAgent.agentType,
        loadSidecar: async sidecarId => {
          const side = await readObsMeta(asAgentId(sidecarId))
          if (!side) return null
          return {
            ...(side.observerStopped ? { observerStopped: true } : {}),
            agentType: side.agentType,
          }
        },
        isSidecarReattachable: async sidecarId => {
          try {
            const t = await getAgentTranscript(asAgentId(sidecarId))
            return Boolean(t)
          } catch {
            return false
          }
        },
      },
      log: msg => logForDebugging(msg),
    })
    // HXt: if cold reattach minted a fresh observer id, persist the pointer
    // so a later resume can reattach/hot-path or re-cold-spawn correctly.
    if (rearmed && rearmed.observerTaskId !== observedMeta.observerTaskId) {
      void writeAgentMetadata(asAgentId(agentId), {
        agentType: selectedAgent.agentType,
        description: uiDescription,
        observerTaskId: rearmed.observerTaskId,
        ...(rearmed.armingPermissionMode
          ? { armingPermissionMode: rearmed.armingPermissionMode }
          : {}),
      }).catch(_err =>
        logForDebugging(
          `Failed to write cold-reattach observer pointer metadata: ${_err}`,
        ),
      )
    }
  } catch (err) {
    logForDebugging(
      `[agentObserver] resume re-arm failed for '${selectedAgent.agentType}': ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // Re-register async agent (owner from main thread; parent from prior task;
  // attachOwnerKeepalive:false — resume re-stamps only).
  // Second stoppedByUser gate on live registry flag (not just sidecar).
  const mainOwnerId = getMainThreadAgentId()
  let parentFromTask: string | undefined
  let spawnDepthFromTask: number | undefined
  try {
    const live = toolUseContext.getAppState().tasks?.[agentId] as
      | { parentAgentId?: string; spawnDepth?: number; stoppedByUser?: boolean }
      | undefined
    parentFromTask =
      typeof live?.parentAgentId === 'string' ? live.parentAgentId : undefined
    spawnDepthFromTask =
      typeof live?.spawnDepth === 'number' ? live.spawnDepth : undefined
    if (
      !userInitiated &&
      isAgentStoppedByPerson(agentId, live?.stoppedByUser)
    ) {
      clearResuming()
      throw new AgentStoppedByUserError(
        `Agent ${agentId} was stopped by the user and won't be resumed. Treat its work as cancelled; only launch a new agent if the user explicitly asks.`,
      )
    }
    // Official 2.1.326 #107 (@303483211): When another subagent resumes a
    // background subagent that originally reported to the main conversation,
    // notify main which agent it now reports to instead of leaving main waiting
    // in silence.
    const resumerAgentId = toolUseContext.agentId
    if (
      resumerAgentId !== undefined &&
      resumerAgentId !== agentId &&
      parentFromTask === undefined &&
      !awaitCompletion
    ) {
      const resumerTask = toolUseContext.getAppState().tasks?.[
        resumerAgentId
      ] as { description?: string } | undefined
      const newOwnerLabel = resumerTask?.description || resumerAgentId
      enqueueMainAgentTakeoverNotice({
        taskId: agentId,
        description: uiDescription,
        newOwnerLabel,
      })
    }
  } catch (err) {
    if (err instanceof AgentStoppedByUserError) throw err
    parentFromTask = undefined
    spawnDepthFromTask = undefined
  }
  const resumeParentAgentId = parentFromTask ?? meta?.parentAgentId
  const resumeSpawnDepth = spawnDepthFromTask ?? meta?.spawnDepth

  // densable Aye: b?.name && registry missing → registerName(b.name, id).
  // Registry is in-memory; cold resume / process restart loses it unless we
  // rehydrate from sidecar meta.name (persisted at spawn via E8/T1e).
  // observer-activity resume stamps isObserver on the re-registered task.
  const existingParentForIdle = resumeParentAgentId
    ? toolUseContext.getAppState().tasks?.[resumeParentAgentId]
    : undefined
  const existingSelfForIdle = toolUseContext.getAppState().tasks?.[agentId]
  const inheritedBackgroundWaitFirstIdle =
    existingParentForIdle?.type === 'local_agent' &&
    existingParentForIdle.backgroundWaitFirstIdle != null
      ? existingParentForIdle.backgroundWaitFirstIdle
      : existingSelfForIdle?.type === 'local_agent' &&
          existingSelfForIdle.backgroundWaitFirstIdle != null
        ? existingSelfForIdle.backgroundWaitFirstIdle
        : undefined
  const agentBackgroundTask = registerAsyncAgent({
    agentId,
    description: uiDescription,
    prompt: promptText,
    ...(promptOriginKind === 'task-notification'
      ? { promptIsNotice: true }
      : {}),
    ...(inheritedBackgroundWaitFirstIdle !== undefined
      ? { backgroundWaitFirstIdle: inheritedBackgroundWaitFirstIdle }
      : {}),
    selectedAgent,
    setAppState: rootSetAppState,
    toolUseId: toolUseContext.toolUseId,
    ownerAgentId: mainOwnerId,
    notificationTargetAgentId: asAgentId(mainOwnerId),
    ...(resumeParentAgentId ? { parentAgentId: resumeParentAgentId } : {}),
    ...(resumeSpawnDepth !== undefined ? { spawnDepth: resumeSpawnDepth } : {}),
    ...(promptOriginKind === 'observer-activity' ? { isObserver: true } : {}),
    ...(resolvedForkedSkillName !== undefined
      ? { forkedSkillName: resolvedForkedSkillName }
      : {}),
    attachOwnerKeepalive: false,
    getAppState: toolUseContext.getAppState,
    webFetchSavedFiles: webFetchSavedFilesForAgent(selectedAgent),
  })

  const resumeDisplayName = meta?.name
  if (
    resumeDisplayName &&
    resumeDisplayName !== MAIN_RECIPIENT_NAME &&
    toolUseContext.getAppState().agentNameRegistry.get(resumeDisplayName) ===
      undefined
  ) {
    rootSetAppState(prev => {
      const next = new Map(prev.agentNameRegistry)
      next.set(resumeDisplayName, asAgentId(agentId))
      return { ...prev, agentNameRegistry: next }
    })
  }

  // Mirror resume prompt onto the sidechain transcript when neither
  // promptIsMeta nor continueInterruptedTurn. Official store can write
  // transcripts before re-register; local task.messages needs the task first,
  // so append AFTER registerAsyncAgent (cold resume would no-op before).
  // densable Ace/Xeo: meta-visible origins keep the mid-turn-wrapped
  // message; otherwise append raw prompt + origin.
  if (!promptIsMeta && !continueInterruptedTurn) {
    const { appendMessageToLocalAgent } = await import(
      'src/tasks/LocalAgentTask/LocalAgentTask.js'
    )
    const sidechainMsg = isMetaVisibleOrigin(promptOrigin)
      ? resumeUserMessage
      : createUserMessage({
          content: prompt,
          ...(promptOrigin !== undefined
            ? {
                origin:
                  promptOrigin as unknown as import('src/types/message.js').MessageOrigin,
              }
            : {}),
        })
    appendMessageToLocalAgent(
      agentBackgroundTask.agentId,
      sidechainMsg,
      rootSetAppState,
    )
  }

  // suppress owner notify for observer digests
  if (suppressOwnerNotification) {
    const { markAgentsNotified } = await import(
      'src/tasks/LocalAgentTask/LocalAgentTask.js'
    )
    markAgentsNotified(agentBackgroundTask.agentId, rootSetAppState)
  }

  const metadata = {
    prompt: promptText,
    resolvedAgentModel,
    isBuiltInAgent: isBuiltInAgent(selectedAgent),
    startTime,
    agentType: selectedAgent.agentType,
    isAsync: true,
    persistedToolResultFiles: webFetchSavedFilesForAgent(selectedAgent),
  }

  const asyncAgentContext = {
    agentId,
    parentSessionId: getParentSessionId(),
    agentType: 'subagent' as const,
    subagentName: selectedAgent.agentType,
    isBuiltIn: isBuiltInAgent(selectedAgent),
    invokingRequestId,
    invocationKind: 'resume' as const,
    invocationEmitted: false,
    isBackgroundAgent: true as const,
  }

  const wrapWithCwd = <T>(fn: () => T): T =>
    resumedWorktreePath ? runWithCwdOverride(resumedWorktreePath, fn) : fn()

  const lifecyclePromise = runWithAgentContext(asyncAgentContext, () =>
    wrapWithCwd(() =>
      runAsyncAgentLifecycle({
        taskId: agentBackgroundTask.agentId,
        abortController: agentBackgroundTask.abortController!,
        makeStream: (
          onCacheSafeParams,
          onQueryProgress,
          onStreamTokenEstimate,
        ) =>
          runAgent({
            ...runAgentParams,
            override: {
              ...runAgentParams.override,
              agentId: asAgentId(agentBackgroundTask.agentId),
              abortController: agentBackgroundTask.abortController!,
            },
            onCacheSafeParams,
            onQueryProgress,
            onStreamTokenEstimate,
          }),
        metadata,
        description: uiDescription,
        toolUseContext,
        rootSetAppState,
        agentIdForCleanup: agentId,
        enableSummarization:
          isCoordinatorMode() ||
          isForkSubagentProductEnabled() ||
          getSdkAgentProgressSummariesEnabled(),
        getWorktreeResult: async () =>
          resumedWorktreePath ? { worktreePath: resumedWorktreePath } : {},
      }),
    ),
  )

  // awaitCompletion: await lifecycle, then mark notified + grace.
  // densable X8a(K=true): finalText from lifecycle return (preferred) then
  // AppState task.result fallback — avoids racing completeAgentTask writes.
  let finalText: string | undefined
  if (awaitCompletion) {
    try {
      const settled = await lifecyclePromise
      if (settled?.finalText !== undefined) {
        finalText = settled.finalText
      } else {
        const task = toolUseContext.getAppState().tasks?.[agentId] as
          | {
              result?: {
                content?: ReadonlyArray<{ type: string; text?: string }>
              }
            }
          | undefined
        finalText = extractTextContent(task?.result?.content ?? [], '\n')
      }
    } finally {
      try {
        const { PANEL_GRACE_MS } = await import('src/utils/task/framework.js')
        rootSetAppState(prev => {
          const tasks = prev.tasks
          const task = tasks?.[agentId]
          if (!task || !tasks) return prev
          return {
            ...prev,
            tasks: {
              ...tasks,
              [agentId]: {
                ...task,
                notified: true as const,
                evictAfter: Date.now() + PANEL_GRACE_MS,
              } as typeof task,
            },
          }
        })
      } catch {
        /* best-effort */
      }
    }
  } else {
    void lifecyclePromise
  }

  // densable Ce("subagent_launch") after lifecycle spawn wired
  logEvent('tengu_feature_ok', {
    feature_name:
      'subagent_launch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return {
    agentId,
    description: uiDescription,
    outputFile: getTaskOutputPath(agentId),
    ...(finalText !== undefined ? { finalText } : {}),
  }
}

/** densable `Svr` — inline resume (await stream; Aut() does not refuse). */
export function resumeAgentInline(
  opts: Parameters<typeof resumeAgentBackground>[0],
): Promise<ResumeAgentResult> {
  return resumeAgentBackground({
    ...opts,
    resumeSurface: 'inline',
    awaitCompletion: true,
  })
}

/** densable `k$n` — reply resume (SendMessage surface). */
export function resumeAgentForReply(
  opts: Parameters<typeof resumeAgentBackground>[0],
): Promise<ResumeAgentResult> {
  return resumeAgentBackground({
    ...opts,
    resumeSurface: 'reply',
    awaitCompletion: true,
  })
}
