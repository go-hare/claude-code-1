/**
 * Official 2.1.331 `W` (`HostSlot`) and `$e` / `Ln` (`RootSessionSlot`).
 *
 * - `HostSlot<T>` (`W` in `chunk-hw39ejdp.js`): WeakMap keyed on `SessionHost`
 *   (or any host object), lazily instantiated via `#factory` on first `.of(host)`.
 * - `RootSessionSlot<T>` (`$e` / `Ln` in `chunk-rt08nrs0.js`): WeakMap keyed on
 *   `session.root`, so `withProject` forks share the root session's slot.
 */

export class HostSlot<T> {
  #factory: () => T
  #map = new WeakMap<object, T>()

  constructor(factory: () => T) {
    this.#factory = factory
  }

  peek(host: object): T | undefined {
    return this.#map.get(host)
  }

  of(host: object): T {
    const existing = this.#map.get(host)
    if (existing !== undefined) return existing
    if (this.#map.has(host)) return existing as T
    const created = this.#factory()
    this.#map.set(host, created)
    return created
  }

  drop(host: object): void {
    this.#map.delete(host)
  }
}

export class RootSessionSlot<T> {
  #factory: () => T
  #map = new WeakMap<object, T>()

  constructor(factory: () => T) {
    this.#factory = factory
  }

  peek(session: { readonly root: object }): T | undefined {
    return this.#map.get(session.root)
  }

  of(session: { readonly root: object }): T {
    const root = session.root
    const existing = this.#map.get(root)
    if (existing !== undefined) return existing
    if (this.#map.has(root)) return existing as T
    const created = this.#factory()
    this.#map.set(root, created)
    return created
  }

  drop(session: { readonly root: object }): void {
    this.#map.delete(session.root)
  }
}
