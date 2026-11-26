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
import {
  getBootstrapSession,
  getBootstrapSessionHost,
  HostSlot,
  runWithSession,
} from './sessionHost.js'

const SESSION_ACTIVITY_INTERVAL_MS = 30_000

export type SessionActivityReason = 'api_call' | 'tool_exec' | 'hook_exec'

type SessionActivityHostState = {
  activityCallback: (() => void) | null
  refcount: number
  /**
   * Official mainLoopRefcount — counts only main-thread activity ($Qn second
   * arg undefined). Nested agent activity increments refcount but not this.
   * Wired to Imn.setMainLoopRefcount via onMainLoopRefcountChanged.
   */
  mainLoopRefcount: number
  activeReasons: Map<SessionActivityReason, number>
  oldestActivityStartedAt: number | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  idleTimer: ReturnType<typeof setTimeout> | null
  cleanupRegistered: boolean
  /** Official FYi / BYi — mainLoopRefcount change listener. */
  onMainLoopRefcountChanged: ((n: number) => void) | null
  /**
   * densable 2.1.236 — fire when mainLoopRefcount transitions to 0 (turn idle).
   * Used by notify_when_idle inbound subscriptions (peer_idle_notice).
   */
  onMainLoopBecameIdle: (() => void) | null
  /** Official GRu / UYi — dropNestedBlockedChain listener (agent cancel). */
  onDropNestedBlockedChain: ((agentId: string) => void) | null
}

const sessionActivityHostSlot = new HostSlot<SessionActivityHostState>(() => ({
  activityCallback: null,
  refcount: 0,
  mainLoopRefcount: 0,
  activeReasons: new Map<SessionActivityReason, number>(),
  oldestActivityStartedAt: null,
  heartbeatTimer: null,
  idleTimer: null,
  cleanupRegistered: false,
  onMainLoopRefcountChanged: null,
  onMainLoopBecameIdle: null,
  onDropNestedBlockedChain: null,
}))

function getSessionActivityHostState(): SessionActivityHostState {
  return sessionActivityHostSlot.of(getBootstrapSessionHost())
}

function startHeartbeatTimer(state: SessionActivityHostState): void {
  clearIdleTimer(state)
  const sessionRef = new WeakRef(getBootstrapSession().root)
  const stateRef = new WeakRef(state)
  const timer = setInterval(() => {
    const session = sessionRef.deref()
    const current = stateRef.deref()
    if (session === undefined || current === undefined) {
      clearInterval(timer)
      if (current !== undefined && current.heartbeatTimer === timer) {
        current.heartbeatTimer = null
      }
      return
    }
    runWithSession(session, () => {
      logForDiagnosticsNoPII('debug', 'session_keepalive_heartbeat', {
        refcount: current.refcount,
      })
      if (isRemoteSendKeepalivesEnvEnabled()) {
        current.activityCallback?.()
      }
    })
  }, SESSION_ACTIVITY_INTERVAL_MS)
  state.heartbeatTimer = timer
}

function startIdleTimer(state: SessionActivityHostState): void {
  clearIdleTimer(state)
  if (state.activityCallback === null) {
    return
  }
  const sessionRef = new WeakRef(getBootstrapSession().root)
  const stateRef = new WeakRef(state)
  const timer = setTimeout(() => {
    const current = stateRef.deref()
    if (current !== undefined && current.idleTimer === timer) {
      current.idleTimer = null
    }
    const session = sessionRef.deref()
    if (session === undefined) {
      return
    }
    runWithSession(session, () => {
      logForDiagnosticsNoPII('info', 'session_idle_30s')
    })
  }, SESSION_ACTIVITY_INTERVAL_MS)
  state.idleTimer = timer
}

function clearIdleTimer(state: SessionActivityHostState): void {
  if (state.idleTimer !== null) {
    clearTimeout(state.idleTimer)
    state.idleTimer = null
  }
}

export function registerSessionActivityCallback(cb: () => void): void {
  const state = getSessionActivityHostState()
  state.activityCallback = cb
  // Restart timer if work is already in progress (e.g. reconnect during streaming)
  if (state.refcount > 0 && state.heartbeatTimer === null) {
    startHeartbeatTimer(state)
  }
}

export function unregisterSessionActivityCallback(): void {
  const state = getSessionActivityHostState()
  state.activityCallback = null
  // Stop timer if the callback is removed
  if (state.heartbeatTimer !== null) {
    clearInterval(state.heartbeatTimer)
    state.heartbeatTimer = null
  }
  clearIdleTimer(state)
}

export function sendSessionActivitySignal(): void {
  const state = getSessionActivityHostState()
  if (isRemoteSendKeepalivesEnvEnabled()) {
    state.activityCallback?.()
  }
}

export function isSessionActivityTrackingActive(): boolean {
  return getSessionActivityHostState().activityCallback !== null
}

/** Official BYi — register mainLoopRefcount listener (Imn.setMainLoopRefcount). */
export function setMainLoopRefcountListener(
  cb: ((n: number) => void) | null,
): void {
  getSessionActivityHostState().onMainLoopRefcountChanged = cb
}

/** densable notify_when_idle — register main-loop idle (refcount → 0) listener. */
export function setMainLoopBecameIdleListener(cb: (() => void) | null): void {
  getSessionActivityHostState().onMainLoopBecameIdle = cb
}

/** Official UYi — register dropNestedBlockedChain listener. */
export function setDropNestedBlockedChainListener(
  cb: ((agentId: string) => void) | null,
): void {
  getSessionActivityHostState().onDropNestedBlockedChain = cb
}

/** Official QRu — notify dropNestedBlockedChain for cancelled agent. */
export function notifyDropNestedBlockedChain(agentId: string): void {
  getSessionActivityHostState().onDropNestedBlockedChain?.(agentId)
}

/** Official ZRu — current mainLoopRefcount. */
export function getMainLoopRefcount(): number {
  return getSessionActivityHostState().mainLoopRefcount
}

/** densable `VKo` — `activeReasons.get(reason)??0 > 0`. */
export function isSessionActivityReasonActive(
  reason: SessionActivityReason,
): boolean {
  return (getSessionActivityHostState().activeReasons.get(reason) ?? 0) > 0
}

/** Test-only — official `n.refcount` (keepalive hold, including hook_exec). */
export function getSessionActivityRefcountForTests(): number {
  return getSessionActivityHostState().refcount
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
  const state = getSessionActivityHostState()
  state.refcount++
  if (agentId === undefined) {
    state.mainLoopRefcount++
    state.onMainLoopRefcountChanged?.(state.mainLoopRefcount)
  }
  state.activeReasons.set(reason, (state.activeReasons.get(reason) ?? 0) + 1)
  if (state.refcount === 1) {
    state.oldestActivityStartedAt = Date.now()
    if (state.activityCallback !== null && state.heartbeatTimer === null) {
      startHeartbeatTimer(state)
    }
  }
  if (!state.cleanupRegistered) {
    state.cleanupRegistered = true
    const sessionRef = new WeakRef(getBootstrapSession().root)
    const stateRef = new WeakRef(state)
    registerCleanup(async () => {
      const current = stateRef.deref()
      const session = sessionRef.deref()
      if (current === undefined || session === undefined) {
        return
      }
      runWithSession(session, () => {
        logForDiagnosticsNoPII('info', 'session_activity_at_shutdown', {
          refcount: current.refcount,
          active: Object.fromEntries(current.activeReasons),
          // Only meaningful while work is in-flight; stale otherwise.
          oldest_activity_ms:
            current.refcount > 0 && current.oldestActivityStartedAt !== null
              ? Date.now() - current.oldestActivityStartedAt
              : null,
        })
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
  const state = getSessionActivityHostState()
  if (state.refcount > 0) {
    state.refcount--
  }
  if (agentId === undefined) {
    if (state.mainLoopRefcount > 0) {
      state.mainLoopRefcount--
      state.onMainLoopRefcountChanged?.(state.mainLoopRefcount)
      if (state.mainLoopRefcount === 0) {
        state.onMainLoopBecameIdle?.()
      }
    } else {
      logForDiagnosticsNoPII('warn', 'session_activity_main_loop_underflow', {
        reason,
      })
    }
  }
  const n = (state.activeReasons.get(reason) ?? 0) - 1
  if (n > 0) state.activeReasons.set(reason, n)
  else state.activeReasons.delete(reason)
  if (state.refcount === 0 && state.heartbeatTimer !== null) {
    clearInterval(state.heartbeatTimer)
    state.heartbeatTimer = null
    startIdleTimer(state)
  }
}

/** Test-only reset. */
export function resetSessionActivityForTests(): void {
  const state = getSessionActivityHostState()
  state.activityCallback = null
  state.refcount = 0
  state.mainLoopRefcount = 0
  state.activeReasons.clear()
  state.oldestActivityStartedAt = null
  if (state.heartbeatTimer !== null) {
    clearInterval(state.heartbeatTimer)
    state.heartbeatTimer = null
  }
  clearIdleTimer(state)
  state.cleanupRegistered = false
  state.onMainLoopRefcountChanged = null
  state.onMainLoopBecameIdle = null
  state.onDropNestedBlockedChain = null
}
