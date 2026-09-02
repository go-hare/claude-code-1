/**
 * densable Bne analog for nau ax-bell.
 *
 * Gold 2.1.239: `Bne.of(host).claimIfChanged("ax-bell", dialogId)` then
 * `aAr()` (`lastBellAt` / `Jt0=500` + `notifyBell`). Local has no Ink
 * WeakMap host bag — process singleton. Do not invent a host API.
 */

export const AX_BELL_CLAIM_KEY = 'ax-bell'

/** densable Jt0 */
export const AX_BELL_THROTTLE_MS = 500

type AxBellBag = {
  claims: Map<string, string>
  lastBellAt: number
}

const bag: AxBellBag = {
  claims: new Map(),
  lastBellAt: 0,
}

/**
 * densable Bne.claimIfChanged — first value per key wins until it changes.
 */
export function claimIfChanged(key: string, value: string): boolean {
  const prev = bag.claims.get(key)
  if (prev === value) return false
  bag.claims.set(key, value)
  return true
}

/**
 * densable aAr lastBellAt throttle. Returns true if the bell may fire.
 */
export function noteAxBellNow(now = Date.now()): boolean {
  if (now - bag.lastBellAt < AX_BELL_THROTTLE_MS) return false
  bag.lastBellAt = now
  return true
}

/** @internal test */
export function resetAxBellBagForTest(): void {
  bag.claims.clear()
  bag.lastBellAt = 0
}
