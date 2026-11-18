import { afterEach, describe, expect, test } from 'bun:test'
import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  ALL_MODEL_CONFIGS,
  CLAUDE_HAIKU_5_5_CONFIG,
  CLAUDE_SONNET_5_5_CONFIG,
} from '../model/configs.js'
import {
  firstPartyNameToCanonical,
  getDefaultHaikuModel,
  getMarketingNameForModel,
  getPublicModelDisplayName,
} from '../model/model.js'
import {
  COST_HAIKU_55,
  COST_TIER_2_10,
  COST_TIER_2_10_CACHE_READ_0_10,
  MODEL_COSTS,
  calculateUSDCost,
} from '../modelCost.js'

const SAVED_ENV = { ...process.env }

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED_ENV)) delete process.env[key]
  }
  Object.assign(process.env, SAVED_ENV)
})

function makeUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation: null,
    server_tool_use: null,
    service_tier: null,
    inference_geo: null,
    speed: null,
    ...overrides,
  } as Usage
}

describe('v2.1.293 #285 & #498 Haiku 5.5 model, config, and pricing', () => {
  test('CLAUDE_HAIKU_5_5_CONFIG matches official 325 catalog provider IDs', () => {
    expect(CLAUDE_HAIKU_5_5_CONFIG.firstParty).toBe('claude-haiku-5-5')
    expect(CLAUDE_HAIKU_5_5_CONFIG.bedrock).toBe(
      'us.anthropic.claude-haiku-5-5',
    )
    expect(CLAUDE_HAIKU_5_5_CONFIG.vertex).toBe('claude-haiku-5-5')
    expect(CLAUDE_HAIKU_5_5_CONFIG.foundry).toBe('claude-haiku-5-5')
    expect(CLAUDE_HAIKU_5_5_CONFIG.mantle).toBe('anthropic.claude-haiku-5-5')
    expect(ALL_MODEL_CONFIGS.haiku55).toBe(CLAUDE_HAIKU_5_5_CONFIG)
  })

  test('firstPartyNameToCanonical, getPublicModelDisplayName, and getMarketingNameForModel support Haiku 5.5', () => {
    expect(firstPartyNameToCanonical('claude-haiku-5-5')).toBe(
      'claude-haiku-5-5',
    )
    expect(firstPartyNameToCanonical('claude-haiku-5-5-20260601')).toBe(
      'claude-haiku-5-5',
    )
    expect(getPublicModelDisplayName('claude-haiku-5-5')).toBe('Haiku 5.5')
    expect(getPublicModelDisplayName('claude-haiku-5-5[1m]')).toBe(
      'Haiku 5.5 (1M context)',
    )
    expect(getMarketingNameForModel('claude-haiku-5-5')).toBe('Haiku 5.5')
    expect(getMarketingNameForModel('claude-haiku-5-5[1m]')).toBe(
      'Haiku 5.5 (1M context)',
    )
  })

  test('getDefaultHaikuModel returns claude-haiku-5-5 on 1P and haiku-4-5 on 3P', () => {
    delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.ANTHROPIC_BASE_URL
    expect(getDefaultHaikuModel()).toBe('claude-haiku-5-5')

    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(getDefaultHaikuModel()).toContain('claude-haiku-4-5')
    expect(getDefaultHaikuModel()).not.toBe('claude-haiku-5-5')
  })

  test('Haiku 5.5 pricing uses $0.10/$0.50 up to 100K prompt tokens and $0.50/$2.50 above 100K', () => {
    expect(MODEL_COSTS['claude-haiku-5-5']).toBe(COST_HAIKU_55)
    expect(COST_HAIKU_55.inputTokens).toBe(0.1)
    expect(COST_HAIKU_55.outputTokens).toBe(0.5)
    expect(COST_HAIKU_55.longPrompt?.abovePromptTokens).toBe(100_000)
    expect(COST_HAIKU_55.longPrompt?.inputTokens).toBe(0.5)
    expect(COST_HAIKU_55.longPrompt?.outputTokens).toBe(2.5)

    // <= 100K prompt tokens: standard tier ($0.10/Mtok input, $0.50/Mtok output)
    const under100k = calculateUSDCost(
      'claude-haiku-5-5',
      makeUsage({ input_tokens: 100_000, output_tokens: 10_000 }),
    )
    expect(under100k).toBeCloseTo(0.01 + 0.005, 8)

    // > 100K prompt tokens (input + cache_read + cache_creation): longPrompt tier
    const over100k = calculateUSDCost(
      'claude-haiku-5-5',
      makeUsage({
        input_tokens: 60_000,
        cache_read_input_tokens: 40_001,
        output_tokens: 10_000,
      }),
    )
    expect(over100k).toBeCloseTo(
      (60_000 / 1e6) * 0.5 + (40_001 / 1e6) * 0.05 + (10_000 / 1e6) * 2.5,
      8,
    )
  })
})

describe('v2.1.296 #544 Sonnet 5.5 cache read at $0.10/Mtok', () => {
  test('Sonnet 5.5 uses tier_2_10_cache_read_0_10 ($0.10/Mtok) while Sonnet 5 keeps $0.20/Mtok', () => {
    expect(MODEL_COSTS[CLAUDE_SONNET_5_5_CONFIG.firstParty]).toBe(
      COST_TIER_2_10_CACHE_READ_0_10,
    )
    expect(COST_TIER_2_10_CACHE_READ_0_10.promptCacheReadTokens).toBe(0.1)
    expect(COST_TIER_2_10.promptCacheReadTokens).toBe(0.2)

    const sonnet55CacheCost = calculateUSDCost(
      'claude-sonnet-5-5',
      makeUsage({ cache_read_input_tokens: 1_000_000 }),
    )
    expect(sonnet55CacheCost).toBeCloseTo(0.1, 8)

    const sonnet5CacheCost = calculateUSDCost(
      'claude-sonnet-5',
      makeUsage({ cache_read_input_tokens: 1_000_000 }),
    )
    expect(sonnet5CacheCost).toBeCloseTo(0.2, 8)
  })
})
