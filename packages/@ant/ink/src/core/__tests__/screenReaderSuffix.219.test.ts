/**
 * densable 2.1.219 #15 — screen-reader suffix-append fast path.
 *
 * Typing on a clean SR frame should echo only the new character(s), not
 * erase+rewrite the entire input line.
 */
import { describe, expect, test } from 'bun:test'
import {
  computeNextScreenReaderAnchor,
  isGraphemeBoundary,
  materializeScreenReaderFrameAnsi,
  planScreenReaderFrameUpdate,
} from '../screenReaderPark.js'

describe('isGraphemeBoundary (densable xuy)', () => {
  test('offset 0 / past end are boundaries', () => {
    expect(isGraphemeBoundary('hi', 0)).toBe(true)
    expect(isGraphemeBoundary('hi', 2)).toBe(true)
    expect(isGraphemeBoundary('hi', 99)).toBe(true)
  })

  test('mid-codeunit of multi-byte is not a boundary', () => {
    // family emoji is multi-codepoint grapheme in modern Segmenter
    const text = 'a👨‍👩‍👧‍👦b'
    // first grapheme 'a' ends at 1 — boundary
    expect(isGraphemeBoundary(text, 1)).toBe(true)
    // mid-family is not
    if (text.length > 3) {
      expect(isGraphemeBoundary(text, 2)).toBe(false)
    }
  })
})

describe('suffix-append plan (densable 2.1.219 #15)', () => {
  test('clean anchor + single char append uses suffixAppend', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'hellox',
      columns: 80,
      prevLines: ['hello'],
      prevPark: { row: 0, col: 5 },
      terminalRows: 24,
      cursor: null,
      prevAnchor: 'clean',
      stringWidth: s => s.length,
    })
    expect(plan.skip).toBe(false)
    expect(plan.suffixAppend).toEqual({
      lineIndex: 0,
      prevWidth: 5,
      suffix: 'x',
    })
    expect(plan.nextAnchor).toBeUndefined()
    const ansi = materializeScreenReaderFrameAnsi(plan)
    // no erase (CSI 2K)
    expect(ansi).not.toContain('\x1b[2K')
    expect(ansi).toContain('x')
    // CHA to prevWidth+1 = 6
    expect(ansi).toContain('\x1b[6G')
  })

  test('broken anchor falls back to full rewrite', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'hellox',
      columns: 80,
      prevLines: ['hello'],
      prevPark: { row: 0, col: 5 },
      terminalRows: 24,
      cursor: null,
      prevAnchor: 'broken',
      stringWidth: s => s.length,
    })
    expect(plan.suffixAppend).toBeUndefined()
    expect(plan.skip).toBe(false)
    const ansi = materializeScreenReaderFrameAnsi(plan)
    expect(ansi).toContain('\x1b[2K')
  })

  test('lastRowAnchored only when common is last line and park on it', () => {
    const ok = planScreenReaderFrameUpdate({
      fullText: 'a\nbx',
      columns: 80,
      prevLines: ['a', 'b'],
      prevPark: { row: 1, col: 1 },
      terminalRows: 24,
      cursor: null,
      prevAnchor: 'lastRowAnchored',
      stringWidth: s => s.length,
    })
    expect(ok.suffixAppend).toEqual({
      lineIndex: 1,
      prevWidth: 1,
      suffix: 'x',
    })

    const no = planScreenReaderFrameUpdate({
      fullText: 'ax\nb',
      columns: 80,
      prevLines: ['a', 'b'],
      prevPark: { row: 0, col: 1 },
      terminalRows: 24,
      cursor: null,
      prevAnchor: 'lastRowAnchored',
      stringWidth: s => s.length,
    })
    // common=0 is not last line → no suffix
    expect(no.suffixAppend).toBeUndefined()
  })

  test('mid-line edit (not pure prefix) uses full rewrite', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'hXllo',
      columns: 80,
      prevLines: ['hello'],
      prevPark: { row: 0, col: 5 },
      terminalRows: 24,
      cursor: null,
      prevAnchor: 'clean',
      stringWidth: s => s.length,
    })
    expect(plan.suffixAppend).toBeUndefined()
    expect(plan.rewriteFrom).toBe(0)
  })
})

describe('computeNextScreenReaderAnchor', () => {
  test('full viewport rewrite → clean', () => {
    expect(
      computeNextScreenReaderAnchor({
        prevAnchor: 'broken',
        rewriteFrom: 0,
        newLineCount: 3,
        prevLineCount: 3,
        park: { row: 2, col: 0 },
        lastRow: 2,
        prevPark: { row: 2, col: 0 },
        prevLastRow: 2,
        brokenByScroll: false,
        terminalRows: 24,
      }),
    ).toBe('clean')
  })

  test('brokenByScroll → broken', () => {
    expect(
      computeNextScreenReaderAnchor({
        prevAnchor: 'clean',
        rewriteFrom: 0,
        newLineCount: 1,
        prevLineCount: 10,
        park: { row: 0, col: 0 },
        lastRow: 0,
        prevPark: { row: 9, col: 0 },
        prevLastRow: 9,
        brokenByScroll: true,
        terminalRows: 5,
      }),
    ).toBe('broken')
  })

  test('park-only lastRowAnchored breaks when park leaves last row', () => {
    expect(
      computeNextScreenReaderAnchor({
        prevAnchor: 'lastRowAnchored',
        rewriteFrom: 1,
        newLineCount: 2,
        prevLineCount: 2,
        park: { row: 0, col: 0 },
        lastRow: 1,
        prevPark: { row: 1, col: 3 },
        prevLastRow: 1,
        brokenByScroll: false,
        terminalRows: 24,
        linesUnchanged: true,
      }),
    ).toBe('broken')
  })
})
