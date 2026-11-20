import type { ScrollBoxHandle } from '../components/ScrollBox.js'

function noop(): void {}

/**
 * Official 2.1.328 `oEt` — subscribable ScrollBox viewport proxy.
 *
 * Exposes `handle`, `attach` (React 19 ref callback with cleanup stack), and
 * `subscribe` so scroll consumers bind once regardless of ScrollBox mount order.
 */
export class ScrollViewport {
  private _handle: ScrollBoxHandle | null = null
  private _stack: ScrollBoxHandle[] = []
  private _unsub: () => void = noop
  private readonly _listeners = new Set<() => void>()

  get handle(): ScrollBoxHandle | null {
    return this._handle
  }

  private readonly emit = (): void => {
    for (const listener of this._listeners) {
      listener()
    }
  }

  private setActiveHandle(next: ScrollBoxHandle | null): void {
    if (next === this._handle) return
    this._unsub()
    this._handle = next
    this._unsub = next ? next.subscribe(this.emit) : noop
  }

  attach = (handle: ScrollBoxHandle | null): (() => void) => {
    this._stack = handle === null ? [] : [...this._stack, handle]
    this.setActiveHandle(handle)
    return () => {
      this._stack = this._stack.filter(entry => entry !== handle)
      this.setActiveHandle(this._stack.at(-1) ?? null)
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener)
    return () => {
      this._listeners.delete(listener)
    }
  }
}
