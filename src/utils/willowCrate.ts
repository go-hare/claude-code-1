import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'

/**
 * densable `P6e` — `it("tengu_willow_crate", false)`.
 * Gates the fullscreen REPL diff tab. Official default is off; `/diff`
 * stays on DiffDialog until GrowthBook flips this on.
 */
export function isWillowCrateEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_willow_crate', false)
}
