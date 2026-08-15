/**
 * densable 2.1.232 #26 / 2.1.219+ mid-stream — thinking-only stream re-loop.
 *
 * Gold (SEA / h5-close-after-complete):
 *   if (!ke && Br === null && (xo ? Tn < Po : oo < sr)) {
 *     // xo=streamIdleAborted; ke=hasNonThinkingOutput; Br=stopReason
 *     // Po=1 (watchdog cap), sr=2 (stale cap)
 *     if (xo) Tn++; log tengu_streaming_watchdog_retry after_thinking_only
 *     else    oo++; log tengu_streaming_stale_connection_retry after_thinking_only
 *     continue e  // re-stream
 *   }
 *   // else partial finalize + banner
 */

/** densable Po — max thinking-only watchdog stream retries. */
export const THINKING_ONLY_WATCHDOG_RETRY_CAP = 1
/** densable sr — max thinking-only stale/network stream retries. */
export const THINKING_ONLY_STALE_RETRY_CAP = 2

export type ThinkingOnlyStreamRetryKind = 'watchdog' | 'stale'

export type ThinkingOnlyStreamRetryPlan =
  | { shouldRetry: false }
  | {
      shouldRetry: true
      kind: ThinkingOnlyStreamRetryKind
      /** Counter value after this retry (1-based attempt for logs). */
      retryAttempt: number
      /** Cap used for log `${attempt}/${cap}`. */
      retryCap: number
      /** densable: `await sleep(100 * oo)` only for non-watchdog (stale) path. */
      backoffMs: number
      eventName:
        | 'tengu_streaming_watchdog_retry'
        | 'tengu_streaming_stale_connection_retry'
      debugMessage: string
    }

export type ThinkingOnlyStreamRetryInput = {
  /** densable xo / Ki — idle watchdog aborted the stream body. */
  streamIdleAborted: boolean
  /**
   * densable Ui — stale/network connection path eligible for partial finalize
   * (and thus for thinking-only re-stream). Watchdog path ignores this.
   */
  isStaleOrNetwork: boolean
  /** densable ke / ti — any non-thinking yielded content (text/tool/…). */
  hasNonThinkingOutput: boolean
  /** densable Br — stop_reason already set (message complete enough). */
  stopReason: string | null | undefined
  /** densable Tn — retries already consumed for thinking-only watchdog. */
  watchdogRetryCount: number
  /** densable oo — retries already consumed for thinking-only stale/network. */
  staleRetryCount: number
  /** densable Bo?.code for log copy (optional). */
  connectionCode?: string | null
  watchdogRetryCap?: number
  staleRetryCap?: number
}

/**
 * Pure decision: after thinking-only yield, re-stream under densable caps
 * instead of partial-finalizing with a "stalled while thinking" banner.
 */
export function planThinkingOnlyStreamRetry(
  input: ThinkingOnlyStreamRetryInput,
): ThinkingOnlyStreamRetryPlan {
  const {
    streamIdleAborted,
    isStaleOrNetwork,
    hasNonThinkingOutput,
    stopReason,
    watchdogRetryCount,
    staleRetryCount,
    connectionCode,
  } = input
  const watchdogCap = input.watchdogRetryCap ?? THINKING_ONLY_WATCHDOG_RETRY_CAP
  const staleCap = input.staleRetryCap ?? THINKING_ONLY_STALE_RETRY_CAP

  // densable: only watchdog or stale/network partial-finalize arms enter here.
  if (!streamIdleAborted && !isStaleOrNetwork) {
    return { shouldRetry: false }
  }
  // densable: `!ke && Br === null`
  if (hasNonThinkingOutput) return { shouldRetry: false }
  if (stopReason != null) return { shouldRetry: false }

  if (streamIdleAborted) {
    if (watchdogRetryCount >= watchdogCap) return { shouldRetry: false }
    const retryAttempt = watchdogRetryCount + 1
    return {
      shouldRetry: true,
      kind: 'watchdog',
      retryAttempt,
      retryCap: watchdogCap,
      backoffMs: 0,
      eventName: 'tengu_streaming_watchdog_retry',
      debugMessage: `Stream idle timeout after thinking-only yield — retrying streaming (${retryAttempt}/${watchdogCap})`,
    }
  }

  // stale / network
  if (staleRetryCount >= staleCap) return { shouldRetry: false }
  const retryAttempt = staleRetryCount + 1
  const code = connectionCode ?? 'unknown'
  return {
    shouldRetry: true,
    kind: 'stale',
    retryAttempt,
    retryCap: staleCap,
    backoffMs: 100 * retryAttempt,
    eventName: 'tengu_streaming_stale_connection_retry',
    debugMessage: `Stream connection closed (${code}) after thinking-only yield — retrying streaming (${retryAttempt}/${staleCap})`,
  }
}

/** Internal control-flow signal: re-enter densable stream loop (`continue e`). */
export class ThinkingOnlyStreamRetryError extends Error {
  readonly kind: ThinkingOnlyStreamRetryKind
  readonly retryAttempt: number
  readonly backoffMs: number

  constructor(
    plan: Extract<ThinkingOnlyStreamRetryPlan, { shouldRetry: true }>,
  ) {
    super(plan.debugMessage)
    this.name = 'ThinkingOnlyStreamRetryError'
    this.kind = plan.kind
    this.retryAttempt = plan.retryAttempt
    this.backoffMs = plan.backoffMs
  }
}
