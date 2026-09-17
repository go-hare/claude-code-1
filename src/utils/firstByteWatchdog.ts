import { logEvent } from 'src/services/analytics/index.js'
import { logForDebugging } from './debug.js'
import { shouldEnableBodyIdleWatchdog } from './streamWatchdogGates.js'
import { resolveByteStreamIdleTimeoutMs } from './streamWatchdogGates.js'

/** Official Qft — first-byte timeout floor (10s). */
export const FIRST_BYTE_TIMEOUT_MIN_MS = 10_000

/** Official _En — first-byte timeout ceiling (30 min). */
export const FIRST_BYTE_TIMEOUT_MAX_MS = 1_800_000

/** Official KMo — first-party default first-byte window (3 min). */
export const FIRST_BYTE_TIMEOUT_DEFAULT_MS = 180_000

/** Official XMo — extra 1s of first-byte budget per this many request-body bytes. */
export const FIRST_BYTE_UPLOAD_BYTES_PER_SEC = 32_768

/** Official JMo — sleep-detect poll interval. */
const SLEEP_POLL_INTERVAL_MS = 1_000

/** Official QMo — wall-clock gap counted as system sleep. */
const SLEEP_GAP_MS = 5_000

/** Official wEn — Bedrock stream invoke path that always arms first-byte. */
export const BEDROCK_INVOKE_WITH_RESPONSE_STREAM =
  '/invoke-with-response-stream'

/** Official UYo — StreamNoResponse retries (one retry). */
export const STREAM_NO_RESPONSE_RETRY_CAP = 1

const armedRequestIds = new Map<string, true>()

export class StreamNoResponseError extends Error {
  readonly timeoutMs: number
  readonly sleptMs: number
  readonly code = 'StreamNoResponse'

  constructor(timeoutMs: number, sleptMs: number) {
    super('No response from API within the first-byte window')
    this.name = 'StreamNoResponseError'
    this.timeoutMs = timeoutMs
    this.sleptMs = sleptMs
  }
}

export class StreamSuspendedError extends Error {
  readonly sleptMs: number
  readonly code = 'StreamSuspended'

  constructor(sleptMs: number) {
    super(
      'Stream watchdog detected system suspend; aborting to retry on a fresh connection',
    )
    this.name = 'StreamSuspendedError'
    this.sleptMs = sleptMs
  }
}

/** Official SEn — arm first-byte for this client request id. */
export function armStreamFirstByte(clientRequestId: string): void {
  armedRequestIds.set(clientRequestId, true)
}

/** Official eOo — consume the arm. Returns true if this id was armed. */
export function consumeStreamFirstByteArm(
  clientRequestId: string | undefined,
): boolean {
  if (clientRequestId === undefined) {
    return false
  }
  return armedRequestIds.delete(clientRequestId)
}

function parseTimeoutMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback
  }
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function clampFirstByteMs(ms: number): number {
  return Math.min(
    Math.max(ms, FIRST_BYTE_TIMEOUT_MIN_MS),
    FIRST_BYTE_TIMEOUT_MAX_MS,
  )
}

/**
 * Official ZMo — resolve the first-byte window.
 *
 * Env `CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS` wins (clamped, finite only).
 * Dirty values fall through like official `t.int({min:1})` miss. Else the
 * provider's byte-idle timeout, unless `API_TIMEOUT_MS - 1000` is larger.
 */
export function resolveFirstByteTimeoutMs(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const explicit = env.CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS
  if (explicit !== undefined) {
    // Official V.CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS is t.int({min:1}).
    // Number('abc') is NaN; Bun setTimeout(NaN) fires in ~1ms.
    const parsed = parseTimeoutMs(explicit, Number.NaN)
    if (Number.isFinite(parsed)) {
      return clampFirstByteMs(parsed)
    }
  }
  const byteIdle = resolveByteStreamIdleTimeoutMs({ provider, env })
  const apiTimeout = parseTimeoutMs(env.API_TIMEOUT_MS, 0)
  return apiTimeout - 1000 > byteIdle ? apiTimeout - 1000 : byteIdle
}

export type FirstByteDispatchInput = {
  clientRequestId: string | undefined
  provider: string
  routedProvider: string
  method: string
  url: string
  body: unknown
  env?: NodeJS.ProcessEnv
}

/**
 * Official tOo — timeout for this dispatch, or undefined to skip.
 * Armed first-party ids, or Bedrock POST to invoke-with-response-stream,
 * when the routed provider is body-watchdog eligible.
 */
export function resolveFirstByteDispatchTimeoutMs(
  input: FirstByteDispatchInput,
): number | undefined {
  const env = input.env ?? process.env
  const armed = consumeStreamFirstByteArm(input.clientRequestId)
  const bedrockStream =
    input.provider === 'bedrock' &&
    input.method === 'POST' &&
    input.url.includes(BEDROCK_INVOKE_WITH_RESPONSE_STREAM)
  if (!(armed || bedrockStream)) {
    return undefined
  }
  if (
    !shouldEnableBodyIdleWatchdog({
      requestProvider: input.routedProvider,
      currentProvider: input.routedProvider,
      env,
    })
  ) {
    return undefined
  }
  const bodyBytes =
    typeof input.body === 'string' ? Buffer.byteLength(input.body) : 0
  const computed =
    resolveFirstByteTimeoutMs(input.provider, env) +
    Math.ceil(bodyBytes / FIRST_BYTE_UPLOAD_BYTES_PER_SEC) * 1000
  const apiTimeout = parseTimeoutMs(env.API_TIMEOUT_MS, 600_000)
  if (apiTimeout <= 0) {
    return computed
  }
  const cap = apiTimeout - 1000
  if (cap < FIRST_BYTE_TIMEOUT_MIN_MS) {
    return undefined
  }
  return Math.min(computed, cap)
}

type FirstByteFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

/**
 * Official nOo — abort the request if response headers never arrive.
 */
export function wrapFetchWithFirstByteWatchdog(
  baseFetch: FirstByteFetch,
  getContext: () => { provider: string; routedProvider?: string },
): FirstByteFetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    const clientRequestId = headers.get('x-client-request-id') ?? undefined
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const ctx = getContext()
    const timeoutMs = resolveFirstByteDispatchTimeoutMs({
      clientRequestId,
      provider: ctx.provider,
      routedProvider: ctx.routedProvider ?? ctx.provider,
      method,
      url,
      body: init?.body,
    })
    if (timeoutMs === undefined) {
      return baseFetch(input, init)
    }
    return dispatchWithFirstByteTimeout(baseFetch, input, init, timeoutMs)
  }
}

async function dispatchWithFirstByteTimeout(
  baseFetch: FirstByteFetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const abort = new AbortController()
  const parent = init?.signal
  const signal = parent ? AbortSignal.any([parent, abort.signal]) : abort.signal
  let fired: StreamNoResponseError | StreamSuspendedError | undefined
  let lastTick = Date.now()
  let sleptMs = 0
  const pollSleep = (): void => {
    const now = Date.now()
    const gap = now - lastTick
    lastTick = now
    if (gap > SLEEP_GAP_MS) {
      sleptMs += gap
    }
  }
  const interval = setInterval(pollSleep, SLEEP_POLL_INTERVAL_MS)
  interval.unref?.()
  const timer = setTimeout(() => {
    pollSleep()
    fired =
      sleptMs > timeoutMs / 2
        ? new StreamSuspendedError(sleptMs)
        : new StreamNoResponseError(timeoutMs, sleptMs)
    abort.abort(fired)
  }, timeoutMs)
  try {
    return await baseFetch(input, { ...init, signal })
  } catch (error) {
    if (fired !== undefined && !parent?.aborted) {
      logForDebugging(
        `[first-byte] no response headers ${timeoutMs / 1000}s after dispatch${sleptMs > 0 ? ` (slept ${sleptMs}ms)` : ''} — aborting request`,
        { level: 'error' },
      )
      logEvent('tengu_api_no_response_timeout', {
        timeout_ms: timeoutMs,
        slept_ms: sleptMs,
        suspended: fired instanceof StreamSuspendedError,
      })
      throw fired
    }
    throw error
  } finally {
    clearTimeout(timer)
    clearInterval(interval)
  }
}
