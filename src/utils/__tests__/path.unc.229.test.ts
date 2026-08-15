/**
 * densable 2.1.229 #9 — Windows `\\?\` / UNC strip (Rwr / Xpr).
 *
 * Pure helpers are tested without platform mock (avoids mock.module pollution).
 * expandPath Windows branch is exercised via Rwr pre-pass composition.
 */
import { describe, expect, test } from 'bun:test'
import {
  expandPath,
  stripWindowsExtendedPathPrefix,
  stripWindowsLongPathPrefixXpr,
} from '../path.js'

describe('densable 2.1.229 #9 stripWindowsExtendedPathPrefix (Rwr)', () => {
  test('strips \\\\?\\UNC\\ to \\\\', () => {
    expect(stripWindowsExtendedPathPrefix('\\\\?\\UNC\\server\\share')).toBe(
      '\\\\server\\share',
    )
    expect(stripWindowsExtendedPathPrefix('\\\\?\\unc\\server\\share')).toBe(
      '\\\\server\\share',
    )
  })

  test('strips any \\\\?\\ prefix (aggressive vs Xpr)', () => {
    expect(stripWindowsExtendedPathPrefix('\\\\?\\C:\\Users\\x')).toBe(
      'C:\\Users\\x',
    )
    expect(stripWindowsExtendedPathPrefix('\\\\?\\volume{abc}')).toBe(
      'volume{abc}',
    )
  })

  test('leaves plain paths unchanged', () => {
    expect(stripWindowsExtendedPathPrefix('C:\\Users\\x')).toBe('C:\\Users\\x')
    expect(stripWindowsExtendedPathPrefix('\\\\server\\share')).toBe(
      '\\\\server\\share',
    )
  })

  // densable 2.1.233 #11 — NT object `\??\` strip
  test('strips \\??\\UNC\\ and \\??\\ drive forms', () => {
    expect(stripWindowsExtendedPathPrefix('\\??\\UNC\\server\\share')).toBe(
      '\\\\server\\share',
    )
    expect(stripWindowsExtendedPathPrefix('\\??\\C:\\Users\\x')).toBe(
      'C:\\Users\\x',
    )
    expect(stripWindowsExtendedPathPrefix('/??/C:/Users/x')).toBe('C:/Users/x')
  })
})

describe('densable 2.1.229 #9 stripWindowsLongPathPrefixXpr (Xpr)', () => {
  test('drive letter and UNC only', () => {
    expect(stripWindowsLongPathPrefixXpr('\\\\?\\UNC\\server\\share')).toBe(
      '\\\\server\\share',
    )
    expect(stripWindowsLongPathPrefixXpr('\\\\?\\C:\\Users\\x')).toBe(
      'C:\\Users\\x',
    )
  })

  test('does not strip non-drive device paths', () => {
    expect(stripWindowsLongPathPrefixXpr('\\\\?\\volume{abc}')).toBe(
      '\\\\?\\volume{abc}',
    )
  })
})

describe('densable 2.1.229 #9 expandPath does not crash on extended prefixes', () => {
  // On non-Windows hosts expandPath does not enter the Rwr branch; still must
  // not throw when fed extended-length spellings (tool resume / message paths).
  test('\\\\?\\ drive spelling does not throw', () => {
    expect(() => expandPath('\\\\?\\C:\\Users\\test\\file.txt')).not.toThrow()
  })

  test('\\\\?\\UNC spelling does not throw', () => {
    expect(() =>
      expandPath('\\\\?\\UNC\\fileserver\\share\\a.txt'),
    ).not.toThrow()
  })

  test('plain UNC does not throw', () => {
    expect(() => expandPath('\\\\server\\share\\file.txt')).not.toThrow()
  })

  test('Rwr pre-pass + expandPath composition (densable _$ order)', () => {
    const stripped = stripWindowsExtendedPathPrefix(
      '\\\\?\\C:\\Users\\test\\file.txt',
    )
    expect(stripped).toBe('C:\\Users\\test\\file.txt')
    expect(() => expandPath(stripped)).not.toThrow()
  })
})
