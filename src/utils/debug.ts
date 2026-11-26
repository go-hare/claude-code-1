import { AsyncLocalStorage } from 'async_hooks'
import { appendFile, lstat, mkdir, symlink, unlink } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { getSessionId } from 'src/bootstrap/state.js'

import { type BufferedWriter, createBufferedWriter } from './bufferedWriter.js'
import { registerCleanup } from './cleanupRegistry.js'
import {
  type DebugFilter,
  parseDebugFilter,
  shouldShowDebugMessage,
} from './debugFilter.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import { getFsImplementation } from './fsOperations.js'
import { HostSlot } from './hostSlot.js'
import { writeToStderr } from './process.js'
import {
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  ofDefaultHost,
  runWithSession,
  type Session,
} from './sessionRoot.js'
import { jsonStringify } from './slowOperations.js'

export type DebugLogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<DebugLogLevel, number> = {
  verbose: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
}

type HostMemoizedZeroArg<Result> = (() => Result) & {
  cache: Map<unknown, Result>
}

function memoizePerHost<Result>(fn: () => Result): HostMemoizedZeroArg<Result> {
  const slot = new HostSlot<{ cache: Map<unknown, Result> }>(() => ({
    cache: new Map<unknown, Result>(),
  }))
  const memoized = (): Result => {
    const cache = slot.of(getBootstrapSessionHost()).cache
    if (cache.has(undefined)) {
      return cache.get(undefined) as Result
    }
    const result = fn()
    cache.set(undefined, result)
    return result
  }
  Object.defineProperty(memoized, 'cache', {
    get: () => slot.of(getBootstrapSessionHost()).cache,
    set: (next: Map<unknown, Result>) => {
      slot.of(getBootstrapSessionHost()).cache = next
    },
    configurable: true,
    enumerable: true,
  })
  return memoized as unknown as HostMemoizedZeroArg<Result>
}

type UnflushedChunk = {
  target: string | null
  content: string
  queued?: {
    at: number
    target: string
    needMkdir: boolean
    sessionId: string
  }
}

type DebugBacklog = {
  chain: Promise<void>
  length: number
  appendSince: number
  stuck: 'no' | 'suspected' | 'yes'
  droppedCount: number
  droppedTotal: number
}

type DebugHostState = {
  runtimeDebugEnabled: boolean | undefined
  hasFormattedOutput: boolean | undefined
  debugWriter: BufferedWriter | null
  unflushedChunks: UnflushedChunk[]
  backlog: DebugBacklog
  exiting: boolean
  resolvedLogPath: string | null
  lastSessionId: string | null
  symlinkUpdatePromise: Promise<void> | null
  trackedInLiveStates: boolean
  sessionRef: WeakRef<Session> | undefined
}

function createEmptyDebugBacklog(): DebugBacklog {
  return {
    chain: Promise.resolve(),
    length: 0,
    appendSince: 0,
    stuck: 'no',
    droppedCount: 0,
    droppedTotal: 0,
  }
}

const debugHostSlot = new HostSlot<DebugHostState>(() => ({
  runtimeDebugEnabled: undefined,
  hasFormattedOutput: undefined,
  debugWriter: null,
  unflushedChunks: [],
  backlog: createEmptyDebugBacklog(),
  exiting: false,
  resolvedLogPath: null,
  lastSessionId: null,
  symlinkUpdatePromise: null,
  trackedInLiveStates: false,
  sessionRef: undefined,
}))

function getDebugHostState(): DebugHostState {
  return debugHostSlot.of(getBootstrapSessionHost())
}

function isRuntimeDebugEnabled(): boolean {
  const state = getDebugHostState()
  return (
    state.runtimeDebugEnabled ??
    ofDefaultHost(debugHostSlot).runtimeDebugEnabled ??
    false
  )
}

// Single process-level exit listener iterating WeakRefs so ephemeral hosts
// never accumulate process 'exit' listeners.
const liveDebugHostStates = new Set<WeakRef<DebugHostState>>()
let sharedDebugExitHandlerRegistered = false

function pruneDeadDebugHostStates(): void {
  for (const ref of liveDebugHostStates) {
    if (ref.deref() === undefined) {
      liveDebugHostStates.delete(ref)
    }
  }
}

function onSharedDebugExit(): void {
  for (const ref of liveDebugHostStates) {
    const state = ref.deref()
    if (!state) {
      liveDebugHostStates.delete(ref)
      continue
    }
    handleDebugExit(state)
  }
}

function ensureSharedDebugExitHandlerRegistered(): void {
  if (sharedDebugExitHandlerRegistered) return
  sharedDebugExitHandlerRegistered = true
  process.on('exit', onSharedDebugExit)
}

/**
 * Minimum log level to include in debug output. Defaults to 'debug', which
 * filters out 'verbose' messages. Set CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose to
 * include high-volume diagnostics (e.g. full statusLine command, shell, cwd,
 * stdout/stderr) that would otherwise drown out useful debug output.
 */
export const getMinDebugLogLevel = memoizePerHost((): DebugLogLevel => {
  const raw = process.env.CLAUDE_CODE_DEBUG_LOG_LEVEL?.toLowerCase().trim()
  if (raw && Object.hasOwn(LEVEL_ORDER, raw)) {
    return raw as DebugLogLevel
  }
  return 'debug'
})

const isDebugModeEnvOrArgv = memoizePerHost((): boolean => {
  return (
    isEnvTruthy(process.env.DEBUG) ||
    isEnvTruthy(process.env.DEBUG_SDK) ||
    process.argv.includes('--debug') ||
    process.argv.includes('-d') ||
    isDebugToStdErr() ||
    // Also check for --debug=pattern syntax
    process.argv.some(arg => arg.startsWith('--debug=')) ||
    // --debug-file implicitly enables debug mode
    getDebugFilePath() !== null
  )
})

const isDebugModeImpl = (): boolean => {
  return isRuntimeDebugEnabled() || isDebugModeEnvOrArgv()
}

Object.defineProperty(isDebugModeImpl, 'cache', {
  get: () => isDebugModeEnvOrArgv.cache,
  set: (next: Map<unknown, boolean>) => {
    isDebugModeEnvOrArgv.cache = next
  },
  configurable: true,
  enumerable: true,
})

export const isDebugMode =
  isDebugModeImpl as unknown as HostMemoizedZeroArg<boolean>

/**
 * Enables debug logging mid-session (e.g. via /debug). Non-ants don't write
 * debug logs by default, so this lets them start capturing without restarting
 * with --debug. Returns true if logging was already active.
 */
export function enableDebugLogging(): boolean {
  const wasActive = isDebugMode() || process.env.USER_TYPE === 'ant'
  getDebugHostState().runtimeDebugEnabled = true
  isDebugMode.cache.clear?.()
  return wasActive
}

// Extract and parse debug filter from command line arguments
// Exported for testing purposes
export const getDebugFilter = memoizePerHost((): DebugFilter | null => {
  // Look for --debug=pattern in argv
  const debugArg = process.argv.find(arg => arg.startsWith('--debug='))
  if (!debugArg) {
    return null
  }

  // Extract the pattern after the equals sign
  const filterPattern = debugArg.substring('--debug='.length)
  return parseDebugFilter(filterPattern)
})

export const isDebugToStdErr = memoizePerHost((): boolean => {
  return process.argv.includes('--debug-to-stderr')
})

export const getDebugFilePath = memoizePerHost((): string | null => {
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i]!
    if (arg.startsWith('--debug-file=')) {
      return resolve(arg.substring('--debug-file='.length))
    }
    if (arg === '--debug-file' && i + 1 < process.argv.length) {
      return resolve(process.argv[i + 1]!)
    }
  }
  return null
})

function shouldLogDebugMessage(message: string): boolean {
  if (process.env.NODE_ENV === 'test' && !isDebugToStdErr()) {
    return false
  }

  // Non-ants only write debug logs when debug mode is active (via --debug at
  // startup or /debug mid-session). Ants always log for /share, bug reports.
  if (process.env.USER_TYPE !== 'ant' && !isDebugMode()) {
    return false
  }

  if (
    typeof process === 'undefined' ||
    typeof process.versions === 'undefined' ||
    typeof process.versions.node === 'undefined'
  ) {
    return false
  }

  const filter = getDebugFilter()
  return shouldShowDebugMessage(message, filter)
}

export function setHasFormattedOutput(value: boolean): void {
  getDebugHostState().hasFormattedOutput = value
}
export function getHasFormattedOutput(): boolean {
  const state = getDebugHostState()
  return (
    state.hasFormattedOutput ??
    ofDefaultHost(debugHostSlot).hasFormattedOutput ??
    false
  )
}

const runInRootContext: <T>(fn: () => T) => T =
  typeof AsyncLocalStorage.snapshot === 'function'
    ? AsyncLocalStorage.snapshot()
    : fn => fn()

const BACKLOG_MAX_BYTES = 1048576 // 1 MiB (ut)
const BACKLOG_STUCK_AGE_MS = 10_000 // 10 s (rn)
const APPEND_CHUNK_BYTES = 262144 // 256 KiB (sn)
const APPEND_STUCK_MS = 5000 // (on)
const DRAIN_POLL_MS = 100 // (lt)

function noop(): void {}

function raceWithTimeout(p: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(false), ms)
    t.unref?.()
    void p.then(
      v => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(true)
      },
    )
  })
}

function isAppendStuck(state: DebugHostState): boolean {
  const { backlog } = state
  const { appendSince } = backlog
  if (
    backlog.stuck === 'no' &&
    appendSince !== 0 &&
    Date.now() - appendSince >= APPEND_STUCK_MS
  ) {
    backlog.stuck = 'suspected'
    const t = setTimeout(
      (bl: DebugBacklog, since: number) => {
        bl.stuck = bl.appendSince === since ? 'yes' : 'no'
      },
      DRAIN_POLL_MS,
      backlog,
      appendSince,
    )
    t.unref?.()
  }
  return backlog.stuck === 'yes'
}

async function drained(state: DebugHostState): Promise<void> {
  if (isAppendStuck(state)) return
  const done = state.backlog.chain.then(() => true)
  do {
    if (await raceWithTimeout(done, DRAIN_POLL_MS)) return
  } while (!isAppendStuck(state))
}

function takeDroppedNote(state: DebugHostState): string {
  const { droppedCount } = state.backlog
  if (droppedCount === 0) return ''
  state.backlog.droppedCount = 0
  return `${new Date().toISOString()} [WARN] debug messages not logged: ${droppedCount} since the line above, because writes to this log were over 10 s behind, with over 1 MiB waiting\n`
}

function isEisdir(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: unknown }).code === 'EISDIR'
  )
}

function resolveDirToFile(
  state: DebugHostState,
  dirPath: string,
  sessionId?: string,
): string {
  const sid = sessionId ?? state.lastSessionId ?? getSessionId()
  state.resolvedLogPath = join(dirPath, `${sid}.txt`)
  return state.resolvedLogPath
}

function updateLatestDebugLogSymlinkOnce(
  state: DebugHostState,
  targetPath: string,
): Promise<void> {
  if (state.symlinkUpdatePromise !== null) {
    return state.symlinkUpdatePromise
  }
  state.symlinkUpdatePromise = updateLatestDebugLogSymlinkForPath(
    state.resolvedLogPath ?? targetPath,
  ).then(() => undefined)
  return state.symlinkUpdatePromise
}

async function appendGroup(
  state: DebugHostState,
  target: string,
  content: string,
  needMkdir: boolean,
  sessionId: string,
): Promise<void> {
  if (needMkdir) {
    await mkdir(dirname(target), { recursive: true }).catch(noop)
  }
  let writtenTarget = target
  try {
    await appendFile(target, content)
  } catch (err) {
    if (!isEisdir(err)) throw err
    writtenTarget = resolveDirToFile(state, target, sessionId)
    await appendFile(writtenTarget, content)
  }
  void updateLatestDebugLogSymlinkOnce(state, writtenTarget)
}

async function appendOldestChunks(state: DebugHostState): Promise<void> {
  const { unflushedChunks, backlog } = state
  const first = unflushedChunks[0]
  const queued = first?.queued
  if (queued === undefined) return
  let count = 0
  let totalBytes = 0
  let needMkdir = false
  for (const chunk of unflushedChunks) {
    const q = chunk.queued
    if (
      q === undefined ||
      q.target !== queued.target ||
      (count > 0 && totalBytes + chunk.content.length > APPEND_CHUNK_BYTES)
    ) {
      break
    }
    count++
    totalBytes += chunk.content.length
    needMkdir ||= q.needMkdir
  }
  const combined = unflushedChunks
    .slice(0, count)
    .map(c => c.content)
    .join('')
  backlog.appendSince = Date.now()
  await appendGroup(
    state,
    queued.target,
    combined,
    needMkdir,
    queued.sessionId,
  ).catch(noop)
  backlog.appendSince = 0
  backlog.stuck = 'no'
  if (unflushedChunks[0] === first) {
    unflushedChunks.splice(0, count)
    backlog.length -= totalBytes
  }
}

function drainSyncImpl(state: DebugHostState): void {
  const { unflushedChunks, backlog } = state
  if (unflushedChunks.length === 0) return
  backlog.length = 0
  if (isAppendStuck(state)) {
    unflushedChunks.length = 0
    return
  }
  const groups: Array<{ target: string; parts: UnflushedChunk[] }> = []
  for (const chunk of unflushedChunks.splice(0)) {
    if (chunk.target === null) continue
    const last = groups.at(-1)
    if (last !== undefined && last.target === chunk.target) {
      last.parts.push(chunk)
    } else {
      groups.push({ target: chunk.target, parts: [chunk] })
    }
  }
  for (const group of groups) {
    const content = group.parts.map(p => p.content).join('')
    try {
      getFsImplementation().mkdirSync(dirname(group.target))
    } catch {
      // Directory already exists or unwritable
    }
    try {
      getFsImplementation().appendFileSync(group.target, content)
    } catch (err) {
      if (isEisdir(err)) {
        try {
          getFsImplementation().appendFileSync(
            resolveDirToFile(state, group.target),
            content,
          )
        } catch {
          // Best-effort
        }
      }
    }
  }
}

function drainSync(state: DebugHostState): void {
  const rootSession = state.sessionRef?.deref()
  if (rootSession !== undefined && getActiveSessionFromAls() !== rootSession) {
    runWithSession(rootSession, () => drainSyncImpl(state))
    return
  }
  drainSyncImpl(state)
}

function handleDebugExit(state: DebugHostState): void {
  const run = () => {
    state.exiting = true
    if (state.backlog.droppedCount > 0 && state.debugWriter) {
      try {
        state.debugWriter.write('')
      } catch {
        // ignore
      }
    }
    state.debugWriter?.flush()
    drainSync(state)
  }
  const rootSession = state.sessionRef?.deref()
  if (rootSession !== undefined && getActiveSessionFromAls() !== rootSession) {
    runWithSession(rootSession, run)
  } else {
    run()
  }
}

function getDebugWriter(state: DebugHostState): BufferedWriter {
  const activeSession = getActiveSessionFromAls()
  if (
    activeSession !== undefined &&
    state.sessionRef?.deref() !== activeSession.root
  ) {
    state.sessionRef = new WeakRef(activeSession.root)
  }
  if (!state.debugWriter) {
    let ensuredDir: string | null = null
    const capturedRootRef = state.sessionRef
    state.debugWriter = createBufferedWriter({
      writeFn: content => {
        const execWrite = () => {
          const target = getDebugLogPath()
          const sessionId = getSessionId()
          state.lastSessionId = sessionId
          if (state.exiting) {
            state.unflushedChunks.push({
              target,
              content: takeDroppedNote(state) + content,
            })
            drainSync(state)
            return
          }
          isAppendStuck(state)
          if (
            state.backlog.droppedCount > 0
              ? state.backlog.length >= BACKLOG_MAX_BYTES / 2
              : state.backlog.length >= BACKLOG_MAX_BYTES &&
                Date.now() -
                  (state.unflushedChunks[0]?.queued?.at ?? Infinity) >=
                  BACKLOG_STUCK_AGE_MS
          ) {
            state.backlog.droppedCount++
            state.backlog.droppedTotal++
            return
          }
          const out = takeDroppedNote(state) + content
          if (out === '') return
          const dir = dirname(target)
          const needMkdir = ensuredDir !== dir
          ensuredDir = dir
          state.unflushedChunks.push({
            target,
            content: out,
            queued: {
              at: Date.now(),
              target,
              needMkdir,
              sessionId,
            },
          })
          state.backlog.length += out.length
          state.backlog.chain = runInRootContext(() =>
            state.backlog.chain.then(() => appendOldestChunks(state)),
          )
        }
        const ownerSession = capturedRootRef?.deref()
        if (
          ownerSession !== undefined &&
          getActiveSessionFromAls() !== ownerSession
        ) {
          runWithSession(ownerSession, execWrite)
        } else {
          execWrite()
        }
      },
      flushIntervalMs: 1000,
      maxBufferSize: 100,
      immediateMode: isDebugMode(),
    })
    registerCleanup(async () => {
      state.debugWriter?.dispose()
      await drained(state)
    })
    if (!state.trackedInLiveStates) {
      state.trackedInLiveStates = true
      if (liveDebugHostStates.size > 64) {
        pruneDeadDebugHostStates()
      }
      liveDebugHostStates.add(new WeakRef(state))
    }
    ensureSharedDebugExitHandlerRegistered()
  }
  return state.debugWriter
}

export async function flushDebugLogs(): Promise<void> {
  const state = getDebugHostState()
  state.debugWriter?.flush()
  await drained(state)
  if (state.backlog.droppedCount > 0 && state.backlog.length === 0) {
    getDebugWriter(state).write('')
    state.debugWriter?.flush()
    await drained(state)
  }
}

export function getDebugFileDroppedTotal(): number {
  return getDebugHostState().backlog.droppedTotal
}

export function _resetDebugLoggerForTesting(): void {
  const state = getDebugHostState()
  state.debugWriter?.dispose()
  state.debugWriter = null
  state.unflushedChunks = []
  state.backlog = createEmptyDebugBacklog()
  state.exiting = false
  state.resolvedLogPath = null
  state.lastSessionId = null
  state.symlinkUpdatePromise = null
  state.runtimeDebugEnabled = undefined
  state.hasFormattedOutput = undefined
  state.sessionRef = undefined
  isDebugMode.cache.clear?.()
}

export function logForDebugging(
  message: string,
  { level }: { level: DebugLogLevel } = {
    level: 'debug',
  },
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[getMinDebugLogLevel()]) {
    return
  }
  if (!shouldLogDebugMessage(message)) {
    return
  }

  const state = getDebugHostState()
  // Multiline messages break the jsonl output format, so make any multiline messages JSON.
  if (getHasFormattedOutput() && message.includes('\n')) {
    message = jsonStringify(message)
  }
  const timestamp = new Date().toISOString()
  const output = `${timestamp} [${level.toUpperCase()}] ${message.trim()}\n`
  if (isDebugToStdErr()) {
    writeToStderr(output, { mayDrop: true })
    return
  }

  getDebugWriter(state).write(output)
}

export function getDebugLogPath(): string {
  return (
    getDebugFilePath() ??
    getDebugHostState().resolvedLogPath ??
    (process.env.CLAUDE_CODE_DEBUG_LOGS_DIR
      ? resolve(process.env.CLAUDE_CODE_DEBUG_LOGS_DIR)
      : null) ??
    join(getClaudeConfigHomeDir(), 'debug', `${getSessionId()}.txt`)
  )
}

/**
 * Updates the `latest` debug log symlink in `dirname(debugLogPath)` to point
 * to `debugLogPath`.
 *
 * Official 2.1.323 (#2086, @278280405):
 * - Never create/replace `latest` when `debugLogPath` itself is named `latest`
 *   (case-insensitive).
 * - Never unlink or replace an existing non-symlink file or directory named
 *   `latest` in the debug log's folder.
 */
export async function updateLatestDebugLogSymlinkForPath(
  debugLogPath: string,
): Promise<boolean> {
  try {
    if (basename(debugLogPath).toLowerCase() === 'latest') {
      return false
    }
    const debugLogsDir = dirname(debugLogPath)
    const latestSymlinkPath = join(debugLogsDir, 'latest')

    const existing = await lstat(latestSymlinkPath).catch(() => null)
    if (existing !== null) {
      if (!existing.isSymbolicLink()) {
        return false
      }
      await unlink(latestSymlinkPath).catch(() => {})
    }
    await symlink(debugLogPath, latestSymlinkPath)
    return true
  } catch {
    // Silently fail if symlink creation fails
    return false
  }
}

/**
 * Logs errors for Ants only, always visible in production.
 */
export function logAntError(context: string, error: unknown): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  if (error instanceof Error && error.stack) {
    logForDebugging(`[ANT-ONLY] ${context} stack trace:\n${error.stack}`, {
      level: 'error',
    })
  }
}
