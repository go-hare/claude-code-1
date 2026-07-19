/**
 * densable basalt_spur / basalt_scarp — ant-only GrowthBook gates for
 * memory-fork cache behaviour and auto-compact preserve-window tuning.
 *
 * densable:
 *   krr() = USER_TYPE==ant && et("tengu_basalt_spur", false)
 *   LKu() = USER_TYPE==ant && et("tengu_basalt_scarp", false)
 *
 * spur → skipCacheWrite on extract_memories / auto_dream forks + cache breakpoints
 * scarp → when spur+skipCacheWrite+forkIdx===primary, step fork pin one cacheable back
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'

function isAntUserType(userType?: string): boolean {
  return (userType ?? process.env.USER_TYPE) === 'ant'
}

/** densable krr — skip prompt-cache writes on memory extract/dream forks. */
export function shouldSkipMemoryForkCacheWrite(input: {
  userType?: string
  gbValue?: boolean
} = {}): boolean {
  if (!isAntUserType(input.userType)) return false
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_basalt_spur', false)
}

/** densable LKu — scarp preserve-window / fork-pin step-back. */
export function isBasaltScarpPreserveWindowEnabled(input: {
  userType?: string
  gbValue?: boolean
} = {}): boolean {
  if (!isAntUserType(input.userType)) return false
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_basalt_scarp', false)
}
