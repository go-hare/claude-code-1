import type { DOMElement } from '../dom.js'
import { nodeCache } from '../node-cache.js'
import { Event } from './event.js'
import type { EventTarget } from './terminal-event.js'

/**
 * Mouse action event (mousedown, mouseup, mousedrag).
 * Bubbles from the deepest hit node up through parentNode.
 */
export class MouseActionEvent extends Event {
  /** Action type */
  readonly type: 'mousedown' | 'mouseup' | 'mousedrag'
  /** 0-indexed screen column */
  readonly col: number
  /** 0-indexed screen row */
  readonly row: number
  /** Mouse button number */
  readonly button: number
  /**
   * densable Jhr `mods.shift` — SGR button bit 0x04.
   */
  readonly shift: boolean
  /** densable Jhr `mods.alt` — SGR button bit 0x08. */
  readonly alt: boolean
  /** densable Jhr `mods.ctrl` — SGR button bit 0x10. */
  readonly ctrl: boolean
  /**
   * densable Jhr `fine` — pixel coords when the terminal reports them.
   * DualInk SGR is cell-only; stays undefined unless a caller passes it.
   */
  readonly fine: { col: number; row: number } | undefined
  /**
   * Column relative to the current handler's Box.
   * Recomputed before each handler fires.
   */
  localCol = 0
  /** Row relative to the current handler's Box. */
  localRow = 0
  /**
   * densable Wl `fine` offset — unfloored cell-space minus layout origin.
   * Undefined unless the event carried `fine`.
   */
  localFine: { col: number; row: number } | undefined

  constructor(
    type: 'mousedown' | 'mouseup' | 'mousedrag',
    col: number,
    row: number,
    button: number,
    mods: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {},
    fine?: { col: number; row: number },
  ) {
    super()
    this.type = type
    this.col = col
    this.row = row
    this.button = button
    this.shift = mods.shift === true || (button & 0x04) !== 0
    this.alt = mods.alt === true || (button & 0x08) !== 0
    this.ctrl = mods.ctrl === true || (button & 0x10) !== 0
    this.fine = fine
    this.localFine = undefined
  }

  /**
   * densable Wl / Jhr localCol/localRow — screen col/row minus cachedLayout
   * origin (same rect bubbleClick / WheelEvent use). Yoga getComputedLeft/Top
   * is parent-relative and wrong when nested.
   */
  prepareForTarget(target: EventTarget): void {
    const rect = nodeCache.get(target as DOMElement)
    if (rect) {
      const originX = Math.floor(rect.x)
      const originY = Math.floor(rect.y)
      this.localCol = this.col - originX
      this.localRow = this.row - originY
      this.localFine = this.fine
        ? { col: this.fine.col - originX, row: this.fine.row - originY }
        : undefined
      return
    }
    const yoga = (
      target as unknown as {
        yogaNode?: { getComputedLeft?(): number; getComputedTop?(): number }
      }
    ).yogaNode
    const originX = yoga?.getComputedLeft?.() ?? 0
    const originY = yoga?.getComputedTop?.() ?? 0
    this.localCol = this.col - originX
    this.localRow = this.row - originY
    this.localFine = this.fine
      ? { col: this.fine.col - originX, row: this.fine.row - originY }
      : undefined
  }
}
