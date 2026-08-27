import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import { dirname, win32 as pathWin32 } from 'path'
import {
  getMainLoopModelOverride,
  getSessionId,
  setMainLoopModelOverride,
  setMainThreadAgentType,
  setOriginalCwd,
  switchSession,
} from '../bootstrap/state.js'
import { applyMainThreadAgentHooks } from './hooks/applyMainThreadAgentHooks.js'
import { clearSystemPromptSections } from '../constants/systemPromptSections.js'
import { restoreCostStateForSession } from '../cost-tracker.js'
import type { AppState } from '../state/AppState.js'
import type { AgentColorName } from '@claude-code/builtin-tools/tools/AgentTool/agentColorManager.js'
import {
  type AgentDefinition,
  type AgentDefinitionsResult,
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
} from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { TODO_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/TodoWriteTool/constants.js'
import { asSessionId } from '../types/ids.js'
import type {
  AttributionSnapshotMessage,
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
  PersistedWorktreeSession,
} from '../types/logs.js'
import type { Message } from '../types/message.js'
import { renameRecordingForSession } from './asciicast.js'
import { clearMemoryFileCaches } from './claudemd.js'
import {
  type AttributionState,
  attributionRestoreStateFromLog,
  restoreAttributionStateFromSnapshots,
} from './commitAttribution.js'
import { updateSessionName } from './concurrentSessions.js'
import { getCwd } from './cwd.js'
import { isNetworkUncPath, isNtObjectNamespacePath } from './path.js'
import { getErrnoCode } from './errors.js'
import {
  isHardIsolationPinRefuse,
  liveLaunchDirs,
  probeIsolationWorktreePinSync,
  processLaunchCwd,
  realpathOrSelf,
  uniqueLiveRoots,
} from './isolationWorktreePin.js'
import { logEvent } from '../services/analytics/index.js'
import { logForDebugging } from './debug.js'
import type { FileHistorySnapshot } from './fileHistory.js'
import { fileHistoryRestoreStateFromLog } from './fileHistory.js'
import { createSystemMessage } from './messages.js'
import { parseUserSpecifiedModel } from './model/model.js'
import { getPlansDirectory } from './plans.js'
import { isCoordinatorModeEnvEnabled } from './residualFinalEnvGates.js'
import { setCwd } from './Shell.js'
import {
  adoptResumedSessionFile,
  recordContentReplacement,
  resetSessionFilePointer,
  restoreSessionMetadata,
  saveMode,
  saveWorktreeState,
} from './sessionStorage.js'
import { isTodoV2Enabled } from './tasks.js'
import type { TodoList } from './todo/types.js'
import { TodoListSchema } from './todo/types.js'
import type { ContentReplacementRecord } from './toolResultStorage.js'
import {
  getCurrentWorktreeSession,
  restoreWorktreeSession,
} from './worktree.js'

type ResumeResult = {
  messages?: Message[]
  fileHistorySnapshots?: FileHistorySnapshot[]
  attributionSnapshots?: AttributionSnapshotMessage[]
  contextCollapseCommits?: ContextCollapseCommitEntry[]
  contextCollapseSnapshot?: ContextCollapseSnapshotEntry
}

/**
 * Scan the transcript for the last TodoWrite tool_use block and return its todos.
 * Used to hydrate AppState.todos on SDK --resume so the model's todo list
 * survives session restarts without file persistence.
 */
function extractTodosFromTranscript(messages: Message[]): TodoList {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.type !== 'assistant') continue
    const toolUse = (msg.message!.content as any[]).find(
      block => block.type === 'tool_use' && block.name === TODO_WRITE_TOOL_NAME,
    )
    if (!toolUse || toolUse.type !== 'tool_use') continue
    const input = toolUse.input
    if (input === null || typeof input !== 'object') return []
    const parsed = TodoListSchema().safeParse(
      (input as Record<string, unknown>).todos,
    )
    return parsed.success ? parsed.data : []
  }
  return []
}

/**
 * Restore session state (file history, attribution, todos) from log on resume.
 * Used by both SDK (print.ts) and interactive (REPL.tsx, main.tsx) resume paths.
 */
export function restoreSessionStateFromLog(
  result: ResumeResult,
  setAppState: (f: (prev: AppState) => AppState) => void,
  options?: {
    restoredInternal?: { worker_permission_mode?: unknown } | null
    restoredWorker?: import('./permissions/planModeResume.js').RestoredWorkerMetadata
    forkSession?: boolean
    /** densable: continue must not pass this / must not call y_u */
    applyPlanModeResume?: boolean
    planModeResumeLane?: 'interactive' | 'print' | 'sdk_url'
  },
): void {
  // densable 2.1.214 Ern(Brt(ur), setAppState) — hydrate EndConversation lock
  const endedByModel = Boolean(
    (result as { endedByModel?: boolean }).endedByModel,
  )
  setAppState(prev =>
    prev.endedByModel === endedByModel ? prev : { ...prev, endedByModel },
  )

  // Restore file history state
  if (result.fileHistorySnapshots && result.fileHistorySnapshots.length > 0) {
    fileHistoryRestoreStateFromLog(result.fileHistorySnapshots, newState => {
      setAppState(prev => ({ ...prev, fileHistory: newState }))
    })
  }

  // densable 2.1.239 OMo: restoreGoalFromTranscript after fileHistory.
  // Official always calls (undefined messages → clear leftover activeGoal).
  {
    /* eslint-disable @typescript-eslint/no-require-imports */
    ;(
      require('../services/goal/restoreGoalFromTranscript.js') as typeof import('../services/goal/restoreGoalFromTranscript.js')
    ).restoreGoalFromTranscript(result.messages, setAppState)
    /* eslint-enable @typescript-eslint/no-require-imports */
  }

  // Restore attribution state (ant-only feature)
  if (
    feature('COMMIT_ATTRIBUTION') &&
    result.attributionSnapshots &&
    result.attributionSnapshots.length > 0
  ) {
    attributionRestoreStateFromLog(result.attributionSnapshots, newState => {
      setAppState(prev => ({ ...prev, attribution: newState }))
    })
  }

  // Restore context-collapse commit log + staged snapshot. Must run before
  // the first query() so projectView() can rebuild the collapsed view from
  // the resumed Message[]. Called unconditionally (even with
  // undefined/empty entries) because restoreFromEntries resets the store
  // first — without that, an in-session /resume into a session with no
  // commits would leave the prior session's stale commit log intact.
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    ;(
      require('../services/contextCollapse/persist.js') as typeof import('../services/contextCollapse/persist.js')
    ).restoreFromEntries(
      result.contextCollapseCommits ?? [],
      result.contextCollapseSnapshot,
    )
    /* eslint-enable @typescript-eslint/no-require-imports */
  }

  // Restore TodoWrite state from transcript (SDK/non-interactive only).
  // Interactive mode uses file-backed v2 tasks, so AppState.todos is unused there.
  if (!isTodoV2Enabled() && result.messages && result.messages.length > 0) {
    const todos = extractTodosFromTranscript(result.messages)
    if (todos.length > 0) {
      const agentId = getSessionId()
      setAppState(prev => ({
        ...prev,
        todos: { ...prev.todos, [agentId]: todos },
      }))
    }
  }

  // Restore session model choice (from /model command)
  const sessionModel = (result as Record<string, unknown>).sessionModel as
    | string
    | undefined
  if (sessionModel) {
    setAppState(prev => ({
      ...prev,
      mainLoopModel: sessionModel,
    }))
  }

  // densable #13 y_u after OMo — interactive / resume only (never continue)
  if (options?.applyPlanModeResume) {
    const { hydratePlanModeFromRestoredWorker } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./permissions/planModeResume.js') as typeof import('./permissions/planModeResume.js')
    const restored =
      options.restoredWorker ??
      (options.restoredInternal
        ? { external: null, internal: options.restoredInternal }
        : null)
    hydratePlanModeFromRestoredWorker(setAppState, restored, {
      forkSession: !!options.forkSession,
      lane: options.planModeResumeLane ?? 'interactive',
    })
  }
}

/**
 * Compute restored attribution state from log snapshots.
 * Used for computing initial state before render (e.g., main.tsx --continue).
 * Returns undefined if attribution feature is disabled or no snapshots exist.
 */
export function computeRestoredAttributionState(
  result: ResumeResult,
): AttributionState | undefined {
  if (
    feature('COMMIT_ATTRIBUTION') &&
    result.attributionSnapshots &&
    result.attributionSnapshots.length > 0
  ) {
    return restoreAttributionStateFromSnapshots(result.attributionSnapshots)
  }
  return undefined
}

/**
 * Compute standalone agent context (name/color) for session resume.
 * Used for computing initial state before render (per CLAUDE.md guidelines).
 * Returns undefined if no name/color is set on the session.
 */
export function computeStandaloneAgentContext(
  agentName: string | undefined,
  agentColor: string | undefined,
): AppState['standaloneAgentContext'] | undefined {
  if (!agentName && !agentColor) {
    return undefined
  }
  return {
    name: agentName ?? '',
    color: (agentColor === 'default' ? undefined : agentColor) as
      | AgentColorName
      | undefined,
  }
}

/**
 * Restore agent setting from a resumed session.
 *
 * When resuming a conversation that used a custom agent, this re-applies the
 * agent type and model override (unless the user specified --agent on the CLI).
 * Mutates bootstrap state via setMainThreadAgentType / setMainLoopModelOverride.
 *
 * Returns the restored agent definition and its agentType string, or undefined
 * if no agent was restored.
 */
export function restoreAgentFromSession(
  agentSetting: string | undefined,
  currentAgentDefinition: AgentDefinition | undefined,
  agentDefinitions: AgentDefinitionsResult,
): {
  agentDefinition: AgentDefinition | undefined
  agentType: string | undefined
} {
  // If user already specified --agent on CLI, keep that definition
  if (currentAgentDefinition) {
    return { agentDefinition: currentAgentDefinition, agentType: undefined }
  }

  // If session had no agent, clear any stale bootstrap state
  if (!agentSetting) {
    setMainThreadAgentType(undefined)
    applyMainThreadAgentHooks(undefined)
    return { agentDefinition: undefined, agentType: undefined }
  }

  const resumedAgent = agentDefinitions.activeAgents.find(
    agent => agent.agentType === agentSetting,
  )
  if (!resumedAgent) {
    logForDebugging(
      `Resumed session had agent "${agentSetting}" but it is no longer available. Using default behavior.`,
    )
    setMainThreadAgentType(undefined)
    applyMainThreadAgentHooks(undefined)
    return { agentDefinition: undefined, agentType: undefined }
  }

  setMainThreadAgentType(resumedAgent.agentType)
  // densable NQe → QEt: re-apply origin-trust gate on resume
  applyMainThreadAgentHooks(resumedAgent)

  // Apply agent's model if user didn't specify one
  if (
    !getMainLoopModelOverride() &&
    resumedAgent.model &&
    resumedAgent.model !== 'inherit'
  ) {
    setMainLoopModelOverride(parseUserSpecifiedModel(resumedAgent.model))
  }

  return { agentDefinition: resumedAgent, agentType: resumedAgent.agentType }
}

/**
 * Refresh agent definitions after a coordinator/normal mode switch.
 *
 * When resuming a session that was in a different mode (coordinator vs normal),
 * the built-in agents need to be re-derived to match the new mode. CLI-provided
 * agents (from --agents flag) are merged back in.
 */
export async function refreshAgentDefinitionsForModeSwitch(
  modeWasSwitched: boolean,
  currentCwd: string,
  cliAgents: AgentDefinition[],
  currentAgentDefinitions: AgentDefinitionsResult,
): Promise<AgentDefinitionsResult> {
  if (!feature('COORDINATOR_MODE') || !modeWasSwitched) {
    return currentAgentDefinitions
  }

  // Re-derive agent definitions after mode switch so built-in agents
  // reflect the new coordinator/normal mode
  getAgentDefinitionsWithOverrides.cache.clear?.()
  const freshAgentDefs = await getAgentDefinitionsWithOverrides(currentCwd)
  const freshAllAgents = [...freshAgentDefs.allAgents, ...cliAgents]
  return {
    ...freshAgentDefs,
    allAgents: freshAllAgents,
    activeAgents: getActiveAgentsFromList(freshAllAgents),
  }
}

/**
 * Result of processing a resumed/continued conversation for rendering.
 */
export type ProcessedResume = {
  messages: Message[]
  fileHistorySnapshots?: FileHistorySnapshot[]
  contentReplacements?: ContentReplacementRecord[]
  agentName: string | undefined
  agentColor: AgentColorName | undefined
  restoredAgentDef: AgentDefinition | undefined
  initialState: AppState
}

/**
 * Subset of the coordinator mode module API needed for session resume.
 */
type CoordinatorModeApi = {
  matchSessionMode(mode?: string): string | undefined
  isCoordinatorMode(): boolean
}

/**
 * The loaded conversation data (return type of loadConversationForResume).
 */
type ResumeLoadResult = {
  messages: Message[]
  fileHistorySnapshots?: FileHistorySnapshot[]
  attributionSnapshots?: AttributionSnapshotMessage[]
  contentReplacements?: ContentReplacementRecord[]
  contextCollapseCommits?: ContextCollapseCommitEntry[]
  contextCollapseSnapshot?: ContextCollapseSnapshotEntry
  sessionId: UUID | undefined
  agentName?: string
  agentColor?: string
  agentSetting?: string
  customTitle?: string
  tag?: string
  mode?: 'coordinator' | 'normal'
  worktreeSession?: PersistedWorktreeSession | null
  prNumber?: number
  prUrl?: string
  prRepository?: string
  goal?: import('../types/logs.js').GoalState
  /** densable 2.1.214 EndConversation marker → AppState.endedByModel */
  endedByModel?: boolean
  /**
   * densable 2.1.224 #30 — non-empty bridge-session pointer. Force RC on
   * resume only when set; tombstone (user-off) leaves this undefined.
   */
  bridgeSessionId?: string
}

/**
 * densable `k0c` / GGc — transcript/worktree path is network UNC or
 * NT-namespace → do not chdir (warn). Returns true when unsafe.
 */
export function isUnsafeSessionRestorePath(path: string): boolean {
  if (
    isNetworkUncPath(path) ||
    isNtObjectNamespacePath(path) ||
    isNtObjectNamespacePath(pathWin32.normalize(path))
  ) {
    logForDebugging(
      '[sessionRestore] transcript path is a network/NT-namespace path — not chdir-ing',
      { level: 'warn' },
    )
    return true
  }
  return false
}

/**
 * densable `dvr` — refuse cross-host session home shape (UNC / NT-object).
 */
export function isCrossHostSessionHomeShape(path: string): boolean {
  const resolved = pathWin32.resolve(path)
  return (
    isUncOrNtObjectLike(path) ||
    isUncOrNtObjectLike(resolved) ||
    isNtObjectNamespacePath(path) ||
    isNtObjectNamespacePath(resolved) ||
    isNtObjectNamespacePath(pathWin32.normalize(path))
  )
}

function isUncOrNtObjectLike(path: string): boolean {
  return (
    /^[\\/]{2}/.test(path) ||
    isNtObjectNamespacePath(path) ||
    (path.includes('??') && isNtObjectNamespacePath(pathWin32.normalize(path)))
  )
}

/**
 * Restore the worktree working directory on resume. The transcript records
 * the last worktree enter/exit; if the session crashed while inside a
 * worktree (last entry = session object, not null), cd back into it.
 *
 * process.chdir is the TOCTOU-safe existence check — it throws ENOENT if
 * the /exit dialog removed the directory, or if the user deleted it
 * manually between sessions.
 *
 * When --worktree already created a fresh worktree, that takes precedence
 * over the resumed session's state. restoreSessionMetadata just overwrote
 * project.currentSessionWorktree with the stale transcript value, so
 * re-assert the fresh worktree here before adoptResumedSessionFile writes
 * it back to disk.
 */
export function restoreWorktreeForResume(
  worktreeSession: PersistedWorktreeSession | null | undefined,
): void {
  const fresh = getCurrentWorktreeSession()
  if (fresh) {
    saveWorktreeState(fresh)
    return
  }
  if (!worktreeSession) return

  // densable k0c / GGc — refuse network/NT worktree paths before chdir
  if (isUnsafeSessionRestorePath(worktreeSession.worktreePath)) {
    saveWorktreeState(null)
    return
  }

  const launchCwd = processLaunchCwd()
  const pin = probeIsolationWorktreePinSync(
    worktreeSession.worktreePath,
    liveLaunchDirs(worktreeSession.originalCwd),
    uniqueLiveRoots([
      realpathOrSelf(launchCwd),
      ...liveLaunchDirs(launchCwd),
      realpathOrSelf(processLaunchCwd()),
      ...liveLaunchDirs(processLaunchCwd()),
    ]),
    { declineSelfOwningPinUnderLiveRoot: true },
  )
  if (!pin.ok) {
    const poisoned = isHardIsolationPinRefuse(pin.reason)
    logForDebugging(
      `[worktree] declining to resume into ${worktreeSession.worktreePath} (${pin.reason}): ${pin.message}`,
      { level: 'error' },
    )
    logEvent('tengu_worktree_resume_root_rejected', {
      poisoned,
    })
    if (poisoned) {
      saveWorktreeState(null)
    }
    return
  }

  try {
    process.chdir(worktreeSession.worktreePath)
  } catch (err) {
    const code = getErrnoCode(err)
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      saveWorktreeState(null)
      logEvent('tengu_worktree_resume_root_rejected', {
        poisoned: true,
      })
      return
    }
    logEvent('tengu_worktree_resume_root_rejected', {
      poisoned: false,
    })
    return
  }

  setCwd(worktreeSession.worktreePath)
  setOriginalCwd(getCwd())
  // projectRoot is intentionally NOT set here. The transcript doesn't record
  // whether the worktree was entered via --worktree (which sets projectRoot)
  // or EnterWorktreeTool (which doesn't). Leaving projectRoot stable matches
  // EnterWorktreeTool's behavior — skills/history stay anchored to the
  // original project.
  restoreWorktreeSession(worktreeSession)
  // The /resume slash command calls this mid-session after caches have been
  // populated against the old cwd. Cheap no-ops for the CLI-flag path
  // (caches aren't populated yet there).
  clearMemoryFileCaches()
  clearSystemPromptSections()
  getPlansDirectory.cache.clear?.()
}

/**
 * Undo restoreWorktreeForResume before a mid-session /resume switches to
 * another session. Without this, /resume from a worktree session to a
 * non-worktree session leaves the user in the old worktree directory with
 * currentWorktreeSession still pointing at the prior session. /resume to a
 * *different* worktree fails entirely — the getCurrentWorktreeSession()
 * guard above blocks the switch.
 *
 * Not needed by CLI --resume/--continue: those run once at startup where
 * getCurrentWorktreeSession() is only truthy if --worktree was used (fresh
 * worktree that should take precedence, handled by the re-assert above).
 */
export function exitRestoredWorktree(): void {
  const current = getCurrentWorktreeSession()
  if (!current) return

  restoreWorktreeSession(null)
  // Worktree state changed, so cached prompt sections that reference it are
  // stale whether or not chdir succeeds below.
  clearMemoryFileCaches()
  clearSystemPromptSections()
  getPlansDirectory.cache.clear?.()

  try {
    process.chdir(current.originalCwd)
  } catch {
    // Original dir is gone (rare). Stay put — restoreWorktreeForResume
    // will cd into the target worktree next if there is one.
    return
  }
  setCwd(current.originalCwd)
  setOriginalCwd(getCwd())
}

/**
 * Process a loaded conversation for resume/continue.
 *
 * Handles coordinator mode matching, session ID setup, agent restoration,
 * mode persistence, and initial state computation. Called by both --continue
 * and --resume paths in main.tsx.
 */
export async function processResumedConversation(
  result: ResumeLoadResult,
  opts: {
    forkSession: boolean
    sessionIdOverride?: string
    transcriptPath?: string
    includeAttribution?: boolean
    /**
     * densable a.replyOnResume — seed initialMessage:{replay:true} when
     * interactive mid-turn fork has no CLI prompt string.
     */
    replyOnResume?: boolean
  },
  context: {
    modeApi: CoordinatorModeApi | null
    mainThreadAgentDefinition: AgentDefinition | undefined
    agentDefinitions: AgentDefinitionsResult
    currentCwd: string
    cliAgents: AgentDefinition[]
    initialState: AppState
  },
): Promise<ProcessedResume> {
  // Match coordinator/normal mode to the resumed session
  let modeWarning: string | undefined
  if (feature('COORDINATOR_MODE')) {
    modeWarning = context.modeApi?.matchSessionMode(result.mode)
    if (modeWarning) {
      result.messages.push(createSystemMessage(modeWarning, 'warning'))
    }
  }

  // Reuse the resumed session's ID unless --fork-session is specified
  if (!opts.forkSession) {
    const sid = opts.sessionIdOverride ?? result.sessionId
    if (sid) {
      // When resuming from a different project directory (git worktrees,
      // cross-project), transcriptPath points to the actual file; its dirname
      // is the project dir. Otherwise the session lives in the current project.
      // densable k0c/dvr: refuse network/NT session-home shapes
      let projectDirOverride: string | null = opts.transcriptPath
        ? dirname(opts.transcriptPath)
        : null
      if (
        projectDirOverride !== null &&
        (isUnsafeSessionRestorePath(projectDirOverride) ||
          isCrossHostSessionHomeShape(projectDirOverride) ||
          (opts.transcriptPath !== undefined &&
            isUnsafeSessionRestorePath(opts.transcriptPath)))
      ) {
        logForDebugging(
          `Resume: refusing cross-host session home shape "${projectDirOverride}"`,
        )
        projectDirOverride = null
      }
      switchSession(asSessionId(sid), projectDirOverride)
      // Rename asciicast recording to match the resumed session ID so
      // getSessionRecordingPaths() can discover it during /share
      await renameRecordingForSession()
      await resetSessionFilePointer()
      restoreCostStateForSession(sid)
    }
  } else if (result.contentReplacements?.length) {
    // --fork-session keeps the fresh startup session ID. useLogMessages will
    // copy source messages into the new JSONL via recordTranscript, but
    // content-replacement entries are a separate entry type only written by
    // recordContentReplacement (which query.ts calls for newlyReplaced, never
    // the pre-loaded records). Without this seed, `claude -r {newSessionId}`
    // finds source tool_use_ids in messages but no matching replacement records
    // → they're classified as FROZEN → full content sent (cache miss, permanent
    // overage). insertContentReplacement stamps sessionId = getSessionId() =
    // the fresh ID, so loadTranscriptFile's keyed lookup will match.
    await recordContentReplacement(result.contentReplacements)
  }

  // Restore session metadata so /status shows the saved name and metadata
  // is re-appended on session exit. Fork doesn't take ownership of the
  // original session's worktree — a "Remove" on the fork's exit dialog
  // would delete a worktree the original session still references — so
  // strip worktreeSession from the fork path so the cache stays unset.
  restoreSessionMetadata(
    opts.forkSession ? { ...result, worktreeSession: undefined } : result,
  )

  if (feature('GOAL') && result.goal) {
    const { hydrateGoalFromTranscript } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/goal/goalStorage.js') as typeof import('../services/goal/goalStorage.js')
    const goalsMap = new Map<UUID, import('../types/logs.js').GoalState>()
    const sid = (opts.sessionIdOverride ??
      result.sessionId ??
      getSessionId()) as UUID
    goalsMap.set(sid, result.goal)
    hydrateGoalFromTranscript(goalsMap, sid)
  }

  if (!opts.forkSession) {
    // Cd back into the worktree the session was in when it last exited.
    // Done after restoreSessionMetadata (which caches the worktree state
    // from the transcript) so if the directory is gone we can override
    // the cache before adoptResumedSessionFile writes it.
    restoreWorktreeForResume(result.worktreeSession)

    // Point sessionFile at the resumed transcript and re-append metadata
    // now. resetSessionFilePointer above nulled it (so the old fresh-session
    // path doesn't leak), but that blocks reAppendSessionMetadata — which
    // bails on null — from running in the exit cleanup handler. For fork,
    // useLogMessages populates a *new* file via recordTranscript on REPL
    // mount; the normal lazy-materialize path is correct there.
    adoptResumedSessionFile()
  }

  // Restore context-collapse commit log + staged snapshot. The interactive
  // /resume path goes through restoreSessionStateFromLog (REPL.tsx); CLI
  // --continue/--resume goes through here instead. Called unconditionally
  // — see the restoreSessionStateFromLog callsite above for why.
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    ;(
      require('../services/contextCollapse/persist.js') as typeof import('../services/contextCollapse/persist.js')
    ).restoreFromEntries(
      result.contextCollapseCommits ?? [],
      result.contextCollapseSnapshot,
    )
    /* eslint-enable @typescript-eslint/no-require-imports */
  }

  // Restore agent setting from resumed session
  const { agentDefinition: restoredAgent, agentType: resumedAgentType } =
    restoreAgentFromSession(
      result.agentSetting,
      context.mainThreadAgentDefinition,
      context.agentDefinitions,
    )

  // Persist the current mode so future resumes know what mode this session was in.
  // Prefer result.mode (transcript) so a null modeApi that skipped matchSessionMode
  // cannot persist 'normal' for a coordinator session. Fall back to the densable
  // env gate for older transcripts that omit mode.
  if (feature('COORDINATOR_MODE')) {
    saveMode(
      result.mode ?? (isCoordinatorModeEnvEnabled() ? 'coordinator' : 'normal'),
    )
  }

  // Compute initial state before render (per CLAUDE.md guidelines)
  const restoredAttribution = opts.includeAttribution
    ? computeRestoredAttributionState(result)
    : undefined
  const standaloneAgentContext = computeStandaloneAgentContext(
    result.agentName,
    result.agentColor,
  )
  void updateSessionName(result.agentName)
  const refreshedAgentDefs = await refreshAgentDefinitionsForModeSwitch(
    !!modeWarning,
    context.currentCwd,
    context.cliAgents,
    context.agentDefinitions,
  )

  // densable: Fr?{message}:a.replyOnResume?{replay:!0}:null
  // Keep any CLI prompt initialMessage; else when --reply-on-resume seed replay.
  const seededInitialMessage =
    context.initialState.initialMessage ??
    (opts.replyOnResume ? ({ replay: true as const } as const) : null)

  // densable 2.1.224 #30:
  // !forkSession && e.bridgeSessionId && !(already full RC) → force RC on.
  // User-off wrote clearBridgeSession tombstone → bridgeSessionId absent → no force-on.
  // feature() must stay in if/ternary condition position (bun:bundle).
  let forceRcOn = false
  if (feature('BRIDGE_MODE')) {
    const alreadyFullRc =
      context.initialState.replBridgeEnabled &&
      !context.initialState.replBridgeOutboundOnly
    forceRcOn = !opts.forkSession && !!result.bridgeSessionId && !alreadyFullRc
  }

  // densable #13 y_u into initialState when CCR stash present (interactive
  // --resume before REPL mount). continue never hits this function with stash
  // from print; interactive continue also goes through here — only apply when
  // stash exists (local continue has none).
  let planHydratedState = context.initialState
  {
    const {
      takeRestoredWorkerForPlanResume,
      applyPlanModeResumeFromInternal,
      createPlanModeResumeTracker,
      recordPlanModeResumeTelemetry,
      classifyPlanModeOnResume,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./permissions/planModeResume.js') as typeof import('./permissions/planModeResume.js')
    const restored = takeRestoredWorkerForPlanResume()
    if (restored?.internal || restored?.external) {
      const tracker = createPlanModeResumeTracker()
      planHydratedState = applyPlanModeResumeFromInternal<AppState>(
        restored.internal as { worker_permission_mode?: unknown } | null,
        tracker,
        { forkSession: opts.forkSession },
      )(planHydratedState)
      recordPlanModeResumeTelemetry(tracker, {
        lane: 'interactive',
        hadExternal: !!restored.external,
        hadInternal: !!restored.internal,
      })
      void classifyPlanModeOnResume(tracker)
    }
  }

  return {
    messages: result.messages,
    fileHistorySnapshots: result.fileHistorySnapshots,
    contentReplacements: result.contentReplacements,
    agentName: result.agentName,
    agentColor: (result.agentColor === 'default'
      ? undefined
      : result.agentColor) as AgentColorName | undefined,
    restoredAgentDef: restoredAgent,
    initialState: {
      ...planHydratedState,
      initialMessage: seededInitialMessage,
      // densable: ...e.endedByModel?{endedByModel:!0}:{}
      ...(result.endedByModel ? { endedByModel: true } : {}),
      ...(resumedAgentType && { agent: resumedAgentType }),
      ...(restoredAttribution && { attribution: restoredAttribution }),
      ...(standaloneAgentContext && { standaloneAgentContext }),
      agentDefinitions: refreshedAgentDefs,
      ...(forceRcOn
        ? { replBridgeEnabled: true, replBridgeOutboundOnly: false }
        : {}),
    },
  }
}
