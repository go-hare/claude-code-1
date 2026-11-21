import type { DOMElement } from './dom.js'
import type { ClickEvent } from './events/click-event.js'

export type PointerCapture = {
  node: DOMElement
  button: number
  col: number
  row: number
}

export type ClickListener = (
  target: DOMElement | null,
  event: ClickEvent | null,
) => void

export type PointerControllerHost = {
  isAltScreenActive: () => boolean
  showsWhatInputAnswers: () => boolean
}

/**
 * Official 2.1.328 `zm` (`this.pointer`) controller — owns hover coordinates,
 * hovered node set, followHover backoff state, active pointer capture, click
 * listeners, and input-readiness guards for click / pointer press.
 */
export class PointerController {
  readonly hoveredNodes = new Set<DOMElement>()
  readonly clickListeners = new Set<ClickListener>()
  hoverCol = -1
  hoverRow = -1
  hoverFollowStreak = 0
  hoverFollowHeldUntil = 0
  capture: PointerCapture | null = null
  private host: PointerControllerHost | undefined

  constructor(host?: PointerControllerHost) {
    this.host = host
  }

  setHost(host: PointerControllerHost): void {
    this.host = host
  }

  showsWhatInputAnswers(): boolean {
    return this.host ? this.host.showsWhatInputAnswers() : true
  }

  canAcceptPointerPress(isAltScreenActive?: boolean): boolean {
    const alt = isAltScreenActive ?? this.host?.isAltScreenActive() ?? false
    return alt && this.showsWhatInputAnswers()
  }

  isPointerCaptured(): boolean {
    return this.capture !== null
  }

  subscribeClicks = (listener: ClickListener): (() => void) => {
    this.clickListeners.add(listener)
    return () => {
      this.clickListeners.delete(listener)
    }
  }

  notifyClicks(target: DOMElement | null, event: ClickEvent | null): void {
    for (const listener of this.clickListeners) {
      listener(target, event)
    }
  }

  tellClickedNowhere(): void {
    const listeners = [...this.clickListeners]
    queueMicrotask(() => {
      for (const listener of listeners) {
        if (this.clickListeners.has(listener)) listener(null, null)
      }
    })
  }

  clearHoverCoords(): void {
    this.hoverCol = -1
    this.hoverRow = -1
    this.hoverFollowStreak = 0
    this.hoverFollowHeldUntil = 0
  }

  endCapture(): PointerCapture | null {
    const prev = this.capture
    this.capture = null
    return prev
  }
}
