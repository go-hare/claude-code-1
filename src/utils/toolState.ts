/**
 * densable `wN`. Session slot map: `get(Ctor)` returns the instance already
 * stored for that constructor, or constructs one and keeps it.
 */
export class ToolStateSlots {
  #slots = new Map<unknown, unknown>()

  get<T>(ctor: new () => T): T {
    const existing = this.#slots.get(ctor)
    if (existing instanceof ctor) return existing
    const created = new ctor()
    this.#slots.set(ctor, created)
    return created
  }
}
