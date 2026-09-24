import { afterEach, describe, expect, test } from 'bun:test'
import {
  estimatePromptCacheRecacheTokens,
  expectPromptCacheDrop,
  MAIN_PROMPT_CACHE_SCOPE,
  PromptCacheTracker,
  recordPromptCacheFromUsage,
  recordPromptCacheUsage,
  resetPromptCacheSessionBagForTests,
  resolvePromptCacheRecordTtl,
  shouldRecordMainPromptCache,
  summarizePromptCache,
} from '../promptCacheTracker.js'
import {
  formatPromptCacheCostLine,
  promptCacheCommandFields,
  resetPromptCacheTrackerForTests,
} from '../promptCacheStatus.js'

afterEach(() => {
  resetPromptCacheTrackerForTests()
  resetPromptCacheSessionBagForTests()
})

describe('PromptCacheTracker xhe (2.1.251)', () => {
  test('first record is cold and summary is warm within 5m TTL', () => {
    const t = new PromptCacheTracker()
    const at = 1_700_000_000_000
    const entry = t.record({
      at,
      ttl: '5m',
      inputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 500,
    })
    expect(entry.outcome).toBe('cold')
    expect(t.coldStarts).toBe(1)
    expect(t.requests).toBe(1)
    const s = t.summary(at + 1_000)
    expect(s.warm).toBe(true)
    expect(s.cachingObserved).toBe(true)
    expect(s.cacheWriteTokens).toBe(500)
    expect(s.expiresAt).toBe(at + 300_000)
    expect(s.hitRatio).toBeCloseTo(0 / 600)
  })

  test('hit when most of the window is cache_read', () => {
    const t = new PromptCacheTracker()
    const at = 1_700_000_000_000
    t.record({
      at,
      ttl: '5m',
      inputTokens: 50,
      cacheReadTokens: 0,
      cacheCreationTokens: 950,
    })
    const hit = t.record({
      at: at + 10_000,
      ttl: '5m',
      inputTokens: 40,
      cacheReadTokens: 960,
      cacheCreationTokens: 0,
    })
    expect(hit.outcome).toBe('hit')
    expect(t.hits).toBe(1)
    // Keep previous ttl when no new creation tokens
    expect(hit.ttl).toBe('5m')
  })

  test('miss when residual non-cached tokens >= Ven and drop not expected', () => {
    const t = new PromptCacheTracker()
    const at = 1_700_000_000_000
    t.record({
      at,
      ttl: '5m',
      inputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 5000,
    })
    const miss = t.record({
      at: at + 10_000,
      ttl: '5m',
      inputTokens: 3000,
      cacheReadTokens: 100,
      cacheCreationTokens: 2900,
    })
    expect(miss.outcome).toBe('miss')
    expect(t.misses).toBe(1)
    expect(t.missRecacheTokens).toBe(2900)
    expect(t.lastMissAt).toBe(at + 10_000)
  })

  test('expected rebuild when expectDrop is pending within TTL window', () => {
    const t = new PromptCacheTracker()
    const at = 1_700_000_000_000
    t.record({
      at,
      ttl: '5m',
      inputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 5000,
    })
    t.expectDrop(at + 5_000)
    const expected = t.record({
      at: at + 10_000,
      ttl: '5m',
      inputTokens: 3000,
      cacheReadTokens: 100,
      cacheCreationTokens: 2900,
    })
    expect(expected.outcome).toBe('expected')
    expect(t.expectedRebuilds).toBe(1)
    expect(t.misses).toBe(0)
  })

  test('estimateRecacheTokens returns null after expectDrop until next record', () => {
    recordPromptCacheUsage(MAIN_PROMPT_CACHE_SCOPE, {
      at: 1,
      ttl: '5m',
      inputTokens: 10,
      cacheReadTokens: 20,
      cacheCreationTokens: 30,
    })
    expect(estimatePromptCacheRecacheTokens()).toBe(60)
    expectPromptCacheDrop()
    expect(estimatePromptCacheRecacheTokens()).toBeNull()
  })
})

describe('D6e / c$t live wire helpers', () => {
  test('shouldRecordMainPromptCache matches gold ut gate', () => {
    expect(shouldRecordMainPromptCache('repl_main_thread', null)).toBe(true)
    expect(shouldRecordMainPromptCache('repl_main_thread:foo', null)).toBe(true)
    expect(shouldRecordMainPromptCache('sdk', null)).toBe(true)
    expect(shouldRecordMainPromptCache('agent:Explore', null)).toBe(false)
    expect(
      shouldRecordMainPromptCache('repl_main_thread', {
        agentType: 'subagent',
      }),
    ).toBe(false)
  })

  test('resolvePromptCacheRecordTtl prefers ephemeral buckets then Sr', () => {
    expect(
      resolvePromptCacheRecordTtl(
        { cache_creation: { ephemeral_1h_input_tokens: 1 } },
        '5m',
      ),
    ).toBe('1h')
    expect(
      resolvePromptCacheRecordTtl(
        { cache_creation: { ephemeral_5m_input_tokens: 1 } },
        '1h',
      ),
    ).toBe('5m')
    expect(resolvePromptCacheRecordTtl({}, '1h')).toBe('1h')
    expect(resolvePromptCacheRecordTtl({}, undefined)).toBe('5m')
  })

  test('recordPromptCacheFromUsage feeds oqe/whn live path', () => {
    const at = 1_700_000_000_000
    const entry = recordPromptCacheFromUsage(
      {
        input_tokens: 12,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 88,
      },
      {
        querySource: 'repl_main_thread',
        agentContext: null,
        intendedTtl: '5m',
        at,
      },
    )
    expect(entry?.outcome).toBe('cold')
    const summary = summarizePromptCache(MAIN_PROMPT_CACHE_SCOPE, at + 500)
    expect(summary.requests).toBe(1)
    expect(summary.warm).toBe(true)
    expect(promptCacheCommandFields(at + 500).prompt_cache).toEqual(
      expect.objectContaining({
        requests: 1,
        caching_observed: true,
        warm: true,
        ttl: '5m',
      }),
    )
    const line = formatPromptCacheCostLine(at + 500)
    expect(line).toContain('Prompt cache (main):')
    expect(line).toContain('1 request')
  })

  test('subagent querySource does not accumulate on main tracker', () => {
    expect(
      recordPromptCacheFromUsage(
        {
          input_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 1,
        },
        { querySource: 'agent:Explore', agentContext: null },
      ),
    ).toBeNull()
    expect(summarizePromptCache().requests).toBe(0)
  })
})
