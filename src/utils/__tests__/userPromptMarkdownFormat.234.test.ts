import { describe, expect, test } from 'bun:test'
import { Marked, marked, type Token } from 'marked'
import { configureMarked, formatToken } from '../markdown.js'

describe('formatToken promptMode densable #36', () => {
  test('$6m: promptMode skips issue-ref linkify', () => {
    configureMarked()
    const tokens = marked.lexer('see owner/repo#123 please')
    const plain = tokens
      .map(t => formatToken(t, 'dark', 0, null, null, null, false))
      .join('')
    const prompt = tokens
      .map(t => formatToken(t, 'dark', 0, null, null, null, true))
      .join('')
    // Without promptMode hyperlinks may wrap; with promptMode raw text stays.
    expect(prompt).toContain('owner/repo#123')
    expect(prompt).not.toContain('\x1b]8;;')
    // Non-prompt path may or may not hyperlink depending on terminal support;
    // at least ensure both paths render the reference somehow.
    expect(plain).toContain('owner/repo#123')
  })

  test('promptMode lean lexer disables tables/links', () => {
    const lean = new Marked({
      tokenizer: {
        emStrong(src: string) {
          return src.startsWith('_') ? undefined : false
        },
        table() {
          return undefined
        },
        blockquote() {
          return undefined
        },
        hr() {
          return undefined
        },
        lheading() {
          return undefined
        },
        link() {
          return undefined
        },
        autolink() {
          return undefined
        },
        url() {
          return undefined
        },
        escape() {
          return undefined
        },
        br() {
          return undefined
        },
      },
    })
    const src = [
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '`code` and **bold**',
    ].join('\n')
    const fullTypes = marked.lexer(src).map((t: Token) => t.type)
    const leanTypes = lean.lexer(src).map((t: Token) => t.type)
    expect(fullTypes).toContain('table')
    expect(leanTypes).not.toContain('table')
    expect(
      leanTypes.some(t => t === 'paragraph' || t === 'code' || t === 'list'),
    ).toBe(true)
  })
})
