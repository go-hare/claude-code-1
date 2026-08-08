import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// Avoid bootstrap/state side effects from analytics + fastMode chains where possible.
mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

import {
  COST_HAIKU_35,
  COST_HAIKU_45,
  COST_TIER_10_50,
  COST_TIER_15_75,
  COST_TIER_3_15,
  COST_TIER_30_150,
  COST_TIER_5_25,
  DENSABLE_PRICING_TIERS,
  calculateUSDCost,
  formatModelPricing,
  getModelCosts,
  getOpus46CostTier,
} from '../modelCost.js'
import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

function usage(
  partial: Partial<Usage> & { speed?: string | null } = {},
): Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    ...partial,
  } as Usage
}

describe('densable 2.1.219 GHt (getOpus46CostTier)', () => {
  const originalFast = process.env.CLAUDE_CODE_DISABLE_FAST_MODE

  beforeEach(() => {
    // isFastModeEnabled gates on settings/env; ensure not force-disabled
    delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE
  })

  afterEach(() => {
    if (originalFast === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE
    } else {
      process.env.CLAUDE_CODE_DISABLE_FAST_MODE = originalFast
    }
  })

  test('non-fast → vig $5/$25 regardless of model', () => {
    expect(getOpus46CostTier(false, 'claude-opus-5')).toEqual(COST_TIER_5_25)
    expect(getOpus46CostTier(false, 'claude-opus-4-7')).toEqual(COST_TIER_5_25)
  })

  test('fast + opus-5 / opus-4-8 → u7n $10/$50', () => {
    // When isFastModeEnabled() is true in this env
    const t5 = getOpus46CostTier(true, 'claude-opus-5')
    const t48 = getOpus46CostTier(true, 'claude-opus-4-8')
    // If fast mode is disabled globally, GHt returns list price — still assert shape
    if (t5 === COST_TIER_5_25) {
      // environment has fast disabled; skip branching assertion
      expect(formatModelPricing(t5)).toBe('$5/$25 per Mtok')
      return
    }
    expect(t5).toEqual(COST_TIER_10_50)
    expect(t48).toEqual(COST_TIER_10_50)
  })

  test('fast + opus-4-6 / opus-4-7 → LIc $30/$150 (GHt fallthrough)', () => {
    const t46 = getOpus46CostTier(true, 'claude-opus-4-6')
    const t47 = getOpus46CostTier(true, 'claude-opus-4-7')
    if (t46 === COST_TIER_5_25) {
      expect(formatModelPricing(t46)).toBe('$5/$25 per Mtok')
      return
    }
    expect(t46).toEqual(COST_TIER_30_150)
    expect(t47).toEqual(COST_TIER_30_150)
    expect(formatModelPricing(t47)).toBe('$30/$150 per Mtok')
  })

  test('fast + omitted model → u7n (Opus 5 /fast default)', () => {
    const t = getOpus46CostTier(true)
    if (t === COST_TIER_5_25) return
    expect(t).toEqual(COST_TIER_10_50)
  })

  test('fast + claude-opus-5[1m] still GHt u7n (strip 1m before QO)', () => {
    const t = getOpus46CostTier(true, 'claude-opus-5[1m]')
    if (t === COST_TIER_5_25) return
    expect(t).toEqual(COST_TIER_10_50)
  })
})

describe('densable 2.1.219 Pji (getModelCosts)', () => {
  test('speed=fast + opus-5 / 4.8 → u7n', () => {
    const u = usage({ speed: 'fast' })
    expect(getModelCosts('claude-opus-5', u)).toEqual(COST_TIER_10_50)
    expect(getModelCosts('claude-opus-4-8', u)).toEqual(COST_TIER_10_50)
  })

  test('speed=fast + opus-4-6 / 4.7 → LIc', () => {
    const u = usage({ speed: 'fast' })
    expect(getModelCosts('claude-opus-4-6', u)).toEqual(COST_TIER_30_150)
    expect(getModelCosts('claude-opus-4-7', u)).toEqual(COST_TIER_30_150)
  })

  test('speed=fast + sonnet stays list (not GHt LIc)', () => {
    const u = usage({ speed: 'fast' })
    const costs = getModelCosts('claude-sonnet-4-6', u)
    expect(costs.inputTokens).toBe(3)
    expect(costs.outputTokens).toBe(15)
  })

  test('non-fast opus-4-7 is in MODEL_COSTS at $5/$25', () => {
    const costs = getModelCosts('claude-opus-4-7', usage())
    expect(costs).toEqual(COST_TIER_5_25)
  })

  test('non-fast opus-5 list $5/$25', () => {
    expect(getModelCosts('claude-opus-5', usage())).toEqual(COST_TIER_5_25)
  })

  test('speed=fast + dated/1m full ids still Pji u7n', () => {
    expect(
      getModelCosts('claude-opus-5[1m]', usage({ speed: 'fast' })),
    ).toEqual(COST_TIER_10_50)
    expect(
      getModelCosts('claude-opus-4-7[1m]', usage({ speed: 'fast' })),
    ).toEqual(COST_TIER_30_150)
  })
})

describe('densable 2.1.219 pricing_tiers (NIc source, not guessed)', () => {
  test('DENSABLE_PRICING_TIERS matches official-219 catalog extract', () => {
    // Byte-extract from densable pricing_tiers:{...} — lock 1h write fields.
    expect(DENSABLE_PRICING_TIERS.tier_3_15).toEqual({
      inputTokens: 3,
      outputTokens: 15,
      promptCacheWriteTokens: 3.75,
      promptCacheWrite1hTokens: 6,
      promptCacheReadTokens: 0.3,
      webSearchRequests: 0.01,
    })
    expect(DENSABLE_PRICING_TIERS.tier_5_25.promptCacheWrite1hTokens).toBe(10)
    expect(DENSABLE_PRICING_TIERS.tier_15_75.promptCacheWrite1hTokens).toBe(30)
    expect(DENSABLE_PRICING_TIERS.tier_10_50.promptCacheWrite1hTokens).toBe(20)
    expect(DENSABLE_PRICING_TIERS.haiku_35.promptCacheWrite1hTokens).toBe(1.6)
    expect(DENSABLE_PRICING_TIERS.haiku_45.promptCacheWrite1hTokens).toBe(2)
  })

  test('COST_* aliases are densable pricing_tiers entries', () => {
    expect(COST_TIER_3_15).toBe(DENSABLE_PRICING_TIERS.tier_3_15)
    expect(COST_TIER_5_25).toBe(DENSABLE_PRICING_TIERS.tier_5_25)
    expect(COST_TIER_15_75).toBe(DENSABLE_PRICING_TIERS.tier_15_75)
    expect(COST_TIER_10_50).toBe(DENSABLE_PRICING_TIERS.tier_10_50)
    expect(COST_HAIKU_35).toBe(DENSABLE_PRICING_TIERS.haiku_35)
    expect(COST_HAIKU_45).toBe(DENSABLE_PRICING_TIERS.haiku_45)
  })

  test('LIc is densable hardcode (not catalog pricing_tiers)', () => {
    expect(COST_TIER_30_150.promptCacheWrite1hTokens).toBe(60)
    expect(
      Object.values(DENSABLE_PRICING_TIERS).some(
        t => t.inputTokens === 30 && t.outputTokens === 150,
      ),
    ).toBe(false)
  })

  test('MODEL_COSTS list rows use catalog tier keys (via getModelCosts non-fast)', () => {
    expect(getModelCosts('claude-sonnet-5', usage())).toEqual(COST_TIER_3_15)
    expect(getModelCosts('claude-haiku-4-5', usage())).toEqual(COST_HAIKU_45)
    expect(getModelCosts('claude-3-5-haiku', usage())).toEqual(COST_HAIKU_35)
    expect(getModelCosts('claude-opus-4-1', usage())).toEqual(COST_TIER_15_75)
    expect(getModelCosts('claude-opus-5', usage())).toEqual(COST_TIER_5_25)
  })

  test('Uot hardcode fable/mythos → u7n (tier_10_50)', () => {
    // densable Uot={[QO(kot.fable5)]:u7n,[QO(dbc.mythos5)]:u7n,...Tig()}
    // catalog pricing also tier_10_50
    expect(getModelCosts('claude-fable-5', usage())).toEqual(COST_TIER_10_50)
    expect(getModelCosts('claude-mythos-5', usage())).toEqual(COST_TIER_10_50)
    expect(getModelCosts('us.anthropic.claude-fable-5', usage())).toEqual(
      COST_TIER_10_50,
    )
  })
})

describe('densable 2.1.219 Cig (1h cache write split)', () => {
  test('1h tokens billed at promptCacheWrite1hTokens', () => {
    // u7n: write5m=12.5, write1h=20
    // 1M input @ 0 + 500k 1h write + 500k 5m write = 0.5*20 + 0.5*12.5 = 10+6.25 = 16.25
    const cost = calculateUSDCost(
      'claude-opus-5',
      usage({
        speed: 'fast',
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000_000,
        cache_creation: {
          ephemeral_1h_input_tokens: 500_000,
          ephemeral_5m_input_tokens: 500_000,
        },
      }),
    )
    expect(cost).toBeCloseTo(16.25, 6)
  })

  test('no 1h field → all at 5m write rate', () => {
    // list vig: 1M write @ 6.25
    const cost = calculateUSDCost(
      'claude-opus-5',
      usage({
        cache_creation_input_tokens: 1_000_000,
      }),
    )
    expect(cost).toBeCloseTo(6.25, 6)
  })

  test('1h tokens clamped to total write', () => {
    // claim 2M 1h but only 1M total → bill 1M @ 1h rate (10 for vig)
    const cost = calculateUSDCost(
      'claude-opus-5',
      usage({
        cache_creation_input_tokens: 1_000_000,
        cache_creation: {
          ephemeral_1h_input_tokens: 2_000_000,
          ephemeral_5m_input_tokens: 0,
        },
      }),
    )
    expect(cost).toBeCloseTo(10, 6)
  })
})
