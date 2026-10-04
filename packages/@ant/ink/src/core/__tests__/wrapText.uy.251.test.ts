import { describe, expect, test } from 'bun:test'
import wrapText from '../wrap-text.js'

describe('densable uy wrap aliases', () => {
  test('end truncates like truncate (ellipsis at end)', () => {
    const a = wrapText('abcdefghij', 5, 'end')
    const b = wrapText('abcdefghij', 5, 'truncate')
    expect(a).toBe(b)
    expect(a).toContain('…')
    expect(a.length).toBeLessThan('abcdefghij'.length)
  })

  test('middle truncates like truncate-middle', () => {
    const a = wrapText('abcdefghij', 5, 'middle')
    const b = wrapText('abcdefghij', 5, 'truncate-middle')
    expect(a).toBe(b)
    expect(a).toContain('…')
  })

  test('wrap-stream still hard-wraps', () => {
    const out = wrapText('abcdefghij', 5, 'wrap-stream')
    expect(out.includes('\n')).toBe(true)
  })
})

describe('densable qv wrap-stream paint pop', () => {
  // gold `_g` @188697565: wrap-text does not pop; paint pops the last *visual*
  // row. A long first paragraph without `\n` still has a wrapped prefix.
  function paintPop(text: string, maxWidth: number): string {
    const origLines = text.replace(/\r\n?/g, '\n').split('\n')
    const outLines: string[] = []
    for (const orig of origLines) {
      outLines.push(...wrapText(orig, maxWidth, 'wrap').split('\n'))
    }
    outLines.pop()
    return outLines.join('\n')
  }

  test('a long first paragraph keeps the wrapped prefix after pop', () => {
    const para = 'A'.repeat(50)
    const wrapped = wrapText(para, 10, 'wrap-stream')
    expect(wrapped.split('\n').length).toBeGreaterThan(1)
    const painted = paintPop(para, 10)
    expect(painted.length).toBeGreaterThan(0)
    expect(painted.startsWith('A'.repeat(10))).toBe(true)
    expect(painted.includes('\n')).toBe(true)
  })

  test('a single visual row pops to empty (KEEP wrap-stream)', () => {
    expect(paintPop('short', 80)).toBe('')
  })
})
