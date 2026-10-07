/**
 * Official 2.1.207 silent auto fallback densable (tengu_harbor_willow),
 * densable 2.1.289 OR arm for CLAUDE_CODE_BRIDGE_CHILD_AUTO_DEFAULT.
 *
 * When no explicit CLI/settings permission mode resolved:
 *   if !circuitBroken
 *      && disableAutoMode !== 'disable'
 *      && (
 *           (Qbn/harbor_willow && (!nonInteractive || moss_anchor))
 *           || BRIDGE_CHILD_AUTO_DEFAULT
 *         )
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
  /**
   * densable 2.1.289 — `Le(r.CLAUDE_CODE_BRIDGE_CHILD_AUTO_DEFAULT)`.
   * When true, silent auto arms even if harbor_willow is off.
   */
  bridgeChildAutoDefault?: boolean
}

export type HarborWillowPlan = {
  mode: 'auto' | 'default'
  fromAutoFallback: boolean
}

/**
 * Official gJl / 2.1.289 silent-auto tail: plan auto when no mode was ordered.
 * Caller only applies this when `!hasResolvedMode`.
 */
export function planHarborWillowAutoFallback(
  input: HarborWillowPlanInput,
): HarborWillowPlan {
  if (input.hasResolvedMode) {
    return { mode: 'default', fromAutoFallback: false }
  }
  if (input.circuitBroken || input.disableAutoMode) {
    return { mode: 'default', fromAutoFallback: false }
  }
  const harborPath =
    input.harborWillow &&
    (!input.isNonInteractiveSession || input.mossAnchor)
  if (harborPath || input.bridgeChildAutoDefault === true) {
    return { mode: 'auto', fromAutoFallback: true }
  }
  return { mode: 'default', fromAutoFallback: false }
}
