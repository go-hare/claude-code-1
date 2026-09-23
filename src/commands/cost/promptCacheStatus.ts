import type { StatusLineCommandInput } from '../../types/statusLine.js'
import { formatRelativeTimeAgo, formatTokens } from '../../utils/format.js'

/**
 * Fields `oqe` / `whn` read off `c$t`. The tracker body is not in gold-251-a,
 * so production starts empty (`requests === 0`) and both functions take the
 * early return until a snapshot is supplied.
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

const EMPTY_SNAPSHOT: PromptCacheTrackerSnapshot = {
  requests: 0,
  lastRequest: null,
  warm: false,
  cachingObserved: false,
  expiresAt: null,
  misses: 0,
  expectedRebuilds: 0,
  hitRatio: null,
  cacheWriteTokens: 0,
  missRecacheTokens: 0,
  lastMissAt: null,
  lastActivityAt: null,
}

let snapshot: PromptCacheTrackerSnapshot = EMPTY_SNAPSHOT
let recacheTokensIfCold: number | null = null

export function setPromptCacheTrackerForTests(
  next: PromptCacheTrackerSnapshot,
  cold: number | null,
): void {
  snapshot = next
  recacheTokensIfCold = cold
}

export function resetPromptCacheTrackerForTests(): void {
  snapshot = EMPTY_SNAPSHOT
  recacheTokensIfCold = null
}

/**
 * densable 2.1.251 `oqe` projection.
 * `expires_at` uses `Math.ceil(ms/1000)`; `last_miss_at` uses `Math.floor`.
 * `recache_tokens_if_cold` is `u$t()` (passed in; body not in the gold file).
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

/** `oqe()` against the session tracker. Empty tracker spreads nothing. */
export function promptCacheCommandFields():
  | { prompt_cache: PromptCacheStatus }
  | Record<string, never> {
  return promptCacheFromTracker(snapshot, recacheTokensIfCold)
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
  return formatPromptCacheLine(snapshot, recacheTokensIfCold, now)
}
