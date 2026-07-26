import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import { getIsInteractive, setIsInteractive } from '../../bootstrap/state.js'
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

// mock.module is process-global (last-write-wins). The previous version of this
// file stubbed isFullscreenEnvEnabled → true on fullscreen.js, and that stub
// leaked into fullscreen.test.ts whenever afterAll restore lost the race —
// every expect(false) case there flaked. Do NOT mock fullscreen or
// bootstrap/state. Drive those through real injection points:
//   getIsInteractive       → setIsInteractive
//   isFullscreenEnvEnabled → CLAUDE_CODE_NO_FLICKER=1
// Only analytics is mocked so emit's logEvent is interceptable even when an
// earlier suite already bound scrollTelemetry to a foreign analytics stub.
const logEventMock = mock(
  (_name: string, _meta: Record<string, boolean | number | undefined>) => {},
)

const analyticsSnap = snapshotModuleExports(
  await import('../../services/analytics/index.js'),
)
const analyticsMock = () => ({
  ...analyticsSnap,
  logEvent: logEventMock,
  logEventAsync: async (
    name: string,
    meta: Record<string, boolean | number | undefined>,
  ) => {
    logEventMock(name, meta)
  },
})
mock.module('../../services/analytics/index.ts', analyticsMock)
mock.module('../../services/analytics/index.js', analyticsMock)
mock.module('src/services/analytics/index.ts', analyticsMock)
mock.module('src/services/analytics/index.js', analyticsMock)

afterAll(() => {
  const restore = () => ({ ...analyticsSnap })
  mock.module('../../services/analytics/index.ts', restore)
  mock.module('../../services/analytics/index.js', restore)
  mock.module('src/services/analytics/index.ts', restore)
  mock.module('src/services/analytics/index.js', restore)
})

const origInteractive = getIsInteractive()
const ORIG_ENV = {
  NO_FLICKER: process.env.CLAUDE_CODE_NO_FLICKER,
  DISABLE_ALT: process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN,
  SESSION_KIND: process.env.CLAUDE_CODE_SESSION_KIND,
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterAll(() => {
  setIsInteractive(origInteractive)
  restoreEnv('CLAUDE_CODE_NO_FLICKER', ORIG_ENV.NO_FLICKER)
  restoreEnv('CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN', ORIG_ENV.DISABLE_ALT)
  restoreEnv('CLAUDE_CODE_SESSION_KIND', ORIG_ENV.SESSION_KIND)
})

beforeEach(() => {
  // Force-on path of isFullscreenEnvEnabled (before settings / GB / win-ssh).
  delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
  delete process.env.CLAUDE_CODE_SESSION_KIND
  process.env.CLAUDE_CODE_NO_FLICKER = '1'
  setIsInteractive(true)
  // Re-claim analytics in case a sibling file re-mocked it between tests.
  mock.module('../../services/analytics/index.ts', analyticsMock)
  mock.module('../../services/analytics/index.js', analyticsMock)
  mock.module('src/services/analytics/index.ts', analyticsMock)
  mock.module('src/services/analytics/index.js', analyticsMock)
  resetScrollTelemetryForTesting()
  logEventMock.mockClear()
})

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

  test('emitScrollTelemetrySummary is a no-op when non-interactive', () => {
    setIsInteractive(false)
    try {
      recordScroll()
      emitScrollTelemetrySummary()
      expect(logEventMock).not.toHaveBeenCalled()
      // counters survive — nothing was taken
      expect(hasScrollTelemetry()).toBe(true)
    } finally {
      setIsInteractive(true)
    }
  })
})
