/**
 * densable 2.1.229 #19 — blank / whitespace-only prompt gate (YAm).
 */
import { describe, expect, test } from 'bun:test'

/** densable YAm — 1:1 product string. */
export const BLANK_PROMPT_MESSAGE =
  'Blank prompt — the message was only whitespace, so nothing was sent to the model.'

/**
 * densable Z4v condition (without isNonInteractiveSession / isMeta wiring):
 * mode prompt + non-empty string that trims to empty.
 */
function isBlankWhitespacePrompt(
  mode: string,
  input: unknown,
  isNonInteractiveSession: boolean,
  isMeta: boolean | undefined,
): boolean {
  return (
    mode === 'prompt' &&
    typeof input === 'string' &&
    input !== '' &&
    input.trim() === '' &&
    isNonInteractiveSession &&
    !isMeta
  )
}

/** densable print early gate for whitespace-only string. */
function printWhitespaceOnlyError(
  inputPrompt: string,
  isUsingSdkUrl: boolean,
): string | null {
  if (typeof inputPrompt === 'string' && inputPrompt.trim() === '') {
    if (inputPrompt !== '' && !isUsingSdkUrl) {
      return 'Error: Input contained only whitespace. Provide a prompt with text through stdin or as a prompt argument when using --print'
    }
  }
  return null
}

describe('densable 2.1.229 #19 blank prompt (YAm)', () => {
  test('YAm product string is 1:1 densable', () => {
    expect(BLANK_PROMPT_MESSAGE).toBe(
      'Blank prompt — the message was only whitespace, so nothing was sent to the model.',
    )
  })

  test('whitespace-only non-interactive prompt matches gate', () => {
    expect(isBlankWhitespacePrompt('prompt', '   \n\t  ', true, false)).toBe(
      true,
    )
    expect(isBlankWhitespacePrompt('prompt', '   ', true, undefined)).toBe(true)
  })

  test('empty string does not match YAm gate (print handles separately)', () => {
    expect(isBlankWhitespacePrompt('prompt', '', true, false)).toBe(false)
  })

  test('interactive session does not match', () => {
    expect(isBlankWhitespacePrompt('prompt', '   ', false, false)).toBe(false)
  })

  test('isMeta skips gate', () => {
    expect(isBlankWhitespacePrompt('prompt', '   ', true, true)).toBe(false)
  })

  test('non-prompt mode skips', () => {
    expect(isBlankWhitespacePrompt('bash', '   ', true, false)).toBe(false)
  })

  test('real text does not match', () => {
    expect(isBlankWhitespacePrompt('prompt', 'hello', true, false)).toBe(false)
  })
})

describe('densable 2.1.229 #19 print whitespace-only error', () => {
  test('whitespace-only yields densable error string', () => {
    const err = printWhitespaceOnlyError('  \t  ', false)
    expect(err).toContain('Input contained only whitespace')
    expect(err).toContain('--print')
  })

  test('sdkUrl skips whitespace error', () => {
    expect(printWhitespaceOnlyError('   ', true)).toBeNull()
  })

  test('empty string is not the whitespace error', () => {
    expect(printWhitespaceOnlyError('', false)).toBeNull()
  })

  test('real prompt is not the whitespace error', () => {
    expect(printWhitespaceOnlyError('hi', false)).toBeNull()
  })
})
