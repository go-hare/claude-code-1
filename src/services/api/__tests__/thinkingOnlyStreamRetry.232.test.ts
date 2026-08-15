/**
 * densable 2.1.232 #26 — thinking-only stream re-loop decision (Po=1, sr=2).
 */
import { describe, expect, test } from 'bun:test'
import {
  planThinkingOnlyStreamRetry,
  THINKING_ONLY_STALE_RETRY_CAP,
  THINKING_ONLY_WATCHDOG_RETRY_CAP,
  ThinkingOnlyStreamRetryError,
} from '../thinkingOnlyStreamRetry.js'

describe('densable 2.1.232 #26 planThinkingOnlyStreamRetry', () => {
  test('watchdog thinking-only under Po=1 → retry once', () => {
    const p = planThinkingOnlyStreamRetry({
      streamIdleAborted: true,
      isStaleOrNetwork: false,
      hasNonThinkingOutput: false,
      stopReason: null,
      watchdogRetryCount: 0,
      staleRetryCount: 0,
    })
    expect(p.shouldRetry).toBe(true)
    if (!p.shouldRetry) return
    expect(p.kind).toBe('watchdog')
    expect(p.retryAttempt).toBe(1)
    expect(p.retryCap).toBe(THINKING_ONLY_WATCHDOG_RETRY_CAP)
    expect(p.backoffMs).toBe(0)
    expect(p.eventName).toBe('tengu_streaming_watchdog_retry')
    expect(p.debugMessage).toContain('after thinking-only yield')
    expect(p.debugMessage).toContain('(1/1)')
  })

  test('watchdog second attempt exhausted (Tn >= Po)', () => {
    expect(
      planThinkingOnlyStreamRetry({
        streamIdleAborted: true,
        isStaleOrNetwork: false,
        hasNonThinkingOutput: false,
        stopReason: null,
        watchdogRetryCount: 1,
        staleRetryCount: 0,
      }),
    ).toEqual({ shouldRetry: false })
  })

  test('stale thinking-only under sr=2 → retry with 100*oo backoff', () => {
    const p = planThinkingOnlyStreamRetry({
      streamIdleAborted: false,
      isStaleOrNetwork: true,
      hasNonThinkingOutput: false,
      stopReason: null,
      watchdogRetryCount: 0,
      staleRetryCount: 0,
      connectionCode: 'ECONNRESET',
    })
    expect(p.shouldRetry).toBe(true)
    if (!p.shouldRetry) return
    expect(p.kind).toBe('stale')
    expect(p.retryAttempt).toBe(1)
    expect(p.retryCap).toBe(THINKING_ONLY_STALE_RETRY_CAP)
    expect(p.backoffMs).toBe(100)
    expect(p.eventName).toBe('tengu_streaming_stale_connection_retry')
    expect(p.debugMessage).toContain('ECONNRESET')
    expect(p.debugMessage).toContain('(1/2)')
  })

  test('stale second retry still under cap; third exhausted', () => {
    const second = planThinkingOnlyStreamRetry({
      streamIdleAborted: false,
      isStaleOrNetwork: true,
      hasNonThinkingOutput: false,
      stopReason: null,
      watchdogRetryCount: 0,
      staleRetryCount: 1,
      connectionCode: 'EPIPE',
    })
    expect(second.shouldRetry).toBe(true)
    if (second.shouldRetry) {
      expect(second.retryAttempt).toBe(2)
      expect(second.backoffMs).toBe(200)
    }
    expect(
      planThinkingOnlyStreamRetry({
        streamIdleAborted: false,
        isStaleOrNetwork: true,
        hasNonThinkingOutput: false,
        stopReason: null,
        watchdogRetryCount: 0,
        staleRetryCount: 2,
      }),
    ).toEqual({ shouldRetry: false })
  })

  test('has non-thinking output → no retry (partial finalize path)', () => {
    expect(
      planThinkingOnlyStreamRetry({
        streamIdleAborted: true,
        isStaleOrNetwork: false,
        hasNonThinkingOutput: true,
        stopReason: null,
        watchdogRetryCount: 0,
        staleRetryCount: 0,
      }),
    ).toEqual({ shouldRetry: false })
  })

  test('stop_reason already set → no retry', () => {
    expect(
      planThinkingOnlyStreamRetry({
        streamIdleAborted: true,
        isStaleOrNetwork: false,
        hasNonThinkingOutput: false,
        stopReason: 'end_turn',
        watchdogRetryCount: 0,
        staleRetryCount: 0,
      }),
    ).toEqual({ shouldRetry: false })
  })

  test('neither watchdog nor stale → no retry', () => {
    expect(
      planThinkingOnlyStreamRetry({
        streamIdleAborted: false,
        isStaleOrNetwork: false,
        hasNonThinkingOutput: false,
        stopReason: null,
        watchdogRetryCount: 0,
        staleRetryCount: 0,
      }),
    ).toEqual({ shouldRetry: false })
  })

  test('ThinkingOnlyStreamRetryError carries plan fields', () => {
    const plan = planThinkingOnlyStreamRetry({
      streamIdleAborted: true,
      isStaleOrNetwork: false,
      hasNonThinkingOutput: false,
      stopReason: null,
      watchdogRetryCount: 0,
      staleRetryCount: 0,
    })
    expect(plan.shouldRetry).toBe(true)
    if (!plan.shouldRetry) return
    const err = new ThinkingOnlyStreamRetryError(plan)
    expect(err.name).toBe('ThinkingOnlyStreamRetryError')
    expect(err.kind).toBe('watchdog')
    expect(err.retryAttempt).toBe(1)
    expect(err.backoffMs).toBe(0)
  })
})
