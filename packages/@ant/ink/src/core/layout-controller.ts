import { type DOMElement, markDirty, rebuildYogaSubtree } from './dom.js'
import type { YogaNodeConfig } from './layout/node.js'
import { getYogaCounters } from './yoga-layout/index.js'

const MAX_TERMINAL_COLUMNS = 500

export type YogaCounterSnapshot = {
  ms: number
  visited: number
  measured: number
  cacheHits: number
  live: number
}

export type LayoutControllerHost = {
  width: () => number | undefined
  onFailed: () => void
  invalidatePrevFrame: () => void
  isLayoutChecked?: () => boolean
  onFaultMessage?: (message: string) => void
}

/**
 * Official 2.1.328 `Cs` — manages Yoga layout execution, `subscribeLayout`
 * listeners, counter snapshots, and damaged-tree fault recovery.
 */
export class LayoutController {
  readonly rootNode: DOMElement
  readonly layoutConfig: YogaNodeConfig | undefined
  readonly host: LayoutControllerHost
  private readonly layoutListeners = new Set<() => void>()
  private layoutListenersPaused = false
  private lastYogaCounters: YogaCounterSnapshot = {
    ms: 0,
    visited: 0,
    measured: 0,
    cacheHits: 0,
    live: 0,
  }
  layoutDamaged = false
  failedLayouts = 0
  damagedLayouts = 0

  constructor(
    rootNode: DOMElement,
    layoutConfig: YogaNodeConfig | undefined,
    host: LayoutControllerHost,
  ) {
    this.rootNode = rootNode
    this.layoutConfig = layoutConfig
    this.host = host
  }

  subscribeLayout = (listener: () => void): (() => void) => {
    this.layoutListeners.add(listener)
    return () => {
      this.layoutListeners.delete(listener)
    }
  }

  takeYogaCounters(): YogaCounterSnapshot {
    const snap = this.lastYogaCounters
    this.lastYogaCounters = {
      ms: 0,
      visited: 0,
      measured: 0,
      cacheHits: 0,
      live: 0,
    }
    return snap
  }

  calculateYogaLayout(): number {
    const yogaNode = this.rootNode.yogaNode
    if (!yogaNode) return 0
    const start = performance.now()
    const targetWidth = this.host.width()
    if (targetWidth !== undefined) {
      yogaNode.setWidth(targetWidth)
      yogaNode.calculateLayout(targetWidth)
    } else {
      yogaNode.setWidthAuto()
      yogaNode.calculateLayout()
      if (yogaNode.getComputedWidth() > MAX_TERMINAL_COLUMNS) {
        yogaNode.setWidth(MAX_TERMINAL_COLUMNS)
        yogaNode.calculateLayout(MAX_TERMINAL_COLUMNS)
      }
    }
    const ms = performance.now() - start
    const counters = getYogaCounters()
    this.lastYogaCounters = {
      ms: this.lastYogaCounters.ms + ms,
      visited: this.lastYogaCounters.visited + counters.visited,
      measured: this.lastYogaCounters.measured + counters.measured,
      cacheHits: this.lastYogaCounters.cacheHits + counters.cacheHits,
      live: counters.live,
    }
    return ms
  }

  recoverFromFault(err: unknown): boolean {
    this.failedLayouts++
    this.host.onFaultMessage?.(String(err))
    try {
      rebuildYogaSubtree(this.rootNode, this.layoutConfig)
      markDirty(this.rootNode)
      this.host.invalidatePrevFrame()
      this.calculateYogaLayout()
      this.layoutDamaged = false
      return true
    } catch {
      this.damagedLayouts++
      this.layoutDamaged = true
      this.host.onFailed()
      return false
    }
  }

  notifyLayoutListeners(): void {
    if (this.layoutListenersPaused) return
    for (const listener of this.layoutListeners) {
      try {
        listener()
      } catch (err) {
        this.layoutListenersPaused = true
        queueMicrotask(() => {
          this.layoutListenersPaused = false
        })
        this.host.onFaultMessage?.(String(err))
        return
      }
    }
  }

  resumeLayoutListeners(): void {
    this.layoutListenersPaused = false
  }
}
