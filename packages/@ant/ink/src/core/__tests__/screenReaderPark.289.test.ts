/**
 * densable 2.1.289 — gold onRenderScreenReader planner K/J/N 1:1.
 *
 * Gold minify (not public API):
 *   K = common prefix after `N` clamp
 *   J = K===B.length && K===x.length
 *   N = announcement start line (-1 when none)
 * `$to` CHA pre-park lives in ink.tsx; gold onRenderScreenReader inlines
 * K/J/N (not planScreenReaderFrameUpdate). Planner helpers stay for tests.
 */
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  computeNextScreenReaderAnchor,
  materializeScreenReaderFrameAnsi,
  materializeScreenReaderLines,
  planScreenReaderFrameUpdate,
} from '../screenReaderPark.js'

const INK = join(import.meta.dir, '../ink.tsx')

const declaredCursor = {
  nodeStartIndex: -1,
  relativeX: 0,
  relativeY: 0,
}

describe('densable 2.1.289 SR planner K/J/N', () => {
  test('skip is gold J (K===B.length && K===x.length) even with unused N', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'hello',
      columns: 80,
      prevLines: ['hello'],
      prevPark: { row: 0, col: 5 },
      terminalRows: 24,
      cursor: null,
    })
    expect(plan.skip).toBe(true)
    expect(plan.commonPrefixLength).toBe(1)
    expect(plan.lineCount).toBe(1)
    // Gold `$to`: !J && K<x.length && N===-1 — skip means parent must not pre-park.
    expect(plan.skip || plan.commonPrefixLength! >= plan.lineCount!).toBe(true)
  })

  test('first-diff rewrite exposes gold K as rewriteFrom / commonPrefixLength', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'a\nb\nc',
      columns: 80,
      prevLines: ['a', 'x', 'c'],
      prevPark: { row: 2, col: 1 },
      terminalRows: 24,
      cursor: null,
    })
    expect(plan.skip).toBe(false)
    expect(plan.suffixAppend).toBeUndefined()
    expect(plan.suffixDelete).toBeUndefined()
    expect(plan.commonPrefixLength).toBe(1)
    expect(plan.rewriteFrom).toBe(1)
    expect(plan.lineCount).toBe(3)
    // Gold `$to` gate body: !J && K<x.length && N===-1
    expect(plan.commonPrefixLength! < plan.lineCount!).toBe(true)
  })

  test('N clamp: announcementStartLine pulls K back (if(N!==-1&&K>N)K=N)', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'a\nb\nann',
      columns: 80,
      prevLines: ['a', 'b'],
      prevPark: { row: 1, col: 1 },
      terminalRows: 24,
      cursor: null,
      announcementStartLine: 2,
    })
    expect(plan.skip).toBe(false)
    expect(plan.commonPrefixLength).toBe(2)
    expect(plan.rewriteFrom).toBe(2)
    expect(plan.lineCount).toBe(3)
    expect(plan.suffixAppend).toBeUndefined()
    expect(plan.suffixDelete).toBeUndefined()
  })

  test('srPreParked blocks suffix-append (gold !this.srPreParked)', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'hellox',
      columns: 80,
      prevLines: ['hello'],
      prevPark: { row: 0, col: 5 },
      terminalRows: 24,
      cursor: null,
      prevAnchor: 'clean',
      stringWidth: s => s.length,
      srPreParked: true,
    })
    expect(plan.suffixAppend).toBeUndefined()
    expect(plan.skip).toBe(false)
  })

  test('srPreParked blocks suffix-delete', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'hell',
      columns: 80,
      prevLines: ['hello'],
      prevPark: { row: 0, col: 5 },
      terminalRows: 24,
      cursor: declaredCursor,
      prevAnchor: 'clean',
      prevParkDeclared: true,
      stringWidth: s => s.length,
      srPreParked: true,
    })
    expect(plan.suffixDelete).toBeUndefined()
  })

  test('viewport empty-line walk advances K to ce when prefix matches', () => {
    // prev 6 lines, viewport 3 → ce=3. common=0 because line0 differs, but
    // lines[0..2] empty vs prev empty walk: nextIdx walks empties to ce.
    const plan = planScreenReaderFrameUpdate({
      fullText: '\n\n\nkeep',
      columns: 80,
      prevLines: ['gone', '', '', 'keep'],
      prevPark: { row: 3, col: 4 },
      terminalRows: 3,
      cursor: null,
    })
    expect(plan.skip).toBe(false)
    expect(plan.commonPrefixLength).toBe(0)
    // Gold walk: x[0..2] are '' so nextIdx hits ce=1? prevLines.length=4, rows=3 → ce=1
    // Wait: 4-3=1. viewportStart=1. common=0. walk while nextIdx<1: x[0]==='' → nextIdx=1 === ce → rewriteFrom=1
    expect(plan.rewriteFrom).toBe(1)
  })

  test('viewport walk does not clamp K when skipped rows differ (gold 289)', () => {
    const plan = planScreenReaderFrameUpdate({
      fullText: 'new\n2\n3\n4',
      columns: 80,
      prevLines: ['old', '2', '3', '4'],
      prevPark: { row: 3, col: 1 },
      terminalRows: 3,
      cursor: null,
    })
    expect(plan.commonPrefixLength).toBe(0)
    // Gold: walk breaks on first mismatch — K stays 0, not forced to ce=1
    expect(plan.rewriteFrom).toBe(0)
    expect(plan.brokenByScroll).toBe(true)
  })

  test('Ae && se>=terminalRows is clean (gold not Ae-alone broken)', () => {
    expect(
      computeNextScreenReaderAnchor({
        prevAnchor: 'clean',
        rewriteFrom: 0,
        newLineCount: 10,
        prevLineCount: 20,
        park: { row: 9, col: 0 },
        lastRow: 9,
        prevPark: { row: 19, col: 0 },
        prevLastRow: 19,
        brokenByScroll: true,
        terminalRows: 5,
      }),
    ).toBe('clean')
  })

  test('Ae && se<terminalRows is broken', () => {
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

  test('erase-only skip extra CUU when Ae (gold K>0 && !Ae)', () => {
    const ansi = materializeScreenReaderFrameAnsi({
      skip: false,
      park: { row: 0, col: 0 },
      rewriteFrom: 2,
      rewriteLines: [],
      prevLastRow: 4,
      prevPark: { row: 4, col: 0 },
      prevLineCount: 5,
      lastRow: 1,
      parkChanged: true,
      linesUnchanged: false,
      brokenByScroll: true,
      terminalRows: 24,
    })
    expect(ansi).toContain('\x1b[2K')
    // Gold extra CUU is after erase CHA (`TCh`), not the CUUs inside s3n.
    expect(ansi).toContain('\x1b[1G\x1b[1G')
    expect(ansi).not.toContain('\x1b[1G\x1b[1A\x1b[1G')
  })

  test('erase-only extra CUU when !Ae', () => {
    const ansi = materializeScreenReaderFrameAnsi({
      skip: false,
      park: { row: 1, col: 0 },
      rewriteFrom: 2,
      rewriteLines: [],
      prevLastRow: 2,
      prevPark: { row: 2, col: 0 },
      prevLineCount: 3,
      lastRow: 1,
      parkChanged: true,
      linesUnchanged: false,
      brokenByScroll: false,
      terminalRows: 24,
    })
    expect(ansi).toContain('\x1b[1G\x1b[1A\x1b[1G')
  })

  test('erase capped to terminalRows (gold evt(min(B.length-K, terminalRows)))', () => {
    const ansi = materializeScreenReaderFrameAnsi({
      skip: false,
      park: { row: 4, col: 0 },
      rewriteFrom: 0,
      rewriteLines: ['a', 'b', 'c', 'd', 'e'],
      prevLastRow: 19,
      prevPark: { row: 19, col: 0 },
      prevLineCount: 20,
      lastRow: 4,
      parkChanged: true,
      linesUnchanged: false,
      terminalRows: 3,
    })
    // 3× CSI 2K, 2× CUU between them — not 20 erases
    expect(ansi.split('\x1b[2K').length - 1).toBe(3)
  })

  test('blockquote rowPrefix prefixes wrapped rows', () => {
    const { lines } = materializeScreenReaderLines(
      'quoted',
      80,
      [],
      [[0, 6, '> ']],
    )
    expect(lines).toEqual(['> quoted'])
  })
})

describe('densable 2.1.289 onRenderScreenReader inlines K/J/N', () => {
  test('gold BODY is inline K/J/N not planScreenReaderFrameUpdate', async () => {
    const src = await Bun.file(INK).text()
    const start = src.indexOf('onRenderScreenReader(): void')
    const end = src.indexOf('pause(): void', start)
    const body = src.slice(start, end)
    expect(body).toContain('const J = K === B.length && K === x.length')
    expect(body).toContain('if (N !== -1 && K > N) K = N')
    expect(body).toContain("this.options.stdout.write(csi('G'))")
    expect(body).toContain('this.writeContent(he + xe + Ce)')
    expect(body).not.toContain('planScreenReaderFrameUpdate(')
    expect(body).not.toContain('materializeScreenReaderFrameAnsi(')
    expect(body).not.toContain('materializeScreenReaderLines(')
    expect(body).toContain('mergePreserveRanges(u)')
    expect(body).toContain('hv(r7(se), m - Ko(Ie))')
    expect(body).toContain('Iv(')
    expect(body).toContain('evt(Math.min(B.length - K, this.terminalRows))')
    expect(body).not.toContain('wrapScreenReaderLineByCells(')
    expect(body).not.toContain('isGraphemeBoundary(')
    expect(body).not.toContain('eraseScreenReaderLinesUp(')
  })

  test('planner has no analog lines/declaredPark; gold inlines T on Ink', async () => {
    const park = await Bun.file(
      join(import.meta.dir, '../screenReaderPark.ts'),
    ).text()
    expect(park).not.toContain('declaredPark?:')
    expect(park).not.toContain('lines?: readonly string[]')
    expect(park).not.toContain('lineBaseRows?: readonly number[]')
    expect(park).not.toContain('input.declaredPark')
    expect(park).not.toContain('input.lines !== undefined')
  })
})
