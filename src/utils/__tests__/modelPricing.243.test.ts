import { describe, expect, test } from 'bun:test'

import { compileModelPricing, lookupOrgModelCosts } from '../modelPricing.js'

describe('modelPricing 243 compile', () => {
  test('empty overrides and default multiplier is a no-op', () => {
    expect(compileModelPricing({})).toBeUndefined()
    expect(compileModelPricing({ multiplier: 1 })).toBeUndefined()
  })

  test('multiplier-only compiles', () => {
    const compiled = compileModelPricing({ multiplier: 0.8 })
    expect(compiled?.multiplier).toBe(0.8)
    expect(compiled?.exact.size).toBe(0)
  })

  test('exact spelling wins over later builtin alias', () => {
    const compiled = compileModelPricing({
      overrides: {
        'claude-sonnet-5': {
          input: 1,
          output: 4,
          cacheRead: 0.1,
          cacheWrite: 1.2,
        },
        'us.anthropic.claude-sonnet-5': {
          input: 9,
          output: 9,
          cacheRead: 0.1,
          cacheWrite: 1,
        },
      },
    })
    expect(compiled).toBeDefined()
    expect(lookupOrgModelCosts(compiled!, 'claude-sonnet-5')?.inputTokens).toBe(
      1,
    )
    expect(
      lookupOrgModelCosts(compiled!, 'us.anthropic.claude-sonnet-5')
        ?.inputTokens,
    ).toBe(9)
  })

  test('first exact key wins on repeat', () => {
    const compiled = compileModelPricing({
      overrides: {
        'Claude-Sonnet-5': { input: 2, output: 10 },
        'claude-sonnet-5': { input: 99, output: 99 },
      },
    })
    expect(lookupOrgModelCosts(compiled!, 'claude-sonnet-5')?.inputTokens).toBe(
      2,
    )
  })
})
