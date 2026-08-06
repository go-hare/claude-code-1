/**
 * densable 2.1.214 #39 — advisor thinking must not surface false
 * "check your network" stalled UI.
 *
 * densable constants (query path):
 *   Avs = 20000   // stall poll interval
 *   gSy = 90000   // advisor grace cap
 *   dt  = Math.min(JUi(provider), streamWatchdog ? Ke : Infinity)
 *   Gt  = Math.min(gSy, dt - Avs)
 *
 * densable schedule (ss):
 *   every Avs:
 *     if lastAt advanced → reschedule
 *     if Vr && (now - lastAt) < Gt → reschedule (suppress UI)
 *     else onRetryStatus({ kind:"stalled", deadline: Date.now()+max(0,dt-Ss) })
 *   Vr = true on server_tool_use name==="advisor"
 *   Vr = false on advisor_tool_result
 *
 * Byte idle clock lives on Response._chunkTimes.lastAt (s8h pull stamps).
 */

/** densable Avs — poll interval for stalled UI. */
export const ADVISOR_STALL_POLL_MS = 20_000

/** densable gSy — max advisor grace while waiting for body bytes. */
export const ADVISOR_STALL_GRACE_CAP_MS = 90_000

export type ChunkTimes = {
  lastAt: number
}

export type RetryStatusStalled = {
  kind: 'stalled'
  deadline: number
}

export type RetryStatus =
  | RetryStatusStalled
  | {
      kind: 'error'
      deadline: number
      attempt: number
      maxRetries: number
      error: unknown
    }

/**
 * densable:
 *   dt = Math.min(JUi(vn()), Te ? Ke : Infinity)
 *   Gt = Math.min(gSy, dt - Avs)
 */
export function resolveAdvisorStallGraceMs(input: {
  byteIdleTimeoutMs: number
  streamWatchdogEnabled: boolean
  streamIdleTimeoutMs: number
  pollMs?: number
  graceCapMs?: number
}): { dt: number; graceMs: number } {
  const pollMs = input.pollMs ?? ADVISOR_STALL_POLL_MS
  const graceCapMs = input.graceCapMs ?? ADVISOR_STALL_GRACE_CAP_MS
  const dt = Math.min(
    input.byteIdleTimeoutMs,
    input.streamWatchdogEnabled
      ? input.streamIdleTimeoutMs
      : Number.POSITIVE_INFINITY,
  )
  const graceMs = Math.min(graceCapMs, dt - pollMs)
  return { dt, graceMs }
}

export type StallPollDecision =
  | { action: 'reschedule' }
  | { action: 'stalled'; status: RetryStatusStalled }

/**
 * densable ss() timer body (without the Avs/2 late-fire guard — caller
 * may still apply that when wiring setTimeout).
 *
 * @param lastAtAtSchedule Rn.lastAt snapshot when the timer was armed
 * @param lastAtNow current Rn.lastAt
 * @param streamStartedAt performance.now() when stream loop started (la)
 * @param now performance.now()
 * @param wallNow Date.now() for deadline wall clock
 */
export function decideAdvisorNetworkStallPoll(input: {
  lastAtAtSchedule: number
  lastAtNow: number
  streamStartedAt: number
  now: number
  wallNow: number
  isAdvisorInProgress: boolean
  graceMs: number
  dt: number
}): StallPollDecision {
  // Bytes advanced since arm → still healthy; reschedule.
  if (input.lastAtNow > input.lastAtAtSchedule) {
    return { action: 'reschedule' }
  }
  const idleMs =
    input.lastAtNow === 0
      ? input.now - input.streamStartedAt
      : input.now - input.lastAtNow
  // densable: if (Vr && hl < Gt) { ss(); return }
  if (input.isAdvisorInProgress && idleMs < input.graceMs) {
    return { action: 'reschedule' }
  }
  // densable: Ss = lastAt===0 ? now-la : hl
  const Ss =
    input.lastAtNow === 0
      ? input.now - input.streamStartedAt
      : input.now - input.lastAtNow
  return {
    action: 'stalled',
    status: {
      kind: 'stalled',
      deadline: input.wallNow + Math.max(0, input.dt - Ss),
    },
  }
}

/**
 * densable Msn countdown formatting input:
 *   Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) * 1000
 */
export function remainingRetryMs(deadline: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000)) * 1000
}
