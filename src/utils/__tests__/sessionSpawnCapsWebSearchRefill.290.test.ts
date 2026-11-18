import { describe, expect, test } from 'bun:test'
import {
  createWebSearchBudget,
  DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
  DEFAULT_WEB_SEARCH_REFILLS_PER_HOUR,
  resolveWebSearchRefillsPerHour,
} from '../sessionSpawnCaps.js'

describe('v2.1.290 #158: 100/hr WebSearch refill budget', () => {
  test('defaults to 0 when refillsByDefault=false and 100 when refillsByDefault=true', () => {
    expect(DEFAULT_MAX_WEB_SEARCHES_PER_SESSION).toBe(200)
    expect(DEFAULT_WEB_SEARCH_REFILLS_PER_HOUR).toBe(100)
    expect(
      resolveWebSearchRefillsPerHour({ refillsByDefault: false, env: {} }),
    ).toBe(0)
    expect(
      resolveWebSearchRefillsPerHour({ refillsByDefault: true, env: {} }),
    ).toBe(100)
  })

  test('respects CLAUDE_CODE_WEB_SEARCH_REFILLS_PER_HOUR env override', () => {
    expect(
      resolveWebSearchRefillsPerHour({
        refillsByDefault: false,
        env: { CLAUDE_CODE_WEB_SEARCH_REFILLS_PER_HOUR: '50' },
      }),
    ).toBe(50)
    expect(
      resolveWebSearchRefillsPerHour({
        refillsByDefault: true,
        env: { CLAUDE_CODE_WEB_SEARCH_REFILLS_PER_HOUR: '0' },
      }),
    ).toBe(0)
  })

  test('refills at 100/hr (1 call every 36s) after hitting 200 burst cap', () => {
    let nowMs = 1_000_000
    const budget = createWebSearchBudget({
      refillsByDefault: true,
      now: () => nowMs,
      env: {},
    })

    for (let i = 0; i < 200; i++) {
      expect(budget.tryConsume()).toBe(true)
    }
    expect(budget.tryConsume()).toBe(false)
    expect(budget.refillsPerHour()).toBe(100)
    expect(budget.msUntilNextCall()).toBe(36_000)

    // Advance 36s → 1 token refilled
    nowMs += 36_000
    expect(budget.tryConsume()).toBe(true)
    expect(budget.tryConsume()).toBe(false)
  })
})
