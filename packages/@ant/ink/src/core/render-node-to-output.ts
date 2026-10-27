import chalk from 'chalk'
import indentString from 'indent-string'
import { applyTextStyles, colorize } from './colorize.js'
import type { DOMElement, DOMNode } from './dom.js'
import getMaxWidth from './get-max-width.js'
import type { Rectangle } from './layout/geometry.js'
import { LayoutDisplay, LayoutEdge, type LayoutNode } from './layout/node.js'
import { nodeCache, pendingClears } from './node-cache.js'
import type Output from './output.js'
import type { Clip } from './output.js'
import renderBorder from './render-border.js'
import type { Screen } from './screen.js'
import { MAX_TREE_DEPTH, warnTreeDepthExceeded } from './maxTreeDepth.js'
import {
  applyVirtualScrollRangeClamp,
  clampStoredScrollTop,
  clampVisualScrollTop,
  resolveNearestScrollTop,
  shouldFollowScrollGrowth,
  updateScrollHeightHwm,
} from './scrollHeightHwm.js'
import {
  type StyledSegment,
  squashTextNodesToSegments,
} from './squash-text-nodes.js'
import type { Color } from './styles.js'
import { isXtermJs } from './terminal.js'
import {
  SoftWrapKind,
  type SoftWrapKind as SoftWrapKindValue,
} from './softWrap.js'
import { stringWidth } from './stringWidth.js'
import { widestLine } from './widest-line.js'
import wrapText from './wrap-text.js'

// Matches detectXtermJsWheel() in ScrollKeybindingHandler.tsx — the curve
// and drain must agree on terminal detection. TERM_PROGRAM check is the sync
// fallback; isXtermJs() is the authoritative XTVERSION-probe result.
function isXtermJsHost(): boolean {
  return process.env.TERM_PROGRAM === 'vscode' || isXtermJs()
}

/**
 * densable `jd.cachedLayout` stamp — gold `R6`/`Wl`/`tv` read `n.cachedLayout`.
 * WeakMap `nodeCache` stays for local dirty/prevScreen blit.
 */
function stampLayout(
  node: DOMElement,
  rect: {
    x: number
    y: number
    width: number
    height: number
    top?: number
    background?: Color
    clip?: LeftoverClip
    unpainted?: boolean
  },
): void {
  // gold Gs: `n.cachedLayout={x,y,width,height,top,...}` is ONE object.
  // DualInk WeakMap skip-blit extra must alias that object so sf `K.top=X`
  // (renderScrolledChildren) mutates the same stamp skip-blit / second-pass
  // read. Copying here left cachedLayout.top stale vs nodeCache.top.
  node.cachedLayout = rect
  nodeCache.set(node, rect)
}

/**
 * densable `b9r()` — per-paint render context.
 * Gold J$0: `v9r(i, p, b9r(), {offsetX:0, offsetY:-c, prevScreen:void 0})`.
 * `consumeClears` is tip-only: pendingClears lives on the DOM WeakMap, so
 * offscreen J$0 paints then leaves the entry for the live frame.
 */
export type ScrollHint = { top: number; bottom: number; delta: number }

/**
 * densable Gs DECSTBM hint. Gold:
 *   Yt = floor(H)<=0 && floor(H+I)>=u.width
 *   Rn = fe-ye
 *   hn = j!==void 0 && Rn!==0 && B-j.height===Rn && $e===-Rn
 *   Jt if Yt && j?.y===L && (j.height===B||hn) && fe>0
 *        && abs($e)<(hn?min(fe,ye):fe) && pe===0
 * DualInk DA is gold DA — this is HAS BODY, not analog.
 */
export function leftoverGsHint(input: {
  contentCachedY: number
  contentY: number
  containerCached: { y: number; height: number } | undefined
  containerX: number
  containerY: number
  containerWidth: number
  containerHeight: number
  outputWidth: number
  innerHeight: number
  prevInnerHeight: number
  padBottom: number
  clipTop: number
  viewportTop: number
}): { hint: ScrollHint | null; hn: boolean } {
  const delta = input.contentCachedY - input.contentY
  const innerDelta = input.innerHeight - input.prevInnerHeight
  const cached = input.containerCached
  const hn =
    cached !== undefined &&
    innerDelta !== 0 &&
    input.containerHeight - cached.height === innerDelta &&
    delta === -innerDelta
  const fullWidth =
    Math.floor(input.containerX) <= 0 &&
    Math.floor(input.containerX + input.containerWidth) >= input.outputWidth
  const absLimit = hn
    ? Math.min(input.innerHeight, input.prevInnerHeight)
    : input.innerHeight
  const ok =
    fullWidth &&
    cached?.y === input.containerY &&
    (cached.height === input.containerHeight || hn) &&
    input.innerHeight > 0 &&
    Math.abs(delta) < absLimit &&
    input.padBottom === 0
  if (!ok) return { hint: null, hn }
  return {
    hn,
    hint: {
      top: Math.floor(input.clipTop),
      bottom:
        Math.floor(input.viewportTop) +
        (hn
          ? Math.max(input.innerHeight, input.prevInnerHeight)
          : input.innerHeight) -
        1,
      delta,
    },
  }
}

/**
 * densable Gs `jr` — first child whose bottom is past scrollTop, when
 * scrolling down across pad (`$t>$e`). Gold:
 *   if (Yt>0 && $t>$e) jr=max(0,min($t-$e, at-Wt))
 */
export function leftoverGsJr(input: {
  delta: number
  viewportTop: number
  hintTop: number
  scrollTop: number
  firstChildTop: number
}): number {
  if (!(input.delta > 0 && input.viewportTop > input.hintTop)) return 0
  return Math.max(
    0,
    Math.min(
      input.viewportTop - input.hintTop,
      input.scrollTop - input.firstChildTop,
    ),
  )
}

/**
 * densable Gs fast-path blit window. Gold:
 *   Wo=$t+fe-1, Wr=hn?$t+ye-1:Wo
 *   vo=$t+max(0,Yt)-jr, Vo=min(Wr,Wo+Yt)
 *   blit y=vo h=Vo-vo+1 unclipped=Vo>Wo
 *   ni=Yt>0?Vo-Yt+1:$t, yi=Yt>0?Wo:$t-Yt-1
 */
export function leftoverGsBlitWindow(input: {
  hint: ScrollHint
  hn: boolean
  viewportTop: number
  innerHeight: number
  prevInnerHeight: number
  jr: number
}): {
  blitY: number
  blitHeight: number
  unclipped: boolean
  edgeTop: number
  edgeBottom: number
  clearY: number
  paintEdge: boolean
} {
  const { hint, hn, viewportTop, innerHeight, prevInnerHeight, jr } = input
  const { top, delta } = hint
  const viewportBottom = viewportTop + innerHeight - 1
  const wr = hn ? viewportTop + prevInnerHeight - 1 : viewportBottom
  const blitY = viewportTop + Math.max(0, delta) - jr
  const blitBottom = Math.min(wr, viewportBottom + delta)
  const edgeTop = delta > 0 ? blitBottom - delta + 1 : viewportTop
  const edgeBottom = delta > 0 ? viewportBottom : viewportTop - delta - 1
  return {
    blitY,
    blitHeight: blitBottom - blitY + 1,
    unclipped: blitBottom > viewportBottom,
    edgeTop,
    edgeBottom,
    clearY: delta < 0 ? top : edgeTop,
    paintEdge: edgeTop <= edgeBottom,
  }
}

/**
 * densable Gs second-pass stale wipe. Gold:
 *   Tn = floor(Pt.y)-Yt
 *   if (Tn===ri) continue
 *   vi=max(Tn,Jt.top), qo=min(Tn+Pt.height, bo??Jt.bottom+1)
 *   if (vi<qo) write spaces
 */
export function leftoverGsStaleWipe(input: {
  shiftedY: number
  cachedHeight: number
  hintTop: number
  hintBottom: number
  firstRepaintY: number | undefined
}): { y: number; height: number } | null {
  const y1 = Math.max(input.shiftedY, input.hintTop)
  const y2 = Math.min(
    input.shiftedY + input.cachedHeight,
    input.firstRepaintY ?? input.hintBottom + 1,
  )
  if (y1 >= y2) return null
  return { y: y1, height: y2 - y1 }
}

export type FollowScroll = {
  delta: number
  viewportTop: number
  viewportBottom: number
  viewportLeft: number
  viewportRight: number
}

export type LeftoverClip = Clip

export type LeftoverClipNest = {
  now: LeftoverClip | undefined
  before: LeftoverClip | undefined
  grew: boolean
}

function leftoverGsMaxBound(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
}

function leftoverGsMinBound(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.min(a, b)
}

/**
 * densable Zl(n,u,f) — intersection of n and f is inside u.
 * u undefined → true. Empty intersection → true.
 */
export function leftoverGsZl(
  n: LeftoverClip | undefined,
  u: LeftoverClip | undefined,
  f?: { x: number; y: number; width: number; height: number },
): boolean {
  if (u === undefined) return true
  const x1 = leftoverGsMaxBound(n?.x1, f?.x) ?? Number.NEGATIVE_INFINITY
  const y1 = leftoverGsMaxBound(n?.y1, f?.y) ?? Number.NEGATIVE_INFINITY
  const x2 =
    leftoverGsMinBound(n?.x2, f ? f.x + f.width : undefined) ??
    Number.POSITIVE_INFINITY
  const y2 =
    leftoverGsMinBound(n?.y2, f ? f.y + f.height : undefined) ??
    Number.POSITIVE_INFINITY
  if (x1 >= x2 || y1 >= y2) return true
  return (
    x1 >= (u.x1 ?? Number.NEGATIVE_INFINITY) &&
    x2 <= (u.x2 ?? Number.POSITIVE_INFINITY) &&
    y1 >= (u.y1 ?? Number.NEGATIVE_INFINITY) &&
    y2 <= (u.y2 ?? Number.POSITIVE_INFINITY)
  )
}

/**
 * densable pC — nest current clip into prev nest; grew = !Zl(now, before).
 */
export function leftoverGsClipNest(
  prev: LeftoverClipNest | undefined,
  nowClip: LeftoverClip | undefined,
  beforeClip: LeftoverClip | undefined,
): LeftoverClipNest | undefined {
  if (!nowClip && !beforeClip) return prev
  const now = nowClip ? leftoverGsIntersectClip(prev?.now, nowClip) : prev?.now
  if (
    prev?.now === prev?.before &&
    nowClip?.x1 === beforeClip?.x1 &&
    nowClip?.x2 === beforeClip?.x2 &&
    nowClip?.y1 === beforeClip?.y1 &&
    nowClip?.y2 === beforeClip?.y2
  ) {
    return { now, before: now, grew: false }
  }
  const before = beforeClip
    ? leftoverGsIntersectClip(prev?.before, beforeClip)
    : prev?.before
  return { now, before, grew: !leftoverGsZl(now, before) }
}

function leftoverGsIntersectClip(
  parent: LeftoverClip | undefined,
  child: LeftoverClip,
): LeftoverClip {
  if (!parent) return child
  return {
    x1: leftoverGsMaxBound(parent.x1, child.x1),
    x2: leftoverGsMinBound(parent.x2, child.x2),
    y1: leftoverGsMaxBound(parent.y1, child.y1),
    y2: leftoverGsMinBound(parent.y2, child.y2),
  }
}

/**
 * densable yC — skip-blit miss. unpainted OR clip grew +
 * (hasAbsoluteDescendant | paintsPastRect | cached rect not in new clip).
 */
export function leftoverGsSkipBlitMiss(
  node: {
    hasAbsoluteDescendant?: boolean
    paintsPastRect?: boolean
  },
  cached: {
    unpainted?: boolean
    x: number
    y: number
    width: number
    height: number
  },
  nest: LeftoverClipNest | undefined,
): boolean {
  if (cached.unpainted) return true
  return (
    nest !== undefined &&
    nest.grew &&
    (node.hasAbsoluteDescendant === true ||
      node.paintsPastRect === true ||
      !leftoverGsZl(nest.now, nest.before, {
        x: Math.floor(cached.x),
        y: Math.floor(cached.y),
        width: Math.floor(cached.width),
        height: Math.floor(cached.height),
      }))
  )
}

/**
 * densable gC — Kt extra: cached not unpainted, and prevScreen clip
 * contains cached + current clip contains node rect.
 */
export function leftoverGsFastPathClipOk(
  nest: LeftoverClipNest | undefined,
  cached:
    | {
        unpainted?: boolean
        x: number
        y: number
        width: number
        height: number
      }
    | undefined,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    cached?.unpainted !== true &&
    (nest === undefined ||
      (leftoverGsZl(undefined, nest.before, cached) &&
        leftoverGsZl(undefined, nest.now, rect)))
  )
}

function leftoverGsCached(node: DOMElement | undefined):
  | {
      x: number
      y: number
      width: number
      height: number
      unpainted?: boolean
    }
  | undefined {
  if (!node) return undefined
  return node.cachedLayout
}

/**
 * densable `kn = at - (n.scrollTopRendered ?? at)`.
 * Signed: sticky growth is +, wheel-up is −.
 */
export function leftoverGsFollowDelta(
  visualScrollTop: number,
  scrollTopRendered: number | undefined,
): number {
  return visualScrollTop - (scrollTopRendered ?? visualScrollTop)
}

/**
 * densable ink followScroll capture window.
 * `ue>0` → above [ye, ye+ue-1]; `ue<0` → below [Te+ue+1, Te].
 */
export function leftoverGsFollowCapture(
  delta: number,
  viewportTop: number,
  viewportBottom: number,
): { firstRow: number; lastRow: number; side: 'above' | 'below' } {
  if (delta > 0) {
    return {
      firstRow: viewportTop,
      lastRow: viewportTop + delta - 1,
      side: 'above',
    }
  }
  return {
    firstRow: viewportBottom + delta + 1,
    lastRow: viewportBottom,
    side: 'below',
  }
}

/**
 * densable fC — a direct absolute child's yoga no longer matches cache
 * (or it hid). Mv kills prevScreen for in-flow siblings (`F&&!ie`).
 */
export function leftoverGsAbsChildMoved(
  node: DOMElement,
  offsetX: number,
  offsetY: number,
): boolean {
  if (!node.hasAbsoluteDescendant) return false
  for (const child of node.childNodes) {
    if (child.nodeName === '#text') continue
    const elem = child as DOMElement
    if (elem.style.position !== 'absolute') continue
    const yoga = elem.yogaNode
    if (!yoga) continue
    const cached = leftoverGsCached(elem)
    if (!cached) continue
    if (yoga.getDisplay() === LayoutDisplay.None) return true
    const childX = offsetX + yoga.getComputedLeft()
    let childY = offsetY + yoga.getComputedTop()
    if (childY < 0) childY = 0
    if (
      cached.x !== childX ||
      cached.y !== childY ||
      cached.width !== yoga.getComputedWidth() ||
      cached.height !== yoga.getComputedHeight()
    ) {
      return true
    }
  }
  return false
}

/**
 * densable Rv — earlier in-flow siblings whose cache overlaps `rect`.
 */
function leftoverGsPoisonOverlappingSiblings(
  siblings: DOMNode[],
  beforeIndex: number,
  rect: { x: number; y: number; width: number; height: number },
  acc: Set<DOMElement> | undefined,
): Set<DOMElement> | undefined {
  for (let i = 0; i < beforeIndex; i++) {
    const sib = siblings[i]
    if (!sib || sib.nodeName === '#text') continue
    const elem = sib as DOMElement
    const cached = leftoverGsCached(elem)
    if (
      cached !== undefined &&
      elem.style.position !== 'absolute' &&
      rect.x < cached.x + cached.width &&
      cached.x < rect.x + rect.width &&
      rect.y < cached.y + cached.height &&
      cached.y < rect.y + rect.height
    ) {
      acc ??= new Set()
      acc.add(elem)
    }
  }
  return acc
}

/**
 * densable hC — a later in-flow escaping child dirtied/moved; overlapping
 * earlier in-flow siblings lose prevScreen (`L?.has(X)`).
 */
export function leftoverGsEscapingDirtyPoisons(
  node: DOMElement,
  offsetX: number,
  offsetY: number,
): Set<DOMElement> | undefined {
  let poisoned: Set<DOMElement> | undefined
  const siblings = node.childNodes
  for (let i = 1; i < siblings.length; i++) {
    const child = siblings[i] as DOMElement
    if (
      child.hasEscapingDescendant !== true ||
      child.style.position === 'absolute'
    ) {
      continue
    }
    const yoga = child.yogaNode
    const cached = leftoverGsCached(child)
    if (!yoga || cached === undefined) continue
    const childX = offsetX + yoga.getComputedLeft()
    const childY = offsetY + yoga.getComputedTop()
    if (
      !child.dirty &&
      cached.x === childX &&
      cached.y === childY &&
      cached.width === yoga.getComputedWidth() &&
      cached.height === yoga.getComputedHeight()
    ) {
      continue
    }
    const stack: [DOMElement, number, number][] = [[child, childX, childY]]
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
      const [cur, curX, curY] = item
      for (const rect of pendingClears.get(cur) ?? []) {
        poisoned = leftoverGsPoisonOverlappingSiblings(
          siblings,
          i,
          rect,
          poisoned,
        )
      }
      for (const desc of cur.childNodes) {
        if (desc.nodeName === '#text') continue
        const d = desc as DOMElement
        const dCached = leftoverGsCached(d)
        const dYoga = d.yogaNode
        if (
          d.style.position === 'absolute' ||
          dCached === undefined ||
          !dYoga
        ) {
          continue
        }
        const dx = curX + dYoga.getComputedLeft()
        const dy = curY + dYoga.getComputedTop()
        if (
          d.dirty ||
          dCached.x !== dx ||
          dCached.y !== dy ||
          dCached.width !== dYoga.getComputedWidth() ||
          dCached.height !== dYoga.getComputedHeight()
        ) {
          poisoned = leftoverGsPoisonOverlappingSiblings(
            siblings,
            i,
            dCached,
            poisoned,
          )
        }
        if (d.hasEscapingDescendant === true) {
          stack.push([d, dx, dy])
        }
      }
    }
  }
  return poisoned
}

/**
 * densable lst — drop cachedLayout (and DualInk WeakMap) for a subtree.
 * Hide + cull. Gold 0: SC is height===0, not cull.
 */
export function leftoverGsDropCachedLayout(node: DOMElement): void {
  if (node.cachedLayout === undefined && !nodeCache.has(node)) return
  const stack: { node: DOMElement; depth: number }[] = [{ node, depth: 0 }]
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    if (item.depth >= MAX_TREE_DEPTH) {
      warnTreeDepthExceeded('dropSubtreeCache', item.node.nodeName)
      continue
    }
    nodeCache.delete(item.node)
    item.node.cachedLayout = undefined
    const children = item.node.childNodes
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (child && child.nodeName !== '#text') {
        stack.push({ node: child as DOMElement, depth: item.depth + 1 })
      }
    }
  }
}

/**
 * densable SC — stamp `{…, unpainted:!0}` so yC miss skip-blit until paint.
 * Height===0 parent walks children here. Display:none descendants lst.
 */
export function leftoverGsStampUnpainted(
  node: DOMElement,
  offsetX: number,
  offsetY: number,
): void {
  const stack: { node: DOMElement; offsetX: number; offsetY: number }[] = [
    { node, offsetX, offsetY },
  ]
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const yoga = item.node.yogaNode
    if (!yoga || yoga.getDisplay() === LayoutDisplay.None) {
      leftoverGsDropCachedLayout(item.node)
      continue
    }
    const x = item.offsetX + yoga.getComputedLeft()
    const y = item.offsetY + yoga.getComputedTop()
    stampLayout(item.node, {
      x,
      y,
      width: yoga.getComputedWidth(),
      height: yoga.getComputedHeight(),
      top: yoga.getComputedTop(),
      unpainted: true,
    })
    const children = item.node.childNodes
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (child && child.nodeName !== '#text') {
        stack.push({
          node: child as DOMElement,
          offsetX: x,
          offsetY: y,
        })
      }
    }
  }
}

/** densable `uf` — absolute overlay rect + whether it sits inside parent yoga. */
export type AbsoluteRect = Rectangle & {
  withinParent: boolean
  /** densable `uf.node` — Ze walks this against the scroll content. */
  node: DOMElement
}

/**
 * densable nC(n,u) — n is a descendant of u (walk parentNode, not n itself).
 */
export function leftoverGsAbsIsDescendant(
  node: DOMElement | undefined,
  ancestor: DOMElement,
): boolean {
  for (
    let walk = node?.parentNode;
    walk !== undefined;
    walk = walk.parentNode
  ) {
    if (walk === ancestor) return true
  }
  return false
}

/**
 * densable Ze — a prev-frame absolute overlay sits under the scroll content.
 */
export function leftoverGsAbsPrevInContent(
  prev: AbsoluteRect[],
  content: DOMElement,
): boolean {
  return prev.some(rect => leftoverGsAbsIsDescendant(rect.node, content))
}

/**
 * densable overlayActive M:
 *   anchor&&focus&&!sqe || searchHighlightQuery || searchPositions
 */
export function leftoverGsOverlayActive(input: {
  anchor: { row: number; col: number } | null
  focus: { row: number; col: number } | null
  selectionBothEndsOff: boolean
  searchHighlightQuery: string
  searchPositions: unknown | null | undefined
}): boolean {
  return (
    (input.anchor !== null &&
      input.focus !== null &&
      !input.selectionBothEndsOff) ||
    Boolean(input.searchHighlightQuery) ||
    Boolean(input.searchPositions)
  )
}

/**
 * densable Kt extras after Bi / g / background / gC:
 *   !overlayActive && !Ze
 */
export function leftoverGsDecstbmOk(input: {
  prevScreen: boolean
  heightDeltaOk: boolean
  overlayActive: boolean
  absPrevInContent: boolean
  backgroundOk: boolean
}): boolean {
  return (
    input.prevScreen &&
    input.heightDeltaOk &&
    !input.overlayActive &&
    !input.absPrevInContent &&
    input.backgroundOk
  )
}

type LeftoverGsRawBgRewrite = {
  text: string
  color: Color
  levelGeneration: number
  out: string
}

/**
 * densable `xjo` / `M.sequenceFor(i)` — inherited bg SGR, then re-inject
 * after `\x1B[0m`, replace `\x1B[49m`, and after each newline.
 */
export function leftoverGsRewriteRawAnsiBg(text: string, color: Color): string {
  const seq = leftoverGsBgSequence(color)
  if (seq === '') return text
  return (
    seq +
    text
      .replaceAll('\x1b[0m', `\x1b[0m${seq}`)
      .replaceAll('\x1b[49m', seq)
      .replaceAll('\n', `\n${seq}`)
  )
}

/** densable `M.sequenceFor` — `${color}|${chalk.level}` then DualInk colorize bg prefix. */
const leftoverGsBgSequenceCache = new Map<string, string>()

function leftoverGsBgSequence(color: Color): string {
  const key = `${color}|${chalk.level}`
  const cached = leftoverGsBgSequenceCache.get(key)
  if (cached !== undefined) return cached
  const wrapped = colorize('\0', color, 'background')
  const idx = wrapped.indexOf('\0')
  const seq = idx <= 0 ? '' : wrapped.slice(0, idx)
  leftoverGsBgSequenceCache.set(key, seq)
  return seq
}

/**
 * densable `EC(n,u,f,m)` — cache by node + text + color + chalk.level.
 */
export function leftoverGsRawAnsiWrite(
  node: DOMElement,
  text: string,
  color: Color,
): string {
  const levelGeneration = chalk.level
  const hit = ctx.rawBgRewriteCache.get(node)
  if (
    hit &&
    hit.text === text &&
    hit.color === color &&
    hit.levelGeneration === levelGeneration
  ) {
    return hit.out
  }
  const out = leftoverGsRewriteRawAnsiBg(text, color)
  ctx.rawBgRewriteCache.set(node, {
    text,
    color,
    levelGeneration,
    out,
  })
  return out
}

export type RenderFrameContext = {
  overlayActive: boolean
  layoutShifted: boolean
  scrollHint: ScrollHint | null
  scrollDrainNode: DOMElement | null
  followScroll: FollowScroll | null
  absolutePaintCut: boolean
  absoluteRectsPrev: AbsoluteRect[]
  absoluteRectsCur: AbsoluteRect[]
  segmentMapScratch: Uint32Array
  rawBgRewriteCache: WeakMap<object, LeftoverGsRawBgRewrite>
  consumeClears: boolean
}

export function createRenderFrameContext(opts?: {
  consumeClears?: boolean
}): RenderFrameContext {
  return {
    overlayActive: false,
    layoutShifted: false,
    scrollHint: null,
    scrollDrainNode: null,
    followScroll: null,
    absolutePaintCut: false,
    absoluteRectsPrev: [],
    absoluteRectsCur: [],
    segmentMapScratch: new Uint32Array(0),
    rawBgRewriteCache: new WeakMap(),
    consumeClears: opts?.consumeClears ?? true,
  }
}

let ctx: RenderFrameContext = createRenderFrameContext()

export function runWithRenderFrameContext<T>(
  next: RenderFrameContext,
  fn: () => T,
): T {
  const prev = ctx
  ctx = next
  try {
    return fn()
  } finally {
    ctx = prev
  }
}

/** densable `oSf(e)` — one reset for every per-paint field. */
export function resetRenderFrameContext(): void {
  ctx.overlayActive = false
  ctx.layoutShifted = false
  ctx.scrollHint = null
  ctx.scrollDrainNode = null
  ctx.followScroll = null
  ctx.absolutePaintCut = false
  ctx.absoluteRectsPrev = ctx.absoluteRectsCur
  ctx.absoluteRectsCur = []
}

export function resetLayoutShifted(): void {
  ctx.layoutShifted = false
}

export function didLayoutShift(): boolean {
  return ctx.layoutShifted
}

export function resetScrollHint(): void {
  ctx.scrollHint = null
  ctx.followScroll = null
  ctx.absoluteRectsPrev = ctx.absoluteRectsCur
  ctx.absoluteRectsCur = []
}

export function getScrollHint(): ScrollHint | null {
  return ctx.scrollHint
}

export function resetScrollDrainNode(): void {
  ctx.scrollDrainNode = null
}

export function getScrollDrainNode(): DOMElement | null {
  return ctx.scrollDrainNode
}

export function consumeFollowScroll(): FollowScroll | null {
  const f = ctx.followScroll
  ctx.followScroll = null
  return f
}

/** densable `m.overlayActive=y.overlayActive` after Av. */
export function leftoverGsSetOverlayActive(active: boolean): void {
  ctx.overlayActive = active
}

// ── Native terminal drain (iTerm2/Ghostty/etc. — proportional events) ──
// Minimum rows applied per frame. Above this, drain is proportional (~3/4
// of remaining) so big bursts catch up in log₄ frames while the tail
// decelerates smoothly. Hard cap is innerHeight-1 so DECSTBM hint fires.
const SCROLL_MIN_PER_FRAME = 4

// ── xterm.js (VS Code) smooth drain ──
// Low pending (≤5) drains ALL in one frame — slow wheel clicks should be
// instant (click → visible jump → done), not micro-stutter 1-row frames.
// Higher pending drains at a small fixed step so fast-scroll animation
// stays smooth (no big jumps). Pending >MAX snaps excess.
const SCROLL_INSTANT_THRESHOLD = 5 // ≤ this: drain all at once
const SCROLL_HIGH_PENDING = 12 // threshold for HIGH step
const SCROLL_STEP_MED = 2 // pending (INSTANT, HIGH): catch-up
const SCROLL_STEP_HIGH = 3 // pending ≥ HIGH: fast flick
const SCROLL_MAX_PENDING = 30 // snap excess beyond this

// xterm.js adaptive drain. Returns rows applied; mutates pendingScrollDelta.
function drainAdaptive(
  node: DOMElement,
  pending: number,
  innerHeight: number,
): number {
  const sign = pending > 0 ? 1 : -1
  let abs = Math.abs(pending)
  let applied = 0
  // Snap excess beyond animation window so big flicks don't coast.
  if (abs > SCROLL_MAX_PENDING) {
    applied += sign * (abs - SCROLL_MAX_PENDING)
    abs = SCROLL_MAX_PENDING
  }
  // ≤5: drain all (slow click = instant). Above: small fixed step.
  const step =
    abs <= SCROLL_INSTANT_THRESHOLD
      ? abs
      : abs < SCROLL_HIGH_PENDING
        ? SCROLL_STEP_MED
        : SCROLL_STEP_HIGH
  applied += sign * step
  const rem = abs - step
  // Cap total at innerHeight-1 so DECSTBM blit+shift fast path fires
  // (matches drainProportional). Excess stays in pendingScrollDelta.
  const cap = Math.max(1, innerHeight - 1)
  const totalAbs = Math.abs(applied)
  if (totalAbs > cap) {
    const excess = totalAbs - cap
    node.pendingScrollDelta = sign * (rem + excess)
    return sign * cap
  }
  node.pendingScrollDelta = rem > 0 ? sign * rem : undefined
  return applied
}

// Native proportional drain. step = max(MIN, floor(abs*3/4)), capped at
// innerHeight-1 so DECSTBM + blit+shift fast path fire.
function drainProportional(
  node: DOMElement,
  pending: number,
  innerHeight: number,
): number {
  const abs = Math.abs(pending)
  const cap = Math.max(1, innerHeight - 1)
  const step = Math.min(cap, Math.max(SCROLL_MIN_PER_FRAME, (abs * 3) >> 2))
  if (abs <= step) {
    node.pendingScrollDelta = undefined
    return pending
  }
  const applied = pending > 0 ? step : -step
  node.pendingScrollDelta = pending - applied
  return applied
}

// OSC 8 hyperlink escape sequences. Empty params (;;) — ansi-tokenize only
// recognizes this exact prefix. The id= param (for grouping wrapped lines)
// is added at terminal-output time in termio/osc.ts link().
const OSC = '\u001B]'
const BEL = '\u0007'

function wrapWithOsc8Link(text: string, url: string): string {
  return `${OSC}8;;${url}${BEL}${text}${OSC}8;;${BEL}`
}

/**
 * Build a mapping from each character position in the plain text to its segment index.
 * Returns an array where charToSegment[i] is the segment index for character i.
 */
function buildCharToSegmentMap(segments: StyledSegment[]): number[] {
  const map: number[] = []
  for (let i = 0; i < segments.length; i++) {
    const len = segments[i]!.text.length
    for (let j = 0; j < len; j++) {
      map.push(i)
    }
  }
  return map
}

/**
 * densable `Bd` — apply styles to wrapped text by mapping each character
 * back to its original segment. Preserves per-segment styles across wraps.
 *
 * @param softWrapKinds densable `p` — per visual line SoftWrapKind. When the
 *   next line is ContinuationElidedSep, skip the leading space still present
 *   in originalPlain (elided from the wrapped piece).
 * @param trimEnabled wrap-trim: also skip whitespace trimmed from output.
 */
function applyStylesToWrappedText(
  wrappedPlain: string,
  segments: StyledSegment[],
  charToSegment: number[],
  originalPlain: string,
  trimEnabled: boolean = false,
  softWrapKinds?: readonly SoftWrapKindValue[],
): string {
  const lines = wrappedPlain.split('\n')
  const resultLines: string[] = []

  let charIndex = 0
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!

    // In trim mode, skip leading whitespace that was trimmed from this line.
    // Only skip if the original has whitespace but the output line doesn't start
    // with whitespace (meaning it was trimmed). If both have whitespace, the
    // whitespace was preserved and we shouldn't skip.
    if (trimEnabled && line.length > 0) {
      const lineStartsWithWhitespace = /\s/.test(line[0]!)
      const originalHasWhitespace =
        charIndex < originalPlain.length && /\s/.test(originalPlain[charIndex]!)

      // Only skip if original has whitespace but line doesn't
      if (originalHasWhitespace && !lineStartsWithWhitespace) {
        while (
          charIndex < originalPlain.length &&
          /\s/.test(originalPlain[charIndex]!)
        ) {
          charIndex++
        }
      }
    }

    let styledLine = ''
    let runStart = 0
    let runSegmentIndex = charToSegment[charIndex] ?? 0

    for (let i = 0; i < line.length; i++) {
      const currentSegmentIndex = charToSegment[charIndex] ?? runSegmentIndex

      if (currentSegmentIndex !== runSegmentIndex) {
        // Flush the current run
        const runText = line.slice(runStart, i)
        const segment = segments[runSegmentIndex]
        if (segment) {
          let styled = applyTextStyles(runText, segment.styles)
          if (segment.hyperlink) {
            styled = wrapWithOsc8Link(styled, segment.hyperlink)
          }
          styledLine += styled
        } else {
          styledLine += runText
        }
        runStart = i
        runSegmentIndex = currentSegmentIndex
      }

      charIndex++
    }

    // Flush the final run
    const runText = line.slice(runStart)
    const segment = segments[runSegmentIndex]
    if (segment) {
      let styled = applyTextStyles(runText, segment.styles)
      if (segment.hyperlink) {
        styled = wrapWithOsc8Link(styled, segment.hyperlink)
      }
      styledLine += styled
    } else {
      styledLine += runText
    }

    resultLines.push(styledLine)

    // Skip newline character in original that corresponds to this line break.
    // This is needed when the original text contains actual newlines (not just
    // wrapping-inserted newlines). Without this, charIndex gets out of sync
    // because the newline is in originalPlain/charToSegment but not in the
    // split lines.
    if (charIndex < originalPlain.length && originalPlain[charIndex] === '\r') {
      charIndex++
    }
    if (charIndex < originalPlain.length && originalPlain[charIndex] === '\n') {
      charIndex++
    }

    // densable Bd: next visual line elided a leading space — advance past it
    // in originalPlain so segment indices stay aligned.
    if (
      softWrapKinds?.[lineIdx + 1] === SoftWrapKind.ContinuationElidedSep &&
      charIndex < originalPlain.length &&
      originalPlain[charIndex] === ' '
    ) {
      charIndex++
    }

    // In trim mode, skip whitespace that was replaced by newline when wrapping.
    // We skip whitespace in the original until we reach a character that matches
    // the first character of the next line. This handles cases like:
    // - "AB   \tD" wrapped to "AB\n\tD" - skip spaces until we hit the tab
    // In non-trim mode, whitespace is preserved so no skipping is needed.
    if (trimEnabled && lineIdx < lines.length - 1) {
      const nextLine = lines[lineIdx + 1]!
      const nextLineFirstChar = nextLine.length > 0 ? nextLine[0] : null

      // Skip whitespace until we hit a char that matches the next line's first char
      while (
        charIndex < originalPlain.length &&
        /\s/.test(originalPlain[charIndex]!)
      ) {
        // Stop if we found the character that starts the next line
        if (
          nextLineFirstChar !== null &&
          originalPlain[charIndex] === nextLineFirstChar
        ) {
          break
        }
        charIndex++
      }
    }
  }

  return resultLines.join('\n')
}

/**
 * densable `qv` — wrap text and record SoftWrapKind per visual line.
 * Truncate modes never add newlines (cli-truncate is whole-string) so they
 * fall through with softWrap undefined.
 */
function wrapWithSoftWrap(
  plainText: string,
  maxWidth: number,
  textWrap: Parameters<typeof wrapText>[2],
): { wrapped: string; softWrap: SoftWrapKindValue[] | undefined } {
  // densable dtd/qv: wrap-stream uses wrap path then drops the incomplete last visual line
  const isStream = textWrap === 'wrap-stream'
  if (textWrap !== 'wrap' && textWrap !== 'wrap-trim' && !isStream) {
    return {
      wrapped: wrapText(plainText, maxWidth, textWrap),
      softWrap: undefined,
    }
  }
  const wrapMode = isStream ? 'wrap' : textWrap
  const origLines = plainText.replace(/\r\n?/g, '\n').split('\n')
  const outLines: string[] = []
  const softWrap: SoftWrapKindValue[] = []
  for (const orig of origLines) {
    const pieces = wrapText(orig, maxWidth, wrapMode).split('\n')
    for (let i = 0; i < pieces.length; i++) {
      if (i === 0) {
        outLines.push(pieces[i]!)
        softWrap.push(SoftWrapKind.HardBreak)
        continue
      }
      // densable qv: elide leading space on soft continuations; mark ElidedSep
      const raw = pieces[i]!
      const stripped = raw.startsWith(' ') ? raw.slice(1) : raw
      // densable Wr(N)>0 — keep raw if stripped has zero display width
      const piece = stringWidth(stripped) > 0 ? stripped : raw
      outLines.push(piece)
      softWrap.push(
        piece.length < raw.length
          ? SoftWrapKind.ContinuationElidedSep
          : SoftWrapKind.Continuation,
      )
    }
  }
  if (isStream) {
    outLines.pop()
    softWrap.pop()
  }
  return { wrapped: outLines.join('\n'), softWrap }
}

/**
 * densable `tC` — some ancestor is also `position:absolute`. Nested
 * overlays always count as overflowing for `uf`.
 */
function hasAbsoluteAncestor(node: DOMElement): boolean {
  for (let walk = node.parentNode; walk !== undefined; walk = walk.parentNode) {
    if (walk.style.position === 'absolute') return true
  }
  return false
}

/**
 * densable `uf` — stamp an absolute overlay rect. `withinParent` is yoga
 * parent containment and no absolute ancestor.
 */
function stampAbsoluteRect(
  node: DOMElement,
  rect: Rectangle,
  parentX?: number,
  parentY?: number,
): AbsoluteRect {
  const parentYoga = node.parentNode?.yogaNode
  const withinParent =
    parentYoga !== undefined &&
    !hasAbsoluteAncestor(node) &&
    parentX !== undefined &&
    parentY !== undefined &&
    rect.x >= parentX &&
    rect.y >= parentY &&
    rect.x + rect.width <= parentX + parentYoga.getComputedWidth() &&
    rect.y + rect.height <= parentY + parentYoga.getComputedHeight()
  return {
    node,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    withinParent,
  }
}

export function getAbsolutePaintCut(): boolean {
  return ctx.absolutePaintCut
}

/**
 * densable `Nv` — a prev overflowing absolute vanished and a blit still
 * covers that rect.
 */
export function vanishedOverflowingAbsoluteBlit(output: Output): boolean {
  const cur = ctx.absoluteRectsCur
  return ctx.absoluteRectsPrev.some(
    prev =>
      !prev.withinParent &&
      !cur.some(
        next =>
          next.x === prev.x &&
          next.y === prev.y &&
          next.width === prev.width &&
          next.height === prev.height,
      ) &&
      output.blitsOver(prev),
  )
}

// If parent container is `<Box>`, text nodes will be treated as separate nodes in
// the tree and will have their own coordinates in the layout.
// To ensure text nodes are aligned correctly, take X and Y of the first text node
// and use it as offset for the rest of the nodes
// Only first node is taken into account, because other text nodes can't have margin or padding,
// so their coordinates will be relative to the first node anyway
function applyPaddingToText(
  node: DOMElement,
  text: string,
  softWrap?: SoftWrapKindValue[],
): string {
  const yogaNode = node.childNodes[0]?.yogaNode

  if (yogaNode) {
    const offsetX = yogaNode.getComputedLeft()
    const offsetY = yogaNode.getComputedTop()
    text = '\n'.repeat(offsetY) + indentString(text, offsetX)
    if (softWrap && offsetY > 0) {
      // densable _E: prepend HardBreak for each padding line
      softWrap.unshift(
        ...Array<SoftWrapKindValue>(offsetY).fill(SoftWrapKind.HardBreak),
      )
    }
  }

  return text
}

// After nodes are laid out, render each to output object, which later gets rendered to terminal
function renderNodeToOutput(
  node: DOMElement,
  output: Output,
  {
    offsetX = 0,
    offsetY = 0,
    prevScreen,
    skipSelfBlit = false,
    inheritedBackgroundColor,
    clips,
    depth = 0,
  }: {
    offsetX?: number
    offsetY?: number
    prevScreen: Screen | undefined
    // Force this node to descend instead of blitting its own rect, while
    // still passing prevScreen to children. Used for non-opaque absolute
    // overlays over a dirty clipped region: the overlay's full rect has
    // transparent gaps (stale underlying content in prevScreen), but its
    // opaque descendants' narrower rects are safe to blit.
    skipSelfBlit?: boolean
    inheritedBackgroundColor?: Color
    /** densable Gs `clips:x` — nested overflow clip (pC). */
    clips?: LeftoverClipNest
    /** densable 2.1.218 `Zlt` walk depth */
    depth?: number
  },
): void {
  // densable: if (l>=Zlt) { yir("renderNodeToOutput", e.nodeName); return }
  if (depth >= MAX_TREE_DEPTH) {
    warnTreeDepthExceeded('renderNodeToOutput', node.nodeName)
    return
  }

  const { yogaNode } = node

  if (yogaNode) {
    if (yogaNode.getDisplay() === LayoutDisplay.None) {
      // Clear old position if node was visible before becoming hidden
      if (node.dirty) {
        const cached = node.cachedLayout
        if (cached) {
          output.clear({
            x: Math.floor(cached.x),
            y: Math.floor(cached.y),
            width: Math.floor(cached.width),
            height: Math.floor(cached.height),
          })
          // Drop descendants' cache too — hideInstance's markDirty walks UP
          // only, so descendants' .dirty stays false. Their nodeCache entries
          // survive with pre-hide rects. On unhide, if position didn't shift,
          // the blit check at line ~432 passes and copies EMPTY cells from
          // prevScreen (cleared here) → content vanishes.
          leftoverGsDropCachedLayout(node)
          ctx.layoutShifted = true
        }
      }
      node.hasEscapingDescendant = false
      node.paintsPastRect = false
      return
    }

    // Left and top positions in Yoga are relative to their parent node
    const x = offsetX + yogaNode.getComputedLeft()
    const yogaTop = yogaNode.getComputedTop()
    let y = offsetY + yogaTop
    const width = yogaNode.getComputedWidth()
    const height = yogaNode.getComputedHeight()

    // Absolute-positioned overlays (e.g. autocomplete menus with bottom='100%')
    // can compute negative screen y when they extend above the viewport. Without
    // clamping, setCellAt drops cells at y<0, clipping the TOP of the content
    // (best matches in an autocomplete). By clamping to 0, we shift the element
    // down so the top rows are visible and the bottom overflows below — the
    // opaque prop ensures it paints over whatever is underneath.
    if (y < 0 && node.style.position === 'absolute') {
      y = 0
    }

    // Check if we can skip this subtree (clean node with unchanged layout).
    // Blit cells from previous screen instead of re-rendering.
    const cached = node.cachedLayout
    if (
      !node.dirty &&
      !skipSelfBlit &&
      node.pendingScrollDelta === undefined &&
      cached &&
      cached.x === x &&
      cached.y === y &&
      cached.width === width &&
      cached.height === height &&
      cached.background === inheritedBackgroundColor &&
      prevScreen &&
      !leftoverGsSkipBlitMiss(node, cached, clips)
    ) {
      const fx = Math.floor(x)
      const fy = Math.floor(y)
      const fw = Math.floor(width)
      const fh = Math.floor(height)
      output.blit(prevScreen, fx, fy, fw, fh, {
        restoreNoSelect: node.style.opaque,
      })
      if (node.style.position === 'absolute') {
        ctx.absoluteRectsCur.push(
          stampAbsoluteRect(node, cached, offsetX, offsetY),
        )
      }
      leftoverGsSkipBlitOverlay(node, output, prevScreen, fx, fy, fw, fh)
      return
    }

    // Clear stale content from the old position when re-rendering.
    // Dirty: content changed. Moved: position/size changed (e.g., sibling
    // above changed height), old cells still on the terminal.
    const positionChanged =
      cached !== undefined &&
      (cached.x !== x ||
        cached.y !== y ||
        cached.width !== width ||
        cached.height !== height)
    if (positionChanged) {
      ctx.layoutShifted = true
    }
    if (cached && (node.dirty || positionChanged)) {
      output.clear(
        {
          x: Math.floor(cached.x),
          y: Math.floor(cached.y),
          width: Math.floor(cached.width),
          height: Math.floor(cached.height),
        },
        node.style.position === 'absolute',
      )
    }

    // Read before deleting — hasRemovedChild disables prevScreen blitting
    // for siblings to prevent stale overflow content from being restored.
    const clears = pendingClears.get(node)
    const hasRemovedChild = clears !== undefined
    if (hasRemovedChild) {
      ctx.layoutShifted = true
      for (const rect of clears) {
        output.clear({
          x: Math.floor(rect.x),
          y: Math.floor(rect.y),
          width: Math.floor(rect.width),
          height: Math.floor(rect.height),
        })
      }
      if (ctx.consumeClears) pendingClears.delete(node)
    }

    // Yoga squeezed this node to zero height (overflow in a height-constrained
    // parent) AND a sibling lands at the same y. Skip rendering — both would
    // write to the same row; if the sibling's content is shorter, this node's
    // tail chars ghost (e.g. "false" + "true" = "truee"). The clear above
    // already handled the visible→squeezed transition.
    //
    // The sibling-overlap check is load-bearing: Yoga's pixel-grid rounding
    // can give a box h=0 while still leaving a row for it (next sibling at
    // y+1, not y). HelpV2's third shortcuts column hits this — skipping
    // unconditionally drops "ctrl + z to suspend" from /help output.
    if (height === 0 && siblingSharesY(node, yogaNode)) {
      stampLayout(node, {
        x,
        y,
        width,
        height,
        top: yogaTop,
        background: inheritedBackgroundColor,
      })
      node.hasEscapingDescendant = false
      node.paintsPastRect = false
      for (const child of node.childNodes) {
        if (child.nodeName !== '#text') {
          leftoverGsStampUnpainted(child as DOMElement, x, y)
        }
      }
      node.dirty = false
      return
    }

    // densable Gs `K` — clip nest only on ink-box; stamp after all nodeName arms.
    let leftoverNodeClip: LeftoverClip | undefined

    if (node.nodeName === 'ink-raw-ansi') {
      // Pre-rendered ANSI content. The producer already wrapped to width and
      // emitted terminal-ready escape codes. Skip squash, measure, wrap, and
      // style re-application — output.write() parses ANSI directly into cells.
      const text = node.attributes['rawText'] as string
      if (typeof text === 'string' && text) {
        output.write(
          x,
          y,
          inheritedBackgroundColor
            ? leftoverGsRawAnsiWrite(node, text, inheritedBackgroundColor)
            : text,
        )
      }
    } else if (node.nodeName === 'ink-text') {
      const segments = squashTextNodesToSegments(
        node,
        inheritedBackgroundColor
          ? { backgroundColor: inheritedBackgroundColor }
          : undefined,
      )

      // First, get plain text to check if wrapping is needed
      const plainText = segments.map(s => s.text).join('')

      if (plainText.length > 0) {
        // Upstream Ink uses getMaxWidth(yogaNode) unclamped here. That
        // width comes from Yoga's AtMost pass and can exceed the actual
        // screen space (see getMaxWidth docstring). Yoga's height for this
        // node already reflects the constrained Exactly pass, so clamping
        // the wrap width here keeps line count consistent with layout.
        // Without this, characters past the screen edge are dropped by
        // setCellAt's bounds check.
        const maxWidth = Math.min(getMaxWidth(yogaNode), output.width - x)
        const textWrap = node.style.textWrap ?? 'wrap'

        // densable: wrap-stream always runs the wrap path (hide incomplete last line)
        const needsWrapping =
          textWrap === 'wrap-stream' || widestLine(plainText) > maxWidth

        let text: string
        let softWrap: SoftWrapKindValue[] | undefined
        if (needsWrapping && segments.length === 1) {
          // Single segment: wrap plain text first, then apply styles to each line
          const segment = segments[0]!
          const w = wrapWithSoftWrap(plainText, maxWidth, textWrap)
          softWrap = w.softWrap
          text = w.wrapped
            .split('\n')
            .map(line => {
              let styled = applyTextStyles(line, segment.styles)
              // Apply OSC 8 hyperlink per-line so each line is independently
              // clickable. output.ts splits on newlines and tokenizes each
              // line separately, so a single wrapper around the whole block
              // would only apply the hyperlink to the first line.
              if (segment.hyperlink) {
                styled = wrapWithOsc8Link(styled, segment.hyperlink)
              }
              return styled
            })
            .join('\n')
        } else if (needsWrapping) {
          // Multiple segments with wrapping: wrap plain text first, then re-apply
          // each segment's styles based on character positions. This preserves
          // per-segment styles even when text wraps across lines.
          const w = wrapWithSoftWrap(plainText, maxWidth, textWrap)
          softWrap = w.softWrap
          const charToSegment = buildCharToSegmentMap(segments)
          text = applyStylesToWrappedText(
            w.wrapped,
            segments,
            charToSegment,
            plainText,
            textWrap === 'wrap-trim',
            w.softWrap,
          )
          // Hyperlinks are handled per-run in applyStylesToWrappedText via
          // wrapWithOsc8Link, similar to how styles are applied per-run.
        } else {
          // No wrapping needed: apply styles directly
          text = segments
            .map(segment => {
              let styledText = applyTextStyles(segment.text, segment.styles)
              if (segment.hyperlink) {
                styledText = wrapWithOsc8Link(styledText, segment.hyperlink)
              }
              return styledText
            })
            .join('')
        }

        text = applyPaddingToText(node, text, softWrap)

        output.write(x, y, text, softWrap)
      }
    } else if (node.nodeName === 'ink-box') {
      const boxBackgroundColor =
        node.style.backgroundColor ?? inheritedBackgroundColor

      // Mark this box's region as non-selectable (fullscreen text
      // selection). noSelect ops are applied AFTER blits/writes in
      // output.get(), so this wins regardless of what's rendered into
      // the region — including blits from prevScreen when the box is
      // clean (the op is emitted on both the dirty-render path here
      // AND on the blit fast-path at line ~235 since blitRegion copies
      // the noSelect bitmap alongside cells).
      //
      // 'from-left-edge' extends the exclusion from col 0 so any
      // upstream indentation (tool prefix, tree lines) is covered too
      // — a multi-row drag over a diff gutter shouldn't pick up the
      // `  ⎿  ` prefix on row 0 or the blank cells under it on row 1+.
      if (node.style.noSelect) {
        const boxX = Math.floor(x)
        const fromEdge = node.style.noSelect === 'from-left-edge'
        output.noSelect({
          x: fromEdge ? 0 : boxX,
          y: Math.floor(y),
          width: fromEdge ? boxX + Math.floor(width) : Math.floor(width),
          height: Math.floor(height),
        })
      }

      const overflowX = node.style.overflowX ?? node.style.overflow
      const overflowY = node.style.overflowY ?? node.style.overflow
      const clipHorizontally = overflowX === 'hidden' || overflowX === 'scroll'
      const clipVertically = overflowY === 'hidden' || overflowY === 'scroll'
      const isScrollY = overflowY === 'scroll'

      const needsClip = clipHorizontally || clipVertically
      let y1: number | undefined
      let y2: number | undefined
      if (needsClip) {
        const x1 = clipHorizontally
          ? x + yogaNode.getComputedBorder(LayoutEdge.Left)
          : undefined

        const x2 = clipHorizontally
          ? x +
            yogaNode.getComputedWidth() -
            yogaNode.getComputedBorder(LayoutEdge.Right)
          : undefined

        y1 = clipVertically
          ? y + yogaNode.getComputedBorder(LayoutEdge.Top)
          : undefined

        y2 = clipVertically
          ? y +
            yogaNode.getComputedHeight() -
            yogaNode.getComputedBorder(LayoutEdge.Bottom)
          : undefined

        output.clip({ x1, x2, y1, y2 })
      }

      leftoverNodeClip = needsClip
        ? {
            x1: clipHorizontally
              ? x + yogaNode.getComputedBorder(LayoutEdge.Left)
              : undefined,
            x2: clipHorizontally
              ? x +
                yogaNode.getComputedWidth() -
                yogaNode.getComputedBorder(LayoutEdge.Right)
              : undefined,
            y1,
            y2,
          }
        : undefined
      const leftoverChildClips = prevScreen
        ? leftoverGsClipNest(clips, leftoverNodeClip, cached?.clip)
        : clips

      if (isScrollY) {
        // Scroll containers follow the ScrollBox component structure:
        // a single content-wrapper child with flexShrink:0 (doesn't shrink
        // to fit), whose children are the scrollable items. scrollHeight
        // comes from the wrapper's intrinsic Yoga height. The wrapper is
        // rendered with its Y translated by -scrollTop; its children are
        // culled against the visible window.
        const padTop = yogaNode.getComputedPadding(LayoutEdge.Top)
        const padBottom = yogaNode.getComputedPadding(LayoutEdge.Bottom)
        const innerHeight = Math.max(
          0,
          (y2 ?? y + height) - (y1 ?? y) - padTop - padBottom,
        )

        const content = node.childNodes.find(c => (c as DOMElement).yogaNode) as
          | DOMElement
          | undefined
        const contentYoga = content?.yogaNode
        // scrollHeight is the intrinsic height of the content wrapper.
        // Do NOT add getComputedTop() — that's the wrapper's offset
        // within the viewport (equal to the scroll container's
        // paddingTop), and innerHeight already subtracts padding, so
        // including it double-counts padding and inflates maxScroll.
        const scrollHeight = contentYoga?.getComputedHeight() ?? 0
        // Capture previous scroll bounds BEFORE overwriting — the at-bottom
        // follow check compares against last frame's max.
        const prevScrollHeight = node.scrollHeight ?? scrollHeight
        const prevInnerHeight = node.scrollViewportHeight ?? innerHeight
        node.scrollHeight = scrollHeight
        node.scrollViewportHeight = innerHeight
        // Absolute screen-buffer row where the scrollable area (inside
        // padding) begins. Exposed via ScrollBoxHandle.getViewportTop() so
        // drag-to-scroll can detect when the drag leaves the scroll viewport.
        node.scrollViewportTop = (y1 ?? y) + padTop

        const maxScroll = Math.max(0, scrollHeight - innerHeight)
        // scrollAnchor: scroll so the anchored element's top is at the
        // viewport top (plus offset). Yoga is FRESH — same calculateLayout
        // pass that just produced scrollHeight. Deterministic alternative
        // to scrollTo(N) which bakes a number that's stale by the throttled
        // render; the element ref defers the read to now. One-shot snap.
        // A prior eased-seek version (proportional drain over ~5 frames)
        // moved scrollTop without firing React's notify → parent's quantized
        // store snapshot never updated → StickyTracker got stale range props
        // → firstVisible wrong. Also: SCROLL_MIN_PER_FRAME=4 with snap-at-1
        // ping-ponged forever at delta=2. Smooth needs drain-end notify
        // plumbing; shipping instant first. stickyScroll overrides.
        // Official 2.1.207: block "nearest" keeps the element in view without
        // jumping when already fully visible.
        if (node.scrollAnchor) {
          const anchorYoga = node.scrollAnchor.el.yogaNode
          const anchorTop = anchorYoga?.getComputedTop()
          if (anchorTop != null && anchorYoga) {
            const offset = node.scrollAnchor.offset
            const elH = anchorYoga.getComputedHeight()
            // densable ScrollBox block align (SEA ~193325900):
            // Be = top+offset (start), _t = top+height-viewport (end).
            // Tall items clamp end/center to Be so the top stays reachable.
            const startTarget = anchorTop + offset
            const endTarget = anchorTop + elH - innerHeight
            const block =
              node.scrollAnchor.block ??
              (node.scrollAnchor.nearest ? 'nearest' : 'start')
            // Clamp to [0, maxScroll] BEFORE write — near-bottom overshoot
            // must not land past max and falsely trip followGrowth re-stick.
            const clampAnchor = (y: number): number =>
              Math.max(0, Math.min(maxScroll, y))
            if (block === 'nearest' || node.scrollAnchor.nearest) {
              // gold: min(max(current, endTarget), startTarget)
              const cur = node.scrollTop ?? 0
              node.scrollTop = clampAnchor(
                Math.min(Math.max(cur, endTarget), startTarget),
              )
            } else if (block === 'end') {
              node.scrollTop = clampAnchor(
                Math.max(0, Math.min(endTarget, startTarget)),
              )
            } else if (block === 'center') {
              node.scrollTop = clampAnchor(
                Math.max(
                  0,
                  Math.min(
                    Math.floor((endTarget + startTarget) / 2),
                    startTarget,
                  ),
                ),
              )
            } else {
              // start
              node.scrollTop = clampAnchor(startTarget)
            }
            node.pendingScrollDelta = undefined
          }
          node.scrollAnchor = undefined
        }
        // At-bottom follow + scrollHeightHwm (official 2.1.207).
        // While not sticky, track a high-water content height so a transient
        // shrink (markdown freeze / virtual remount) does not clamp scrollTop
        // downward and jump the transcript above the answer. Positional
        // follow uses max(hwm, prev) as the previous max; stored scrollTop
        // may exceed content maxScroll; paint uses visual clamp only.
        // Gold followScroll is after visual clamp: kn=at-(scrollTopRendered??at).
        const scrollTopBeforeFollow = node.scrollTop ?? 0
        const stickyAttr = node.attributes['stickyScroll']
        const sticky = node.stickyScroll ?? Boolean(stickyAttr)
        const { referenceHeight, nextHwm } = updateScrollHeightHwm({
          sticky,
          prevScrollHeight,
          scrollHeight,
          scrollHeightHwm: node.scrollHeightHwm,
        })
        node.scrollHeightHwm = nextHwm
        const prevMaxAgainstHwm = Math.max(0, referenceHeight - prevInnerHeight)
        // Positional check only valid when content grew — virtualization can
        // transiently SHRINK scrollHeight (tail unmount + stale heightCache
        // spacer) making scrollTop >= prevMax true by artifact, not because
        // the user was at bottom.
        const grew = scrollHeight >= prevScrollHeight
        // followGrowth defaults true; stickyScroll={false} attr disables
        // positional follow (official: stickyAttr !== false && followGrowth).
        const followGrowth = node.attributes['followGrowth'] !== false
        const atBottom = shouldFollowScrollGrowth({
          sticky,
          stickyAttr,
          followGrowth,
          grew,
          scrollTop: scrollTopBeforeFollow,
          prevMaxAgainstHwm,
        })
        if (atBottom && (node.pendingScrollDelta ?? 0) >= 0) {
          node.scrollTop = maxScroll
          node.pendingScrollDelta = undefined
          // Sync flag so useVirtualScroll's isSticky() agrees with positional
          // state — sticky-broken-but-at-bottom (wheel tremor, click-select
          // at max) otherwise leaves useVirtualScroll's clamp holding the
          // viewport short of new streaming content. scrollTo/scrollBy set
          // false; this restores true, same as scrollToBottom() would.
          // Only restore when (a) positionally at bottom and (b) the flag
          // was explicitly broken (===false) by scrollTo/scrollBy. When
          // undefined (never set by user action) leave it alone — setting it
          // would make the sticky flag sticky-by-default and lock out
          // direct scrollTop writes (e.g. the alt-screen-perf test).
          if (
            node.stickyScroll === false &&
            scrollTopBeforeFollow >= prevMaxAgainstHwm
          ) {
            node.stickyScroll = true
          }
        }
        // Gold densable 2.1.251: yt = stickyScroll ?? Boolean(attr).
        // Visual clamp is `cn = un && !yt ? clamp(et) : et` — skip APPLY when
        // sticky, do NOT delete scrollClampMin/Max. Clearing the fields here
        // left the next unsticky wheel frame without a clamp until
        // useLayoutEffect rewrote bounds → drain painted into spacer (blank
        // screen + Jump to bottom).
        const liveSticky = node.stickyScroll ?? Boolean(stickyAttr)
        // Drain pendingScrollDelta. Native terminals (proportional burst
        // events) use proportional drain; xterm.js (VS Code, sparse events +
        // app-side accel curve) uses adaptive small-step drain. isXtermJs()
        // depends on the async XTVERSION probe, but by the time this runs
        // (pendingScrollDelta is only set by wheel events, >>50ms after
        // startup) the probe has resolved — same timing guarantee the
        // wheel-accel curve relies on.
        let cur = node.scrollTop ?? 0
        const pending = node.pendingScrollDelta
        const cMin = node.scrollClampMin
        const cMax = node.scrollClampMax
        const haveClamp = cMin !== undefined && cMax !== undefined
        if (pending !== undefined && pending !== 0) {
          // Drain continues even past the clamp — the render-clamp below
          // holds the VISUAL at the mounted edge regardless. Hard-stopping
          // here caused stop-start jutter: drain hits edge → pause → React
          // commits → clamp widens → drain resumes → edge again. Letting
          // scrollTop advance smoothly while the clamp lags gives continuous
          // visual scroll at React's commit rate (the clamp catches up each
          // commit). But THROTTLE the drain when already past the clamp so
          // scrollTop doesn't race 5000 rows ahead of the mounted range
          // (slide-cap would then take 200 commits to catch up = long
          // perceived stall at the edge). Past-clamp drain caps at ~4 rows/
          // frame, roughly matching React's slide rate so the gap stays
          // bounded and catch-up is quick once input stops.
          const pastClamp =
            haveClamp &&
            ((pending < 0 && cur < cMin) || (pending > 0 && cur > cMax))
          const eff = pastClamp ? Math.min(4, innerHeight >> 3) : innerHeight
          cur += isXtermJsHost()
            ? drainAdaptive(node, pending, eff)
            : drainProportional(node, pending, eff)
        } else if (pending === 0) {
          // Opposite scrollBy calls cancelled to zero — clear so we don't
          // schedule an infinite loop of no-op drain frames.
          node.pendingScrollDelta = undefined
        }
        // Official 2.1.207: stored scrollTop may stay above content maxScroll
        // when HWM is active (transient shrink). Visual paint always clamps
        // to real maxScroll so we never paint past content.
        const storedScrollTop = clampStoredScrollTop(
          cur,
          maxScroll,
          referenceHeight,
          innerHeight,
        )
        let scrollTop = clampVisualScrollTop(storedScrollTop, maxScroll)
        // Virtual-scroll clamp: if scrollTop raced past the currently-mounted
        // range (burst PageUp before React re-renders), render at the EDGE of
        // the mounted children instead of blank spacer. Do NOT write back to
        // node.scrollTop — the clamped value is for this paint only; the real
        // scrollTop stays so React's next commit sees the target and mounts
        // the right range. Not scheduling scrollDrainNode here keeps the
        // clamp passive — React's commit → resetAfterCommit → onRender will
        // paint again with fresh bounds.
        const clamped = applyVirtualScrollRangeClamp(
          scrollTop,
          cMin,
          cMax,
          liveSticky,
        )
        node.scrollTop = storedScrollTop
        // Clamp hitting top/bottom consumes any remainder. Set drainPending
        // only after clamp so a wasted no-op frame isn't scheduled.
        if (storedScrollTop !== cur) node.pendingScrollDelta = undefined
        if (node.pendingScrollDelta !== undefined) ctx.scrollDrainNode = node
        scrollTop = clamped
        const leftoverGsKn = leftoverGsFollowDelta(
          scrollTop,
          node.scrollTopRendered,
        )
        if (leftoverGsKn !== 0) {
          const leftoverGsTe = node.scrollViewportTop ?? 0
          ctx.followScroll = {
            delta: leftoverGsKn,
            viewportLeft: Math.floor(x),
            viewportRight: Math.floor(x + width) - 1,
            viewportTop: leftoverGsTe,
            viewportBottom: leftoverGsTe + innerHeight - 1,
          }
        }
        node.scrollTopRendered = scrollTop

        if (content && contentYoga) {
          // Compute content wrapper's absolute render position with scroll
          // offset applied, then render its children with culling.
          const contentX = x + contentYoga.getComputedLeft()
          const contentY = y + contentYoga.getComputedTop() - scrollTop
          // layoutShifted detection gap: when scrollTop moves by >= viewport
          // height (batched PageUps, fast wheel), every visible child gets
          // culled (cache dropped) and every newly-visible child has no
          // cache — so the children's positionChanged check can't fire.
          // The content wrapper's cached y (which encodes -scrollTop) is
          // the only node that survives to witness the scroll.
          const contentCached = content.cachedLayout
          // densable sf `_t=Be!==void 0&&Be.width===Ce.getComputedWidth()`
          const leftoverGsWidthUnchanged =
            contentCached !== undefined &&
            contentCached.width === contentYoga.getComputedWidth()
          let hint: ScrollHint | null = null
          let leftoverGsHn = false
          if (contentCached && contentCached.y !== contentY) {
            const captured = leftoverGsHint({
              contentCachedY: contentCached.y,
              contentY,
              containerCached: cached
                ? { y: cached.y, height: cached.height }
                : undefined,
              containerX: x,
              containerY: y,
              containerWidth: width,
              containerHeight: height,
              outputWidth: output.width,
              innerHeight,
              prevInnerHeight,
              padBottom,
              clipTop: y1 ?? y,
              viewportTop: node.scrollViewportTop ?? y,
            })
            if (captured.hint) {
              hint = captured.hint
              leftoverGsHn = captured.hn
              ctx.scrollHint = hint
            } else {
              ctx.layoutShifted = true
            }
          }
          // Fast path: scroll (hint captured) with usable prevScreen.
          // Blit prevScreen's scroll region into next.screen, shift in-place
          // by delta (mirrors DECSTBM), then render ONLY the edge rows. The
          // nested clip keeps child writes out of stable rows — a tall child
          // that spans edge+stable still renders but stable cells are
          // clipped, preserving the blit. Avoids re-rendering every visible
          // child (expensive for long syntax-highlighted transcripts).
          //
          // When content.dirty (e.g. streaming text at the bottom of the
          // scroll), we still use the fast path — the dirty child is almost
          // always in the edge rows (the bottom, where new content appears).
          // After edge rendering, any dirty children in stable rows are
          // re-rendered in a second pass to avoid showing stale blitted
          // content.
          //
          // Guard: the fast path only handles pure scroll or bottom-append.
          // Child removal/insertion changes the content height in a way that
          // doesn't match the scroll delta — fall back to the full path so
          // removed children don't leave stale cells and shifted siblings
          // render at their new positions.
          const scrollHeight = contentYoga.getComputedHeight()
          const prevHeight = contentCached?.height ?? scrollHeight
          const heightDelta = scrollHeight - prevHeight
          const safeForFastPath =
            !hint ||
            heightDelta === 0 ||
            (hint.delta > 0 && heightDelta === hint.delta)
          // densable Gs `Kt` — `j?.background===M`. Inherited fill change
          // must miss DECSTBM blit or hover tint sticks on the scroll region.
          const leftoverGsBackgroundOk =
            cached?.background === inheritedBackgroundColor &&
            leftoverGsFastPathClipOk(leftoverChildClips, cached, {
              x,
              y,
              width,
              height,
            })
          const leftoverGsKt = leftoverGsDecstbmOk({
            prevScreen: Boolean(prevScreen),
            heightDeltaOk: safeForFastPath,
            overlayActive: ctx.overlayActive,
            absPrevInContent: leftoverGsAbsPrevInContent(
              ctx.absoluteRectsPrev,
              content,
            ),
            backgroundOk: leftoverGsBackgroundOk,
          })
          // Gold: if (Jt && !Kt) f.scrollHint = null
          if (hint && !leftoverGsKt) ctx.scrollHint = null
          if (hint && prevScreen && leftoverGsKt) {
            const { top, bottom, delta } = hint
            const w = Math.floor(width)
            const leftoverViewportTop = Math.floor(node.scrollViewportTop ?? y)
            let leftoverGsOverlap = 0
            if (delta > 0 && leftoverViewportTop > top) {
              for (const childNode of content.childNodes) {
                const childYoga = (childNode as DOMElement).yogaNode
                if (!childYoga) continue
                const childTop = childYoga.getComputedTop()
                if (childTop + childYoga.getComputedHeight() > scrollTop) {
                  leftoverGsOverlap = leftoverGsJr({
                    delta,
                    viewportTop: leftoverViewportTop,
                    hintTop: top,
                    scrollTop,
                    firstChildTop: childTop,
                  })
                  break
                }
              }
            }
            const leftoverGsWin = leftoverGsBlitWindow({
              hint,
              hn: leftoverGsHn,
              viewportTop: leftoverViewportTop,
              innerHeight,
              prevInnerHeight,
              jr: leftoverGsOverlap,
            })
            output.blit(
              prevScreen,
              Math.floor(x),
              leftoverGsWin.blitY,
              w,
              leftoverGsWin.blitHeight,
              leftoverGsWin.unclipped ? { unclipped: true } : undefined,
            )
            output.shift(top, bottom, delta)
            const edgeTop = leftoverGsWin.edgeTop
            const edgeBottom = leftoverGsWin.edgeBottom
            // Snapshot dirty children before the first pass — the first
            // pass clears dirty flags, and edge-spanning children would be
            // missed by the second pass without this snapshot.
            const dirtyChildren = content.dirty
              ? new Set(content.childNodes.filter(c => (c as DOMElement).dirty))
              : null
            if (leftoverGsWin.paintEdge) {
              output.clear({
                x: Math.floor(x),
                y: leftoverGsWin.clearY,
                width: w,
                height: edgeBottom - leftoverGsWin.clearY + 1,
              })
              output.clip({
                x1: undefined,
                x2: undefined,
                y1: leftoverGsWin.clearY,
                y2: edgeBottom + 1,
              })
              renderScrolledChildren(
                content,
                output,
                contentX,
                contentY,
                hasRemovedChild,
                undefined,
                // Cull to edge in child-local coords (inverse of contentY offset).
                edgeTop - contentY,
                edgeBottom + 1 - contentY,
                boxBackgroundColor,
                undefined,
                leftoverGsWidthUnchanged,
                true,
                depth + 2,
              )
              output.unclip()
            }

            // Second pass: re-render children in stable rows whose screen
            // position doesn't match where the shift put their old pixels.
            // Covers TWO cases:
            //   1. Dirty children — their content changed, blitted pixels are
            //      stale regardless of position.
            //   2. Clean children BELOW a middle-growth point — when a dirty
            //      sibling above them grows, their yogaTop increases but
            //      scrollTop increases by the same amount (sticky), so their
            //      screenY is CONSTANT. The shift moved their old pixels to
            //      screenY-delta (wrong); they should stay at screenY. Without
            //      this, the spinner/tmux-monitor ghost at shifted positions
            //      during streaming (e.g. triple spinner, pill duplication).
            //   For bottom-append (the common case), all clean children are
            //   ABOVE the growth point; their screenY decreased by delta and
            //   the shift put them at the right place — skipped here, fast
            //   path preserved.
            if (dirtyChildren) {
              const edgeTopLocal = edgeTop - contentY
              const edgeBottomLocal = edgeBottom + 1 - contentY
              const spaces = ' '.repeat(w)
              // Track cumulative height change of children iterated so far.
              // A clean child's yogaTop is unchanged iff this is zero (no
              // sibling above it grew/shrank/mounted). When zero, the skip
              // check cached.y−delta === screenY reduces to delta === delta
              // (tautology) → skip without yoga reads. Restores O(dirty)
              // that #24536 traded away: for bottom-append the dirty child
              // is last (all clean children skip); for virtual-scroll range
              // shift the topSpacer shrink + new-item heights self-balance
              // to zero before reaching the clean block. Middle-growth
              // leaves shift non-zero → clean children after the growth
              // point fall through to yoga + the fine-grained check below,
              // preserving the ghost-box fix.
              let cumHeightShift = 0
              let leftoverGsFirstRepaintY: number | undefined
              for (const childNode of content.childNodes) {
                const childElem = childNode as DOMElement
                const isDirty = dirtyChildren.has(childNode)
                if (!isDirty && cumHeightShift === 0) {
                  if (childElem.cachedLayout !== undefined) continue
                  // Uncached = culled last frame, now re-entering. blit
                  // never painted it → fall through to yoga + render.
                  // Height unchanged (clean), so cumHeightShift stays 0.
                }
                const cy = childElem.yogaNode
                if (!cy) continue
                const childTop = cy.getComputedTop()
                const childH = cy.getComputedHeight()
                const childBottom = childTop + childH
                if (isDirty) {
                  const prev = childElem.cachedLayout
                  cumHeightShift += childH - (prev ? prev.height : 0)
                }
                // Skip culled children (outside viewport)
                if (
                  childBottom <= scrollTop ||
                  childTop >= scrollTop + innerHeight
                )
                  continue
                // Skip children entirely within edge rows (already rendered)
                if (childTop >= edgeTopLocal && childBottom <= edgeBottomLocal)
                  continue
                const screenY = Math.floor(contentY + childTop)
                // Clean children reaching here have cumHeightShift ≠ 0 OR
                // no cache. Re-check precisely: cached.y − delta is where
                // the shift left old pixels; if it equals new screenY the
                // blit is correct (shift re-balanced at this child, or
                // yogaTop happens to net out). No cache → blit never
                // painted it → render.
                if (!isDirty) {
                  const childCached = childElem.cachedLayout
                  if (childCached) {
                    const shiftedY = Math.floor(childCached.y) - delta
                    if (shiftedY === screenY) continue
                    const stale = leftoverGsStaleWipe({
                      shiftedY,
                      cachedHeight: childCached.height,
                      hintTop: top,
                      hintBottom: bottom,
                      firstRepaintY: leftoverGsFirstRepaintY,
                    })
                    if (stale) {
                      output.write(
                        Math.floor(x),
                        stale.y,
                        Array(stale.height).fill(spaces).join('\n'),
                      )
                    }
                  }
                }
                // Wipe this child's region with spaces to overwrite stale
                // blitted content — output.clear() only expands damage and
                // cannot zero cells that the blit already wrote.
                const screenBottom = Math.min(
                  Math.floor(contentY + childBottom),
                  Math.floor((y1 ?? y) + padTop + innerHeight),
                )
                if (screenY < screenBottom) {
                  leftoverGsFirstRepaintY ??= screenY
                  const fill = Array(screenBottom - screenY)
                    .fill(spaces)
                    .join('\n')
                  output.write(Math.floor(x), screenY, fill)
                  output.clip({
                    x1: undefined,
                    x2: undefined,
                    y1: screenY,
                    y2: screenBottom,
                  })
                  renderNodeToOutput(childElem, output, {
                    offsetX: contentX,
                    offsetY: contentY,
                    prevScreen: undefined,
                    inheritedBackgroundColor: boxBackgroundColor,
                    depth: depth + 1,
                  })
                  output.unclip()
                }
              }
            }

            // Third pass: repair rows where shifted copies of absolute
            // overlays landed. The blit copied prevScreen cells INCLUDING
            // overlay pixels (overlays render AFTER this ScrollBox so they
            // painted into prevScreen's scroll region). After shift, those
            // pixels sit at (rect.y - delta) — neither edge render nor the
            // overlay's own re-render covers them. Wipe and re-render
            // ScrollBox content so the diff writes correct cells.
            const spaces = ctx.absoluteRectsPrev.length ? ' '.repeat(w) : ''
            const absBeforeRepair = ctx.absoluteRectsCur.length
            for (const r of ctx.absoluteRectsPrev) {
              if (r.y >= bottom + 1 || r.y + r.height <= top) continue
              const shiftedTop = Math.max(top, Math.floor(r.y) - delta)
              const shiftedBottom = Math.min(
                bottom + 1,
                Math.floor(r.y + r.height) - delta,
              )
              // Skip if entirely within edge rows (already rendered).
              if (shiftedTop >= edgeTop && shiftedBottom <= edgeBottom + 1)
                continue
              if (shiftedTop >= shiftedBottom) continue
              const fill = Array(shiftedBottom - shiftedTop)
                .fill(spaces)
                .join('\n')
              output.write(Math.floor(x), shiftedTop, fill)
              output.clip({
                x1: undefined,
                x2: undefined,
                y1: shiftedTop,
                y2: shiftedBottom,
              })
              renderScrolledChildren(
                content,
                output,
                contentX,
                contentY,
                hasRemovedChild,
                undefined,
                shiftedTop - contentY,
                shiftedBottom - contentY,
                boxBackgroundColor,
                undefined,
                leftoverGsWidthUnchanged,
                true,
                depth + 2,
              )
              output.unclip()
            }
            for (
              let i = absBeforeRepair;
              i < ctx.absoluteRectsCur.length;
              i++
            ) {
              if (!ctx.absoluteRectsCur[i]!.withinParent) {
                ctx.absolutePaintCut = true
                break
              }
            }
          } else {
            // Full path. Two sub-cases:
            //
            // Scrolled without a usable hint (big jump, container moved):
            // child positions in prevScreen are stale. Clear the viewport
            // and disable blit so children don't restore shifted content.
            //
            // No scroll (spinner tick, content edit): child positions in
            // prevScreen are still valid. Skip the viewport clear and pass
            // prevScreen so unchanged children blit. Dirty children already
            // self-clear via their own cached-rect clear. Without this, a
            // spinner inside ScrollBox forces a full-content rewrite every
            // frame — on wide terminals over tmux (no BSU/ESU) the
            // bandwidth crosses the chunk boundary and the frame tears.
            const scrolled = contentCached && contentCached.y !== contentY
            if (scrolled && y1 !== undefined && y2 !== undefined) {
              output.clear({
                x: Math.floor(x),
                y: Math.floor(y1),
                width: Math.floor(width),
                height: Math.floor(y2 - y1),
              })
            }
            // positionChanged (ScrollBox height shrunk — pill mount) means a
            // child spanning the old bottom edge would blit its full cached
            // rect past the new clip. output.ts clips blits now, but also
            // disable prevScreen here so the partial-row child re-renders at
            // correct bounds instead of blitting a clipped (truncated) old
            // rect.
            renderScrolledChildren(
              content,
              output,
              contentX,
              contentY,
              hasRemovedChild,
              scrolled || positionChanged ? undefined : prevScreen,
              scrollTop,
              scrollTop + innerHeight,
              boxBackgroundColor,
              leftoverChildClips,
              leftoverGsWidthUnchanged,
              false,
              depth + 2,
            )
          }
          stampLayout(content, {
            x: contentX,
            y: contentY,
            width: contentYoga.getComputedWidth(),
            height: contentYoga.getComputedHeight(),
            background: boxBackgroundColor,
          })
          content.dirty = false
        }
        node.hasEscapingDescendant = false
      } else {
        // Fill interior with background color before rendering children.
        // This covers padding areas and empty space; child text inherits
        // the color via inheritedBackgroundColor so written cells also
        // get the background.
        // Disable prevScreen for children: the fill overwrites the entire
        // interior each render, so child blits from prevScreen would restore
        // stale cells (wrong bg if it changed) on top of the fresh fill.
        const ownBackgroundColor = node.style.backgroundColor
        if (node.style.opaque) {
          output.clearNoSelect({
            x: Math.floor(x),
            y: Math.floor(y),
            width: Math.floor(width),
            height: Math.floor(height),
          })
        }
        if (ownBackgroundColor || node.style.opaque) {
          const borderLeft = yogaNode.getComputedBorder(LayoutEdge.Left)
          const borderRight = yogaNode.getComputedBorder(LayoutEdge.Right)
          const borderTop = yogaNode.getComputedBorder(LayoutEdge.Top)
          const borderBottom = yogaNode.getComputedBorder(LayoutEdge.Bottom)
          const innerWidth = Math.floor(width) - borderLeft - borderRight
          const innerHeight = Math.floor(height) - borderTop - borderBottom
          if (innerWidth > 0 && innerHeight > 0) {
            const spaces = ' '.repeat(innerWidth)
            const fillLine = ownBackgroundColor
              ? applyTextStyles(spaces, { backgroundColor: ownBackgroundColor })
              : spaces
            const fill = Array(innerHeight).fill(fillLine).join('\n')
            output.write(x + borderLeft, y + borderTop, fill)
          }
        }

        const escapedFromChildren = renderChildren(
          node,
          output,
          x,
          y,
          hasRemovedChild,
          // backgroundColor and opaque both disable child blit: the fill
          // overwrites the entire interior each render, so any child whose
          // layout position shifted would blit stale cells from prevScreen
          // on top of the fresh fill. Previously opaque kept blit enabled
          // on the assumption that plain-space fill + unchanged children =
          // valid composite, but children CAN reposition (ScrollBox remeasure
          // on re-render → /permissions body blanked on Down arrow, #25436).
          ownBackgroundColor || node.style.opaque ? undefined : prevScreen,
          boxBackgroundColor,
          leftoverChildClips,
          depth,
        )
        node.hasEscapingDescendant = needsClip ? false : escapedFromChildren
      }

      if (needsClip) {
        output.unclip()
      }

      renderBorder(x, y, node, output)
    } else if (node.nodeName === 'ink-root') {
      node.hasEscapingDescendant = renderChildren(
        node,
        output,
        x,
        y,
        hasRemovedChild,
        prevScreen,
        inheritedBackgroundColor,
        clips,
        depth,
      )
    }

    // densable Gs: stamp after ink-box AND ink-root (and text/raw-ansi).
    // R6 hitTest is `if(!y)return null` — root without cache kills click/hover.
    const rect = {
      x,
      y,
      width,
      height,
      top: yogaTop,
      background: inheritedBackgroundColor,
      clip: leftoverNodeClip,
    }
    stampLayout(node, rect)
    if (node.style.position === 'absolute') {
      ctx.absoluteRectsCur.push(stampAbsoluteRect(node, rect, offsetX, offsetY))
    }
    node.dirty = false
  }
}

// Overflow contamination: content overflows right/down, so clean siblings
// AFTER a dirty/removed sibling can contain stale overflow in prevScreen.
// Disable blit for siblings after a dirty child — but still pass prevScreen
// TO the dirty child itself so its clean descendants can blit. The dirty
// child's own blit check already fails (node.dirty=true at line 216), so
// passing prevScreen only benefits its subtree.
// For removed children we don't know their original position, so
// conservatively disable blit for all.
//
// Clipped children (overflow hidden/scroll on both axes) cannot overflow
// onto later siblings — their content is confined to their layout bounds.
// Skip the contamination guard for them so later siblings can still blit.
// Without this, a spinner inside a ScrollBox dirties the wrapper on every
// tick and the bottom prompt section never blits → 100% writes every frame.
//
// Exception: absolute-positioned clipped children may have layout bounds
// that overlap arbitrary siblings, so the clipping does not help.
//
// Overlap contamination (seenDirtyClipped): a later ABSOLUTE sibling whose
// rect sits inside a dirty clipped child's bounds would blit stale cells
// from prevScreen — the clipped child just rewrote those cells this frame.
// The clipsBothAxes skip only protects against OVERFLOW (clipped child
// painting outside its bounds), not overlap (absolute sibling painting
// inside them). For non-opaque absolute siblings, skipSelfBlit forces
// descent (the full-width rect has transparent gaps → stale blit) while
// still passing prevScreen so opaque descendants can blit their narrower
// rects (NewMessagesPill's inner Text with backgroundColor). Opaque
// absolute siblings fill their entire rect — direct blit is safe.
function renderChildren(
  node: DOMElement,
  output: Output,
  offsetX: number,
  offsetY: number,
  hasRemovedChild: boolean,
  prevScreen: Screen | undefined,
  inheritedBackgroundColor: Color | undefined,
  clips: LeftoverClipNest | undefined,
  depth = 0,
): boolean {
  let seenDirtyChild = false
  let seenDirtyClipped = false
  let escaped = false
  let descendantPaintsPast = false
  const parentRight = offsetX + (node.yogaNode?.getComputedWidth() ?? 0)
  const parentBottom = offsetY + (node.yogaNode?.getComputedHeight() ?? 0)
  const leftoverGsF =
    prevScreen !== undefined && leftoverGsAbsChildMoved(node, offsetX, offsetY)
  const leftoverGsL =
    prevScreen === undefined
      ? undefined
      : leftoverGsEscapingDirtyPoisons(node, offsetX, offsetY)
  for (const childNode of node.childNodes) {
    const childElem = childNode as DOMElement
    // Capture dirty before rendering — renderNodeToOutput clears the flag
    const wasDirty = childElem.dirty
    const isAbsolute = childElem.style.position === 'absolute'
    renderNodeToOutput(childElem, output, {
      offsetX,
      offsetY,
      prevScreen:
        hasRemovedChild ||
        seenDirtyChild ||
        (leftoverGsF && !isAbsolute) ||
        leftoverGsL?.has(childElem) === true ||
        (seenDirtyClipped && childElem.hasEscapingDescendant === true)
          ? undefined
          : prevScreen,
      // Short-circuits on seenDirtyClipped (false in the common case) so
      // the opaque/bg reads don't happen per-child per-frame.
      skipSelfBlit:
        seenDirtyClipped &&
        isAbsolute &&
        !childElem.style.opaque &&
        childElem.style.backgroundColor === undefined,
      inheritedBackgroundColor,
      clips,
      depth: depth + 1,
    })
    if (wasDirty && !seenDirtyChild) {
      if (!clipsBothAxes(childElem) || isAbsolute) {
        seenDirtyChild = true
      } else {
        seenDirtyClipped = true
      }
    }
    if (!escaped) {
      const layout = childElem.cachedLayout
      if (
        childElem.hasEscapingDescendant ||
        (layout !== undefined &&
          !isAbsolute &&
          (layout.x < offsetX ||
            layout.y < offsetY ||
            layout.x + layout.width > parentRight ||
            layout.y + layout.height > parentBottom))
      ) {
        escaped = true
      }
    }
    descendantPaintsPast ||= childElem.paintsPastRect === true
  }
  node.paintsPastRect =
    !clipsBothAxes(node) && (escaped || descendantPaintsPast)
  return escaped
}

function clipsBothAxes(node: DOMElement): boolean {
  const ox = node.style.overflowX ?? node.style.overflow
  const oy = node.style.overflowY ?? node.style.overflow
  return (
    (ox === 'hidden' || ox === 'scroll') && (oy === 'hidden' || oy === 'scroll')
  )
}

// When Yoga squeezes a box to h=0, the ghost only happens if a sibling
// lands at the same computed top — then both write to that row and the
// shorter content leaves the longer's tail visible. Yoga's pixel-grid
// rounding can give h=0 while still advancing the next sibling's top
// (HelpV2's third shortcuts column), so h=0 alone isn't sufficient.
function siblingSharesY(node: DOMElement, yogaNode: LayoutNode): boolean {
  const parent = node.parentNode
  if (!parent) return false
  const myTop = yogaNode.getComputedTop()
  const siblings = parent.childNodes
  const idx = siblings.indexOf(node)
  for (let i = idx + 1; i < siblings.length; i++) {
    const sib = (siblings[i] as DOMElement).yogaNode
    if (!sib) continue
    return sib.getComputedTop() === myTop
  }
  // No next sibling with a yoga node — check previous. A run of h=0 boxes
  // at the tail would all share y with each other.
  for (let i = idx - 1; i >= 0; i--) {
    const sib = (siblings[i] as DOMElement).yogaNode
    if (!sib) continue
    return sib.getComputedTop() === myTop
  }
  return false
}

/**
 * densable bC — reverse-DFS overlay blit after skip-blit.
 * Absolute: stamp absoluteRectsCur. Abs OR escaping: blit if outside parent
 * rect, restoreNoSelect:opaque. Recurse only hasAbsoluteDescendant or
 * (escapingWalk && hasEscapingDescendant). Skip unpainted.
 */
function leftoverGsSkipBlitOverlay(
  node: DOMElement,
  output: Output,
  prevScreen: Screen,
  px: number,
  py: number,
  pw: number,
  ph: number,
): void {
  if (!node.hasAbsoluteDescendant && !node.hasEscapingDescendant) return
  const pr = px + pw
  const pb = py + ph
  const stack: DOMElement[] = []
  const escapingWalk: boolean[] = []
  const pushChildren = (parent: DOMElement, walkEscaping: boolean) => {
    const children = parent.childNodes
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (child && child.nodeName !== '#text') {
        stack.push(child as DOMElement)
        escapingWalk.push(walkEscaping)
      }
    }
  }
  pushChildren(node, node.hasEscapingDescendant === true)
  for (let cur = stack.pop(); cur !== undefined; cur = stack.pop()) {
    const walkEscaping = escapingWalk.pop() === true
    const cached = leftoverGsCached(cur)
    if (cached && !cached.unpainted) {
      const isAbsolute = cur.style.position === 'absolute'
      if (isAbsolute) {
        const parentLayout = leftoverGsCached(cur.parentNode)
        ctx.absoluteRectsCur.push(
          stampAbsoluteRect(cur, cached, parentLayout?.x, parentLayout?.y),
        )
      }
      if (isAbsolute || walkEscaping) {
        const cx = Math.floor(cached.x)
        const cy = Math.floor(cached.y)
        const cw = Math.floor(cached.width)
        const ch = Math.floor(cached.height)
        if (cx < px || cy < py || cx + cw > pr || cy + ch > pb) {
          output.blit(prevScreen, cx, cy, cw, ch, {
            restoreNoSelect: cur.style.opaque,
          })
        }
      }
    }
    const childWalk = walkEscaping && cur.hasEscapingDescendant === true
    if (cur.hasAbsoluteDescendant || childWalk) {
      pushChildren(cur, childWalk)
    }
  }
}

// Render children of a scroll container with viewport culling.
// scrollTopY..scrollBottomY are the visible window in CHILD-LOCAL Yoga coords
// (i.e. what getComputedTop() returns). Children entirely outside this window
// are skipped; their nodeCache entry is deleted so if they re-enter the
// viewport later they don't emit a stale clear for a position now occupied
// by a sibling.
function renderScrolledChildren(
  node: DOMElement,
  output: Output,
  offsetX: number,
  offsetY: number,
  hasRemovedChild: boolean,
  prevScreen: Screen | undefined,
  scrollTopY: number,
  scrollBottomY: number,
  inheritedBackgroundColor: Color | undefined,
  clips: LeftoverClipNest | undefined,
  // densable sf `_t` — content wrap width unchanged. Gold:
  //   if (F && K?.top !== void 0 && !Z.dirty && B===0) use cache
  leftoverGsWidthUnchanged: boolean,
  // When true (DECSTBM fast path), culled children keep their cache —
  // the blit+shift put stable rows in next.screen so stale cache is
  // never read. Avoids walking O(total_children * subtree_depth) per frame.
  preserveCulledCache = false,
  depth = 0,
): void {
  let seenDirtyChild = false
  // Track cumulative height shift of dirty children iterated so far. When
  // zero, a clean child's yogaTop is unchanged (no sibling above it grew),
  // so cached.top is fresh and the cull check skips yoga. Bottom-append
  // has the dirty child last → all prior clean children hit cache →
  // O(dirty) not O(mounted). Middle-growth leaves shift non-zero after
  // the dirty child → subsequent children yoga-read (needed for correct
  // culling since their yogaTop shifted).
  let cumHeightShift = 0
  for (const childNode of node.childNodes) {
    const childElem = childNode as DOMElement
    const cy = childElem.yogaNode
    if (cy) {
      const cached = childElem.cachedLayout
      let top: number
      let height: number
      if (
        leftoverGsWidthUnchanged &&
        cached?.top !== undefined &&
        !childElem.dirty &&
        cumHeightShift === 0
      ) {
        top = cached.top
        height = cached.height
      } else {
        top = cy.getComputedTop()
        height = cy.getComputedHeight()
        if (childElem.dirty) {
          cumHeightShift += height - (cached ? cached.height : 0)
        }
        // Refresh cached top so next frame's cumShift===0 path stays
        // correct. For culled children with preserveCulledCache=true this
        // is the ONLY refresh point — without it, a middle-growth frame
        // leaves stale tops that misfire next frame.
        if (cached) cached.top = top
      }
      const bottom = top + height
      if (bottom <= scrollTopY || top >= scrollBottomY) {
        // densable sf: if (!L) lst(Z). Gold 0: cull is lst, not SC.
        if (!preserveCulledCache) leftoverGsDropCachedLayout(childElem)
        continue
      }
    }
    const wasDirty = childElem.dirty
    renderNodeToOutput(childElem, output, {
      offsetX,
      offsetY,
      prevScreen: hasRemovedChild || seenDirtyChild ? undefined : prevScreen,
      inheritedBackgroundColor,
      clips,
      depth: depth + 1,
    })
    if (wasDirty) {
      seenDirtyChild = true
    }
  }
}

// Exported for testing
export { buildCharToSegmentMap, applyStylesToWrappedText }

export default renderNodeToOutput
