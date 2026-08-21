/**
 * densable SEA r7/t7 — isOutputLineTruncated typeof guard + wrap-aware probe.
 * Gold: docs/upstream-extraction/v2.1.237/snippets/gold-isOutputLineTruncated-r7.txt
 *
 * Crash: MessagesBoundary → MCPTool.isResultTruncated(object) → content.indexOf
 */
import { describe, expect, test } from 'bun:test'
import { isOutputLineTruncated } from '../terminal.js'

describe('densable isOutputLineTruncated r7/t7', () => {
  test('non-string returns false (MessagesBoundary / MCPTool object result)', () => {
    expect(isOutputLineTruncated(undefined)).toBe(false)
    expect(isOutputLineTruncated(null)).toBe(false)
    expect(isOutputLineTruncated({ stdout: 'a\nb\nc\nd\ne' })).toBe(false)
    expect(isOutputLineTruncated(['a', 'b', 'c', 'd'])).toBe(false)
    expect(isOutputLineTruncated(42)).toBe(false)
  })

  test('short string without width: not truncated', () => {
    expect(isOutputLineTruncated('one line')).toBe(false)
    expect(isOutputLineTruncated('a\nb\nc')).toBe(false)
    // exactly 3 newlines → 4 lines; SEA needs >3 newlines (4 probes find 4th)
    expect(isOutputLineTruncated('a\nb\nc\nd')).toBe(false)
  })

  test('more than MAX_LINES newlines: truncated without width', () => {
    // 4 newlines → 5 lines; after 4 successful probes pos still in range
    expect(isOutputLineTruncated('a\nb\nc\nd\ne')).toBe(true)
    // trailing nl trimEnd → same as above → still truncated
    expect(isOutputLineTruncated('a\nb\nc\nd\ne\n')).toBe(true)
    expect(isOutputLineTruncated('a\nb\nc\nd\ne\nf')).toBe(true)
  })

  test('trimEnd: trailing newlines do not inflate truncation', () => {
    // 2 content newlines + trailing empties → trimEnd → not truncated
    expect(isOutputLineTruncated('a\nb\nc\n\n\n')).toBe(false)
  })

  test('optional width: long single line wraps past visible budget', () => {
    const wide = 'x'.repeat(200)
    expect(isOutputLineTruncated(wide)).toBe(false) // no width → newline-only
    expect(isOutputLineTruncated(wide, 40)).toBe(true)
  })

  test('optional width: short single line not truncated', () => {
    expect(isOutputLineTruncated('hello', 80)).toBe(false)
  })
})
