/**
 * Session activity tracking with refcount-based heartbeat timer.
 *
 * The transport registers its keep-alive sender via registerSessionActivityCallback().
 * Callers (API streaming, tool execution) bracket their work with
 * startSessionActivity() / stopSessionActivity(). When the refcount is >0 a
 * periodic timer fires the registered callback every 30 seconds to keep the
 * container alive.
 *
 * Sending keep-alives is gated behind CLAUDE_CODE_REMOTE_SEND_KEEPALIVES.
 * Diagnostic logging always fires to help diagnose idle gaps.
 */

import { registerCleanup } from './cleanupRegistry.js'
import { logForDiagnosticsNoPII } from './diagLogs.js'
import { isRemoteSendKeepalivesEnvEnabled } from './residualFinalEnvGates.js'

const SESSION_ACTIVITY_INTERVAL_MS = 30_000

export type SessionActivityReason = 'api_call' | 'tool_exec'

let activityCallback: (() => void) | null = null
let refcount = 0
/**
 * Official mainLoopRefcount — counts only main-thread activity ($Qn second
 * arg undefined). Nested agent activity increments refcount but not this.
 * Wired to Imn.setMainLoopRefcount via onMainLoopRefcountChanged.
 */
let mainLoopRefcount = 0
const activeReasons = new Map<SessionActivityReason, number>()
let oldestActivityStartedAt: number | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let cleanupRegistered = false
/** Official FYi / BYi — mainLoopRefcount change listener. */
let onMainLoopRefcountChanged: ((n: number) => void) | null = null
/**
 * densable 2.1.236 — fire when mainLoopRefcount transitions to 0 (turn idle).
 * Used by notify_when_idle inbound subscriptions (peer_idle_notice).
 */
let onMainLoopBecameIdle: (() => void) | null = null
/** Official GRu / UYi — dropNestedBlockedChain listener (agent cancel). */
let onDropNestedBlockedChain: ((agentId: string) => void) | null = null

function startHeartbeatTimer(): void {
  clearIdleTimer()
  heartbeatTimer = setInterval(() => {
    logForDiagnosticsNoPII('debug', 'session_keepalive_heartbeat', {
      refcount,
    })
    if (isRemoteSendKeepalivesEnvEnabled()) {
      activityCallback?.()
    }
  }, SESSION_ACTIVITY_INTERVAL_MS)
}

function startIdleTimer(): void {
  clearIdleTimer()
  if (activityCallback === null) {
    return
  }
  idleTimer = setTimeout(() => {
    logForDiagnosticsNoPII('info', 'session_idle_30s')
    idleTimer = null
  }, SESSION_ACTIVITY_INTERVAL_MS)
}

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

export function registerSessionActivityCallback(cb: () => void): void {
  activityCallback = cb
  // Restart timer if work is already in progress (e.g. reconnect during streaming)
  if (refcount > 0 && heartbeatTimer === null) {
    startHeartbeatTimer()
  }
}

export function unregisterSessionActivityCallback(): void {
  activityCallback = null
  // Stop timer if the callback is removed
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  clearIdleTimer()
}

export function sendSessionActivitySignal(): void {
  if (isRemoteSendKeepalivesEnvEnabled()) {
    activityCallback?.()
  }
}

export function isSessionActivityTrackingActive(): boolean {
  return activityCallback !== null
}

/** Official BYi — register mainLoopRefcount listener (Imn.setMainLoopRefcount). */
export function setMainLoopRefcountListener(
  cb: ((n: number) => void) | null,
): void {
  onMainLoopRefcountChanged = cb
}

/** densable notify_when_idle — register main-loop idle (refcount → 0) listener. */
export function setMainLoopBecameIdleListener(cb: (() => void) | null): void {
  onMainLoopBecameIdle = cb
}

/** Official UYi — register dropNestedBlockedChain listener. */
export function setDropNestedBlockedChainListener(
  cb: ((agentId: string) => void) | null,
): void {
  onDropNestedBlockedChain = cb
}

/** Official QRu — notify dropNestedBlockedChain for cancelled agent. */
export function notifyDropNestedBlockedChain(agentId: string): void {
  onDropNestedBlockedChain?.(agentId)
}

/** Official ZRu — current mainLoopRefcount. */
export function getMainLoopRefcount(): number {
  return mainLoopRefcount
}

/**
 * Official HOn + call-site fallback for $Qn/$BQn second arg.
 *
 * HOn(agentContext): non-main + isBackgroundAgent → agentId; else undefined.
 * Fallback: toolUseContext/options isBackgroundAgent ? agentId : undefined.
 * Only background agents suppress mainLoopRefcount bumps.
 */
export function resolveSessionActivityAgentId(input: {
  agentContext?: {
    agentType?: string
    agentId?: string
    isBackgroundAgent?: boolean
  } | null
  isBackgroundAgent?: boolean
  agentId?: string
}): string | undefined {
  const ctx = input.agentContext
  if (ctx && ctx.agentType !== 'main' && ctx.isBackgroundAgent) {
    return ctx.agentId
  }
  if (input.isBackgroundAgent) {
    return input.agentId
  }
  return undefined
}

/**
 * Increment the activity refcount. When it transitions from 0→1 and a callback
 * is registered, start a periodic heartbeat timer.
 *
 * Official $Qn(reason, agentId?) — when agentId is undefined, also bump
 * mainLoopRefcount and notify FYi.
 */
export function startSessionActivity(
  reason: SessionActivityReason,
  agentId?: string,
): void {
  refcount++
  if (agentId === undefined) {
    mainLoopRefcount++
    onMainLoopRefcountChanged?.(mainLoopRefcount)
  }
  activeReasons.set(reason, (activeReasons.get(reason) ?? 0) + 1)
  if (refcount === 1) {
    oldestActivityStartedAt = Date.now()
    if (activityCallback !== null && heartbeatTimer === null) {
      startHeartbeatTimer()
    }
  }
  if (!cleanupRegistered) {
    cleanupRegistered = true
    registerCleanup(async () => {
      logForDiagnosticsNoPII('info', 'session_activity_at_shutdown', {
        refcount,
        active: Object.fromEntries(activeReasons),
        // Only meaningful while work is in-flight; stale otherwise.
        oldest_activity_ms:
          refcount > 0 && oldestActivityStartedAt !== null
            ? Date.now() - oldestActivityStartedAt
            : null,
      })
    })
  }
}

/**
 * Decrement the activity refcount. When it reaches 0, stop the heartbeat timer
 * and start an idle timer that logs after 30s of inactivity.
 *
 * Official BQn(reason, agentId?) — when agentId is undefined, also drop
 * mainLoopRefcount and notify FYi.
 */
export function stopSessionActivity(
  reason: SessionActivityReason,
  agentId?: string,
): void {
  if (refcount > 0) {
    refcount--
  }
  if (agentId === undefined) {
    if (mainLoopRefcount > 0) {
      mainLoopRefcount--
      onMainLoopRefcountChanged?.(mainLoopRefcount)
      if (mainLoopRefcount === 0) {
        onMainLoopBecameIdle?.()
      }
    } else {
      logForDiagnosticsNoPII('warn', 'session_activity_main_loop_underflow', {
        reason,
      })
    }
  }
  const n = (activeReasons.get(reason) ?? 0) - 1
  if (n > 0) activeReasons.set(reason, n)
  else activeReasons.delete(reason)
  if (refcount === 0 && heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
    startIdleTimer()
  }
}

/** Test-only reset. */
export function resetSessionActivityForTests(): void {
  activityCallback = null
  refcount = 0
  mainLoopRefcount = 0
  activeReasons.clear()
  oldestActivityStartedAt = null
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  clearIdleTimer()
  cleanupRegistered = false
  onMainLoopRefcountChanged = null
  onMainLoopBecameIdle = null
  onDropNestedBlockedChain = null
}
