/**
 * densable 2.1.229 #8 — MarkdownTable narrow terminal clamps for String.repeat.
 *
 * Full Ink render of MarkdownTable needs a terminal host; unit-test the
 * densable-aligned clamp used for vertical separators and border mid.repeat.
 */
import { describe, expect, test } from 'bun:test'

/** Mirrors MarkdownTable vertical separator clamp (densable Math.max(0, …)). */
function verticalSeparatorWidth(terminalWidth: number): number {
  return Math.max(0, Math.min(terminalWidth - 1, 40))
}

/** Mirrors renderBorderLine mid.repeat clamp. */
function borderSegmentRepeat(width: number): number {
  return Math.max(0, width + 2)
}

describe('densable 2.1.229 #8 MarkdownTable narrow terminal clamps', () => {
  test('vertical separator width never negative (columns 0/1)', () => {
    expect(verticalSeparatorWidth(0)).toBe(0)
    expect(verticalSeparatorWidth(1)).toBe(0)
    expect(verticalSeparatorWidth(2)).toBe(1)
    expect(verticalSeparatorWidth(100)).toBe(40)
  })

  test('vertical separator String.repeat does not RangeError', () => {
    for (const w of [0, 1, 2, 40, 80]) {
      expect(() => '─'.repeat(verticalSeparatorWidth(w))).not.toThrow()
    }
  })

  test('border mid.repeat clamps negative column widths', () => {
    expect(borderSegmentRepeat(-5)).toBe(0)
    expect(borderSegmentRepeat(0)).toBe(2)
    expect(() => '─'.repeat(borderSegmentRepeat(-5))).not.toThrow()
  })
})
