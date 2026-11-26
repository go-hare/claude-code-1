/**
 * Proactive mode — tick-driven autonomous agent.
 *
 * State machine: inactive → active (→ paused → active) → inactive
 *
 * When active, the REPL periodically injects <tick> prompts so the model
 * keeps working even when the user is idle.  SleepTool lets the model
 * control its own wake-up cadence.
 */

import { getBootstrapSession, RootSessionSlot } from '../utils/sessionHost.js'

// ---------------------------------------------------------------------------
// State (per root session)
// ---------------------------------------------------------------------------

type ProactiveSessionState = {
  active: boolean
  paused: boolean
  contextBlocked: boolean
  nextTickAt: number | null
  activationSource: string | undefined
  listeners: Set<() => void>
}

const proactiveStateSlot = new RootSessionSlot<ProactiveSessionState>(() => ({
  active: false,
  paused: false,
  contextBlocked: false,
  nextTickAt: null,
  activationSource: undefined,
  listeners: new Set(),
}))

function getProactiveState(): ProactiveSessionState {
  return proactiveStateSlot.of(getBootstrapSession())
}

function notify(state: ProactiveSessionState): void {
  for (const cb of state.listeners) {
    try {
      cb()
    } catch {
      // subscriber errors must not break the notifier
    }
  }
}

// ---------------------------------------------------------------------------
// Public API — consumed by REPL.tsx, PromptInputFooterLeftSide, prompts.ts
// ---------------------------------------------------------------------------

export function isProactiveActive(): boolean {
  return getProactiveState().active
}

export function activateProactive(source?: string): void {
  const state = getProactiveState()
  if (state.active) return
  state.active = true
  state.paused = false
  state.contextBlocked = false
  state.activationSource = source
  notify(state)
}

export function deactivateProactive(): void {
  const state = getProactiveState()
  if (!state.active) return
  state.active = false
  state.paused = false
  state.contextBlocked = false
  state.nextTickAt = null
  state.activationSource = undefined
  notify(state)
}

export function isProactivePaused(): boolean {
  return getProactiveState().paused
}

export function pauseProactive(): void {
  const state = getProactiveState()
  if (!state.active || state.paused) return
  state.paused = true
  state.nextTickAt = null
  notify(state)
}

export function resumeProactive(): void {
  const state = getProactiveState()
  if (!state.active || !state.paused) return
  state.paused = false
  notify(state)
}

/**
 * Block / unblock tick generation.
 *
 * Set to `true` on API errors to prevent tick → error → tick runaway loops.
 * Cleared on successful response or after compaction.
 */
export function setContextBlocked(blocked: boolean): void {
  const state = getProactiveState()
  if (state.contextBlocked === blocked) return
  state.contextBlocked = blocked
  if (blocked) {
    state.nextTickAt = null
  }
  notify(state)
}

export function isContextBlocked(): boolean {
  return getProactiveState().contextBlocked
}

/**
 * Schedule the next tick timestamp (epoch ms).
 * Called by useProactive after submitting a tick.
 */
export function setNextTickAt(ts: number | null): void {
  const state = getProactiveState()
  state.nextTickAt = ts
  notify(state)
}

/**
 * Returns the epoch-ms timestamp of the next scheduled tick, or null.
 * Used by PromptInputFooterLeftSide to render a countdown.
 */
export function getNextTickAt(): number | null {
  const state = getProactiveState()
  if (!state.active || state.paused || state.contextBlocked) return null
  return state.nextTickAt
}

export function getActivationSource(): string | undefined {
  return getProactiveState().activationSource
}

/**
 * Subscribe to any proactive state change.
 * Returns an unsubscribe function.
 */
export function subscribeToProactiveChanges(cb: () => void): () => void {
  const { listeners } = getProactiveState()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/**
 * Whether ticks should fire right now.
 * Convenience predicate combining all blocking conditions.
 */
export function shouldTick(): boolean {
  const state = getProactiveState()
  return state.active && !state.paused && !state.contextBlocked
}
