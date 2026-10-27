import { useCallback, useContext, useState } from 'react'
import { ClockContext, MOUNT_SETTLE_MS, type ClickEvent } from '@anthropic/ink'
import { logEvent } from '../../services/analytics/index.js'
import { logForDebugging } from '../../utils/debug.js'

/**
 * densable `c(o,n)=n-o<JDe` — `_Yn=300` mount settle shared by yln + est.
 */
export function isMountSettle(mountedAt: number, now: number): boolean {
  return now - mountedAt < MOUNT_SETTLE_MS
}

/**
 * densable `XLE` — window-activation click, or click inside `_Yn=300` ms of mount.
 */
export function isWindowActivationOrMountSettle(
  event: ClickEvent,
  mountedAt: number,
  now: number,
): boolean {
  return event.isWindowActivation || isMountSettle(mountedAt, now)
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
      // densable n_ — Select: dropped stray click + tengu_select_stray_click_dropped.
      const reason = event.isWindowActivation
        ? 'window-activation click'
        : `${now - mountedAt}ms after mount`
      logForDebugging(`Select: dropped stray click (${reason})`)
      logEvent('tengu_select_stray_click_dropped', {})
      event.dropAsStray()
      return true
    },
    [clock, mountedAt],
  )
}

/**
 * densable `$e` `est` — `FTt` `shouldDropWheel`.
 * Gold: `n-o<JDe` drops the wheel without scrolling or stopping.
 */
export function useShouldDropWheel(): () => boolean {
  const clock = useContext(ClockContext)
  const [mountedAt] = useState(() => clock?.now() ?? Date.now())
  return useCallback(
    () => isMountSettle(mountedAt, clock?.now() ?? Date.now()),
    [clock, mountedAt],
  )
}
