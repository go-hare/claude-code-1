/**
 * densable `tSs` / `wTg` / `J$0` — serialize Ink screen rows to ANSI for Axc.
 * Gold: gold-project-c-xxc-host.txt / gold-project-c-wTg-tSs.txt
 */

import type { DOMElement } from './dom.js'
import type { Frame } from './frame.js'
import instances from './instances.js'
import { NATIVE_HISTORY_CAP } from './nativeHistoryPump.js'
import { nodeCache } from './node-cache.js'
import Output from './output.js'
import renderNodeToOutput, {
  createRenderFrameContext,
  runWithRenderFrameContext,
} from './render-node-to-output.js'
import {
  cellAtIndex,
  createScreen,
  type Screen,
  type StylePool,
} from './screen.js'
import { LINK_END, link } from './termio/osc.js'

const SGR_RESET = '\x1b[0m'

/**
 * densable `nCi(e)` — walk subtree and clear cachedLayout (skip #text).
 * Tip maps cachedLayout ↔ nodeCache.
 */
function clearCachedLayoutSubtree(root: DOMElement): void {
  const stack: DOMElement[] = [root]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    nodeCache.delete(node)
    const children = node.childNodes
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (child && child.nodeName !== '#text') {
        stack.push(child as DOMElement)
      }
    }
  }
}

/**
 * densable `tSs(screen, stylePool, row)` — trim trailing blank cells, emit
 * styled ANSI for one screen row.
 */
export function serializeScreenRow(
  screen: Screen,
  stylePool: StylePool,
  row: number,
): string {
  const n = screen.width
  const o = row * n
  let i = -1
  for (let c = n - 1; c >= 0; c--) {
    const u = cellAtIndex(screen, o + c)
    if (u.width === 2) continue
    if (u.char === ' ' && (u.styleId & 1) === 0 && u.hyperlink === undefined) {
      continue
    }
    i = c
    break
  }
  if (i < 0) return ''
  let s = ''
  let a = stylePool.none
  let l: string | undefined
  for (let c = 0; c <= i; c++) {
    const u = cellAtIndex(screen, o + c)
    if (u.width === 2 || u.width === 3) continue
    if (u.hyperlink !== l) {
      if (l !== undefined) s += LINK_END
      if (u.hyperlink !== undefined) s += link(u.hyperlink)
      l = u.hyperlink
    }
    s += stylePool.transition(a, u.styleId)
    a = u.styleId
    s += u.char
  }
  if (l !== undefined) s += LINK_END
  if (a !== stylePool.none) s += SGR_RESET
  return s
}

/**
 * densable `wTg(frame, stylePool, node)` — serialize absolute rows covered
 * by a node's cachedLayout. Tip maps cachedLayout ↔ nodeCache. Gold has
 * no Yoga-sum fallback: missing or height<=0 cache → [].
 */
export function serializeNodeRows(
  frame: Frame,
  stylePool: StylePool,
  node: DOMElement | null | undefined,
): string[] {
  if (!node) return []
  const layout = nodeCache.get(node)
  if (!layout || layout.height <= 0) return []
  const out: string[] = []
  const end = Math.min(layout.y + layout.height, frame.screen.height)
  for (let s = Math.max(0, layout.y); s < end; s++) {
    out.push(serializeScreenRow(frame.screen, stylePool, s))
  }
  return out
}

/**
 * densable `J$0(scrollEl, from, to, cols, stylePool)` — offscreen-paint the
 * scroll content child for `[from,to)` into a temp Screen, serialize rows
 * for `Axc.primeBackfill`. Caps span at `uyn` (NATIVE_HISTORY_CAP).
 *
 * Tip maps densable `cachedLayout` ↔ `nodeCache`. Gold J$0: unclip → nCi
 * subtree clear → restore root cache → get() → `i.dirty = true`.
 */
export function serializeGapBackfill(
  scrollEl: DOMElement,
  from: number,
  to: number,
  cols: number,
  stylePool: StylePool,
): string[] {
  // densable J$0: `let i=e.childNodes[0];if(!i)return[]` — do not skip #text.
  const content = scrollEl.childNodes[0] as DOMElement | undefined
  if (!content) return []
  if ((scrollEl.scrollHeight ?? 0) <= 0 || to <= from) return []
  const ink = instances.get(process.stdout)
  if (!ink) return []

  const end = Math.ceil(to)
  const start = Math.max(0, Math.floor(from), end - NATIVE_HISTORY_CAP)
  const height = end - start
  if (height <= 0) return []

  const screen = createScreen(
    cols,
    height,
    stylePool,
    ink.getCharPool(),
    ink.getHyperlinkPool(),
  )
  const output = new Output({
    width: cols,
    height,
    stylePool,
    screen,
  })
  output.clip({ x1: undefined, x2: undefined, y1: 0, y2: height })
  const prevCache = nodeCache.get(content)
  // densable J$0: `v9r(i, p, b9r(), {offsetX:0, offsetY:-c, prevScreen:void 0})`.
  // Local renderNodeToOutput closes over module ctx; swap in a fresh b9r()
  // so offscreen backfill does not leak layoutShifted / absoluteRectsCur
  // into the live frame. Do not invent dropSubtreeCache here — gold nCi
  // runs after unclip (below).
  // consumeClears: pendingClears is keyed by DOMElement in node-cache, not held
  // on ctx, so this pass walks the same entries the live frame needs. Paint
  // them, leave them.
  runWithRenderFrameContext(
    createRenderFrameContext({ consumeClears: false }),
    () => {
      renderNodeToOutput(content, output, {
        offsetX: 0,
        offsetY: -start,
        prevScreen: undefined,
      })
    },
  )
  output.unclip()
  // densable J$0: nCi(i); if (f) i.cachedLayout = f; i.dirty = true
  clearCachedLayoutSubtree(content)
  if (prevCache) nodeCache.set(content, prevCache)
  const rendered = output.get()
  content.dirty = true

  const lines: string[] = []
  for (let g = 0; g < height; g++) {
    lines.push(serializeScreenRow(rendered, stylePool, g))
  }
  return lines
}

/**
 * densable `X$0(anchor, scrollRoot)` — sum yoga tops from anchor up to
 * (but not including) scrollRoot; used as transcriptEnd fallback.
 */
export function transcriptEndOffset(
  anchor: DOMElement | null | undefined,
  scrollRoot: DOMElement,
): number | undefined {
  if (!anchor) return undefined
  let r = 0
  let n: DOMElement | null | undefined = anchor
  while (n && n.parentNode !== scrollRoot) {
    r += n.yogaNode?.getComputedTop() ?? 0
    n = n.parentNode
  }
  return n ? r : undefined
}

export function absoluteYogaLayout(
  node: DOMElement,
): { x: number; y: number; width: number; height: number } | null {
  if (!node.yogaNode) return null
  let x = 0
  let y = 0
  let n: DOMElement | null | undefined = node
  while (n?.yogaNode) {
    x += n.yogaNode.getComputedLeft()
    y += n.yogaNode.getComputedTop()
    n = n.parentNode
  }
  return {
    x,
    y,
    width: node.yogaNode.getComputedWidth(),
    height: node.yogaNode.getComputedHeight(),
  }
}
