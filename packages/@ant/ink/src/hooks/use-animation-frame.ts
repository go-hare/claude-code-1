import { useContext, useRef, useSyncExternalStore } from 'react'
import {
  ClockContext,
  snapClockIntervalMs,
} from '../components/ClockContext.js'
import TerminalFocusContext from '../components/TerminalFocusContext.js'
import type { DOMElement } from '../core/dom.js'
import { useTerminalViewport } from './use-terminal-viewport.js'

/** densable `eLe`. */
const noopSubscribe = (): (() => void) => () => {}

/**
 * densable `Ji` — keepAlive clock + viewport pause.
 *
 * Gold: `Pt(v?r.subscribeKeepAlive:eLe, ()=>v?S.current=Math.max(S.current,Math.floor(r.now()/h)*h):S.current)`.
 */
export function useAnimationFrame(
  intervalMs: number | null = 16,
): [ref: (element: DOMElement | null) => void, time: number] {
  const clock = useContext(ClockContext)
  const [viewportRef, { isVisible }, recompute] = useTerminalViewport()
  const { terminalFocusState } = useContext(TerminalFocusContext)
  const prevFocusRef = useRef(terminalFocusState)
  let visible = isVisible
  if (prevFocusRef.current !== terminalFocusState) {
    prevFocusRef.current = terminalFocusState
    visible = recompute()
  }
  const active = !!clock && visible && intervalMs !== null
  const snapped = intervalMs === null ? null : snapClockIntervalMs(intervalMs)
  const lastRef = useRef(0)
  const time = useSyncExternalStore(
    active && clock ? clock.subscribeKeepAlive : noopSubscribe,
    () => {
      if (active && clock && snapped !== null) {
        lastRef.current = Math.max(
          lastRef.current,
          Math.floor(clock.now() / snapped) * snapped,
        )
      }
      return lastRef.current
    },
  )
  return [viewportRef, time]
}
