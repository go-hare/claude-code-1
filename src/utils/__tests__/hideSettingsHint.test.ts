import { describe, expect, test } from 'bun:test'
import { isSdkEntrypoint, shouldShowSettingsHint } from '../hideSettingsHint.js'

describe('shouldShowSettingsHint', () => {
  test('default on', () => {
    expect(shouldShowSettingsHint({})).toBe(true)
  })
  test('hide env', () => {
    expect(
      shouldShowSettingsHint({ CLAUDE_CODE_HIDE_SETTINGS_HINT: '1' }),
    ).toBe(false)
  })
  test('remote entrypoints hidden', () => {
    expect(
      shouldShowSettingsHint({ CLAUDE_CODE_ENTRYPOINT: 'claude-in-slack' }),
    ).toBe(false)
    expect(shouldShowSettingsHint({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe(true)
  })
})

describe('isSdkEntrypoint', () => {
  test('sdk-*', () => {
    expect(isSdkEntrypoint({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' })).toBe(true)
    expect(isSdkEntrypoint({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe(false)
  })
})
