import type { EventHandlerProps } from './events/event-handlers.js'
import type { FocusManager } from './focus.js'
import { createLayoutNode } from './layout/engine.js'
import type { LayoutNode, YogaNodeConfig } from './layout/node.js'
import { LayoutDisplay, LayoutMeasureMode } from './layout/node.js'
import measureText from './measure-text.js'
import { addPendingClear, nodeCache } from './node-cache.js'
import squashTextNodes, {
  squashTextNodesToSegments,
} from './squash-text-nodes.js'
import type { Color, Styles, TextStyles } from './styles.js'
import { expandTabsJoin, hasEscOrC1 } from './tabstops.js'
import wrapText from './wrap-text.js'

type InkNode = {
  parentNode: DOMElement | undefined
  yogaNode?: LayoutNode
  style: Styles
}

export type TextName = '#text'
export type ElementNames =
  | 'ink-root'
  | 'ink-box'
  | 'ink-text'
  | 'ink-virtual-text'
  | 'ink-link'
  | 'ink-progress'
  | 'ink-raw-ansi'

export type NodeNames = ElementNames | TextName

/**
 * densable 2.1.218 screen-reader accessibility bag on DOM nodes
 * (`TYr` / `aria-*` → `node.accessibility`).
 */
export type DOMAccessibility = {
  hidden?: boolean
  label?: string
  role?: string
  state?: Record<string, boolean | undefined>
  /** densable `preserveWhitespace` — keep trailing spaces in SR line materialize */
  preserveWhitespace?: boolean
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export type DOMElement = {
  nodeName: ElementNames
  attributes: Record<string, DOMNodeAttribute>
  childNodes: DOMNode[]
  textStyles?: TextStyles
  /** densable accessibility (not in attributes — separate field like event handlers) */
  accessibility?: DOMAccessibility

  // Internal properties
  onComputeLayout?: () => void
  onRender?: () => void
  onImmediateRender?: () => void
  /**
   * densable `layoutStale` — gold scheduleRenderFrom sets this on the root so
   * the next `onRender` re-runs `onComputeLayout` (notifyLayoutListeners after
   * Ab has subscribed). Cleared in resetAfterCommit and at the start of that
   * onRender arm.
   */
  layoutStale?: boolean
  /**
   * densable `transcriptFrontCutRows` — cut node stamped by `oyr`; `wv`
   * consumes it for SR `applyTranscriptFrontCut`.
   */
  transcriptFrontCutRows?: unknown
  /**
   * densable `cachedLayout` — gold `jd.rect` is this field only
   * (`if(!u)return`). Cache miss is undefined; no yoga getComputed* fallback.
   * Local paint still writes `nodeCache` (WeakMap) for hit-test.
   */
  cachedLayout?: {
    x: number
    y: number
    width: number
    height: number
    top?: number
    background?: Color
    clip?: {
      x1: number | undefined
      x2: number | undefined
      y1: number | undefined
      y2: number | undefined
    }
    unpainted?: boolean
  }
  /**
   * densable `nd()` — walked up on insert of absolute (or abs-descendant)
   * children. yC skip-blit miss when clip grew.
   */
  hasAbsoluteDescendant?: boolean
  /** densable Mv `paintsPastRect` — child overflow or descendant overflow. */
  paintsPastRect?: boolean
  /** densable `hasEscapingDescendant` — absolute overlay outside parent rect. */
  hasEscapingDescendant?: boolean
  /** densable `resetAfterCommit` — `n.lastCommitMs` from `scrollCommitStartedAt`. */
  lastCommitMs?: number
  /** densable `Yhr` stamp; cleared in `resetAfterCommit`. */
  scrollCommitStartedAt?: number
  // Used to skip empty renders during React 19's effect double-invoke in test mode
  hasRenderedContent?: boolean

  // When true, this node needs re-rendering
  dirty: boolean
  // Set by the reconciler's hideInstance/unhideInstance; survives style updates.
  isHidden?: boolean
  // 协调器写入的事件处理器（捕获/冒泡分发用）。
  // 与 attributes 分离，避免 handler 引用变化触发 dirty 破坏 blit 优化。
  _eventHandlers?: Partial<EventHandlerProps> // 见 event-handlers.ts EventHandlerProps
  /**
   * densable `_holdsRawModeRef` — this node currently contributes +1 to the
   * root raw-mode refcount (`sy` / `hy`).
   */
  _holdsRawModeRef?: boolean
  /**
   * densable `setRawMode` — bound on the root after App mount (`handleSetRawMode`).
   * `fy` calls this with `delta > 0` when present.
   */
  setRawMode?: (enabled: boolean) => void
  /**
   * densable `_pendingRawModeDelta` — raw-mode refcount accrued on the root
   * before App binds `setRawMode` (createInstance can run pre-mount).
   */
  _pendingRawModeDelta?: number

  // Scroll state for overflow: 'scroll' boxes. scrollTop is the number of
  // rows the content is scrolled down by. scrollHeight/scrollViewportHeight
  // are computed at render time and stored for imperative access. stickyScroll
  // auto-pins scrollTop to the bottom when content grows.
  scrollTop?: number
  // Accumulated scroll delta not yet applied to scrollTop. The renderer
  // drains this at SCROLL_MAX_PER_FRAME rows/frame so fast flicks show
  // intermediate frames instead of one big jump. Direction reversal
  // naturally cancels (pure accumulator, no target tracking).
  pendingScrollDelta?: number
  // Render-time clamp bounds for virtual scroll. useVirtualScroll writes
  // the currently-mounted children's coverage span; render-node-to-output
  // clamps scrollTop to stay within it. Prevents blank screen when
  // scrollTo's direct write races past React's async re-render — instead
  // of painting spacer (blank), the renderer holds at the edge of mounted
  // content until React catches up (next commit updates these bounds and
  // the clamp releases). Undefined = no clamp (sticky-scroll, cold start).
  scrollClampMin?: number
  scrollClampMax?: number
  scrollHeight?: number
  /**
   * Official 2.1.207: high-water mark of content height while the user has
   * scrolled away from sticky bottom. When content transiently shrinks
   * (streaming markdown freeze / virtualization remount), clamp against this
   * so scrollTop does not jump upward above the answer start.
   * Cleared while sticky (follow-bottom) is active.
   */
  scrollHeightHwm?: number
  scrollViewportHeight?: number
  scrollViewportTop?: number
  /**
   * densable Gs `scrollTopRendered` — last visual `at` after drain/clamp.
   * followScroll delta is `at - (scrollTopRendered ?? at)` (signed, including
   * scroll-up).
   */
  scrollTopRendered?: number
  stickyScroll?: boolean
  // Set by ScrollBox.scrollToElement; render-node-to-output reads
  // el.yogaNode.getComputedTop() (FRESH — same Yoga pass as scrollHeight)
  // and sets scrollTop = top + offset, then clears this. Unlike an
  // imperative scrollTo(N) which bakes in a number that's stale by the
  // time the throttled render fires, the element ref defers the position
  // read to paint time. One-shot.
  // densable scrollToElement block: start|center|end|nearest.
  // nearest: keep in view without jumping if already visible (legacy bool).
  scrollAnchor?: {
    el: DOMElement
    offset: number
    nearest?: boolean
    block?: 'start' | 'center' | 'end' | 'nearest'
  }
  // Only set on ink-root. The document owns focus — any node can
  // reach it by walking parentNode, like browser getRootNode().
  focusManager?: FocusManager
  // React component stack captured at createInstance time (reconciler.ts),
  // e.g. ['ToolUseLoader', 'Messages', 'REPL']. Only populated when
  // CLAUDE_CODE_DEBUG_REPAINTS is set. Used by findOwnerChainAtRow to
  // attribute scrollback-diff full-resets to the component that caused them.
  debugOwnerChain?: string[]
} & InkNode

export type TextNode = {
  nodeName: TextName
  nodeValue: string
} & InkNode

// eslint-disable-next-line @typescript-eslint/naming-convention
export type DOMNode<T = { nodeName: NodeNames }> = T extends {
  nodeName: infer U
}
  ? U extends '#text'
    ? TextNode
    : DOMElement
  : never

// eslint-disable-next-line @typescript-eslint/naming-convention
export type DOMNodeAttribute = boolean | string | number

export const createNode = (
  nodeName: ElementNames,
  // densable `_r(n,u)` → hs.Node.create(u)
  yogaConfig?: YogaNodeConfig,
): DOMElement => {
  const needsYogaNode =
    nodeName !== 'ink-virtual-text' &&
    nodeName !== 'ink-link' &&
    nodeName !== 'ink-progress'
  const node: DOMElement = {
    nodeName,
    style: {},
    attributes: {},
    childNodes: [],
    parentNode: undefined,
    yogaNode: needsYogaNode ? createLayoutNode(yogaConfig) : undefined,
    dirty: false,
    layoutStale: undefined,
    cachedLayout: undefined,
    lastCommitMs: undefined,
    scrollCommitStartedAt: undefined,
  }

  if (nodeName === 'ink-text') {
    node.yogaNode?.setMeasureFunc(measureTextNode.bind(null, node))
  } else if (nodeName === 'ink-raw-ansi') {
    node.yogaNode?.setMeasureFunc(measureRawAnsiNode.bind(null, node))
  }

  return node
}

/** densable `nd(n)` — walk parents setting hasAbsoluteDescendant. */
function leftoverGsStampAbsoluteDescendant(node: DOMElement | undefined): void {
  let cur: DOMElement | undefined = node
  while (cur && !cur.hasAbsoluteDescendant) {
    cur.hasAbsoluteDescendant = true
    cur = cur.parentNode
  }
}

function leftoverGsMaybeStampAbsolute(
  parent: DOMElement,
  child: DOMNode,
): void {
  if (child.nodeName === '#text') return
  const elem = child as DOMElement
  if (elem.style.position === 'absolute' || elem.hasAbsoluteDescendant) {
    leftoverGsStampAbsoluteDescendant(parent)
  }
}

export const appendChildNode = (
  node: DOMElement,
  childNode: DOMElement,
): void => {
  if (childNode.parentNode) {
    removeChildNode(childNode.parentNode, childNode)
  }

  childNode.parentNode = node
  node.childNodes.push(childNode)

  if (childNode.yogaNode) {
    node.yogaNode?.insertChild(
      childNode.yogaNode,
      node.yogaNode.getChildCount(),
    )
  }

  leftoverGsMaybeStampAbsolute(node, childNode)

  markDirty(node)
}

export const insertBeforeNode = (
  node: DOMElement,
  newChildNode: DOMNode,
  beforeChildNode: DOMNode,
): void => {
  if (newChildNode.parentNode) {
    removeChildNode(newChildNode.parentNode, newChildNode)
  }

  newChildNode.parentNode = node

  const index = node.childNodes.indexOf(beforeChildNode)

  if (index >= 0) {
    // Calculate yoga index BEFORE modifying childNodes.
    // We can't use DOM index directly because some children (like ink-progress,
    // ink-link, ink-virtual-text) don't have yogaNodes, so DOM indices don't
    // match yoga indices.
    let yogaIndex = 0
    if (newChildNode.yogaNode && node.yogaNode) {
      for (let i = 0; i < index; i++) {
        if (node.childNodes[i]?.yogaNode) {
          yogaIndex++
        }
      }
    }

    node.childNodes.splice(index, 0, newChildNode)

    if (newChildNode.yogaNode && node.yogaNode) {
      node.yogaNode.insertChild(newChildNode.yogaNode, yogaIndex)
    }

    leftoverGsMaybeStampAbsolute(node, newChildNode)
    markDirty(node)
    return
  }

  node.childNodes.push(newChildNode)

  if (newChildNode.yogaNode) {
    node.yogaNode?.insertChild(
      newChildNode.yogaNode,
      node.yogaNode.getChildCount(),
    )
  }

  leftoverGsMaybeStampAbsolute(node, newChildNode)
  markDirty(node)
}

export const removeChildNode = (
  node: DOMElement,
  removeNode: DOMNode,
): void => {
  if (removeNode.yogaNode) {
    removeNode.parentNode?.yogaNode?.removeChild(removeNode.yogaNode)
  }

  // Collect cached rects from the removed subtree so they can be cleared
  collectRemovedRects(node, removeNode)

  removeNode.parentNode = undefined

  const index = node.childNodes.indexOf(removeNode)
  if (index >= 0) {
    node.childNodes.splice(index, 1)
  }

  markDirty(node)
}

function collectRemovedRects(
  parent: DOMElement,
  removed: DOMNode,
  underAbsolute = false,
): void {
  if (removed.nodeName === '#text') return
  const elem = removed as DOMElement
  // If this node or any ancestor in the removed subtree was absolute,
  // its painted pixels may overlap non-siblings — flag for global blit
  // disable. Normal-flow removals only affect direct siblings, which
  // hasRemovedChild already handles.
  const isAbsolute = underAbsolute || elem.style.position === 'absolute'
  const cached = nodeCache.get(elem)
  if (cached) {
    addPendingClear(parent, cached, isAbsolute)
    nodeCache.delete(elem)
    elem.cachedLayout = undefined
  }
  for (const child of elem.childNodes) {
    collectRemovedRects(parent, child, isAbsolute)
  }
}

export const setAttribute = (
  node: DOMElement,
  key: string,
  value: DOMNodeAttribute,
): void => {
  // Skip 'children' - React handles children via appendChild/removeChild,
  // not attributes. React always passes a new children reference, so
  // tracking it as an attribute would mark everything dirty every render.
  if (key === 'children') {
    return
  }
  // Skip if unchanged
  if (node.attributes[key] === value) {
    return
  }
  node.attributes[key] = value
  markDirty(node)
}

/** densable `jus` — set accessibility bag without going through attributes. */
export const setAccessibility = (
  node: DOMElement,
  accessibility: DOMAccessibility | undefined,
): void => {
  if (node.accessibility === accessibility) return
  node.accessibility = accessibility
  markDirty(node)
}

export const setStyle = (node: DOMNode, style: Styles): void => {
  // Compare style properties to avoid marking dirty unnecessarily.
  // React creates new style objects on every render even when unchanged.
  if (stylesEqual(node.style, style)) {
    return
  }
  const wasAbsolute = node.style.position === 'absolute'
  node.style = style
  if (!wasAbsolute && style.position === 'absolute' && node.parentNode) {
    leftoverGsStampAbsoluteDescendant(node.parentNode)
  }
  markDirty(node)
}

export const setTextStyles = (
  node: DOMElement,
  textStyles: TextStyles,
): void => {
  // Same dirty-check guard as setStyle: React (and buildTextStyles in Text.tsx)
  // allocate a new textStyles object on every render even when values are
  // unchanged, so compare by value to avoid markDirty -> yoga re-measurement
  // on every Text re-render.
  if (shallowEqual(node.textStyles, textStyles)) {
    return
  }
  node.textStyles = textStyles
  markDirty(node)
}

function stylesEqual(a: Styles, b: Styles): boolean {
  return shallowEqual(a, b)
}

function shallowEqual<T extends object>(
  a: T | undefined,
  b: T | undefined,
): boolean {
  // Fast path: same object reference (or both undefined)
  if (a === b) return true
  if (a === undefined || b === undefined) return false

  // Get all keys from both objects
  const aKeys = Object.keys(a) as (keyof T)[]
  const bKeys = Object.keys(b) as (keyof T)[]

  // Different number of properties
  if (aKeys.length !== bKeys.length) return false

  // Compare each property
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }

  return true
}

export const createTextNode = (text: string): TextNode => {
  const node: TextNode = {
    nodeName: '#text',
    nodeValue: text,
    yogaNode: undefined,
    parentNode: undefined,
    style: {},
  }

  setTextNodeValue(node, text)

  return node
}

const measureTextNode = function (
  node: DOMNode,
  width: number,
  widthMode: LayoutMeasureMode,
): { width: number; height: number } {
  const rawText =
    node.nodeName === '#text' ? node.nodeValue : squashTextNodes(node)
  const textWrap = node.style?.textWrap ?? 'wrap'
  const keepBidi =
    textWrap === 'wrap' ||
    textWrap === 'wrap-trim' ||
    textWrap === 'wrap-stream'
  // densable Oc: ink-text with ESC/C1 expands per wr() segment, else [raw].
  const text = expandTabsJoin(
    node.nodeName !== '#text' && hasEscOrC1(rawText)
      ? squashTextNodesToSegments(node as DOMElement).map(
          segment => segment.text,
        )
      : [rawText],
    keepBidi,
  )

  // densable h1: wrap-stream ALWAYS wraps then drops the last visual row,
  // before the "fits in container" return. A short first sentence is one
  // visual row → height 0 (gold lWy). Local used to return height 1 when
  // the unwrapped line fit, so paint popped an empty body next to ●.
  if (textWrap === 'wrap-stream') {
    const fullyWrapped = wrapText(text, width, 'wrap')
    const dims = measureText(fullyWrapped, width)
    return { width: dims.width, height: Math.max(0, dims.height - 1) }
  }

  const dimensions = measureText(text, width)

  // densable: if(f===0||x.width<=u)return x  (Undefined OR fits)
  if (widthMode === LayoutMeasureMode.Undefined || dimensions.width <= width) {
    return dimensions
  }

  // This is happening when <Box> is shrinking child nodes and layout asks
  // if we can fit this text node in a <1px space, so we just say "no"
  if (dimensions.width >= 1 && width > 0 && width < 1) {
    return dimensions
  }

  const wrappedText = wrapText(text, width, textWrap)

  return measureText(wrappedText, width)
}

// ink-raw-ansi nodes hold pre-rendered ANSI strings with known dimensions.
// No stringWidth, no wrapping, no tab expansion — the producer (e.g. ColorDiff)
// already wrapped to the target width and each line is exactly one terminal row.
const measureRawAnsiNode = function (node: DOMElement): {
  width: number
  height: number
} {
  return {
    width: node.attributes['rawWidth'] as number,
    height: node.attributes['rawHeight'] as number,
  }
}

/**
 * Mark a node and all its ancestors as dirty for re-rendering.
 * Also marks yoga dirty for text remeasurement if this is a text node.
 */
export const markDirty = (node?: DOMNode): void => {
  let current: DOMNode | undefined = node
  let markedYoga = false

  while (current) {
    if (current.nodeName !== '#text') {
      ;(current as DOMElement).dirty = true
      // Only mark yoga dirty on leaf nodes that have measure functions
      if (
        !markedYoga &&
        (current.nodeName === 'ink-text' ||
          current.nodeName === 'ink-raw-ansi') &&
        current.yogaNode
      ) {
        current.yogaNode.markDirty()
        markedYoga = true
      }
    }
    current = current.parentNode
  }
}

// Walk to root and call its onRender (the throttled scheduleRender). Use for
// DOM-level mutations (scrollTop changes) that should trigger an Ink frame
// without going through React's reconciler. Pair with markDirty() so the
// renderer knows which subtree to re-evaluate.
export const scheduleRenderFrom = (node?: DOMNode): void => {
  let cur: DOMNode | undefined = node
  while (cur?.parentNode) cur = cur.parentNode
  if (cur && cur.nodeName !== '#text') {
    const root = cur as DOMElement
    root.layoutStale = true
    root.onRender?.()
  }
}

export const setTextNodeValue = (node: TextNode, text: string): void => {
  if (typeof text !== 'string') {
    text = String(text)
  }

  // Skip if unchanged
  if (node.nodeValue === text) {
    return
  }

  node.nodeValue = text
  markDirty(node)
}

function isDOMElement(node: DOMElement | TextNode): node is DOMElement {
  return node.nodeName !== '#text'
}

// Clear yogaNode references recursively before freeing.
// freeRecursive() frees the node and ALL its children, so we must clear
// all yogaNode references to prevent dangling pointers.
export const clearYogaNodeReferences = (node: DOMElement | TextNode): void => {
  if ('childNodes' in node) {
    for (const child of node.childNodes) {
      clearYogaNodeReferences(child)
    }
  }
  node.yogaNode = undefined
}

/**
 * Find the React component stack responsible for content at screen row `y`.
 *
 * DFS the DOM tree accumulating yoga offsets. Returns the debugOwnerChain of
 * the deepest node whose bounding box contains `y`. Called from ink.tsx when
 * log-update triggers a full reset, to attribute the flicker to its source.
 *
 * Only useful when CLAUDE_CODE_DEBUG_REPAINTS is set (otherwise chains are
 * undefined and this returns []).
 */
export function findOwnerChainAtRow(root: DOMElement, y: number): string[] {
  let best: string[] = []
  walk(root, 0)
  return best

  function walk(node: DOMElement, offsetY: number): void {
    const yoga = node.yogaNode
    if (!yoga || yoga.getDisplay() === LayoutDisplay.None) return

    const top = offsetY + yoga.getComputedTop()
    const height = yoga.getComputedHeight()
    if (y < top || y >= top + height) return

    if (node.debugOwnerChain) best = node.debugOwnerChain

    for (const child of node.childNodes) {
      if (isDOMElement(child)) walk(child, top)
    }
  }
}
