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
  /** densable noHistoryBackfill — mint-after-gone / history-backfill suppression. */
  noHistoryBackfill?: boolean
  /**
   * densable currentSessionBridgeOwnerAccountUuid — OAuth account that owned
   * the bridge pointer when it was stamped (q5o / env OWNER_ACCT).
   */
  ownerAccountUuid?: string
  /** densable currentSessionBridgeOwnerOrganizationUuid. */
  ownerOrganizationUuid?: string
}

/** densable Hd().currentSessionBridge* for the live REPL session only. */
let current: {
  sessionId: string
  bridgeSessionId: string
  seq: number
  groupingId?: string
  declaredDialogKinds?: string[]
  noHistoryBackfill?: boolean
  ownerAccountUuid?: string
  ownerOrganizationUuid?: string
} | null = null

/**
 * densable CXr(e,t,r,n,o,i) — remember bridge session for the active CLI session.
 * Only mutates live meta when `sessionId` matches getSessionId() (or is omitted).
 *
 * densable 2.1.228 #5 / C1: same-process wXr reattach (skipArchive → re-init)
 * must keep suppress/owner flags. Partial writers (skipArchive only passes
 * groupingId + seq) MUST NOT wipe noHistoryBackfill / owner* / dialog kinds
 * already stamped for this bridge session. Full-replace only when the bridge
 * id changes; omitted optional fields merge from the previous stamp.
 */
export function saveBridgeSessionMeta(
  bridgeSessionId: string,
  lastSequenceNum: number,
  opts?: {
    sessionId?: string
    groupingId?: string
    declaredDialogKinds?: string[]
    noHistoryBackfill?: boolean
    ownerAccountUuid?: string
    ownerOrganizationUuid?: string
  },
): void {
  const sessionId = opts?.sessionId ?? getSessionId()
  if (!sessionId || !bridgeSessionId) return
  const liveId = getSessionId()
  if (sessionId === liveId) {
    const prev =
      current?.sessionId === sessionId &&
      current.bridgeSessionId === bridgeSessionId
        ? current
        : null
    // Explicit true stamps; explicit false clears; omit merges prev (C1).
    const noHistoryBackfill =
      opts?.noHistoryBackfill === true
        ? true
        : opts?.noHistoryBackfill === false
          ? undefined
          : prev?.noHistoryBackfill
            ? true
            : undefined
    const declaredDialogKinds = opts?.declaredDialogKinds?.length
      ? [...opts.declaredDialogKinds]
      : prev?.declaredDialogKinds?.length
        ? [...prev.declaredDialogKinds]
        : undefined
    const ownerAccountUuid =
      opts && 'ownerAccountUuid' in opts
        ? opts.ownerAccountUuid || undefined
        : prev?.ownerAccountUuid
    const ownerOrganizationUuid =
      opts && 'ownerOrganizationUuid' in opts
        ? opts.ownerOrganizationUuid || undefined
        : prev?.ownerOrganizationUuid
    current = {
      sessionId,
      bridgeSessionId,
      seq: lastSequenceNum,
      groupingId: opts?.groupingId ?? prev?.groupingId,
      declaredDialogKinds,
      noHistoryBackfill,
      ownerAccountUuid,
      ownerOrganizationUuid,
    }
    logForDebugging(
      `[bridge:meta] CXr session=${sessionId} bridge=${bridgeSessionId} seq=${lastSequenceNum}${current.groupingId ? ` grouping=${current.groupingId}` : ''}${noHistoryBackfill ? ' noHistoryBackfill' : ''}${ownerAccountUuid ? ' owner' : ''}`,
    )
  }
}

/** densable wXr / sEe — persisted bridge for re-init / reattach without REATTACH env. */
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
    noHistoryBackfill: current.noHistoryBackfill,
    ownerAccountUuid: current.ownerAccountUuid,
    ownerOrganizationUuid: current.ownerOrganizationUuid,
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
