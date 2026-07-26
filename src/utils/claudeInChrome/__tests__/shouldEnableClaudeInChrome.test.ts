import { afterEach, describe, expect, test } from 'bun:test'

import { shouldEnableClaudeInChrome } from '../setup.js'

describe('shouldEnableClaudeInChrome (densable Dtn order)', () => {
  const prevCfc = process.env.CLAUDE_CODE_ENABLE_CFC

  afterEach(() => {
    if (prevCfc === undefined) {
      delete process.env.CLAUDE_CODE_ENABLE_CFC
    } else {
      process.env.CLAUDE_CODE_ENABLE_CFC = prevCfc
    }
  })

  test('explicit --chrome wins', () => {
    delete process.env.CLAUDE_CODE_ENABLE_CFC
    expect(shouldEnableClaudeInChrome(true)).toBe(true)
  })

  test('explicit --no-chrome wins', () => {
    process.env.CLAUDE_CODE_ENABLE_CFC = '1'
    expect(shouldEnableClaudeInChrome(false)).toBe(false)
  })

  test('CLAUDE_CODE_ENABLE_CFC enables without flag (even when default would be off)', () => {
    process.env.CLAUDE_CODE_ENABLE_CFC = '1'
    expect(shouldEnableClaudeInChrome(undefined)).toBe(true)
  })

  test('CLAUDE_CODE_ENABLE_CFC=0 disables without flag', () => {
    process.env.CLAUDE_CODE_ENABLE_CFC = '0'
    expect(shouldEnableClaudeInChrome(undefined)).toBe(false)
  })
})
