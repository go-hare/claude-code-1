/**
 * Official 2.1.207/208 byte-body idle watchdog consumer (pairs with F_ / CAh / HAi).
 *
 * When `fetchOptions.timeout: false` disables undici/Bun whole-request timeout,
 * this layer owns hang detection for the **response body**: if no bytes arrive
 * for `idleTimeoutMs`, the stream errors and the underlying reader is cancelled.
 *
 * Stream-loop idle (for-await chunks in claude.ts) remains a separate densable
 * (CLAUDE_ENABLE_STREAM_WATCHDOG / IAi). This is the lower-level body path.
 *
 * Backpressure: the previous start()+async-loop form eagerly drained the
 * upstream reader and enqueued without checking `controller.desiredSize`, so a
 * slow consumer could balloon memory. The pull-based form only reads from
 * upstream when the consumer pulls, and re-arms the idle timer on each pull
 * wait / successful chunk.
 */

import { logForDebugging } from './debug.js'

export class BodyIdleTimeoutError extends Error {
  readonly idleTimeoutMs: number

  constructor(idleTimeoutMs: number) {
    super(
      `Byte-stream idle timeout: no response body data for ${Math.round(idleTimeoutMs / 1000)}s`,
    )
    this.name = 'BodyIdleTimeoutError'
    this.idleTimeoutMs = idleTimeoutMs
  }
}

/**
 * Wrap a ReadableStream so that silence longer than `idleTimeoutMs` between
 * chunks (or before the first chunk) aborts the stream with BodyIdleTimeoutError.
 *
 * Pull-driven so we honor consumer backpressure (desiredSize) instead of
 * eagerly pumping the upstream reader into an unbounded queue.
 */
/**
 * densable s8h 4th arg / Response `_chunkTimes` — shared mutable clock
 * stamped on every successful body pull so the query loop can schedule
 * "Waiting for API response · check your network" without using token
 * deltas (advisor thinking can be silent at the event layer).
 */
export type BodyChunkTimes = {
  lastAt: number
}

export function createBodyChunkTimes(): BodyChunkTimes {
  return { lastAt: 0 }
}

export function wrapReadableStreamWithBodyIdleTimeout(
  source: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
  onTimeout?: (error: BodyIdleTimeoutError) => void,
  /**
   * densable s8h `n` — when provided, each successful pull stamps
   * `n.lastAt = performance.now()` (byte-level activity, not SSE events).
   */
  chunkTimes?: BodyChunkTimes,
): ReadableStream<Uint8Array> {
  if (!(idleTimeoutMs > 0)) {
    return source
  }

  const reader = source.getReader()
  let timer: ReturnType<typeof setTimeout> | null = null
  let cancelled = false
  let timedOut = false
  let settled = false
  /** Controller used by the arm timer; set in start(). */
  let streamController: ReadableStreamDefaultController<Uint8Array> | null =
    null

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const settle = (): void => {
    settled = true
    clear()
  }

  const fireTimeout = (): void => {
    if (settled || cancelled) return
    timedOut = true
    settle()
    const err = new BodyIdleTimeoutError(idleTimeoutMs)
    onTimeout?.(err)
    try {
      streamController?.error(err)
    } catch {
      // already closed/errored
    }
    void reader.cancel(err).catch(() => {})
  }

  const arm = (): void => {
    clear()
    timer = setTimeout(fireTimeout, idleTimeoutMs)
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      // Arm immediately so silence before the first pull still times out
      // (matches prior start-loop behavior for hung responses).
      arm()
    },
    async pull(controller) {
      if (settled || cancelled || timedOut) return
      // Re-arm while waiting for the next upstream chunk (idle between pulls).
      arm()
      try {
        const { done, value } = await reader.read()
        if (timedOut || cancelled) return
        if (done) {
          settle()
          try {
            controller.close()
          } catch {
            // already closed
          }
          return
        }
        // densable s8h: if (n) n.lastAt = performance.now()
        if (chunkTimes) {
          chunkTimes.lastAt = performance.now()
        }
        // Fresh bytes — reset idle window for the next wait.
        arm()
        controller.enqueue(value)
        // If the consumer is behind (desiredSize <= 0), stop pulling until
        // they drain; the runtime will call pull() again when ready.
        // (Default highWaterMark is 1 for byte streams in many runtimes;
        // returning here is the standard backpressure handshake.)
      } catch (e) {
        settle()
        if (!timedOut && !cancelled) {
          try {
            controller.error(e)
          } catch {
            // already closed/errored
          }
        }
      }
    },
    cancel(reason) {
      cancelled = true
      settle()
      return reader.cancel(reason)
    },
  })
}

export type BodyIdleWatchdogFetchOptions = {
  enabled: boolean
  idleTimeoutMs: number
  /**
   * densable FMh content-type gate: only wrap SSE / bedrock eventstream.
   * When omitted, defaults to first-party-style `text/event-stream` only
   * (provider-less callers).
   */
  provider?: string
}

/**
 * densable FMh body wrap predicate after pxc/NMh already enabled the fetch wrap:
 *   f = content-type includes text/event-stream
 *   m = provider==="bedrock" && content-type includes vnd.amazon.eventstream
 * Only (f || m) && body are re-wrapped with LMh/idle.
 */
export function shouldWrapResponseBodyWithIdleWatchdog(input: {
  contentType: string | null | undefined
  provider?: string
}): boolean {
  const p = (input.contentType ?? '').toLowerCase()
  if (p.includes('text/event-stream')) return true
  if (input.provider === 'bedrock' && p.includes('vnd.amazon.eventstream')) {
    return true
  }
  return false
}

/** Minimal fetch shape — SDK Fetch / Bun fetch both satisfy this. */
export type BodyIdleFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

/**
 * Re-wrap a fetch Response with a different body while preserving fields the
 * Anthropic SDK reads for logging/debug (`url`, `redirected`, `type`).
 *
 * `new Response(body, init)` always yields `url === ""` — without rebinding,
 * SDK paths that log `response.url` lose the real request URL.
 */
export function rewrapResponseWithBody(
  response: Response,
  body: ReadableStream<Uint8Array>,
  /**
   * densable FMh: Object.defineProperty(v, "_chunkTimes", { value: _ })
   * so query can read `response._chunkTimes.lastAt` for stalled UI.
   */
  chunkTimes?: BodyChunkTimes,
): Response {
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  const next = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
  // url / redirected / type are read-only on platform Responses; defineProperty
  // restores the upstream values on the constructed instance.
  for (const key of ['url', 'redirected', 'type'] as const) {
    try {
      Object.defineProperty(next, key, {
        value: response[key],
        writable: false,
        enumerable: true,
        configurable: true,
      })
    } catch {
      // Runtime may freeze the property — body idle still functions.
    }
  }
  if (chunkTimes) {
    try {
      Object.defineProperty(next, '_chunkTimes', {
        value: chunkTimes,
        writable: false,
        enumerable: false,
        configurable: true,
      })
    } catch {
      // Property may be frozen — stall UI falls back to no lastAt.
    }
  }
  return next
}

/** densable `at._chunkTimes` reader — Response is not typed with the field. */
export function getResponseChunkTimes(
  response: Response | undefined | null,
): BodyChunkTimes | undefined {
  if (!response) return undefined
  const times = (response as Response & { _chunkTimes?: BodyChunkTimes })
    ._chunkTimes
  return times ?? undefined
}

/**
 * Wrap fetch so densable-eligible streaming bodies are guarded by the
 * byte-idle watchdog (FMh → LMh). Non-SSE / non-eventstream bodies pass
 * through even when the outer NMh gate installed this wrap.
 */
export function wrapFetchWithBodyIdleWatchdog(
  baseFetch: BodyIdleFetch,
  getOptions: () => BodyIdleWatchdogFetchOptions,
): BodyIdleFetch {
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  return async (input, init) => {
    const response = await baseFetch(input, init)
    const { enabled, idleTimeoutMs, provider } = getOptions()
    if (!enabled || !(idleTimeoutMs > 0) || !response.body) {
      return response
    }
    if (
      !shouldWrapResponseBodyWithIdleWatchdog({
        contentType: response.headers.get('content-type'),
        provider,
      })
    ) {
      return response
    }

    // densable FMh: _={lastAt:0}; s8h(body,g,y,_); defineProperty(v,"_chunkTimes")
    const chunkTimes = createBodyChunkTimes()
    const wrappedBody = wrapReadableStreamWithBodyIdleTimeout(
      response.body,
      idleTimeoutMs,
      err => {
        logForDebugging(err.message, { level: 'error' })
      },
      chunkTimes,
    )

    return rewrapResponseWithBody(response, wrappedBody, chunkTimes)
  }
}
