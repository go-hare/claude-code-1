import type { DOMElement } from './dom.js'
import { FocusEvent } from './events/focus-event.js'
import { nodeCache } from './node-cache.js'

const MAX_FOCUS_STACK = 32

export type FocusDirection = 'up' | 'down' | 'left' | 'right'

/**
 * DOM-like focus manager for the Ink terminal UI.
 *
 * Official densable 2.1.210 FocusManager:
 * - activeElement + focusStack + autoFocusStack
 * - subscribe/notify so inputs can reclaim focus (nR)
 * - Stored on the root DOMElement (like browser ownerDocument)
 */
export class FocusManager {
  activeElement: DOMElement | null = null
  private dispatchFocusEvent: (target: DOMElement, event: FocusEvent) => boolean
  private enabled = true
  private focusStack: DOMElement[] = []
  private autoFocusStack: DOMElement[] = []
  private listeners = new Set<() => void>()

  constructor(
    dispatchFocusEvent: (target: DOMElement, event: FocusEvent) => boolean,
  ) {
    this.dispatchFocusEvent = dispatchFocusEvent
  }

  /** Official: subscribe to focus changes (used by nR reclaim hook). */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  focus(node: DOMElement): void {
    if (node === this.activeElement) return
    if (!this.enabled) return

    const previous = this.activeElement
    if (previous) {
      // Deduplicate before pushing to prevent unbounded growth from Tab cycling
      const idx = this.focusStack.indexOf(previous)
      if (idx !== -1) this.focusStack.splice(idx, 1)
      this.focusStack.push(previous)
      if (this.focusStack.length > MAX_FOCUS_STACK) this.focusStack.shift()
      this.dispatchFocusEvent(previous, new FocusEvent('blur', node))
    }
    this.activeElement = node
    this.dispatchFocusEvent(node, new FocusEvent('focus', previous))
    this.notify()
  }

  blur(): void {
    if (!this.activeElement) return

    const previous = this.activeElement
    this.activeElement = null
    this.dispatchFocusEvent(previous, new FocusEvent('blur', null))
    this.notify()
  }

  /**
   * Called by the reconciler when a node is removed from the tree.
   * Handles both the exact node and any focused descendant within
   * the removed subtree. Dispatches blur and restores focus from stack.
   */
  handleNodeRemoved(node: DOMElement, root: DOMElement): void {
    // Remove the node and any descendants from the stack
    this.focusStack = this.focusStack.filter(
      n => n !== node && isInTree(n, root),
    )
    this.autoFocusStack = this.autoFocusStack.filter(
      n => n !== node && isInTree(n, root),
    )

    // Check if activeElement is the removed node OR a descendant
    if (!this.activeElement) return
    if (this.activeElement !== node && isInTree(this.activeElement, root)) {
      return
    }

    const removed = this.activeElement
    this.activeElement = null
    this.dispatchFocusEvent(removed, new FocusEvent('blur', null))

    // Restore focus to the most recent still-mounted element
    while (this.focusStack.length > 0) {
      const candidate = this.focusStack.pop()!
      if (isInTree(candidate, root)) {
        this.activeElement = candidate
        this.dispatchFocusEvent(candidate, new FocusEvent('focus', removed))
        this.notify()
        return
      }
    }

    // Official densable: fall back to last autoFocus node
    const auto = this.autoFocusStack.at(-1)
    if (auto && isInTree(auto, root)) {
      this.activeElement = auto
      this.dispatchFocusEvent(auto, new FocusEvent('focus', removed))
    }
    this.notify()
  }

  /** Official pushAutoFocusFallback — track autoFocus nodes for restore. */
  pushAutoFocusFallback(node: DOMElement): void {
    if (this.autoFocusStack.at(-1) === node) return
    const idx = this.autoFocusStack.indexOf(node)
    if (idx !== -1) this.autoFocusStack.splice(idx, 1)
    this.autoFocusStack.push(node)
    if (this.autoFocusStack.length > MAX_FOCUS_STACK)
      this.autoFocusStack.shift()
  }

  handleAutoFocus(node: DOMElement): void {
    this.pushAutoFocusFallback(node)
    this.focus(node)
  }

  handleClickFocus(node: DOMElement): void {
    const tabIndex = node.attributes['tabIndex']
    if (typeof tabIndex !== 'number') return
    this.focus(node)
  }

  enable(): void {
    this.enabled = true
  }

  disable(): void {
    this.enabled = false
  }

  focusNext(root: DOMElement): void {
    this.moveFocus(1, root)
  }

  focusPrevious(root: DOMElement): void {
    this.moveFocus(-1, root)
  }

  /**
   * densable `focusDirection` @193174703 — spatial directional focus transfer.
   */
  focusDirection(direction: FocusDirection, root: DOMElement): boolean {
    if (!this.enabled) return false
    if (!this.activeElement) {
      this.moveFocus(1, root)
      return true
    }
    const fromRect = resolveFocusRect(this.activeElement)
    if (!fromRect) return false
    let best: DOMElement | null = null
    let bestDist = Number.POSITIVE_INFINITY
    for (const candidate of collectTabbable(root)) {
      if (isInTree(this.activeElement, candidate)) continue
      const candidateRect = resolveFocusRect(candidate)
      if (!candidateRect) continue
      const dist = spatialFocusDistance(fromRect, candidateRect, direction)
      if (dist < bestDist) {
        bestDist = dist
        best = candidate
      }
    }
    if (best) {
      this.focus(best)
      return true
    }
    return false
  }

  private moveFocus(direction: 1 | -1, root: DOMElement): void {
    if (!this.enabled) return

    const tabbable = collectTabbable(root)
    if (tabbable.length === 0) return

    const currentIndex = this.activeElement
      ? tabbable.indexOf(this.activeElement)
      : -1

    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : tabbable.length - 1
        : (currentIndex + direction + tabbable.length) % tabbable.length

    const next = tabbable[nextIndex]
    if (next) {
      this.focus(next)
    }
  }
}

function collectTabbable(root: DOMElement): DOMElement[] {
  const result: DOMElement[] = []
  walkTree(root, result)
  return result
}

function walkTree(node: DOMElement, result: DOMElement[]): void {
  const tabIndex = node.attributes['tabIndex']
  if (typeof tabIndex === 'number' && tabIndex >= 0) {
    result.push(node)
  }

  for (const child of node.childNodes) {
    if (child.nodeName !== '#text') {
      walkTree(child, result)
    }
  }
}

function pointToSpanDistance(
  point: number,
  start: number,
  size: number,
): number {
  if (point < start) return start - point
  if (point > start + size) return point - (start + size)
  return 0
}

function spanOverlap(
  aStart: number,
  aSize: number,
  bStart: number,
  bSize: number,
): number {
  return Math.max(
    0,
    Math.min(aStart + aSize, bStart + bSize) - Math.max(aStart, bStart),
  )
}

function spatialFocusDistance(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
  direction: FocusDirection,
): number {
  const fromCenterX = from.x + from.width / 2
  const fromCenterY = from.y + from.height / 2
  const toCenterX = to.x + to.width / 2
  const toCenterY = to.y + to.height / 2
  const horizontal = direction === 'left' || direction === 'right'
  const sign = direction === 'right' || direction === 'down' ? 1 : -1
  const primary =
    (horizontal ? toCenterX - fromCenterX : toCenterY - fromCenterY) * sign
  if (primary <= 0) return Number.POSITIVE_INFINITY
  const crossGap = horizontal
    ? pointToSpanDistance(fromCenterY, to.y, to.height)
    : pointToSpanDistance(fromCenterX, to.x, to.width)
  const overlap = horizontal
    ? spanOverlap(from.y, from.height, to.y, to.height)
    : spanOverlap(from.x, from.width, to.x, to.width)
  return primary + (horizontal ? 2 : 0.5) * crossGap - overlap
}

function resolveFocusRect(
  node: DOMElement,
): { x: number; y: number; width: number; height: number } | undefined {
  const cached = node.cachedLayout ?? nodeCache.get(node)
  if (cached) return cached
  const yoga = node.yogaNode
  if (!yoga) return undefined
  let x = yoga.getComputedLeft()
  let y = yoga.getComputedTop()
  let parent = node.parentNode
  while (parent) {
    const parentCached = parent.cachedLayout ?? nodeCache.get(parent)
    if (parentCached) {
      return {
        x: parentCached.x + x,
        y: parentCached.y + y,
        width: yoga.getComputedWidth(),
        height: yoga.getComputedHeight(),
      }
    }
    if (parent.yogaNode) {
      x += parent.yogaNode.getComputedLeft()
      y += parent.yogaNode.getComputedTop()
    }
    parent = parent.parentNode
  }
  return undefined
}

export function isInTree(node: DOMElement, root: DOMElement): boolean {
  let current: DOMElement | undefined = node
  while (current) {
    if (current === root) return true
    current = current.parentNode
  }
  return false
}

/**
 * Walk up to root and return it. The root is the node that holds
 * the FocusManager — like browser's `node.getRootNode()`.
 */
export function getRootNode(node: DOMElement): DOMElement {
  let current: DOMElement | undefined = node
  while (current) {
    if (current.focusManager) return current
    current = current.parentNode
  }
  throw new Error('Node is not in a tree with a FocusManager')
}

/**
 * Walk up to root and return its FocusManager.
 * Like browser's `node.ownerDocument` — focus belongs to the root.
 * Official densable: `Bhe(node)`.
 */
export function getFocusManager(node: DOMElement): FocusManager {
  return getRootNode(node).focusManager!
}
