import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'

/**
 * densable `Wa` / `Mr` / `qse` — host-committed shutdown latch.
 * `Ft` ORs this with mid-turn fold suspend.
 */
const shutdownCommittedHostSlot = new HostSlot<{ committed: boolean }>(() => ({
  committed: false,
}))

/** densable `qse`. */
export function markShutdownCommitted(): void {
  shutdownCommittedHostSlot.of(getBootstrapSessionHost()).committed = true
}

/** densable `Mr`. */
export function isShutdownCommitted(): boolean {
  return shutdownCommittedHostSlot.of(getBootstrapSessionHost()).committed
}

export function resetShutdownCommittedForTests(): void {
  shutdownCommittedHostSlot.of(getBootstrapSessionHost()).committed = false
}
