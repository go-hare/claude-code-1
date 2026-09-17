/**
 * densable 2.1.246 #24 — /rename keeps theme promptBorder unless /color set.
 */
import { describe, expect, test } from 'bun:test'
import { toThemeColor } from '../useSwarmBanner.js'

describe('densable 2.1.246 #24 zRr promptBorder fallback', () => {
  test('q0 default without a picked color is still cyan', () => {
    expect(toThemeColor(undefined)).toBe('cyan_FOR_SUBAGENTS_ONLY')
  })

  test('standalone /rename path uses promptBorder, not cyan', () => {
    const noOverride = undefined as string | undefined
    expect(toThemeColor(noOverride, 'promptBorder')).toBe('promptBorder')
    expect(toThemeColor(noOverride ?? noOverride, 'promptBorder')).toBe(
      'promptBorder',
    )
  })

  test('user /color override still maps to the agent theme key', () => {
    expect(toThemeColor('red', 'promptBorder')).toBe('red_FOR_SUBAGENTS_ONLY')
  })
})
