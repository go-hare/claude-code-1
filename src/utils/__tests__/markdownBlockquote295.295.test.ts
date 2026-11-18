import { describe, expect, test } from 'bun:test'
import stripAnsi from 'strip-ansi'
import {
  applyMarkdown,
  MAX_ITALIC_QUOTE_DEPTH,
  MAX_LEXER_NESTING_DEPTH,
  MAX_QUOTE_BARS,
} from '../markdown.js'

describe('Official 2.1.295 #409 deeply nested blockquote protection', () => {
  test('renders shallow blockquotes (< 6 levels) normally', () => {
    const out = stripAnsi(applyMarkdown('> hello\n>\n> world', 'dark'))
    expect(out).toContain('hello')
    expect(out).toContain('world')
  })

  test('caps rendered quote bars at MAX_QUOTE_BARS (16) for >6 nested quotes', () => {
    expect(MAX_ITALIC_QUOTE_DEPTH).toBe(6)
    expect(MAX_QUOTE_BARS).toBe(16)
    const md = `${'> '.repeat(24)}deep`
    const out = stripAnsi(applyMarkdown(md, 'dark'))
    expect(out).toContain('deep')
    // Count blockquote bar occurrences on the line: must not exceed MAX_QUOTE_BARS (16)
    const bars = out.match(/│/g)?.length ?? 0
    expect(bars).toBeLessThanOrEqual(MAX_QUOTE_BARS)
  })

  test('handles 150+ progressively nested quote lines fast without hanging or OOM', () => {
    expect(MAX_LEXER_NESTING_DEPTH).toBe(100)
    const lines: string[] = []
    for (let i = 1; i <= 150; i++) {
      lines.push(`${'>'.repeat(i)} line ${i}`)
    }
    const start = performance.now()
    const out = stripAnsi(applyMarkdown(lines.join('\n'), 'dark'))
    const elapsedMs = performance.now() - start
    expect(out).toContain('line 1')
    expect(out).toContain('line 150')
    expect(elapsedMs).toBeLessThan(2000)
  })
})
