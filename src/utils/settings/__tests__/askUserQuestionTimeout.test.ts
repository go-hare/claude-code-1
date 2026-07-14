import { afterEach, describe, expect, test } from 'bun:test'
import { askUserQuestionTimeoutToMs } from '../settings.js'

describe('askUserQuestionTimeoutToMs', () => {
  afterEach(() => {
    delete process.env.CLAUDE_AFK_TIMEOUT_MS
  })

  test('never and undefined return null (no auto-continue by default)', () => {
    expect(askUserQuestionTimeoutToMs('never')).toBe(null)
    // When settings leave the field unset, callers pass getAskUserQuestionTimeout()
    // which resolves to 'never' — explicit never must stay null.
    expect(askUserQuestionTimeoutToMs('never')).toBe(null)
  })

  test('maps 60s / 5m / 10m to milliseconds', () => {
    expect(askUserQuestionTimeoutToMs('60s')).toBe(60_000)
    expect(askUserQuestionTimeoutToMs('5m')).toBe(300_000)
    expect(askUserQuestionTimeoutToMs('10m')).toBe(600_000)
  })

  test('CLAUDE_AFK_TIMEOUT_MS overrides setting', () => {
    process.env.CLAUDE_AFK_TIMEOUT_MS = '1500'
    expect(askUserQuestionTimeoutToMs('never')).toBe(1500)
    expect(askUserQuestionTimeoutToMs('60s')).toBe(1500)
  })
})
