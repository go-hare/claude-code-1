/**
 * densable SEA output_style reminder wording — mirrors messages.ts case exactly:
 * `${name} output style is active. ${attachment.turnReminder ?? fallback}`
 * (does NOT re-read config.turnReminder at render time)
 */
import { describe, expect, test } from 'bun:test'
import {
  CONCISE_TURN_REMINDER,
  OUTPUT_STYLE_CONFIG,
} from '../../constants/outputStyles.js'

/** Exact tip messages.ts render contract for output_style attachments. */
function renderMessagesOutputStyle(
  styleKey: string,
  attachmentTurnReminder?: string,
): string | null {
  const outputStyle =
    OUTPUT_STYLE_CONFIG[styleKey as keyof typeof OUTPUT_STYLE_CONFIG]
  if (!outputStyle) return null
  const reminder =
    attachmentTurnReminder ??
    'Remember to follow the specific guidelines for this style.'
  return `${outputStyle.name} output style is active. ${reminder}`
}

describe('densable output_style turnReminder 237', () => {
  test('Concise config carries SEA BAT for attachment producer', () => {
    expect(OUTPUT_STYLE_CONFIG.Concise?.turnReminder).toBe(
      CONCISE_TURN_REMINDER,
    )
  })

  test('messages render uses attachment.turnReminder when present (wHv path)', () => {
    expect(renderMessagesOutputStyle('Concise', CONCISE_TURN_REMINDER)).toBe(
      `Concise output style is active. ${CONCISE_TURN_REMINDER}`,
    )
  })

  test('messages render falls back when attachment omits turnReminder', () => {
    // messages.ts does not consult OUTPUT_STYLE_CONFIG.turnReminder at render
    expect(renderMessagesOutputStyle('Concise')).toBe(
      'Concise output style is active. Remember to follow the specific guidelines for this style.',
    )
    expect(renderMessagesOutputStyle('Explanatory')).toBe(
      'Explanatory output style is active. Remember to follow the specific guidelines for this style.',
    )
  })

  test('Explanatory config has no turnReminder (SEA)', () => {
    expect(OUTPUT_STYLE_CONFIG.Explanatory?.turnReminder).toBeUndefined()
  })
})
