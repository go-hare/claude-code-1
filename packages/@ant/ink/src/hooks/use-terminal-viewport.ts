import { useCallback, useContext, useLayoutEffect, useRef } from 'react'
import { TerminalSizeContext } from '../components/TerminalSizeContext.js'
import type { DOMElement } from '../core/dom.js'
import { LayoutEdge } from '../core/layout/node.js'
import { clampScrollTopToContentMax } from '../core/scrollHeightHwm.js'

type ViewportEntry = {
  /**
   * Whether the element is currently within the terminal viewport
   */
  isVisible: boolean
}

type TerminalSize = {
  rows: number
}

/**
 * densable 2.1.246 `HS`: visibility walk must clamp scrollTop to content max.
 * Unclamped HWM overscroll flips isVisible every commit.
 */
function readClampedScrollTop(node: DOMElement): number {
  return clampScrollTopToContentMax(
    node.scrollTop ?? 0,
    node.scrollHeight,
    node.scrollViewportHeight,
  )
}

/**
 * densable 2.1.246 `ER(e, o)`: Yoga absolute top (screen rows) minus clamped
 * ScrollBox scrollTop. Returns null when the node is unmeasurable.
 *
 * Height 0 uses `top >= viewportY` (not `bottom > viewportY`) so an empty
 * box sitting on the viewport edge is still visible.
 */
export function computeElementViewportVisibility(
  element: DOMElement | null | undefined,
  size: TerminalSize | null | undefined,
): boolean | null {
  if (!element?.yogaNode || !size) {
    return null
  }

  const height = element.yogaNode.getComputedHeight()
  const rows = size.rows

  // Walk the DOM parent chain (not yoga.getParent()) so we can detect
  // scroll containers and subtract their scrollTop. Yoga computes layout
  // positions without scroll offset — scrollTop is applied at render time.
  let absoluteTop = element.yogaNode.getComputedTop()
  let parent: DOMElement | undefined = element.parentNode
  let root = element.yogaNode
  while (parent) {
    if (parent.yogaNode) {
      absoluteTop += parent.yogaNode.getComputedTop()
      root = parent.yogaNode
    }
    // densable Ze: overflowY/overflow scroll && scrollTopRendered===void 0 → null
    const overflowY = parent.style?.overflowY ?? parent.style?.overflow
    if (overflowY === 'scroll' && parent.scrollTopRendered === undefined) {
      return null
    }
    // densable Ze: if (m.scrollTop) c -= Ite(m)
    if (parent.scrollTop) absoluteTop -= readClampedScrollTop(parent)
    parent = parent.parentNode
  }

  const screenHeight = root.getComputedHeight()
  const bottom = absoluteTop + height
  const cursorRestoreScroll = screenHeight > rows ? 1 : 0
  const viewportY = Math.max(0, screenHeight - rows) + cursorRestoreScroll
  const viewportBottom = viewportY + rows
  if (height === 0) {
    return absoluteTop >= viewportY && absoluteTop < viewportBottom
  }
  return bottom > viewportY && absoluteTop < viewportBottom
}

/**
 * Official 2.1.328 `gN(element)` — true when any scroll ancestor's cached
 * `scrollHeight` disagrees with its direct child's live Yoga height (layout
 * grew/shrunk since the last paint, so `scrollTopRendered` is stale).
 */
function hasStaleScrollHeight(element: DOMElement): boolean {
  let child: DOMElement = element
  for (let parent = element.parentNode; parent; parent = parent.parentNode) {
    if (!parent.yogaNode) continue
    const overflowY = parent.style?.overflowY ?? parent.style?.overflow
    if (
      overflowY === 'scroll' &&
      parent.scrollHeight !== undefined &&
      child.yogaNode?.getComputedHeight() !== parent.scrollHeight
    ) {
      return true
    }
    child = parent
  }
  return false
}

/**
 * Official 2.1.328 `xN(element, size)` — strict viewport visibility that
 * intersects vertical bounds against every ancestor `overflow: scroll` /
 * `overflow: hidden` clip box (accounting for border/padding insets and
 * `scrollTopRendered`).
 *
 * Returns `true` when visible within both the terminal viewport and all
 * ancestor clip bounds, `false` when outside the terminal viewport, or `null`
 * when unmeasurable / stale scrollHeight / clipped out by an ancestor.
 */
export function computeElementClippedViewportVisibility(
  element: DOMElement | null | undefined,
  size: TerminalSize | null | undefined,
): boolean | null {
  if (element && hasStaleScrollHeight(element)) {
    return null
  }
  const baseVisible = computeElementViewportVisibility(element, size)
  if (!baseVisible || !element?.yogaNode) {
    return baseVisible
  }

  let top = element.yogaNode.getComputedTop()
  let bottom = top + Math.max(element.yogaNode.getComputedHeight(), 1)
  let child: DOMElement = element
  let grandChild: DOMElement | undefined

  for (let parent = element.parentNode; parent; parent = parent.parentNode) {
    if (!parent.yogaNode) continue
    const overflowY = parent.style?.overflowY ?? parent.style?.overflow
    if (overflowY === 'hidden' || overflowY === 'scroll') {
      const scrollOffset = parent.scrollTopRendered ?? 0
      const borderTop =
        typeof parent.yogaNode.getComputedBorder === 'function'
          ? parent.yogaNode.getComputedBorder(LayoutEdge.Top)
          : 0
      const borderBottomInset =
        typeof parent.yogaNode.getComputedBorder === 'function'
          ? parent.yogaNode.getComputedBorder(LayoutEdge.Bottom)
          : 0
      const borderBottom =
        parent.yogaNode.getComputedHeight() - borderBottomInset
      if (overflowY === 'scroll' && child.yogaNode && grandChild?.yogaNode) {
        const paddingTop =
          typeof parent.yogaNode.getComputedPadding === 'function'
            ? parent.yogaNode.getComputedPadding(LayoutEdge.Top)
            : 0
        const paddingBottom =
          typeof parent.yogaNode.getComputedPadding === 'function'
            ? parent.yogaNode.getComputedPadding(LayoutEdge.Bottom)
            : 0
        const itemTop =
          child.yogaNode.getComputedTop() +
          grandChild.yogaNode.getComputedTop() -
          scrollOffset
        const itemHeight = Math.max(grandChild.yogaNode.getComputedHeight(), 1)
        if (
          itemTop + itemHeight <= borderTop + paddingTop ||
          itemTop >= borderBottom - paddingBottom
        ) {
          return null
        }
      }
      top = Math.max(top - scrollOffset, borderTop)
      bottom = Math.min(bottom - scrollOffset, borderBottom)
      if (top >= bottom) {
        return null
      }
    }
    top += parent.yogaNode.getComputedTop()
    bottom += parent.yogaNode.getComputedTop()
    grandChild = child
    child = parent
  }

  return true
}

/**
 * Hook to detect if a component is within the terminal viewport.
 *
 * Official 2.1.328 `bH` returns `[ref, entry, recompute, pureCheck, unclippedCheck]`:
 * - recompute: update entry ref + return current visibility (NO setState)
 * - pureCheck: clipped visibility (`xN`, intersects ScrollBox / overflow:hidden bounds)
 * - unclippedCheck: unclipped terminal viewport check (`Ep`)
 *
 * Official does not setState on visibility flip. A local epoch/notify
 * path caused Maximum update depth under MessagesBoundary on large resumes.
 *
 * @example
 * const [ref, entry] = useTerminalViewport()
 * return <Box ref={ref}><Animation enabled={entry.isVisible}>...</Animation></Box>
 */
export function useTerminalViewport(): [
  ref: (element: DOMElement | null) => void,
  entry: ViewportEntry,
  recompute: () => boolean,
  pureCheck: () => boolean | null,
  unclippedCheck: () => boolean | null,
] {
  const terminalSize = useContext(TerminalSizeContext)
  const elementRef = useRef<DOMElement | null>(null)
  const entryRef = useRef<ViewportEntry>({ isVisible: true })
  // densable a.current=e: latest terminalSize without stale recompute deps.
  const terminalSizeRef = useRef(terminalSize)
  terminalSizeRef.current = terminalSize

  const setElement = useCallback((el: DOMElement | null) => {
    elementRef.current = el
    // densable QV: h===null && !l.current.isVisible → isVisible:!0
    if (el === null && !entryRef.current.isVisible) {
      entryRef.current = { isVisible: true }
    }
  }, [])

  // densable D0 `s()` — ref-only; never setState.
  const recompute = useCallback((): boolean => {
    const visible = computeElementViewportVisibility(
      elementRef.current,
      terminalSizeRef.current,
    )
    if (visible === null) {
      return entryRef.current.isVisible
    }
    if (visible !== entryRef.current.isVisible) {
      entryRef.current = { isVisible: visible }
    }
    return visible
  }, [])

  // Official 2.1.328 `bH` index 3 (`xN`) — clipped visibility check.
  const pureCheck = useCallback((): boolean | null => {
    return computeElementClippedViewportVisibility(
      elementRef.current,
      terminalSizeRef.current,
    )
  }, [])

  // Official 2.1.328 `bH` index 4 (`Ep`) — unclipped viewport visibility check.
  const unclippedCheck = useCallback((): boolean | null => {
    return computeElementViewportVisibility(
      elementRef.current,
      terminalSizeRef.current,
    )
  }, [])

  // densable D0 `CR(()=>{s()})` — yoga can change without React knowing.
  useLayoutEffect(() => {
    recompute()
  })

  return [setElement, entryRef.current, recompute, pureCheck, unclippedCheck]
}
