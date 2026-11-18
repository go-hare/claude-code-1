import { AsyncLocalStorage } from 'async_hooks'
import { appendFile, mkdir, symlink, unlink } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { dirname, join, resolve } from 'path'
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
import { writeToStderr } from './process.js'
import { jsonStringify } from './slowOperations.js'

export type DebugLogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<DebugLogLevel, number> = {
  verbose: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
}

/**
 * Minimum log level to include in debug output. Defaults to 'debug', which
 * filters out 'verbose' messages. Set CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose to
 * include high-volume diagnostics (e.g. full statusLine command, shell, cwd,
 * stdout/stderr) that would otherwise drown out useful debug output.
 */
export const getMinDebugLogLevel = memoize((): DebugLogLevel => {
  const raw = process.env.CLAUDE_CODE_DEBUG_LOG_LEVEL?.toLowerCase().trim()
  if (raw && Object.hasOwn(LEVEL_ORDER, raw)) {
    return raw as DebugLogLevel
  }
  return 'debug'
})

let runtimeDebugEnabled = false

export const isDebugMode = memoize((): boolean => {
  return (
    runtimeDebugEnabled ||
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

/**
 * Enables debug logging mid-session (e.g. via /debug). Non-ants don't write
 * debug logs by default, so this lets them start capturing without restarting
 * with --debug. Returns true if logging was already active.
 */
export function enableDebugLogging(): boolean {
  const wasActive = isDebugMode() || process.env.USER_TYPE === 'ant'
  runtimeDebugEnabled = true
  isDebugMode.cache.clear?.()
  return wasActive
}

// Extract and parse debug filter from command line arguments
// Exported for testing purposes
export const getDebugFilter = memoize((): DebugFilter | null => {
  // Look for --debug=pattern in argv
  const debugArg = process.argv.find(arg => arg.startsWith('--debug='))
  if (!debugArg) {
    return null
  }

  // Extract the pattern after the equals sign
  const filterPattern = debugArg.substring('--debug='.length)
  return parseDebugFilter(filterPattern)
})

export const isDebugToStdErr = memoize((): boolean => {
  return process.argv.includes('--debug-to-stderr')
})

export const getDebugFilePath = memoize((): string | null => {
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

let hasFormattedOutput = false
export function setHasFormattedOutput(value: boolean): void {
  hasFormattedOutput = value
}
export function getHasFormattedOutput(): boolean {
  return hasFormattedOutput
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

type UnflushedChunk = {
  target: string | null
  content: string
  queued?: {
    at: number
    target: string
    needMkdir: boolean
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

let debugWriter: BufferedWriter | null = null
let unflushedChunks: UnflushedChunk[] = []
let backlog: DebugBacklog = {
  chain: Promise.resolve(),
  length: 0,
  appendSince: 0,
  stuck: 'no',
  droppedCount: 0,
  droppedTotal: 0,
}
let exiting = false
let exitHandlerRegistered = false
let resolvedLogPath: string | null = null

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

function isAppendStuck(): boolean {
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

async function drained(): Promise<void> {
  if (isAppendStuck()) return
  const done = backlog.chain.then(() => true)
  do {
    if (await raceWithTimeout(done, DRAIN_POLL_MS)) return
  } while (!isAppendStuck())
}

function takeDroppedNote(): string {
  const { droppedCount } = backlog
  if (droppedCount === 0) return ''
  backlog.droppedCount = 0
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

function resolveDirToFile(dirPath: string): string {
  resolvedLogPath = join(dirPath, `${getSessionId()}.txt`)
  return resolvedLogPath
}

async function appendGroup(
  target: string,
  content: string,
  needMkdir: boolean,
): Promise<void> {
  if (needMkdir) {
    await mkdir(dirname(target), { recursive: true }).catch(noop)
  }
  try {
    await appendFile(target, content)
  } catch (err) {
    if (!isEisdir(err)) throw err
    await appendFile(resolveDirToFile(target), content)
  }
  void updateLatestDebugLogSymlink()
}

async function appendOldestChunks(): Promise<void> {
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
  await appendGroup(queued.target, combined, needMkdir).catch(noop)
  backlog.appendSince = 0
  backlog.stuck = 'no'
  if (unflushedChunks[0] === first) {
    unflushedChunks.splice(0, count)
    backlog.length -= totalBytes
  }
}

function drainSync(): void {
  if (unflushedChunks.length === 0) return
  backlog.length = 0
  if (isAppendStuck()) {
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
            resolveDirToFile(group.target),
            content,
          )
        } catch {
          // Best-effort
        }
      }
    }
  }
}

function handleDebugExit(): void {
  exiting = true
  if (backlog.droppedCount > 0) {
    try {
      getDebugWriter().write('')
    } catch {
      // ignore
    }
  }
  debugWriter?.flush()
  drainSync()
}

function getDebugWriter(): BufferedWriter {
  if (!debugWriter) {
    let ensuredDir: string | null = null
    debugWriter = createBufferedWriter({
      writeFn: content => {
        const target = getDebugLogPath()
        if (exiting) {
          unflushedChunks.push({
            target,
            content: takeDroppedNote() + content,
          })
          drainSync()
          return
        }
        isAppendStuck()
        if (
          backlog.droppedCount > 0
            ? backlog.length >= BACKLOG_MAX_BYTES / 2
            : backlog.length >= BACKLOG_MAX_BYTES &&
              Date.now() - (unflushedChunks[0]?.queued?.at ?? Infinity) >=
                BACKLOG_STUCK_AGE_MS
        ) {
          backlog.droppedCount++
          backlog.droppedTotal++
          return
        }
        const out = takeDroppedNote() + content
        if (out === '') return
        const dir = dirname(target)
        const needMkdir = ensuredDir !== dir
        ensuredDir = dir
        unflushedChunks.push({
          target,
          content: out,
          queued: {
            at: Date.now(),
            target,
            needMkdir,
          },
        })
        backlog.length += out.length
        backlog.chain = runInRootContext(() =>
          backlog.chain.then(appendOldestChunks),
        )
      },
      flushIntervalMs: 1000,
      maxBufferSize: 100,
      immediateMode: isDebugMode(),
    })
    registerCleanup(async () => {
      debugWriter?.dispose()
      await drained()
    })
    if (!exitHandlerRegistered) {
      exitHandlerRegistered = true
      process.on('exit', handleDebugExit)
    }
  }
  return debugWriter
}

export async function flushDebugLogs(): Promise<void> {
  debugWriter?.flush()
  await drained()
  if (backlog.droppedCount > 0 && backlog.length === 0) {
    getDebugWriter().write('')
    debugWriter?.flush()
    await drained()
  }
}

export function getDebugFileDroppedTotal(): number {
  return backlog.droppedTotal
}

export function _resetDebugLoggerForTesting(): void {
  debugWriter?.dispose()
  debugWriter = null
  unflushedChunks = []
  backlog = {
    chain: Promise.resolve(),
    length: 0,
    appendSince: 0,
    stuck: 'no',
    droppedCount: 0,
    droppedTotal: 0,
  }
  exiting = false
  resolvedLogPath = null
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

  // Multiline messages break the jsonl output format, so make any multiline messages JSON.
  if (hasFormattedOutput && message.includes('\n')) {
    message = jsonStringify(message)
  }
  const timestamp = new Date().toISOString()
  const output = `${timestamp} [${level.toUpperCase()}] ${message.trim()}\n`
  if (isDebugToStdErr()) {
    writeToStderr(output, { mayDrop: true })
    return
  }

  getDebugWriter().write(output)
}

export function getDebugLogPath(): string {
  return (
    getDebugFilePath() ??
    resolvedLogPath ??
    (process.env.CLAUDE_CODE_DEBUG_LOGS_DIR
      ? resolve(process.env.CLAUDE_CODE_DEBUG_LOGS_DIR)
      : null) ??
    join(getClaudeConfigHomeDir(), 'debug', `${getSessionId()}.txt`)
  )
}

/**
 * Updates the latest debug log symlink to point to the current debug log file.
 * Creates or updates a symlink at ~/.claude/debug/latest
 */
const updateLatestDebugLogSymlink = memoize(async (): Promise<void> => {
  try {
    const debugLogPath = getDebugLogPath()
    const debugLogsDir = dirname(debugLogPath)
    const latestSymlinkPath = join(debugLogsDir, 'latest')

    await unlink(latestSymlinkPath).catch(() => {})
    await symlink(debugLogPath, latestSymlinkPath)
  } catch {
    // Silently fail if symlink creation fails
  }
})

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
