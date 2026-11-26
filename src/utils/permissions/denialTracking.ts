/**
 * Denial tracking infrastructure for permission classifiers.
 * Tracks consecutive denials and total denials to determine
 * when to fall back to prompting.
 */

export type DenialTrackingState = {
  consecutiveDenials: number
  totalDenials: number
  /**
   * Official 2.1.331 `A8n`/`Qls`/`HVo`: query `chainId`s in which a person
   * declined a permission prompt earlier in the same turn. Subsequent non-read-only
   * tool calls in the same chain are escalated to require human approval.
   */
  personDeclinedInChains?: string[]
}

export const DENIAL_LIMITS = {
  maxConsecutive: 3,
  maxTotal: 20,
} as const

export function createDenialTrackingState(): DenialTrackingState {
  return {
    consecutiveDenials: 0,
    totalDenials: 0,
  }
}

export function recordDenial(state: DenialTrackingState): DenialTrackingState {
  return {
    ...state,
    consecutiveDenials: state.consecutiveDenials + 1,
    totalDenials: state.totalDenials + 1,
  }
}

/**
 * Official 2.1.331 `A8n`: record that a person declined an action in `chainId`.
 * Idempotent — returns the same object reference when `chainId` is already recorded.
 */
export function recordPersonDeclinedInChain(
  state: DenialTrackingState,
  chainId: string,
): DenialTrackingState {
  if (state.personDeclinedInChains?.includes(chainId) === true) {
    return state
  }
  return {
    ...state,
    personDeclinedInChains: [...(state.personDeclinedInChains ?? []), chainId],
  }
}

/**
 * Official 2.1.331 `HVo` predicate on state: true when `chainId` already saw
 * an explicit person refusal earlier in this turn.
 */
export function hasPersonDeclinedInChain(
  state: DenialTrackingState | undefined,
  chainId: string | undefined,
): boolean {
  return (
    chainId !== undefined &&
    state?.personDeclinedInChains?.includes(chainId) === true
  )
}

export function recordSuccess(state: DenialTrackingState): DenialTrackingState {
  if (state.consecutiveDenials === 0) return state // No change needed
  return {
    ...state,
    consecutiveDenials: 0,
  }
}

export function shouldFallbackToPrompting(state: DenialTrackingState): boolean {
  return (
    state.consecutiveDenials >= DENIAL_LIMITS.maxConsecutive ||
    state.totalDenials >= DENIAL_LIMITS.maxTotal
  )
}
