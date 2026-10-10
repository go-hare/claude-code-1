/**
 * densable 2.1.229 #8 — MarkdownTable narrow terminal clamps for String.repeat.
 * densable 2.1.289 — wr `cr=200` truncation footer + xhr screen-reader copy.
 *
 * Full Ink render of MarkdownTable needs a terminal host; unit-test the
 * densable-aligned clamp used for vertical separators and border mid.repeat.
 */
import { describe, expect, test } from 'bun:test'
import {
  formatScreenReaderTable,
  markdownTableTruncationFooter,
  MAX_TABLE_ROWS,
} from '../MarkdownTable.js'

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

describe('densable 2.1.289 MarkdownTable wr extras', () => {
  test('cr=200 body cap + Be truncation copy', () => {
    expect(MAX_TABLE_ROWS).toBe(200)
    expect(markdownTableTruncationFooter(1)).toBe('… 1 more row not shown')
    expect(markdownTableTruncationFooter(3)).toBe('… 3 more rows not shown')
  })

  test('xhr screen-reader sentences Header: value.', () => {
    expect(
      formatScreenReaderTable(
        ['名字', '官方是什么'],
        [['yo() 发送口', 'minify 撞名']],
      ),
    ).toBe('名字: yo() 发送口. 官方是什么: minify 撞名.')
    expect(formatScreenReaderTable(['A'], [['already.']])).toBe('A: already.')
    expect(formatScreenReaderTable(['H1', 'H2'], [])).toBe('H1. H2.')
  })
})
