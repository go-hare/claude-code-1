import { afterEach, describe, expect, test } from 'bun:test'
import { call } from '../cost.js'
import {
  formatPromptCacheCostLine,
  formatPromptCacheLine,
  promptCacheCommandFields,
  promptCacheFromTracker,
  resetPromptCacheTrackerForTests,
  setPromptCacheTrackerForTests,
  type PromptCacheTrackerSnapshot,
} from '../promptCacheStatus.js'

const now = 1_700_000_000_000

function tracker(
  overrides: Partial<PromptCacheTrackerSnapshot> = {},
): PromptCacheTrackerSnapshot {
  return {
    requests: 4,
    lastRequest: { ttl: '5m', at: now - 90_000 },
    warm: true,
    cachingObserved: true,
    expiresAt: now + 1_500,
    misses: 1,
    expectedRebuilds: 2,
    hitRatio: 0.876,
    cacheWriteTokens: 1200,
    missRecacheTokens: 340,
    lastMissAt: now - 30_000,
    lastActivityAt: now - 10_000,
    ...overrides,
  }
}

const elapsed = (ms: number) => `${ms}ms`
const tokens = (n: number) => String(n)

afterEach(() => {
  resetPromptCacheTrackerForTests()
})

describe('promptCacheFromTracker oqe', () => {
  test('returns nothing when there are no requests or no last request', () => {
    expect(promptCacheFromTracker(tracker({ requests: 0 }), 10)).toEqual({})
    expect(promptCacheFromTracker(tracker({ lastRequest: null }), 10)).toEqual(
      {},
    )
  })

  test('maps the locked field conversions', () => {
    expect(promptCacheFromTracker(tracker(), 80)).toEqual({
      prompt_cache: {
        warm: true,
        caching_observed: true,
        ttl: '5m',
        expires_at: Math.ceil((now + 1_500) / 1000),
        requests: 4,
        misses: 1,
        expected_rebuilds: 2,
        hit_ratio: 0.876,
        cache_write_tokens: 1200,
        miss_recache_tokens: 340,
        last_miss_at: Math.floor((now - 30_000) / 1000),
        recache_tokens_if_cold: 80,
      },
    })
  })

  test('null timestamps stay null and cold tokens pass through', () => {
    const mapped = promptCacheFromTracker(
      tracker({ expiresAt: null, lastMissAt: null }),
      null,
    )
    expect(mapped).toEqual({
      prompt_cache: expect.objectContaining({
        expires_at: null,
        last_miss_at: null,
        recache_tokens_if_cold: null,
      }),
    })
  })
})

describe('formatPromptCacheLine whn', () => {
  test('warm line joins the locked clauses', () => {
    const line = formatPromptCacheLine(tracker(), 80, now, elapsed, tokens)
    expect(line).toBe(
      'Prompt cache (main):   4 requests · 88% of input tokens from cache · 1 miss (last 30000ms ago, 340 tokens re-cached) · 2 expected rebuilds (compaction or tool-result clearing) · warm (5m TTL, last activity 10000ms ago)',
    )
  })

  test('singular request, no hit ratio, no misses, no caching', () => {
    const line = formatPromptCacheLine(
      tracker({
        requests: 1,
        hitRatio: null,
        misses: 0,
        expectedRebuilds: 0,
        cachingObserved: false,
      }),
      null,
      now,
      elapsed,
      tokens,
    )
    expect(line).toBe(
      'Prompt cache (main):   1 request · no misses · no prompt caching reported by the API',
    )
  })

  test('cold line with and without recache tokens', () => {
    const cold = tracker({ warm: false, expectedRebuilds: 0, hitRatio: null })
    expect(formatPromptCacheLine(cold, null, now, elapsed, tokens)).toContain(
      'cold — idle 10000ms, next turn re-caches the compacted prompt',
    )
    expect(formatPromptCacheLine(cold, 500, now, elapsed, tokens)).toContain(
      'cold — idle 10000ms, next turn re-caches ~500 tokens',
    )
  })

  test('null last miss uses a zero elapsed duration', () => {
    const line = formatPromptCacheLine(
      tracker({
        lastMissAt: null,
        misses: 2,
        hitRatio: null,
        expectedRebuilds: 1,
      }),
      null,
      now,
      elapsed,
      tokens,
    )
    expect(line).toContain('2 misses (last 0ms ago, 340 tokens re-cached)')
    expect(line).toContain(
      '1 expected rebuild (compaction or tool-result clearing)',
    )
  })

  test('empty tracker returns null and omits the status field', () => {
    expect(formatPromptCacheCostLine()).toBeNull()
    expect(promptCacheCommandFields()).toEqual({})
  })

  test('a stored snapshot feeds both the status object and the /cost line', () => {
    setPromptCacheTrackerForTests(tracker(), 80)
    expect(promptCacheCommandFields()).toEqual(
      promptCacheFromTracker(tracker(), 80),
    )
    expect(formatPromptCacheCostLine(now)).toBe(
      formatPromptCacheLine(tracker(), 80, now),
    )
  })

  test('/cost appends the whn line when the tracker has a request', async () => {
    setPromptCacheTrackerForTests(tracker(), 80)
    const result = await call('', {} as never)
    expect(result.type).toBe('text')
    if (result.type !== 'text') return
    expect(result.value).toContain('Prompt cache (main):')
    expect(result.value).toContain('tokens re-cached')
  })
})
