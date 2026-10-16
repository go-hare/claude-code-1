/**
 * densable 2.1.289 Artifact read-ask text helpers `Tp` / `bv` / `Op` / `sc` /
 * `cC`. Expected strings were produced by evaluating the gold functions.
 */
import { describe, expect, test } from 'bun:test'
import {
  jsonQuoteAscii,
  quotedList,
  READ_FILE_ON_LINE_RULE_LIMIT,
  sweptAskText,
  truncateAskPathMiddle,
} from '../surfaces.js'

describe('READ_FILE_ON_LINE_RULE_LIMIT (Tp)', () => {
  test('is 64', () => {
    expect(READ_FILE_ON_LINE_RULE_LIMIT).toBe(64)
  })
})

describe('quotedList (bv)', () => {
  test('quotes and joins with Oxford comma', () => {
    expect(quotedList([])).toBe('')
    expect(quotedList(['a'])).toBe('"a"')
    expect(quotedList(['a', 'b'])).toBe('"a" and "b"')
    expect(quotedList(['a', 'b', 'c'])).toBe('"a", "b", and "c"')
    expect(quotedList(['w', 'x', 'y', 'z'])).toBe('"w", "x", "y", and "z"')
  })
})

describe('jsonQuoteAscii (Op)', () => {
  test('JSON-quotes and escapes non-printable ASCII and angle brackets', () => {
    expect(jsonQuoteAscii('a<é😀')).toBe('"a\\u003c\\u00e9\\ud83d\\ude00"')
    expect(jsonQuoteAscii('plain/path.txt')).toBe('"plain/path.txt"')
    expect(jsonQuoteAscii('x>y')).toBe('"x\\u003ey"')
    expect(jsonQuoteAscii('tab\tq"')).toBe('"tab\\tq\\""')
  })
})

describe('truncateAskPathMiddle (sc)', () => {
  test('returns the path when it fits', () => {
    expect(truncateAskPathMiddle('src/index.ts', 50)).toBe('src/index.ts')
  })

  test('elides the directory and keeps the last segment', () => {
    expect(
      truncateAskPathMiddle(
        'src/components/deeply/nested/folder/MyComponent.tsx',
        30,
      ),
    ).toBe('src/component…/MyComponent.tsx')
  })

  test('falls back to backslash separators', () => {
    expect(
      truncateAskPathMiddle('C:\\Users\\me\\very\\deep\\folder\\file.txt', 24),
    ).toBe('C:\\Users\\me\\ve…\\file.txt')
  })

  test('small budgets', () => {
    expect(truncateAskPathMiddle('src/index.ts', 0)).toBe('…')
    expect(truncateAskPathMiddle('src/components/foo.ts', 4)).toBe('src…')
    expect(truncateAskPathMiddle('verylongfilename.ts', 10)).toBe('…lename.ts')
  })
})

describe('sweptAskText (cC)', () => {
  test('folds invisibles and quote lookalikes', () => {
    expect(sweptAskText('  a\u200b\u202eb  "q" \u201Cx\u201D \'\'y ')).toBe(
      "a b 'q' 'x' 'y",
    )
    expect(sweptAskText('tab\tnew\nline')).toBe('tab new line')
  })

  test('masks arrows and drawn arrows', () => {
    expect(sweptAskText('a --> b ==> c \u2192 d')).toBe('a ? b ? c ? d')
    expect(sweptAskText('\u00bb arrow')).toBe('? arrow')
    expect(sweptAskText('\uE000pua')).toBe('?pua')
  })

  test('drops non-ASCII brackets and angle brackets', () => {
    expect(sweptAskText('\u3010bracket\u3011 (paren) {c}')).toBe(
      'bracket (paren) {c}',
    )
    expect(sweptAskText('x<y>z \uFF1C\uFF1E')).toBe('x y z ?')
  })

  test('empty and blank input', () => {
    expect(sweptAskText('')).toBe('')
    expect(sweptAskText('   ')).toBe('')
  })
})
