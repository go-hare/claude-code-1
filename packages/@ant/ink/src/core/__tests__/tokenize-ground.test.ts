import { describe, expect, test } from 'bun:test'
import { createTokenizer } from '../termio/tokenize.js'

describe('tokenizer ground C0 peel (official densable $Xc 2.1.210)', () => {
  test('hello\\r peels CR into its own text token', () => {
    const t = createTokenizer({ x10Mouse: true })
    expect(t.feed('hello\r')).toEqual([
      { type: 'text', value: 'hello' },
      { type: 'text', value: '\r' },
    ])
  })

  test('hello\\r\\n collapses CRLF to single CR token', () => {
    const t = createTokenizer({ x10Mouse: true })
    expect(t.feed('hello\r\n')).toEqual([
      { type: 'text', value: 'hello' },
      { type: 'text', value: '\r' },
    ])
  })

  test('o\\r peels CR from single char', () => {
    const t = createTokenizer({ x10Mouse: true })
    expect(t.feed('o\r')).toEqual([
      { type: 'text', value: 'o' },
      { type: 'text', value: '\r' },
    ])
  })

  test('bare \\n is its own text token', () => {
    const t = createTokenizer({ x10Mouse: true })
    expect(t.feed('\n')).toEqual([{ type: 'text', value: '\n' }])
  })

  test('bare \\r\\n is single CR token', () => {
    const t = createTokenizer({ x10Mouse: true })
    expect(t.feed('\r\n')).toEqual([{ type: 'text', value: '\r' }])
  })

  test('pure printable batch stays one text token', () => {
    const t = createTokenizer({ x10Mouse: true })
    expect(t.feed('hello')).toEqual([{ type: 'text', value: 'hello' }])
  })

  test('forOutput does not peel C0 into separate tokens', () => {
    const t = createTokenizer({ forOutput: true })
    // Without peel, CR stays inside the text run until flush of ground
    expect(t.feed('hello\r')).toEqual([{ type: 'text', value: 'hello\r' }])
  })

  test('DEL becomes standalone text token', () => {
    const t = createTokenizer({ x10Mouse: true })
    expect(t.feed('a\x7fb')).toEqual([
      { type: 'text', value: 'a' },
      { type: 'text', value: '\x7f' },
      { type: 'text', value: 'b' },
    ])
  })

  test('CSI sequences still split from text', () => {
    const t = createTokenizer({ x10Mouse: true })
    expect(t.feed('hi\x1b[A')).toEqual([
      { type: 'text', value: 'hi' },
      { type: 'sequence', value: '\x1b[A' },
    ])
  })
})
