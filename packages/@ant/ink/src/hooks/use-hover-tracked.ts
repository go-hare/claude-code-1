import { useContext, useSyncExternalStore } from 'react'
import AlternateScreenHoverContext from '../components/AlternateScreenHoverContext.js'
import AppContext from '../components/AppContext.js'

const noopSubscribe = (): (() => void) => () => {}
const returnFalse = (): boolean => false

/**
 * densable `ao` — `ke(TTt) ?? Pt(subscribeHoverTracked, isHoverTracked)`.
 */
export function useHoverTracked(): boolean {
  const overlay = useContext(AlternateScreenHoverContext)
  const { subscribeHoverTracked, isHoverTracked } = useContext(AppContext)
  const fromApp = useSyncExternalStore(
    subscribeHoverTracked ?? noopSubscribe,
    isHoverTracked ?? returnFalse,
  )
  return overlay ?? fromApp
}
