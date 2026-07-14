/**
 * Official 2.1.207: uncompilable gitignore patterns are dropped (not thrown).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import ignore from 'ignore'
import {
  filterCompilableIgnorePatterns,
  probeIgnorePatternCompileError,
  splitIgnoreFileLines,
} from '../ignorePatterns.js'

afterEach(() => {
  // memoize caches probe results; clear between tests when possible
  if (typeof probeIgnorePatternCompileError.cache?.clear === 'function') {
    probeIgnorePatternCompileError.cache.clear()
  }
})

describe('splitIgnoreFileLines', () => {
  test('splits CRLF and drops empty lines', () => {
    expect(splitIgnoreFileLines('a\r\nb\n\nc\n')).toEqual(['a', 'b', 'c'])
  })
})

describe('probeIgnorePatternCompileError', () => {
  test('returns null for normal patterns', () => {
    expect(probeIgnorePatternCompileError('node_modules/')).toBeNull()
    expect(probeIgnorePatternCompileError('*.log')).toBeNull()
  })

  test('returns error for empty / whitespace patterns', () => {
    expect(probeIgnorePatternCompileError('')).toBe('empty pattern')
    expect(probeIgnorePatternCompileError('   ')).toBe('empty pattern')
  })
})

describe('filterCompilableIgnorePatterns (2.1.207)', () => {
  test('keeps normal patterns', () => {
    expect(
      filterCompilableIgnorePatterns(
        ['node_modules/', '*.log', 'dist'],
        'worktreeinclude',
      ),
    ).toEqual(['node_modules/', '*.log', 'dist'])
  })

  test('drops empty / whitespace patterns', () => {
    // Empty patterns are uncompilable for our purposes (ignore@7 no longer
    // throws on "", but they match nothing useful and historically broke
    // ignore matchers).
    expect(
      filterCompilableIgnorePatterns(
        ['ok', '', 'also-ok', '  '],
        'skill_paths',
      ),
    ).toEqual(['ok', 'also-ok'])
  })

  test('remaining patterns still match via ignore()', () => {
    const patterns = filterCompilableIgnorePatterns(
      ['secrets/**', ''],
      'claudemd_rule_globs',
    )
    expect(patterns).toEqual(['secrets/**'])
    expect(ignore().add(patterns).ignores('secrets/a.key')).toBe(true)
  })
})
