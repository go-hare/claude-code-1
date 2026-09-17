/**
 * densable 2.1.246 #9 — first-500 probe sees `+` / `N)` lists and setext `=`.
 */
import { describe, expect, test } from 'bun:test'
import { hasMarkdownSyntax } from '../Markdown.js'

describe('hasMarkdownSyntax (2.1.246 #9)', () => {
  test('plus list is markdown', () => {
    expect(hasMarkdownSyntax('+ item')).toBe(true)
  })

  test('N) ordered list is markdown', () => {
    expect(hasMarkdownSyntax('1) item')).toBe(true)
  })

  test('setext = underline is markdown', () => {
    expect(hasMarkdownSyntax('Title\n=======')).toBe(true)
  })

  test('N. ordered list still matches', () => {
    expect(hasMarkdownSyntax('1. item')).toBe(true)
  })

  test('plain sentence is not markdown', () => {
    expect(hasMarkdownSyntax('just a sentence with no markup')).toBe(false)
  })

  test('syntax after the first 500 chars is ignored', () => {
    expect(hasMarkdownSyntax(`${'x'.repeat(500)}\n+ item`)).toBe(false)
  })
})
