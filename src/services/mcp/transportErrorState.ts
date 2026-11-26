/**
 * Official 2.1.x MCP transportErrorState helpers (mid-call transport drop).
 * Pure — call sites own the Set/state object.
 */

import { HostSlot, getBootstrapSessionHost } from '../../utils/sessionRoot.js'
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
 * densable `$cy` hasPendingElicitation — host-scoped count of MCP URL
 * elicitations currently awaiting user/hook resolution. Auto-background
 * must not fire while > 0 (call site defers another full timeout window).
 */
const hostPendingMcpElicitationsSlot = new HostSlot<{ count: number }>(() => ({
  count: 0,
}))

function getPendingMcpElicitationsState(): { count: number } {
  return hostPendingMcpElicitationsSlot.of(getBootstrapSessionHost())
}

export function beginMcpElicitation(): void {
  getPendingMcpElicitationsState().count += 1
}

export function endMcpElicitation(): void {
  const state = getPendingMcpElicitationsState()
  state.count = Math.max(0, state.count - 1)
}

/** densable hasPendingElicitation callback body */
export function hasPendingMcpElicitation(): boolean {
  const state = hostPendingMcpElicitationsSlot.peek(getBootstrapSessionHost())
  return (state?.count ?? 0) > 0
}

/** Test-only */
export function _resetPendingMcpElicitationsForTests(): void {
  const state = hostPendingMcpElicitationsSlot.peek(getBootstrapSessionHost())
  if (state) {
    state.count = 0
  }
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
