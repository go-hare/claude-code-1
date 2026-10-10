import type { DOMElement } from './dom.js'
import { ClickEvent } from './events/click-event.js'
import type { EventHandlerProps } from './events/event-handlers.js'
import { MouseActionEvent } from './events/mouse-action-event.js'
import { MAX_TREE_DEPTH, warnTreeDepthExceeded } from './maxTreeDepth.js'
import { nodeCache } from './node-cache.js'
import { isEmptyCellAt, type Screen } from './screen.js'

/**
 * Find the deepest DOM element whose rendered rect contains (col, row).
 *
 * Uses the nodeCache populated by renderNodeToOutput — rects are in screen
 * coordinates with all offsets (including scrollTop translation) already
 * applied. Children are traversed in reverse so later siblings (painted on
 * top) win. Nodes not in nodeCache (not rendered this frame, or lacking a
 * yogaNode) are skipped along with their subtrees.
 *
 * densable 2.1.218 `bir` / `Zlt`: depth-capped to avoid call-stack overflow.
 *
 * Returns the hit node even if it has no onClick — dispatchClick walks up
 * via parentNode to find handlers.
 */
function hasAbsoluteDescendant(node: DOMElement): boolean {
  return Boolean(
    (node as DOMElement & { hasAbsoluteDescendant?: boolean })
      .hasAbsoluteDescendant,
  )
}

function rectContains(
  rect: { x: number; y: number; width: number; height: number },
  col: number,
  row: number,
): boolean {
  return (
    col >= rect.x &&
    col < rect.x + rect.width &&
    row >= rect.y &&
    row < rect.y + rect.height
  )
}

/**
 * densable 2.1.289 `R6(n,u,f,m=0)` — cachedLayout analog is nodeCache.
 * Uncached node → null (no child search). Absolute-descendant overflow
 * walk is gold; fork never stamps `hasAbsoluteDescendant` so that arm
 * stays closed unless a writer lands.
 */
export function hitTest(
  node: DOMElement,
  col: number,
  row: number,
  depth = 0,
): DOMElement | null {
  // densable bir: if (n>=Zlt) return yir("hitTest", e.nodeName), null
  if (depth >= MAX_TREE_DEPTH) {
    warnTreeDepthExceeded('hitTest', node.nodeName)
    return null
  }
  const y = nodeCache.get(node)
  if (!y) return null
  const g = rectContains(y, col, row)
  if (!g && !hasAbsoluteDescendant(node)) return null
  if (!g) {
    const overflowX = node.style.overflowX ?? node.style.overflow
    const overflowY = node.style.overflowY ?? node.style.overflow
    const clipX =
      (overflowX === 'hidden' || overflowX === 'scroll') &&
      (col < y.x || col >= y.x + y.width)
    const clipY =
      (overflowY === 'hidden' || overflowY === 'scroll') &&
      (row < y.y || row >= y.y + y.height)
    if (clipX || clipY) return null
  }
  let hit: DOMElement | null = null
  let absHit = false
  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const childNode = node.childNodes[i]!
    if (childNode.nodeName === '#text') continue
    const child = childNode as DOMElement
    const childRect = nodeCache.get(child)
    if (!childRect) continue
    const childContains = rectContains(childRect, col, row)
    if (!childContains && !hasAbsoluteDescendant(child)) continue
    if (hit !== null && childContains) continue
    const nested = hitTest(child, col, row, depth + 1)
    if (!nested) continue
    const fromAbs = !childContains
    if (hit === null || (fromAbs && !absHit)) {
      hit = nested
      absHit = fromAbs
    }
    if (absHit) break
  }
  return hit ?? (g ? node : null)
}

/**
 * densable `bvf` — bubble a pre-built ClickEvent. Resets `defaultAllowed`
 * per handler; a handler that calls `allowDefault()` does not count as
 * handled. `stopImmediatePropagation` returns `!defaultAllowed`.
 */
export function bubbleClick(
  root: DOMElement,
  event: ClickEvent,
  hit?: DOMElement | null,
): boolean {
  const { col, row } = event
  // densable dispatchMouseClick: R6 once, then listeners, then bubble.
  let target: DOMElement | undefined =
    hit !== undefined
      ? (hit ?? undefined)
      : (hitTest(root, col, row) ?? undefined)
  if (!target) return false

  // Click-to-focus: find the closest focusable ancestor and focus it.
  // root is always ink-root, which owns the FocusManager.
  if (root.focusManager) {
    let focusTarget: DOMElement | undefined = target
    while (focusTarget) {
      if (typeof focusTarget.attributes['tabIndex'] === 'number') {
        root.focusManager.handleClickFocus(focusTarget)
        break
      }
      focusTarget = focusTarget.parentNode
    }
  }
  let handled = false
  while (target) {
    const handler = target._eventHandlers?.onClick as
      | ((event: ClickEvent) => void)
      | undefined
    if (handler) {
      const rect = nodeCache.get(target)
      if (rect) {
        event.localCol = col - rect.x
        event.localRow = row - rect.y
      }
      event.defaultAllowed = false
      handler(event)
      if (event.didStopImmediatePropagation()) return !event.defaultAllowed
      if (!event.defaultAllowed) handled = true
    }
    target = target.parentNode
  }
  return handled
}

/**
 * densable `VC` — true if this node or an ancestor has onWheel.
 */
export function nodeHasWheelHandler(
  node: DOMElement | null | undefined,
): boolean {
  let walk: DOMElement | undefined = node ?? undefined
  while (walk) {
    if (walk._eventHandlers?.onWheel) return true
    walk = walk.parentNode
  }
  return false
}

function isDomElement(
  node: { parentNode?: unknown; attributes?: unknown } | null | undefined,
): node is DOMElement {
  // densable Zt: `o!==null&&"attributes"in o`
  return node != null && 'attributes' in node
}

/**
 * densable `eo` — Yt `onWheelCapture` skip: a descendant between `target`
 * and `currentTarget` owns onWheel, so do not synthesize wheelup/wheeldown
 * for the transcript ScrollKeybindingHandler.
 *
 * Gold: `while(r&&r!==l){if(r._eventHandlers?.onWheel&&(a===void 0||n===void 0||typeof r.attributes.tabIndex==="number"||R6(r,a,n)!==null))return!0;r=r.parentNode}`.
 */
export function wheelCaptureOwnedByDescendant(
  target: { parentNode?: unknown; attributes?: unknown } | null | undefined,
  currentTarget:
    | { parentNode?: unknown; attributes?: unknown }
    | null
    | undefined,
  col: number | undefined,
  row: number | undefined,
): boolean {
  let node: DOMElement | undefined = isDomElement(target) ? target : undefined
  const stop: DOMElement | undefined = isDomElement(currentTarget)
    ? currentTarget
    : undefined
  while (node && node !== stop) {
    if (
      node._eventHandlers?.onWheel &&
      (col === undefined ||
        row === undefined ||
        typeof node.attributes.tabIndex === 'number' ||
        hitTest(node, col, row) !== null)
    ) {
      return true
    }
    node = node.parentNode
  }
  return false
}

/**
 * Hit-test the root at (col, row) and bubble a ClickEvent from the deepest
 * containing node up through parentNode. Only nodes with an onClick handler
 * fire. Stops when a handler calls stopImmediatePropagation(). Returns
 * true if a handler fired without `allowDefault()`.
 */
export function dispatchClick(
  root: DOMElement,
  col: number,
  row: number,
  cellIsBlank = false,
  hyperlinkUrl?: string,
  isWindowActivation = false,
): boolean {
  return bubbleClick(
    root,
    new ClickEvent(col, row, cellIsBlank, hyperlinkUrl, isWindowActivation),
  )
}

/**
 * densable `Vd` — hover handlers fire unless this node ignores blank cells.
 */
function hoverHandlersApply(node: DOMElement, cellIsBlank: boolean): boolean {
  const h = node._eventHandlers as EventHandlerProps | undefined
  return (
    Boolean(h?.onMouseEnter || h?.onMouseLeave) &&
    !(cellIsBlank && node.attributes.hoverIgnoresBlankCells)
  )
}

/**
 * densable `ev` — first non-empty column walking from `col` toward `bound`.
 */
function firstNonEmptyColToward(
  screen: Screen,
  row: number,
  col: number,
  bound: number,
  step: number,
): number | undefined {
  for (let x = col + step; x !== bound; x += step) {
    if (!isEmptyCellAt(screen, x, row)) return x
  }
  return undefined
}

/**
 * densable `Ls` — blank for hover: empty cell, unless ink-text / ink-raw-ansi
 * layout still hit-tests to this node on both sides of the empty span.
 * Uses `nodeCache.get(node)` (not a cachedLayout field).
 */
export function cellIsBlankForHover(
  root: DOMElement,
  screen: Screen,
  hit: DOMElement | null | undefined,
  col: number,
  row: number,
): boolean {
  if (!isEmptyCellAt(screen, col, row)) return false
  const layout =
    hit?.nodeName === 'ink-text' || hit?.nodeName === 'ink-raw-ansi'
      ? nodeCache.get(hit)
      : undefined
  if (!layout) return true
  const left = firstNonEmptyColToward(
    screen,
    row,
    col,
    Math.floor(layout.x) - 1,
    -1,
  )
  const right = firstNonEmptyColToward(
    screen,
    row,
    col,
    Math.ceil(layout.x + layout.width),
    1,
  )
  return !(
    left !== undefined &&
    right !== undefined &&
    hitTest(root, left, row) === hit &&
    hitTest(root, right, row) === hit
  )
}

function resolveHoverBlank(
  root: DOMElement,
  col: number,
  row: number,
  hit: DOMElement | null | undefined,
  blank: boolean | Screen,
): boolean {
  return typeof blank === 'boolean'
    ? blank
    : cellIsBlankForHover(root, blank, hit, col, row)
}

/**
 * densable `nv` — pointer-move enter/leave. Does NOT follow paint; that is
 * `followHover` (`iv`) after the next frame.
 *
 * Mutates `hovered` in place. 5th arg is a boolean blank, or a Screen so
 * `Ls` can compute blank (gold `typeof y==="boolean"?y:Ls(...)`).
 */
export function dispatchHover(
  root: DOMElement,
  col: number,
  row: number,
  hovered: Set<DOMElement>,
  blank: boolean | Screen = false,
): void {
  const next = new Set<DOMElement>()
  const hit = hitTest(root, col, row)
  const cellIsBlank = resolveHoverBlank(root, col, row, hit, blank)
  let node: DOMElement | undefined = hit ?? undefined
  while (node) {
    if (hoverHandlersApply(node, cellIsBlank)) next.add(node)
    node = node.parentNode
  }
  for (const old of hovered) {
    if (!next.has(old)) {
      hovered.delete(old)
      if (old.parentNode) {
        ;(old._eventHandlers as EventHandlerProps | undefined)?.onMouseLeave?.()
      }
    }
  }
  for (const n of next) {
    if (!hovered.has(n)) {
      hovered.add(n)
      ;(n._eventHandlers as EventHandlerProps | undefined)?.onMouseEnter?.()
    }
  }
}

/**
 * densable `iv` — after paint, re-sync nodes with `hoverFollowsPaint`.
 * Returns whether any enter/leave fired (Ink streak / hold).
 */
export function followHover(
  root: DOMElement,
  col: number,
  row: number,
  hovered: Set<DOMElement>,
  blank: boolean | Screen = false,
): boolean {
  const hit = hitTest(root, col, row) ?? undefined
  const cellIsBlank = resolveHoverBlank(root, col, row, hit ?? null, blank)
  let changed = false
  for (const node of hovered) {
    if (!node.attributes.hoverFollowsPaint) continue
    let walk: DOMElement | undefined = hoverHandlersApply(node, cellIsBlank)
      ? hit
      : undefined
    while (walk && walk !== node) walk = walk.parentNode
    if (!walk) {
      hovered.delete(node)
      changed = true
      if (node.parentNode) {
        ;(
          node._eventHandlers as EventHandlerProps | undefined
        )?.onMouseLeave?.()
      }
    }
  }
  let paint: DOMElement | undefined = hit
  while (paint) {
    if (
      paint.attributes.hoverFollowsPaint &&
      hoverHandlersApply(paint, cellIsBlank) &&
      !hovered.has(paint)
    ) {
      hovered.add(paint)
      changed = true
      ;(paint._eventHandlers as EventHandlerProps | undefined)?.onMouseEnter?.()
    }
    paint = paint.parentNode
  }
  return changed
}

export function dispatchMouseAction(
  root: DOMElement,
  col: number,
  row: number,
  button: number,
  type: 'mousedown' | 'mouseup' | 'mousedrag',
  targetOverride?: DOMElement,
  mods: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {},
): DOMElement | null {
  let target: DOMElement | undefined =
    targetOverride ?? hitTest(root, col, row) ?? undefined
  if (!target) return null

  const propName =
    type === 'mousedown'
      ? 'onMouseDown'
      : type === 'mouseup'
        ? 'onMouseUp'
        : 'onMouseDrag'

  const event = new MouseActionEvent(type, col, row, button, {
    shift: mods.shift === true || (button & 0x04) !== 0,
    alt: mods.alt === true || (button & 0x08) !== 0,
    ctrl: mods.ctrl === true || (button & 0x10) !== 0,
  })
  let handledBy: DOMElement | null = null

  while (target) {
    const handlers = target._eventHandlers as EventHandlerProps | undefined
    const named = handlers?.[propName] as
      | ((event: MouseActionEvent) => void)
      | undefined
    const pointer = handlers?.onPointer
    if (named || pointer) {
      handledBy ??= target
      event.prepareForTarget(target)
      named?.(event)
      if (!event.didStopImmediatePropagation()) pointer?.(event)
      if (event.didStopImmediatePropagation()) {
        return handledBy
      }
    }
    target = target.parentNode as DOMElement | undefined
  }

  return handledBy
}

/**
 * densable `Xd` — walk from hit to the first `onPointer` ancestor.
 * Stops with null if `onClick` or `tabIndex` is reached first.
 */
export function findPointerHoverTarget(
  root: DOMElement,
  col: number,
  row: number,
): DOMElement | null {
  let node: DOMElement | undefined = hitTest(root, col, row) ?? undefined
  while (node) {
    const handlers = node._eventHandlers as EventHandlerProps | undefined
    if (handlers?.onPointer) return node
    if (handlers?.onClick || typeof node.attributes.tabIndex === 'number') {
      return null
    }
    node = node.parentNode
  }
  return null
}

/**
 * densable `Wl` — fire `onPointer` with kind `"down"|"move"|"up"`.
 * Gold requires cachedLayout (`nodeCache`) and (parentNode || kind==="up").
 * Hover / drag analog is kind `"move"`.
 */
export function dispatchPointer(
  node: DOMElement,
  kind: 'down' | 'move' | 'up',
  col: number,
  row: number,
  button: number,
  mods: { shift?: boolean; alt?: boolean; ctrl?: boolean },
  fine: { col: number; row: number } | undefined,
): void {
  const handler = node._eventHandlers?.onPointer
  const rect = nodeCache.get(node)
  if (!(handler && rect && (node.parentNode || kind === 'up'))) return
  const originX = Math.floor(rect.x)
  const originY = Math.floor(rect.y)
  const localFine = fine
    ? { col: fine.col - originX, row: fine.row - originY }
    : undefined
  const type =
    kind === 'down' ? 'mousedown' : kind === 'up' ? 'mouseup' : 'mousedrag'
  const event = new MouseActionEvent(type, col, row, button, mods, localFine)
  event.localCol = col - originX
  event.localRow = row - originY
  event.localFine = localFine
  handler(event)
}

/**
 * densable `handlePointerHover` body: `Xd` then `Wl` kind move.
 */
export function hitPointerHover(
  root: DOMElement,
  col: number,
  row: number,
  mods: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {},
  fine?: { col: number; row: number },
): boolean {
  const target = findPointerHoverTarget(root, col, row)
  if (!target) return false
  dispatchPointer(target, 'move', col, row, 0, mods, fine)
  return true
}
