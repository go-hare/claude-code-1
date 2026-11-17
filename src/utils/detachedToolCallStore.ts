/**
 * densable `UPt` / `lb` — session-scoped detached tool_call registry for gVn/el.
 */
import { getBootstrapSession, getBootstrapSessionHost } from './sessionRoot.js'
import type { Tool } from '../Tool.js'
import type { Message } from '../types/message.js'
import { removeByFilter } from './messageQueueManager.js'

export type DetachedToolCall = {
  status: 'running' | 'completed' | 'failed' | 'stopped'
  detachedAt: number
  settledAt?: number
  tool: Tool
  input: unknown
  data?: unknown
  text?: string
  stopRequested?: boolean
  paintedInPlace: boolean
  resultQueued: boolean
}

export type DetachedSessionArg = { root?: object } | object

type Listener = () => void

/** densable `fie` / `BPt` — owesResult windows. */
const DETACH_RUNNING_OWES_MS = 300_000 + 30_000
const DETACH_SETTLED_OWES_MS = 30_000

class SessionDetachedToolCallStore {
  readonly root: object
  snapshot = new Map<string, DetachedToolCall>()
  readonly listeners = new Set<Listener>()
  readonly letGoIds = new Set<string>()
  readonly abortById = new Map<string, (reason?: unknown) => void>()

  constructor(root: object) {
    this.root = root
  }

  emit(): void {
    this.snapshot = new Map(this.snapshot)
    for (const l of this.listeners) l()
    for (const l of getHostState().globalListeners) l()
  }
}

type DetachedToolCallHostState = {
  storesBySessionRoot: WeakMap<object, SessionDetachedToolCallStore>
  ownerRootByToolUseId: Map<string, WeakRef<object>>
  globalListeners: Set<Listener>
}

const stateByHost = new WeakMap<object, DetachedToolCallHostState>()

function getHostState(): DetachedToolCallHostState {
  const host = getBootstrapSessionHost()
  let state = stateByHost.get(host)
  if (!state) {
    state = {
      storesBySessionRoot: new WeakMap(),
      ownerRootByToolUseId: new Map(),
      globalListeners: new Set(),
    }
    stateByHost.set(host, state)
  }
  return state
}

function resolveSessionRoot(session?: DetachedSessionArg): object {
  if (
    session !== undefined &&
    session !== null &&
    typeof session === 'object'
  ) {
    const candidate = (session as { root?: unknown }).root
    return candidate !== null && typeof candidate === 'object'
      ? candidate
      : session
  }
  return getBootstrapSession().root
}

function storeForRoot(root: object): SessionDetachedToolCallStore {
  const { storesBySessionRoot } = getHostState()
  let store = storesBySessionRoot.get(root)
  if (!store) {
    store = new SessionDetachedToolCallStore(root)
    storesBySessionRoot.set(root, store)
  }
  return store
}

function storeForSession(
  session?: DetachedSessionArg,
): SessionDetachedToolCallStore {
  return storeForRoot(resolveSessionRoot(session))
}

function storeForIdOrSession(
  id: string,
  session?: DetachedSessionArg,
): SessionDetachedToolCallStore {
  if (session !== undefined) {
    return storeForSession(session)
  }
  const defaultStore = storeForSession()
  if (
    defaultStore.snapshot.has(id) ||
    defaultStore.letGoIds.has(id) ||
    defaultStore.abortById.has(id)
  ) {
    return defaultStore
  }
  const ownerRoot = getHostState().ownerRootByToolUseId.get(id)?.deref()
  if (ownerRoot !== undefined) {
    return storeForRoot(ownerRoot)
  }
  return defaultStore
}

function trackOwnerRoot(id: string, store: SessionDetachedToolCallStore): void {
  getHostState().ownerRootByToolUseId.set(id, new WeakRef(store.root))
}

function releaseOwnerRootIfIdle(
  id: string,
  store: SessionDetachedToolCallStore,
): void {
  if (
    !store.snapshot.has(id) &&
    !store.letGoIds.has(id) &&
    !store.abortById.has(id)
  ) {
    getHostState().ownerRootByToolUseId.delete(id)
  }
}

export function subscribeDetachedToolCalls(
  listener: Listener,
  session?: DetachedSessionArg,
): () => void {
  if (session !== undefined) {
    const store = storeForSession(session)
    store.listeners.add(listener)
    return () => {
      store.listeners.delete(listener)
    }
  }
  const { globalListeners } = getHostState()
  globalListeners.add(listener)
  return () => {
    globalListeners.delete(listener)
  }
}

export function getDetachedToolCallSnapshot(
  session?: DetachedSessionArg,
): Map<string, DetachedToolCall> {
  return storeForSession(session).snapshot
}

export function getDetachedToolCall(
  id: string,
  session?: DetachedSessionArg,
): DetachedToolCall | undefined {
  return storeForIdOrSession(id, session).snapshot.get(id)
}

export function detachedToolCallStarted(
  id: string,
  info: { tool: Tool; input: unknown; detachedAt?: number },
  abort?: (reason?: unknown) => void,
  session?: DetachedSessionArg,
): void {
  const store =
    session !== undefined ? storeForSession(session) : storeForIdOrSession(id)
  trackOwnerRoot(id, store)
  store.snapshot.set(id, {
    status: 'running',
    detachedAt: info.detachedAt ?? Date.now(),
    tool: info.tool,
    input: info.input,
    paintedInPlace: false,
    resultQueued: false,
  })
  if (abort) store.abortById.set(id, abort)
  store.emit()
}

export function detachedToolCallSettled(
  id: string,
  next: {
    status: 'completed' | 'failed' | 'stopped'
    data?: unknown
    text?: string
  },
  session?: DetachedSessionArg,
): boolean {
  const store = storeForIdOrSession(id, session)
  // The call no longer needs a stop callback, even while rendering/queuing
  // its result. Keep letGo until the executor's detached drain has finished.
  store.abortById.delete(id)
  const prev = store.snapshot.get(id)
  if (prev === undefined) return false
  // densable UPt.settled: construct fresh state from base fields so a prior
  // completed data/stopRequested never leaks onto a subsequent failed/stopped entry.
  const settledEntry: DetachedToolCall = {
    status: next.status,
    detachedAt: prev.detachedAt,
    settledAt: Date.now(),
    tool: prev.tool,
    input: prev.input,
    ...(next.data !== undefined && { data: next.data }),
    ...(next.text !== undefined && { text: next.text }),
    paintedInPlace: false,
    resultQueued: next.status === 'completed' ? false : prev.resultQueued,
  }
  store.snapshot.set(id, settledEntry)
  store.emit()
  return true
}

export function detachedToolCallSetText(
  id: string,
  text: string,
  session?: DetachedSessionArg,
): void {
  const store = storeForIdOrSession(id, session)
  const prev = store.snapshot.get(id)
  if (prev === undefined || prev.text === text) return
  store.snapshot.set(id, { ...prev, text })
  store.emit()
}

export function detachedToolCallResultQueued(
  id: string,
  session?: DetachedSessionArg,
): void {
  const store = storeForIdOrSession(id, session)
  const prev = store.snapshot.get(id)
  if (prev?.status === 'completed' && !prev.resultQueued) {
    store.snapshot.set(id, { ...prev, resultQueued: true })
    store.emit()
  }
}

export function detachedToolCallPaintedInPlace(
  id: string,
  session?: DetachedSessionArg,
): void {
  const store = storeForIdOrSession(id, session)
  const prev = store.snapshot.get(id)
  if (prev === undefined || prev.status === 'running' || prev.paintedInPlace) {
    return
  }
  store.snapshot.set(id, { ...prev, paintedInPlace: true })
  store.emit()
}

export function isDetachBackgrounding(tool: {
  backgrounding?: string
}): boolean {
  return tool.backgrounding === 'detach'
}

/** densable `UPt.letGo` — send-now took the call; permission prompts refuse. */
export function detachedToolCallLetGo(
  id: string,
  session?: DetachedSessionArg,
): void {
  const store = storeForSession(session)
  trackOwnerRoot(id, store)
  store.letGoIds.add(id)
}

/** densable `UPt.ended`. */
export function detachedToolCallEnded(
  id: string,
  session?: DetachedSessionArg,
): void {
  const store = storeForIdOrSession(id, session)
  store.letGoIds.delete(id)
  store.abortById.delete(id)
  releaseOwnerRootIfIdle(id, store)
}

/** densable `UPt.wasLetGo`. */
export function detachedToolCallWasLetGo(
  id: string,
  session?: DetachedSessionArg,
): boolean {
  return storeForIdOrSession(id, session).letGoIds.has(id)
}

/** densable `UPt.awaitingResult`. */
export function detachedToolCallsAwaitingResult(
  session?: DetachedSessionArg,
): string[] {
  const store = storeForSession(session)
  const ids: string[] = []
  for (const [id, rec] of store.snapshot) {
    if (
      rec.status === 'running' ||
      (rec.status === 'completed' && !rec.resultQueued)
    ) {
      ids.push(id)
    }
  }
  return ids
}

/** densable `UPt.owesResult(now)`. */
export function detachedToolCallsOweResult(
  now: number = Date.now(),
  session?: DetachedSessionArg,
): boolean {
  const store = storeForSession(session)
  for (const rec of store.snapshot.values()) {
    if (rec.status === 'running') {
      if (now - rec.detachedAt < DETACH_RUNNING_OWES_MS) return true
    } else if (
      rec.status === 'completed' &&
      !rec.resultQueued &&
      rec.settledAt !== undefined &&
      now - rec.settledAt < DETACH_SETTLED_OWES_MS
    ) {
      return true
    }
  }
  return false
}

/** densable `UPt.stopRunning` — stop running detached calls in session. */
export function stopRunningDetachedToolCalls(
  session?: DetachedSessionArg,
  ids?: ReadonlySet<string>,
): number {
  const store = storeForSession(session)
  // densable UPt.stopRunning: iterate abortById (`this.#t`) directly so calls
  // registered via letGo/setAbort before `started` are also aborted.
  const matched = [...store.abortById].filter(
    ([id]) => ids === undefined || ids.has(id),
  )
  if (matched.length === 0) return 0
  for (const [id] of matched) {
    store.abortById.delete(id)
  }
  let marked = false
  for (const [id] of matched) {
    const rec = store.snapshot.get(id)
    if (rec?.status === 'running' && !rec.stopRequested) {
      store.snapshot.set(id, { ...rec, stopRequested: true })
      marked = true
    }
    releaseOwnerRootIfIdle(id, store)
  }
  if (marked) store.emit()
  for (const [, abort] of matched) abort('user-cancel')
  return matched.length
}

/** densable UPt.#t abort passed to `started`. */
export function detachedToolCallAbort(
  id: string,
  reason?: unknown,
  session?: DetachedSessionArg,
): boolean {
  const store = storeForIdOrSession(id, session)
  const abort = store.abortById.get(id)
  if (!abort) return false
  abort(reason)
  return true
}

/** Apply conversation pruning within the previous transcript's agent scope. */
export function pruneDetachedToolCalls(
  previous: readonly Message[],
  next: readonly Message[],
  session?: DetachedSessionArg,
): void {
  const scope = new Set<string>()
  for (const message of previous) {
    if (message.type !== 'assistant') continue
    const content = message.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_use') scope.add(block.id)
    }
  }
  if (scope.size > 0) discardDetachedToolCallsOutside(next, scope, session)
}

/** densable UPt.discardAllOutside / Rcn — conversation lifetime, not a TTL. */
export function discardDetachedToolCallsOutside(
  messages: readonly Message[],
  scope: ReadonlySet<string>,
  session?: DetachedSessionArg,
): Set<string> {
  const store = storeForSession(session)
  const retained = new Set<string>()
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    const content = message.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_use') retained.add(block.id)
    }
  }
  const removed = new Set<string>()
  const aborts: Array<(reason?: unknown) => void> = []
  for (const [id, abort] of [...store.abortById]) {
    if (!scope.has(id) || retained.has(id)) continue
    store.abortById.delete(id)
    aborts.push(abort)
  }
  for (const id of store.snapshot.keys()) {
    // The local registry is shared across agents. Only the replaced
    // conversation's previous tool IDs belong to this cleanup operation.
    if (!scope.has(id) || retained.has(id)) continue
    removed.add(id)
    store.snapshot.delete(id)
    releaseOwnerRootIfIdle(id, store)
  }
  for (const id of scope) {
    if (!retained.has(id)) releaseOwnerRootIfIdle(id, store)
  }
  // Remove records before aborting so a drain finishing synchronously cannot
  // resurrect a discarded result. letGo still ends with the detached drain.
  for (const abort of aborts) abort('conversation-cleared')
  if (removed.size > 0) {
    store.emit()
    removeByFilter(command => {
      if (
        command.mode !== 'task-notification' ||
        typeof command.value !== 'string'
      ) {
        return false
      }
      const match = command.value.match(
        /^<task-notification>\n<tool-use-id>([^<]+)<\/tool-use-id>\n<task-type>tool_call<\/task-type>\n/,
      )
      return match !== null && removed.has(match[1]!)
    })
  }
  return removed
}

export function detachedToolCallSetAbort(
  id: string,
  abort: (reason?: unknown) => void,
  session?: DetachedSessionArg,
): void {
  const store = storeForIdOrSession(id, session)
  trackOwnerRoot(id, store)
  store.abortById.set(id, abort)
}
