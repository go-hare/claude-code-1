/**
 * densable 2.1.227 Zsm + tam — query match ranges for slash-menu bold highlight.
 */
import { describe, expect, test } from 'bun:test'
import {
  expandMatchRangesToGraphemes,
  findQueryMatchRanges,
} from '../queryMatchRanges.js'

describe('findQueryMatchRanges', () => {
  test('contiguous substring match (case-insensitive)', () => {
    expect(findQueryMatchRanges('/commit', 'com')).toEqual([[1, 4]])
  })

  test('fuzzy sequential chars when no contiguous', () => {
    // densable: per-char sequential indexOf
    expect(findQueryMatchRanges('/abcde', 'ace')).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ])
  })

  test('contiguousOnly skips fuzzy', () => {
    expect(findQueryMatchRanges('/abcde', 'ace', true)).toEqual([])
    expect(findQueryMatchRanges('/abcde', 'bcd', true)).toEqual([[2, 5]])
  })

  test('empty query yields no ranges', () => {
    expect(findQueryMatchRanges('/commit', '')).toEqual([])
  })

  test('no match yields empty', () => {
    expect(findQueryMatchRanges('/commit', 'xyz')).toEqual([])
  })

  test('emoji / multi-byte: length-changing lower skips (glyph safety)', () => {
    // densable: if toLowerCase changes length, return []
    // Most emoji: length stable under toLowerCase; still expand via grapheme when needed.
    const emoji = '🚀 rocket'
    const ranges = findQueryMatchRanges(emoji, 'rocket')
    // "rocket" contiguous at index after emoji+space
    expect(ranges.length).toBeGreaterThanOrEqual(1)
    // slice of each range should not throw and should reconstruct
    for (const [s, e] of ranges) {
      expect(e).toBeGreaterThan(s)
      expect(emoji.slice(s, e).length).toBeGreaterThan(0)
    }
  })
})

describe('expandMatchRangesToGraphemes', () => {
  test('no-op for plain ASCII', () => {
    expect(expandMatchRangesToGraphemes('hello', [[1, 3]])).toEqual([[1, 3]])
  })

  test('expands into full emoji grapheme when range mid-codepoint', () => {
    // 🚀 is U+1F680 (surrogate pair, length 2 in JS)
    const text = '🚀ok'
    // mid-surrogate start would be wrong; expand should snap to 0
    const expanded = expandMatchRangesToGraphemes(text, [[1, 2]])
    expect(expanded[0]![0]).toBe(0)
    expect(expanded[0]![1]).toBeGreaterThanOrEqual(2)
  })
})
