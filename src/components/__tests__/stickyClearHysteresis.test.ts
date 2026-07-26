import { describe, expect, test } from 'bun:test'
import {
  shouldClearStickyOnMiss,
  STICKY_CLEAR_HYSTERESIS_FRAMES,
} from '../VirtualMessageList.js'

describe('shouldClearStickyOnMiss (React #185 sticky thrash guard)', () => {
  test('force always clears', () => {
    expect(shouldClearStickyOnMiss(0, true, true)).toBe(true)
    expect(shouldClearStickyOnMiss(0, false, true)).toBe(true)
  })

  test('without sticky held, miss does not clear (no-op path)', () => {
    expect(shouldClearStickyOnMiss(0, false, false)).toBe(false)
    expect(shouldClearStickyOnMiss(99, false, false)).toBe(false)
  })

  test('single-frame miss keeps sticky (padCollapsed flicker)', () => {
    expect(shouldClearStickyOnMiss(1, true, false)).toBe(false)
  })

  test('hysteresis frames clears sticky', () => {
    expect(
      shouldClearStickyOnMiss(STICKY_CLEAR_HYSTERESIS_FRAMES, true, false),
    ).toBe(true)
    expect(
      shouldClearStickyOnMiss(STICKY_CLEAR_HYSTERESIS_FRAMES + 1, true, false),
    ).toBe(true)
  })
})
