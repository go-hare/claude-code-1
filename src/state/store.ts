type Listener = () => void
type OnChange<T> = (args: { newState: T; oldState: T }) => void

export type Store<T> = {
  getSnapshot: () => T
  getState: () => T
  setState: (updater: (prev: T) => T) => void
  subscribe: (listener: Listener) => () => void
}

export type SliceStore<S> = {
  get: () => S
  set: (updater: (prev: S) => S) => void
}

/** Official VWt — shallow-patch updater on a Store. */
export function updateAppState<T extends object>(
  setState: Store<T>['setState'],
): (updater: (prev: T) => T | Partial<T>) => void {
  return updater =>
    setState(prev => {
      const next = updater(prev)
      return Object.is(next, prev) ? prev : { ...prev, ...next }
    })
}

/** Official rfe — slice facade over Store[key]. */
export function sliceStore<T extends object, K extends keyof T>(
  getState: () => T,
  setState: Store<T>['setState'],
  key: K,
): SliceStore<T[K]> {
  return {
    get: () => getState()[key],
    set: updater =>
      setState(prev => {
        const cur = prev[key]
        const next = updater(cur)
        return Object.is(next, cur) ? prev : { ...prev, [key]: next }
      }),
  }
}

export function createStore<T>(
  initialState: T,
  onChange?: OnChange<T>,
): Store<T> {
  let state = initialState
  const listeners = new Set<Listener>()
  const getSnapshot = () => state

  return {
    getSnapshot,
    getState: getSnapshot,

    setState: (updater: (prev: T) => T) => {
      const prev = state
      const next = updater(prev)
      if (Object.is(next, prev)) return
      state = next
      try {
        onChange?.({ newState: next, oldState: prev })
      } catch (error) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { logError } =
            require('../utils/log.js') as typeof import('../utils/log.js')
          logError(error)
        } catch {
          // Best-effort logging; keep store.ts usable without side-effect imports.
        }
      }
      for (const listener of listeners) listener()
    },

    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
