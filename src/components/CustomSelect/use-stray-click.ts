import { useCallback, useContext, useState } from 'react'
import { ClockContext, MOUNT_SETTLE_MS, type ClickEvent } from '@anthropic/ink'

/**
 * densable `XLE` — window-activation click, or click inside `_Yn=300` ms of mount.
 */
export function isWindowActivationOrMountSettle(
  event: ClickEvent,
  mountedAt: number,
  now: number,
): boolean {
  return event.isWindowActivation || now - mountedAt < MOUNT_SETTLE_MS
}

/**
 * densable `yln` — drop those clicks via `dropAsStray()` so Ink returns `"stray"`.
 *
 * Invent-ban leftover: official also logs
 * `Select: dropped stray click (…)` and `tengu_select_stray_click_dropped`.
 */
export function useStrayClickGuard(): (event: ClickEvent) => boolean {
  const clock = useContext(ClockContext)
  const [mountedAt] = useState(() => clock?.now() ?? Date.now())
  return useCallback(
    (event: ClickEvent) => {
      const now = clock?.now() ?? Date.now()
      if (!isWindowActivationOrMountSettle(event, mountedAt, now)) {
        return false
      }
      event.dropAsStray()
      return true
    },
    [clock, mountedAt],
  )
}
