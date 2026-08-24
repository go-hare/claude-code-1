import { describe, expect, test } from 'bun:test'

/**
 * densable 2.1.234 StickyTracker (SEA jpw) gate — pure mirror of:
 *   if (!force && lastIdx === idx) return
 *   lastIdx = idx
 *   if (text == null) set(null); else set({text,...})
 *
 * Official has NO miss hysteresis / mid-list hold / isSameStickyPrompt.
 * Stability comes from idx early-return (including lastIdx===-1 while
 * already clear at bottom).
 */
function shouldApplyStickyUpdate(
  force: boolean,
  lastIdx: number,
  idx: number,
): boolean {
  if (!force && lastIdx === idx) return false
  return true
}

describe('densable StickyTracker idx dedup (2.1.234 jpw)', () => {
  test('same idx without force skips setState (including already-clear -1)', () => {
    expect(shouldApplyStickyUpdate(false, 3, 3)).toBe(false)
    expect(shouldApplyStickyUpdate(false, -1, -1)).toBe(false)
  })

  test('idx change applies (bottom clear -1, or new prompt)', () => {
    expect(shouldApplyStickyUpdate(false, 3, -1)).toBe(true)
    expect(shouldApplyStickyUpdate(false, -1, 2)).toBe(true)
    expect(shouldApplyStickyUpdate(false, 2, 5)).toBe(true)
  })

  test('force reapplies even when idx unchanged (post-clicked suppress)', () => {
    expect(shouldApplyStickyUpdate(true, 3, 3)).toBe(true)
    expect(shouldApplyStickyUpdate(true, -1, -1)).toBe(true)
  })
})
