/**
 * densable SEA output_style reminder wording — mirrors messages.ts case exactly:
 * `${escapeOutputStyleName(style)} output style is active. ${attachment.turnReminder ?? fallback}`
 * Renderer does NOT look up OUTPUT_STYLE_CONFIG (238 s3T/pze).
 */
import { describe, expect, test } from 'bun:test'
import {
  CONCISE_TURN_REMINDER,
  OUTPUT_STYLE_CONFIG,
  OUTPUT_STYLE_NAME_MAX,
} from '../../constants/outputStyles.js'
import { escapeOutputStyleName } from '../xml.js'

/** Exact tip messages.ts render contract for output_style attachments (238 pze). */
function renderMessagesOutputStyle(
  styleName: string,
  attachmentTurnReminder?: string,
): string | null {
  if (typeof styleName !== 'string' || styleName === '') return null
  if (styleName.length > OUTPUT_STYLE_NAME_MAX) return null
  const reminder =
    attachmentTurnReminder ??
    'Remember to follow the specific guidelines for this style.'
  return `${escapeOutputStyleName(styleName)} output style is active. ${reminder}`
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

  test('custom catalog name still renders (no OUTPUT_STYLE_CONFIG miss-drop)', () => {
    expect(renderMessagesOutputStyle('Team Style', 'Stay brief.')).toBe(
      'Team Style output style is active. Stay brief.',
    )
  })
})
