import { describe, expect, test } from 'bun:test'
import { ClaudeError } from '../errors.js'
import { substituteArguments } from '../argumentSubstitution.js'

describe('argumentSubstitution v2.1.301 alignment (#855, #856)', () => {
  test('#855 caps named arguments to first 64 names and ignores names > 64 chars', () => {
    const tooLongName = 'a'.repeat(65)
    const maxLenName = 'b'.repeat(64)
    const names = [
      tooLongName,
      maxLenName,
      ...Array.from({ length: 70 }, (_, i) => `arg${i}`),
    ]
    // After filtering tooLongName (>64 chars): maxLenName (#1), arg0 (#2) ... arg62 (#64), arg63 (#65, dropped)
    const args = Array.from({ length: 72 }, (_, i) => `val${i}`).join(' ')
    const template = `$${tooLongName} $${maxLenName} $arg0 $arg62 $arg63`
    const out = substituteArguments(template, args, false, names)

    // tooLongName (>64 chars) is NOT substituted, and doesn't consume a slot
    expect(out).toContain(`$${tooLongName}`)
    // maxLenName (64 chars) IS substituted (val1)
    expect(out).toContain('val1')
    // arg0 (slot 2) and arg62 (slot 64 -> 64th valid name) are substituted
    expect(out).toContain('val2')
    expect(out).toContain('val64')
    // arg63 (slot 65 -> 65th valid name) is NOT substituted
    expect(out).toContain('$arg63')
  })

  test('#856 throws ClaudeError when substituted content exceeds 4,000,000 chars', () => {
    const bigArg = 'x'.repeat(200_000)
    // 25 * $ARGUMENTS = 5,000,000 > 4,000,000
    const template = Array.from({ length: 25 }, () => '$ARGUMENTS').join(' ')
    expect(() => substituteArguments(template, bigArg, false)).toThrow(
      ClaudeError,
    )
    expect(() => substituteArguments(template, bigArg, false)).toThrow(
      '4,000,000',
    )
  })

  test('#856 allows substitutions within 4,000,000 char budget', () => {
    const arg = 'x'.repeat(1000)
    const template = '$ARGUMENTS $ARGUMENTS'
    expect(substituteArguments(template, arg, false)).toBe(`${arg} ${arg}`)
  })
})
