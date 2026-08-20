/**
 * densable 2.1.235 #1 — spellcheck protocol + tokenize + color.
 */
import { describe, expect, test } from 'bun:test'
import {
  buildSpellcheckArgs,
  formatSpellcheckRequest,
  isSpellcheckLanguageName,
  normalizeSpellcheckChecker,
  parseSpellcheckBanner,
  parseSpellcheckResponseLine,
  SPELLCHECK_CHECKERS,
} from '../protocol.js'
import {
  DEFAULT_SPELLCHECK_COLOR,
  isValidSpellcheckColorValue,
  normalizeSpellcheckColor,
} from '../color.js'
import { tokenizeSpellcheckWords } from '../tokenize.js'

describe('spellcheck protocol (zTu/qTu/WTu/GTu)', () => {
  test('vKe checker list order', () => {
    expect(SPELLCHECK_CHECKERS).toEqual(['aspell', 'hunspell', 'ispell'])
  })

  test('buildSpellcheckArgs aspell/hunspell/ispell', () => {
    expect(buildSpellcheckArgs('aspell', 'en_GB')).toEqual([
      '-a',
      '--encoding=utf-8',
      '--sug-mode=ultra',
      '--lang=en_GB',
    ])
    expect(buildSpellcheckArgs('hunspell', 'en_US')).toEqual([
      '-a',
      '-i',
      'utf-8',
      '-d',
      'en_US',
    ])
    expect(buildSpellcheckArgs('ispell', undefined)).toEqual(['-a'])
  })

  test('parseSpellcheckBanner detects backends', () => {
    expect(
      parseSpellcheckBanner(
        '@(#) International Ispell Version 3.1.20 (but really Aspell 0.60.8)',
      ),
    ).toBe('aspell')
    expect(
      parseSpellcheckBanner(
        '@(#) International Ispell Version 3.2.06 (but really Hunspell 1.7.0)',
      ),
    ).toBe('hunspell')
    expect(
      parseSpellcheckBanner('@(#) International Ispell Version 3.4.00'),
    ).toBe('ispell')
    expect(parseSpellcheckBanner('hello')).toBeNull()
  })

  test('formatSpellcheckRequest prefixes caret', () => {
    expect(formatSpellcheckRequest(['foo', 'bar'])).toBe('^foo bar\n')
  })

  test('parseSpellcheckResponseLine covers *+-&?# and end', () => {
    expect(parseSpellcheckResponseLine('')).toEqual({ type: 'end' })
    expect(parseSpellcheckResponseLine('*')).toEqual({ type: 'correct' })
    expect(parseSpellcheckResponseLine('+')).toEqual({ type: 'correct' })
    expect(parseSpellcheckResponseLine('-')).toEqual({ type: 'correct' })
    expect(parseSpellcheckResponseLine('& foo 1 0: bar')).toEqual({
      type: 'misspelled',
      word: 'foo',
    })
    expect(parseSpellcheckResponseLine('? foo 1 0:')).toEqual({
      type: 'misspelled',
      word: 'foo',
    })
    expect(parseSpellcheckResponseLine('# foo 0')).toEqual({
      type: 'misspelled',
      word: 'foo',
    })
    expect(parseSpellcheckResponseLine('zzz')).toEqual({ type: 'unrecognized' })
  })

  test('language name validator hs_', () => {
    expect(isSpellcheckLanguageName('en_GB')).toBe(true)
    expect(isSpellcheckLanguageName('en-US')).toBe(true)
    expect(isSpellcheckLanguageName('../etc')).toBe(false)
    expect(isSpellcheckLanguageName('')).toBe(false)
  })

  test('normalizeSpellcheckChecker unknown → auto', () => {
    expect(normalizeSpellcheckChecker(undefined)).toBe('auto')
    expect(normalizeSpellcheckChecker('auto')).toBe('auto')
    expect(normalizeSpellcheckChecker('aspell')).toBe('aspell')
    expect(normalizeSpellcheckChecker('nope')).toBe('auto')
  })
})

describe('spellcheck color (edE/SLe)', () => {
  test('accepts rgb / hex / ansi256 / ansi:name', () => {
    expect(isValidSpellcheckColorValue('rgb(1,2,3)')).toBe(true)
    expect(isValidSpellcheckColorValue('#ff00aa')).toBe(true)
    expect(isValidSpellcheckColorValue('#f0a')).toBe(true)
    expect(isValidSpellcheckColorValue('ansi256(196)')).toBe(true)
    expect(isValidSpellcheckColorValue('ansi:red')).toBe(true)
    expect(isValidSpellcheckColorValue('ansi:nope')).toBe(false)
  })

  test('normalize bare name → ansi:name; invalid → error', () => {
    expect(normalizeSpellcheckColor(undefined)).toBe(DEFAULT_SPELLCHECK_COLOR)
    expect(normalizeSpellcheckColor('red')).toBe('ansi:red')
    expect(normalizeSpellcheckColor('#abc')).toBe('#abc')
    expect(normalizeSpellcheckColor('not-a-color')).toBe(
      DEFAULT_SPELLCHECK_COLOR,
    )
  })
})

describe('tokenizeSpellcheckWords (lhg)', () => {
  test('extracts plain words and skips code spans', () => {
    const spans = tokenizeSpellcheckWords('Hello `code` world')
    expect(spans.map(s => s.word)).toEqual(['Hello', 'world'])
  })

  test('skips camelCase and short tokens', () => {
    const spans = tokenizeSpellcheckWords('a fooBar hello')
    expect(spans.map(s => s.word)).toEqual(['hello'])
  })

  test('keeps apostrophe words', () => {
    const spans = tokenizeSpellcheckWords("don't stop")
    expect(spans.map(s => s.word)).toEqual(["don't", 'stop'])
  })
})

describe('mergeSpellcheckHighlights (fhg)', () => {
  test('appends only non-overlapping ranges vs base', () => {
    const { mergeSpellcheckHighlights } =
      require('../useSpellcheckHighlights.js') as typeof import('../useSpellcheckHighlights.js')
    const base = [
      { start: 0, end: 5, color: 'suggestion' as const, priority: 5 },
    ]
    const extra = [
      {
        start: 3,
        end: 7,
        color: 'error' as const,
        underline: true,
        priority: 2,
      },
      {
        start: 8,
        end: 10,
        color: 'error' as const,
        underline: true,
        priority: 2,
      },
    ]
    const merged = mergeSpellcheckHighlights(base, extra)
    expect(merged).toHaveLength(2)
    expect(merged[1]).toMatchObject({ start: 8, end: 10, underline: true })
  })

  test('keeps overlapping extras when neither overlaps base (gold fhg)', () => {
    const { mergeSpellcheckHighlights } =
      require('../useSpellcheckHighlights.js') as typeof import('../useSpellcheckHighlights.js')
    const base = [
      { start: 0, end: 2, color: 'suggestion' as const, priority: 5 },
    ]
    const extra = [
      {
        start: 4,
        end: 8,
        color: 'error' as const,
        underline: true,
        priority: 2,
      },
      {
        start: 6,
        end: 10,
        color: 'error' as const,
        underline: true,
        priority: 2,
      },
    ]
    const merged = mergeSpellcheckHighlights(base, extra)
    expect(merged).toHaveLength(3)
    expect(merged.map(h => [h.start, h.end])).toEqual([
      [0, 2],
      [4, 8],
      [6, 10],
    ])
  })
})
