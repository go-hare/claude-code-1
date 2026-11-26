import { InkHostSlot } from './instances.js'

// Terminal focus state signal — non-React access to DECSET 1004 focus events.
// 'unknown' is the default for terminals that don't support focus reporting;
// consumers treat 'unknown' identically to 'focused' (no throttling).
// Subscribers are notified synchronously when focus changes, used by
// TerminalFocusProvider to avoid polling.
export type TerminalFocusState = 'focused' | 'blurred' | 'unknown'

type TerminalFocusHostState = {
  focusState: TerminalFocusState
  /** densable `bp.terminalFocusGainedAt` / `Jhf()` — wall clock of last FOCUS_IN. */
  focusGainedAt: number
  resolvers: Set<() => void>
  subscribers: Set<() => void>
}

const terminalFocusHostSlot = new InkHostSlot<TerminalFocusHostState>(() => ({
  focusState: 'unknown',
  focusGainedAt: Number.NEGATIVE_INFINITY,
  resolvers: new Set(),
  subscribers: new Set(),
}))

export function setTerminalFocused(v: boolean): void {
  const state = terminalFocusHostSlot.of()
  // densable OKa: stamp only on focus-gained, keep last stamp on blur.
  if (v) state.focusGainedAt = Date.now()
  state.focusState = v ? 'focused' : 'blurred'
  // Notify useSyncExternalStore subscribers
  for (const cb of state.subscribers) {
    cb()
  }
  if (!v) {
    for (const resolve of state.resolvers) {
      resolve()
    }
    state.resolvers.clear()
  }
}

/** densable `Jhf` — Date.now() of last FOCUS_IN, or −∞ before any focus. */
export function getTerminalFocusGainedAt(): number {
  return terminalFocusHostSlot.peek()?.focusGainedAt ?? Number.NEGATIVE_INFINITY
}

export function getTerminalFocused(): boolean {
  return (terminalFocusHostSlot.peek()?.focusState ?? 'unknown') !== 'blurred'
}

export function getTerminalFocusState(): TerminalFocusState {
  return terminalFocusHostSlot.peek()?.focusState ?? 'unknown'
}

// For useSyncExternalStore
export function subscribeTerminalFocus(cb: () => void): () => void {
  const state = terminalFocusHostSlot.of()
  state.subscribers.add(cb)
  return () => {
    state.subscribers.delete(cb)
  }
}

export function resetTerminalFocusState(): void {
  const state = terminalFocusHostSlot.peek()
  if (!state) return
  state.focusState = 'unknown'
  state.focusGainedAt = Number.NEGATIVE_INFINITY
  for (const cb of state.subscribers) {
    cb()
  }
}
