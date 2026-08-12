/**
 * densable CXr / wXr / kEo — process-local bridge session metadata.
 *
 * densable also appends a `bridge-session` transcript entry (Bkn/EGt in
 * sessionStorage). Local mirrors both:
 * - CXr: save bridge id + seq + optional grouping after connect / on cleanup
 * - wXr: read for init reattach when REATTACH env is absent
 * - kEo: clear on full teardown / user disable (paired with clearBridgeSession)
 *
 * Transcript Bkn/EGt (2.1.224 #30) lives in sessionStorage — process meta alone
 * is not enough for --resume across processes.
 */

import { getSessionId } from '../bootstrap/state.js'
import { logForDebugging } from '../utils/debug.js'

export type PersistedBridgeSession = {
  id: string
  seq: number
  groupingId?: string
  declaredDialogKinds?: string[]
}

/** densable Hd().currentSessionBridge* for the live REPL session only. */
let current: {
  sessionId: string
  bridgeSessionId: string
  seq: number
  groupingId?: string
  declaredDialogKinds?: string[]
} | null = null

/**
 * densable CXr(e,t,r,n,o,i) — remember bridge session for the active CLI session.
 * Only mutates live meta when `sessionId` matches getSessionId() (or is omitted).
 */
export function saveBridgeSessionMeta(
  bridgeSessionId: string,
  lastSequenceNum: number,
  opts?: {
    sessionId?: string
    groupingId?: string
    declaredDialogKinds?: string[]
  },
): void {
  const sessionId = opts?.sessionId ?? getSessionId()
  if (!sessionId || !bridgeSessionId) return
  const liveId = getSessionId()
  if (sessionId === liveId) {
    current = {
      sessionId,
      bridgeSessionId,
      seq: lastSequenceNum,
      groupingId: opts?.groupingId,
      declaredDialogKinds: opts?.declaredDialogKinds?.length
        ? [...opts.declaredDialogKinds]
        : undefined,
    }
    logForDebugging(
      `[bridge:meta] CXr session=${sessionId} bridge=${bridgeSessionId} seq=${lastSequenceNum}${opts?.groupingId ? ` grouping=${opts.groupingId}` : ''}`,
    )
  }
}

/** densable wXr — persisted bridge for re-init / reattach without REATTACH env. */
export function getPersistedBridgeSession():
  | PersistedBridgeSession
  | undefined {
  if (!current?.bridgeSessionId) return undefined
  // densable: only if still the active session
  if (current.sessionId !== getSessionId()) return undefined
  return {
    id: current.bridgeSessionId,
    seq: current.seq ?? 0,
    groupingId: current.groupingId,
    declaredDialogKinds: current.declaredDialogKinds,
  }
}

/** densable kEo — clear live bridge meta (full teardown / disable). */
export function clearBridgeSessionMeta(): void {
  current = null
  logForDebugging('[bridge:meta] kEo cleared')
}

/** Test helper. */
export function resetBridgeSessionMetaForTests(): void {
  current = null
}
