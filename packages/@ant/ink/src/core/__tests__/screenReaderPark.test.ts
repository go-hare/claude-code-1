import { describe, expect, test } from 'bun:test'
import {
  computeScreenReaderPark,
  countNewlines,
  hardWrapScreenReaderLine,
  materializeScreenReaderFrameAnsi,
  materializeScreenReaderLines,
  planAndMaterializeScreenReaderFrame,
  planScreenReaderFrameUpdate,
} from '../screenReaderPark.js'

describe('computeScreenReaderPark densable', () => {
  test('countNewlines', () => {
    expect(countNewlines('a\nb\nc')).toBe(2)
    expect(countNewlines('plain')).toBe(0)
  })

  test('returns null without cursor or out-of-range line', () => {
    expect(computeScreenReaderPark('hi', [0], 1, 80, null)).toBeNull()
    expect(
      computeScreenReaderPark('a\nb', [0, 1], 2, 80, {
        nodeStartIndex: 0,
        relativeX: 0,
        relativeY: 5,
      }),
    ).toBeNull()
  })

  test('parks at relative offset on first logical line', () => {
    // "hello" — cursor after "he" (index 2), relativeX=0 → col at width("he")
    const park = computeScreenReaderPark(
      'hello',
      [0],
      1,
      80,
      { nodeStartIndex: 2, relativeX: 0, relativeY: 0 },
      s => s.length,
    )
    expect(park).toEqual({ row: 0, col: 2 })
  })

  test('soft-wrap advances row', () => {
    // 10-col terminal, cursor at display col 25 → wrap 2, col 5
    const park = computeScreenReaderPark(
      'abcdefghijklmnopqrstuvwxyz',
      [0],
      5,
      10,
      { nodeStartIndex: 0, relativeX: 25, relativeY: 0 },
      s => s.length,
    )
    expect(park).toEqual({ row: 2, col: 5 })
  })

  test('multi-line uses lineBaseRows', () => {
    const text = 'line0\nline1'
    // node at start of line1 (index 6), base row 3 for logical line 1
    const park = computeScreenReaderPark(
      text,
      [0, 3],
      10,
      80,
      { nodeStartIndex: 6, relativeX: 2, relativeY: 0 },
      s => s.length,
    )
    expect(park).toEqual({ row: 3, col: 2 })
  })
})

describe('screenReader frame densables', () => {
  test('hardWrapScreenReaderLine', () => {
    expect(hardWrapScreenReaderLine('', 4)).toEqual([''])
    expect(hardWrapScreenReaderLine('abcdef', 3)).toEqual(['abc', 'def'])
  })

  test('materializeScreenReaderLines tracks base rows', () => {
    const { lines, lineBaseRows } = materializeScreenReaderLines('hi\nworld', 3)
    // "hi" → 1 row; "world" hard-wraps to "wor"+"ld"
    expect(lineBaseRows).toEqual([0, 1])
    expect(lines).toEqual(['hi', 'wor', 'ld'])
  })

  test('planScreenReaderFrameUpdate skips unchanged frame', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'hello',
      columns: 80,
      prevLines: ['hello'],
      prevPark: { row: 0, col: 5 },
      terminalRows: 24,
      cursor: null,
    })
    expect(plan.skip).toBe(true)
    expect(plan.linesUnchanged).toBe(true)
  })

  test('planScreenReaderFrameUpdate rewrites from first diff', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'a\nb\nc',
      columns: 80,
      prevLines: ['a', 'x', 'c'],
      prevPark: { row: 2, col: 1 },
      terminalRows: 24,
      cursor: null,
    })
    expect(plan.skip).toBe(false)
    expect(plan.rewriteFrom).toBe(1)
    expect(plan.rewriteLines).toEqual(['b', 'c'])
  })

  test('materializeScreenReaderFrameAnsi densable', () => {
    expect(
      materializeScreenReaderFrameAnsi({
        skip: true,
        park: { row: 0, col: 0 },
        rewriteFrom: 0,
        rewriteLines: [],
        prevLastRow: 0,
        prevPark: { row: 0, col: 0 },
        prevLineCount: 1,
        lastRow: 0,
        parkChanged: false,
        linesUnchanged: true,
      }),
    ).toBe('')

    const ansi = materializeScreenReaderFrameAnsi({
      skip: false,
      park: { row: 1, col: 1 },
      rewriteFrom: 1,
      rewriteLines: ['b', 'c'],
      prevLastRow: 2,
      prevPark: { row: 2, col: 1 },
      prevLineCount: 3,
      lastRow: 2,
      parkChanged: true,
      linesUnchanged: false,
    })
    // s3n erases prevLineCount-rewriteFrom=2 lines with CUU between
    expect(ansi).toContain('\x1b[2K')
    expect(ansi).toContain('\x1b[1A')
    expect(ansi).toContain('b')
    expect(ansi).toContain('c')
    // park CHA col 2 (1-based)
    expect(ansi).toContain('\x1b[2G')

    const combined = planAndMaterializeScreenReaderFrame({
      fullText: 'hello',
      columns: 80,
      prevLines: ['hello'],
      prevPark: { row: 0, col: 5 },
      terminalRows: 24,
      cursor: null,
    })
    expect(combined.plan.skip).toBe(true)
    expect(combined.ansi).toBe('')
    expect(combined.lines).toEqual(['hello'])
  })
})
