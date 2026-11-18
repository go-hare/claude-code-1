import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearInternalWrites,
  consumeInternalWrite,
  hashSettingsContent,
  markInternalWrite,
} from '../internalWrites.js'
import { dialogExpiryToMs } from '../settings.js'

describe('settings (#105, #122)', () => {
  const prevTimeout = process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS

  afterEach(() => {
    if (prevTimeout === undefined) {
      delete process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS
    } else {
      process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS = prevTimeout
    }
    clearInternalWrites()
  })

  test('#105 dialogExpiryToMs rejects non-wholeValue strings like 5m and 12.5', () => {
    process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS = '5m'
    expect(dialogExpiryToMs('10m')).toBe(600_000)

    process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS = '12.5'
    expect(dialogExpiryToMs('60s')).toBe(60_000)

    process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS = '1500ms'
    expect(dialogExpiryToMs('never')).toBeNull()

    process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS = '1500'
    expect(dialogExpiryToMs('never')).toBe(1500)

    process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS = '1_500'
    expect(dialogExpiryToMs('never')).toBe(1500)

    process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS = '2e3'
    expect(dialogExpiryToMs('never')).toBe(2000)
  })

  test('#122 internalWrites records and consumes normalized content hash', () => {
    markInternalWrite('/tmp/settings.json', '{\r\n  "a": 1\r\n}\r\n')
    const expected = hashSettingsContent('{\n  "a": 1\n}\n')
    expect(consumeInternalWrite('/tmp/settings.json', 5000)).toBe(expected)
    // Consumed once
    expect(consumeInternalWrite('/tmp/settings.json', 5000)).toBeUndefined()
  })
})
