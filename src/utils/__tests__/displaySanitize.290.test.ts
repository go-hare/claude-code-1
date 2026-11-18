import { describe, expect, test } from 'bun:test'
import {
  guardCombiningRuns,
  safeNormalizeNFKC,
  safeNormalizeNFKD,
  sanitizeNewlinesForDisplay,
  softWrapLongLines,
  stripControlChars,
  stripControlCharsKeepWhitespace,
} from '../displaySanitize.js'
import { LIST_INK_MAX_DEPTH, LIST_INK_MAX_NODES } from '../markdown.js'

describe('v2.1.290 displaySanitize & markdown alignment (#17, #58, #106, #118)', () => {
  test('#17 LIST_INK_MAX_DEPTH=64 and LIST_INK_MAX_NODES=300', () => {
    expect(LIST_INK_MAX_DEPTH).toBe(64)
    expect(LIST_INK_MAX_NODES).toBe(300)
  })

  test('#58 softWrapLongLines (ROa) leaves <=4096-char lines untouched and chunks >4096-char lines at <=256 chars', () => {
    const short = 'a'.repeat(4096)
    expect(softWrapLongLines(short)).toBe(short)

    const long = 'x'.repeat(4097)
    const wrapped = softWrapLongLines(long)
    const lines = wrapped.split('\n')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(256)
    }
    expect(lines.join('')).toBe(long)
  })

  test('#106 guardCombiningRuns / safeNormalizeNFKC / safeNormalizeNFKD handle long combining runs in linear time', () => {
    const short = 'e\u0301'
    expect(guardCombiningRuns(short)).toBe(short)
    expect(safeNormalizeNFKC(short)).toBe('\u00e9')

    // 400 alternating combining marks (ccc=230 and ccc=220) would stall unguarded NFD/NFKC
    const adversarial = 'a' + '\u0301\u0323'.repeat(200)
    const guarded = guardCombiningRuns(adversarial)
    expect(guarded.length).toBe(adversarial.length)
    expect(safeNormalizeNFKC(adversarial)).toBe(adversarial.normalize('NFKC'))
    expect(safeNormalizeNFKD(adversarial)).toBe(adversarial.normalize('NFKD'))

    // >128-char chunked normalization
    const longText = `${'e\u0301'.repeat(100)} ${'a\u0308'.repeat(100)}`
    expect(safeNormalizeNFKC(longText)).toBe(longText.normalize('NFKC'))
  })

  test('#118 newline & control sanitization for filenames/display', () => {
    expect(sanitizeNewlinesForDisplay('foo\nbar\r\u2028\u2029baz')).toBe(
      'foo\uFFFDbar\uFFFD\uFFFD\uFFFDbaz',
    )
    expect(stripControlChars('a\x00b\t\nc\u2028d')).toBe('abcd')
    expect(stripControlCharsKeepWhitespace('a\x00b\t\nc\u2028d')).toBe(
      'ab\t\ncd',
    )
    expect(stripControlChars(null)).toBe('')
  })
})
