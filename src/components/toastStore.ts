import { randomUUID } from 'crypto'
import {
  getActiveSessionFromAls,
  getBootstrapSession,
  RootSessionSlot,
  runWithSession,
  type Session,
} from '../utils/sessionRoot.js'

/** densable toast record. Text only — no second React node, no pre-split lines. */
export type ToastItem = {
  id: string
  plugin?: string
  text: string
  phase: 'shown' | 'leaving'
  shownAt: number
  leavesAt: number
  heldAt?: number
}

export const TOAST_HOLD_MAX_MS = 30_000
export const TOAST_FADE_MS = 240
const HOLD_MS = TOAST_HOLD_MAX_MS
const FADE_MS = TOAST_FADE_MS
/** densable `A8` — stacked toast cap. */
const TOAST_STACK_MAX = 50

type ToastSessionState = {
  items: ToastItem[]
  pausedAt: number | undefined
  pendingExpiryTimer: ReturnType<typeof setTimeout> | undefined
  listeners: Map<() => void, Session | undefined>
}

const toastStateBySession = new RootSessionSlot<ToastSessionState>(() => ({
  items: [],
  pausedAt: undefined,
  pendingExpiryTimer: undefined,
  listeners: new Map(),
}))

function getToastState(): ToastSessionState {
  return toastStateBySession.of(getBootstrapSession())
}

function runInCapturedSession(
  captured: Session | undefined,
  fn: () => void,
): void {
  if (captured !== undefined && getActiveSessionFromAls() !== captured) {
    runWithSession(captured, fn)
  } else {
    fn()
  }
}

/** densable `M8` — wake at the earliest `leavesAt` or `heldAt + 30_000`. */
function scheduleExpiry(state: ToastSessionState, now: number): void {
  if (state.pendingExpiryTimer !== undefined) {
    clearTimeout(state.pendingExpiryTimer)
    state.pendingExpiryTimer = undefined
  }
  if (state.pausedAt !== undefined || state.items.length === 0) return
  let earliest = Infinity
  for (const item of state.items) {
    const wakeAt =
      (item.heldAt ?? item.leavesAt) + (item.heldAt === undefined ? 0 : HOLD_MS)
    if (wakeAt < earliest) earliest = wakeAt
  }
  if (!Number.isFinite(earliest)) return
  const captured = getActiveSessionFromAls()
  state.pendingExpiryTimer = setTimeout(
    () => {
      state.pendingExpiryTimer = undefined
      runInCapturedSession(captured, () => {
        expireToastsInState(state, Date.now())
      })
    },
    Math.max(1, earliest - now),
  )
  state.pendingExpiryTimer.unref?.()
}

function publish(
  state: ToastSessionState,
  next: ToastItem[],
  now = Date.now(),
): void {
  state.items = next
  for (const [listener, captured] of state.listeners) {
    runInCapturedSession(captured, listener)
  }
  scheduleExpiry(state, now)
}

export function subscribeToasts(listener: () => void): () => void {
  const state = getToastState()
  const captured = getActiveSessionFromAls()
  state.listeners.set(listener, captured)
  return () => {
    state.listeners.delete(listener)
  }
}

export function getToasts(): ToastItem[] {
  return getToastState().items
}

/** densable `pRe` — push a stacked plugin toast (`$.ui.toast`). */
export function pushToast(
  id: string,
  text: string,
  plugin?: string,
  timeoutMs = HOLD_MS,
): void {
  const state = getToastState()
  const now = Date.now()
  const next: ToastItem[] = [
    ...state.items,
    {
      id: id || randomUUID(),
      plugin,
      text,
      phase: 'shown',
      shownAt: now,
      leavesAt: (state.pausedAt ?? now) + timeoutMs,
    },
  ]
  publish(
    state,
    next.length > TOAST_STACK_MAX ? next.slice(-TOAST_STACK_MAX) : next,
  )
}

function toastIdFor(state: ToastSessionState, key: string): string | undefined {
  for (let index = state.items.length - 1; index >= 0; index--) {
    const item = state.items[index]
    if (item !== undefined && item.id === key) return item.id
  }
  return undefined
}

export function holdToastItem(key: string, held: boolean): void {
  const state = getToastState()
  const id = toastIdFor(state, key)
  if (id === undefined) return
  const now = Date.now()
  let changed = false
  const next = state.items.map(item => {
    if (item.id !== id || (item.heldAt !== undefined) === held) return item
    changed = true
    if (held) return { ...item, phase: 'shown' as const, heldAt: now }
    const extra = item.heldAt === undefined ? 0 : now - item.heldAt
    return { ...item, heldAt: undefined, leavesAt: item.leavesAt + extra }
  })
  if (changed) publish(state, next, now)
}

/** Click removes the toast. Expiry is what enters `leaving`. */
export function dismissToastItem(key: string): void {
  const state = getToastState()
  const id = toastIdFor(state, key)
  if (id === undefined) return
  publish(
    state,
    state.items.filter(item => item.id !== id),
  )
}

export function pauseToasts(paused: boolean): void {
  const state = getToastState()
  const now = Date.now()
  if (paused) {
    if (state.pausedAt !== undefined) return
    state.pausedAt = now
    scheduleExpiry(state, now)
    return
  }
  if (state.pausedAt === undefined) return
  const extra = now - state.pausedAt
  state.pausedAt = undefined
  if (extra === 0) {
    scheduleExpiry(state, now)
    return
  }
  publish(
    state,
    state.items.map(item => ({
      ...item,
      leavesAt: item.leavesAt + extra,
      ...(item.heldAt !== undefined ? { heldAt: item.heldAt + extra } : {}),
    })),
    now,
  )
}

function expireToastsInState(state: ToastSessionState, now: number): void {
  const next = state.items
  let changed = false
  const stepped: ToastItem[] = []
  for (const item of next) {
    if (item.heldAt !== undefined && now - item.heldAt >= HOLD_MS) {
      changed = true
      stepped.push({
        ...item,
        heldAt: undefined,
        leavesAt: item.leavesAt + (now - item.heldAt),
      })
    } else {
      stepped.push(item)
    }
  }
  const kept: ToastItem[] = []
  for (const item of stepped) {
    const due = item.heldAt === undefined && item.leavesAt <= now
    if (due && item.phase === 'leaving') {
      changed = true
      continue
    }
    if (due) {
      changed = true
      kept.push({ ...item, phase: 'leaving', leavesAt: now + FADE_MS })
      continue
    }
    kept.push(item)
  }
  if (changed) publish(state, kept, now)
  else scheduleExpiry(state, now)
}

/**
 * densable expiry. A due toast enters `leaving` for 240ms instead of vanishing.
 * A hover that has lasted 30s is released first, then judged the same way.
 */
export function expireToasts(now: number): void {
  expireToastsInState(getToastState(), now)
}

export const PLUGIN_TOAST_KEY_PREFIX = 'plugin-toast-'

/**
 * Official 2.1.328 #622 (`dSl`): scope notification-bar toast keys by plugin
 * name (`plugin-toast-<plugin>:<id>`) so one plugin's toast can never collide
 * with or render another plugin's text.
 */
export function formatPluginToastKey(
  plugin: string | undefined,
  id: string,
): string {
  return plugin
    ? `${PLUGIN_TOAST_KEY_PREFIX}${plugin}:${id}`
    : `${PLUGIN_TOAST_KEY_PREFIX}${id}`
}

/**
 * Official 2.1.328 #622 (`EW`): extract the owning plugin name from a
 * plugin-scoped toast key (`plugin-toast-<plugin>:<id>`).
 */
export function parsePluginToastOwner(
  key: string | undefined,
): string | undefined {
  if (!key || !key.startsWith(PLUGIN_TOAST_KEY_PREFIX)) {
    return undefined
  }
  const rest = key.slice(PLUGIN_TOAST_KEY_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) return undefined
  return rest.slice(0, sep)
}

export function dropToast(id: string): void {
  const state = getToastState()
  publish(
    state,
    state.items.filter(item => item.id !== id),
  )
}
