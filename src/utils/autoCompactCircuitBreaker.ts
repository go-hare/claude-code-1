/**
 * densable Evu / tengu_auto_compact_circuit_breaker residual (pure half).
 *
 * densable: after consecutiveFailures >= vvu, log circuit breaker event and
 * skip future autocompact attempts this session.
 *
 * Full compact failure plumbing remains denser; this tracks the pure trip
 * threshold + event payload shape.
 */

/** densable vvu — consecutive failure trip count (from densable 2.1.211). */
export const AUTO_COMPACT_CIRCUIT_BREAKER_THRESHOLD = 3

export type AutoCompactCircuitState = {
  kind: 'ok' | 'failed'
  consecutiveFailures: number
  routedThroughReactive?: boolean
  thresholdSource?: string
}

/**
 * densable Evu — record a failure; trip when consecutiveFailures >= threshold.
 * Returns the next state (never throws).
 */
export function recordAutoCompactFailure(input: {
  previous?: { consecutiveFailures?: number } | null
  routedThroughReactive?: boolean
  thresholdSource?: string
  threshold?: number
}): AutoCompactCircuitState {
  const n = (input.previous?.consecutiveFailures ?? 0) + 1
  const threshold = input.threshold ?? AUTO_COMPACT_CIRCUIT_BREAKER_THRESHOLD
  const tripped = n >= threshold
  return {
    kind: 'failed',
    consecutiveFailures: n,
    ...(input.routedThroughReactive ? { routedThroughReactive: true } : {}),
    ...(input.thresholdSource ? { thresholdSource: input.thresholdSource } : {}),
    // callers read consecutiveFailures >= threshold to skip; kind stays failed
    // either way (densable always returns kind:"failed" from Evu).
  }
}

/** densable trip predicate used by compact scheduler after Evu. */
export function isAutoCompactCircuitTripped(
  consecutiveFailures: number,
  threshold: number = AUTO_COMPACT_CIRCUIT_BREAKER_THRESHOLD,
): boolean {
  return consecutiveFailures >= threshold
}

/**
 * densable analytics payload for tengu_auto_compact_circuit_breaker.
 */
export function autoCompactCircuitBreakerEventPayload(input: {
  consecutiveFailures: number
  routedThroughReactive?: boolean
  thresholdSource?: string
}): {
  consecutiveFailures: number
  routedThroughReactive?: boolean
  thresholdSource?: string
} {
  return {
    consecutiveFailures: input.consecutiveFailures,
    ...(input.routedThroughReactive
      ? { routedThroughReactive: true }
      : {}),
    ...(input.thresholdSource
      ? { thresholdSource: input.thresholdSource }
      : {}),
  }
}
