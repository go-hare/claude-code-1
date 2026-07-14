/**
 * Official vNy — CLAUDE_CODE_SUBAGENT_CACHE_EVICT / tengu_subagent_cache_evict.
 *
 * When enabled, subagent image/document tool results may be evicted from the
 * prompt cache more aggressively. Full eviction wiring stays in the cache
 * path; this is the portable gate.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvTruthy } from './envUtils.js'

/**
 * @param prerequisites both official wN() and Wqt() must already be true
 *   (caller supplies — typically feature + model support).
 */
export function isSubagentCacheEvictEnabled(input: {
  prerequisitesMet: boolean
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  if (!input.prerequisitesMet) return false
  const env = input.env ?? process.env
  if (env.CLAUDE_CODE_SUBAGENT_CACHE_EVICT !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_SUBAGENT_CACHE_EVICT)
  }
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_subagent_cache_evict',
    false,
  )
}

/** Official sSo — media blocks that participate in cache eviction. */
export function isEvictableMediaBlock(block: { type: string }): boolean {
  return block.type === 'image' || block.type === 'document'
}
