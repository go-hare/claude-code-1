/**
 * densable Dkg / fto / _Ji residual — autocompact rapid-refill thrashing breaker.
 *
 * densable: after compact, if context refills to the limit within 3 turns of the
 * previous compact, 3 times in a row → trip (stop thrashing).
 *
 * Pure half only; full query-loop integration remains denser.
 */

/** densable gEu — consecutive rapid-refill trip count. */
export const AUTO_COMPACT_THRASHING_THRESHOLD = 3

/** densable rapid-refill window: turnCounter < 3 after compacted. */
export const AUTO_COMPACT_RAPID_REFILL_TURN_WINDOW = 3

/** densable bJi — user-facing thrashing message. */
export const AUTO_COMPACT_THRASHING_MESSAGE =
  'Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row. A file being read or a tool output is likely too large for the context window. Try reading in smaller chunks, or use /clear to start fresh.'

export type AutoCompactThrashingTracking = {
  compacted?: boolean
  turnCounter?: number
  consecutiveRapidRefills?: number
}

/**
 * densable Dkg — next consecutiveRapidRefills count.
 * Increments when last compact was recent (compacted && turnCounter < 3);
 * otherwise resets to 0.
 */
export function nextConsecutiveRapidRefills(
  tracking?: AutoCompactThrashingTracking | null,
): number {
  if (tracking?.compacted === true && (tracking.turnCounter ?? 0) < AUTO_COMPACT_RAPID_REFILL_TURN_WINDOW) {
    return (tracking.consecutiveRapidRefills ?? 0) + 1
  }
  return 0
}

/**
 * densable fto — decide trip vs proceed from rapid-refill counter.
 */
export function evaluateAutoCompactThrashing(
  tracking?: AutoCompactThrashingTracking | null,
  threshold: number = AUTO_COMPACT_THRASHING_THRESHOLD,
): {
  action: 'trip' | 'proceed'
  consecutiveRapidRefills: number
} {
  const consecutiveRapidRefills = nextConsecutiveRapidRefills(tracking)
  return {
    action: consecutiveRapidRefills >= threshold ? 'trip' : 'proceed',
    consecutiveRapidRefills,
  }
}

/**
 * densable _Ji — reset tracking after a successful compact, carrying thrash count.
 */
export function trackingAfterSuccessfulCompact(input: {
  turnId: string
  consecutiveRapidRefills?: number
}): {
  compacted: true
  turnId: string
  turnCounter: 0
  consecutiveFailures: 0
  consecutiveRapidRefills: number
} {
  return {
    compacted: true,
    turnId: input.turnId,
    turnCounter: 0,
    consecutiveFailures: 0,
    consecutiveRapidRefills: input.consecutiveRapidRefills ?? 0,
  }
}
