/**
 * densable 2.1.237 M5 — getAllOutputStyles merge preserves turnReminder
 * from custom/plugin/managed style objects (gold wHv / Concise BAT).
 *
 * Source-contract (no mock.module) so parallel outputStyle regression tests
 * are not polluted by process-global Bun mocks.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONCISE_TURN_REMINDER,
  OUTPUT_STYLE_CONFIG,
} from '../../constants/outputStyles.js'

describe('getAllOutputStyles merge turnReminder (M5)', () => {
  test('built-in Concise still carries SEA BAT (merge base)', () => {
    expect(OUTPUT_STYLE_CONFIG.Concise?.turnReminder).toBe(
      CONCISE_TURN_REMINDER,
    )
  })

  test('merge assignment preserves style.turnReminder field', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../constants/outputStyles.ts'),
      'utf8',
    )
    const fnIdx = src.indexOf('export const getAllOutputStyles')
    expect(fnIdx).toBeGreaterThanOrEqual(0)
    const mergeIdx = src.indexOf('allStyles[style.name] =', fnIdx)
    expect(mergeIdx).toBeGreaterThan(fnIdx)
    const block = src.slice(mergeIdx, mergeIdx + 450)
    expect(block).toContain('turnReminder: style.turnReminder')
    expect(block).toContain(
      'keepCodingInstructions: style.keepCodingInstructions',
    )
    expect(block).toContain('forceForPlugin: style.forceForPlugin')
  })
})
