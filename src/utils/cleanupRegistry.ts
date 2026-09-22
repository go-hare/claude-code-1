/**
 * Official `fe` / `W` / `Et` / `mEe` / `DYe` / `Vk` / `svt` / `tde` @178613195.
 * Leftover: host-owned cleanup + preExitFlush bags via WeakOwnerCache.
 * This module stays free of gracefulShutdown to avoid circular deps.
 */

import { getBootstrapSessionHost } from './sessionRoot.js'

type CleanupFn = () => void | Promise<void>

/** Official register input — fn | Disposable | AsyncDisposable (it()). */
export type CleanupRegistrable =
  | CleanupFn
  | { [Symbol.dispose](): void }
  | { [Symbol.asyncDispose](): PromiseLike<void> }

/** Official W.register / Et / Vk return — unregister + [Symbol.dispose]. */
export type CleanupUnregister = (() => void) & { [Symbol.dispose](): void }

/** Official tde=2000 — cleanup drain race budget (gracefulShutdown + `_G`). */
export const CLEANUP_DRAIN_TIMEOUT_MS = 2000

function asCleanupFn(e: CleanupRegistrable): CleanupFn {
  if (typeof e === 'function') return e
  if (Symbol.asyncDispose in e) {
    return async () => {
      await e[Symbol.asyncDispose]()
    }
  }
  return () => e[Symbol.dispose]()
}

/** Official W @178612748 — leftover DrainBag (never mint class W). */
class DrainBag {
  #e = new Set<CleanupFn>()
  #t = false
  get drainStarted(): boolean {
    return this.#t
  }
  register(e: CleanupRegistrable): CleanupUnregister {
    const t = asCleanupFn(e)
    this.#e.add(t)
    const r = (): void => {
      this.#e.delete(t)
    }
    return Object.assign(r, { [Symbol.dispose]: r })
  }
  async drain(): Promise<void> {
    this.#t = true
    const e = Array.from(this.#e)
    this.#e.clear()
    const r = (await Promise.allSettled(e.map(async i => i()))).find(
      i => i.status === 'rejected',
    )
    if (r !== undefined) throw r.reason
  }
  async [Symbol.asyncDispose](): Promise<void> {
    await this.drain()
  }
  get sizeForTesting(): number {
    return this.#e.size
  }
}

/** Official fe @178613195 — leftover SessionExitBags. */
class SessionExitBags {
  cleanup = new DrainBag()
  preExitFlush = new DrainBag()
}

class WeakOwnerCache<T> {
  #e: () => T
  #t = new WeakMap<object, T>()
  constructor(e: () => T) {
    this.#e = e
  }
  of(e: object): T {
    const t = this.#t.get(e)
    if (t !== undefined) return t
    const o = this.#e()
    this.#t.set(e, o)
    return o
  }
}

/** Official ot = new K(() => new fe); L() = ot.of(z().host) */
const sessionExitOwners = new WeakOwnerCache(() => new SessionExitBags())

function sessionExitBags(): SessionExitBags {
  return sessionExitOwners.of(getBootstrapSessionHost())
}

/**
 * Official Et — register a cleanup function for graceful shutdown / relaunch mEe.
 * @returns Unregister function (also [Symbol.dispose]) that removes the handler
 */
export function registerCleanup(
  cleanupFn: CleanupRegistrable,
): CleanupUnregister {
  return sessionExitBags().cleanup.register(cleanupFn)
}

/**
 * Official mEe — drain cleanup bag. Used by gracefulShutdown + leftover `_G`.
 */
export async function runCleanupFunctions(): Promise<void> {
  await sessionExitBags().cleanup.drain()
}

/** Official DYe — whether cleanup drain has started. */
export function cleanupDrainStarted(): boolean {
  return sessionExitBags().cleanup.drainStarted
}

/** Official DYe alias (storage-watch / Ma / kD gates). */
export const isCleanupDrainStarted = cleanupDrainStarted

/**
 * Official Vk — register a pre-exit flush for leftover `_G` g()/svt.
 * @returns Unregister function (also [Symbol.dispose])
 */
export function registerPreExitFlush(
  flushFn: CleanupRegistrable,
): CleanupUnregister {
  return sessionExitBags().preExitFlush.register(flushFn)
}

/**
 * Official svt — drain preExitFlush bag (g() "pre-exit flush timeout (relaunch)").
 */
export async function runPreExitFlush(): Promise<void> {
  await sessionExitBags().preExitFlush.drain()
}
