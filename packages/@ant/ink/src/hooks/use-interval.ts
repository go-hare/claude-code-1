import { useCallback, useContext, useRef, useSyncExternalStore } from 'react'
import {
  ClockContext,
  snapClockIntervalMs,
} from '../components/ClockContext.js'

/** densable `eLe`. */
const noopSubscribe = (): (() => void) => () => {}
/** densable `TDn`. */
const nullSnapshot = (): null => null

/**
 * densable `pDn` — follower clock, quantized.
 *
 * Gold: `subscribeFollower` + `Math.floor(u.current/l)*l`.
 */
export function useAnimationTimer(intervalMs: number | null): number {
  const clock = useContext(ClockContext)
  const snapped = intervalMs === null ? null : snapClockIntervalMs(intervalMs)
  const lastRef = useRef<number | null>(null)
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!clock || snapped === null) return noopSubscribe()
      return clock.subscribeFollower(() => {
        lastRef.current = clock.now()
        onStoreChange()
      })
    },
    [clock, snapped],
  )
  return useSyncExternalStore(subscribe, () => {
    if (!clock || snapped === null) {
      lastRef.current = null
      return 0
    }
    if (lastRef.current === null) lastRef.current = clock.now()
    return Math.floor(lastRef.current / snapped) * snapped
  })
}

/**
 * densable `gi` / `uhe` — clock `setTimeout` loop, not a keepAlive tick.
 *
 * Gold: `Pt(C, TDn)` with `l?.immediate??!1`.
 */
export function useInterval(
  callback: () => void,
  intervalMs: number | null,
  options?: { immediate?: boolean },
): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const clock = useContext(ClockContext)
  const immediate = options?.immediate ?? false
  const armedRef = useRef<number | null>(null)
  const subscribe = useCallback(
    (_onStoreChange: () => void) => {
      if (!clock || intervalMs === null) {
        armedRef.current = null
        return () => {}
      }
      if (immediate && armedRef.current === null) callbackRef.current()
      armedRef.current = intervalMs
      return startClockTimeoutLoop(
        clock,
        () => callbackRef.current(),
        intervalMs,
      )
    },
    [clock, intervalMs, immediate],
  )
  useSyncExternalStore(subscribe, nullSnapshot)
}

/** densable `uhe`. */
function startClockTimeoutLoop(
  clock: { setTimeout: (callback: () => void, ms: number) => () => void },
  callback: () => void,
  intervalMs: number,
): () => void {
  let stopped = false
  let cancel = (): void => {}
  const tick = (): void => {
    if (stopped) return
    try {
      callback()
    } finally {
      if (!stopped) cancel = clock.setTimeout(tick, intervalMs)
    }
  }
  cancel = clock.setTimeout(tick, intervalMs)
  return () => {
    stopped = true
    cancel()
  }
}
