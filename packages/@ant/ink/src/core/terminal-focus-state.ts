// Terminal focus state signal — non-React access to DECSET 1004 focus events.
// 'unknown' is the default for terminals that don't support focus reporting;
// consumers treat 'unknown' identically to 'focused' (no throttling).
// Subscribers are notified synchronously when focus changes, used by
// TerminalFocusProvider to avoid polling.
export type TerminalFocusState = 'focused' | 'blurred' | 'unknown'

let focusState: TerminalFocusState = 'unknown'
/** densable `bp.terminalFocusGainedAt` / `Jhf()` — wall clock of last FOCUS_IN. */
let focusGainedAt = Number.NEGATIVE_INFINITY
const resolvers: Set<() => void> = new Set()
const subscribers: Set<() => void> = new Set()

export function setTerminalFocused(v: boolean): void {
  // densable OKa: stamp only on focus-gained, keep last stamp on blur.
  if (v) focusGainedAt = Date.now()
  focusState = v ? 'focused' : 'blurred'
  // Notify useSyncExternalStore subscribers
  for (const cb of subscribers) {
    cb()
  }
  if (!v) {
    for (const resolve of resolvers) {
      resolve()
    }
    resolvers.clear()
  }
}

/** densable `Jhf` — Date.now() of last FOCUS_IN, or −∞ before any focus. */
export function getTerminalFocusGainedAt(): number {
  return focusGainedAt
}

export function getTerminalFocused(): boolean {
  return focusState !== 'blurred'
}

export function getTerminalFocusState(): TerminalFocusState {
  return focusState
}

// For useSyncExternalStore
export function subscribeTerminalFocus(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

export function resetTerminalFocusState(): void {
  focusState = 'unknown'
  focusGainedAt = Number.NEGATIVE_INFINITY
  for (const cb of subscribers) {
    cb()
  }
}
