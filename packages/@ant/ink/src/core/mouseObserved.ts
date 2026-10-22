/**
 * densable `Ljr` / `aUt` / `lUt` — first mouse/wheel observation per host.
 * Gold: `i.of(U().host).note()`.
 */
import { inkSessionHost } from './instances.js'

class MouseObservedBag {
  observed = false
  readonly listeners = new Set<() => void>()
  get hasObserved(): boolean {
    return this.observed
  }
  note(): void {
    if (this.observed) return
    this.observed = true
    for (const listener of this.listeners) listener()
  }
}

const bags = new WeakMap<object, MouseObservedBag>()

function bag(): MouseObservedBag {
  const host = inkSessionHost()
  const existing = bags.get(host)
  if (existing) return existing
  const created = new MouseObservedBag()
  bags.set(host, created)
  return created
}

/** densable `Ljr`. */
export function noteMouseObserved(): void {
  bag().note()
}

/** densable `aUt`. */
export function hasObservedMouse(): boolean {
  return bag().hasObserved
}

/** densable `lUt`. */
export function subscribeMouseObserved(listener: () => void): () => void {
  const current = bag()
  current.listeners.add(listener)
  return () => {
    current.listeners.delete(listener)
  }
}

export function resetMouseObservedForTests(): void {
  bags.delete(inkSessionHost())
}
