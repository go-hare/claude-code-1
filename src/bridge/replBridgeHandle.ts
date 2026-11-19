import { updateSessionBridgeId } from '../utils/concurrentSessions.js'
import type { ReplBridgeHandle } from './replBridge.js'
import { toCompatSessionId } from './sessionIdCompat.js'

/**
 * Global pointer to the active REPL bridge handle, so callers outside
 * useReplBridge's React tree (tools, slash commands) can invoke handle methods
 * like subscribePR. Same one-bridge-per-process justification as bridgeDebug.ts
 * — the handle's closure captures the sessionId and getAccessToken that created
 * the session, and re-deriving those independently (BriefTool/upload.ts pattern)
 * risks staging/prod token divergence.
 *
 * Set from useReplBridge.tsx when init completes; cleared on teardown.
 */

let handle: ReplBridgeHandle | null = null

/**
 * densable left-arrow handoff: REPL unmount clears the global pointer via
 * useReplBridge cleanup (`setReplBridgeHandle(null)` + host_exit teardown)
 * *before* main runs `openAgentsViaLeftArrow`. Stash the live handle object
 * so openAgents can still flush + `teardown({skipArchive:true})` and build
 * `CLAUDE_BRIDGE_REATTACH_*` even when the global is already null.
 */
let leftArrowStashedHandle: ReplBridgeHandle | null = null

export function setReplBridgeHandle(h: ReplBridgeHandle | null): void {
  handle = h
  // Publish (or clear) our bridge session ID in the session record so other
  // local peers can dedup us out of their bridge list — local is preferred.
  void updateSessionBridgeId(getSelfBridgeCompatId() ?? null).catch(() => {})
}

export function getReplBridgeHandle(): ReplBridgeHandle | null {
  return handle
}

/** Stash active handle before left-arrow unmount (take-once by openAgents). */
export function stashLeftArrowBridgeHandle(
  h: ReplBridgeHandle | null | undefined,
): void {
  leftArrowStashedHandle = h ?? null
}

/** Take-and-clear left-arrow stashed handle. */
export function takeLeftArrowBridgeHandle(): ReplBridgeHandle | null {
  const h = leftArrowStashedHandle
  leftArrowStashedHandle = null
  return h
}

/** Test helper. */
export function resetLeftArrowBridgeHandleForTests(): void {
  leftArrowStashedHandle = null
}

/**
 * Our own bridge session ID in the session_* compat format the API returns
 * in /v1/sessions responses — or undefined if bridge isn't connected.
 */
export function getSelfBridgeCompatId(): string | undefined {
  const h = getReplBridgeHandle()
  return h ? toCompatSessionId(h.bridgeSessionId) : undefined
}

export type BridgeRateLimitStatusSnapshot = {
  status?: string
  resetsAt?: number | null
  rateLimitType?: string | null
  isUsingOverage?: boolean
}

/**
 * #1767 / official `Jsr()` + `uo(e)` — mirror rate limit state to the active
 * Remote Control bridge handle. When a usage limit has been lifted (status is
 * `'allowed'` or `null`/expired), sends `reportMetadata({ rate_limit_info: null })`
 * so other devices clear "Limit reached".
 */
export function syncBridgeRateLimitInfo(
  snapshot: BridgeRateLimitStatusSnapshot | null | undefined,
  bridgeHandle: ReplBridgeHandle | null = getReplBridgeHandle(),
  nowMs: number = Date.now(),
): boolean {
  if (!bridgeHandle) return false
  const isLifted =
    !snapshot ||
    snapshot.status === 'allowed' ||
    (typeof snapshot.resetsAt === 'number' &&
      snapshot.resetsAt > 0 &&
      snapshot.resetsAt * 1000 <= nowMs)
  if (isLifted) {
    if (bridgeHandle.clearRateLimitInfo) {
      bridgeHandle.clearRateLimitInfo()
    } else if (bridgeHandle.reportMetadata) {
      bridgeHandle.reportMetadata({ rate_limit_info: null })
    } else {
      return false
    }
    return true
  }
  const normalized = {
    status: snapshot.status,
    resetsAt: snapshot.resetsAt ?? null,
    rateLimitType: snapshot.rateLimitType ?? null,
    isUsingOverage: snapshot.isUsingOverage ?? false,
  }
  if (bridgeHandle.reportRateLimitInfo) {
    bridgeHandle.reportRateLimitInfo(normalized)
  } else if (bridgeHandle.reportMetadata) {
    bridgeHandle.reportMetadata({ rate_limit_info: normalized })
  } else {
    return false
  }
  return true
}
