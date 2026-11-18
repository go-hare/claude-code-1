export const DEFAULT_WEBSEARCH_DEADLINE_MS = 300_000
const MAX_SAFE_TIMEOUT_MS = 2_147_483_647

export class WebSearchRequestError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'WebSearchRequestError'
    this.code = code
  }
}

export function getWebSearchDeadlineMs(): number {
  const envRaw = process.env.CLAUDE_CODE_WEBSEARCH_DEADLINE_MS
  if (envRaw !== undefined) {
    const parsed = Number(envRaw)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.min(parsed, MAX_SAFE_TIMEOUT_MS)
    }
  }
  return DEFAULT_WEBSEARCH_DEADLINE_MS
}

/**
 * Races `fn(combinedSignal)` against the 300s (or `CLAUDE_CODE_WEBSEARCH_DEADLINE_MS`)
 * stall/response deadline. When the deadline fires without the caller aborting,
 * rejects with `WebSearchRequestError(..., 'EDEADLINE')` (aligned with WebFetchTool #1243).
 */
export async function withWebSearchDeadline<T>(
  callerSignal: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const deadlineMs = getWebSearchDeadlineMs()
  if (deadlineMs === 0) {
    return fn(callerSignal ?? new AbortController().signal)
  }

  const deadlineController = new AbortController()
  const combinedController = new AbortController()

  const onCallerAbort = () => combinedController.abort(callerSignal?.reason)
  const onDeadlineAbort = () =>
    combinedController.abort(new Error('WebSearch deadline exceeded'))

  if (callerSignal?.aborted) {
    combinedController.abort(callerSignal.reason)
  } else {
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  }
  deadlineController.signal.addEventListener('abort', onDeadlineAbort, {
    once: true,
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const deadlinePromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      deadlineController.abort()
      if (!callerSignal?.aborted) {
        reject(
          new WebSearchRequestError(
            `Search did not complete within the ${deadlineMs / 1000}s deadline`,
            'EDEADLINE',
          ),
        )
      }
    }, deadlineMs)
    ;(timer as { unref?: () => void }).unref?.()
  })

  try {
    return await Promise.race([fn(combinedController.signal), deadlinePromise])
  } catch (err) {
    if (deadlineController.signal.aborted && !callerSignal?.aborted) {
      if (err instanceof WebSearchRequestError && err.code === 'EDEADLINE') {
        throw err
      }
      throw new WebSearchRequestError(
        `Search did not complete within the ${deadlineMs / 1000}s deadline`,
        'EDEADLINE',
      )
    }
    throw err
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    callerSignal?.removeEventListener('abort', onCallerAbort)
    deadlineController.signal.removeEventListener('abort', onDeadlineAbort)
  }
}
