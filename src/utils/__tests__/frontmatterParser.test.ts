import { describe, expect, test } from 'bun:test'
import {
  parseFrontmatter,
  splitPathInFrontmatter,
  parsePositiveIntFromFrontmatter,
  parseBooleanFrontmatter,
  tryParseBooleanFrontmatter,
  formatFrontmatterBooleanError,
  FRONTMATTER_BOOLEAN_HINT,
  parseShellFrontmatter,
} from '../frontmatterParser'

describe('parseFrontmatter', () => {
  test('parses valid frontmatter', () => {
    const md = `---
description: A test
type: user
---
Content here`
    const result = parseFrontmatter(md)
    expect(result.frontmatter.description).toBe('A test')
    expect(result.frontmatter.type).toBe('user')
    expect(result.content).toBe('Content here')
  })

  test('returns empty frontmatter when none exists', () => {
    const md = 'Just content, no frontmatter'
    const result = parseFrontmatter(md)
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe(md)
  })

  test('handles empty frontmatter block', () => {
    const md = `---
---
Content`
    const result = parseFrontmatter(md)
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe('Content')
  })

  test('handles frontmatter with list values', () => {
    const md = `---
allowed-tools:
  - Bash
  - Read
---
Content`
    const result = parseFrontmatter(md)
    expect(result.frontmatter['allowed-tools']).toEqual(['Bash', 'Read'])
  })
})

describe('splitPathInFrontmatter', () => {
  test('splits comma-separated paths', () => {
    expect(splitPathInFrontmatter('a, b, c')).toEqual(['a', 'b', 'c'])
  })

  test('expands brace patterns', () => {
    expect(splitPathInFrontmatter('src/*.{ts,tsx}')).toEqual([
      'src/*.ts',
      'src/*.tsx',
    ])
  })

  test('handles nested brace expansion', () => {
    expect(splitPathInFrontmatter('{a,b}/{c,d}')).toEqual([
      'a/c',
      'a/d',
      'b/c',
      'b/d',
    ])
  })

  test('handles array input', () => {
    expect(splitPathInFrontmatter(['a', 'b'])).toEqual(['a', 'b'])
  })

  test('returns empty array for non-string', () => {
    expect(splitPathInFrontmatter(123 as any)).toEqual([])
  })

  test('preserves braces in comma-separated list', () => {
    expect(splitPathInFrontmatter('a, src/*.{ts,tsx}')).toEqual([
      'a',
      'src/*.ts',
      'src/*.tsx',
    ])
  })

  test('densable 2.1.217 #13: over-budget brace expansion stays unexpanded', () => {
    // 2 groups of 40 alts → 1600 combos > Xug=1000 → Qug returns unexpanded
    const alts = Array.from({ length: 40 }, (_, i) => `x${i}`).join(',')
    const pattern = `{${alts}}/{${alts}}`
    const result = splitPathInFrontmatter(pattern)
    expect(result).toEqual([pattern])
  })
})

describe('parsePositiveIntFromFrontmatter', () => {
  test('returns number for positive integer', () => {
    expect(parsePositiveIntFromFrontmatter(5)).toBe(5)
  })

  test('parses string number', () => {
    expect(parsePositiveIntFromFrontmatter('10')).toBe(10)
  })

  test('returns undefined for zero', () => {
    expect(parsePositiveIntFromFrontmatter(0)).toBeUndefined()
  })

  test('returns undefined for negative number', () => {
    expect(parsePositiveIntFromFrontmatter(-1)).toBeUndefined()
  })

  test('returns undefined for float', () => {
    expect(parsePositiveIntFromFrontmatter(1.5)).toBeUndefined()
  })

  test('returns undefined for null/undefined', () => {
    expect(parsePositiveIntFromFrontmatter(null)).toBeUndefined()
    expect(parsePositiveIntFromFrontmatter(undefined)).toBeUndefined()
  })

  test('returns undefined for non-numeric string', () => {
    expect(parsePositiveIntFromFrontmatter('abc')).toBeUndefined()
  })
})

describe('parseBooleanFrontmatter', () => {
  test('returns true for boolean true', () => {
    expect(parseBooleanFrontmatter(true)).toBe(true)
  })

  test("returns true for string 'true'", () => {
    expect(parseBooleanFrontmatter('true')).toBe(true)
  })

  test('returns false for boolean false', () => {
    expect(parseBooleanFrontmatter(false)).toBe(false)
  })

  test("returns false for string 'false'", () => {
    expect(parseBooleanFrontmatter('false')).toBe(false)
  })

  test('returns false for null/undefined', () => {
    expect(parseBooleanFrontmatter(null)).toBe(false)
    expect(parseBooleanFrontmatter(undefined)).toBe(false)
  })

  // densable 2.1.218: yes/no/on/off/1/0 (case-insensitive)
  test('accepts yes/no/on/off/1/0 strings (218)', () => {
    for (const t of ['yes', 'YES', 'on', 'On', '1']) {
      expect(parseBooleanFrontmatter(t)).toBe(true)
    }
    for (const f of ['no', 'NO', 'off', 'Off', '0']) {
      expect(parseBooleanFrontmatter(f)).toBe(false)
    }
  })

  test('accepts numeric 1/0 (218)', () => {
    expect(parseBooleanFrontmatter(1)).toBe(true)
    expect(parseBooleanFrontmatter(0)).toBe(false)
  })

  test('trims whitespace around string literals (218)', () => {
    expect(parseBooleanFrontmatter(' yes ')).toBe(true)
    expect(parseBooleanFrontmatter(' off ')).toBe(false)
  })

  test('tryParseBooleanFrontmatter returns undefined for garbage (218)', () => {
    expect(tryParseBooleanFrontmatter('maybe')).toBeUndefined()
    expect(tryParseBooleanFrontmatter('')).toBeUndefined()
    expect(tryParseBooleanFrontmatter(2)).toBeUndefined()
  })

  test('formatFrontmatterBooleanError matches densable SEA suffix (218)', () => {
    expect(FRONTMATTER_BOOLEAN_HINT).toBe('true/false, 1/0, yes/no, on/off')
    expect(formatFrontmatterBooleanError('maybe')).toBe(
      '"maybe" is not a boolean (use true/false, 1/0, yes/no, on/off)',
    )
  })
})

describe('parseShellFrontmatter', () => {
  test("returns bash for 'bash'", () => {
    expect(parseShellFrontmatter('bash', 'test')).toBe('bash')
  })

  test("returns powershell for 'powershell'", () => {
    expect(parseShellFrontmatter('powershell', 'test')).toBe('powershell')
  })

  test('returns undefined for null', () => {
    expect(parseShellFrontmatter(null, 'test')).toBeUndefined()
  })

  test('returns undefined for unrecognized value', () => {
    expect(parseShellFrontmatter('zsh', 'test')).toBeUndefined()
  })

  test('is case insensitive', () => {
    expect(parseShellFrontmatter('BASH', 'test')).toBe('bash')
  })

  test('returns undefined for empty string', () => {
    expect(parseShellFrontmatter('', 'test')).toBeUndefined()
  })
})
