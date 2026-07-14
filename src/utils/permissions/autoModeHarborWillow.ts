/**
 * Official 2.1.207 silent auto fallback densable (tengu_harbor_willow).
 *
 * When no explicit CLI/settings permission mode resolved:
 *   if !circuitBroken
 *      && disableAutoMode !== 'disable' (settings + permissions)
 *      && Qe("tengu_harbor_willow")
 *      && (!isNonInteractiveSession || Qe("tengu_moss_anchor"))
 *   → mode=auto, fromAutoFallback=true
 *
 * Pure densable — product wires feature('TRANSCRIPT_CLASSIFIER') + GB gates
 * around this.
 */

export type HarborWillowPlanInput = {
  /** True when CLI/settings already produced a mode (bypass/auto/default/...). */
  hasResolvedMode: boolean
  /** Cached tengu_auto_mode_config.enabled === 'disabled' (ieh). */
  circuitBroken: boolean
  /** settings.disableAutoMode or settings.permissions.disableAutoMode === 'disable'. */
  disableAutoMode: boolean
  /** checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_harbor_willow'). */
  harborWillow: boolean
  isNonInteractiveSession: boolean
  /** checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_moss_anchor'). */
  mossAnchor: boolean
}

export type HarborWillowPlan = {
  mode: 'auto' | 'default'
  fromAutoFallback: boolean
}

/**
 * Official gJl tail: plan silent auto when no mode was ordered.
 * Caller only applies this when `!hasResolvedMode`.
 */
export function planHarborWillowAutoFallback(
  input: HarborWillowPlanInput,
): HarborWillowPlan {
  if (input.hasResolvedMode) {
    return { mode: 'default', fromAutoFallback: false }
  }
  if (
    !input.circuitBroken &&
    !input.disableAutoMode &&
    input.harborWillow &&
    (!input.isNonInteractiveSession || input.mossAnchor)
  ) {
    return { mode: 'auto', fromAutoFallback: true }
  }
  return { mode: 'default', fromAutoFallback: false }
}
