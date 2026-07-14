/**
 * Official 2.1.202 voice circuit breaker pure-mirror tests.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  VOICE_CIRCUIT_FAILURE_THRESHOLD,
  VOICE_CIRCUIT_WINDOW_MS,
  checkVoiceCircuitBreaker,
  getVoiceCircuitBreakerStateForTests,
  recordVoiceEarlyFailure,
  resetVoiceCircuitBreaker,
} from '../voiceCircuitBreaker.js'

afterEach(() => {
  resetVoiceCircuitBreaker()
})

describe('voiceCircuitBreaker', () => {
  test('open until threshold failures within window', () => {
    const t0 = 1_000_000
    expect(checkVoiceCircuitBreaker(t0)).toEqual({ open: true })
    recordVoiceEarlyFailure(t0)
    recordVoiceEarlyFailure(t0 + 100)
    expect(checkVoiceCircuitBreaker(t0 + 200)).toEqual({ open: true })
    recordVoiceEarlyFailure(t0 + 300)
    const closed = checkVoiceCircuitBreaker(t0 + 400)
    expect(closed.open).toBe(false)
    if (!closed.open) {
      expect(closed.firstTrip).toBe(true)
      expect(closed.failureCount).toBe(VOICE_CIRCUIT_FAILURE_THRESHOLD)
      expect(closed.windowMs).toBe(VOICE_CIRCUIT_WINDOW_MS)
    }
  })

  test('logs firstTrip only once while suppressed', () => {
    const t0 = 2_000_000
    for (let i = 0; i < VOICE_CIRCUIT_FAILURE_THRESHOLD; i++) {
      recordVoiceEarlyFailure(t0 + i)
    }
    const a = checkVoiceCircuitBreaker(t0 + 10)
    const b = checkVoiceCircuitBreaker(t0 + 20)
    expect(a.open).toBe(false)
    expect(b.open).toBe(false)
    if (!a.open && !b.open) {
      expect(a.firstTrip).toBe(true)
      expect(b.firstTrip).toBe(false)
    }
  })

  test('failures outside window are pruned', () => {
    const t0 = 3_000_000
    recordVoiceEarlyFailure(t0)
    recordVoiceEarlyFailure(t0 + 1)
    recordVoiceEarlyFailure(t0 + 2)
    // after window elapses past the newest failure, gate reopens
    expect(
      checkVoiceCircuitBreaker(t0 + 2 + VOICE_CIRCUIT_WINDOW_MS + 1),
    ).toEqual({
      open: true,
    })
    expect(getVoiceCircuitBreakerStateForTests().failures).toEqual([])
  })

  test('reset clears failures after success', () => {
    const t0 = 4_000_000
    for (let i = 0; i < VOICE_CIRCUIT_FAILURE_THRESHOLD; i++) {
      recordVoiceEarlyFailure(t0 + i)
    }
    expect(checkVoiceCircuitBreaker(t0 + 10).open).toBe(false)
    resetVoiceCircuitBreaker()
    expect(checkVoiceCircuitBreaker(t0 + 20)).toEqual({ open: true })
  })
})
