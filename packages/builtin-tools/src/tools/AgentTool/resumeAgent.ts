import { promises as fsp } from 'fs'
import {
  getMainThreadAgentId,
  getSdkAgentProgressSummariesEnabled,
} from 'src/bootstrap/state.js'
import { getSystemPrompt } from 'src/constants/prompts.js'
import { isCoordinatorMode } from 'src/coordinator/coordinatorMode.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import type { ToolUseContext } from 'src/Tool.js'
import type { InternalPermissionMode } from 'src/types/permissions.js'
import { registerAsyncAgent } from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import { assembleToolPool } from 'src/tools.js'
import { filterParentToolsForFork } from 'src/utils/agentToolFilter.js'
import { asAgentId, toAgentId } from 'src/types/ids.js'
import { MAIN_RECIPIENT_NAME } from 'src/utils/swarm/constants.js'
import { runWithAgentContext } from 'src/utils/agentContext.js'
import { getCwd, runWithCwdOverride } from 'src/utils/cwd.js'
import {
  isHardIsolationPinRefuse,
  liveLaunchDirs,
  probeIsolationWorktreePin,
  processLaunchCwd,
  uniqueLiveRoots,
} from 'src/utils/isolationWorktreePin.js'
import { logForDebugging } from 'src/utils/debug.js'
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
  wrapResumePromptOrigin,
} from 'src/utils/messages.js'
import { getAgentModel } from 'src/utils/model/agent.js'
import { isModelAlias, type ModelAlias } from 'src/utils/model/aliases.js'
import { getQuerySourceForAgent } from 'src/utils/promptCategory.js'
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
import { FORK_AGENT, isForkSubagentEnabled } from './forkSubagent.js'
import type { AgentDefinition } from './loadAgentsDir.js'
import { isBuiltInAgent } from './loadAgentsDir.js'
import { runAgent } from './runAgent.js'

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
}: {
  agentId: string
  prompt: string
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
}): Promise<ResumeAgentResult> {
  const startTime = Date.now()
  const appState = toolUseContext.getAppState()
  // In-process teammates get a no-op setAppState; setAppStateForTasks
  // reaches the root store so task registration/progress/kill stay visible.
  const rootSetAppState =
    toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState
  const sessionMode = appState.toolPermissionContext.mode

  // CAS at entry (before disk reads): claim resuming; else throw already
  // running/being resumed. clearResuming on setup failure paths.
  const { tryClaimAgentResume, clearAgentResuming } = await import(
    'src/tasks/LocalAgentTask/LocalAgentTask.js'
  )
  if (
    !tryClaimAgentResume(agentId, rootSetAppState, () =>
      toolUseContext.getAppState(),
    )
  ) {
    throw new ResumeAgentStateError(
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
      startTime,
      appState,
      rootSetAppState,
      sessionMode,
      clearResuming,
    })
  } catch (err) {
    clearResuming()
    throw err
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
  startTime,
  appState,
  rootSetAppState,
  sessionMode,
  clearResuming,
}: {
  agentId: string
  prompt: string
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
      : new ResumeAgentStateError(
          err instanceof Error ? err.message : String(err),
        )
  }
  // densable Aye: disk missing → in-memory mirror (taskRegistry.getTranscript
  // messages written during the run). Local mirror is LocalAgentTask.messages.
  if (!transcript) {
    const liveTasks = toolUseContext.getAppState().tasks
    const task = liveTasks?.[agentId]
    const mirrored =
      task &&
      typeof task === 'object' &&
      'messages' in task &&
      Array.isArray(task.messages) &&
      task.messages.length > 0
        ? task.messages
        : undefined
    if (mirrored) {
      logForDebugging(
        `[resumeAgentBackground ${agentId}] disk transcript missing; using ${mirrored.length} in-memory messages mirrored during the run`,
      )
      transcript = {
        messages: mirrored as NonNullable<typeof transcript>['messages'],
        contentReplacements: [],
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
  // else clear disk marker and proceed.
  if (meta?.stoppedByUser && promptOriginKind !== 'observer-activity') {
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

  // densable Aye:
  //   y = session mode
  //   J = isObserver ? MJe(workerPermissionMode, y) ?? y : void 0
  //   mode = J ?? workerPermissionMode ?? spawnMode ?? agent.permissionMode ?? "acceptEdits"
  // MJe only applies when sidecar isObserver (observer deliver path).
  const isObserverSidecar = meta?.isObserver === true
  const observerCappedMode = isObserverSidecar
    ? (resolveWorkerPermissionMode(workerPermissionMode, sessionMode) ??
      sessionMode)
    : undefined
  const metaSpawnMode =
    typeof meta?.spawnMode === 'string'
      ? (meta.spawnMode as InternalPermissionMode)
      : undefined
  const resolvedWorkerMode: InternalPermissionMode =
    observerCappedMode ??
    (workerPermissionMode as InternalPermissionMode | undefined) ??
    metaSpawnMode ??
    (selectedAgent.permissionMode as InternalPermissionMode | undefined) ??
    'acceptEdits'

  // Resolve model for analytics metadata (runAgent resolves its own internally).
  // densable: model pin S?.isObserver ? void 0 : S?.model; getAgentModel
  // uses session mode, not worker mode. Only alias strings re-pin via
  // toolSpecifiedModel; full IDs still flow through runAgent.model.
  const resumeModelRaw =
    isObserverSidecar || !meta?.model ? undefined : meta.model
  const resumeModelAlias: ModelAlias | undefined =
    resumeModelRaw && isModelAlias(resumeModelRaw) ? resumeModelRaw : undefined
  const resolvedAgentModel = getAgentModel(
    resolveAgentDefinitionModel(
      selectedAgent,
      toolUseContext.options.mainLoopModel,
    ),
    toolUseContext.options.mainLoopModel,
    resumeModelAlias,
    sessionMode,
  )

  const workerPermissionContext = {
    ...appState.toolPermissionContext,
    mode: resolvedWorkerMode,
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
          content: wrapResumePromptOrigin(prompt, promptOrigin),
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
    // densable: model pin skipped for observer (b?.isObserver?void 0:b?.model)
    model: resumeModelAlias,
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
  try {
    const live = toolUseContext.getAppState().tasks?.[agentId] as
      | { parentAgentId?: string; stoppedByUser?: boolean }
      | undefined
    parentFromTask =
      typeof live?.parentAgentId === 'string' ? live.parentAgentId : undefined
    if (!userInitiated && live?.stoppedByUser === true) {
      clearResuming()
      throw new AgentStoppedByUserError(
        `Agent ${agentId} was stopped by the user and won't be resumed. Treat its work as cancelled; only launch a new agent if the user explicitly asks.`,
      )
    }
  } catch (err) {
    if (err instanceof AgentStoppedByUserError) throw err
    parentFromTask = undefined
  }

  // densable Aye: b?.name && registry missing → registerName(b.name, id).
  // Registry is in-memory; cold resume / process restart loses it unless we
  // rehydrate from sidecar meta.name (persisted at spawn via E8/T1e).
  // observer-activity resume stamps isObserver on the re-registered task.
  const agentBackgroundTask = registerAsyncAgent({
    agentId,
    description: uiDescription,
    prompt,
    selectedAgent,
    setAppState: rootSetAppState,
    toolUseId: toolUseContext.toolUseId,
    ownerAgentId: mainOwnerId,
    notificationTargetAgentId: asAgentId(mainOwnerId),
    ...(parentFromTask ? { parentAgentId: parentFromTask } : {}),
    ...(promptOriginKind === 'observer-activity' ? { isObserver: true } : {}),
    attachOwnerKeepalive: false,
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
    prompt,
    resolvedAgentModel,
    isBuiltInAgent: isBuiltInAgent(selectedAgent),
    startTime,
    agentType: selectedAgent.agentType,
    isAsync: true,
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
        makeStream: onCacheSafeParams =>
          runAgent({
            ...runAgentParams,
            override: {
              ...runAgentParams.override,
              agentId: asAgentId(agentBackgroundTask.agentId),
              abortController: agentBackgroundTask.abortController!,
            },
            onCacheSafeParams,
          }),
        metadata,
        description: uiDescription,
        toolUseContext,
        rootSetAppState,
        agentIdForCleanup: agentId,
        enableSummarization:
          isCoordinatorMode() ||
          isForkSubagentEnabled() ||
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
