/**
 * densable `Wa` / `Mr` / `qse` — process-committed latch.
 * `Ft` ORs this with mid-turn fold suspend.
 */
let committed = false

/** densable `qse`. */
export function markShutdownCommitted(): void {
  committed = true
}

/** densable `Mr`. */
export function isShutdownCommitted(): boolean {
  return committed
}

export function resetShutdownCommittedForTests(): void {
  committed = false
}
