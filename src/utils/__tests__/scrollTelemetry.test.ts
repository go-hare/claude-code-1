import { afterEach, describe, expect, mock, test } from 'bun:test'

// Mock analytics / interactive / fullscreen so the module stays side-effect free.
const logEventMock = mock((_name: string, _meta: Record<string, unknown>) => {})
mock.module('../../services/analytics/index.ts', () => ({
  logEvent: logEventMock,
  logEventAsync: async () => {},
  attachAnalyticsSink: () => {},
  stripProtoFields: <T>(m: T) => m,
}))
mock.module('../../bootstrap/state.ts', () => ({
  getIsInteractive: () => true,
}))
mock.module('../fullscreen.ts', () => ({
  isFullscreenEnvEnabled: () => true,
}))

import {
  emitScrollTelemetrySummary,
  getScrollTelemetryForTesting,
  hasScrollTelemetry,
  recordJumpToBottomClick,
  recordPageJump,
  recordReachedScrollbackCap,
  recordScroll,
  recordStickyState,
  resetScrollTelemetryForTesting,
  takeScrollTelemetrySummary,
} from '../scrollTelemetry.js'

afterEach(() => {
  resetScrollTelemetryForTesting()
  logEventMock.mockClear()
})

describe('scrollTelemetry', () => {
  test('recordScroll / pageJump / jumpToBottomClick increment counters', () => {
    recordScroll()
    recordScroll()
    recordPageJump()
    recordJumpToBottomClick()
    const t = getScrollTelemetryForTesting()
    expect(t.scrolls).toBe(2)
    expect(t.pageJumps).toBe(1)
    expect(t.jumpToBottomClicks).toBe(1)
  })

  test('recordReachedScrollbackCap is sticky true', () => {
    expect(getScrollTelemetryForTesting().reachedScrollbackCap).toBe(false)
    recordReachedScrollbackCap()
    expect(getScrollTelemetryForTesting().reachedScrollbackCap).toBe(true)
  })

  test('recordStickyState accumulates unpinned dwell time', () => {
    const t0 = 1_000_000
    recordStickyState(false, t0)
    recordStickyState(true, t0 + 2500)
    const summary = takeScrollTelemetrySummary(t0 + 2500)
    expect(summary.scroll_up_seconds).toBe(3) // Math.round(2500/1000)
    // take resets
    expect(hasScrollTelemetry()).toBe(false)
  })

  test('takeScrollTelemetrySummary includes open unpinned window', () => {
    const t0 = 5_000_000
    recordStickyState(false, t0)
    const summary = takeScrollTelemetrySummary(t0 + 1400)
    expect(summary.scroll_up_seconds).toBe(1)
  })

  test('emitScrollTelemetrySummary logs tengu_scroll_summary and resets', () => {
    recordScroll()
    recordJumpToBottomClick()
    recordPageJump()
    recordReachedScrollbackCap()
    emitScrollTelemetrySummary()
    expect(logEventMock).toHaveBeenCalledTimes(1)
    const [name, meta] = logEventMock.mock.calls[0]!
    expect(name).toBe('tengu_scroll_summary')
    expect(meta).toMatchObject({
      scrolls: 1,
      jump_to_bottom_clicks: 1,
      page_jumps: 1,
      reached_scrollback_cap: true,
      fullscreen: true,
    })
    expect(hasScrollTelemetry()).toBe(false)
  })

  test('emitScrollTelemetrySummary is a no-op when empty', () => {
    emitScrollTelemetrySummary()
    expect(logEventMock).not.toHaveBeenCalled()
  })
})
