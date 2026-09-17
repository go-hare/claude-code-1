import { useCallback, useContext, useLayoutEffect, useRef } from 'react'
import { TerminalSizeContext } from '../components/TerminalSizeContext.js'
import type { DOMElement } from '../core/dom.js'
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
    // Official: if (u.scrollTop) s -= HS(u)
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
 * Hook to detect if a component is within the terminal viewport.
 *
 * densable 2.1.246 `D0` / YVe returns `[ref, entry, recompute, pureCheck]`:
 * - recompute: update entry ref + return current visibility (NO setState)
 * - pureCheck: visibility without mutating entry (null when no yoga node)
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
] {
  const terminalSize = useContext(TerminalSizeContext)
  const elementRef = useRef<DOMElement | null>(null)
  const entryRef = useRef<ViewportEntry>({ isVisible: true })
  // densable a.current=e: latest terminalSize without stale recompute deps.
  const terminalSizeRef = useRef(terminalSize)
  terminalSizeRef.current = terminalSize

  const setElement = useCallback((el: DOMElement | null) => {
    elementRef.current = el
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

  // densable D0 `h` — pure ER; null when unmeasurable.
  const pureCheck = useCallback((): boolean | null => {
    return computeElementViewportVisibility(
      elementRef.current,
      terminalSizeRef.current,
    )
  }, [])

  // densable D0 `CR(()=>{s()})` — yoga can change without React knowing.
  useLayoutEffect(() => {
    recompute()
  })

  return [setElement, entryRef.current, recompute, pureCheck]
}
