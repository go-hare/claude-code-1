/**
 * Official 2.1.207/208 byte-body idle watchdog consumer (pairs with F_ / CAh / HAi).
 *
 * When `fetchOptions.timeout: false` disables undici/Bun whole-request timeout,
 * this layer owns hang detection for the **response body**: if no bytes arrive
 * for `idleTimeoutMs`, the stream errors and the underlying reader is cancelled.
 *
 * Stream-loop idle (for-await chunks in claude.ts) remains a separate densable
 * (CLAUDE_ENABLE_STREAM_WATCHDOG / IAi). This is the lower-level body path.
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
 */
export function wrapReadableStreamWithBodyIdleTimeout(
  source: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
  onTimeout?: (error: BodyIdleTimeoutError) => void,
): ReadableStream<Uint8Array> {
  if (!(idleTimeoutMs > 0)) {
    return source
  }

  const reader = source.getReader()
  let timer: ReturnType<typeof setTimeout> | null = null
  let cancelled = false
  let timedOut = false
  let settled = false

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

  const arm = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void => {
    clear()
    timer = setTimeout(() => {
      if (settled || cancelled) return
      timedOut = true
      settle()
      const err = new BodyIdleTimeoutError(idleTimeoutMs)
      onTimeout?.(err)
      try {
        controller.error(err)
      } catch {
        // already closed/errored
      }
      void reader.cancel(err).catch(() => {})
    }, idleTimeoutMs)
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      arm(controller)
      void (async () => {
        try {
          while (!cancelled && !timedOut) {
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
            arm(controller)
            controller.enqueue(value)
          }
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
      })()
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
}

/** Minimal fetch shape — SDK Fetch / Bun fetch both satisfy this. */
export type BodyIdleFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

/**
 * Wrap fetch so successful responses with a body are guarded by the byte-idle
 * watchdog. Headers / non-body responses pass through unchanged.
 */
export function wrapFetchWithBodyIdleWatchdog(
  baseFetch: BodyIdleFetch,
  getOptions: () => BodyIdleWatchdogFetchOptions,
): BodyIdleFetch {
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  return async (input, init) => {
    const response = await baseFetch(input, init)
    const { enabled, idleTimeoutMs } = getOptions()
    if (!enabled || !(idleTimeoutMs > 0) || !response.body) {
      return response
    }

    const wrappedBody = wrapReadableStreamWithBodyIdleTimeout(
      response.body,
      idleTimeoutMs,
      err => {
        logForDebugging(err.message, { level: 'error' })
      },
    )

    // Preserve status / headers; body is the idle-guarded stream.
    return new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}
