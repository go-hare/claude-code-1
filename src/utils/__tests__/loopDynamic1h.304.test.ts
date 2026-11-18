import { describe, expect, test } from 'bun:test'
import { DEFAULT_CRON_JITTER_CONFIG } from '../cronTasks.js'
import {
  clampWakeupDelaySeconds,
  LOOP_PROMPT_CACHE_1H_TTL_MS,
} from '../loopDynamic.js'

describe('#994 1-hour max wakeup cache-lead fallback', () => {
  test('pulls 3600s wakeup earlier so targetMs stays within 1h cache TTL minus cacheLeadMs', () => {
    const nowMs = Date.UTC(2026, 0, 1, 12, 0, 10) // 12:00:10
    const cacheLeadMs = 120_000 // 2 minutes
    const res = clampWakeupDelaySeconds(
      3600,
      nowMs,
      { ...DEFAULT_CRON_JITTER_CONFIG, cacheLeadMs },
      nowMs,
    )

    expect(res.clamped).toBe(3600)
    // Without 1h fallback, snapToNextMinute(nowMs + 3600_000) = 13:01:00 (3650s > 3480s).
    // With 1h fallback, targetMs <= nowMs + 3_600_000 - 120_000.
    expect(res.targetMs).toBeLessThanOrEqual(
      nowMs + LOOP_PROMPT_CACHE_1H_TTL_MS - cacheLeadMs,
    )
  })

  test('anchors 1h deadline to recent lastMainThreadRequestAtMs within 10m window', () => {
    const anchorMs = Date.UTC(2026, 0, 1, 12, 0, 0)
    const nowMs = anchorMs + 300_000 // 5m after last request (within 10m window)
    const cacheLeadMs = 120_000
    const res = clampWakeupDelaySeconds(
      3600,
      nowMs,
      { ...DEFAULT_CRON_JITTER_CONFIG, cacheLeadMs },
      anchorMs,
    )

    expect(res.targetMs).toBeLessThanOrEqual(
      anchorMs + LOOP_PROMPT_CACHE_1H_TTL_MS - cacheLeadMs,
    )
  })
})
