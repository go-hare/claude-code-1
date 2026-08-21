/**
 * densable SEA 2.1.237 Concise built-in output style ($AT / BAT / turnReminder).
 * Gold: docs/upstream-extraction/v2.1.237/snippets/gold-concise-*.txt
 * invent-ban: do NOT assert Proactive is present.
 */
import { describe, expect, test } from 'bun:test'
import { CONCISE_TURN_REMINDER, OUTPUT_STYLE_CONFIG } from '../outputStyles.js'

describe('densable Concise output style 237', () => {
  test('built-in Concise present with SEA description and keepCodingInstructions', () => {
    const concise = OUTPUT_STYLE_CONFIG.Concise
    expect(concise).not.toBeNull()
    expect(concise!.name).toBe('Concise')
    expect(concise!.source).toBe('built-in')
    expect(concise!.keepCodingInstructions).toBe(true)
    expect(concise!.description).toContain('tersely')
    expect(concise!.description).toContain('preamble and narration')
  })

  test('prompt includes Concise Style Active + six $AT rules', () => {
    const prompt = OUTPUT_STYLE_CONFIG.Concise!.prompt
    expect(prompt).toContain('# Concise Style Active')
    expect(prompt).toContain('The user chose brevity over narration')
    expect(prompt).toContain('Lead with the result')
    expect(prompt).toContain('Never trade correctness for brevity')
    expect(prompt).toContain(
      'Where these rules conflict with more general communication',
    )
  })

  test('turnReminder is SEA BAT', () => {
    expect(OUTPUT_STYLE_CONFIG.Concise!.turnReminder).toBe(
      CONCISE_TURN_REMINDER,
    )
    expect(CONCISE_TURN_REMINDER).toBe(
      'Be concise: lead with the result, skip preamble and narration, keep only what the user needs.',
    )
  })

  test('does not invent Proactive built-in (236+/non-237 bullet)', () => {
    expect(Object.hasOwn(OUTPUT_STYLE_CONFIG, 'Proactive')).toBe(false)
  })
})
