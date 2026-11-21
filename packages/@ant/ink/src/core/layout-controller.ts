import { type DOMElement, rebuildYogaSubtree } from './dom.js'
import type { LayoutNode, YogaNodeConfig } from './layout/node.js'
import { getYogaCounters } from './yoga-layout/index.js'

const MAX_TERMINAL_COLUMNS = 500
const MAX_FAULT_ERROR_MESSAGES = 16 // dA
const MAX_FAULT_DEBUG_LINES = 5 // cS
const PERSISTING_FAULT_THRESHOLD = 50 // fA / mL_
const MAX_LISTENER_FAULT_DEBUG_LINES = 5 // dS

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
  onFaultMessage?: (message: string, opts?: { level?: string }) => void
  onFaultError?: (error: Error) => void
  onYogaMs?: (ms: number) => void
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
  private reportedLayoutListenerFault = false
  private layoutListenerFaultDebugLines = 0
  private lastYogaCounters: YogaCounterSnapshot = {
    ms: 0,
    visited: 0,
    measured: 0,
    cacheHits: 0,
    live: 0,
  }
  layoutDamaged = false
  paintStopsAtDamage = false
  failedLayouts = 0
  damagedLayouts = 0
  private readonly reportedLayoutFaultMessages = new Set<string>()
  private reportedLayoutFaultRecovered = false
  private reportedLayoutFaultDropped = false
  private reportedLayoutFaultPersisting = false
  private layoutFaultDebugLines = 0

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

  calculateYogaLayout(targetNode?: LayoutNode): number {
    const yogaNode = targetNode ?? this.rootNode.yogaNode
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
    this.host.onYogaMs?.(ms)
    const counters = getYogaCounters()
    this.lastYogaCounters = {
      ms,
      visited: counters.visited,
      measured: counters.measured,
      cacheHits: counters.cacheHits,
      live: counters.live,
    }
    return ms
  }

  /**
   * Official 2.1.328 `Cs.replaceLayoutNodes()` — rebuild fresh Yoga nodes for
   * the entire tree, lay out the rebuilt root before committing, then commit
   * `yogaNode` / clear `cachedLayout` & `paintCache` and invalidate prevFrame.
   */
  replaceLayoutNodes(): void {
    this.layoutDamaged = false
    const rebuilt = rebuildYogaSubtree(this.rootNode, this.layoutConfig)
    this.calculateYogaLayout(rebuilt.rootYoga)
    rebuilt.commit()
    this.host.invalidatePrevFrame()
  }

  /**
   * Official 2.1.328 `Cs.runLayoutPass()` — run normal Yoga layout, falling
   * back to full Yoga subtree replacement (`replaceLayoutNodes`) on throw or
   * damaged layout record.
   */
  runLayoutPass(): void {
    const yogaNode = this.rootNode.yogaNode
    if (!yogaNode) return
    let fault: Error | undefined
    if (this.failedLayouts === 0) {
      try {
        this.calculateYogaLayout(yogaNode)
        if (!this.layoutDamaged) return
        this.damagedLayouts++
        fault = new Error('ink layout record is damaged')
      } catch (err) {
        fault = LayoutController.describeLayoutFault(err)
      }
    }
    let retryFault: Error | undefined
    try {
      this.replaceLayoutNodes()
      this.failedLayouts = 0
    } catch (err) {
      retryFault = LayoutController.describeLayoutFault(err)
      this.failedLayouts++
      this.host.onFailed()
    }
    const primary = fault ?? retryFault
    if (primary) {
      this.reportLayoutFaultToErrorTracking(primary, retryFault)
      this.logLayoutFaultForDebugging(primary, retryFault)
    }
  }

  /**
   * Official 2.1.328 `Cs.paint()` — guard paint execution against damaged
   * layout records so caller can immediately re-layout and retry once.
   */
  paint<TResult>(
    retrying: boolean,
    renderFn: () => TResult,
  ): TResult | undefined {
    this.paintStopsAtDamage = !retrying
    try {
      return renderFn()
    } catch (err) {
      if (retrying || !this.layoutDamaged) throw err
      return undefined
    } finally {
      this.paintStopsAtDamage = false
    }
  }

  recoverFromFault(err: unknown): boolean {
    const fault = LayoutController.describeLayoutFault(err)
    this.host.onFaultMessage?.(String(err), { level: 'warn' })
    try {
      this.replaceLayoutNodes()
      this.failedLayouts = 0
      this.reportLayoutFaultToErrorTracking(fault, undefined)
      return true
    } catch (retryErr) {
      const retryFault = LayoutController.describeLayoutFault(retryErr)
      this.failedLayouts++
      this.damagedLayouts++
      this.layoutDamaged = true
      this.host.onFailed()
      this.reportLayoutFaultToErrorTracking(fault, retryFault)
      return false
    }
  }

  notifyLayoutListeners(): void {
    if (this.layoutListenersPaused) return
    for (const listener of this.layoutListeners) {
      try {
        listener()
      } catch (err) {
        this.pauseLayoutListeners()
        this.reportLayoutListenerFault(
          LayoutController.describeLayoutFault(err),
        )
        return
      }
    }
  }

  pauseLayoutListeners(): void {
    this.layoutListenersPaused = true
    queueMicrotask(() => {
      this.layoutListenersPaused = false
    })
  }

  resumeLayoutListeners(): void {
    this.layoutListenersPaused = false
  }

  static describeLayoutFault(value: unknown): Error {
    try {
      if (value instanceof Error && typeof value.message === 'string') {
        return value
      }
      if (
        value &&
        typeof value === 'object' &&
        typeof (value as { message?: unknown }).message === 'string' &&
        typeof (value as { name?: unknown }).name === 'string'
      ) {
        return value as Error
      }
    } catch {
      // fall through
    }
    return new Error('ink layout pass threw a value that cannot be described')
  }

  private reportLayoutListenerFault(fault: Error): void {
    try {
      this.reportLayoutFaultErrorOnce(fault)
      if (!this.reportedLayoutListenerFault) {
        this.reportedLayoutListenerFault = true
        this.host.onFaultError?.(
          new Error(
            'ink layout listener threw; layout listeners paused until this flush unwinds',
          ),
        )
      }
      if (this.layoutListenerFaultDebugLines < MAX_LISTENER_FAULT_DEBUG_LINES) {
        this.layoutListenerFaultDebugLines++
        const capNote =
          this.layoutListenerFaultDebugLines >= MAX_LISTENER_FAULT_DEBUG_LINES
            ? ' — further layout listener faults in this session are not logged'
            : ''
        this.host.onFaultMessage?.(
          `ink layout listener threw (contained; layout listeners paused until this flush unwinds): ${fault.name}: ${fault.message}${capNote}`,
          { level: 'warn' },
        )
      }
    } catch {
      // never throw from reporting
    }
  }

  private reportLayoutFaultToErrorTracking(
    fault: Error,
    retryFault: Error | undefined,
  ): void {
    try {
      this.reportLayoutFaultErrorOnce(fault)
      if (retryFault === undefined) {
        if (!this.reportedLayoutFaultRecovered) {
          this.reportedLayoutFaultRecovered = true
          this.host.onFaultError?.(
            new Error(
              'ink layout pass threw; recovered by immediate re-layout',
            ),
          )
        }
        return
      }
      this.reportLayoutFaultErrorOnce(retryFault)
      if (!this.reportedLayoutFaultDropped) {
        this.reportedLayoutFaultDropped = true
        this.host.onFaultError?.(
          new Error(
            'ink layout pass threw; immediate re-layout also threw, frame dropped',
          ),
        )
      }
      if (
        !this.reportedLayoutFaultPersisting &&
        this.failedLayouts >= PERSISTING_FAULT_THRESHOLD
      ) {
        this.reportedLayoutFaultPersisting = true
        this.host.onFaultError?.(
          new Error(
            'ink layout pass still throwing after many consecutive commits, frames dropped',
          ),
        )
      }
    } catch {
      // never throw from reporting
    }
  }

  private reportLayoutFaultErrorOnce(error: Error): void {
    const messages = this.reportedLayoutFaultMessages
    if (
      messages.has(error.message) ||
      messages.size >= MAX_FAULT_ERROR_MESSAGES
    )
      return
    messages.add(error.message)
    this.host.onFaultError?.(error)
  }

  private logLayoutFaultForDebugging(
    fault: Error,
    retryFault: Error | undefined,
  ): void {
    try {
      if (this.layoutFaultDebugLines >= MAX_FAULT_DEBUG_LINES) return
      this.layoutFaultDebugLines++
      const outcome =
        retryFault === undefined
          ? 'recovered by immediate re-layout'
          : `immediate re-layout also threw (${retryFault.name}: ${retryFault.message}); frame dropped`
      const capNote =
        this.layoutFaultDebugLines >= MAX_FAULT_DEBUG_LINES
          ? ' — further layout faults in this session are not logged'
          : ''
      this.host.onFaultMessage?.(
        `ink layout pass threw (${outcome}): ${fault.name}: ${fault.message}${capNote}`,
        { level: 'warn' },
      )
    } catch {
      // ignore
    }
  }
}
