import { describe, expect, test } from 'bun:test'
import {
  OVERLAY_MAX_ITEMS,
  splitDescriptionAtWidth,
  suggestionRowBudget,
  suggestionRowHeight,
  suggestionWindow,
} from '../PromptInputFooterSuggestions.js'

describe('suggestionRowBudget (densable 2.1.289 Kge)', () => {
  test('overlay uses fixed 5', () => {
    expect(suggestionRowBudget(40, true)).toBe(OVERLAY_MAX_ITEMS)
    expect(OVERLAY_MAX_ITEMS).toBe(5)
  })

  test('inline is max(1, min(max(6, rows/2), rows-3))', () => {
    expect(suggestionRowBudget(40, false)).toBe(20)
    expect(suggestionRowBudget(10, false)).toBe(6)
    expect(suggestionRowBudget(5, false)).toBe(2)
    expect(suggestionRowBudget(3, false)).toBe(1)
  })
})

describe('suggestionWindow (densable 2.1.289 Kge)', () => {
  test('two-line rows fill a 5-row budget with two items', () => {
    expect(suggestionWindow([2, 2, 2, 2], 0, 5)).toEqual({
      start: 0,
      end: 2,
      used: 4,
    })
  })

  test('selection keeps at most half the budget above it', () => {
    expect(suggestionWindow([1, 1, 1, 1, 1, 1, 1, 1], 5, 5)).toEqual({
      start: 3,
      end: 8,
      used: 5,
    })
  })

  test('backfills above when the tail runs out', () => {
    expect(suggestionWindow([1, 1, 1, 1, 1, 1], 5, 5)).toEqual({
      start: 1,
      end: 6,
      used: 5,
    })
  })
})

describe('splitDescriptionAtWidth (densable 2.1.289 $e)', () => {
  test('fits → no remainder', () => {
    expect(splitDescriptionAtWidth('short text', 20)).toEqual([
      'short text',
      '',
    ])
  })

  test('breaks at the last word boundary', () => {
    expect(splitDescriptionAtWidth('alpha beta gamma', 13)).toEqual([
      'alpha beta',
      'gamma',
    ])
  })

  test('cut exactly before a space drops the space', () => {
    expect(splitDescriptionAtWidth('alpha beta gamma', 10)).toEqual([
      'alpha beta',
      'gamma',
    ])
  })

  test('single long word hard-splits', () => {
    expect(splitDescriptionAtWidth('abcdefghij', 4)).toEqual(['abcd', 'efghij'])
  })
})

describe('suggestionRowHeight (densable 2.1.289 bo)', () => {
  const item = (description?: string) => ({
    id: 'command-x',
    displayText: '/x',
    description,
  })

  test('no description or unified id → 1', () => {
    expect(suggestionRowHeight(item(), 80, 20)).toBe(1)
    expect(
      suggestionRowHeight(
        { id: 'file-a', displayText: 'a', description: 'x'.repeat(200) },
        80,
        20,
      ),
    ).toBe(1)
  })

  test('description wider than the column → 2', () => {
    expect(suggestionRowHeight(item('x'.repeat(57)), 80, 20)).toBe(2)
    expect(suggestionRowHeight(item('x'.repeat(56)), 80, 20)).toBe(1)
  })
})
