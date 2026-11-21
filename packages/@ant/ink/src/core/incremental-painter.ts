import chalk from 'chalk'
import { type DOMElement, markDirty } from './dom.js'
import { LayoutDisplay, LayoutEdge, type LayoutNode } from './layout/node.js'
import { MAX_TREE_DEPTH, warnTreeDepthExceeded } from './maxTreeDepth.js'
import type Output from './output.js'
import {
  computeClipRect,
  formatTextForPaint,
  getMaxWidth,
  getScrollContent,
  isScrollContainer,
  leftoverGsDropCachedLayout,
  leftoverGsRewriteRawAnsiBg,
  leftoverGsStampUnpainted,
  paintBoxBackground,
  type RenderFrameContext,
  renderBorder,
  settleScrollBoxPosition,
  siblingSharesY,
  stampLayout,
} from './render-node-to-output.js'
import {
  clipRightEdgeWideGraphemes,
  copyRows,
  createScreen,
  resetScreen,
  type Screen,
  type StylePool,
} from './screen.js'
import type { Color } from './styles.js'

type NodePaintCache = NonNullable<DOMElement['paintCache']>

/**
 * Official 2.1.328 `Lm` — row-level incremental painter used when `firstRow`
 * slices the painted viewport. Tracks per-node `paintCache` (`changed`:
 * `'self' | 'child'`) and a per-row `damaged` bitmap so clean rows are
 * bulk-copied from `previous` via `copyRows` (`oi`) while only damaged row
 * runs are re-drawn.
 */
export class IncrementalPainter {
  private readonly output: Output
  private readonly state: RenderFrameContext
  private readonly stylePool: StylePool
  private previous: Screen | undefined
  private previousFirstRow = 0
  private styleGeneration = 0
  private markedRightEdge = false
  private finished = false
  private damaged = new Uint8Array(0)
  private firstRow = 0
  private colorLevel = 0
  private readonly scrolling: DOMElement[] = []

  constructor(output: Output, state: RenderFrameContext, stylePool: StylePool) {
    this.output = output
    this.state = state
    this.stylePool = stylePool
  }

  paint(
    root: DOMElement,
    screen: Screen,
    firstRow: number,
    markRightEdge: boolean,
  ): void {
    const { output, previous } = this
    const { width, height } = output
    const canReusePrevious =
      this.finished &&
      previous?.width === width &&
      previous.hyperlinkPool === screen.hyperlinkPool &&
      this.styleGeneration === this.stylePool.generation &&
      this.markedRightEdge === markRightEdge

    if (!this.finished) {
      const stack: DOMElement[] = [root]
      while (stack.length > 0) {
        const cur = stack.pop()!
        cur.paintCache = undefined
        for (const child of cur.childNodes) {
          if (child.nodeName !== '#text') {
            stack.push(child)
          }
        }
      }
    }

    this.finished = false
    this.firstRow = firstRow
    this.colorLevel = chalk.level
    if (this.damaged.length < height) {
      this.damaged = new Uint8Array(height)
    }
    this.damaged.fill(1)
    if (canReusePrevious && previous) {
      const shift = this.previousFirstRow - firstRow
      this.damaged.fill(
        0,
        Math.max(0, shift),
        Math.max(0, shift + previous.height),
      )
    }

    const viewBottom = firstRow + height + 1
    this.update(root, 0, 0, firstRow, viewBottom, undefined, false, 0)
    for (const scrollNode of this.scrolling.splice(0)) {
      markDirty(scrollNode)
    }

    for (let row = 0, end = 0; row < height; row = end) {
      const isDamaged = this.damaged[row]
      while (end < height && this.damaged[end] === isDamaged) end++
      if (isDamaged) {
        output.clip({ x1: undefined, x2: undefined, y1: row, y2: end })
        this.draw(root, firstRow + row, firstRow + end)
        output.unclip()
      } else if (previous) {
        const srcRow = firstRow + row - this.previousFirstRow
        copyRows(screen, row, previous, srcRow, end - row)
      }
    }

    output.get()
    if (markRightEdge) {
      clipRightEdgeWideGraphemes(screen, output.rowsAtRightEdge)
    }

    const { charPool, hyperlinkPool } = screen
    this.previous ??= createScreen(
      0,
      0,
      this.stylePool,
      charPool,
      hyperlinkPool,
    )
    resetScreen(this.previous, width, height)
    copyRows(this.previous, 0, screen, 0, height)
    this.previous.hyperlinkPool = hyperlinkPool
    this.previousFirstRow = firstRow
    this.styleGeneration = this.stylePool.generation
    this.markedRightEdge = markRightEdge
    this.finished = true
  }

  private damage(cache: NodePaintCache | undefined): void {
    if (cache !== undefined && cache.shownTop < cache.shownBottom) {
      this.damaged.fill(
        1,
        Math.max(0, cache.shownTop - this.firstRow),
        Math.max(0, cache.shownBottom - this.firstRow),
      )
    }
  }

  private hide(node: DOMElement): void {
    const cache = node.paintCache
    if (cache !== undefined) {
      this.damage(cache)
      cache.shownTop = 0
      cache.shownBottom = 0
    }
    leftoverGsDropCachedLayout(node)
  }

  private update(
    node: DOMElement,
    offsetX: number,
    offsetY: number,
    viewTop: number,
    viewBottom: number,
    inheritedBg: Color | undefined,
    ancestorDamaged: boolean,
    depth: number,
  ): void {
    if (depth >= MAX_TREE_DEPTH) {
      warnTreeDepthExceeded('paint', node.nodeName)
      leftoverGsDropCachedLayout(node)
      return
    }
    const yogaNode = node.yogaNode
    if (!yogaNode || yogaNode.getDisplay() === LayoutDisplay.None) {
      this.hide(node)
      node.paintCache = undefined
      return
    }

    const x = offsetX + yogaNode.getComputedLeft()
    let y = offsetY + yogaNode.getComputedTop()
    const width = yogaNode.getComputedWidth()
    const height = yogaNode.getComputedHeight()
    if (y < 0 && node.style.position === 'absolute') {
      y = 0
    }

    const squeezed = height === 0 && siblingSharesY(node, yogaNode)
    const { paintCache, cachedLayout } = node
    const selfUnchanged =
      paintCache !== undefined &&
      paintCache.changed !== 'self' &&
      paintCache.x === x &&
      paintCache.width === width &&
      paintCache.height === height &&
      paintCache.screenWidth === this.output.width &&
      paintCache.background === inheritedBg &&
      paintCache.colorLevel === this.colorLevel &&
      paintCache.squeezed === squeezed
    const layoutUnchanged =
      selfUnchanged &&
      paintCache.y === y &&
      cachedLayout !== undefined &&
      !cachedLayout.unpainted
    const needsSubtreeVisit = !selfUnchanged || paintCache.changed !== undefined

    if (!needsSubtreeVisit && paintCache) {
      const shownTop = Math.max(y + paintCache.top, viewTop)
      const shownBottom = Math.min(y + paintCache.bottom, viewBottom)
      if (
        shownTop >= shownBottom &&
        (paintCache.y === y || !node.hasAbsoluteDescendant)
      ) {
        this.hide(node)
        paintCache.y = y
        return
      }
      if (
        layoutUnchanged &&
        paintCache.shownTop === shownTop &&
        paintCache.shownBottom === shownBottom
      ) {
        return
      }
    }

    const shouldDamage = !layoutUnchanged && !ancestorDamaged
    if (shouldDamage) {
      this.damage(paintCache)
    }
    if (!layoutUnchanged) {
      stampLayout(node, { x, y, width, height })
      this.state.layoutShifted = true
    }
    node.pendingClears = undefined

    const nextCache: NodePaintCache = selfUnchanged
      ? paintCache
      : {
          changed: undefined,
          x,
          y,
          width,
          height,
          screenWidth: this.output.width,
          background: inheritedBg,
          colorLevel: this.colorLevel,
          squeezed,
          top: 0,
          bottom: Math.max(1, height),
          shownTop: 0,
          shownBottom: 0,
          lines: undefined,
          softWrap: undefined,
        }

    node.paintCache = nextCache
    nextCache.changed = undefined
    nextCache.y = y
    node.dirty = false

    if (squeezed) {
      for (const child of node.childNodes) {
        if (child.nodeName !== '#text') {
          leftoverGsStampUnpainted(child, x, y)
        }
      }
    } else if (
      node.nodeName === 'ink-text' ||
      node.nodeName === 'ink-raw-ansi'
    ) {
      this.updateText(node, yogaNode, nextCache)
    } else {
      const clip = computeClipRect(node, yogaNode, x, y)
      this.updateBox(
        node,
        yogaNode,
        nextCache,
        clip?.y1 !== undefined,
        Math.max(viewTop, clip?.y1 ?? viewTop),
        Math.min(viewBottom, clip?.y2 ?? viewBottom),
        !layoutUnchanged || ancestorDamaged,
        depth,
      )
    }

    nextCache.shownTop = Math.max(y + nextCache.top, viewTop)
    nextCache.shownBottom = Math.min(y + nextCache.bottom, viewBottom)
    if (nextCache.shownTop >= nextCache.shownBottom) {
      leftoverGsDropCachedLayout(node)
    } else if (shouldDamage) {
      this.damage(nextCache)
    }
  }

  private updateText(
    node: DOMElement,
    yogaNode: LayoutNode,
    cache: NodePaintCache,
  ): void {
    if (cache.lines !== undefined) return
    const { x, background } = cache
    let text = ''
    if (node.nodeName === 'ink-text') {
      const maxWidth = Math.min(getMaxWidth(yogaNode), this.output.width - x)
      const formatted = formatTextForPaint(
        this.state,
        node,
        yogaNode,
        maxWidth,
        background,
      )
      text = formatted?.text ?? ''
      cache.softWrap = formatted?.softWrap
    } else {
      const rawText = node.attributes['rawText']
      if (typeof rawText === 'string') {
        text = background
          ? leftoverGsRewriteRawAnsiBg(rawText, background)
          : rawText
      }
    }
    cache.lines = text ? text.split('\n') : []
    cache.bottom = Math.max(1, cache.height, cache.lines.length)
  }

  private updateBox(
    node: DOMElement,
    yogaNode: LayoutNode,
    cache: NodePaintCache,
    isVerticallyClipped: boolean,
    viewTop: number,
    viewBottom: number,
    ancestorDamaged: boolean,
    depth: number,
  ): void {
    const childBg = node.style.backgroundColor ?? cache.background
    let childOffsetX = cache.x
    let childOffsetY = cache.y
    let children = node.childNodes
    let scrollMin = -Infinity
    let scrollMax = Infinity
    let childDepth = depth

    if (isScrollContainer(node)) {
      const content = getScrollContent(node)
      scrollMin = this.settle(node, yogaNode, cache, content?.yogaNode)
      scrollMax = scrollMin + (node.scrollViewportHeight ?? 0)
      if (node.pendingScrollDelta !== undefined) {
        this.scrolling.push(node)
      }
      children = content?.childNodes ?? []
      if (content?.yogaNode) {
        childOffsetX += content.yogaNode.getComputedLeft()
        childOffsetY += content.yogaNode.getComputedTop() - scrollMin
        stampLayout(content, {
          x: childOffsetX,
          y: childOffsetY,
          width: content.yogaNode.getComputedWidth(),
          height: content.yogaNode.getComputedHeight(),
        })
        content.pendingClears = undefined
        content.paintCache = undefined
        content.dirty = false
        childDepth++
      }
    }

    let minTop = Math.min(0, cache.height - 1)
    let maxBottom = Math.max(1, cache.height)
    for (const child of children) {
      if (child.nodeName === '#text' || !child.yogaNode) continue
      const childTop = child.yogaNode.getComputedTop()
      if (
        childTop + child.yogaNode.getComputedHeight() <= scrollMin ||
        childTop >= scrollMax
      ) {
        this.hide(child)
        continue
      }
      this.update(
        child,
        childOffsetX,
        childOffsetY,
        viewTop,
        viewBottom,
        childBg,
        ancestorDamaged,
        childDepth + 1,
      )
      const childCache = child.paintCache
      if (childCache !== undefined && !isVerticallyClipped) {
        minTop = Math.min(minTop, childCache.y - childOffsetY + childCache.top)
        maxBottom = Math.max(
          maxBottom,
          childCache.y - childOffsetY + childCache.bottom,
        )
      }
    }
    cache.top = minTop
    cache.bottom = maxBottom
  }

  private settle(
    node: DOMElement,
    yogaNode: LayoutNode,
    cache: NodePaintCache,
    contentYoga: LayoutNode | undefined,
  ): number {
    const topInset =
      yogaNode.getComputedBorder(LayoutEdge.Top) +
      yogaNode.getComputedPadding(LayoutEdge.Top)
    const bottomInset =
      yogaNode.getComputedBorder(LayoutEdge.Bottom) +
      yogaNode.getComputedPadding(LayoutEdge.Bottom)
    const innerHeight = Math.max(0, cache.height - topInset - bottomInset)
    const scrollHeight = contentYoga?.getComputedHeight() ?? 0
    const prevScrollHeight = node.scrollHeight ?? scrollHeight
    const prevInnerHeight = node.scrollViewportHeight ?? innerHeight
    node.scrollHeight = scrollHeight
    node.scrollViewportHeight = innerHeight
    node.scrollViewportTop = cache.y + topInset
    return contentYoga
      ? settleScrollBoxPosition(
          node,
          this.state,
          cache.x,
          cache.width,
          scrollHeight,
          prevScrollHeight,
          innerHeight,
          prevInnerHeight,
          node.scrollViewportTop,
        )
      : (node.scrollTopRendered ?? 0)
  }

  private draw(node: DOMElement, bandTop: number, bandBottom: number): void {
    const { paintCache: cache, yogaNode } = node
    if (
      !cache ||
      !yogaNode ||
      !node.cachedLayout ||
      cache.squeezed ||
      Math.max(cache.shownTop, bandTop) >=
        Math.min(cache.shownBottom, bandBottom)
    ) {
      return
    }
    const { output } = this
    const { x, width, height, lines, softWrap } = cache
    const y = cache.y - this.firstRow
    const style = node.style

    if (lines !== undefined) {
      if (node.nodeName === 'ink-text' && style.textDirection !== undefined) {
        output.writeDirected(
          x,
          y,
          lines.join('\n'),
          softWrap,
          style.textDirection,
          Math.min(getMaxWidth(yogaNode), output.width - x),
        )
      } else {
        output.writeLines(x, y, lines, softWrap)
      }
      return
    }

    if (style.noSelect) {
      const fromLeft = style.noSelect === 'from-left-edge'
      output.noSelect({
        x: fromLeft ? 0 : Math.floor(x),
        y: Math.floor(y),
        width: fromLeft ? Math.floor(x) + Math.floor(width) : Math.floor(width),
        height: Math.floor(height),
      })
    }

    const clip = computeClipRect(node, yogaNode, x, y)
    if (clip) output.clip(clip)

    const container = isScrollContainer(node) ? getScrollContent(node) : node
    if (container === node && (style.backgroundColor || style.opaque)) {
      paintBoxBackground(node, yogaNode, output, x, y, width, height)
    }

    for (const child of container?.childNodes ?? []) {
      if (child.nodeName !== '#text') {
        this.draw(child, bandTop, bandBottom)
      }
    }

    if (clip) output.unclip()
    renderBorder(x, y, node, output, cache.background)
  }
}
