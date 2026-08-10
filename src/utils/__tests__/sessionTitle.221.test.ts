import { describe, expect, test } from 'bun:test'
import {
  RENAME_EMPTY_AFTER_SANITIZE_MESSAGE,
  SESSION_TITLE_MAX_CODE_POINTS,
  capSessionTitleCodePoints,
  mapControlFormatToSpace,
  sanitizeSessionTitle,
} from '../sessionTitleSanitize.js'

describe('densable 2.1.221 session title sanitize (ly/vhn/uge)', () => {
  test('ly: Cc/Cf/LS/PS runs become spaces', () => {
    // ZWSP is Cf → space; bidi Cf → space
    expect(mapControlFormatToSpace('a\u200Bb\u202Ec')).toBe('a b c')
    expect(mapControlFormatToSpace('x\u2028y\u2029z')).toBe('x y z')
  })

  test('vhn: strips C0/C1 and caps code points at OMb=200', () => {
    expect(capSessionTitleCodePoints('a\x00b\x7fc')).toBe('abc')
    const long = '字'.repeat(250)
    expect([...capSessionTitleCodePoints(long)].length).toBe(
      SESSION_TITLE_MAX_CODE_POINTS,
    )
  })

  test('uge: trim → ly → vhn → trim', () => {
    expect(sanitizeSessionTitle('  hello\u200B  ')).toBe('hello')
    expect(sanitizeSessionTitle('fix\u200Blogin')).toBe('fix login')
  })

  test('invisible-only becomes empty', () => {
    expect(sanitizeSessionTitle('\u200B\u200C\uFEFF')).toBe('')
    expect(sanitizeSessionTitle('\x00\x1f')).toBe('')
  })

  test('empty message constant matches densable gold', () => {
    expect(RENAME_EMPTY_AFTER_SANITIZE_MESSAGE).toBe(
      'That name is empty once invisible characters are removed. Usage: /rename <name>',
    )
  })
})
