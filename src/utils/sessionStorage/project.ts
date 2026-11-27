import {
  getPlanSlugCache,
  getPromptId,
  getSessionId,
  getSessionProjectDir,
  switchSession,
} from '../../bootstrap/state.js'
import * as sessionIngress from '../../services/api/sessionIngress.js'
import { type AgentId, asAgentId, asSessionId } from '../../types/ids.js'
import type {
  AttributionSnapshotMessage,
  ContentReplacementEntry,
  Entry,
  FileHistorySnapshotMessage,
  PersistedWorktreeSession,
  TranscriptMessage,
} from '../../types/logs.js'
import type { QueueOperationMessage } from '../../types/messageQueueTypes.js'
import type { PermissionMode } from '../../types/permissions.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { isDisklessActive, logDisklessWriteSkipped } from '../disklessGuards.js'
import { isEnvTruthy } from '../envUtils.js'
import { errorMessage, isFsInaccessible } from '../errors.js'
import type { FileHistorySnapshot } from '../fileHistory.js'
import { formatFileSize } from '../format.js'
import { getBranch } from '../git.js'
import { gracefulShutdownSync, isShuttingDown } from '../gracefulShutdown.js'
import { logError } from '../log.js'
import { isCompactBoundaryMessage } from '../messages.js'
import { hasActiveSessionAls, isSharedBackend } from '../sessionHost.js'
import {
  getAgentTranscriptPath,
  getTranscriptPath,
  getTranscriptPathForSession,
  getUserType,
  isChainParticipant,
  isTranscriptMessage,
} from '../sessionPaths.js'
import {
  getPersistenceSuppressCause,
  isPersistenceSuppressed,
} from '../sessionPersistenceStatus.js'
import {
  LITE_READ_BUF_SIZE,
  SKIP_PRECOMPACT_THRESHOLD,
  extractLastJsonStringField,
  extractTypedJsonlField,
  readTranscriptForLoad,
} from '../sessionStoragePortable.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { getPinnedStorageV5 } from '../storageV5/index.js'
import type { ContentReplacementRecord } from '../toolResultStorage.js'
import {
  getTranscriptWriterDegraded,
  recordTranscriptWriteFailure,
  recordTranscriptWriteSuccess,
  remapTranscriptWriterPaths,
  resetTranscriptWriterHealthForTest,
} from '../transcriptWriterHealth.js'
import type { UUID } from 'crypto'
import {
  closeSync,
  appendFileSync as fsAppendFileSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  writeSync,
} from 'fs'
import {
  appendFile as fsAppendFile,
  open as fsOpen,
  mkdir,
  readFile,
  stat,
} from 'fs/promises'
import { dirname, resolve } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  type ApiRequestBlobEntry,
  type ApiRequestEntry,
  type ApiRequestShapeEntry,
  type InternalEventReader,
  type InternalEventWriter,
  type LeftoverInternalAgentEventReader,
  type LeftoverParkedAppend,
  type LeftoverStorageV5Append,
  MAX_CACHED_SESSION_FILES,
  MAX_REPLAY_SHAPE_BYTES,
  MAX_TOMBSTONE_REWRITE_BYTES,
  REMOTE_FLUSH_INTERVAL_MS,
  type RequestReplayRecords,
  type RequestReplayWriteResult,
  type SessionProjectHandle,
  TRANSCRIPT_COMPACT_BACKSTOP_BYTES,
  TRANSCRIPT_COMPACT_MIN_BYTES,
  type ToolUseNameWindowLike,
  type Transcript,
  VERSION,
} from './types.js'
import {
  type HostSessionStorageState,
  appendAndSyncOnNfs,
  collectLiveHostStorageStates,
  getEntrypoint,
  getErrnoCode,
  getHostSessionStorageState,
  isLiveBridgeSuppressed,
  isLocalGcEnabled,
  isPromptFlushTranscriptEntry,
  notifySessionTitleChanged,
  recordTranscriptFullDiskError,
  refreshHostStorageSessionRef,
  registerTornTailHook,
  runWithHostStorageSession,
} from './sessionState.js'
import {
  appendEntryToExistingFileSync,
  appendEntryToFile,
  readExactFromHandle,
  readFileTailSync,
  writeExactToHandle,
  writeFileAtomicDurably,
} from './fsHelpers.js'
import {
  getResumeHeadPath,
  planResumeHeadForTranscript,
  resolveMainSessionTranscriptKey,
  scheduleWriteResumeHead,
} from './sidecars.js'
import {
  ToolUseNameWindow,
  capOriginalFileForStorage,
  getFirstMeaningfulUserMessageTextContent,
  isCompactPairEntry,
  slimToolUseResultForResume,
} from './transcriptChain.js'
import {
  compactTranscriptFileAtomic,
  defaultTranscriptGcKeepLine,
} from './transcriptGc.js'
import { getSessionMessages } from './transcriptLoader.js'

const projectByHostState = new WeakMap<HostSessionStorageState, Project>()

function syncExitReStampState(state: HostSessionStorageState): void {
  if (state.exitReStampRan) return
  state.exitReStampRan = true
  runWithHostStorageSession(state, hasLiveSession => {
    try {
      if (hasLiveSession) {
        state.project?.flushQueuedWritesSync()
      } else {
        state.project?.flushQueuedWritesSync(
          state.lastSkipPersistence ?? false,
          true,
        )
      }
    } catch {
      // Best-effort — don't let sync drain crash process exit
    }
    if (!hasLiveSession) {
      // Owning Session was GC'd — never call reAppendSessionMetadata() under
      // defaultBootstrapSession (which would stamp defaultSession.id into this
      // host's JSONL).
      return
    }
    try {
      state.project?.reAppendSessionMetadata(false, true)
    } catch {
      // Best-effort — don't let metadata re-append crash process exit
    }
  })
}

function targetHostStorageStatesForExit(): HostSessionStorageState[] {
  if (hasActiveSessionAls()) {
    return [getHostSessionStorageState()]
  }
  return collectLiveHostStorageStates()
}

/**
 * Unconditionally synchronously drain + re-stamp ALL live hosts (ignoring
 * `hasActiveSessionAls()`), used by `process.on('exit')` so `process.exit()`
 * triggered inside one host's ALS never leaves sibling hosts unflushed.
 */
export function syncExitReStampAllLiveHostStorageStates(): void {
  for (const state of collectLiveHostStorageStates()) {
    syncExitReStampState(state)
  }
}

/**
 * Official XAs + 2.1.325 #2266 — synchronous exit drain + re-stamp (called both
 * from `process.on('exit')` and from `flushSessionStorageAtExit` finally,
 * guarded by one-shot `exitReStampRan`) so queued recent turns are flushed
 * before process exit even when shutdown was not clean.
 */
export function syncExitReStamp(): void {
  if (isSharedBackend() && !hasActiveSessionAls()) return
  syncExitReStampAllLiveHostStorageStates()
}

async function flushHostStorageStateAtExit(
  state: HostSessionStorageState,
): Promise<void> {
  if (state.exitFlushInFlight) {
    await state.exitFlushInFlight
    return
  }
  const runFlush = (async () => {
    await runWithHostStorageSession(state, async hasLiveSession => {
      try {
        if (state.exitDrains.size > 0) {
          const drains = [...state.exitDrains]
          state.exitDrains.clear()
          await Promise.race([
            Promise.allSettled(drains.map(fn => Promise.resolve().then(fn))),
            new Promise<void>(resolve => setTimeout(resolve, 500)),
          ])
        }
        if (hasLiveSession) {
          await state.project?.flush()
        } else {
          // Owning Session was GC'd — flush raw queued writes synchronously
          // without materializing or reading defaultBootstrapSession.
          state.project?.flushQueuedWritesSync(
            state.lastSkipPersistence ?? false,
            true,
          )
        }
      } catch {
        // Best-effort flush at exit
      } finally {
        syncExitReStampState(state)
        if (hasLiveSession) {
          const degraded = getTranscriptWriterDegraded()
          if (degraded !== null) {
            logForDebugging(
              `flushSessionStorageAtExit: transcript writer degraded (${degraded.code} at ${degraded.source}) — entries since the failure window may be missing from the transcript`,
              { level: 'error' },
            )
          }
        }
      }
    })
  })()
  state.exitFlushInFlight = runFlush
  try {
    await runFlush
  } finally {
    if (state.exitFlushInFlight === runFlush) {
      state.exitFlushInFlight = undefined
    }
  }
}

/**
 * Unconditionally flush ALL live hosts' storage states and exit drains, even if
 * shutdown was triggered while `hasActiveSessionAls()` is true.
 */
export async function flushAllLiveHostStorageStatesAtExit(): Promise<void> {
  const states = collectLiveHostStorageStates()
  await Promise.allSettled(
    states.map(state => flushHostStorageStateAtExit(state)),
  )
}

/**
 * Official f6a — async exit flush registered via `registerCleanup` and called on
 * graceful shutdown so the last messages of a session are never lost on quit.
 * When called directly inside an active ALS host, flushes only that host; when
 * called outside ALS in CLI mode, flushes all live hosts; in shared-backend mode
 * outside ALS (`isSharedBackend() && !hasActiveSessionAls()`), returns early.
 */
export async function flushSessionStorageAtExit(): Promise<void> {
  if (isSharedBackend() && !hasActiveSessionAls()) return
  const states = targetHostStorageStatesForExit()
  await Promise.allSettled(
    states.map(state => flushHostStorageStateAtExit(state)),
  )
}

export function getProject(): Project {
  const state = getHostSessionStorageState()
  let project = projectByHostState.get(state)
  if (!project) {
    project = new Project(state)
    state.project = project
    projectByHostState.set(state, project)

    // Register ONLY the per-host weak cleanup into cleanupRegistry for BOTH
    // default and isolated hosts. On out-of-ALS process shutdown,
    // cleanupRegistry.runCleanupFunctions() already iterates and drains every
    // live host — registering a global sweep on the default host would double-
    // execute isolated hosts' exitDrains!
    if (!state.cleanupUnregister) {
      const stateRef = new WeakRef(state)
      state.cleanupUnregister = registerCleanup(async () => {
        const liveState = stateRef.deref()
        if (!liveState) return
        await flushHostStorageStateAtExit(liveState)
      })
    }
    if (!process.listeners('exit').includes(syncExitReStamp)) {
      process.on('exit', syncExitReStamp)
    }
  }
  return project
}

/**
 * Reset the Project singleton's flush state for testing.
 * This ensures tests don't interfere with each other via shared counter state.
 */
export function resetProjectFlushStateForTesting(): void {
  const state = getHostSessionStorageState()
  state.project?._resetFlushState()
  state.exitReStampRan = false
  state.exitFlushInFlight = undefined
  resetTranscriptWriterHealthForTest()
}

/**
 * Reset the entire Project singleton for testing.
 * This ensures tests with different CLAUDE_CONFIG_DIR values
 * don't share stale sessionFile paths.
 */
export function resetProjectForTesting(): void {
  const state = getHostSessionStorageState()
  state.cleanupUnregister?.()
  state.cleanupUnregister = undefined
  state.project = null
  projectByHostState.delete(state)
  state.exitReStampRan = false
  state.exitFlushInFlight = undefined
  resetTranscriptWriterHealthForTest()
}

export function setSessionFileForTesting(path: string): void {
  getProject().setSessionFile(path)
}

/**
 * densable Bbr — register a stdout SessionStore transcript_mirror callback.
 * Fired after each successful local transcript appendToFile.
 */
export function addTranscriptMirror(
  cb: (filePath: string, entries: Entry[]) => void,
): void {
  getProject().addMirror(cb)
}

/**
 * densable zCt — live bridge pointer for the current session (id/seq/flags).
 * Returns undefined when RC is not live on this process.
 */
export function getCurrentSessionBridge():
  | {
      id: string
      seq: number
      declaredDialogKinds?: string[]
      groupingId?: string
      noHistoryBackfill?: boolean
      ownerAccountUuid?: string
      ownerOrganizationUuid?: string
    }
  | undefined {
  const project = getProject()
  if (!project.currentSessionBridgeId) return undefined
  return {
    id: project.currentSessionBridgeId,
    seq: project.currentSessionBridgeSeq ?? 0,
    declaredDialogKinds: project.currentSessionBridgeDialogKinds,
    groupingId: project.currentSessionBridgeGroupingId,
    noHistoryBackfill: project.currentSessionBridgeNoBackfill,
    ownerAccountUuid: project.currentSessionBridgeOwnerAccountUuid,
    ownerOrganizationUuid: project.currentSessionBridgeOwnerOrganizationUuid,
  }
}

/**
 * densable jCt — withhold compact-pair remote upload when the session carries
 * noHistoryBackfill (mint-after-gone) or the live probe says so.
 */
export function isCompactPairWithheldFromRemote(): boolean {
  return (
    getCurrentSessionBridge()?.noHistoryBackfill === true ||
    isLiveBridgeSuppressed()
  )
}

/**
 * Register a CCR v2 internal event writer for transcript persistence.
 * When set, transcript messages are written as internal worker events
 * instead of going through v1 Session Ingress.
 */
export function setInternalEventWriter(writer: InternalEventWriter): void {
  getProject().setInternalEventWriter(writer)
}

/** Official 2.1.328 `AJn()`: true when a CCR v2 internal event writer is registered. */
export function hasInternalEventWriter(): boolean {
  return getProject().hasInternalEventWriter()
}

/** Official 2.1.328 `clearInternalEventWriter()`: unregister CCR v2 internal event writer. */
export function clearInternalEventWriter(): void {
  getProject().clearInternalEventWriter()
}

/**
 * Register a CCR v2 internal event reader for session resume.
 * When set, hydrateFromCCRv2InternalEvents() can fetch foreground and
 * subagent internal events to reconstruct conversation state on reconnection.
 * densable RPn: reader may accept after_event_id for delta rehydrate.
 */
export function setInternalEventReader(
  reader: InternalEventReader,
  subagentReader: InternalEventReader,
): void {
  getProject().setInternalEventReader(reader)
  getProject().setInternalSubagentEventReader(subagentReader)
}

/**
 * Set the remote ingress URL on the current Project for testing.
 * This simulates what hydrateRemoteSession does in production.
 */
export function setRemoteIngressUrlForTesting(url: string): void {
  getProject().setRemoteIngressUrl(url)
}

class Project implements SessionProjectHandle {
  // Minimal cache for current session only (not all sessions)
  currentSessionTag: string | undefined
  currentSessionTitle: string | undefined
  /** densable `currentSessionAiTitle` — v$e() for M9e seed when no user title. */
  currentSessionAiTitle: string | undefined
  currentSessionAgentName: string | undefined
  currentSessionAgentColor: string | undefined
  currentSessionLastPrompt: string | undefined
  currentSessionAgentSetting: string | undefined
  currentSessionMode: 'coordinator' | 'normal' | undefined
  /** Official 2.1.328 (`chunk@294254613.js @535149`): last-wins `type:"permission-mode"` session state. */
  currentSessionPermissionMode: PermissionMode | undefined
  currentSessionModel: string | undefined
  /** Official 2.1.328: last-wins `type:"repl-mode"` Code Mode session state. */
  currentSessionCodeMode: boolean | undefined
  /** Official 2.1.328 (`slimAppendedRow`): sliding tool_use window for slimming appended rows on disk. */
  appendToolUseWindow: ToolUseNameWindowLike | undefined
  /** densable `currentSessionDevModsFolder` — consented mods folder (`iLr`). */
  currentSessionDevModsFolder: string | undefined
  // Tri-state: undefined = never touched (don't write), null = exited worktree,
  // object = currently in worktree. reAppendSessionMetadata writes null so
  // --resume knows the session exited (vs. crashed while inside).
  currentSessionWorktree:
    | (PersistedWorktreeSession & { extensionRoot?: string })
    | null
    | undefined
  currentSessionPrNumber: number | undefined
  currentSessionPrUrl: string | undefined
  currentSessionPrRepository: string | undefined
  /** densable currentSessionBridgeId — non-empty only while RC is live / last saved. */
  currentSessionBridgeId: string | undefined
  currentSessionBridgeSeq: number | undefined
  currentSessionBridgeDialogKinds: string[] | undefined
  currentSessionBridgeGroupingId: string | undefined
  currentSessionBridgeNoBackfill: boolean | undefined
  /** densable currentSessionBridgeOwnerAccountUuid — OAuth account on last Bkn. */
  currentSessionBridgeOwnerAccountUuid: string | undefined
  /** densable currentSessionBridgeOwnerOrganizationUuid. */
  currentSessionBridgeOwnerOrganizationUuid: string | undefined
  /** densable currentSessionHistorySuppressed — g4t / Sno. */
  currentSessionHistorySuppressed: boolean | undefined
  /** densable knownTaintedSessionIds — QJe / y4t. */
  knownTaintedSessionIds: Set<UUID> | undefined
  /** densable currentSessionPrecautionarySuppression — qXs / _4t / Cno. */
  currentSessionPrecautionarySuppression: Set<string> | undefined
  /** densable leftover KXs / te — clearResilientPrecautionSids. */
  clearResilientPrecautionSids: Set<string> | undefined
  /** densable leftover YXs / ZXs / Me / _e — scanUncertaintyHoldSids. */
  scanUncertaintyHoldSids: Set<string> | undefined

  sessionFile: string | null = null
  /**
   * densable `currentSessionRelocatedCwd` — last cwd stamped by tNt after a
   * successful (or same-path) transcript rehome. Used to skip redundant
   * relocated stamps when only originalCwd changed without a path move.
   */
  currentSessionRelocatedCwd: string | undefined
  // Entries buffered while sessionFile is null. Flushed by materializeSessionFile
  // on the first user/assistant message — prevents metadata-only session files.
  private pendingEntries: Entry[] = []
  private replayHashes = new Map<string, Set<string>>()
  private oversizeReplayShapes = new Set<string>()
  /**
   * densable `relocationBuffer` — while non-null, appendEntry enqueues here
   * instead of writing, so mid-rehome writes land after setSessionFile.
   */
  private relocationBuffer: Array<{ entry: Entry; sessionId: UUID }> | null =
    null
  /**
   * densable `relocationParkedAppends` / `relocationParkedPath` — gold KC
   * parks `{entry,storageV5,opts,resolve,reject}` until Skn replay.
   */
  private relocationParkedAppends: LeftoverParkedAppend[] | null = null
  private relocationParkedPath: string | null = null
  /** densable `tornTailToSeal` — single-slot path for the next append/sync seal. */
  private tornTailToSeal: string | null = null
  private remoteIngressUrl: string | null = null
  private internalEventWriter: InternalEventWriter | null = null
  private internalEventReader: InternalEventReader | null = null
  private internalSubagentEventReader: InternalEventReader | null = null
  /**
   * densable `internalAgentEventReader` — lazy agent-transcript hydrate, not
   * the session CCR `internalEventReader`. PNt is `!== null`.
   */
  private internalAgentEventReader: LeftoverInternalAgentEventReader | null =
    null
  private pendingWriteCount: number = 0
  private flushResolvers: Array<() => void> = []
  // Per-file write queues. Each entry carries a resolve callback so
  // callers of enqueueWrite can optionally await their specific write.
  private writeQueues = new Map<
    string,
    Array<{ entry: Entry; resolve: () => void }>
  >()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private activeDrain: Promise<void> | null = null
  private drainChain: Promise<void> = Promise.resolve()
  private FLUSH_INTERVAL_MS = 100
  private readonly MAX_CHUNK_BYTES = 100 * 1024 * 1024
  private bytesSinceCompact = 0
  private backstopThresholdBytes = TRANSCRIPT_COMPACT_BACKSTOP_BYTES
  private minCompactFileBytes = TRANSCRIPT_COMPACT_MIN_BYTES
  /** densable Project.mirrors — SessionStore transcript_mirror callbacks. */
  private mirrors: Array<(filePath: string, entries: Entry[]) => void> = []
  private readonly hostState: HostSessionStorageState

  constructor(
    hostState: HostSessionStorageState = getHostSessionStorageState(),
  ) {
    this.hostState = hostState
  }

  /** @internal Reset flush/queue state for testing. */
  _resetFlushState(): void {
    this.pendingWriteCount = 0
    this.flushResolvers = []
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    this.activeDrain = null
    this.drainChain = Promise.resolve()
    this.writeQueues = new Map()
    this.existingSessionFiles = new Map()
    // densable _resetFlushState also clears mirrors[]
    this.mirrors = []
    this.tornTailToSeal = null
    this.bytesSinceCompact = 0
    this.backstopThresholdBytes = TRANSCRIPT_COMPACT_BACKSTOP_BYTES
    this.minCompactFileBytes = TRANSCRIPT_COMPACT_MIN_BYTES
  }

  addMirror(cb: (filePath: string, entries: Entry[]) => void): void {
    this.mirrors.push(cb)
  }

  fireMirror(filePath: string, entries: Entry[]): void {
    for (const mirror of this.mirrors) {
      try {
        mirror(filePath, entries)
      } catch (err) {
        logForDebugging(
          `[SessionMirror] mirror failed for ${filePath}: ${err}`,
          {
            level: 'error',
          },
        )
      }
    }
  }

  private incrementPendingWrites(): void {
    this.pendingWriteCount++
  }

  private decrementPendingWrites(): void {
    this.pendingWriteCount--
    if (this.pendingWriteCount === 0) {
      // Resolve all waiting flush promises
      for (const resolve of this.flushResolvers) {
        resolve()
      }
      this.flushResolvers = []
    }
  }

  private async trackWrite<T>(fn: () => Promise<T>): Promise<T> {
    this.incrementPendingWrites()
    try {
      return await fn()
    } finally {
      this.decrementPendingWrites()
    }
  }

  private enqueueWrite(filePath: string, entry: Entry): Promise<void> {
    refreshHostStorageSessionRef(this.hostState)
    return new Promise<void>(resolve => {
      let queue = this.writeQueues.get(filePath)
      if (!queue) {
        queue = []
        this.writeQueues.set(filePath, queue)
      }
      // Drop oldest entries when queue exceeds limit to prevent unbounded memory growth
      if (queue.length >= 1000) {
        const dropped = queue.splice(0, queue.length - 999)
        for (const d of dropped) {
          d.resolve()
        }
      }
      queue.push({ entry, resolve })
      if (isPromptFlushTranscriptEntry(entry)) {
        this.scheduleImmediateDrain()
      } else {
        this.scheduleDrain()
      }
    })
  }

  /**
   * Official 2.1.325 #2266: flush turn entries promptly without waiting for
   * the 100ms batching interval so an unclean exit does not lose recent turns.
   */
  private scheduleImmediateDrain(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null
      this.activeDrain = this.drainWriteQueue()
      await this.activeDrain
      this.activeDrain = null
      if (this.writeQueues.size > 0) {
        this.scheduleDrain()
      }
    }, 0)
  }

  /**
   * Official 2.1.325 #2266: synchronously write any entries still queued in
   * `writeQueues` during `process.on('exit')` so an unclean exit (e.g.
   * direct `process.exit()` without awaiting async flush) does not drop them.
   */
  flushQueuedWritesSync(
    skipPersistenceOverride?: boolean,
    skipHealthReporting = false,
  ): void {
    const skipPersistence =
      skipPersistenceOverride !== undefined
        ? skipPersistenceOverride
        : this.shouldSkipPersistence()
    if (skipPersistence || this.writeQueues.size === 0) {
      return
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    for (const [filePath, queue] of this.writeQueues) {
      if (queue.length === 0) continue
      const batch = queue.splice(0)
      let content = ''
      for (const { entry } of batch) {
        content += jsonStringify(entry) + '\n'
      }
      if (content.length > 0) {
        if (isDisklessActive()) {
          logDisklessWriteSkipped(
            'sessionStorage:flushQueuedWritesSync',
            filePath,
          )
        } else {
          try {
            fsAppendFileSync(filePath, content, { mode: 0o600 })
            if (filePath === this.sessionFile) {
              this.bytesSinceCompact += Buffer.byteLength(content, 'utf8')
            }
            if (!skipHealthReporting) {
              recordTranscriptWriteSuccess(filePath)
            }
          } catch (err) {
            if (!skipHealthReporting) {
              recordTranscriptFullDiskError(err, filePath)
              recordTranscriptWriteFailure('drain', err, filePath)
            }
          }
        }
      }
      for (const { resolve } of batch) {
        resolve()
      }
    }
    this.writeQueues.clear()
  }

  private scheduleDrain(): void {
    if (this.flushTimer) {
      return
    }
    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null
      this.activeDrain = this.drainWriteQueue()
      await this.activeDrain
      this.activeDrain = null
      // If more items arrived during drain, schedule again
      if (this.writeQueues.size > 0) {
        this.scheduleDrain()
      }
    }, this.FLUSH_INTERVAL_MS)
  }

  private async appendToFile(filePath: string, data: string): Promise<void> {
    try {
      const { leftoverAppendSerial } = this.hostState
      // densable drain pye third arg is storageV5 (hover-rest backend).
      await leftoverAppendSerial.run(filePath, async () => {
        if (
          !getPinnedStorageV5() &&
          !isDisklessActive() &&
          (await appendAndSyncOnNfs(filePath, data))
        ) {
          return
        }
        await leftoverPye(filePath, data, getPinnedStorageV5())
      })
      if (filePath === this.sessionFile) {
        this.bytesSinceCompact += Buffer.byteLength(data, 'utf8')
      }
      recordTranscriptWriteSuccess(filePath)
    } catch (err) {
      recordTranscriptFullDiskError(err, filePath)
      recordTranscriptWriteFailure('drain', err, filePath)
      throw err
    }
  }

  private drainWriteQueue(): Promise<void> {
    const next = this.drainChain.then(() => this.drainQueuesOnce())
    this.drainChain = next.catch(() => {})
    return next
  }

  private async drainQueuesOnce(): Promise<void> {
    for (const [filePath, queue] of this.writeQueues) {
      if (queue.length === 0) {
        continue
      }
      const batch = queue.splice(0)

      let content = ''
      let sawCompactBoundary = false
      const resolvers: Array<() => void> = []
      const mirrored: Entry[] | undefined =
        this.mirrors.length > 0 ? [] : undefined

      for (const { entry, resolve } of batch) {
        if (isTranscriptMessage(entry) && isCompactBoundaryMessage(entry)) {
          sawCompactBoundary = true
        }
        const line = jsonStringify(entry) + '\n'

        if (content.length + line.length >= this.MAX_CHUNK_BYTES) {
          // Flush chunk and resolve its entries before starting a new one
          await this.appendToFile(filePath, content)
          if (mirrored) {
            this.fireMirror(filePath, mirrored.slice())
            mirrored.length = 0
          }
          for (const r of resolvers) {
            r()
          }
          resolvers.length = 0
          content = ''
        }

        content += line
        resolvers.push(resolve)
        mirrored?.push(entry)
      }

      if (content.length > 0) {
        await this.appendToFile(filePath, content)
        if (mirrored) {
          this.fireMirror(filePath, mirrored)
        }
        for (const r of resolvers) {
          r()
        }
      }

      // Official 2.1.328 (`Pde`, `chunk@294254613.js @420598, @714199`):
      // when a compact_boundary flushes to a transcript, refresh its
      // `resume-head.jsonl` side-file if it meets the size gain threshold.
      if (sawCompactBoundary && !isDisklessActive()) {
        const headPath = getResumeHeadPath(filePath, dirname(dirname(filePath)))
        if (headPath) {
          void stat(filePath)
            .then(async st => {
              if (st.size <= SKIP_PRECOMPACT_THRESHOLD) return
              const scan = await readTranscriptForLoad(filePath, st.size)
              if (scan.boundaryStartOffset > 0) {
                const planned = await planResumeHeadForTranscript(
                  filePath,
                  st.size,
                  scan.boundaryStartOffset,
                )
                if (planned) {
                  scheduleWriteResumeHead(headPath, planned)
                }
              }
            })
            .catch(() => {})
        }
      }
    }

    // Clean up empty queues
    for (const [filePath, queue] of this.writeQueues) {
      if (queue.length === 0) {
        this.writeQueues.delete(filePath)
      }
    }

    if (
      isLocalGcEnabled() &&
      this.sessionFile &&
      this.bytesSinceCompact >= this.backstopThresholdBytes
    ) {
      this.bytesSinceCompact = 0
      await this.performCompactTranscript(this.sessionFile)
    }
  }

  async performCompactTranscript(
    filePath: string,
    shouldKeepLine: (
      line: string,
      index: number,
    ) => boolean = defaultTranscriptGcKeepLine,
  ): Promise<void> {
    if (!isLocalGcEnabled() || isDisklessActive()) return
    try {
      const fileStat = await stat(filePath)
      if (fileStat.size < this.minCompactFileBytes) return
      const res = await compactTranscriptFileAtomic(filePath, shouldKeepLine)
      if (res.compacted) {
        // Invalidate stale resume-head.jsonl side-file after transcript rewrite
        const headPath = getResumeHeadPath(filePath, dirname(dirname(filePath)))
        if (headPath) {
          scheduleWriteResumeHead(headPath, null)
        }
        logEvent('tengu_transcript_compact', {
          bytesBefore: res.bytesBefore,
          bytesAfter: res.bytesAfter,
        })
      } else if (res.abortedReason) {
        logEvent('tengu_transcript_compact_failed', {
          reason:
            res.abortedReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }
    } catch (err) {
      logEvent('tengu_transcript_compact_failed', {
        reason: 'io',
        error_code: getErrnoCode(err),
      })
      logForDebugging(
        `Transcript compact failed (${getErrnoCode(err) ?? 'unknown'}): ${errorMessage(err)}`,
        { level: 'warn' },
      )
    }
  }

  /** @internal Configure local GC thresholds for testing. */
  _setLocalGcThresholdsForTest(opts: {
    backstopThresholdBytes?: number
    minCompactFileBytes?: number
  }): void {
    if (opts.backstopThresholdBytes !== undefined) {
      this.backstopThresholdBytes = opts.backstopThresholdBytes
    }
    if (opts.minCompactFileBytes !== undefined) {
      this.minCompactFileBytes = opts.minCompactFileBytes
    }
  }

  resetSessionFile(): void {
    this.setSessionFile(null)
    this.pendingEntries = []
    this.bytesSinceCompact = 0
    this.backstopThresholdBytes = TRANSCRIPT_COMPACT_BACKSTOP_BYTES
  }

  /**
   * densable `setSessionFile` — update pointer; remap writer-health keys for
   * the old path (densable wZd).
   */
  setSessionFile(path: string | null): void {
    remapTranscriptWriterPaths(this.sessionFile, path)
    this.sessionFile = path
  }

  /** densable leftover `wno`. */
  isTranscriptRelocationInProgress(): boolean {
    return this.relocationBuffer !== null
  }

  /** densable kkn — open KC park. Not folded into beginTranscriptRelocation. */
  openAppendRelocationBracket(path: string): void {
    this.relocationParkedAppends ??= []
    this.relocationParkedPath = path
  }

  /** densable closeAppendRelocationBracket — return parked, dest is Skn's. */
  closeAppendRelocationBracket(): LeftoverParkedAppend[] | null {
    const parked = this.relocationParkedAppends
    this.relocationParkedAppends = null
    this.relocationParkedPath = null
    return parked
  }

  leftoverRelocationPark(): {
    appends: LeftoverParkedAppend[] | null
    path: string | null
  } {
    return {
      appends: this.relocationParkedAppends,
      path: this.relocationParkedPath,
    }
  }

  /** densable `sealTornTailOnNextAppend` — pin the path leftoverPye prefixes. */
  sealTornTailOnNextAppend(path: string): void {
    this.tornTailToSeal = path
  }

  /**
   * densable `sealTornTailSync` — O_WRONLY|O_APPEND write `\n` when size>0, then
   * clear the slot. Skip when the slot is a different path or persistence is
   * suppressed (`$a`).
   */
  sealTornTailSync(path: string): void {
    if (this.tornTailToSeal !== path) return
    if (isPersistenceSuppressed() || isDisklessActive()) return
    let fd: number
    try {
      fd = openSync(path, fsConstants.O_WRONLY | fsConstants.O_APPEND)
    } catch {
      return
    }
    try {
      const { size } = fstatSync(fd)
      if (size > 0) writeSync(fd, '\n')
    } finally {
      closeSync(fd)
    }
    this.tornTailToSeal = null
  }

  tornTailSealPending(path: string): boolean {
    return this.tornTailToSeal === path
  }

  tornTailSealLanded(path: string): void {
    if (this.tornTailToSeal === path) this.tornTailToSeal = null
  }

  /** densable `beginTranscriptRelocation` — buffer only. */
  beginTranscriptRelocation(): void {
    this.relocationBuffer ??= []
  }

  /** densable `endTranscriptRelocation` — flush `relocationBuffer` only. */
  async endTranscriptRelocation(): Promise<void> {
    const buffered = this.relocationBuffer
    this.relocationBuffer = null
    if (!buffered) return
    for (const { entry, sessionId } of buffered) {
      await this.appendEntry(entry, sessionId)
    }
  }

  /**
   * Re-append cached session metadata to the end of the transcript file.
   * This ensures metadata stays within the tail window that readLiteMetadata
   * reads during progressive loading.
   *
   * Called from two contexts with different file-ordering implications:
   * - During compaction (compact.ts, reactiveCompact.ts): writes metadata
   *   just before the boundary marker is emitted - these entries end up
   *   before the boundary and are recovered by scanPreBoundaryMetadata.
   * - On session exit (cleanup handler): writes metadata at EOF after all
   *   boundaries - this is what enables loadTranscriptFile's pre-compact
   *   skip to find metadata without a forward scan.
   *
   * External-writer safety for SDK-mutable fields (custom-title, tag):
   * before re-appending, refresh the cache from the tail scan window. If an
   * external process (SDK renameSession/tagSession) wrote a fresher value,
   * our stale cache absorbs it and the re-append below persists it — not
   * the stale CLI value. If no entry is in the tail (evicted, or never
   * written by the SDK), the cache is the only source of truth and is
   * re-appended as-is.
   *
   * Re-append is unconditional (even when the value is already in the
   * tail): during compaction, a title 40KB from EOF is inside the current
   * tail window but will fall out once the post-compaction session grows.
   * Skipping the re-append would defeat the purpose of this call. Fields
   * the SDK cannot touch (last-prompt, agent-*, mode, pr-link) have no
   * external-writer concern — their caches are authoritative.
   */
  reAppendSessionMetadata(
    skipTitleRefresh = false,
    onlyIntoExisting = false,
  ): void {
    if (!this.sessionFile) return
    const sessionId = getSessionId() as UUID
    if (!sessionId) return

    // One sync tail read to refresh SDK-mutable fields. Same
    // LITE_READ_BUF_SIZE window readLiteMetadata uses. Empty string on
    // failure → extract returns null → cache is the only source of truth.
    const tail = readFileTailSync(this.sessionFile)

    // Absorb any fresher SDK-written title/tag into our cache. If the SDK
    // wrote while we had the session open, our cache is stale — the tail
    // value is authoritative. If the tail has nothing (evicted or never
    // written externally), the cache stands.
    //
    // Filter with startsWith to match only top-level JSONL entries (col 0)
    // and not "type":"tag" appearing inside a nested tool_use input that
    // happens to be JSON-serialized into a message.
    const tailLines = tail.split('\n')
    if (!skipTitleRefresh) {
      const titleLine = tailLines.findLast(l =>
        l.startsWith('{"type":"custom-title"'),
      )
      if (titleLine) {
        const tailTitle = extractLastJsonStringField(titleLine, 'customTitle')
        // `!== undefined` distinguishes no-match from empty-string match.
        // renameSession rejects empty titles, but the CLI is defensive: an
        // external writer with customTitle:"" should clear the cache so the
        // re-append below skips it (instead of resurrecting a stale title).
        if (tailTitle !== undefined) {
          this.currentSessionTitle = tailTitle || undefined
          notifySessionTitleChanged()
        }
      }
    }
    const tagLine = tailLines.findLast(l => l.startsWith('{"type":"tag"'))
    if (tagLine) {
      const tailTag = extractLastJsonStringField(tagLine, 'tag')
      // Same: tagSession(id, null) writes `tag:""` to clear.
      if (tailTag !== undefined) {
        this.currentSessionTag = tailTag || undefined
      }
    }
    // densable planReAppend: cHt(e,"relocated","relocatedCwd") → ??=
    const relocatedFromTail = extractTypedJsonlField(
      tail,
      'relocated',
      'relocatedCwd',
    )
    if (relocatedFromTail) {
      this.currentSessionRelocatedCwd ??= relocatedFromTail
    }

    const entries: Array<Record<string, unknown>> = []

    // lastPrompt is re-appended so readLiteMetadata can show what the
    // user was most recently doing. Written first so customTitle/tag/etc
    // land closer to EOF (they're the more critical fields for tail reads).
    if (this.currentSessionLastPrompt) {
      entries.push({
        type: 'last-prompt',
        lastPrompt: this.currentSessionLastPrompt,
        sessionId,
      })
    }
    // Unconditional: cache was refreshed from tail above; re-append keeps
    // the entry at EOF so compaction-pushed content doesn't evict it.
    if (this.currentSessionTitle) {
      entries.push({
        type: 'custom-title',
        customTitle: this.currentSessionTitle,
        sessionId,
      })
    }
    if (this.currentSessionTag) {
      entries.push({
        type: 'tag',
        tag: this.currentSessionTag,
        sessionId,
      })
    }
    // densable 2.1.223 #8 — keep relocated stamp in tail window after compaction
    // so resume lite reads still see the post-/cd cwd (SEA: e !== "").
    if (this.currentSessionRelocatedCwd && this.sessionFile !== '') {
      entries.push({
        type: 'relocated',
        relocatedCwd: this.currentSessionRelocatedCwd,
        sessionId,
      })
    }
    if (this.currentSessionAgentName) {
      entries.push({
        type: 'agent-name',
        agentName: this.currentSessionAgentName,
        sessionId,
      })
    }
    if (this.currentSessionAgentColor) {
      entries.push({
        type: 'agent-color',
        agentColor: this.currentSessionAgentColor,
        sessionId,
      })
    }
    if (this.currentSessionAgentSetting) {
      entries.push({
        type: 'agent-setting',
        agentSetting: this.currentSessionAgentSetting,
        sessionId,
      })
    }
    if (this.currentSessionMode) {
      entries.push({
        type: 'mode',
        mode: this.currentSessionMode,
        sessionId,
      })
    }
    if (this.currentSessionPermissionMode) {
      entries.push({
        type: 'permission-mode',
        permissionMode: this.currentSessionPermissionMode,
        sessionId,
      })
    }
    if (this.currentSessionCodeMode !== undefined) {
      entries.push({
        type: 'repl-mode',
        replMode: this.currentSessionCodeMode,
        sessionId,
      } as unknown as Entry)
    }
    if (this.currentSessionModel) {
      entries.push({
        type: 'session-model',
        model: this.currentSessionModel,
        sessionId,
      })
    }
    if (this.currentSessionWorktree !== undefined) {
      entries.push({
        type: 'worktree-state',
        worktreeSession: this.currentSessionWorktree,
        sessionId,
      })
    }
    if (this.currentSessionDevModsFolder) {
      entries.push({
        type: 'dev-mods',
        folder: this.currentSessionDevModsFolder,
        sessionId,
      })
    }
    if (
      this.currentSessionPrNumber !== undefined &&
      this.currentSessionPrUrl &&
      this.currentSessionPrRepository
    ) {
      entries.push({
        type: 'pr-link',
        sessionId,
        prNumber: this.currentSessionPrNumber,
        prUrl: this.currentSessionPrUrl,
        prRepository: this.currentSessionPrRepository,
        timestamp: new Date().toISOString(),
      })
    }
    if (this.currentSessionHistorySuppressed) {
      entries.push({
        type: 'history-suppression',
        sessionId,
        cause: 'migration',
        ts: new Date().toISOString(),
      })
    }
    // densable: re-append live bridge-session so compaction doesn't drop it.
    // Tombstones (empty id) are not re-appended — clearBridgeSession already
    // wrote the empty marker and cleared cache.
    if (this.currentSessionBridgeId) {
      entries.push({
        type: 'bridge-session',
        sessionId,
        bridgeSessionId: this.currentSessionBridgeId,
        lastSequenceNum: this.currentSessionBridgeSeq ?? 0,
        ...(this.currentSessionBridgeDialogKinds?.length
          ? { declaredDialogKinds: this.currentSessionBridgeDialogKinds }
          : {}),
        ...(this.currentSessionBridgeGroupingId
          ? { sessionGroupingId: this.currentSessionBridgeGroupingId }
          : {}),
        ...(this.currentSessionBridgeNoBackfill
          ? { noHistoryBackfill: true }
          : {}),
        ...(this.currentSessionBridgeOwnerAccountUuid
          ? { ownerAccountUuid: this.currentSessionBridgeOwnerAccountUuid }
          : {}),
        ...(this.currentSessionBridgeOwnerOrganizationUuid
          ? {
              ownerOrganizationUuid:
                this.currentSessionBridgeOwnerOrganizationUuid,
            }
          : {}),
      })
    }

    if (entries.length > 0) {
      this.sealTornTailSync(this.sessionFile)
      for (const entry of entries) {
        if (onlyIntoExisting) {
          appendEntryToExistingFileSync(this.sessionFile, entry)
        } else {
          appendEntryToFile(this.sessionFile, entry)
        }
      }
    }
  }

  hasPendingWritesForFile(filePath: string): boolean {
    const queue = this.writeQueues.get(filePath)
    return (
      (queue !== undefined && queue.length > 0) ||
      this.pendingEntries.length > 0 ||
      this.activeDrain !== null ||
      this.pendingWriteCount > 0
    )
  }

  async flush(): Promise<void> {
    // SDK/print result can race the first user/assistant write. If the
    // session pointer is still null, drain pendingEntries to disk so
    // get_session_info can find a JSONL with an extractable summary.
    if (this.sessionFile === null && this.pendingEntries.length > 0) {
      await this.materializeSessionFile()
    }
    // Cancel pending timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    // Wait for any in-flight drain to finish
    if (this.activeDrain) {
      await this.activeDrain
    }
    // Drain anything remaining in the queues
    await this.drainWriteQueue()

    // Wait for non-queue tracked operations (e.g. removeMessageByUuid)
    while (this.pendingWriteCount > 0) {
      await new Promise<void>(resolve => {
        this.flushResolvers.push(resolve)
      })
      await this.drainWriteQueue()
    }
    const { leftoverAppendSerial } = this.hostState
    await leftoverAppendSerial.settle()
  }

  /**
   * Remove a message from the transcript by UUID.
   * Used for tombstoning orphaned messages from failed streaming attempts.
   *
   * The target is almost always the most recently appended entry, so we
   * read only the tail, locate the line, and splice it out with a
   * positional write + truncate instead of rewriting the whole file.
   */
  async removeMessageByUuid(targetUuid: UUID): Promise<void> {
    return this.trackWrite(async () => {
      if (this.sessionFile === null || isDisklessActive()) return
      try {
        let fileSize = 0
        const fh = await fsOpen(this.sessionFile, 'r+')
        try {
          const { size } = await fh.stat()
          fileSize = size
          if (size === 0) return

          const chunkLen = Math.min(size, LITE_READ_BUF_SIZE)
          const tailStart = size - chunkLen
          const buf = Buffer.allocUnsafe(chunkLen)
          // Official 2.1.323 #2064 (`qma`): loop over short reads (NFS/FUSE) so
          // a partial read never truncates the tail of the session file.
          const readOk = await readExactFromHandle(fh, buf, chunkLen, tailStart)
          if (!readOk) {
            logForDebugging(
              'Skipping tombstone removal: the session file ended before its reported size, so it was left unchanged',
              { level: 'warn' },
            )
            return
          }
          const tail = buf

          // Entries are serialized via JSON.stringify (no key-value
          // whitespace). Search for the full `"uuid":"..."` pattern, not
          // just the bare UUID, so we do not match the same value sitting
          // in `parentUuid` of a child entry. UUIDs are pure ASCII so a
          // byte-level search is correct.
          const needle = `"uuid":"${targetUuid}"`
          const matchIdx = tail.lastIndexOf(needle)

          if (matchIdx >= 0) {
            // 0x0a never appears inside a UTF-8 multi-byte sequence, so
            // byte-scanning for line boundaries is safe even if the chunk
            // starts mid-character.
            const prevNl = tail.lastIndexOf(0x0a, matchIdx)
            // If the preceding newline is outside our chunk and we did not
            // read from the start of the file, the line is longer than the
            // window - fall through to the slow path.
            if (prevNl >= 0 || tailStart === 0) {
              const lineStart = prevNl + 1 // 0 when prevNl === -1
              const nextNl = tail.indexOf(0x0a, matchIdx + needle.length)
              const lineEnd = nextNl >= 0 ? nextNl + 1 : chunkLen

              const absLineStart = tailStart + lineStart
              const afterLen = chunkLen - lineEnd
              // Truncate first, then re-append the trailing lines using
              // exact write loop (`sGs`) so short writes on NFS/FUSE never
              // drop trailing messages.
              await fh.truncate(absLineStart)
              if (afterLen > 0) {
                await writeExactToHandle(
                  fh,
                  tail.subarray(lineEnd, chunkLen),
                  absLineStart,
                )
              }
              return
            }
          }
        } finally {
          await fh.close()
        }

        // Slow path: target was not in the last 64KB. Rare - requires many
        // large entries to have landed between the write and the tombstone.
        if (fileSize > MAX_TOMBSTONE_REWRITE_BYTES) {
          logForDebugging(
            `Skipping tombstone removal: session file too large (${formatFileSize(fileSize)})`,
            { level: 'warn' },
          )
          return
        }
        const content = await readFile(this.sessionFile, { encoding: 'utf-8' })
        const rawLines = content.split('\n')
        const lines = rawLines.filter((line: string) => {
          if (!line.trim()) return true
          try {
            const entry = jsonParse(line)
            return entry.uuid !== targetUuid
          } catch {
            return true // Keep malformed lines
          }
        })
        if (lines.length === rawLines.length) return
        // Official 2.1.323 #2064 (`W4t` + `m3e`): atomic durable rewrite so
        // NFS/FUSE crashes never truncate the saved session on slow path.
        await writeFileAtomicDurably(this.sessionFile, lines.join('\n'), 0o600)
      } catch {
        // Silently ignore errors - the file might not exist yet
      }
    })
  }

  /**
   * True when densable Gsn (test_env | explicit_disable | skip_prompt_history |
   * nested_marker) should suppress all transcript writes. Shared guard for
   * appendEntry and materializeSessionFile so both skip consistently. The env
   * var is set by tmuxSocket.ts so Tungsten-spawned test sessions don't pollute
   * the user's --resume list. cleanupPeriodDays is retention, not a write skip.
   */
  private shouldSkipPersistence(): boolean {
    // densable 2.1.283 wZt/Gsn @ 186828148 — same four causes as
    // getPersistenceSuppressCause. cleanupPeriodDays is retention only.
    return getPersistenceSuppressCause() !== null
  }

  /**
   * Create the session file, write cached startup metadata, and flush
   * buffered entries. Called on the first user/assistant message.
   */
  private async materializeSessionFile(): Promise<void> {
    // Guard here too — reAppendSessionMetadata writes via appendEntryToFile
    // (not appendEntry) so it would bypass the per-entry persistence check
    // and create a metadata-only file despite --no-session-persistence.
    if (this.shouldSkipPersistence()) return
    this.ensureCurrentSessionFile()
    // mode/agentSetting are cache-only pre-materialization; write them now.
    this.reAppendSessionMetadata()
    if (this.pendingEntries.length > 0) {
      const buffered = this.pendingEntries
      this.pendingEntries = []
      for (const entry of buffered) {
        await this.appendEntry(entry)
      }
    }
  }

  async insertMessageChain(
    messages: Transcript,
    isSidechain: boolean = false,
    agentId?: string,
    startingParentUuid?: UUID | null,
    teamInfo?: { teamName?: string; agentName?: string },
  ) {
    return this.trackWrite(async () => {
      let parentUuid: UUID | null = startingParentUuid ?? null

      // First user/assistant message materializes the session file.
      // Hook progress/attachment messages alone stay buffered.
      if (
        this.sessionFile === null &&
        messages.some(m => m.type === 'user' || m.type === 'assistant')
      ) {
        await this.materializeSessionFile()
      }

      // Get current git branch once for this message chain
      let gitBranch: string | undefined
      try {
        gitBranch = await getBranch()
      } catch {
        // Not in a git repo or git command failed
        gitBranch = undefined
      }

      // Get slug if one exists for this session (used for plan files, etc.)
      const sessionId = getSessionId()
      const slug = getPlanSlugCache().get(sessionId)
      // Official 2.1.328 (`chunk@294254613.js @553400`): load existing UUID set
      // so sourceToolAssistantUUID overrides never create phantom parent links.
      const seenUuids =
        isSidechain || this.shouldSkipPersistence()
          ? null
          : await getSessionMessages(sessionId as UUID)

      for (const message of messages) {
        const isCompactBoundary = isCompactBoundaryMessage(message)

        // For tool_result messages, use the assistant message UUID from the message
        // if available (set at creation time) AND present in seenUuids, otherwise
        // fall back to sequential parent (official `tengu_phantom_parent_write`).
        let effectiveParentUuid = parentUuid
        if (
          message.type === 'user' &&
          'sourceToolAssistantUUID' in message &&
          message.sourceToolAssistantUUID
        ) {
          const candidateParent = message.sourceToolAssistantUUID as UUID
          if (seenUuids === null || seenUuids.has(candidateParent)) {
            effectiveParentUuid = candidateParent
          } else {
            logEvent('tengu_phantom_parent_write', {})
          }
        }
        if (effectiveParentUuid === message.uuid) {
          logEvent('tengu_chain_self_reference_write', {})
          effectiveParentUuid =
            parentUuid !== null && parentUuid !== message.uuid
              ? parentUuid
              : null
        }

        const transcriptMessage: TranscriptMessage = {
          parentUuid: isCompactBoundary ? null : effectiveParentUuid,
          logicalParentUuid: isCompactBoundary ? parentUuid : undefined,
          isSidechain,
          teamName: teamInfo?.teamName,
          agentName: teamInfo?.agentName,
          promptId:
            message.type === 'user' ? (getPromptId() ?? undefined) : undefined,
          agentId,
          ...message,
          // Session-stamp fields MUST come after the spread. On --fork-session
          // and --resume, messages arrive as SerializedMessage (carries source
          // sessionId/cwd/etc. because removeExtraFields only strips parentUuid
          // and isSidechain). If sessionId isn't re-stamped, FRESH.jsonl ends up
          // with messages stamped sessionId=A but content-replacement entries
          // stamped sessionId=FRESH (from insertContentReplacement), and
          // loadFullLog's sessionId-keyed contentReplacements lookup misses →
          // replacement records lost → FROZEN misclassification.
          userType: getUserType(),
          entrypoint: getEntrypoint(),
          sessionKind: process.env.CLAUDE_CODE_SESSION_KIND || 'interactive',
          cwd: getCwd(),
          sessionId,
          timestamp: new Date().toISOString(),
          version: VERSION,
          gitBranch,
          slug,
        }
        // Official 2.1.328 (`oln`, `chunk@294254613.js @554825, @6056810`):
        // null out oversized `originalFile` strings on write to cap JSONL bloat.
        if (
          transcriptMessage.type === 'user' &&
          transcriptMessage.toolUseResult != null
        ) {
          transcriptMessage.toolUseResult = capOriginalFileForStorage(
            transcriptMessage.toolUseResult,
          )
        }
        await this.appendEntry(transcriptMessage)
        if (isChainParticipant(message)) {
          parentUuid = message.uuid
        }
      }

      // Cache this turn's user prompt for reAppendSessionMetadata —
      // the --resume picker shows what the user was last doing.
      // Overwritten every turn by design.
      if (!isSidechain) {
        const text = getFirstMeaningfulUserMessageTextContent(messages)
        if (text) {
          const flat = text.replace(/\n/g, ' ').trim()
          this.currentSessionLastPrompt =
            flat.length > 200 ? flat.slice(0, 200).trim() + '…' : flat
        }
      }
    })
  }

  async insertFileHistorySnapshot(
    messageId: UUID,
    snapshot: FileHistorySnapshot,
    isSnapshotUpdate: boolean,
  ) {
    return this.trackWrite(async () => {
      const fileHistoryMessage: FileHistorySnapshotMessage = {
        type: 'file-history-snapshot',
        messageId,
        snapshot,
        isSnapshotUpdate,
      }
      await this.appendEntry(fileHistoryMessage)
    })
  }

  async insertQueueOperation(queueOp: QueueOperationMessage) {
    return this.trackWrite(async () => {
      await this.appendEntry(queueOp)
    })
  }

  async insertAttributionSnapshot(snapshot: AttributionSnapshotMessage) {
    return this.trackWrite(async () => {
      await this.appendEntry(snapshot)
    })
  }

  async insertContentReplacement(
    replacements: ContentReplacementRecord[],
    agentId?: AgentId,
  ) {
    return this.trackWrite(async () => {
      const entry: ContentReplacementEntry = {
        type: 'content-replacement',
        sessionId: getSessionId() as UUID,
        agentId,
        replacements,
      }
      await this.appendEntry(entry)
    })
  }

  async appendEntry(entry: Entry, sessionId: UUID = getSessionId() as UUID) {
    refreshHostStorageSessionRef(this.hostState)
    if (this.shouldSkipPersistence()) {
      return
    }

    // densable: during tNt rehome, buffer until endTranscriptRelocation.
    if (this.relocationBuffer) {
      this.relocationBuffer.push({ entry, sessionId })
      return
    }

    const currentSessionId = getSessionId() as UUID
    const isCurrentSession = sessionId === currentSessionId

    let sessionFile: string
    if (isCurrentSession) {
      // Buffer until materializeSessionFile runs (first user/assistant message).
      if (this.sessionFile === null) {
        this.pendingEntries.push(entry)
        return
      }
      sessionFile = this.sessionFile
    } else {
      const existing = await this.getExistingSessionFile(sessionId)
      if (!existing) {
        logError(
          new Error(
            `appendEntry: session file not found for other session ${sessionId}`,
          ),
        )
        return
      }
      sessionFile = existing
    }

    // Only load current session messages if needed
    if (entry.type === 'summary') {
      // Summaries can always be appended
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'custom-title') {
      // Custom titles can always be appended
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'ai-title') {
      // AI titles can always be appended
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'last-prompt') {
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'task-summary') {
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'ended-by-model') {
      // densable: ended-by-model always append (EndConversation marker)
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'tag') {
      // Tags can always be appended
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'agent-name') {
      // Agent names can always be appended
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'agent-color') {
      // Agent colors can always be appended
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'agent-setting') {
      // Agent settings can always be appended
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'pr-link') {
      // PR links can always be appended
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'file-history-snapshot') {
      // File history snapshots can always be appended
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'attribution-snapshot') {
      // Attribution snapshots can always be appended
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'speculation-accept') {
      // Speculation accept entries can always be appended
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'mode') {
      // Mode entries can always be appended
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'permission-mode') {
      // Official 2.1.328 (`chunk@294254613.js @491708`): permission-mode entries always append
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'session-model') {
      // Session model choice entries always append
      void this.enqueueWrite(sessionFile, entry)
    } else if ((entry as { type?: string }).type === 'repl-mode') {
      // Official 2.1.328: repl-mode entries can always be appended
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'worktree-state') {
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'dev-mods') {
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'bridge-session') {
      // densable Bkn/EGt — always append (last-wins; empty id = clear tombstone)
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'content-replacement') {
      // Content replacement records can always be appended. Subagent records
      // go to the sidechain file (for AgentTool resume); main-thread
      // records go to the session file (for /resume).
      const targetFile = entry.agentId
        ? getAgentTranscriptPath(entry.agentId)
        : sessionFile
      void this.enqueueWrite(targetFile, entry)
    } else if (entry.type === 'marble-origami-commit') {
      // Always append. Commit order matters for restore (later commits may
      // reference earlier commits' summary messages), so these must be
      // written in the order received and read back sequentially.
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'marble-origami-snapshot') {
      // Always append. Last-wins on restore — later entries supersede.
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'relocated') {
      // densable tNt stamp — always append (last-wins on resume scans)
      void this.enqueueWrite(sessionFile, entry)
    } else if (
      (entry as { type: string }).type === 'api-request-shape' ||
      (entry as { type: string }).type === 'api-request-blob' ||
      (entry as { type: string }).type === 'api-request'
    ) {
      // Official 2.1.300 (#816): route-by-agent for request replay entries.
      const replayEntry = entry as unknown as { agentId?: AgentId }
      const targetFile = replayEntry.agentId
        ? getAgentTranscriptPath(replayEntry.agentId)
        : sessionFile
      void this.enqueueWrite(targetFile, entry)
    } else if (entry.type === 'goal') {
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'goal-cleared') {
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'observer-ref') {
      // Official xZi — always append (last-wins on IZi scan).
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'artifact-autoreact-ledger') {
      // densable ykl — always append (autoreact ledger snapshot).
      void this.enqueueWrite(sessionFile, entry)
    } else {
      const messageSet = await getSessionMessages(sessionId)
      if (entry.type === 'queue-operation') {
        // Queue operations are always appended to the session file
        void this.enqueueWrite(sessionFile, entry)
      } else if (isTranscriptMessage(entry)) {
        // TranscriptMessage (user/assistant/attachment/system). Other
        // entry types were handled above; HistorySuppressionEntry is not.
        const isAgentSidechain =
          entry.isSidechain && entry.agentId !== undefined
        const targetFile = isAgentSidechain
          ? getAgentTranscriptPath(asAgentId(entry.agentId!))
          : sessionFile

        // For message entries, check if UUID already exists in current session.
        // Skip dedup for agent sidechain LOCAL writes — they go to a separate
        // file, and fork-inherited parent messages share UUIDs with the main
        // session transcript. Deduping against the main session's set would
        // drop them, leaving the persisted sidechain transcript incomplete
        // (resume-of-fork loads a 10KB file instead of the full 85KB inherited
        // context).
        //
        // The sidechain bypass applies ONLY to the local file write — remote
        // persistence (session-ingress) uses a single Last-Uuid chain per
        // sessionId, so re-POSTing a UUID it already has 409s and eventually
        // exhausts retries → gracefulShutdownSync(1). See inc-4718.
        const isNewUuid = !messageSet.has(entry.uuid)
        if (isAgentSidechain || isNewUuid) {
          // Official 2.1.328 (`slimAppendedRow`, `chunk@294254613.js @507332`):
          // when disk toolResult copies mode is 'slim', strip duplicated
          // toolUseResult payloads before enqueuing the local transcript write.
          let entryToWrite: TranscriptMessage = entry
          if (this.hostState.toolResultCopiesOnDiskState === 'slim') {
            this.appendToolUseWindow ??= new ToolUseNameWindow()
            entryToWrite = slimToolUseResultForResume(
              entry,
              this.appendToolUseWindow,
            )
          }
          // Enqueue write — appendToFile handles ENOENT by creating directories
          void this.enqueueWrite(targetFile, entryToWrite)

          if (!isAgentSidechain) {
            // messageSet is main-file-authoritative. Sidechain entries go to a
            // separate agent file — adding their UUIDs here causes recordTranscript
            // to skip them on the main thread (line ~1270), so the message is never
            // written to the main session file. The next main-thread message then
            // chains its parentUuid to a UUID that only exists in the agent file,
            // and --resume's buildConversationChain terminates at the dangling ref.
            // Same constraint for remote (inc-4718 above): sidechain persisting a
            // UUID the main thread hasn't written yet → 409 when main writes it.
            messageSet.add(entry.uuid)

            if (isTranscriptMessage(entry)) {
              await this.persistToRemote(sessionId, entry)
            }
          }
        }
      }
    }
  }

  async writeRequestReplayRecords(
    records: RequestReplayRecords,
  ): Promise<RequestReplayWriteResult> {
    return this.trackWrite(async () => {
      if (this.shouldSkipPersistence()) {
        return 'no_transcript'
      }
      if (this.oversizeReplayShapes.has(records.shapeHash)) {
        return 'shape_too_large'
      }
      const targetSessionId = records.target.sessionId as UUID
      const currentSessionId = getSessionId() as UUID
      const targetFile =
        targetSessionId === currentSessionId
          ? this.sessionFile
          : await this.getExistingSessionFile(targetSessionId)
      if (!targetFile) {
        return 'no_transcript'
      }

      let seen = this.replayHashes.get(targetFile)
      if (!seen) {
        seen = new Set<string>()
        this.replayHashes.set(targetFile, seen)
      }

      const entries: Array<
        ApiRequestShapeEntry | ApiRequestBlobEntry | ApiRequestEntry
      > = []
      if (!seen.has(records.shapeHash)) {
        const shapeEntry: ApiRequestShapeEntry = {
          type: 'api-request-shape',
          sessionId: records.request.sessionId,
          ...(records.request.agentId !== undefined && {
            agentId: records.request.agentId,
          }),
          shapeHash: records.shapeHash,
          timestamp: records.request.timestamp,
          version: records.request.version,
          shape: records.shape,
        }
        if (
          Buffer.byteLength(jsonStringify(shapeEntry)) > MAX_REPLAY_SHAPE_BYTES
        ) {
          this.oversizeReplayShapes.add(records.shapeHash)
          logError(
            new Error(
              'request-replay: system+tools over the record size cap; not recording requests that use them',
            ),
          )
          return 'shape_too_large'
        }
        entries.push(shapeEntry)
        seen.add(records.shapeHash)
      }

      for (const { hash, message } of records.blobCandidates) {
        if (!seen.has(hash)) {
          const blobEntry: ApiRequestBlobEntry = {
            type: 'api-request-blob',
            sessionId: records.request.sessionId,
            ...(records.request.agentId !== undefined && {
              agentId: records.request.agentId,
            }),
            hash,
            message,
          }
          entries.push(blobEntry)
          seen.add(hash)
        }
      }

      entries.push(records.request)
      await Promise.all(
        entries.map(entry =>
          this.appendEntry(entry as unknown as Entry, targetSessionId),
        ),
      )
      return 'written'
    })
  }

  /**
   * Loads the sessionFile variable.
   * Do not need to create session files until they are written to.
   */
  private ensureCurrentSessionFile(): string {
    if (this.sessionFile === null) {
      const path = getTranscriptPath()
      this.setSessionFile(path)
      // Official 2.1.323 #1992: pin sessionProjectDir when materializing so
      // subagent transcripts and large tool results stay alongside this
      // transcript even after entering a WorktreeCreate-hook or nested-repo
      // worktree.
      if (getSessionProjectDir() === null) {
        switchSession(asSessionId(getSessionId()), dirname(path))
      }
    }

    return this.sessionFile!
  }

  /**
   * Returns the session file path if it exists, null otherwise.
   * Used for writing to sessions other than the current one.
   * Caches positive results so we only stat once per session.
   *
   * The cache is bounded at MAX_CACHED_SESSION_FILES to prevent unbounded
   * growth in long-running daemon / swarm sessions that spawn many agents.
   */
  private existingSessionFiles = new Map<string, string>()
  private async getExistingSessionFile(
    sessionId: UUID,
  ): Promise<string | null> {
    if (isDisklessActive()) return null
    const cached = this.existingSessionFiles.get(sessionId)
    if (cached) return cached

    const targetFile = getTranscriptPathForSession(sessionId)
    try {
      await stat(targetFile)
      // Evict oldest entry when at capacity so the Map stays bounded
      if (this.existingSessionFiles.size >= MAX_CACHED_SESSION_FILES) {
        const oldestKey = this.existingSessionFiles.keys().next().value
        if (oldestKey !== undefined) {
          this.existingSessionFiles.delete(oldestKey)
        }
      }
      this.existingSessionFiles.set(sessionId, targetFile)
      return targetFile
    } catch (e) {
      if (isFsInaccessible(e)) return null
      throw e
    }
  }

  private async persistToRemote(sessionId: UUID, entry: TranscriptMessage) {
    // densable nE(): during shutdown skip remote persist unless a CCR writer
    // is still registered (writer drains final turns). Local isShuttingDown
    // alone matches the common case; writer path still runs when set.
    if (isShuttingDown() && !this.internalEventWriter) {
      return
    }

    // densable 2.1.225 #7 — oHr(t)&&jCt(): do not re-upload compact_boundary /
    // isCompactSummary pairs when the remote session was minted without
    // history backfill (reattach-gone → fresh cse_*). Re-uploading the pair
    // after a local compact left remote history inconsistent on RC resume.
    if (isCompactPairEntry(entry) && isCompactPairWithheldFromRemote()) {
      logForDebugging(
        '[persist-remote] Skipping compact-pair upload: session carries history-backfill suppression',
      )
      return
    }

    // CCR v2 path: write as internal worker event
    if (this.internalEventWriter) {
      try {
        const isBoundary = isCompactBoundaryMessage(entry)
        const preservedRaw =
          isBoundary && entry.compactMetadata
            ? (
                entry.compactMetadata as {
                  preservedMessages?: { uuids?: string[] }
                }
              ).preservedMessages?.uuids
            : undefined
        await this.internalEventWriter(
          'transcript',
          entry as unknown as Record<string, unknown>,
          {
            ...(isBoundary && {
              isCompaction: true,
              ...(Array.isArray(preservedRaw) && preservedRaw.length > 0
                ? { preservedEventIds: preservedRaw }
                : {}),
            }),
            ...(entry.agentId && { agentId: entry.agentId }),
          },
        )
      } catch {
        logEvent('tengu_session_persistence_failed', {})
        logForDebugging('Failed to write transcript as internal event')
      }
      return
    }

    // v1 Session Ingress path
    if (
      !isEnvTruthy(process.env.ENABLE_SESSION_PERSISTENCE) ||
      !this.remoteIngressUrl
    ) {
      return
    }

    const success = await sessionIngress.appendSessionLog(
      sessionId,
      entry,
      this.remoteIngressUrl,
    )

    if (!success) {
      logEvent('tengu_session_persistence_failed', {})
      gracefulShutdownSync(1, 'other')
    }
  }

  setRemoteIngressUrl(url: string): void {
    this.remoteIngressUrl = url
    logForDebugging(`Remote persistence enabled with URL: ${url}`)
    if (url) {
      // If using CCR, don't delay messages by any more than 10ms.
      this.FLUSH_INTERVAL_MS = REMOTE_FLUSH_INTERVAL_MS
    }
  }

  setInternalEventWriter(writer: InternalEventWriter): void {
    this.internalEventWriter = writer
    logForDebugging(
      'CCR v2 internal event writer registered for transcript persistence',
    )
    // Use fast flush interval for CCR v2
    this.FLUSH_INTERVAL_MS = REMOTE_FLUSH_INTERVAL_MS
  }

  hasInternalEventWriter(): boolean {
    return this.internalEventWriter !== null
  }

  getInternalEventWriter(): InternalEventWriter | null {
    return this.internalEventWriter
  }

  clearInternalEventWriter(): void {
    if (!this.internalEventWriter) return
    this.internalEventWriter = null
    logForDebugging('CCR v2 internal event writer cleared')
  }

  setInternalEventReader(reader: InternalEventReader): void {
    this.internalEventReader = reader
    logForDebugging(
      'CCR v2 internal event reader registered for session resume',
    )
  }

  setInternalSubagentEventReader(reader: InternalEventReader): void {
    this.internalSubagentEventReader = reader
    logForDebugging(
      'CCR v2 subagent event reader registered for session resume',
    )
  }

  getInternalEventReader(): InternalEventReader | null {
    return this.internalEventReader
  }

  getInternalSubagentEventReader(): InternalEventReader | null {
    return this.internalSubagentEventReader
  }

  /**
   * densable setInternalAgentEventReader — pin the lazy agent-transcript
   * reader. Session CCR reader stays on setInternalEventReader.
   */
  setInternalAgentEventReader(reader: LeftoverInternalAgentEventReader): void {
    this.internalAgentEventReader = reader
  }

  /** densable hasInternalAgentEventReader — `this.internalAgentEventReader!==null`. */
  hasInternalAgentEventReader(): boolean {
    return this.internalAgentEventReader !== null
  }
}

/**
 * densable $xr — O_RDWR|O_APPEND hover-rest onlyIfExists. Never export minify `$xr`.
 */
async function leftoverXr(
  filePath: string,
  line: string,
  torn?: string,
): Promise<false | true | 'torn'> {
  if (isDisklessActive()) {
    logDisklessWriteSkipped('sessionStorage:leftoverXr', filePath)
    return false
  }
  let handle: Awaited<ReturnType<typeof fsOpen>> | undefined
  try {
    handle = await fsOpen(filePath, fsConstants.O_RDWR | fsConstants.O_APPEND)
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined
    if (code === 'ENOENT' || code === 'ENOTDIR') return false
    throw error
  }
  if (handle === undefined) return false
  try {
    const { size } = await handle.stat()
    if (size === 0) return false
    const buf = Buffer.alloc(1)
    const { bytesRead } = await handle.read(buf, 0, 1, size - 1)
    const newline = bytesRead === 1 && buf[0] === 10
    const payload = Buffer.from(newline ? line : `\n${torn ?? line}`, 'utf8')
    let offset: number | undefined
    let written = 0
    while (written < payload.length) {
      const { bytesWritten } = await handle.write(
        payload,
        written,
        payload.length - written,
        offset,
      )
      if (bytesWritten <= 0) {
        throw new Error('appendToExistingTranscript: short write')
      }
      written += bytesWritten
      if (offset !== undefined) offset += bytesWritten
    }
    return newline ? true : 'torn'
  } finally {
    await handle?.close()
  }
}

/**
 * densable Dxr — split payload on `\n` into one `{data}` record per line
 * (newline kept on the slice). Never export minify `Dxr`.
 */
function leftoverDxr(payload: string): Array<{ data: string }> {
  const records: Array<{ data: string }> = []
  let cursor = 0
  while (cursor < payload.length) {
    const nl = payload.indexOf('\n', cursor)
    const end = nl === -1 ? payload.length : nl + 1
    records.push({ data: payload.slice(cursor, end) })
    cursor = end
  }
  return records
}

/**
 * densable pye — tornTailSeal, hover-rest, $xr, mkdir 0o700 retry.
 * Never export minify `pye`.
 */
async function leftoverPye(
  filePath: string,
  line: string,
  storageV5: unknown,
  onlyIfExists?: boolean,
  torn?: string,
): Promise<'skipped' | 'direct' | 'direct-torn' | 'backend' | 'backend-torn'> {
  const project = getProject()
  const seal =
    onlyIfExists !== true && project.tornTailSealPending(filePath) === true
  let payload = seal ? `\n${line}` : line
  let tornWrite = false
  const effectiveStorageV5 = storageV5 ?? getPinnedStorageV5()
  const bind =
    effectiveStorageV5 !== undefined
      ? resolveMainSessionTranscriptKey(filePath, effectiveStorageV5)
      : undefined
  const backend = bind?.backend as LeftoverStorageV5Append | undefined
  if (
    effectiveStorageV5 !== undefined &&
    bind !== undefined &&
    backend !== undefined &&
    typeof backend.append === 'function'
  ) {
    if (onlyIfExists === true && backend.stat !== undefined) {
      const st = await backend.stat(bind.key)
      if (!st.ok) {
        if (st.error?.code === 'NotFound') return 'skipped'
        throw Object.assign(
          new Error('onlyIfExists stat failed — append withheld'),
          { cause: st.error },
        )
      }
      if ((st.value?.storedBytes ?? st.value?.size) === 0) return 'skipped'
      if ((st.value?.tornTailBytes ?? 0) > 0) {
        payload = `\n${torn ?? payload}`
        tornWrite = true
      }
    }
    const written = await backend.append(bind.key, leftoverDxr(payload), {
      ...(onlyIfExists === true ? { precondition: { type: 'ifExists' } } : {}),
    })
    if (!written.ok) {
      if (
        onlyIfExists === true &&
        (written.error?.code === 'NotFound' ||
          written.error?.code === 'PreconditionFailed')
      ) {
        return 'skipped'
      }
      throw Object.assign(new Error('storageV5 append failed'), {
        code: written.error?.code,
      })
    }
    if (seal) project.tornTailSealLanded(filePath)
    return tornWrite ? 'backend-torn' : 'backend'
  }
  if (isDisklessActive()) {
    logDisklessWriteSkipped('sessionStorage:leftoverPye', filePath)
    return 'skipped'
  }
  if (onlyIfExists === true) {
    const result = await leftoverXr(filePath, payload, torn)
    if (result === false) return 'skipped'
    return result === 'torn' ? 'direct-torn' : 'direct'
  }
  try {
    await fsAppendFile(filePath, payload, { mode: 0o600 })
  } catch {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
    await fsAppendFile(filePath, payload, { mode: 0o600 })
  }
  if (seal) project.tornTailSealLanded(filePath)
  return 'direct'
}

/** densable Skn — dest is the replay path. Never export minify `Skn`. */
export function leftoverSkn(dest: string): void {
  const parked = getProject().closeAppendRelocationBracket()
  if (!parked) return
  for (const { entry, storageV5, opts, resolve, reject } of parked) {
    leftoverAppendEntryToFileAsync(dest, entry, storageV5, opts).then(
      resolve,
      reject,
    )
  }
}

/** densable WDr — pin tornTailToSeal for the next pye. Never export minify `WDr`. */
export function leftoverWdr(path?: string): void {
  const project = getProject()
  const dest = path ?? project.sessionFile ?? getTranscriptPath()
  if (!dest) return
  project.sealTornTailOnNextAppend(dest)
}

/**
 * densable KC — `$a()` skip, relocation park, pye(path, line, storageV5), fireMirror.
 * Never export minify `KC`.
 */
export function leftoverAppendEntryToFileAsync(
  filePath: string,
  entry: Entry,
  storageV5?: unknown,
  opts?: { tornTailEntry?: Entry; onlyIfExists?: boolean },
): Promise<void> {
  if (isPersistenceSuppressed()) return Promise.resolve()
  const project = getProject()
  const park = project.leftoverRelocationPark()
  if (park.appends !== null && filePath === park.path) {
    return new Promise((resolvePark, rejectPark) => {
      park.appends!.push({
        entry,
        storageV5,
        opts,
        resolve: resolvePark,
        reject: rejectPark,
      })
    })
  }
  const line = jsonStringify(entry) + '\n'
  const torn =
    opts?.tornTailEntry !== undefined
      ? jsonStringify(opts.tornTailEntry) + '\n'
      : undefined
  // densable KC does not call WDr; leftoverPye reads tornTailSealPending.
  const { leftoverAppendSerial } = getHostSessionStorageState()
  const job = leftoverAppendSerial.run(filePath, async () => {
    const result = await leftoverPye(
      filePath,
      line,
      storageV5,
      opts?.onlyIfExists,
      torn,
    )
    if (result !== 'skipped') {
      const mirrored =
        (result === 'direct-torn' || result === 'backend-torn') &&
        opts?.tornTailEntry !== undefined
          ? opts.tornTailEntry
          : entry
      project.fireMirror(filePath, [mirrored])
    }
  })
  return job.catch((error: unknown) => {
    logForDebugging(
      `appendEntryToFileAsync: append to ${filePath} failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
    throw error
  })
}

registerTornTailHook({
  getCurrentSessionFile: () => getProject().sessionFile,
  markTornTail: filePath => leftoverWdr(filePath),
})
