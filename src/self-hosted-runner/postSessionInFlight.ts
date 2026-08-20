/**
 * densable 2.1.236 #17 — Bxy / Uxy / etu host-scoped post-session inFlight gate.
 * Thin module so rootRunner can read etu without importing sessionHooks
 * (sessionHooks imports rootRunner for redactLogText/withTimeoutMs).
 * No LazyHost — module singleton + getters only.
 */

/** densable `Bxy` */
export class PostSessionHookInFlight {
  inFlight = 0
  increment(): void {
    this.inFlight++
  }
  decrement(): void {
    this.inFlight--
  }
}

/** densable `oB0` / `Uxy` — single host gate for this runner process */
const postSessionHookInFlight = new PostSessionHookInFlight()

/**
 * densable `Uxy` / test accessor — host gate instance.
 * SEA: getPostSessionHookInFlight(): PostSessionHookInFlight
 */
export function getPostSessionHookInFlight(): PostSessionHookInFlight {
  return postSessionHookInFlight
}

/** densable `etu` — outstanding post-session hooks (shutdown wait / forced log) */
export function getPostSessionHookInFlightCount(): number {
  return postSessionHookInFlight.inFlight
}

/** test-only reset */
export function resetPostSessionHookInFlightForTests(): void {
  postSessionHookInFlight.inFlight = 0
}
