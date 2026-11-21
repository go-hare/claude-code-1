/** Debug logger — no-op placeholder until proper logger injection is added */
const logForDebugging = (_message: string, _opts?: { level?: string }) => {}
import {
  consumeAbsoluteRemovedFlag,
  type DOMElement,
  markDirty,
} from './dom.js'
import type { Frame } from './frame.js'
import { IncrementalPainter } from './incremental-painter.js'
import Output from './output.js'
import renderNodeToOutput, {
  createRenderFrameContext,
  resetRenderFrameContextState,
  vanishedOverflowingAbsoluteBlitFor,
} from './render-node-to-output.js'
import {
  clipRightEdgeWideGraphemes,
  createScreen,
  type Screen,
  type StylePool,
} from './screen.js'

export type RenderOptions = {
  frontFrame: Frame
  backFrame: Frame
  isTTY: boolean
  terminalWidth: number
  terminalRows: number
  altScreen: boolean
  // True when the previous frame's screen buffer was mutated post-render
  // (selection overlay), reset to blank (alt-screen enter/resize/SIGCONT),
  // or reset to 0×0 (forceRedraw). Blitting from such a prevScreen would
  // copy stale inverted cells, blanks, or nothing. When false, blit is safe.
  prevFrameContaminated: boolean
  /**
   * densable `overlayActive:M` — selection or search highlight this paint.
   * Kt misses DECSTBM when true.
   */
  overlayActive?: boolean
  /**
   * Official 2.1.328 `firstRow` — when supplied, selects the row-level
   * `IncrementalPainter` (`Lm`) for slicing tall main-screen trees.
   */
  firstRow?: (contentHeight: number) => number
}

export type Renderer = (options: RenderOptions) => Frame

export default function createRenderer(
  node: DOMElement,
  stylePool: StylePool,
): Renderer {
  // Reuse Output across frames so charCache (tokenize + grapheme clustering)
  // persists — most lines don't change between renders.
  let output: Output | undefined
  let incrementalPainter: IncrementalPainter | undefined
  let prevMarkRightEdge: boolean | undefined
  // Official 2.1.328 `H = hc()` — per-renderer frame context (no cross-instance bleed).
  const frameCtx = createRenderFrameContext()
  return options => {
    const { frontFrame, backFrame, isTTY, terminalWidth, terminalRows } =
      options
    const prevScreen = frontFrame.screen
    const backScreen = backFrame.screen
    // Read pools from the back buffer's screen — pools may be replaced
    // between frames (generational reset), so we can't capture them in the closure
    const charPool = backScreen.charPool
    const hyperlinkPool = backScreen.hyperlinkPool

    // Return empty frame if yoga node doesn't exist or layout hasn't been computed yet.
    // getComputedHeight() returns NaN before calculateLayout() is called.
    // Also check for invalid dimensions (negative, Infinity) that would cause RangeError
    // when creating arrays.
    const computedHeight = node.yogaNode?.getComputedHeight()
    const computedWidth = node.yogaNode?.getComputedWidth()
    const hasInvalidHeight =
      computedHeight === undefined ||
      !Number.isFinite(computedHeight) ||
      computedHeight < 0
    const hasInvalidWidth =
      computedWidth === undefined ||
      !Number.isFinite(computedWidth) ||
      computedWidth < 0

    if (!node.yogaNode || hasInvalidHeight || hasInvalidWidth) {
      // Log to help diagnose root cause (visible with --debug flag)
      if (node.yogaNode && (hasInvalidHeight || hasInvalidWidth)) {
        logForDebugging(
          `Invalid yoga dimensions: width=${computedWidth}, height=${computedHeight}, ` +
            `childNodes=${node.childNodes.length}, terminalWidth=${terminalWidth}, terminalRows=${terminalRows}`,
        )
      }
      // densable returns height-0 screen. Keep alt-screen viewport at rows+1
      // so a transient pre-layout frame does not trip log-update's
      // viewport-shrink fullReset (alt steady-state uses rows+1). height-0
      // is also skipped in LogUpdate.render so we never erase+paint blank.
      return {
        screen: createScreen(
          terminalWidth,
          0,
          stylePool,
          charPool,
          hyperlinkPool,
        ),
        viewport: {
          width: terminalWidth,
          height: options.altScreen ? terminalRows + 1 : terminalRows,
        },
        cursor: { x: 0, y: 0, visible: true },
      }
    }

    const width = Math.floor(node.yogaNode.getComputedWidth())
    const yogaHeight = Math.floor(node.yogaNode.getComputedHeight())
    const top = Math.max(
      0,
      Math.min(options.firstRow?.(yogaHeight) ?? 0, yogaHeight),
    )
    const height = options.altScreen ? terminalRows : yogaHeight - top
    if (options.altScreen && yogaHeight > terminalRows) {
      logForDebugging(
        `alt-screen: yoga height ${yogaHeight} > terminalRows ${terminalRows} — ` +
          `something is rendering outside <AlternateScreen>. Overflow clipped.`,
        { level: 'warn' },
      )
    }
    const screen =
      backScreen ??
      createScreen(width, height, stylePool, charPool, hyperlinkPool)
    if (output) {
      output.reset(width, height, screen)
    } else {
      output = new Output({ width, height, stylePool, screen })
    }

    resetRenderFrameContextState(frameCtx)
    frameCtx.overlayActive = options.overlayActive === true

    const absoluteRemoved = consumeAbsoluteRemovedFlag(node)
    const markRightEdge = isTTY && width === terminalWidth
    const blitPrevScreen =
      absoluteRemoved ||
      options.prevFrameContaminated ||
      incrementalPainter !== undefined ||
      prevMarkRightEdge === !markRightEdge
        ? undefined
        : prevScreen
    prevMarkRightEdge = markRightEdge

    let renderedScreen: Screen
    if (options.firstRow) {
      incrementalPainter ??= new IncrementalPainter(output, frameCtx, stylePool)
      incrementalPainter.paint(node, screen, top, markRightEdge)
      screen.damage = { x: 0, y: 0, width, height }
      renderedScreen = screen
    } else {
      incrementalPainter = undefined
      renderNodeToOutput(node, output, frameCtx, {
        prevScreen: blitPrevScreen,
      })
      const outScreen = output.get()
      if (markRightEdge) {
        clipRightEdgeWideGraphemes(outScreen, output.rowsAtRightEdge)
      }
      renderedScreen = outScreen
    }

    // Drain continuation: render cleared scrollbox.dirty, so next frame's
    // root blit would skip the subtree. markDirty walks ancestors so the
    // next frame descends. Done AFTER render so the clear-dirty at the end
    // of renderNodeToOutput doesn't overwrite this.
    const drainNode = frameCtx.scrollDrainNode
    if (drainNode) markDirty(drainNode)

    return {
      scrollHint: options.altScreen ? frameCtx.scrollHint : null,
      scrollDrainPending: drainNode !== null,
      followScroll: frameCtx.followScroll,
      layoutShifted: frameCtx.layoutShifted,
      staleAbsolutePaint:
        incrementalPainter === undefined &&
        blitPrevScreen !== undefined &&
        (frameCtx.absolutePaintCut ||
          vanishedOverflowingAbsoluteBlitFor(frameCtx, output)),
      screen: renderedScreen,
      top,
      viewport: {
        width: terminalWidth,
        // Alt screen: fake viewport.height = rows + 1 so that
        // shouldClearScreen()'s `screen.height >= viewport.height` check
        // (which treats exactly-filling content as "overflows" for
        // scrollback purposes) never fires. Alt-screen content is always
        // exactly `rows` tall (via <Box height={rows}>) but never
        // scrolls — the cursor.y clamp below keeps the cursor-restore
        // from emitting an LF. With the standard diff path, every frame
        // is incremental; no fullResetSequence_CAUSES_FLICKER.
        height: options.altScreen ? terminalRows + 1 : terminalRows,
      },
      cursor: {
        x: 0,
        // In the alt screen, keep the cursor inside the viewport. When
        // screen.height === terminalRows exactly (content fills the alt
        // screen), cursor.y = screen.height would trigger log-update's
        // cursor-restore LF at the last row, scrolling one row off the top
        // of the alt buffer and desyncing the diff's cursor model. The
        // cursor is hidden so its position only matters for diff coords.
        y: options.altScreen
          ? Math.max(0, Math.min(screen.height, terminalRows) - 1)
          : screen.height,
        // Hide cursor when there's dynamic output to render (only in TTY mode)
        visible: !isTTY || screen.height === 0,
      },
    }
  }
}
