import type { Entry } from '../../types/logs.js'
import { logForDebugging } from '../debug.js'
import { isDisklessActive } from '../disklessGuards.js'
import { isEnvTruthy } from '../envUtils.js'
import {
  RootSessionSlot,
  getActiveSubconversationFromAls,
  getBootstrapSession,
  getBootstrapSessionHost,
  hasActiveSessionAls,
  isSharedBackend,
  runWithSession,
} from '../sessionHost.js'
import { getPersistenceSuppressCause } from '../sessionPersistenceStatus.js'
import { type Session, getSessionOnceLatches } from '../sessionRoot.js'
import {
  type TranscriptWriteSource,
  recordTranscriptWriteFailure,
} from '../transcriptWriterHealth.js'
import type { UUID } from 'crypto'
import { constants as fsConstants } from 'fs'
import { open as fsOpen, statfs as fsStatfs, mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'
import { logEvent } from 'src/services/analytics/index.js'
import {
  FULL_DISK_ERRNO_CODES,
  type ForeignSessionBinding,
  LOW_YIELD_COMPACT_RATIO,
  MAX_NOT_CHAIN_PARENT_UUIDS,
  NFS_STATFS_TIMEOUT_MS,
  NFS_STATFS_UNSUPPORTED_CODES,
  NFS_SUPER_MAGIC,
  type SessionProjectHandle,
  type StatfsFn,
  type TranscriptFullDiskCode,
  type TranscriptFullDiskState,
} from './types.js'

export function isTranscriptPersistenceDisabled(): boolean {
  // densable 2.1.283 wZt/Gsn @ 186828148 — test_env | explicit_disable |
  // skip_prompt_history | nested_marker. cleanupPeriodDays is retention
  // only (gold schema: "Never … disables writes").
  return getPersistenceSuppressCause() !== null
}

export function getEntrypoint(): string | undefined {
  return process.env.CLAUDE_CODE_ENTRYPOINT
}

export type HostSessionStorageState = {
  hostRef?: WeakRef<object>
  sessionRef?: WeakRef<Session>
  lastKnownSessionId: UUID | undefined
  lastSkipPersistence: boolean | undefined
  cleanupUnregister: (() => void) | undefined
  project: SessionProjectHandle | null
  exitReStampRan: boolean
  exitFlushInFlight: Promise<void> | undefined
  exitDrains: Set<() => void | Promise<void>>
  liveBridgeSuppressionProbe: (() => boolean) | undefined
  liveForeignBindingProbe: (() => ForeignSessionBinding | undefined) | undefined
  leftoverAppendSerial: ReturnType<typeof leftoverSerialByPath>
  transcriptFullDiskState: TranscriptFullDiskState
  defaultNfsAppendFlusher: NfsAppendFlusher
  notChainParentUuids: Set<string>
  inFlightSidechainWrites: Map<string, Promise<void>>
  localGcEnabledState: boolean
  lowYieldCompactSkipEnabledState: boolean
  toolResultCopiesOnDiskState: 'whole' | 'slim'
  sessionMessagesCache: Map<UUID, Promise<Set<UUID>>>
  resumeHeadWriteChains: Map<string, Promise<void>>
}

const liveHostStorageStates = new Set<WeakRef<HostSessionStorageState>>()

function pruneDeadHostStorageStates(): void {
  for (const ref of liveHostStorageStates) {
    if (ref.deref() === undefined) {
      liveHostStorageStates.delete(ref)
    }
  }
}

const fallbackSessionStorageKey: { readonly root: object } = { root: {} }

export function getActiveSessionStorageKey(): { readonly root: object } {
  try {
    const session = getBootstrapSession()
    if (session && typeof session === 'object') {
      return 'root' in session && session.root ? session : { root: session }
    }
  } catch {
    // Fall back when sessionHost is mocked in isolated unit tests
  }
  return fallbackSessionStorageKey
}

export const hostSessionStorageSlot =
  new RootSessionSlot<HostSessionStorageState>(() => {
    const state: HostSessionStorageState = {
      hostRef: undefined,
      sessionRef: undefined,
      lastKnownSessionId: undefined,
      lastSkipPersistence: undefined,
      cleanupUnregister: undefined,
      project: null,
      exitReStampRan: false,
      exitFlushInFlight: undefined,
      exitDrains: new Set(),
      liveBridgeSuppressionProbe: undefined,
      liveForeignBindingProbe: undefined,
      leftoverAppendSerial: leftoverSerialByPath(),
      transcriptFullDiskState: {
        fullDiskCode: undefined,
        fullDiskPaths: new Set<string>(),
      },
      defaultNfsAppendFlusher: new NfsAppendFlusher(),
      notChainParentUuids: new Set(),
      inFlightSidechainWrites: new Map(),
      localGcEnabledState: false,
      lowYieldCompactSkipEnabledState: true,
      toolResultCopiesOnDiskState: 'whole',
      sessionMessagesCache: new Map(),
      resumeHeadWriteChains: new Map(),
    }
    if (liveHostStorageStates.size > 64) {
      pruneDeadHostStorageStates()
    }
    liveHostStorageStates.add(new WeakRef(state))
    return state
  })

export function refreshHostStorageSessionRef(
  state: HostSessionStorageState,
  host?: object,
): void {
  if (host && state.hostRef?.deref() !== host) {
    state.hostRef = new WeakRef(host)
  }
  try {
    const session = getBootstrapSession()
    const rootSession = session?.root ?? session
    const ownerHost = host ?? state.hostRef?.deref()
    if (rootSession && (!ownerHost || rootSession.host === ownerHost)) {
      if (state.sessionRef?.deref() !== rootSession) {
        state.sessionRef = new WeakRef(rootSession)
      }
      state.lastKnownSessionId = rootSession.id as UUID
      state.lastSkipPersistence = getPersistenceSuppressCause() !== null
    }
  } catch {
    // Ignore when sessionHost is mocked in isolated unit tests
  }
}

export function getHostSessionStorageState(): HostSessionStorageState {
  const host = getBootstrapSessionHost()
  const state = hostSessionStorageSlot.of(getActiveSessionStorageKey())
  refreshHostStorageSessionRef(state, host)
  return state
}

export function collectLiveHostStorageStates(): HostSessionStorageState[] {
  let currentState: HostSessionStorageState | undefined
  try {
    currentState = hostSessionStorageSlot.peek(getActiveSessionStorageKey())
  } catch {
    currentState = undefined
  }
  const states: HostSessionStorageState[] = []
  const seen = new Set<HostSessionStorageState>()
  for (const ref of liveHostStorageStates) {
    const state = ref.deref()
    if (!state) {
      liveHostStorageStates.delete(ref)
      continue
    }
    if (!seen.has(state)) {
      seen.add(state)
      states.push(state)
    }
  }
  if (currentState && !seen.has(currentState)) {
    states.push(currentState)
  }
  return states
}

export function runWithHostStorageSession<T>(
  state: HostSessionStorageState,
  fn: (hasLiveSession: boolean) => T,
): T {
  const targetSession = state.sessionRef?.deref()
  if (!targetSession) {
    // If sessionRef was previously recorded and has since been GC'd, never fall
    // back to defaultBootstrapSession (which would stamp defaultSession.id into
    // this host's JSONL transcript). Likewise in shared-backend mode outside ALS.
    if (
      state.sessionRef !== undefined ||
      (isSharedBackend() && !hasActiveSessionAls())
    ) {
      return fn(false)
    }
    return fn(true)
  }
  try {
    if (
      getBootstrapSession() === targetSession &&
      getActiveSubconversationFromAls() === undefined
    ) {
      return fn(true)
    }
  } catch {
    // Fall through to runWithSession
  }
  return runWithSession(targetSession, () => fn(true))
}

export function registerSessionExitDrain(
  fn: () => void | Promise<void>,
): () => void {
  const { exitDrains } = getHostSessionStorageState()
  exitDrains.add(fn)
  return () => {
    exitDrains.delete(fn)
  }
}

/**
 * Delegates to the single live writer-health tracker in
 * `src/utils/transcriptWriterHealth.ts` (eliminating the split-brain copy).
 */
export function noteTranscriptWriterDegraded(
  code: string,
  source: string,
  filePath?: string,
): void {
  const mappedSource: TranscriptWriteSource =
    source === 'drain' || source === 'materialize' || source === 'adopt'
      ? source
      : 'drain'
  const err = Object.assign(new Error(code), { code })
  recordTranscriptWriteFailure(
    mappedSource,
    err,
    filePath ??
      getHostSessionStorageState().project?.sessionFile ??
      '<session-transcript>',
  )
}

/**
 * Official 2.1.325 #2266: entries that represent turn progress/completion should
 * trigger an immediate queue drain rather than sitting in the 100ms debounce
 * timer where an unclean exit could drop them.
 */
export function isPromptFlushTranscriptEntry(entry: Entry): boolean {
  if (entry.type === 'user' || entry.type === 'assistant') {
    return true
  }
  if (entry.type === 'system') {
    const subtype = (entry as { subtype?: unknown }).subtype
    return subtype === 'turn_duration' || subtype === 'compact_boundary'
  }
  return false
}

/**
 * densable Otf / qCt / Dtf — live probe that the active bridge session is under
 * history-backfill suppression (mint-after-reattach-gone / noHistoryBackfill).
 * Registered by useReplBridge while RC is connected; used by
 * isCompactPairWithheldFromRemote so mid-session compact pairs are not
 * re-uploaded to CCR when the remote session was minted without prior history.
 */
/** densable qCt — register (or clear with undefined) the live suppression probe. */
export function registerLiveSuppressionProbe(
  probe: (() => boolean) | undefined,
): void {
  getHostSessionStorageState().liveBridgeSuppressionProbe = probe
}

/** densable Dtf — true when the live probe reports history-backfill suppression. */
export function isLiveBridgeSuppressed(): boolean {
  return getHostSessionStorageState().liveBridgeSuppressionProbe?.() === true
}

/** leftover host hook matching official optional eQe. */
export function registerForeignSessionBindingProbe(
  probe: (() => ForeignSessionBinding | undefined) | undefined,
): void {
  getHostSessionStorageState().liveForeignBindingProbe = probe
}

/** densable eQe?.() */
export function getForeignSessionBinding(): ForeignSessionBinding | undefined {
  return getHostSessionStorageState().liveForeignBindingProbe?.()
}

/** densable t9s / He */
export function isForeignSessionBinding(): boolean {
  return getForeignSessionBinding()?.foreign === true
}

/** densable n9s / fi */
export function getForeignBoundSid(): string | undefined {
  return getForeignSessionBinding()?.boundSid
}

/** densable Jre — foreign binding whose live sid is missing or not boundSid. */
export function isForeignBoundSessionMismatch(sessionId?: string): boolean {
  const binding = getForeignSessionBinding()
  if (binding?.foreign !== true) return false
  if (!sessionId || !binding.boundSid) return true
  return sessionId !== binding.boundSid
}

/** densable Ig — per-path serial then-chain. Never export minify `Ig`. */
function leftoverSerialByPath(): {
  run: (path: string, job: () => Promise<void>) => Promise<void>
  settle: () => Promise<void>
} {
  const tails = new Map<string, Promise<void>>()
  return {
    run(path, job) {
      const next = (tails.get(path) ?? Promise.resolve()).then(() => job())
      const swallowed = next.then(
        () => {},
        () => {},
      )
      tails.set(path, swallowed)
      void swallowed.then(() => {
        if (tails.get(path) === swallowed) tails.delete(path)
      })
      return next
    },
    async settle() {
      await Promise.all([...tails.values()])
    },
  }
}

export function isFullDiskError(
  err: unknown,
): TranscriptFullDiskCode | undefined {
  const code = getErrnoCode(err)
  if (code === 'ENOSPC' || code === 'EDQUOT') {
    return code
  }
  return undefined
}

export function recordTranscriptFullDiskError(
  err: unknown,
  filePath?: string,
): TranscriptFullDiskCode | undefined {
  const code = isFullDiskError(err)
  if (code === undefined) return undefined
  const { transcriptFullDiskState } = getHostSessionStorageState()
  if (transcriptFullDiskState.fullDiskCode === undefined || code === 'EDQUOT') {
    transcriptFullDiskState.fullDiskCode = code
  }
  if (filePath) {
    transcriptFullDiskState.fullDiskPaths.add(filePath)
  }
  return code
}

export function getTranscriptFullDiskState(): TranscriptFullDiskState {
  return getHostSessionStorageState().transcriptFullDiskState
}

export function resetTranscriptFullDiskState(): void {
  const { transcriptFullDiskState } = getHostSessionStorageState()
  transcriptFullDiskState.fullDiskCode = undefined
  transcriptFullDiskState.fullDiskPaths.clear()
}

/**
 * #1912 / official `H5e` — detects whether a transcript directory is mounted on
 * Linux NFS (`statfs.type === 0x6969`) so appends call `handle.sync()` and
 * surface delayed ENOSPC/EDQUOT quota errors instead of exiting 0 silently.
 */
export class NfsAppendFlusher {
  private answers = new Map<string, Promise<boolean>>()
  private pending = 0
  private isWary = false
  private readonly statfsImpl: StatfsFn
  private readonly platform: NodeJS.Platform
  private readonly timeoutMs: number

  constructor(opts?: {
    statfsImpl?: StatfsFn
    platform?: NodeJS.Platform
    timeoutMs?: number
  }) {
    this.statfsImpl = opts?.statfsImpl ?? fsStatfs
    this.platform = opts?.platform ?? process.platform
    this.timeoutMs = opts?.timeoutMs ?? NFS_STATFS_TIMEOUT_MS
  }

  flushesAppendsIn(dir: string): Promise<boolean> {
    if (this.platform !== 'linux') {
      return Promise.resolve(false)
    }
    const cached = this.answers.get(dir)
    if (cached !== undefined) return cached
    if (this.isWary && this.pending > 0) {
      return Promise.resolve(false)
    }
    this.pending++
    let timedOut = false
    const probe = this.statfsImpl(dir)
      .finally(() => {
        this.pending--
      })
      .then(
        res => {
          if (!timedOut && this.pending === 0) {
            this.isWary = false
          }
          const isNfs = Number(res.type) >>> 0 === NFS_SUPER_MAGIC
          if (isNfs) {
            logForDebugging(`transcript appends in ${dir} are flushed: NFS`)
          }
          this.answers.set(dir, Promise.resolve(isNfs))
          return isNfs
        },
        err => {
          const code = getErrnoCode(err)
          if (code === 'ENOENT' || code === 'ENOTDIR') {
            this.answers.delete(dir)
            logForDebugging(
              `transcript appends in ${dir} that waited for this answer are flushed: the folder is not there yet`,
            )
            return true
          }
          if (code !== undefined && NFS_STATFS_UNSUPPORTED_CODES.has(code)) {
            this.answers.set(dir, Promise.resolve(false))
          } else {
            this.answers.delete(dir)
          }
          logForDebugging(
            `transcript appends in ${dir} are not flushed: statfs failed (${code ?? 'error'})`,
          )
          return false
        },
      )

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<undefined>(resolve => {
      timer = setTimeout(() => resolve(undefined), this.timeoutMs)
      timer.unref?.()
    })
    const settled = Promise.race([probe, timeout]).then(res => {
      if (timer !== undefined) clearTimeout(timer)
      if (res === undefined) {
        timedOut = true
        this.isWary = true
        logForDebugging(
          `transcript appends in ${dir} are not flushed: statfs timed out`,
        )
        return false
      }
      return res
    })
    this.answers.set(dir, settled)
    return settled
  }

  clear(): void {
    this.answers.clear()
    this.pending = 0
    this.isWary = false
  }
}

/**
 * #1912 / official `VYt` — append with `handle.sync()` when on Linux NFS so
 * delayed NFS quota/full-disk errors (`ENOSPC`/`EDQUOT`) are surfaced.
 */
export async function appendAndSyncOnNfs(
  filePath: string,
  data: string,
  flusher: NfsAppendFlusher = getHostSessionStorageState()
    .defaultNfsAppendFlusher,
): Promise<boolean> {
  if (isDisklessActive()) {
    return false
  }
  const shouldFlush = await flusher.flushesAppendsIn(dirname(filePath))
  if (!shouldFlush) {
    return false
  }
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 }).catch(
    () => {},
  )
  const handle = await fsOpen(
    filePath,
    fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT,
    0o600,
  )
  try {
    await handle.writeFile(data, 'utf8')
    try {
      await handle.sync()
    } catch (syncErr) {
      if (FULL_DISK_ERRNO_CODES.has(getErrnoCode(syncErr) ?? '')) {
        logForDebugging(
          `Transcript flush failed (${getErrnoCode(syncErr)}): ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
          { level: 'error' },
        )
        recordTranscriptFullDiskError(syncErr, filePath)
        throw syncErr
      }
    }
  } finally {
    await handle.close().catch(() => {})
  }
  return true
}

export function markNotChainParent(uuid: string): void {
  if (!uuid) return
  const { notChainParentUuids } = getHostSessionStorageState()
  notChainParentUuids.delete(uuid)
  notChainParentUuids.add(uuid)
  if (notChainParentUuids.size > MAX_NOT_CHAIN_PARENT_UUIDS) {
    const oldest = notChainParentUuids.values().next().value
    if (oldest !== undefined) notChainParentUuids.delete(oldest)
  }
}

export function isNotChainParent(uuid: string | undefined): boolean {
  return (
    typeof uuid === 'string' &&
    getHostSessionStorageState().notChainParentUuids.has(uuid)
  )
}

/** @internal Clear notChainParent registry between tests. */
export function clearNotChainParentForTests(): void {
  getHostSessionStorageState().notChainParentUuids.clear()
}

// In-flight sidechain transcript writes keyed by agentId on each host so
// `getAgentTranscript` (official 2.1.331 `bde` / `_td` @316271011) awaits
// pending writes before reading `agent-<id>.jsonl` instead of racing ENOENT.
export async function awaitWithOptionalAbort(
  promise: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await promise.catch(() => {})
    return
  }
  if (signal.aborted) return
  let onAbort: (() => void) | undefined
  try {
    await Promise.race([
      promise.catch(() => {}),
      new Promise<void>(resolve => {
        onAbort = () => resolve()
        signal.addEventListener('abort', onAbort, { once: true })
      }),
    ])
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

export function getErrnoCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code
    if (typeof c === 'string') return c
  }
  return undefined
}

export function getToolResultCopiesOnDisk(): 'whole' | 'slim' {
  return getHostSessionStorageState().toolResultCopiesOnDiskState
}

export function setLocalGcEnabled(enabled: boolean): void {
  getHostSessionStorageState().localGcEnabledState = enabled
}

export function isLocalGcEnabled(): boolean {
  return (
    getHostSessionStorageState().localGcEnabledState ||
    isEnvTruthy(process.env.CLAUDE_CODE_TRANSCRIPT_LOCAL_GC)
  )
}

export function setLowYieldCompactSkipEnabled(enabled: boolean): void {
  getHostSessionStorageState().lowYieldCompactSkipEnabledState = enabled
}

export function isLowYieldCompactSkipEnabled(): boolean {
  return getHostSessionStorageState().lowYieldCompactSkipEnabledState
}

/**
 * Official $Yt — returns true when reclaimableBytes < bytesBefore * 0.1.
 */
export function isLowYieldCompact(
  bytesBefore: number,
  reclaimableBytes: number,
): boolean {
  return reclaimableBytes < bytesBefore * LOW_YIELD_COMPACT_RATIO
}

/**
 * Official skipLowYieldCompact — skip rewriting large transcript files when
 * lowYieldCompactSkipEnabled is on and reclaiming would free under 10%.
 */
export function shouldSkipLowYieldCompact(
  bytesBefore: number,
  reclaimableBytes: number,
): boolean {
  if (!getHostSessionStorageState().lowYieldCompactSkipEnabledState)
    return false
  if (!isLowYieldCompact(bytesBefore, reclaimableBytes)) return false
  logEvent('tengu_transcript_compact_skipped', {
    bytesBefore,
    reclaimableBytes,
  })
  return true
}

/**
 * densable `subscribeSessionTitleChanged` / REPL `BQi` — notify when
 * currentSessionTitle / currentSessionAiTitle cache mutates so terminal
 * tab title can useSyncExternalStore instead of a one-shot render read.
 */
export function subscribeSessionTitleChanged(
  onStoreChange: () => void,
): () => void {
  return getSessionOnceLatches().sessionTitleChanged.subscribe(onStoreChange)
}

export function notifySessionTitleChanged(): void {
  getSessionOnceLatches().sessionTitleChanged.emit()
}

/** Underlying cache for direct manipulation (priming, clearing, tests). */
export function getSessionMessagesCache(): Map<UUID, Promise<Set<UUID>>> {
  return getHostSessionStorageState().sessionMessagesCache
}

/**
 * Clear the cached session messages.
 * Call after compaction when old message UUIDs are no longer valid.
 */
export function clearSessionMessagesCache(): void {
  getHostSessionStorageState().sessionMessagesCache.clear()
}
type TornTailHook = {
  getCurrentSessionFile: () => string | null
  markTornTail: (filePath: string) => void
}

let tornTailHook: TornTailHook | undefined

export function registerTornTailHook(hook: TornTailHook): void {
  tornTailHook = hook
}

export function getActiveProjectSessionFile(): string | null {
  if (tornTailHook) {
    return tornTailHook.getCurrentSessionFile()
  }
  return getHostSessionStorageState().project?.sessionFile ?? null
}

export function markTornTailForNextAppend(filePath: string): void {
  if (tornTailHook) {
    tornTailHook.markTornTail(filePath)
    return
  }
  getHostSessionStorageState().project?.sealTornTailOnNextAppend(filePath)
}
