/**
 * densable 2.1.218 #10 — vtp/Pl IDE selection mid-emoji safe trunc.
 */
import { describe, expect, test } from 'bun:test'
import {
  IDE_SELECTION_CONTENT_MAX_CODE_UNITS,
  truncateCodeUnitsSafe,
  truncateIdeSelectionContent,
} from '../stringUtils.js'

describe('densable 2.1.218 #10 vtp / truncateIdeSelectionContent', () => {
  test('Etp is 2000', () => {
    expect(IDE_SELECTION_CONTENT_MAX_CODE_UNITS).toBe(2000)
  })

  test('short content unchanged', () => {
    expect(truncateIdeSelectionContent('hello')).toBe('hello')
  })

  test('long content uses code-unit-safe head + densable suffix', () => {
    const body = 'a'.repeat(2500)
    const out = truncateIdeSelectionContent(body)
    expect(out.endsWith('\n... (truncated)')).toBe(true)
    const head = out.slice(0, -'\n... (truncated)'.length)
    expect(head).toBe(truncateCodeUnitsSafe(body, 2000))
    expect(head.length).toBe(2000)
  })

  test('does not cut mid-surrogate pair (emoji)', () => {
    // Family emoji is multi-code-unit; place a high surrogate at the cut.
    // Build string of length 2001 where index 1999 is high surrogate of 😀
    const smile = '😀' // length 2
    const prefix = 'x'.repeat(1999)
    // prefix(1999) + smile → length 2001; cut at 2000 would land on high surrogate
    const text = prefix + smile + 'y'.repeat(100)
    expect(text.length).toBeGreaterThan(2000)
    const out = truncateIdeSelectionContent(text)
    const head = out.slice(0, -'\n... (truncated)'.length)
    // Must not end with lone high surrogate
    const last = head.charCodeAt(head.length - 1)
    expect(last < 0xd800 || last > 0xdbff).toBe(true)
    // densable Pl drops the high surrogate at cut → head length 1999
    expect(head.length).toBe(1999)
  })
})
