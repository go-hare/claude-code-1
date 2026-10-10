import { useLayoutEffect, type RefObject } from 'react'
import type { DOMElement } from '../core/dom.js'
import { getFocusManager } from '../core/focus.js'

type FocusHost = {
  activeElement: DOMElement | null
  focus: (node: DOMElement) => void
}

/**
 * Gold Yt / rfo nR `d()`:
 * reclaim when activeElement is null or an ancestor. Never steal a descendant.
 */
export function reclaimIfNullOrAncestor(fm: FocusHost, node: DOMElement): void {
  if (fm.activeElement === node) return
  if (!fm.activeElement) {
    fm.focus(node)
    return
  }
  let parent = node.parentNode
  while (parent) {
    if (parent === fm.activeElement) {
      fm.focus(node)
      return
    }
    parent = parent.parentNode
  }
}

/**
 * Official densable 2.1.289 rfo `nR` (Xt layout):
 *
 * When active, claim FocusManager focus and subscribe to reclaim when:
 * - activeElement becomes null, or
 * - activeElement is an ancestor of this node (parent tabIndex steal)
 *
 * Gold Yt inlines the same `d()` without the mount `focus(self)` — a
 * focused descendant (prompt tabIndex 0) must stay. Do not pass Yt
 * through this hook (parent layout runs after the child).
 *
 * Without this, dispatchKeyboardEvent / dispatchPasteEvent target root
 * and BaseTextInput onKeyDown/onPaste never fire.
 */
export function useFocusReclaim(
  ref: RefObject<DOMElement | null>,
  isActive: boolean,
  blurWhenInactive = false,
): void {
  useLayoutEffect(() => {
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
      if (!current) return
      reclaimIfNullOrAncestor(fm, current)
    })
  }, [isActive, ref, blurWhenInactive])
}
