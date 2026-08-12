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
