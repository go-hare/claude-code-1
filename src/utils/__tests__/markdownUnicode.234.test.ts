/**
 * densable 2.1.234 #10 — markdown unusual Unicode / pipe-in-code tables.
 * SEA CXr: PPE / DPE / d0l / uq + j6m.table wrapper.
 */
import { describe, expect, test } from 'bun:test'
import { marked } from 'marked'
import {
  configureMarked,
  escapePipesInInlineCode,
  markdownTableHasExtraColumns,
  stripMarkdownHrefInvisibles,
  isMarkdownInvisibleCodePoint,
  formatToken,
} from '../markdown.js'

describe('densable 2.1.234 #10 markdown Unicode / PPE', () => {
  test('uq: invisible / bidi / tag code points', () => {
    expect(isMarkdownInvisibleCodePoint(0)).toBe(true)
    expect(isMarkdownInvisibleCodePoint(0x200b)).toBe(true) // ZWSP
    expect(isMarkdownInvisibleCodePoint(0x202e)).toBe(true) // RLO
    expect(isMarkdownInvisibleCodePoint(0xfeff)).toBe(true) // BOM
    expect(isMarkdownInvisibleCodePoint(0xe0001)).toBe(true) // tag
    expect(isMarkdownInvisibleCodePoint(0x41)).toBe(false) // A
  })

  test('d0l: strips invisibles and U+29C9 from href', () => {
    const dirty = `https://ex.com/​path⧉`
    expect(stripMarkdownHrefInvisibles(dirty)).toBe('https://ex.com/path')
  })

  test('PPE: escapes unescaped pipes inside matching backticks', () => {
    expect(escapePipesInInlineCode('`a|b`')).toBe('`a\\|b`')
    expect(escapePipesInInlineCode('``a|b``')).toBe('``a\\|b``')
    expect(escapePipesInInlineCode('`a\\|b`')).toBe('`a\\|b`')
    expect(escapePipesInInlineCode('plain|pipe')).toBe('plain|pipe')
    expect(escapePipesInInlineCode('no ticks')).toBe('no ticks')
  })

  test('DPE: detects body rows with cells beyond header width', () => {
    const lines = ['| a | b |', '| --- | --- |', '| `x\\|y` | z | extra |']
    expect(markdownTableHasExtraColumns(lines, 2)).toBe(true)
    expect(
      markdownTableHasExtraColumns(
        ['| a | b |', '| --- | --- |', '| `x\\|y` | z |'],
        2,
      ),
    ).toBe(false)
  })

  test('j6m.table: pipe-in-code cell stays one cell after configureMarked', () => {
    configureMarked()
    const src = '| a | b |\n| --- | --- |\n| `x|y` | z |\n'
    const tokens = marked.lexer(src)
    const table = tokens.find(t => t.type === 'table') as
      | {
          type: 'table'
          header: unknown[]
          rows: Array<Array<{ text: string }>>
        }
      | undefined
    expect(table).toBeDefined()
    expect(table!.header.length).toBe(2)
    expect(table!.rows[0]!.length).toBe(2)
    // Cell text keeps the pipe (escaped only for lexing)
    expect(table!.rows[0]![0]!.text).toContain('x|y')
  })

  test('link formatToken uses d0l-sanitized href', () => {
    configureMarked()
    const rendered = formatToken(
      {
        type: 'link',
        raw: '[t](https://ex.com/​x)',
        href: 'https://ex.com/​x',
        title: null,
        text: 't',
        tokens: [{ type: 'text', raw: 't', text: 't' }],
      } as never,
      'dark' as never,
    )
    expect(rendered).not.toContain('​')
    expect(rendered).toContain('https://ex.com/x')
  })
})
