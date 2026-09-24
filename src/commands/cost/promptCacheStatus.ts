import type { StatusLineCommandInput } from '../../types/statusLine.js'
import { formatRelativeTimeAgo, formatTokens } from '../../utils/format.js'
import {
  estimatePromptCacheRecacheTokens,
  resetPromptCacheSessionBagForTests,
  summarizePromptCache,
  type PromptCacheSummary,
} from './promptCacheTracker.js'

/**
 * Fields `oqe` / `whn` read off `c$t` (`summarizePromptCache`).
 * Live accumulate is `xhe.record` via `D6e` / `recordPromptCacheUsage`.
 */
export type PromptCacheTrackerSnapshot = {
  requests: number
  lastRequest: { ttl: string; at: number } | null
  warm: boolean
  cachingObserved: boolean
  expiresAt: number | null
  misses: number
  expectedRebuilds: number
  hitRatio: number | null
  cacheWriteTokens: number
  missRecacheTokens: number
  lastMissAt: number | null
  lastActivityAt: number | null
}

type PromptCacheStatus = NonNullable<StatusLineCommandInput['prompt_cache']>

/** Project `c$t` summary onto the oqe/whn snapshot shape. */
export function snapshotFromSummary(
  summary: PromptCacheSummary,
): PromptCacheTrackerSnapshot {
  const last = summary.lastRequest
  return {
    requests: summary.requests,
    lastRequest: last === null ? null : { ttl: last.ttl, at: last.at },
    warm: summary.warm,
    cachingObserved: summary.cachingObserved,
    expiresAt: summary.expiresAt,
    misses: summary.misses,
    expectedRebuilds: summary.expectedRebuilds,
    hitRatio: summary.hitRatio,
    cacheWriteTokens: summary.cacheWriteTokens,
    missRecacheTokens: summary.missRecacheTokens,
    lastMissAt: summary.lastMissAt,
    lastActivityAt: summary.lastActivityAt,
  }
}

/**
 * densable `c$t` + `u$t` live read — used by tests that need to pin a
 * snapshot without going through record. Production paths always call
 * summarizePromptCache / estimatePromptCacheRecacheTokens directly.
 */
let testOverride: {
  snapshot: PromptCacheTrackerSnapshot
  cold: number | null
} | null = null

export function setPromptCacheTrackerForTests(
  next: PromptCacheTrackerSnapshot,
  cold: number | null,
): void {
  testOverride = { snapshot: next, cold }
}

export function resetPromptCacheTrackerForTests(): void {
  testOverride = null
  resetPromptCacheSessionBagForTests()
}

function liveSnapshot(now = Date.now()): PromptCacheTrackerSnapshot {
  if (testOverride !== null) return testOverride.snapshot
  return snapshotFromSummary(summarizePromptCache(undefined, now))
}

function liveColdTokens(): number | null {
  if (testOverride !== null) return testOverride.cold
  return estimatePromptCacheRecacheTokens()
}

/**
 * densable 2.1.251 `oqe` projection.
 * `expires_at` uses `Math.ceil(ms/1000)`; `last_miss_at` uses `Math.floor`.
 * `recache_tokens_if_cold` is `u$t()`.
 */
export function promptCacheFromTracker(
  tracker: PromptCacheTrackerSnapshot,
  coldTokens: number | null,
): { prompt_cache: PromptCacheStatus } | Record<string, never> {
  if (tracker.requests === 0 || tracker.lastRequest === null) return {}
  return {
    prompt_cache: {
      warm: tracker.warm,
      caching_observed: tracker.cachingObserved,
      ttl: tracker.lastRequest.ttl,
      expires_at:
        tracker.expiresAt === null ? null : Math.ceil(tracker.expiresAt / 1000),
      requests: tracker.requests,
      misses: tracker.misses,
      expected_rebuilds: tracker.expectedRebuilds,
      hit_ratio: tracker.hitRatio,
      cache_write_tokens: tracker.cacheWriteTokens,
      miss_recache_tokens: tracker.missRecacheTokens,
      last_miss_at:
        tracker.lastMissAt === null
          ? null
          : Math.floor(tracker.lastMissAt / 1000),
      recache_tokens_if_cold: coldTokens,
    },
  }
}

/** densable `oqe()` against the session tracker. Empty tracker spreads nothing. */
export function promptCacheCommandFields(
  now = Date.now(),
): { prompt_cache: PromptCacheStatus } | Record<string, never> {
  return promptCacheFromTracker(liveSnapshot(now), liveColdTokens())
}

/**
 * Local stand-in for `Ft`. The gold template places `Ft(ms)` before the word
 * "ago", so this returns a duration without that suffix. `Ft`'s own body is
 * not in gold-251-a.
 */
function formatElapsed(elapsedMs: number): string {
  const now = new Date()
  const phrase = formatRelativeTimeAgo(new Date(now.getTime() - elapsedMs), {
    now,
    style: 'narrow',
  })
  const ago = ' ago'
  return phrase.endsWith(ago) ? phrase.slice(0, -ago.length) : phrase
}

/**
 * densable 2.1.251 `whn`. Returns null on the same early condition as `oqe`.
 * `formatElapsed` / `formatTokenCount` stand in for `Ft` / `Wo`.
 */
export function formatPromptCacheLine(
  tracker: PromptCacheTrackerSnapshot,
  coldTokens: number | null,
  now = Date.now(),
  formatElapsedMs: (elapsedMs: number) => string = formatElapsed,
  formatTokenCount: (tokens: number) => string = formatTokens,
): string | null {
  if (tracker.requests === 0 || tracker.lastRequest === null) return null
  const parts = [
    `${tracker.requests} ${tracker.requests === 1 ? 'request' : 'requests'}`,
  ]
  if (tracker.hitRatio !== null) {
    parts.push(
      `${Math.round(tracker.hitRatio * 100)}% of input tokens from cache`,
    )
  }
  const missAgo = formatElapsedMs(now - (tracker.lastMissAt ?? now))
  parts.push(
    tracker.misses === 0
      ? 'no misses'
      : `${tracker.misses} ${tracker.misses === 1 ? 'miss' : 'misses'} (last ${missAgo} ago, ${formatTokenCount(tracker.missRecacheTokens)} tokens re-cached)`,
  )
  if (tracker.expectedRebuilds > 0) {
    parts.push(
      `${tracker.expectedRebuilds} expected ${tracker.expectedRebuilds === 1 ? 'rebuild' : 'rebuilds'} (compaction or tool-result clearing)`,
    )
  }
  const activityAgo = formatElapsedMs(
    now - (tracker.lastActivityAt ?? tracker.lastRequest.at),
  )
  if (!tracker.cachingObserved) {
    parts.push('no prompt caching reported by the API')
  } else if (tracker.warm) {
    parts.push(
      `warm (${tracker.lastRequest.ttl} TTL, last activity ${activityAgo} ago)`,
    )
  } else if (coldTokens === null) {
    parts.push(
      `cold — idle ${activityAgo}, next turn re-caches the compacted prompt`,
    )
  } else {
    parts.push(
      `cold — idle ${activityAgo}, next turn re-caches ~${formatTokenCount(coldTokens)} tokens`,
    )
  }
  return `Prompt cache (main):   ${parts.join(' · ')}`
}

/** `/cost` line from the session tracker (`whn`). */
export function formatPromptCacheCostLine(now = Date.now()): string | null {
  return formatPromptCacheLine(liveSnapshot(now), liveColdTokens(), now)
}
