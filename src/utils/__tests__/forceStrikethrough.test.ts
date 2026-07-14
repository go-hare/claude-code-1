import { describe, expect, test } from 'bun:test'
import {
  isForceStrikethroughEnabled,
  supportsStrikethrough,
} from '../forceStrikethrough.js'

describe('isForceStrikethroughEnabled', () => {
  test('force on', () => {
    expect(
      isForceStrikethroughEnabled({ CLAUDE_CODE_FORCE_STRIKETHROUGH: '1' }),
    ).toBe(true)
  })
})

describe('supportsStrikethrough', () => {
  test('Apple Terminal off', () => {
    expect(
      supportsStrikethrough({
        env: {},
        termProgram: 'Apple_Terminal',
        term: 'xterm-256color',
      }),
    ).toBe(false)
  })
  test('iTerm on', () => {
    expect(
      supportsStrikethrough({
        env: {},
        termProgram: 'iTerm.app',
      }),
    ).toBe(true)
  })
  test('force overrides Apple Terminal', () => {
    expect(
      supportsStrikethrough({
        env: { CLAUDE_CODE_FORCE_STRIKETHROUGH: '1' },
        termProgram: 'Apple_Terminal',
      }),
    ).toBe(true)
  })
})
