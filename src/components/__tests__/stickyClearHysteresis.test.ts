import { describe, expect, test } from 'bun:test'
import {
  isSameStickyPrompt,
  shouldClearStickyOnMiss,
  STICKY_CLEAR_HYSTERESIS_FRAMES,
} from '../VirtualMessageList.js'

describe('shouldClearStickyOnMiss (React #185 sticky thrash guard)', () => {
  test('force always clears', () => {
    expect(shouldClearStickyOnMiss(0, true, true)).toBe(true)
    expect(shouldClearStickyOnMiss(0, false, true)).toBe(true)
    expect(shouldClearStickyOnMiss(0, true, true, 5)).toBe(true)
  })

  test('without sticky held, miss does not clear (no-op path)', () => {
    expect(shouldClearStickyOnMiss(0, false, false)).toBe(false)
    expect(shouldClearStickyOnMiss(99, false, false)).toBe(false)
    expect(shouldClearStickyOnMiss(99, false, false, 0)).toBe(false)
  })

  test('single-frame miss at list top keeps sticky (padCollapsed flicker)', () => {
    expect(shouldClearStickyOnMiss(1, true, false, 0)).toBe(false)
  })

  test('hysteresis frames at list top clears sticky', () => {
    expect(
      shouldClearStickyOnMiss(STICKY_CLEAR_HYSTERESIS_FRAMES, true, false, 0),
    ).toBe(true)
    expect(
      shouldClearStickyOnMiss(
        STICKY_CLEAR_HYSTERESIS_FRAMES + 1,
        true,
        false,
        0,
      ),
    ).toBe(true)
  })

  test('mid-list miss never clears (header/pad thrash, any streak)', () => {
    expect(shouldClearStickyOnMiss(1, true, false, 3)).toBe(false)
    expect(shouldClearStickyOnMiss(99, true, false, 1)).toBe(false)
    expect(
      shouldClearStickyOnMiss(
        STICKY_CLEAR_HYSTERESIS_FRAMES + 10,
        true,
        false,
        12,
      ),
    ).toBe(false)
  })
})

describe('isSameStickyPrompt (setState identity guard)', () => {
  test('null and clicked identity', () => {
    expect(isSameStickyPrompt(null, null)).toBe(true)
    expect(isSameStickyPrompt('clicked', 'clicked')).toBe(true)
    expect(isSameStickyPrompt(null, 'clicked')).toBe(false)
    expect(isSameStickyPrompt('clicked', null)).toBe(false)
  })

  test('same text different object is same', () => {
    const a = { text: 'hello', scrollTo: () => {} }
    const b = { text: 'hello', scrollTo: () => {} }
    expect(isSameStickyPrompt(a, b)).toBe(true)
  })

  test('different text is not same', () => {
    const a = { text: 'hello', scrollTo: () => {} }
    const b = { text: 'world', scrollTo: () => {} }
    expect(isSameStickyPrompt(a, b)).toBe(false)
  })
})
