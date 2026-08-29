/**
 * densable 2.1.239 `Axc` — main-screen sticky transcript compositor.
 *
 * Gold: docs/upstream-extraction/v2.1.239/snippets/gold-project-c-axc-*.{md,txt}
 * CSI map: C1e=DECSTBM, mSe=CUP, Exe=reset STBM, tO=HOME, D$=2J, gsr=3J,
 * xce=hide cursor, Ioe=show cursor, pYn/s9r=BSU/ESU, Z3e=EL2, Exc=EL0.
 *
 * Alt-screen: host frameSink suspends Axc (returns false → Ink cell-diff).
 * Do not wire Axc into alt-screen handleResize.
 */

import { writeSync } from 'fs'
import type { Writable } from 'stream'
import {
  NATIVE_HISTORY_BOTTOM_CHROME,
  NATIVE_HISTORY_CAP,
  NATIVE_HISTORY_PUMP_BATCH,
  type GapRange,
  type ResizeOutcome,
  type ViewportModel,
} from './nativeHistoryPump.js'
import {
  CURSOR_HOME,
  cursorPosition,
  ERASE_LINE,
  ERASE_SCREEN,
  ERASE_SCROLLBACK,
  RESET_SCROLL_REGION,
  setScrollRegion,
} from './termio/csi.js'
import { BSU, ESU, HIDE_CURSOR, SHOW_CURSOR } from './termio/dec.js'
import { isSynchronizedOutputSupported } from './terminal.js'

const SGR_RESET = '\x1b[0m'
const ERASE_TO_EOL = '\x1b[K'

export type AxcDrawLayout = {
  contentHeight: number
  bottomTop: number
  bottomLines: string[]
  overlayLines: string[]
}

export type AxcOnWrite = (startedMs: number, bytes: number) => void

/**
 * densable `Axc` — writes DECSTBM / CUP / EL into a buf, flushes via `out`.
 */
export class Axc {
  out: Writable
  cols: number
  rows: number
  onWrite: AxcOnWrite | undefined
  buf = ''
  lastFrame = ''
  syncOpen = false
  suspended = false
  restored = false
  tailSlack = 0
  contentOverlayRows = 0
  overlayRatchet = 0
  onScreen: string[] = []
  replayPending = false
  committedTop = 0
  nativeHistory: string[] = []
  pumpCursor = -1
  contentHeight: number
  private _backfillNeeded = false
  private _gapRange: GapRange | null = null
  private _suspendedCols = 0
  private _suspendedRows = 0

  constructor(out: Writable, cols: number, rows: number, onWrite?: AxcOnWrite) {
    this.out = out
    this.cols = cols
    this.rows = rows
    this.onWrite = onWrite
    this.contentHeight = Math.max(2, rows - NATIVE_HISTORY_BOTTOM_CHROME)
  }

  setup(): void {
    this.resetTransientState()
    this.buf += HIDE_CURSOR
    this.buf += '\n'.repeat(Math.max(0, this.rows - this.contentHeight))
    this.buf += setScrollRegion(1, Math.max(2, this.contentHeight))
    for (let e = this.contentHeight; e < this.rows; e++) this.clearLine(e)
    this.commitImmediate()
  }

  suspend(): void {
    this.suspended = true
    this._suspendedCols = this.cols
    this._suspendedRows = this.rows
    this.buf += RESET_SCROLL_REGION
    this.commitImmediate()
  }

  resume(cols: number, rows: number): void {
    this.suspended = false
    const sizeChanged =
      cols !== this._suspendedCols || rows !== this._suspendedRows
    this.cols = cols
    this.rows = rows
    this.contentHeight = Math.max(2, rows - NATIVE_HISTORY_BOTTOM_CHROME)
    this.buf += HIDE_CURSOR
    this.buf += setScrollRegion(1, this.contentHeight)
    this.buf += CURSOR_HOME
    if (sizeChanged) {
      this.buf += ERASE_SCREEN + ERASE_SCROLLBACK + CURSOR_HOME
      this.resetTransientState()
      this.replayPending = true
      this.pumpCursor = this.nativeHistory.length > 0 ? 0 : -1
      this.lastFrame = ''
    }
    this.commitImmediate()
  }

  restore(): void {
    if (this.restored) return
    this.restored = true
    this.buf += SGR_RESET
    for (let e = this.contentHeight; e < this.rows; e++) this.clearLine(e)
    this.buf += RESET_SCROLL_REGION
    this.buf += cursorPosition(this.contentHeight + 1, 1)
    this.buf += SHOW_CURSOR
    // Gold restore ends in commitImmediate() → out.write. process.exit drops
    // that async write; keep the CSI r + CUP + SHOW sequence, flush via
    // writeSync when `out` has an fd. PassThrough tests still use out.write.
    const startedMs = performance.now()
    const payload = this.buf
    this.buf = ''
    const fd = (this.out as unknown as { fd?: number }).fd
    /* eslint-disable custom-rules/no-sync-fs -- process exiting; async writes would be dropped */
    if (typeof fd === 'number' && fd >= 0) {
      writeSync(fd, payload)
    } else {
      this.out.write(payload)
    }
    /* eslint-enable custom-rules/no-sync-fs */
    this.onWrite?.(startedMs, Buffer.byteLength(payload))
  }

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
      this.buf +=
        RESET_SCROLL_REGION + ERASE_SCREEN + ERASE_SCROLLBACK + CURSOR_HOME
      this.buf += setScrollRegion(1, Math.max(2, nextContent))
      this.resetTransientState()
      this.replayPending = true
      this.pumpCursor = this.nativeHistory.length > 0 ? 0 : -1
      this.lastFrame = ''
      this.commitImmediate()
      return 'replay'
    }
    this.buf += setScrollRegion(1, Math.max(2, nextContent))
    this.lastFrame = ''
    this.commitImmediate()
    return 'adjust'
  }

  tickPump(): boolean {
    if (this.pumpCursor < 0) return false
    const history = this.nativeHistory
    this.buf += setScrollRegion(1, 2)
    const end = Math.min(
      this.pumpCursor + NATIVE_HISTORY_PUMP_BATCH,
      history.length,
    )
    for (; this.pumpCursor < end; this.pumpCursor++) {
      this.buf +=
        cursorPosition(1, 1) +
        history[this.pumpCursor]! +
        SGR_RESET +
        ERASE_TO_EOL
      this.buf += cursorPosition(2, 1) + '\n'
    }
    this.buf += setScrollRegion(1, Math.max(2, this.contentHeight))
    this.lastFrame = ''
    this.commitImmediate()
    if (this.pumpCursor >= history.length) this.pumpCursor = -1
    return this.pumpCursor >= 0
  }

  syncViewport(viewport: ViewportModel, contentHeight: number): void {
    if (this.suspended) return
    if (this.pumpCursor >= 0) return
    if (!this.syncOpen && isSynchronizedOutputSupported()) {
      this.buf += BSU
      this.syncOpen = true
    }
    this.restoreUnderContentOverlay()
    if (this.replayPending) {
      this.replayPending = false
      this.committedTop = Math.min(viewport.scrollTop, viewport.transcriptEnd)
    }

    const scrollTop = Math.min(viewport.scrollTop, viewport.transcriptEnd)
    const scrolled = Math.max(0, scrollTop - this.committedTop)
    if (scrolled > 0) {
      const take = Math.min(scrolled, this.onScreen.length)
      if (take > 0) {
        this.buf += cursorPosition(this.contentHeight, 1)
        this.buf += '\n'.repeat(take)
        for (let d = 0; d < take; d++) {
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
      this.buf += setScrollRegion(1, Math.max(2, contentHeight))
    }

    const offset = Math.max(0, this.committedTop - viewport.scrollTop)
    const i = this.contentHeight
    const s = Math.min(viewport.lines.length, i)
    const a = Math.max(0, s - offset)
    const l = Math.max(0, i - this.onScreen.length)
    if (this.onScreen.length > i) this.onScreen.length = i
    while (this.onScreen.length < i) this.onScreen.push('')
    for (let c = 0; c < i; c++) {
      const u = c < a ? (viewport.lines[offset + c] ?? '') : ''
      if (c < i - l && this.onScreen[c] === u) continue
      this.buf += cursorPosition(c + 1, 1) + u + SGR_RESET + ERASE_TO_EOL
      this.onScreen[c] = u
    }
    this.tailSlack = Math.max(0, i - a)
  }

  draw(layout: AxcDrawLayout): void {
    if (this.suspended) return
    const wasSyncOpen = this.syncOpen
    if (!this.syncOpen && isSynchronizedOutputSupported()) {
      this.buf += BSU
    }
    const sliceStart = this.buf.length
    this.buf += HIDE_CURSOR
    this.restoreUnderContentOverlay()
    if (layout.contentHeight !== this.contentHeight) {
      this.contentHeight = layout.contentHeight
      this.buf += setScrollRegion(1, Math.max(2, layout.contentHeight))
    }
    for (let i = this.contentHeight; i < this.rows; i++) this.clearLine(i)
    if (this.tailSlack > 0) {
      const start = this.contentHeight - this.tailSlack
      for (let s = start; s < this.contentHeight; s++) this.clearLine(s)
    }
    this.writeOverlayLines(layout.bottomTop, layout.bottomLines)
    const n = layout.overlayLines.length
    if (n > 0) {
      this.overlayRatchet = Math.max(this.overlayRatchet, n)
      const i = Math.max(0, this.rows - this.overlayRatchet)
      this.writeOverlayLines(i, layout.overlayLines)
      for (let s = i + n; s < this.rows; s++) this.clearLine(s)
      this.contentOverlayRows = Math.max(
        0,
        this.contentHeight - Math.max(0, i - 1),
      )
    } else {
      this.overlayRatchet = 0
      this.contentOverlayRows = 0
    }
    const frameSlice = this.buf.slice(sliceStart)
    // densable Axc.draw: unchanged chrome wipes the whole buf and returns
    // without commitImmediate. Do not invent a chrome-slice-only drop.
    if (!wasSyncOpen && frameSlice === this.lastFrame) {
      this.buf = ''
      this.syncOpen = false
      return
    }
    this.lastFrame = frameSlice
    if (isSynchronizedOutputSupported()) this.buf += ESU
    this.syncOpen = false
    this.commitImmediate()
  }

  computeLayout(bottomLines: string[], overlayLines: string[]): AxcDrawLayout {
    const reserved = Math.max(NATIVE_HISTORY_BOTTOM_CHROME, bottomLines.length)
    return {
      contentHeight: Math.max(2, this.rows - reserved),
      bottomTop: this.rows - reserved,
      bottomLines,
      overlayLines,
    }
  }

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
    this.buf += RESET_SCROLL_REGION + ERASE_SCREEN + ERASE_SCROLLBACK
    this.buf += CURSOR_HOME
    this.buf += setScrollRegion(1, Math.max(2, this.contentHeight))
    this.resetTransientState()
    this.nativeHistory.length = 0
    this.pumpCursor = -1
    this.replayPending = true
    this.lastFrame = ''
    this.commitImmediate()
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

  resetTransientState(): void {
    this.tailSlack = 0
    this.contentOverlayRows = 0
    this.overlayRatchet = 0
    this.onScreen.length = 0
    this.committedTop = 0
  }

  private restoreUnderContentOverlay(): void {
    const e = this.contentOverlayRows
    if (e === 0) return
    this.contentOverlayRows = 0
    const t = this.contentHeight
    const r = this.onScreen.length
    for (let n = 0; n < e; n++) {
      const o = t - 1 - n
      if (o < 0) break
      this.buf += cursorPosition(o + 1, 1) + ERASE_LINE
      const i = r - 1 - n
      if (i >= 0) this.buf += this.onScreen[i]! + SGR_RESET
    }
  }

  private clearLine(row: number): void {
    // densable clearLine(e): CUP(e+1,1) + CSI 2 K (full line erase)
    this.buf += cursorPosition(row + 1, 1) + ERASE_LINE
  }

  private writeOverlayLines(top: number, lines: string[]): void {
    for (let r = 0; r < lines.length; r++) {
      this.buf +=
        cursorPosition(top + r + 1, 1) + lines[r]! + SGR_RESET + ERASE_TO_EOL
    }
  }

  commitImmediate(): void {
    if (this.buf.length === 0) return
    const startedMs = performance.now()
    this.out.write(this.buf)
    this.onWrite?.(startedMs, Buffer.byteLength(this.buf))
    this.buf = ''
  }
}
