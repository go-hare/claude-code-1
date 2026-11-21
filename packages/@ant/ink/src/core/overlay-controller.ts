import type { DOMElement } from './dom.js'
import type { FollowScroll } from './render-node-to-output.js'
import {
  leftoverGsFollowCapture,
  leftoverGsOverlayActive,
} from './render-node-to-output.js'
import {
  applyPositionedHighlight,
  type MatchPosition,
} from './render-to-screen.js'
import type { Screen, StylePool } from './screen.js'
import { applySearchHighlight } from './searchHighlight.js'
import {
  applySelectionOverlay,
  captureScrolledRows,
  createSelectionState,
  hasSelection,
  leftoverGsSelectionBothEndsOff,
  type SelectionState,
  shiftAnchor,
  shiftSelection,
  underlineHoveredLink,
} from './selection.js'

export type SearchPositionsState = {
  positions: MatchPosition[]
  rowOffset: number
  currentIdx: number
}

export type OverlayControllerHost = {
  screen: () => Screen
  isAltScreenActive: () => boolean
  scheduleRender: () => void
}

/**
 * Official 2.1.328 `Fm` — manages selection, search highlights, and hovered
 * hyperlink underlines as post-render screen overlays.
 */
export class OverlayController {
  readonly rootNode: DOMElement
  readonly stylePool: StylePool
  readonly host: OverlayControllerHost
  readonly selection: SelectionState = createSelectionState()
  searchHighlightQuery = ''
  searchPositions: SearchPositionsState | null = null
  hoveredLink: string | undefined = undefined
  hoveredLinkSpans: ReturnType<typeof underlineHoveredLink> = []
  private readonly selectionListeners = new Set<() => void>()
  private readonly selectionTakeDownListeners = new Set<() => void>()
  private prevOverlaySig = ''

  constructor(
    rootNode: DOMElement,
    stylePool: StylePool,
    host: OverlayControllerHost,
  ) {
    this.rootNode = rootNode
    this.stylePool = stylePool
    this.host = host
  }

  changedSinceLastFrame(): boolean {
    const { anchor, focus } = this.selection
    const pos = this.searchPositions
    const sig = `${anchor?.row},${anchor?.col},${focus?.row},${focus?.col}|${this.searchHighlightQuery}|${pos?.currentIdx},${pos?.rowOffset},${pos?.positions.length}`
    const changed =
      sig !== this.prevOverlaySig || this.hoveredLinkSpans.length > 0
    this.prevOverlaySig = sig
    return changed
  }

  isActive(): boolean {
    return leftoverGsOverlayActive({
      anchor: this.selection.anchor,
      focus: this.selection.focus,
      selectionBothEndsOff: leftoverGsSelectionBothEndsOff(this.selection),
      searchHighlightQuery: this.searchHighlightQuery,
      searchPositions: this.searchPositions,
    })
  }

  followScroll(follow: FollowScroll | null): void {
    if (
      !follow ||
      !this.selection.anchor ||
      this.selection.anchor.row < follow.viewportTop ||
      this.selection.anchor.row > follow.viewportBottom ||
      (this.selection.virtualAnchorCol ?? this.selection.anchor.col) <
        follow.viewportLeft ||
      (this.selection.virtualAnchorCol ?? this.selection.anchor.col) >
        follow.viewportRight
    ) {
      return
    }
    const { delta, viewportTop, viewportBottom, viewportLeft, viewportRight } =
      follow
    const cap = leftoverGsFollowCapture(delta, viewportTop, viewportBottom)
    const screen = this.host.screen()
    if (this.selection.isDragging) {
      if (hasSelection(this.selection)) {
        captureScrolledRows(
          this.selection,
          screen,
          cap.firstRow,
          cap.lastRow,
          cap.side,
        )
      }
      shiftAnchor(this.selection, -delta, viewportTop, viewportBottom)
    } else if (
      !this.selection.focus ||
      (this.selection.focus.row >= viewportTop &&
        this.selection.focus.row <= viewportBottom &&
        (this.selection.virtualFocusCol ?? this.selection.focus.col) >=
          viewportLeft &&
        (this.selection.virtualFocusCol ?? this.selection.focus.col) <=
          viewportRight)
    ) {
      if (hasSelection(this.selection)) {
        captureScrolledRows(
          this.selection,
          screen,
          cap.firstRow,
          cap.lastRow,
          cap.side,
        )
      }
      shiftSelection(
        this.selection,
        -delta,
        viewportTop,
        viewportBottom,
        screen.width,
      )
    }
  }

  paint(screen: Screen, hoverCol: number, hoverRow: number): boolean {
    let hoveredLinkPainted = false
    if (this.hoveredLink !== undefined || this.hoveredLinkSpans.length > 0) {
      const hadSpans = this.hoveredLinkSpans.length > 0
      this.hoveredLinkSpans = underlineHoveredLink(
        screen,
        hoverCol,
        hoverRow,
        this.hoveredLink,
        this.stylePool,
      )
      if (this.hoveredLinkSpans.length === 0) {
        this.hoveredLink = undefined
      }
      hoveredLinkPainted = hadSpans || this.hoveredLinkSpans.length > 0
    }
    const selActive =
      hasSelection(this.selection) &&
      !leftoverGsSelectionBothEndsOff(this.selection)
    if (selActive) {
      applySelectionOverlay(screen, this.selection, this.stylePool)
    }
    let hlActive = applySearchHighlight(
      screen,
      this.searchHighlightQuery,
      this.stylePool,
    )
    if (this.searchPositions) {
      const sp = this.searchPositions
      const posApplied = applyPositionedHighlight(
        screen,
        this.stylePool,
        sp.positions,
        sp.rowOffset,
        sp.currentIdx,
      )
      hlActive = hlActive || posApplied
    }
    return selActive || hlActive || hoveredLinkPainted
  }

  subscribeToSelectionChange = (listener: () => void): (() => void) => {
    this.selectionListeners.add(listener)
    return () => {
      this.selectionListeners.delete(listener)
    }
  }

  notifySelectionChange(): void {
    for (const listener of this.selectionListeners) {
      listener()
    }
  }

  subscribeToSelectionTakeDown = (listener: () => void): (() => void) => {
    this.selectionTakeDownListeners.add(listener)
    return () => {
      this.selectionTakeDownListeners.delete(listener)
    }
  }

  notifySelectionTakeDown(): void {
    if (!this.host.isAltScreenActive() || !hasSelection(this.selection)) return
    for (const listener of this.selectionTakeDownListeners) {
      listener()
    }
  }
}
