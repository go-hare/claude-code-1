/**
 * densable 2.1.238 KSl — drawsFromUsageCredits / ASm billing fragment.
 * Uses the env bag so we do not mock extraUsage.ts (process-global mock.module).
 */
import { describe, expect, test } from 'bun:test'
import {
  DRAWS_FROM_USAGE_CREDITS_SUFFIX,
  drawsFromUsageCredits,
  isBilledAsExtraUsage,
  isKSlDefaultFableEnv,
} from '../extraUsage.js'

const billed = {
  subscriber: true,
  // Always pin sSe/amt so fall-through never hits live isClaudeAISubscriber
  // (auth throws without ANTHROPIC_API_KEY in unit tests).
  creditsExempt: false,
  fableCreditsRequired: false,
} as const

describe('densable 2.1.238 KSl drawsFromUsageCredits', () => {
  test('gs() false → false regardless of model/fast', () => {
    expect(
      drawsFromUsageCredits('claude-opus-5', true, false, {
        subscriber: false,
        fastModeSupported: true,
        resolved: 'claude-opus-5',
      }),
    ).toBe(false)
  })

  test('t && DA(e) → true (fast + supported)', () => {
    expect(
      drawsFromUsageCredits('claude-opus-5', true, false, {
        ...billed,
        fastModeSupported: true,
        resolved: 'claude-opus-5',
      }),
    ).toBe(true)
  })

  test('fast on unsupported model does not short-circuit', () => {
    expect(
      drawsFromUsageCredits('claude-haiku-4-5', true, false, {
        ...billed,
        fastModeSupported: false,
        resolved: 'claude-haiku-4-5',
        disable1m: false,
      }),
    ).toBe(false)
  })

  test('fable + !sSe + amt/BXe → true even without [1m]', () => {
    expect(
      drawsFromUsageCredits('claude-fable-5', false, false, {
        ...billed,
        fastModeSupported: false,
        resolved: 'claude-fable-5',
        fableCreditsRequired: true,
      }),
    ).toBe(true)
  })

  test('fable + sSe exempt → fall through; no [1m] → false', () => {
    expect(
      drawsFromUsageCredits('claude-fable-5', false, false, {
        ...billed,
        fastModeSupported: false,
        resolved: 'claude-fable-5',
        creditsExempt: true,
        fableCreditsRequired: true,
      }),
    ).toBe(false)
  })

  test('Vpe default-fable env match bills like fable family', () => {
    expect(
      drawsFromUsageCredits('custom-id', false, false, {
        ...billed,
        fastModeSupported: false,
        resolved: 'my-fable-id',
        defaultFableModel: 'my-fable-id',
        creditsExempt: false,
        fableCreditsRequired: true,
      }),
    ).toBe(true)
  })

  test('!kE(o) no [1m] → false for opus-4-6', () => {
    expect(
      drawsFromUsageCredits('claude-opus-4-6', false, false, {
        ...billed,
        fastModeSupported: false,
        resolved: 'claude-opus-4-6',
      }),
    ).toBe(false)
  })

  test('opus[1m] + l3 merged → false (i && r)', () => {
    expect(
      drawsFromUsageCredits('claude-opus-4-6[1m]', false, true, {
        ...billed,
        fastModeSupported: false,
        resolved: 'claude-opus-4-6[1m]',
        disable1m: false,
        opus1mMerged: true,
      }),
    ).toBe(false)
  })

  test('opus-4-6[1m] + not merged → true', () => {
    expect(
      drawsFromUsageCredits('claude-opus-4-6[1m]', false, false, {
        ...billed,
        fastModeSupported: false,
        resolved: 'claude-opus-4-6[1m]',
        disable1m: false,
        opus1mMerged: false,
      }),
    ).toBe(true)
  })

  test('sonnet-4-6[1m] bills even when merged (i is opus|fable only)', () => {
    expect(
      drawsFromUsageCredits('claude-sonnet-4-6[1m]', false, true, {
        ...billed,
        fastModeSupported: false,
        resolved: 'claude-sonnet-4-6[1m]',
        disable1m: false,
        opus1mMerged: true,
      }),
    ).toBe(true)
  })

  test('Gpe disable1m skips [1m] regex (kE false)', () => {
    expect(
      drawsFromUsageCredits('claude-opus-4-6[1m]', false, false, {
        ...billed,
        fastModeSupported: false,
        resolved: 'claude-opus-4-6[1m]',
        disable1m: true,
        opus1mMerged: false,
      }),
    ).toBe(false)
  })

  test('isBilledAsExtraUsage alias is the 3-arg KSl wrapper', () => {
    expect(isBilledAsExtraUsage.length).toBe(3)
    expect(
      drawsFromUsageCredits('claude-haiku-4-5', false, false, {
        ...billed,
        fastModeSupported: false,
        resolved: 'claude-haiku-4-5',
      }),
    ).toBe(false)
  })

  test('DRAWS_FROM_USAGE_CREDITS_SUFFIX is gold ASm fragment', () => {
    expect(DRAWS_FROM_USAGE_CREDITS_SUFFIX).toBe(' · Draws from usage credits')
  })

  test('Vpe strip trailing [1m] on both sides', () => {
    expect(isKSlDefaultFableEnv('foo[1m]', 'foo')).toBe(true)
    expect(isKSlDefaultFableEnv('foo', 'bar')).toBe(false)
    expect(isKSlDefaultFableEnv('foo', undefined)).toBe(false)
  })
})
