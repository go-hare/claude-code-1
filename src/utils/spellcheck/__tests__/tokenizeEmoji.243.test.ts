import { describe, expect, test } from 'bun:test'
import { tokenizeSpellcheckWords } from '../tokenize.js'

/**
 * densable 2.1.243 #20 — w8e starts with \\p{L} so a mark/VS after an
 * emoji is not glued onto the following word (underline would miss).
 */
describe('tokenizeSpellcheckWords emoji adjacency 243 #20', () => {
  test('plain emoji then word keeps the word span', () => {
    const spans = tokenizeSpellcheckWords('😀hello')
    expect(spans).toEqual([{ word: 'hello', start: 2, end: 7 }])
  })

  test('emoji + variation selector then typo is still a word', () => {
    const text = '❤️typo'
    const spans = tokenizeSpellcheckWords(text)
    expect(spans.map(s => s.word)).toEqual(['typo'])
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('typo')
  })

  test('ZWJ emoji then word does not swallow the letters', () => {
    const text = '👨‍👩‍👧hello'
    const spans = tokenizeSpellcheckWords(text)
    expect(spans.map(s => s.word)).toEqual(['hello'])
    const last = spans[0]!
    expect(text.slice(last.start, last.end)).toBe('hello')
  })
})
