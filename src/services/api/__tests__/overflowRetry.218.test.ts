/**
 * densable 2.1.218 #21 — context-overflow retry: no thinking inflate + no-progress abort.
 */
import { describe, expect, test } from 'bun:test'
import {
  decideMaxTokensOverflowAdjustment,
  FLOOR_OUTPUT_TOKENS,
} from '../withRetry.js'

describe('densable 2.1.218 #21 overflow retry decision', () => {
  test('sets maxTokens to availableContext only (no thinking inflate)', () => {
    // availableContext well above floor; prior override undefined
    const d = decideMaxTokensOverflowAdjustment(12_000, undefined)
    expect(d).toEqual({ action: 'set', maxTokens: 12_000 })
  })

  test('does not inflate to thinking budget when budget > available', () => {
    // Pre-218 local would Math.max(floor, available, budgetTokens+1)
    // densable only uses availableContext
    const available = 5_000
    const d = decideMaxTokensOverflowAdjustment(available, undefined)
    expect(d).toEqual({ action: 'set', maxTokens: available })
    // Explicitly not 20001 or any thinking inflate
    expect(d.action === 'set' && d.maxTokens).toBe(5_000)
  })

  test('throws below_floor when availableContext < FLOOR_OUTPUT_TOKENS', () => {
    const d = decideMaxTokensOverflowAdjustment(
      FLOOR_OUTPUT_TOKENS - 1,
      undefined,
    )
    expect(d).toEqual({ action: 'throw', reason: 'below_floor' })
  })

  test('throws no_progress when W >= previous override', () => {
    // Second overflow with same or larger available → doomed identical re-send
    expect(decideMaxTokensOverflowAdjustment(8_000, 8_000)).toEqual({
      action: 'throw',
      reason: 'no_progress',
    })
    expect(decideMaxTokensOverflowAdjustment(9_000, 8_000)).toEqual({
      action: 'throw',
      reason: 'no_progress',
    })
  })

  test('allows progress when W is strictly smaller than previous override', () => {
    expect(decideMaxTokensOverflowAdjustment(7_000, 8_000)).toEqual({
      action: 'set',
      maxTokens: 7_000,
    })
  })
})
