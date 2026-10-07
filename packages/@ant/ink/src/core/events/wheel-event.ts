import type { DOMElement } from '../dom.js'
import { nodeCache } from '../node-cache.js'
import { TerminalEvent } from './terminal-event.js'
import type { EventTarget } from './terminal-event.js'

/**
 * densable `Wd` — wheel event (`type:"wheel"`, bubbles+cancelable).
 * `deltaY` is +1 (wheeldown) / -1 (wheelup). Optional cell coords are
 * 0-indexed when the SGR sequence carried col/row.
 */
export class WheelEvent extends TerminalEvent {
  readonly deltaY: number
  readonly deltaX: number
  readonly ctrl: boolean
  readonly shift: boolean
  readonly meta: boolean
  readonly col: number | undefined
  readonly row: number | undefined
  localCol = 0
  localRow = 0

  constructor(
    deltaY: number,
    opts: {
      deltaX?: number
      ctrl?: boolean
      shift?: boolean
      meta?: boolean
      col?: number
      row?: number
    } = {},
  ) {
    super('wheel', { bubbles: true, cancelable: true })
    this.deltaY = deltaY
    this.deltaX = opts.deltaX ?? 0
    this.ctrl = opts.ctrl ?? false
    this.shift = opts.shift ?? false
    this.meta = opts.meta ?? false
    this.col = opts.col
    this.row = opts.row
  }

  override _prepareForTarget(target: EventTarget): void {
    // densable dEe: cachedLayout screen origin (same rect bubbleClick uses).
    const rect = nodeCache.get(target as DOMElement)
    if (rect && this.col !== undefined && this.row !== undefined) {
      this.localCol = this.col - rect.x
      this.localRow = this.row - rect.y
      return
    }
    const yoga = (
      target as unknown as {
        yogaNode?: { getComputedLeft?(): number; getComputedTop?(): number }
      }
    ).yogaNode
    this.localCol = (this.col ?? 0) - (yoga?.getComputedLeft?.() ?? 0)
    this.localRow = (this.row ?? 0) - (yoga?.getComputedTop?.() ?? 0)
  }
}
