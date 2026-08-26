/**
 * Official 2.1.207 ScrollBox high-water mark helpers.
 *
 * While the user has scrolled away from sticky-bottom, track the max content
 * height seen so a transient shrink (streaming markdown freeze / virtual
 * remount) does not clamp scrollTop downward and jump the transcript above
 * the answer start.
 */

export type ScrollHwmUpdate = {
  /** Height used for prev-max / stored-upper-clamp (prev or HWM). */
  referenceHeight: number
  /** Next scrollHeightHwm to store on the node (undefined clears). */
  nextHwm: number | undefined
}

/**
 * Compute HWM bookkeeping for one render frame.
 * sticky → clear HWM, reference = prev height only.
 * not sticky → reference = max(hwm, prev), nextHwm = max(reference, current).
 */
export function updateScrollHeightHwm(args: {
  sticky: boolean
  prevScrollHeight: number
  scrollHeight: number
  scrollHeightHwm?: number
}): ScrollHwmUpdate {
  const { sticky, prevScrollHeight, scrollHeight, scrollHeightHwm } = args
  if (sticky) {
    return { referenceHeight: prevScrollHeight, nextHwm: undefined }
  }
  const referenceHeight = Math.max(scrollHeightHwm ?? 0, prevScrollHeight)
  return {
    referenceHeight,
    nextHwm: Math.max(referenceHeight, scrollHeight),
  }
}

/**
 * Whether this frame should pin scrollTop to the new maxScroll.
 * Mirrors official:
 *   sticky || (stickyAttr !== false && followGrowth && grew && atPrevMax)
 * with pendingScrollDelta >= 0 guard applied by the caller.
 */
export function shouldFollowScrollGrowth(args: {
  sticky: boolean
  /** Raw attributes.stickyScroll — undefined means not explicitly false. */
  stickyAttr: unknown
  followGrowth: boolean
  grew: boolean
  scrollTop: number
  prevMaxAgainstHwm: number
}): boolean {
  const {
    sticky,
    stickyAttr,
    followGrowth,
    grew,
    scrollTop,
    prevMaxAgainstHwm,
  } = args
  if (sticky) return true
  // stickyAttr !== false: undefined/true allow positional follow; explicit
  // false (stickyScroll={false}) never auto-follows growth.
  return (
    stickyAttr !== false &&
    followGrowth &&
    grew &&
    scrollTop >= prevMaxAgainstHwm
  )
}

/** Upper clamp for *stored* scrollTop — may exceed content maxScroll via HWM. */
export function clampStoredScrollTop(
  scrollTop: number,
  maxScroll: number,
  referenceHeight: number,
  viewportHeight: number,
): number {
  const upper = Math.max(maxScroll, referenceHeight - viewportHeight)
  return Math.max(0, Math.min(scrollTop, upper))
}

/** Paint-time scrollTop never exceeds real content maxScroll. */
export function clampVisualScrollTop(
  scrollTop: number,
  maxScroll: number,
): number {
  return Math.max(0, Math.min(scrollTop, maxScroll))
}

/**
 * Virtual-list mounted-range clamp (ScrollBox.scrollClampMin/Max).
 * Skip when sticky: leftover bounds from a prior scrolled-up range would
 * paint into topSpacer while isSticky() is still true (no Jump-to-bottom
 * pill) — empty transcript with the logo pinned at y=0.
 */
export function applyVirtualScrollRangeClamp(
  visualScrollTop: number,
  clampMin: number | undefined,
  clampMax: number | undefined,
  sticky: boolean,
): number {
  if (sticky) return visualScrollTop
  if (clampMin === undefined || clampMax === undefined) {
    return visualScrollTop
  }
  return Math.max(clampMin, Math.min(visualScrollTop, clampMax))
}

/**
 * scrollBy base: clamp scrollTop to current content max before accumulating
 * pending delta (official pQe). Prevents double-overscroll when HWM held
 * stored scrollTop above content.
 */
export function clampScrollTopToContentMax(
  scrollTop: number,
  scrollHeight: number | undefined,
  viewportHeight: number | undefined,
): number {
  if (scrollHeight === undefined) return scrollTop
  const maxScroll = Math.max(0, scrollHeight - (viewportHeight ?? 0))
  return Math.min(scrollTop, maxScroll)
}

/**
 * scrollToElement block:"nearest" — keep element in view without jumping
 * when already fully visible.
 */
export function resolveNearestScrollTop(args: {
  currentScrollTop: number
  elementTop: number
  elementHeight: number
  viewportHeight: number
  offset?: number
}): number {
  const {
    currentScrollTop,
    elementTop,
    elementHeight,
    viewportHeight,
    offset = 0,
  } = args
  const alignTop = elementTop + offset
  const alignBottom = elementTop + elementHeight - viewportHeight
  // min(max(current, bottomAlign), topAlign) keeps current if already in range
  return Math.min(Math.max(currentScrollTop, alignBottom), alignTop)
}
