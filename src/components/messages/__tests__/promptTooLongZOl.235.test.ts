/**
 * densable 2.1.235 #14 — SEA `ZOl` PTL assembly (not raw JG).
 */
import { describe, expect, test } from 'bun:test'
import { buildPromptTooLongContextLimitText } from '../AssistantTextMessage.js'
import { PROMPT_TOO_LONG_ERROR_MESSAGE } from '../../../services/api/errors.js'

describe('buildPromptTooLongContextLimitText (densable ZOl)', () => {
  test('wire PROMPT_TOO_LONG remains the match key, not UI text', () => {
    expect(PROMPT_TOO_LONG_ERROR_MESSAGE).toBe('Prompt is too long')
  })

  test('default continue hint without auto-compact-off / upgrade', () => {
    expect(
      buildPromptTooLongContextLimitText({
        disableCompact: false,
        autoCompactOffHint: false,
        upgradeHint: null,
      }),
    ).toBe('Context limit reached · /compact or /clear to continue')
  })

  test('DISABLE_COMPACT uses /clear only', () => {
    expect(
      buildPromptTooLongContextLimitText({
        disableCompact: true,
        autoCompactOffHint: false,
        upgradeHint: null,
      }),
    ).toBe('Context limit reached · /clear to continue')
  })

  test('RPa true appends auto-compact off · /config suffix', () => {
    expect(
      buildPromptTooLongContextLimitText({
        disableCompact: false,
        autoCompactOffHint: true,
        upgradeHint: null,
      }),
    ).toBe(
      'Context limit reached · /compact or /clear to continue · auto-compact is off · /config to turn it on',
    )
  })

  test('upgrade hint appends after auto-compact-off when both present', () => {
    expect(
      buildPromptTooLongContextLimitText({
        disableCompact: false,
        autoCompactOffHint: true,
        upgradeHint: '/model opus[1m]',
      }),
    ).toBe(
      'Context limit reached · /compact or /clear to continue · auto-compact is off · /config to turn it on · /model opus[1m]',
    )
  })

  test('nested MessageResponse / RPa false suppresses auto-compact-off suffix', () => {
    const text = buildPromptTooLongContextLimitText({
      disableCompact: false,
      autoCompactOffHint: false,
      upgradeHint: '/model sonnet[1m]',
    })
    expect(text).toBe(
      'Context limit reached · /compact or /clear to continue · /model sonnet[1m]',
    )
    expect(text).not.toContain('auto-compact is off')
  })
})
