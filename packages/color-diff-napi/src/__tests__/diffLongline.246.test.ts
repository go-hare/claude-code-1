/**
 * densable 2.1.246 #5 — ColorDiff `V`/`U`/`fe=2000` long-line truncate + marker.
 */
import { describe, expect, test } from 'bun:test'
import { ColorDiff, ColorFile, __test } from '../index'

const { truncateDiffLine, truncatedCharsMarker, DIFF_LINE_MAX } = __test

describe('densable 2.1.246 #5 diff long-line truncate', () => {
  test('V: short line is a no-op', () => {
    expect(truncateDiffLine('+hello', 1)).toEqual({
      code: 'hello',
      truncatedChars: 0,
    })
    expect(DIFF_LINE_MAX).toBe(2000)
  })

  test('V/U: over fe keeps 2000 and counts the tail', () => {
    const body = 'A'.repeat(2500)
    const { code, truncatedChars } = truncateDiffLine(`+${body}`, 1)
    expect(code).toBe('A'.repeat(2000))
    expect(truncatedChars).toBe(500)
    expect(truncatedCharsMarker(500)).toBe(' \u2026 [+500 chars]')
  })

  test('ColorDiff.render appends marker instead of wrapping the full line', () => {
    const body = 'A'.repeat(3000)
    const lines = new ColorDiff(
      {
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        lines: [`+${body}`],
      },
      null,
      'x.ts',
    ).render('dark', 80, true)
    expect(lines).not.toBeNull()
    const joined = lines!.join('\n')
    expect(joined).toContain('\u2026')
    expect(joined).toContain('[+1000 chars]')
    // 2000-cap + wrap@80 is ~27 rows; untruncated 3000 would be ~40+.
    expect(lines!.length).toBeLessThan(35)
    expect(joined.includes('A'.repeat(2500))).toBe(false)
  })

  test('ColorFile.render uses the same V/U cap', () => {
    const body = 'B'.repeat(2200)
    const lines = new ColorFile(body, 'y.ts').render('dark', 80, true)
    expect(lines).not.toBeNull()
    const joined = lines!.join('\n')
    expect(joined).toContain('\u2026')
    expect(joined).toContain('[+200 chars]')
  })
})
