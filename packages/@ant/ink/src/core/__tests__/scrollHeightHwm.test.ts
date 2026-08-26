import { describe, expect, test } from 'bun:test'
import {
  applyVirtualScrollRangeClamp,
  clampScrollTopToContentMax,
  clampStoredScrollTop,
  clampVisualScrollTop,
  resolveNearestScrollTop,
  shouldFollowScrollGrowth,
  updateScrollHeightHwm,
} from '../scrollHeightHwm.js'

describe('updateScrollHeightHwm', () => {
  test('sticky clears HWM and uses prev height as reference', () => {
    expect(
      updateScrollHeightHwm({
        sticky: true,
        prevScrollHeight: 100,
        scrollHeight: 80,
        scrollHeightHwm: 120,
      }),
    ).toEqual({ referenceHeight: 100, nextHwm: undefined })
  })

  test('not sticky tracks max of hwm and current', () => {
    expect(
      updateScrollHeightHwm({
        sticky: false,
        prevScrollHeight: 100,
        scrollHeight: 90,
        scrollHeightHwm: 120,
      }),
    ).toEqual({ referenceHeight: 120, nextHwm: 120 })

    expect(
      updateScrollHeightHwm({
        sticky: false,
        prevScrollHeight: 100,
        scrollHeight: 140,
        scrollHeightHwm: 120,
      }),
    ).toEqual({ referenceHeight: 120, nextHwm: 140 })
  })

  test('cold start without hwm uses prev height', () => {
    expect(
      updateScrollHeightHwm({
        sticky: false,
        prevScrollHeight: 50,
        scrollHeight: 50,
      }),
    ).toEqual({ referenceHeight: 50, nextHwm: 50 })
  })
})

describe('shouldFollowScrollGrowth', () => {
  test('sticky always follows', () => {
    expect(
      shouldFollowScrollGrowth({
        sticky: true,
        stickyAttr: false,
        followGrowth: false,
        grew: false,
        scrollTop: 0,
        prevMaxAgainstHwm: 100,
      }),
    ).toBe(true)
  })

  test('positional follow when at prev max and grew', () => {
    expect(
      shouldFollowScrollGrowth({
        sticky: false,
        stickyAttr: true,
        followGrowth: true,
        grew: true,
        scrollTop: 80,
        prevMaxAgainstHwm: 80,
      }),
    ).toBe(true)
  })

  test('no follow when scrolled away', () => {
    expect(
      shouldFollowScrollGrowth({
        sticky: false,
        stickyAttr: true,
        followGrowth: true,
        grew: true,
        scrollTop: 40,
        prevMaxAgainstHwm: 80,
      }),
    ).toBe(false)
  })

  test('stickyScroll={false} attr never auto-follows', () => {
    expect(
      shouldFollowScrollGrowth({
        sticky: false,
        stickyAttr: false,
        followGrowth: true,
        grew: true,
        scrollTop: 80,
        prevMaxAgainstHwm: 80,
      }),
    ).toBe(false)
  })

  test('followGrowth=false disables positional follow', () => {
    expect(
      shouldFollowScrollGrowth({
        sticky: false,
        stickyAttr: undefined,
        followGrowth: false,
        grew: true,
        scrollTop: 80,
        prevMaxAgainstHwm: 80,
      }),
    ).toBe(false)
  })

  test('shrink does not positional-follow (grew false)', () => {
    expect(
      shouldFollowScrollGrowth({
        sticky: false,
        stickyAttr: true,
        followGrowth: true,
        grew: false,
        scrollTop: 80,
        prevMaxAgainstHwm: 80,
      }),
    ).toBe(false)
  })
})

describe('clampStoredScrollTop / clampVisualScrollTop', () => {
  test('stored keeps HWM upper when content shrinks', () => {
    // was at bottom of 200-tall content, viewport 40 → scrollTop 160
    // content shrinks to 100 → maxScroll 60; HWM reference 200
    const stored = clampStoredScrollTop(160, 60, 200, 40)
    expect(stored).toBe(160)
    expect(clampVisualScrollTop(stored, 60)).toBe(60)
  })

  test('stored still clamps to content when no HWM surplus', () => {
    expect(clampStoredScrollTop(100, 80, 100, 20)).toBe(80)
  })
})

describe('clampScrollTopToContentMax', () => {
  test('clamps overscrolled HWM value before scrollBy', () => {
    expect(clampScrollTopToContentMax(160, 100, 40)).toBe(60)
  })

  test('passes through when scrollHeight unknown', () => {
    expect(clampScrollTopToContentMax(160, undefined, 40)).toBe(160)
  })
})

describe('resolveNearestScrollTop', () => {
  test('keeps current when element fully visible', () => {
    // viewport 20, element at 30 height 10 → visible when scrollTop in [20, 30]
    expect(
      resolveNearestScrollTop({
        currentScrollTop: 25,
        elementTop: 30,
        elementHeight: 10,
        viewportHeight: 20,
      }),
    ).toBe(25)
  })

  test('scrolls up when element above viewport', () => {
    expect(
      resolveNearestScrollTop({
        currentScrollTop: 50,
        elementTop: 10,
        elementHeight: 5,
        viewportHeight: 20,
      }),
    ).toBe(10)
  })

  test('scrolls down when element below viewport', () => {
    expect(
      resolveNearestScrollTop({
        currentScrollTop: 0,
        elementTop: 40,
        elementHeight: 10,
        viewportHeight: 20,
      }),
    ).toBe(30) // 40+10-20
  })
})

describe('applyVirtualScrollRangeClamp', () => {
  test('sticky skips leftover mounted-range clamp (empty-transcript paint)', () => {
    // visual at maxScroll (sticky pin); leftover clamp is the prior top range
    expect(applyVirtualScrollRangeClamp(400, 0, 30, true)).toBe(400)
  })

  test('non-sticky clamps visual scrollTop into mounted range', () => {
    expect(applyVirtualScrollRangeClamp(400, 0, 30, false)).toBe(30)
    expect(applyVirtualScrollRangeClamp(10, 20, 80, false)).toBe(20)
    expect(applyVirtualScrollRangeClamp(50, 20, 80, false)).toBe(50)
  })

  test('passthrough when either bound is missing', () => {
    expect(applyVirtualScrollRangeClamp(400, undefined, 30, false)).toBe(400)
    expect(applyVirtualScrollRangeClamp(400, 0, undefined, false)).toBe(400)
    expect(applyVirtualScrollRangeClamp(400, undefined, undefined, false)).toBe(
      400,
    )
  })
})
