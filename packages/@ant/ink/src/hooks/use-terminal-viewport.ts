import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { TerminalSizeContext } from '../components/TerminalSizeContext.js'
import type { DOMElement } from '../core/dom.js'

type ViewportEntry = {
  /**
   * Whether the element is currently within the terminal viewport
   */
  isVisible: boolean
}

/**
 * Scroll / sticky-follow can move an element into view without re-rendering
 * the animated consumer (e.g. Spinner sits in FullscreenLayout.scrollable;
 * "Jump to bottom" remounts the virtual list but does not re-render Spinner).
 * useAnimationFrame freezes while isVisible=false and only re-subscribes on
 * re-render — so a pure scroll-into-view left the spinner frozen for seconds
 * until the next token/state push.
 *
 * ScrollBox notifies these watchers after imperative scroll so visibility can
 * flip and force a consumer re-render immediately.
 */
const scrollVisibilityWatchers = new Set<() => void>()

export function notifyScrollVisibilityWatchers(): void {
  for (const listener of scrollVisibilityWatchers) {
    listener()
  }
}

function subscribeScrollVisibility(listener: () => void): () => void {
  scrollVisibilityWatchers.add(listener)
  return () => {
    scrollVisibilityWatchers.delete(listener)
  }
}

/**
 * Yoga absolute top (screen rows) accounting for ScrollBox scrollTop.
 * Same walk as the previous inline layout effect — kept as a pure helper so
 * scroll-driven rechecks share one implementation with useLayoutEffect.
 */
export function computeElementViewportVisibility(
  element: DOMElement,
  terminalRows: number,
): boolean {
  if (!element.yogaNode) {
    return true
  }

  const height = element.yogaNode.getComputedHeight()
  const rows = terminalRows

  // Walk the DOM parent chain (not yoga.getParent()) so we can detect
  // scroll containers and subtract their scrollTop. Yoga computes layout
  // positions without scroll offset — scrollTop is applied at render time.
  // Without this, an element inside a ScrollBox whose yoga position exceeds
  // terminalRows would be considered offscreen even when scrolled into view
  // (e.g., the spinner in fullscreen mode after enough messages accumulate).
  let absoluteTop = element.yogaNode.getComputedTop()
  let parent: DOMElement | undefined = element.parentNode
  let root = element.yogaNode
  while (parent) {
    if (parent.yogaNode) {
      absoluteTop += parent.yogaNode.getComputedTop()
      root = parent.yogaNode
    }
    // scrollTop is only ever set on scroll containers (by ScrollBox + renderer).
    // Non-scroll nodes have undefined scrollTop → falsy fast-path.
    if (parent.scrollTop) absoluteTop -= parent.scrollTop
    parent = parent.parentNode
  }

  // Only the root's height matters
  const screenHeight = root.getComputedHeight()

  const bottom = absoluteTop + height
  // When content overflows the viewport (screenHeight > rows), the
  // cursor-restore at frame end scrolls one extra row into scrollback.
  // log-update.ts accounts for this with scrollbackRows = viewportY + 1.
  // We must match, otherwise an element at the boundary is considered
  // "visible" here (animation keeps ticking) but its row is treated as
  // scrollback by log-update (content change → full reset → flicker).
  const cursorRestoreScroll = screenHeight > rows ? 1 : 0
  const viewportY = Math.max(0, screenHeight - rows) + cursorRestoreScroll
  const viewportBottom = viewportY + rows
  return bottom > viewportY && absoluteTop < viewportBottom
}

/**
 * Hook to detect if a component is within the terminal viewport.
 *
 * densable YVe returns `[ref, entry, recompute, pureCheck]`:
 * - recompute: update entry + return current visibility (side-effecting)
 * - pureCheck: visibility without mutating entry (null when no yoga node)
 *
 * Visibility flips DO re-render the consumer (via an epoch state). That is
 * load-bearing for useAnimationFrame resume after "Jump to bottom" / scroll
 * into view — without it the offscreen-paused clock never re-subscribes.
 * Flip-only setState avoids the infinite layout loops the old ref-only design
 * was protecting against.
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
  // Epoch bumps only when isVisible flips — forces useAnimationFrame (and
  // other consumers) to re-render and re-subscribe to the animation clock.
  const [, setVisibilityEpoch] = useState(0)
  // densable a.current=e: pureCheck reads latest terminalSize without
  // closing over a stale recompute dependency.
  const terminalSizeRef = useRef(terminalSize)
  terminalSizeRef.current = terminalSize

  const setElement = useCallback((el: DOMElement | null) => {
    elementRef.current = el
  }, [])

  // densable o() — recompute with side effect; returns current visibility.
  const recompute = useCallback((): boolean => {
    const element = elementRef.current
    const size = terminalSizeRef.current
    if (!element?.yogaNode || !size) {
      return entryRef.current.isVisible
    }

    const visible = computeElementViewportVisibility(element, size.rows)
    if (visible !== entryRef.current.isVisible) {
      entryRef.current = { isVisible: visible }
      setVisibilityEpoch(n => n + 1)
    }
    return visible
  }, [])

  // densable l() — pure F_u without mutating entry; null when unmeasurable.
  const pureCheck = useCallback((): boolean | null => {
    const element = elementRef.current
    const size = terminalSizeRef.current
    if (!element?.yogaNode || !size) {
      return null
    }
    return computeElementViewportVisibility(element, size.rows)
  }, [])

  // Runs on every render because yoga layout values can change
  // without React being aware. Flip-only setState (above) keeps this safe.
  useLayoutEffect(() => {
    recompute()
  })

  // Imperative scroll (pill / PgDn / wheel) mutates scrollTop without
  // re-rendering this consumer — recheck immediately after ScrollBox notify.
  useEffect(
    () =>
      subscribeScrollVisibility(() => {
        recompute()
      }),
    [recompute],
  )

  return [setElement, entryRef.current, recompute, pureCheck]
}
