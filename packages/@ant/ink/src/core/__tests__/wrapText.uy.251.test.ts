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
