/**
 * densable bGl / HSh — DialogStore with queueBehind semantics.
 *
 * open: queueBehind + already open → prepend (stay under current top);
 * otherwise push end (become top). Stealing top stamps swappedAt.
 * answer/dismiss remove via HSh and emit onClosed.
 */
import { createStore, type Store } from '../state/store.js'
import { createSignal } from '../utils/signal.js'

export type DialogClosedEvent =
  | { id: string; type: 'answered'; result: unknown }
  | { id: string; type: 'dismissed' }

export type OpenDialogEntry = {
  id: string
  kind: string
  payload: unknown
  queueBehind?: boolean
  swappedAt?: number
  /** densable place — "under" prepends below engine stack. */
  place?: 'under' | 'queue'
  /** densable holdsTop — engine top keeps the stack unless succeeds. */
  holdsTop?: boolean
  /** densable userInvoked — slash/local_jsx vs engine. */
  userInvoked?: boolean
  /** densable succeeds — wne may steal holdsTop. */
  succeeds?: boolean
}

export type DialogStoreState = {
  open: OpenDialogEntry[]
}

export type DialogStore = {
  getState: () => DialogStoreState
  subscribe: Store<DialogStoreState>['subscribe']
  onClosed: (listener: (event: DialogClosedEvent) => void) => () => void
  open: (entry: OpenDialogEntry) => void
  update: (id: string, payload: unknown) => void
  answer: (id: string, result: unknown) => void
  dismiss: (id: string) => void
  dismissKind: (kind: string) => void
}

/** densable HSh — remove id from open; if it was top, stamp new top swappedAt */
function removeOpenEntry(store: Store<DialogStoreState>, id: string): boolean {
  let removed = false
  store.setState(state => {
    const next = state.open.filter(entry => entry.id !== id)
    if (next.length === state.open.length) return state
    removed = true
    const wasTop = state.open.at(-1)?.id === id
    const newTop = next.at(-1)
    return {
      open:
        wasTop && newTop
          ? [...next.slice(0, -1), { ...newTop, swappedAt: Date.now() }]
          : next,
    }
  })
  return removed
}

/** densable WO — last engine (non-userInvoked) dialog. */
function leftoverEngineTop(
  open: readonly OpenDialogEntry[],
): OpenDialogEntry | undefined {
  for (let i = open.length - 1; i >= 0; i--) {
    if (open[i]!.userInvoked !== true) return open[i]
  }
  return undefined
}

/** densable m — same userInvoked bucket. */
function leftoverSameDialogBucket(
  a: OpenDialogEntry,
  b: OpenDialogEntry,
): boolean {
  return (a.userInvoked === true) === (b.userInvoked === true)
}

/** densable bGl */
export function createDialogStore(): DialogStore {
  const store = createStore<DialogStoreState>({ open: [] })
  const closed = createSignal<[DialogClosedEvent]>()

  const api: DialogStore = {
    getState: store.getState,
    subscribe: store.subscribe,
    onClosed: closed.subscribe,
    open(entry) {
      store.setState(state => {
        const engineTop = leftoverEngineTop(state.open)
        const holdsTopBlock =
          engineTop?.holdsTop === true &&
          leftoverSameDialogBucket(engineTop, entry) &&
          entry.succeeds !== true
        const hasEngine = state.open.some(open => open.userInvoked !== true)
        if ((entry.place === 'under' || holdsTopBlock) && hasEngine) {
          return { open: [entry, ...state.open] }
        }
        if (entry.queueBehind && state.open.length > 0) {
          return { open: [entry, ...state.open] }
        }
        const next =
          state.open.length > 0 ? { ...entry, swappedAt: Date.now() } : entry
        return { open: [...state.open, next] }
      })
    },
    update(id, payload) {
      store.setState(state => {
        const idx = state.open.findIndex(entry => entry.id === id)
        if (idx === -1) return state
        const open = state.open.slice()
        open[idx] = {
          ...state.open[idx]!,
          payload,
          swappedAt: Date.now(),
        }
        return { open }
      })
    },
    answer(id, result) {
      if (!removeOpenEntry(store, id)) return
      closed.emit({ id, type: 'answered', result })
    },
    dismiss(id) {
      if (!removeOpenEntry(store, id)) return
      closed.emit({ id, type: 'dismissed' })
    },
    dismissKind(kind) {
      for (const entry of store.getState().open) {
        if (entry.kind === kind) api.dismiss(entry.id)
      }
    },
  }
  return api
}
