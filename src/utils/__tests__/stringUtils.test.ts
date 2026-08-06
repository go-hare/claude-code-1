import { describe, expect, test } from 'bun:test'
import {
  escapeRegExp,
  capitalize,
  plural,
  firstLineOf,
  countCharInString,
  normalizeFullWidthDigits,
  normalizeFullWidthSpace,
  safeJoinLines,
  EndTruncatingAccumulator,
  truncateToLines,
  truncateCodeUnitsSafe,
} from '../stringUtils'

describe('escapeRegExp', () => {
  test('escapes special regex chars', () => {
    expect(escapeRegExp('a.b*c?d')).toBe('a\\.b\\*c\\?d')
  })

  test('escapes brackets and parens', () => {
    expect(escapeRegExp('[foo](bar)')).toBe('\\[foo\\]\\(bar\\)')
  })

  test('escapes all special chars', () => {
    const allSpecialChars = '^$' + '{}()|[]\\.*+?'
    expect(escapeRegExp(allSpecialChars)).toBe(
      '\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\\\.\\*\\+\\?',
    )
  })

  test('returns normal string unchanged', () => {
    expect(escapeRegExp('hello')).toBe('hello')
  })
})

describe('capitalize', () => {
  test('uppercases first char', () => {
    expect(capitalize('hello')).toBe('Hello')
  })

  test('does NOT lowercase rest', () => {
    expect(capitalize('fooBar')).toBe('FooBar')
  })

  test('handles single char', () => {
    expect(capitalize('a')).toBe('A')
  })

  test('handles empty string', () => {
    expect(capitalize('')).toBe('')
  })
})

describe('plural', () => {
  test('returns singular for 1', () => {
    expect(plural(1, 'file')).toBe('file')
  })

  test('returns plural for 0', () => {
    expect(plural(0, 'file')).toBe('files')
  })

  test('returns plural for many', () => {
    expect(plural(3, 'file')).toBe('files')
  })

  test('uses custom plural form', () => {
    expect(plural(2, 'entry', 'entries')).toBe('entries')
  })
})

describe('firstLineOf', () => {
  test('returns first line of multiline string', () => {
    expect(firstLineOf('line1\nline2\nline3')).toBe('line1')
  })

  test('returns whole string if no newline', () => {
    expect(firstLineOf('single line')).toBe('single line')
  })

  test('returns empty string for leading newline', () => {
    expect(firstLineOf('\nline2')).toBe('')
  })
})

describe('countCharInString', () => {
  test('counts occurrences of a character', () => {
    expect(countCharInString('hello world', 'l')).toBe(3)
  })

  test('returns 0 for no match', () => {
    expect(countCharInString('hello', 'z')).toBe(0)
  })

  test('counts from start offset', () => {
    expect(countCharInString('aabaa', 'a', 2)).toBe(2)
  })

  test('returns 0 for empty string', () => {
    expect(countCharInString('', 'a')).toBe(0)
  })
})

describe('normalizeFullWidthDigits', () => {
  test('converts full-width digits to half-width', () => {
    expect(normalizeFullWidthDigits('０１２３４５６７８９')).toBe('0123456789')
  })

  test('leaves half-width digits unchanged', () => {
    expect(normalizeFullWidthDigits('0123')).toBe('0123')
  })

  test('handles mixed content', () => {
    expect(normalizeFullWidthDigits('test１２３')).toBe('test123')
  })
})

describe('normalizeFullWidthSpace', () => {
  test('converts full-width space to half-width', () => {
    expect(normalizeFullWidthSpace('a\u3000b')).toBe('a b')
  })

  test('leaves normal spaces unchanged', () => {
    expect(normalizeFullWidthSpace('a b')).toBe('a b')
  })
})

describe('safeJoinLines', () => {
  test('joins lines with delimiter', () => {
    expect(safeJoinLines(['a', 'b', 'c'], ',')).toBe('a,b,c')
  })

  test('truncates when exceeding maxSize', () => {
    const result = safeJoinLines(['hello', 'world', 'foo'], ',', 12)
    expect(result.length).toBeLessThanOrEqual(12 + '...[truncated]'.length)
    expect(result).toContain('...[truncated]')
  })

  test('returns empty string for empty input', () => {
    expect(safeJoinLines([])).toBe('')
  })
})

describe('EndTruncatingAccumulator', () => {
  test('accumulates text', () => {
    const acc = new EndTruncatingAccumulator(100)
    acc.append('hello ')
    acc.append('world')
    expect(acc.toString()).toBe('hello world')
  })

  test('truncates when exceeding maxSize', () => {
    const acc = new EndTruncatingAccumulator(10)
    acc.append('12345678901234567890')
    expect(acc.truncated).toBe(true)
    expect(acc.length).toBe(10)
  })

  test('reports total bytes received', () => {
    const acc = new EndTruncatingAccumulator(5)
    acc.append('1234567890')
    expect(acc.totalBytes).toBe(10)
  })

  test('clear resets state', () => {
    const acc = new EndTruncatingAccumulator(100)
    acc.append('hello')
    acc.clear()
    expect(acc.toString()).toBe('')
    expect(acc.length).toBe(0)
    expect(acc.truncated).toBe(false)
  })

  test('stops accepting data once truncated and full', () => {
    const acc = new EndTruncatingAccumulator(5)
    acc.append('12345')
    acc.append('67890')
    expect(acc.length).toBe(5)
    acc.append('more')
    expect(acc.length).toBe(5)
  })
})

describe('truncateToLines', () => {
  test('returns text unchanged if within limit', () => {
    expect(truncateToLines('a\nb\nc', 5)).toBe('a\nb\nc')
  })

  test('truncates text exceeding limit', () => {
    expect(truncateToLines('a\nb\nc\nd\ne', 3)).toBe('a\nb\nc…')
  })

  test('handles single line', () => {
    expect(truncateToLines('hello', 1)).toBe('hello')
  })
})

// densable 2.1.212 #13 — Jd(e, t) surrogate-safe code-unit slice
describe('truncateCodeUnitsSafe (densable Jd)', () => {
  test('returns original when within limit', () => {
    expect(truncateCodeUnitsSafe('hello', 10)).toBe('hello')
  })

  test('slices at maxCodeUnits for ASCII', () => {
    expect(truncateCodeUnitsSafe('abcdefghij', 5)).toBe('abcde')
  })

  test('drops lone high surrogate at cut (emoji mid-pair)', () => {
    // 👋 is U+1F44B → surrogate pair \uD83D\uDC4B (2 code units)
    const text = 'hello👋world'
    // slice(0, 6) lands on high surrogate of 👋 — densable drops it
    expect(truncateCodeUnitsSafe(text, 6)).toBe('hello')
    // slice(0, 7) keeps full emoji
    expect(truncateCodeUnitsSafe(text, 7)).toBe('hello👋')
  })

  test('auto-mode reason formula length>80 → Jd(reason,79)+…', () => {
    // Build a reason that ends with a high surrogate at unit 79
    const prefix = 'x'.repeat(78)
    const emoji = '👋' // 2 units
    const reason = prefix + emoji + 'tail'
    expect(reason.length).toBeGreaterThan(80)
    let hint = reason
    if (hint.length > 80) {
      hint = `${truncateCodeUnitsSafe(hint, 79)}…`
    }
    // 78 x's + high-surrogate would be cut → densable drops high → 78 x's + …
    expect(hint).toBe(`${prefix}…`)
    expect(hint.includes('\uD83D')).toBe(false)
    expect(hint.includes('\uDC4B')).toBe(false)
  })
})
