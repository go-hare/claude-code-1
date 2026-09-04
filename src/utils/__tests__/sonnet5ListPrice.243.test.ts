import { describe, expect, test } from 'bun:test'

import {
  COST_TIER_2_10,
  formatModelPricing,
  getModelCosts,
} from '../modelCost.js'
import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

describe('sonnet 5 243 list price', () => {
  test('tier_2_10 is $2/$10', () => {
    expect(formatModelPricing(COST_TIER_2_10)).toBe('$2/$10 per Mtok')
    expect(COST_TIER_2_10.inputTokens).toBe(2)
    expect(COST_TIER_2_10.outputTokens).toBe(10)
    expect(COST_TIER_2_10.promptCacheWriteTokens).toBe(2.5)
    expect(COST_TIER_2_10.promptCacheWrite1hTokens).toBe(4)
    expect(COST_TIER_2_10.promptCacheReadTokens).toBe(0.2)
  })

  test('getModelCosts(claude-sonnet-5) uses tier_2_10', () => {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
    } as Usage
    expect(getModelCosts('claude-sonnet-5', usage)).toEqual(COST_TIER_2_10)
  })
})
