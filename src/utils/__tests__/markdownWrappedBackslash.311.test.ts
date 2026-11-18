import { describe, expect, test } from 'bun:test'
import { applyMarkdown } from '../markdown.js'

describe('markdown wrappedBackslash (2.1.311 #1255)', () => {
  test('preserves lone backslash in quotes and brackets', () => {
    expect(applyMarkdown('"\\"', 'dark')).toBe('"\\"')
    expect(applyMarkdown("('\\')", 'dark')).toBe("('\\')")
    expect(applyMarkdown('(\\)', 'dark')).toBe('(\\)')
    expect(applyMarkdown('[\\]', 'dark')).toBe('[\\]')
    expect(applyMarkdown('{\\}', 'dark')).toBe('{\\}')
    expect(applyMarkdown('<\\>', 'dark')).toBe('<\\>')
  })

  test('preserves normal markdown escapes outside wrapped lone backslash', () => {
    expect(applyMarkdown('foo(\\)bar', 'dark')).toBe('foo()bar')
    expect(applyMarkdown('(\\*bold*)', 'dark')).toBe('(*bold*)')
  })
})
