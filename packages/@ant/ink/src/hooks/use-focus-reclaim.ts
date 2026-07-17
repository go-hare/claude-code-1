import { useEffect, type RefObject } from 'react'
import type { DOMElement } from '../core/dom.js'
import { getFocusManager } from '../core/focus.js'

/**
 * Official densable 2.1.210 `nR(ref, isActive, blurWhenInactive=false)`:
 *
 * When active, claim FocusManager focus and subscribe to reclaim when:
 * - activeElement becomes null, or
 * - activeElement is an ancestor of this node (focus landed on a parent)
 *
 * Without this, dispatchKeyboardEvent / dispatchPasteEvent target root
 * and BaseTextInput onKeyDown/onPaste never fire.
 */
export function useFocusReclaim(
  ref: RefObject<DOMElement | null>,
  isActive: boolean,
  blurWhenInactive = false,
): void {
  useEffect(() => {
    const node = ref.current
    if (!node) return

    let fm: ReturnType<typeof getFocusManager>
    try {
      fm = getFocusManager(node)
    } catch {
      return
    }

    if (!isActive) {
      if (blurWhenInactive && fm.activeElement === node) {
        fm.blur()
      }
      return
    }

    fm.focus(node)

    return fm.subscribe(() => {
      const current = ref.current
      if (!current || fm.activeElement === current) return
      if (!fm.activeElement) {
        fm.focus(current)
        return
      }
      // Reclaim if focus is on an ancestor (parent tabIndex steal).
      let parent = current.parentNode
      while (parent) {
        if (parent === fm.activeElement) {
          fm.focus(current)
          return
        }
        parent = parent.parentNode
      }
    })
  }, [isActive, ref, blurWhenInactive])
}
