/**
 * densable bGl / HSh — DialogStore with queueBehind semantics.
 *
 * open: queueBehind + already open → prepend (stay under current top);
 * otherwise push end (become top). Stealing top stamps swappedAt.
 * answer/dismiss remove via HSh and emit onClosed.
 */
import { createStore, type Store } from '../state/store.js'
import { createSignal } from '../utils/signal.js'
import { isPermissionDialogKind } from './specs/permissionKinds.js'

export type DialogClosedEvent =
  | { id: string; type: 'answered'; result: unknown }
  | { id: string; type: 'dismissed' }

export type CountedAskHandle = {
  readonly settled: boolean
  settle: () => void
  onSettle: (listener: () => void) => () => void
}

export type OpenDialogEntry = {
  id: string
  kind: string
  payload: unknown
  queueBehind?: boolean
  swappedAt?: number
  /** densable place — "under" prepends below engine stack; "queue" inserts by askOrder. */
  place?: 'under' | 'queue'
  /** densable askOrder — monotonic ordering key for place === "queue". */
  askOrder?: number
  /** densable countedAsk — optional external ask-tally handle. */
  countedAsk?: CountedAskHandle
  /** densable holdsTop — engine top keeps the stack unless succeeds. */
  holdsTop?: boolean
  /** densable userInvoked — slash/local_jsx vs engine. */
  userInvoked?: boolean
  /** densable succeeds — wne may steal holdsTop. */
  succeeds?: boolean
}

export type DialogAskTally = {
  subscribe: (listener: () => void) => () => void
  positionLabel: (id: string) => string | null
}

export type DialogStoreState = {
  open: OpenDialogEntry[]
}

export type DialogStore = {
  getState: () => DialogStoreState
  subscribe: Store<DialogStoreState>['subscribe']
  onClosed: (listener: (event: DialogClosedEvent) => void) => () => void
  askTally: DialogAskTally
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

/** densable Dhr `x` — insertion index for `place === "queue"` ordered by `askOrder`. */
function findQueueInsertionIndex(
  open: readonly OpenDialogEntry[],
  entry: OpenDialogEntry,
): number | undefined {
  const order = entry.askOrder ?? Number.POSITIVE_INFINITY
  let idx = open.findIndex(
    item =>
      item.place !== undefined &&
      item.askOrder !== undefined &&
      item.askOrder <= order,
  )
  if (idx === -1) {
    const lastQueued = open.findLastIndex(
      item => item.place === 'queue' && item.askOrder !== undefined,
    )
    const lastPlaced = open.findLastIndex(
      item => item.place !== undefined && item.askOrder !== undefined,
    )
    const hasUnorderedBlockingAbove = open
      .slice(lastPlaced + 1)
      .some(
        item =>
          item.askOrder === undefined &&
          item.holdsTop !== true &&
          item.userInvoked !== true,
      )
    idx =
      lastQueued !== -1 && !hasUnorderedBlockingAbove
        ? lastPlaced + 1
        : open.findIndex(
            item => item.place === undefined && item.askOrder !== undefined,
          )
  }
  if (idx === -1) return undefined
  const unplacedIdx = open.findIndex(
    item => item.place === undefined && item.askOrder !== undefined,
  )
  if (unplacedIdx !== -1 && unplacedIdx < idx) idx = unplacedIdx
  return open.slice(idx).some(item => item.userInvoked !== true)
    ? idx
    : undefined
}

/** densable Dhr / bGl */
export function createDialogStore(): DialogStore {
  const store = createStore<DialogStoreState>({ open: [] })
  const closed = createSignal<[DialogClosedEvent]>()
  const tallyChanged = createSignal<[]>()
  const openCountedIds = new Set<string>()
  const countedUnsubscribes = new Map<string, () => void>()
  let settledCount = 0

  function settleTallyId(id: string, increment: boolean): void {
    const unsub = countedUnsubscribes.get(id)
    if (unsub) {
      countedUnsubscribes.delete(id)
      unsub()
    }
    if (!openCountedIds.delete(id)) return
    if (openCountedIds.size === 0) {
      settledCount = 0
    } else if (increment) {
      settledCount += 1
    }
    tallyChanged.emit()
  }

  const askTally: DialogAskTally = {
    subscribe: tallyChanged.subscribe,
    positionLabel(id: string): string | null {
      if (!openCountedIds.has(id)) return null
      const total = settledCount + openCountedIds.size
      return total < 2 ? null : `${settledCount + 1} of ${total}`
    },
  }

  const api: DialogStore = {
    getState: store.getState,
    subscribe: store.subscribe,
    onClosed: closed.subscribe,
    askTally,
    open(entry) {
      if (entry.countedAsk !== undefined) {
        if (!entry.countedAsk.settled && !openCountedIds.has(entry.id)) {
          openCountedIds.add(entry.id)
          countedUnsubscribes.set(
            entry.id,
            entry.countedAsk.onSettle(() => settleTallyId(entry.id, true)),
          )
          tallyChanged.emit()
        }
      } else if (
        isPermissionDialogKind(entry.kind) &&
        !openCountedIds.has(entry.id)
      ) {
        openCountedIds.add(entry.id)
        tallyChanged.emit()
      }
      store.setState(state => {
        const queueIndex =
          entry.place === 'queue'
            ? findQueueInsertionIndex(state.open, entry)
            : undefined
        if (queueIndex !== undefined) {
          return {
            open: [
              ...state.open.slice(0, queueIndex),
              entry,
              ...state.open.slice(queueIndex),
            ],
          }
        }
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
      store
        .getState()
        .open.find(entry => entry.id === id)
        ?.countedAsk?.settle()
      if (!removeOpenEntry(store, id)) return
      settleTallyId(id, true)
      closed.emit({ id, type: 'answered', result })
    },
    dismiss(id) {
      if (!removeOpenEntry(store, id)) return
      settleTallyId(id, false)
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
