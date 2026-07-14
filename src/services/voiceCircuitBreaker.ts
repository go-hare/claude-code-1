/**
 * Official 2.1.202 voice circuit breaker (Dpn / rgb / eQp / tQp).
 *
 * Tracks early session failures in a rolling window. After enough failures,
 * new recording sessions are suppressed until one succeeds (transcript arrives).
 */

/** Official eQp: rolling window for early failures (ms). */
export const VOICE_CIRCUIT_WINDOW_MS = 10_000
/** Official tQp: failures within the window that trip the breaker. */
export const VOICE_CIRCUIT_FAILURE_THRESHOLD = 3

const failureTimestamps: number[] = []
let tripLogged = false

/** Official Dpn: record an early session failure. */
export function recordVoiceEarlyFailure(now = Date.now()): void {
  failureTimestamps.push(now)
}

/** Official rgb: clear failures after a successful transcript. */
export function resetVoiceCircuitBreaker(): void {
  failureTimestamps.length = 0
  tripLogged = false
}

export type VoiceCircuitGate =
  | { open: true }
  | {
      open: false
      /** True only on the first trip within a suppression window (log once). */
      firstTrip: boolean
      failureCount: number
      windowMs: number
    }

/**
 * Prune stale failures and decide whether a new recording session may start.
 * Matches official startRecordingSession gate at the top of `ie()`.
 */
export function checkVoiceCircuitBreaker(now = Date.now()): VoiceCircuitGate {
  while (
    failureTimestamps.length > 0 &&
    now - (failureTimestamps[0] ?? 0) > VOICE_CIRCUIT_WINDOW_MS
  ) {
    failureTimestamps.shift()
  }
  if (failureTimestamps.length < VOICE_CIRCUIT_FAILURE_THRESHOLD) {
    tripLogged = false
  }
  if (failureTimestamps.length >= VOICE_CIRCUIT_FAILURE_THRESHOLD) {
    const firstTrip = !tripLogged
    if (firstTrip) tripLogged = true
    return {
      open: false,
      firstTrip,
      failureCount: failureTimestamps.length,
      windowMs: VOICE_CIRCUIT_WINDOW_MS,
    }
  }
  return { open: true }
}

/** Test-only: inspect breaker state. */
export function getVoiceCircuitBreakerStateForTests(): {
  failures: number[]
  tripLogged: boolean
} {
  return { failures: [...failureTimestamps], tripLogged }
}
