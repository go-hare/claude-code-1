/**
 * densable 2.1.239 #1 — ima/tWb/eWb: US-only-inference premium is 1.1×
 * on token USD only (web search is not multiplied).
 */
import { describe, expect, mock, test } from 'bun:test'

mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { US_ONLY_INFERENCE_PREMIUM, calculateUSDCost } from '../modelCost.js'

function usage(
  partial: Partial<Usage> & { inference_geo?: string | null } = {},
): Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    ...partial,
  } as Usage
}

describe('densable 2.1.239 #1 tWb/eWb US-only-inference', () => {
  test('eWb is 1.1', () => {
    expect(US_ONLY_INFERENCE_PREMIUM).toBe(1.1)
  })

  test('inference_geo=us multiplies token cost by 1.1', () => {
    // list vig opus-5: 1M input @ $5
    const base = calculateUSDCost(
      'claude-opus-5',
      usage({ input_tokens: 1_000_000 }),
    )
    expect(base).toBeCloseTo(5, 6)
    const us = calculateUSDCost(
      'claude-opus-5',
      usage({ input_tokens: 1_000_000, inference_geo: 'us' }),
    )
    expect(us).toBeCloseTo(5 * US_ONLY_INFERENCE_PREMIUM, 6)
  })

  test('other / missing inference_geo is 1×', () => {
    const none = calculateUSDCost(
      'claude-opus-5',
      usage({ input_tokens: 1_000_000 }),
    )
    const eu = calculateUSDCost(
      'claude-opus-5',
      usage({ input_tokens: 1_000_000, inference_geo: 'eu' }),
    )
    expect(none).toBeCloseTo(5, 6)
    expect(eu).toBeCloseTo(5, 6)
  })

  test('web search is not multiplied (official r*tWb(t)+n)', () => {
    const us = calculateUSDCost(
      'claude-opus-5',
      usage({
        input_tokens: 1_000_000,
        inference_geo: 'us',
        server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
      }),
    )
    // 5 * 1.1 + 0.01
    expect(us).toBeCloseTo(5 * US_ONLY_INFERENCE_PREMIUM + 0.01, 6)
  })
})
