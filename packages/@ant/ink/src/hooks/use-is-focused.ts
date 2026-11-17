import { useContext, useSyncExternalStore, type RefObject } from 'react'
import AppContext from '../components/AppContext.js'
import type { DOMElement } from '../core/dom.js'
import { isInTree } from '../core/focus.js'

const noopSubscribe = () => () => {}

/** Gold h5: search mode follows the actual focused input, not a second flag. */
export function useIsFocused(ref: RefObject<DOMElement | null>): boolean {
  const { focusManager } = useContext(AppContext)
  return useSyncExternalStore(
    focusManager?.subscribe ?? noopSubscribe,
    () => {
      const node = ref.current
      const active = focusManager?.activeElement
      if (!node || !active) return false
      return isInTree(active, node)
    },
    () => false,
  )
}
