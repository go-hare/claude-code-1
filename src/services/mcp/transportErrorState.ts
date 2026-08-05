/**
 * Official 2.1.x MCP transportErrorState helpers (mid-call transport drop).
 * Pure — call sites own the Set/state object.
 */

import type { McpCallWatchdog, McpTransportErrorState } from './types.js'

/** Official: after transport error, response presumed lost after this long. */
export const MCP_TRANSPORT_DROP_ABORT_MS = 90_000

export function createMcpTransportErrorState(): McpTransportErrorState {
  return {
    consecutiveErrors: 0,
    activeCallWatchdogs: new Set(),
    pendingElicitations: 0,
    lastElicitationClosedAt: 0,
  }
}

/**
 * densable `$cy` hasPendingElicitation — process-wide count of MCP URL
 * elicitations currently awaiting user/hook resolution. Auto-background
 * must not fire while > 0 (call site defers another full timeout window).
 */
let processPendingMcpElicitations = 0

export function beginMcpElicitation(): void {
  processPendingMcpElicitations += 1
}

export function endMcpElicitation(): void {
  processPendingMcpElicitations = Math.max(0, processPendingMcpElicitations - 1)
}

/** densable hasPendingElicitation callback body */
export function hasPendingMcpElicitation(): boolean {
  return processPendingMcpElicitations > 0
}

/** Test-only */
export function _resetPendingMcpElicitationsForTests(): void {
  processPendingMcpElicitations = 0
}

/** Official M(): arm every unarmed in-flight call watchdog. */
export function armAllCallWatchdogs(state: McpTransportErrorState): void {
  const now = Date.now()
  for (const w of state.activeCallWatchdogs) {
    if (w.armedAt === 0) w.armedAt = now
  }
}

/** Progress / response received — clear arm so the 90s timer restarts only on next error. */
export function clearCallWatchdogArm(watchdog: McpCallWatchdog): void {
  watchdog.armedAt = 0
}

/**
 * Whether this in-flight call should abort as transport-lost.
 * Official: armedAt > 0 && Date.now() - armedAt > 90000.
 */
export function shouldAbortForTransportDrop(
  watchdog: McpCallWatchdog,
  now: number = Date.now(),
  timeoutMs: number = MCP_TRANSPORT_DROP_ABORT_MS,
): boolean {
  return watchdog.armedAt > 0 && now - watchdog.armedAt > timeoutMs
}
