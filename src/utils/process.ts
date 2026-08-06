import { withTimeout } from './sleep.js'

// densable process IO module (WEt / Ds / fVt / zRn / P_m / L_m) — 2.1.214 #19
// stream-json exit drain scales with pending stdout queue bytes, not fixed 2s.

/** densable `P_m` — assumed stdout drain throughput (bytes/sec) for budget scale */
const STDOUT_DRAIN_BYTES_PER_SEC = 262144
/** densable `L_m` — hard cap on scaled drain budget */
const STDOUT_DRAIN_MAX_MS = 30_000
/** densable default base for fVt / zRn */
const STDOUT_DRAIN_BASE_MS = 2000

// densable cll — pipe-gone codes that should destroy the stream quietly
const PIPE_GONE_CODES = new Set(['EPIPE', 'EIO', 'ENXIO', 'EBADF'])
// densable I_m — stdin-unusable codes
const STDIN_UNUSABLE_CODES = new Set(['EISDIR', 'ENOTCONN', 'ECONNRESET'])

/** densable `dll` — any writeToStdout observed this process */
let wroteToStdout = false
/** densable `odi` — singleton stdout.end() promise */
let stdoutEndPromise: Promise<void> | undefined
/** densable `pll` — bytes accepted by write() (enqueued) */
let bytesEnqueued = 0
/** densable `fll` — bytes whose write callbacks fired (flushed to OS) */
let bytesFlushed = 0
/** densable `qRn` — notify when pending queue may be empty */
let queueEmptyNotify: (() => void) | undefined
/** densable `idi` — singleton wait-for-queue-empty promise */
let queueEmptyPromise: Promise<void> | undefined
/** densable `ldi` — stdout error latch (treat pending as 0) */
let stdoutErrored = false
/** densable `R_m` / `sdi` — external clock (failsafe path) */
let externalClockPromise: Promise<void> | undefined
let externalClockResolve: (() => void) | undefined

function handleStreamGoneErrors(
  stream: NodeJS.ReadStream | NodeJS.WriteStream,
  onCode?: (code: string) => void,
): void {
  // densable dVt
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== undefined && PIPE_GONE_CODES.has(err.code)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(stream as any).destroy?.()
      } catch {
        // ignore
      }
      onCode?.(err.code)
    }
  })
}

/**
 * densable `adi` — register stdin/stdout/stderr gone-error handlers.
 * stdout error also latches ldi so pending-byte accounting zeros out.
 */
export function registerProcessOutputErrorHandlers(): void {
  // densable: dVt(stdin), dVt(stdout)+error latch, dVt(stderr)
  handleStreamGoneErrors(process.stdin)
  handleStreamGoneErrors(process.stdout)
  process.stdout.on('error', () => {
    stdoutErrored = true
    queueEmptyNotify?.()
  })
  handleStreamGoneErrors(process.stderr)
}

/** densable `ull` — write if stream still writable */
function safeWrite(
  stream: NodeJS.WriteStream,
  data: string,
  cb?: () => void,
): boolean {
  if (stream.destroyed || stream.writableEnded) return false
  stream.write(data, cb)
  return true
}

/**
 * densable `Ds` — write stdout and account pending bytes for exit drain.
 * Callback decrements flushed count so scaleBudgetToQueue can size the wait.
 */
export function writeToStdout(data: string): void {
  wroteToStdout = true
  const t = Buffer.byteLength(data)
  if (
    safeWrite(process.stdout, data, () => {
      bytesFlushed += t
      queueEmptyNotify?.()
    })
  ) {
    bytesEnqueued += t
  }
}

/** densable `mVt` */
export function writeToStderr(data: string): void {
  safeWrite(process.stderr, data)
}

// Write error to stderr and exit with code 1. Consolidates the
// console.error + process.exit(1) pattern used in entrypoint fast-paths.
// densable N_m
export function exitWithError(message: string): never {
  console.error(message)
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(1)
}

/** densable `hll` — pending unflushed stdout bytes (0 if destroyed/errored) */
export function getPendingStdoutBytes(): number {
  if (process.stdout.destroyed || stdoutErrored) return 0
  return Math.max(0, bytesEnqueued - bytesFlushed)
}

/**
 * densable `zRn` — drain budget ms scaled to pending queue:
 * min(30_000, max(base, ceil(pendingBytes * 1000 / 262144)))
 */
export function getStdoutDrainBudgetMs(baseMs = STDOUT_DRAIN_BASE_MS): number {
  return Math.min(
    STDOUT_DRAIN_MAX_MS,
    Math.max(
      baseMs,
      Math.ceil((getPendingStdoutBytes() * 1000) / STDOUT_DRAIN_BYTES_PER_SEC),
    ),
  )
}

function waitForStdoutQueueEmpty(): Promise<void> {
  // densable O_m
  if (queueEmptyPromise === undefined) {
    queueEmptyPromise = new Promise<void>(resolve => {
      const tick = () => {
        if (getPendingStdoutBytes() <= 0) {
          queueEmptyNotify = undefined
          resolve()
        }
      }
      queueEmptyNotify = tick
      process.stdout.once('close', tick)
      tick()
    })
  }
  return queueEmptyPromise
}

function ensureExternalClock(): Promise<void> {
  // densable mll
  if (externalClockPromise === undefined) {
    externalClockPromise = new Promise<void>(resolve => {
      externalClockResolve = resolve
    })
  }
  return externalClockPromise
}

/**
 * densable `XDe` — mark that an external path (failsafe) has already
 * started the drain clock so D_m can race base sleep after resolve.
 */
export function markStdoutDrainExternallyClocked(): void {
  ensureExternalClock()
  externalClockResolve?.()
  externalClockResolve = undefined
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => {
    // eslint-disable-next-line no-restricted-syntax -- drain budget sleep
    const t = setTimeout(resolve, ms)
    if (typeof t === 'object') t.unref?.()
  })
}

function waitExternalClockThenSleep(baseMs: number): Promise<void> {
  // densable D_m(e) = mll().then(() => kr(e))
  return ensureExternalClock().then(() => sleepMs(baseMs))
}

/**
 * densable `fVt` — end + drain stdout before process exit.
 *
 * When `scaleBudgetToQueue` is true (default), budget = zRn(base) so large
 * stream-json queues get more than fixed 2s. Race also includes external
 * clock + base sleep so failsafe can cut short.
 */
export async function drainStdoutBeforeExit(
  baseMs = STDOUT_DRAIN_BASE_MS,
  options: { scaleBudgetToQueue?: boolean } = {},
): Promise<void> {
  const scaleBudgetToQueue = options.scaleBudgetToQueue ?? true
  const r = process.stdout
  if (stdoutEndPromise === undefined) {
    // densable: TTY / already ended / never wrote → no-op
    if (r.isTTY || r.destroyed || r.writableEnded || !wroteToStdout) {
      return
    }
    stdoutEndPromise = new Promise<void>(resolve => {
      r.end(() => resolve())
    })
  }
  const n = Promise.all([stdoutEndPromise, waitForStdoutQueueEmpty()])
  const work = scaleBudgetToQueue
    ? Promise.race([n, waitExternalClockThenSleep(baseMs)])
    : n
  const budget = scaleBudgetToQueue ? getStdoutDrainBudgetMs(baseMs) : baseMs
  await withTimeout(work, budget, 'stdout drain timeout (exit)').catch(() => {
    // densable: swallow timeout — exit must proceed
  })
}

/** densable pVt — stdin unusable by code */
export function isStdinUnusableError(e: unknown): boolean {
  const code =
    e !== null &&
    typeof e === 'object' &&
    'code' in e &&
    typeof (e as { code?: unknown }).code === 'string'
      ? (e as { code: string }).code
      : undefined
  return (
    code !== undefined &&
    (STDIN_UNUSABLE_CODES.has(code) || PIPE_GONE_CODES.has(code))
  )
}

// Wait for a stdin-like stream to close, but give up after ms if no data ever
// arrives. First data chunk cancels the timeout — after that, wait for end
// unconditionally (caller's accumulator needs all chunks, not just the first).
// Returns true on timeout, false on end. Used by -p mode to distinguish a
// real pipe producer from an inherited-but-idle parent stdin.
// densable xDr
export function peekForStdinData(
  stream: NodeJS.EventEmitter & {
    readableEnded?: boolean
    destroyed?: boolean
  },
  ms: number,
): Promise<boolean> {
  if (stream.readableEnded || stream.destroyed) {
    return Promise.resolve(false)
  }
  return new Promise<boolean>(resolve => {
    const done = (timedOut: boolean) => {
      clearTimeout(peek)
      stream.off('end', onEnd)
      stream.off('close', onEnd)
      stream.off('data', onFirstData)
      void resolve(timedOut)
    }
    const onEnd = () => done(false)
    const onFirstData = () => {
      clearTimeout(peek)
      // densable: after first data, if already ended/destroyed → false
      if (stream.readableEnded || stream.destroyed) {
        done(false)
      }
      // else: leave end/close listeners; do not resolve on timeout anymore
      // densable clears timeout only — we keep waiting for end.
      // To match densable more closely: after data, only end/close resolve.
    }
    // eslint-disable-next-line no-restricted-syntax -- not a sleep: races timeout against stream end/data events
    const peek = setTimeout(done, ms, true)
    stream.once('end', onEnd)
    stream.once('close', onEnd)
    stream.once('data', onFirstData)
  })
}

/** Testing-only: reset byte accounting / latches between tests. */
export function _resetStdoutDrainStateForTesting(): void {
  wroteToStdout = false
  stdoutEndPromise = undefined
  bytesEnqueued = 0
  bytesFlushed = 0
  queueEmptyNotify = undefined
  queueEmptyPromise = undefined
  stdoutErrored = false
  externalClockPromise = undefined
  externalClockResolve = undefined
}

/**
 * Testing-only: inject pending-byte state without touching process.stdout.
 * Simulates densable Ds enqueue (and optional partial flush) for zRn/hll tests.
 */
export function _injectStdoutDrainPendingForTesting(
  enqueued: number,
  flushed = 0,
): void {
  wroteToStdout = enqueued > 0 || flushed > 0
  bytesEnqueued = enqueued
  bytesFlushed = flushed
  stdoutErrored = false
}
