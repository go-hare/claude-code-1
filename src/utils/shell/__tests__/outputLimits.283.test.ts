import { describe, expect, test } from 'bun:test'
import {
  clampBashOutputMaxChars,
  getBashOutputMaxCharsSetting,
  resolveMaxOutputLength,
  BASH_MAX_OUTPUT_DEFAULT,
} from '../outputLimits.js'

describe('bashOutputMaxChars densable zae/Uqe/A', () => {
  test('clamps to 4000–128000', () => {
    expect(clampBashOutputMaxChars(undefined)).toBeUndefined()
    expect(clampBashOutputMaxChars(10)).toBe(4_000)
    expect(clampBashOutputMaxChars(50_000)).toBe(50_000)
    expect(clampBashOutputMaxChars(999_999)).toBe(128_000)
  })

  test('settings win over BASH_MAX_OUTPUT_LENGTH', () => {
    expect(resolveMaxOutputLength(8_000, '50000')).toBe(8_000)
    expect(getBashOutputMaxCharsSetting(8_000)).toBe(8_000)
  })

  test('env path when settings unset', () => {
    expect(resolveMaxOutputLength(undefined, undefined)).toBe(
      BASH_MAX_OUTPUT_DEFAULT,
    )
    expect(resolveMaxOutputLength(undefined, '50000')).toBe(50_000)
    expect(resolveMaxOutputLength(undefined, '999999')).toBe(150_000)
  })
})
