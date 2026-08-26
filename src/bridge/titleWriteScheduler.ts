/**
 * densable 2.1.239 #39 — `_ts` title-write coalesce + token-bucket + retry.
 * Official: burst=3, refillMs=1e4, retryMs=60000. write=`uAl`, read=`x_r`.
 */

import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'

export type TitleWriteResult = 'landed' | 'failed' | 'rejected'

export type TitleWriteOpts = {
  baseUrl?: string
  getAccessToken?: () => string | undefined
  shouldSend?: () => boolean
  userInitiated?: boolean
}

type TitleWriteWaiter = () => void

type TitleWritePending = {
  title: string
  opts: TitleWriteOpts | undefined
  waiters: TitleWriteWaiter[]
}

type TitleWriteEntry = {
  lastSentTitle: string | undefined
  lastSentOk: boolean
  sentTitles: Set<string>
  knownTitles: Set<string>
  tokens: number
  refilledAt: number
  pending: TitleWritePending | undefined
  inFlight: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  retryTimer: ReturnType<typeof setTimeout> | undefined
  sendingRetry: boolean
  suppressed: number
}

type TitleWriteFn = (
  sessionId: string,
  title: string,
  opts?: TitleWriteOpts,
) => Promise<TitleWriteResult>

type TitleReadFn = (
  sessionId: string,
  opts?: TitleWriteOpts,
) => Promise<{ title?: string } | null>

type TitleWriteState = {
  entries: Map<string, TitleWriteEntry>
  burst: number
  refillMs: number
  retryMs: number
  isOwnTitle: (sessionId: string, title: string) => boolean
  onRemoteTitleAdopted: (sessionId: string, title: string) => void
  writeTitle: TitleWriteFn
  readSession: TitleReadFn
}

export type TitleWriteScheduler = {
  update: (
    sessionId: string,
    title: string,
    opts?: TitleWriteOpts,
  ) => Promise<void>
  noteRemoteTitle: (sessionId: string, title: string) => void
  forget: (sessionId: string) => void
  hasSent: (sessionId: string, title: string) => boolean
  isKnownTitle: (sessionId: string, title: string) => boolean
}

/** densable uAl via tip PATCH; map bool → landed/failed. */
async function writeTitle(
  sessionId: string,
  title: string,
  opts?: TitleWriteOpts,
): Promise<TitleWriteResult> {
  const { updateBridgeSessionTitle } = await import('./createSession.js')
  const ok = await updateBridgeSessionTitle(sessionId, title, {
    baseUrl: opts?.baseUrl,
    getAccessToken: opts?.getAccessToken,
  })
  return ok ? 'landed' : 'failed'
}

/** densable x_r — GET session (title for retry adopt). */
async function readSession(
  sessionId: string,
  opts?: TitleWriteOpts,
): Promise<{ title?: string } | null> {
  const { getBridgeSession } = await import('./createSession.js')
  return getBridgeSession(sessionId, {
    baseUrl: opts?.baseUrl,
    getAccessToken: opts?.getAccessToken,
  })
}

/** densable myh */
function getOrCreateEntry(
  state: TitleWriteState,
  sessionId: string,
): TitleWriteEntry {
  let entry = state.entries.get(sessionId)
  if (!entry) {
    entry = {
      lastSentTitle: undefined,
      lastSentOk: false,
      sentTitles: new Set(),
      knownTitles: new Set(),
      tokens: state.burst,
      refilledAt: Date.now(),
      pending: undefined,
      inFlight: false,
      timer: undefined,
      retryTimer: undefined,
      sendingRetry: false,
      suppressed: 0,
    }
    state.entries.set(sessionId, entry)
  }
  return entry
}

/** densable yts */
function resolveWaiters(waiters: TitleWriteWaiter[] | undefined): void {
  for (const waiter of waiters ?? []) {
    waiter()
  }
}

/** densable Vfo */
function clearRetryTimer(entry: TitleWriteEntry): void {
  if (entry.retryTimer) {
    clearTimeout(entry.retryTimer)
    entry.retryTimer = undefined
  }
}

/** densable fWl */
function dropPending(entry: TitleWriteEntry): void {
  resolveWaiters(entry.pending?.waiters)
  entry.pending = undefined
  entry.sendingRetry = false
  entry.suppressed = 0
}

/** densable gyh — same title is a no-op unless userInitiated. */
function shouldSuppressDuplicate(
  entry: TitleWriteEntry,
  title: string,
  opts?: TitleWriteOpts,
): boolean {
  if (entry.lastSentTitle !== title) {
    return false
  }
  if (entry.inFlight || entry.retryTimer !== undefined) {
    return true
  }
  return entry.lastSentOk && !opts?.userInitiated
}

/** densable SxE */
function refillTokens(
  state: TitleWriteState,
  entry: TitleWriteEntry,
  now: number,
): void {
  const steps = Math.floor((now - entry.refilledAt) / state.refillMs)
  if (steps > 0) {
    entry.tokens = Math.min(state.burst, entry.tokens + steps)
    entry.refilledAt += steps * state.refillMs
  }
  if (entry.tokens === state.burst) {
    entry.refilledAt = now
  }
}

/** densable fyh */
function retryStillValid(
  state: TitleWriteState,
  entry: TitleWriteEntry,
  sessionId: string,
  title: string,
): boolean {
  return (
    state.entries.get(sessionId) === entry &&
    entry.lastSentTitle === title &&
    !entry.lastSentOk &&
    !entry.inFlight &&
    !entry.pending &&
    !entry.retryTimer
  )
}

/** densable hyh */
function noteRemoteTitle(
  state: TitleWriteState,
  sessionId: string,
  title: string,
): void {
  const entry = getOrCreateEntry(state, sessionId)
  entry.lastSentTitle = title
  entry.lastSentOk = true
  entry.knownTitles.add(title)
  clearRetryTimer(entry)
  dropPending(entry)
}

/** densable AxE */
function forgetEntry(state: TitleWriteState, sessionId: string): void {
  const entry = state.entries.get(sessionId)
  if (!entry) {
    return
  }
  if (entry.timer) {
    clearTimeout(entry.timer)
  }
  clearRetryTimer(entry)
  dropPending(entry)
  state.entries.delete(sessionId)
}

/** densable wxE */
function onRefillTimer(state: TitleWriteState, sessionId: string): void {
  const entry = state.entries.get(sessionId)
  if (entry) {
    entry.timer = undefined
    flushPending(state, sessionId)
  }
}

/** densable ExE */
function onRetryTimer(
  state: TitleWriteState,
  sessionId: string,
  title: string,
  opts: TitleWriteOpts | undefined,
): void {
  const entry = state.entries.get(sessionId)
  if (!entry) {
    return
  }
  entry.retryTimer = undefined
  if (!retryStillValid(state, entry, sessionId, title)) {
    return
  }
  if (opts?.shouldSend !== undefined && !opts.shouldSend()) {
    logForDebugging('[bridge] title write retry dropped: sending is now barred')
    return
  }
  void state.readSession(sessionId, opts).then(
    session => {
      if (!retryStillValid(state, entry, sessionId, title)) {
        return
      }
      if (session === null) {
        logForDebugging(
          '[bridge] title write retry skipped: server state unreadable',
        )
        return
      }
      if (
        session.title &&
        !entry.knownTitles.has(session.title) &&
        !state.isOwnTitle(sessionId, session.title)
      ) {
        logForDebugging(
          '[bridge] title write retry dropped: the session was renamed elsewhere',
        )
        noteRemoteTitle(state, sessionId, session.title)
        state.onRemoteTitleAdopted(sessionId, session.title)
        return
      }
      entry.pending = { title, opts, waiters: [] }
      entry.sendingRetry = true
      flushPending(state, sessionId)
    },
    err => {
      logForDebugging(
        `[bridge] title write retry skipped: ${errorMessage(err)}`,
      )
    },
  )
}

/** densable bts */
function flushPending(state: TitleWriteState, sessionId: string): void {
  const entry = state.entries.get(sessionId)
  if (!entry || entry.inFlight || !entry.pending) {
    return
  }
  const now = Date.now()
  refillTokens(state, entry, now)
  if (entry.tokens <= 0 && !entry.pending.opts?.userInitiated) {
    if (!entry.timer) {
      const waitMs = Math.max(0, entry.refilledAt + state.refillMs - now)
      entry.timer = setTimeout(onRefillTimer, waitMs, state, sessionId)
      entry.timer.unref?.()
    }
    return
  }
  const { title, opts, waiters } = entry.pending
  entry.pending = undefined
  if (
    shouldSuppressDuplicate(entry, title, opts) ||
    (opts?.shouldSend !== undefined && !opts.shouldSend())
  ) {
    clearRetryTimer(entry)
    entry.sendingRetry = false
    entry.suppressed = 0
    resolveWaiters(waiters)
    return
  }
  entry.tokens = Math.max(0, entry.tokens - 1)
  entry.inFlight = true
  entry.lastSentTitle = title
  entry.lastSentOk = false
  entry.sentTitles.add(title)
  entry.knownTitles.add(title)
  clearRetryTimer(entry)
  const sendingRetry = entry.sendingRetry
  entry.sendingRetry = false
  if (entry.suppressed > 0) {
    logForDebugging(
      `[bridge] title write: sending latest after coalescing ${entry.suppressed} update(s)`,
    )
    entry.suppressed = 0
  }
  void state
    .writeTitle(sessionId, title, opts)
    .then(result => {
      if (result === 'landed') {
        entry.lastSentTitle = title
        entry.lastSentOk = true
      } else if (entry.lastSentTitle === title) {
        entry.lastSentOk = false
      }
      if (state.entries.get(sessionId) !== entry) {
        return
      }
      if (
        result === 'failed' &&
        !sendingRetry &&
        !entry.retryTimer &&
        !entry.pending
      ) {
        entry.retryTimer = setTimeout(
          onRetryTimer,
          state.retryMs,
          state,
          sessionId,
          title,
          opts,
        )
        entry.retryTimer.unref?.()
      }
    })
    .catch(err => {
      logForDebugging(`[bridge] title write failed: ${errorMessage(err)}`)
    })
    .finally(() => {
      entry.inFlight = false
      resolveWaiters(waiters)
      flushPending(state, sessionId)
    })
}

/** densable vxE */
function enqueueUpdate(
  state: TitleWriteState,
  sessionId: string,
  title: string,
  opts?: TitleWriteOpts,
): Promise<void> {
  const entry = getOrCreateEntry(state, sessionId)
  if (shouldSuppressDuplicate(entry, title, opts)) {
    dropPending(entry)
    return Promise.resolve()
  }
  return new Promise(resolve => {
    const waiters = [resolve]
    clearRetryTimer(entry)
    if (entry.pending || entry.inFlight) {
      entry.suppressed += 1
    }
    resolveWaiters(entry.pending?.waiters)
    entry.pending = { title, opts, waiters }
    entry.sendingRetry = false
    flushPending(state, sessionId)
  })
}

/**
 * densable `_ts(e)`.
 * Defaults: burst=3, refillMs=10000, retryMs=60000.
 */
export function createTitleWriteScheduler(opts?: {
  burst?: number
  refillMs?: number
  retryMs?: number
  isOwnTitle?: (sessionId: string, title: string) => boolean
  onRemoteTitleAdopted?: (sessionId: string, title: string) => void
  /** Test inject — production uses official uAl / x_r. */
  writeTitle?: TitleWriteFn
  readSession?: TitleReadFn
}): TitleWriteScheduler {
  const state: TitleWriteState = {
    entries: new Map(),
    burst: opts?.burst ?? 3,
    refillMs: opts?.refillMs ?? 1e4,
    retryMs: opts?.retryMs ?? 60_000,
    isOwnTitle: opts?.isOwnTitle ?? (() => false),
    onRemoteTitleAdopted: opts?.onRemoteTitleAdopted ?? (() => {}),
    writeTitle: opts?.writeTitle ?? writeTitle,
    readSession: opts?.readSession ?? readSession,
  }
  return {
    update: (sessionId, title, writeOpts) =>
      enqueueUpdate(state, sessionId, title, writeOpts),
    noteRemoteTitle: (sessionId, title) =>
      noteRemoteTitle(state, sessionId, title),
    forget: sessionId => forgetEntry(state, sessionId),
    hasSent: (sessionId, title) =>
      state.entries.get(sessionId)?.sentTitles.has(title) ?? false,
    isKnownTitle: (sessionId, title) =>
      state.entries.get(sessionId)?.knownTitles.has(title) ?? false,
  }
}
