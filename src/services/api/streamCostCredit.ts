/**
 * densable 2.1.214 #38 — stream cost credit state machine (gr).
 *
 * Multi-frame message_delta carries cumulative usage. densable only calls
 * Zce/addToTotalSessionCost once:
 *
 *   message_delta:
 *     if (stop_reason !== null && gr !== "credited") { gr = "credited"; credit }
 *     else if (gr === "none") gr = "pending"
 *   message_stop:
 *     if (gr === "pending") { gr = "credited"; credit }
 */

export type StreamCostCreditState = 'none' | 'pending' | 'credited'

export type StreamCostCreditTransition = {
  next: StreamCostCreditState
  /** densable: tr += Zce(...) — only true on the single credit edge */
  shouldCredit: boolean
}

/**
 * densable message_delta cost gate.
 * @param stopReason part.delta.stop_reason (null while still streaming)
 */
export function onMessageDeltaCostCredit(
  state: StreamCostCreditState,
  stopReason: string | null | undefined,
): StreamCostCreditTransition {
  if (stopReason != null && state !== 'credited') {
    return { next: 'credited', shouldCredit: true }
  }
  if (state === 'none') {
    return { next: 'pending', shouldCredit: false }
  }
  return { next: state, shouldCredit: false }
}

/** densable message_stop cost gate when stop_reason never arrived on deltas. */
export function onMessageStopCostCredit(
  state: StreamCostCreditState,
): StreamCostCreditTransition {
  if (state === 'pending') {
    return { next: 'credited', shouldCredit: true }
  }
  return { next: state, shouldCredit: false }
}
