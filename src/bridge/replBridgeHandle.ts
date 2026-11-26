import { updateSessionBridgeId } from '../utils/concurrentSessions.js'
import { getBootstrapSessionHost, HostSlot } from '../utils/sessionHost.js'
import type { ReplBridgeHandle } from './replBridge.js'
import { toCompatSessionId } from './sessionIdCompat.js'

/**
 * Host-scoped pointer to the active REPL bridge handle, so callers outside
 * useReplBridge's React tree (tools, slash commands) can invoke handle methods
 * like subscribePR.
 *
 * Set from useReplBridge.tsx when init completes; cleared on teardown.
 *
 * Also stores `leftArrowStashedHandle` for densable left-arrow handoff:
 * REPL unmount clears the active pointer via useReplBridge cleanup
 * (`setReplBridgeHandle(null)` + host_exit teardown) *before* main runs
 * `openAgentsViaLeftArrow`. Stash the live handle object so openAgents can
 * still flush + `teardown({skipArchive:true})` and build
 * `CLAUDE_BRIDGE_REATTACH_*` even when the active pointer is already null.
 */
type ReplBridgeHandleHostState = {
  handle: ReplBridgeHandle | null
  leftArrowStashedHandle: ReplBridgeHandle | null
}

const replBridgeHandleHostSlot = new HostSlot<ReplBridgeHandleHostState>(
  () => ({
    handle: null,
    leftArrowStashedHandle: null,
  }),
)

function getReplBridgeHandleHostState(): ReplBridgeHandleHostState {
  return replBridgeHandleHostSlot.of(getBootstrapSessionHost())
}

export function setReplBridgeHandle(h: ReplBridgeHandle | null): void {
  getReplBridgeHandleHostState().handle = h
  // Publish (or clear) our bridge session ID in the session record so other
  // local peers can dedup us out of their bridge list — local is preferred.
  void updateSessionBridgeId(getSelfBridgeCompatId() ?? null).catch(() => {})
}

export function getReplBridgeHandle(): ReplBridgeHandle | null {
  return getReplBridgeHandleHostState().handle
}

/** Stash active handle before left-arrow unmount (take-once by openAgents). */
export function stashLeftArrowBridgeHandle(
  h: ReplBridgeHandle | null | undefined,
): void {
  getReplBridgeHandleHostState().leftArrowStashedHandle = h ?? null
}

/** Take-and-clear left-arrow stashed handle. */
export function takeLeftArrowBridgeHandle(): ReplBridgeHandle | null {
  const hostState = getReplBridgeHandleHostState()
  const h = hostState.leftArrowStashedHandle
  hostState.leftArrowStashedHandle = null
  return h
}

/** Test helper. */
export function resetLeftArrowBridgeHandleForTests(): void {
  getReplBridgeHandleHostState().leftArrowStashedHandle = null
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
