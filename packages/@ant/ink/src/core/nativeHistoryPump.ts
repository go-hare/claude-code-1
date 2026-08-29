/**
 * densable 2.1.239 `Axc` native-history pump — pure state machine (Project C Phase-1).
 *
 * Gold: docs/upstream-extraction/v2.1.239/snippets/gold-project-c-axc-*.{md,txt}
 * Constants lock: q$0=100, uyn=1e4, dyn=4
 *
 * Live compositor is `Axc` (`axc.ts`). This class is the Phase-1 state
 * machine the `*.239` pump tests lock. Do not invent a second history
 * capture path in Ink.handleResize / alt-screen.
 */

/** densable `q$0` — lines emitted per `tickPump` call. */
export const NATIVE_HISTORY_PUMP_BATCH = 100

/** densable `uyn` — hard cap on `nativeHistory` length. */
export const NATIVE_HISTORY_CAP = 10_000

/** densable `dyn` — reserved bottom chrome rows. */
export const NATIVE_HISTORY_BOTTOM_CHROME = 4

export type ResizeOutcome = 'noop' | 'replay' | 'adjust'

export type GapRange = { from: number; to: number }

export type ViewportModel = {
  lines: string[]
  scrollTop: number
  scrollHeight: number
  transcriptEnd: number
}

/**
 * Pump-facing subset of densable `Axc` — history arming, batch replay,
 * syncViewport early-return while pumping. Escape-sequence writers are
 * injected so unit tests lock the contract without a TTY.
 */
export class NativeHistoryPump {
  cols: number
  rows: number
  contentHeight: number
  suspended = false
  replayPending = false
  committedTop = 0
  nativeHistory: string[] = []
  pumpCursor = -1
  onScreen: string[] = []
  tailSlack = 0
  contentOverlayRows = 0
  overlayRatchet = 0
  _backfillNeeded = false
  _gapRange: GapRange | null = null
  private _suspendedCols = 0
  private _suspendedRows = 0

  /** Lines flushed by the last `tickPump` (test / sink observation). */
  lastEmittedBatch: string[] = []

  constructor(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
    this.contentHeight = Math.max(2, rows - NATIVE_HISTORY_BOTTOM_CHROME)
  }

  resetTransientState(): void {
    this.tailSlack = 0
    this.contentOverlayRows = 0
    this.overlayRatchet = 0
    this.onScreen.length = 0
    this.committedTop = 0
  }

  /**
   * densable `handleResize(e,t)` — returns outcome string; arms pump on replay.
   */
  handleResize(cols: number, rows: number): ResizeOutcome {
    if (cols === this.cols && rows === this.rows) return 'noop'
    if (this.suspended) {
      this.cols = cols
      this.rows = rows
      return 'noop'
    }
    const widthChanged = cols !== this.cols
    const prevRows = this.rows
    this.cols = cols
    this.rows = rows
    const nextContent = Math.max(2, rows - NATIVE_HISTORY_BOTTOM_CHROME)
    this.contentHeight = nextContent
    if (widthChanged || rows < prevRows) {
      this.resetTransientState()
      this.replayPending = true
      this.pumpCursor = this.nativeHistory.length > 0 ? 0 : -1
      return 'replay'
    }
    return 'adjust'
  }

  suspend(): void {
    this.suspended = true
    this._suspendedCols = this.cols
    this._suspendedRows = this.rows
  }

  /**
   * densable `resume(e,t)` — if dims differ from suspend snapshot, arm like replay.
   */
  resume(cols: number, rows: number): void {
    this.suspended = false
    const sizeChanged =
      cols !== this._suspendedCols || rows !== this._suspendedRows
    this.cols = cols
    this.rows = rows
    this.contentHeight = Math.max(2, rows - NATIVE_HISTORY_BOTTOM_CHROME)
    if (sizeChanged) {
      this.resetTransientState()
      this.replayPending = true
      this.pumpCursor = this.nativeHistory.length > 0 ? 0 : -1
    }
  }

  /**
   * densable `tickPump()` — emit up to `q$0` history lines; return true if more remain.
   */
  tickPump(): boolean {
    if (this.pumpCursor < 0) return false
    const history = this.nativeHistory
    const end = Math.min(
      this.pumpCursor + NATIVE_HISTORY_PUMP_BATCH,
      history.length,
    )
    const batch: string[] = []
    for (; this.pumpCursor < end; this.pumpCursor++) {
      batch.push(history[this.pumpCursor]!)
    }
    this.lastEmittedBatch = batch
    if (this.pumpCursor >= history.length) this.pumpCursor = -1
    return this.pumpCursor >= 0
  }

  /**
   * densable `syncViewport` pump gate + scroll-out history capture.
   * Full onScreen paint / DECSTBM is compositor concern — not Phase-1.
   */
  syncViewport(viewport: ViewportModel, contentHeight: number): void {
    if (this.suspended) return
    // densable: if (this.pumpCursor >= 0) return
    if (this.pumpCursor >= 0) return

    if (this.replayPending) {
      this.replayPending = false
      this.committedTop = Math.min(viewport.scrollTop, viewport.transcriptEnd)
    }

    const scrollTop = Math.min(viewport.scrollTop, viewport.transcriptEnd)
    const scrolled = Math.max(0, scrollTop - this.committedTop)
    if (scrolled > 0) {
      const take = Math.min(scrolled, this.onScreen.length)
      if (take > 0) {
        for (let i = 0; i < take; i++) {
          this.nativeHistory.push(this.onScreen.shift()!)
        }
        if (this.nativeHistory.length > NATIVE_HISTORY_CAP) {
          this.nativeHistory.splice(
            0,
            this.nativeHistory.length - NATIVE_HISTORY_CAP,
          )
        }
      }
      const advanced = this.committedTop + take
      this.committedTop = scrollTop
      if (advanced < scrollTop) {
        this._gapRange = { from: advanced, to: scrollTop }
      }
      if (this.nativeHistory.length === 0 && scrollTop > 0) {
        this._backfillNeeded = true
      }
    }

    if (contentHeight !== this.contentHeight) {
      this.contentHeight = contentHeight
    }
  }

  consumeBackfillNeeded(): boolean {
    if (!this._backfillNeeded) return false
    this._backfillNeeded = false
    return true
  }

  consumeGapRange(): GapRange | null {
    const gap = this._gapRange
    this._gapRange = null
    return gap
  }

  /**
   * densable `primeBackfill(e)` — append lines, arm pump at pre-append index.
   */
  primeBackfill(lines: string[]): void {
    if (lines.length === 0) return
    const before = this.nativeHistory.length
    for (const line of lines) this.nativeHistory.push(line)
    if (this.nativeHistory.length > NATIVE_HISTORY_CAP) {
      const overflow = this.nativeHistory.length - NATIVE_HISTORY_CAP
      this.nativeHistory.splice(0, overflow)
      this.pumpCursor = Math.max(0, before - overflow)
    } else {
      this.pumpCursor = before
    }
    this.replayPending = true
    if (before > 0) this.onScreen.length = 0
  }

  switchTranscript(): void {
    this.resetTransientState()
    this.nativeHistory.length = 0
    this.pumpCursor = -1
    this.replayPending = true
  }

  computeLayout(
    bottomLines: string[],
    overlayLines: string[],
  ): {
    contentHeight: number
    bottomTop: number
    bottomLines: string[]
    overlayLines: string[]
  } {
    const reserved = Math.max(NATIVE_HISTORY_BOTTOM_CHROME, bottomLines.length)
    return {
      contentHeight: Math.max(2, this.rows - reserved),
      bottomTop: this.rows - reserved,
      bottomLines,
      overlayLines,
    }
  }
}
