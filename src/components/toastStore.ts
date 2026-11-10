import { randomUUID } from 'crypto'

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
let items: ToastItem[] = []
let pausedAt: number | undefined
let pendingExpiryTimer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

/** densable `M8` — wake at the earliest `leavesAt` or `heldAt + 30_000`. */
function scheduleExpiry(now: number): void {
  if (pendingExpiryTimer !== undefined) {
    clearTimeout(pendingExpiryTimer)
    pendingExpiryTimer = undefined
  }
  if (pausedAt !== undefined || items.length === 0) return
  let earliest = Infinity
  for (const item of items) {
    const wakeAt =
      (item.heldAt ?? item.leavesAt) + (item.heldAt === undefined ? 0 : HOLD_MS)
    if (wakeAt < earliest) earliest = wakeAt
  }
  if (!Number.isFinite(earliest)) return
  pendingExpiryTimer = setTimeout(
    () => {
      pendingExpiryTimer = undefined
      expireToasts(Date.now())
    },
    Math.max(1, earliest - now),
  )
  pendingExpiryTimer.unref?.()
}

function publish(next: ToastItem[], now = Date.now()): void {
  items = next
  for (const listener of listeners) listener()
  scheduleExpiry(now)
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getToasts(): ToastItem[] {
  return items
}

/** densable `pRe` — push a stacked plugin toast (`$.ui.toast`). */
export function pushToast(
  id: string,
  text: string,
  plugin?: string,
  timeoutMs = HOLD_MS,
): void {
  const now = Date.now()
  const next: ToastItem[] = [
    ...items,
    {
      id: id || randomUUID(),
      plugin,
      text,
      phase: 'shown',
      shownAt: now,
      leavesAt: (pausedAt ?? now) + timeoutMs,
    },
  ]
  publish(next.length > TOAST_STACK_MAX ? next.slice(-TOAST_STACK_MAX) : next)
}

function toastIdFor(key: string): string | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item !== undefined && item.id === key) return item.id
  }
  return undefined
}

export function holdToastItem(key: string, held: boolean): void {
  const id = toastIdFor(key)
  if (id === undefined) return
  const now = Date.now()
  let changed = false
  const next = items.map(item => {
    if (item.id !== id || (item.heldAt !== undefined) === held) return item
    changed = true
    if (held) return { ...item, phase: 'shown' as const, heldAt: now }
    const extra = item.heldAt === undefined ? 0 : now - item.heldAt
    return { ...item, heldAt: undefined, leavesAt: item.leavesAt + extra }
  })
  if (changed) publish(next, now)
}

/** Click removes the toast. Expiry is what enters `leaving`. */
export function dismissToastItem(key: string): void {
  const id = toastIdFor(key)
  if (id === undefined) return
  publish(items.filter(item => item.id !== id))
}

export function pauseToasts(paused: boolean): void {
  const now = Date.now()
  if (paused) {
    if (pausedAt !== undefined) return
    pausedAt = now
    scheduleExpiry(now)
    return
  }
  if (pausedAt === undefined) return
  const extra = now - pausedAt
  pausedAt = undefined
  if (extra === 0) {
    scheduleExpiry(now)
    return
  }
  publish(
    items.map(item => ({
      ...item,
      leavesAt: item.leavesAt + extra,
      ...(item.heldAt !== undefined ? { heldAt: item.heldAt + extra } : {}),
    })),
    now,
  )
}

/**
 * densable expiry. A due toast enters `leaving` for 240ms instead of vanishing.
 * A hover that has lasted 30s is released first, then judged the same way.
 */
export function expireToasts(now: number): void {
  const next = items
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
  if (changed) publish(kept, now)
  else scheduleExpiry(now)
}

export function dropToast(id: string): void {
  publish(items.filter(item => item.id !== id))
}
