import {
  eraseViewportInPlace,
  eraseViewportInPlaceForGhostty,
  isGhosttyErasedRowsStayJoined,
} from './clearTerminal.js'
import type { FlickerReason, Frame } from './frame.js'
import {
  CellWidth,
  type CharPool,
  cellAt,
  copyRows,
  createScreen,
  type HyperlinkPool,
  resetScreen,
  type Screen,
  type StylePool,
} from './screen.js'
import {
  CSI_PREFIX,
  CURSOR_HOME,
  cursorMove,
  ERASE_SCREEN,
} from './termio/csi.js'
import { HIDE_CURSOR, SHOW_CURSOR } from './termio/dec.js'
import { LINK_END, link } from './termio/osc.js'

const UNSET = -1
const STYLE_CACHE_CAP = 4096
const MAX_INLINE_SLICE_CELLS = 134_217_728 // Jm
const FALLBACK_SLICE_CELLS = 4_194_304 // jA
const SGR_RESET = `${CSI_PREFIX}m`
const SGR_SPLIT_JOIN = `m${CSI_PREFIX}`
const EXTENDED_COLOR_RE = /\b[345]8(;5|;2(;\d*){0,2})?m/
const NON_ASCII_RE = /[^ -~]/

function csiCount(n: number, cmd: string): string {
  return n === 1 ? CSI_PREFIX + cmd : CSI_PREFIX + n + cmd
}

function compactSgr(seq: string): string {
  const merged = seq.replaceAll(SGR_SPLIT_JOIN, ';')
  if (merged.split(/[;:]/).length > 10 || EXTENDED_COLOR_RE.test(seq)) {
    return seq
  }
  return merged
}

export type TerminalRenderCapabilities = {
  synchronizedOutput: boolean
  syncRedrawsEverything: boolean
  wholeWriteBytes: number
  repeatCharacter: boolean
  eraseCharacters: boolean
  insertDeleteLines: boolean
  repaintsEveryCell: boolean
  clearSavesToScrollback: boolean
  printsUnknownSequences: boolean
  resizeDropsBlankRowsBelow: boolean
  erasedRowsStayJoined?: boolean
  reflows?: boolean
  shorterWindowKeepsRowsBelowCursor?: boolean
}

export type RenderTargetFrame = {
  readonly screen: Screen
  readonly top: number
  readonly viewport: { readonly width: number; readonly height: number }
  readonly cursor: {
    readonly x: number
    readonly y: number
    readonly visible: boolean
    readonly staysVisible?: boolean
  }
  readonly popover?: { readonly top: number; readonly height: number }
}

export type ByteRenderResult = {
  readonly bytes: string
  readonly hasChanges: boolean
  readonly mayTear: boolean
  readonly cleared?: FlickerReason
  readonly changedRow?: number
}

/**
 * Official 2.1.328 `ql()` — derive byte-encoder terminal capabilities for the
 * active session.
 */
export function getTerminalRenderCapabilities(opts?: {
  synchronizedOutput?: boolean
  repaintsEveryCell?: boolean
  printsUnknownSequences?: boolean
  clearSavesToScrollback?: boolean
  erasedRowsStayJoined?: boolean
  reflows?: boolean
  shorterWindowKeepsRowsBelowCursor?: boolean
}): TerminalRenderCapabilities {
  return {
    synchronizedOutput: opts?.synchronizedOutput ?? true,
    syncRedrawsEverything: false,
    wholeWriteBytes: 1024,
    repeatCharacter: false,
    eraseCharacters: true,
    insertDeleteLines: false,
    repaintsEveryCell: opts?.repaintsEveryCell ?? false,
    clearSavesToScrollback: opts?.clearSavesToScrollback ?? false,
    printsUnknownSequences: opts?.printsUnknownSequences ?? false,
    resizeDropsBlankRowsBelow: false,
    erasedRowsStayJoined:
      opts?.erasedRowsStayJoined ?? isGhosttyErasedRowsStayJoined(),
    reflows: opts?.reflows ?? true,
    shorterWindowKeepsRowsBelowCursor:
      opts?.shorterWindowKeepsRowsBelowCursor ?? true,
  }
}

/**
 * Official 2.1.328 `ip` — stateful ANSI byte encoder tracking cursor, active
 * style/hyperlink, and compact SGR transitions.
 */
export class TerminalEncoder {
  readonly stylePool: StylePool
  bytes = ''
  x = UNSET
  y = UNSET
  isCursorVisible = false
  wroteRowInDoubt = false
  private style = 0
  private linkId = 0
  private rowsAreAbsolute = false
  private mayHaveDrifted = false
  private readonly styleChanges = new Map<number, string>()
  private styleGeneration = 0

  constructor(stylePool: StylePool) {
    this.stylePool = stylePool
  }

  begin(startY?: number): void {
    this.style = 0
    this.linkId = 0
    this.bytes = ''
    this.x = UNSET
    this.y = startY ?? UNSET
    this.rowsAreAbsolute = startY === undefined
    this.wroteRowInDoubt = false
    if (this.styleGeneration !== this.stylePool.generation) {
      this.styleGeneration = this.stylePool.generation
      this.styleChanges.clear()
    }
  }

  end(wantVisible: boolean, hideDuringWrite: boolean): string {
    if (this.isCursorVisible && (hideDuringWrite || !wantVisible)) {
      this.bytes = HIDE_CURSOR + this.bytes
      this.isCursorVisible = false
    }
    if (wantVisible && !this.isCursorVisible) {
      this.bytes += SHOW_CURSOR
    }
    this.isCursorVisible = wantVisible
    return this.bytes
  }

  raw(seq: string, x: number, y: number): void {
    this.resetStyle()
    this.bytes += seq
    this.x = x
    this.y = y
  }

  moveTo(x: number, y: number): void {
    if (y !== this.y && this.mayHaveDrifted) {
      this.x = UNSET
    }
    const horiz = x === this.x ? '' : x === 0 ? '\r' : `${CSI_PREFIX}${x + 1}G`
    this.mayHaveDrifted = this.mayHaveDrifted && horiz === ''
    if (y === this.y) {
      this.bytes += horiz
      this.x = x
      return
    }
    this.setLink(0)
    let move: string | undefined
    if (this.y !== UNSET) {
      const dy = y - this.y
      move =
        dy < 0
          ? horiz + csiCount(-dy, 'A')
          : x === 0 && dy <= 2 && !this.rowsAreAbsolute
            ? '\r\n\n'.slice(0, dy + 1)
            : horiz + csiCount(dy, 'B')
    }
    if (this.rowsAreAbsolute) {
      const abs =
        x === 0 ? csiCount(y + 1, 'H') : `${CSI_PREFIX}${y + 1};${x + 1}H`
      if (move === undefined || abs.length <= move.length) {
        move = abs
      }
    }
    this.bytes += move ?? ''
    this.x = x
    this.y = y
  }

  placeCursor(x: number, y: number): void {
    if (this.mayHaveDrifted) this.x = UNSET
    this.moveTo(x, y)
  }

  feedLines(count: number, nextY: number): void {
    this.useBlankStyle()
    this.bytes += `\r${'\n'.repeat(count)}`
    this.mayHaveDrifted = false
    this.x = 0
    this.y = nextY
  }

  setStyle(styleId: number): void {
    if (styleId === this.style) return
    const key = this.style * 32768 + styleId
    let seq = this.styleChanges.get(key)
    if (seq === undefined) {
      if (this.styleChanges.size >= STYLE_CACHE_CAP) {
        this.styleChanges.clear()
      }
      const codes = this.stylePool.get(styleId).map(c => c.code)
      const resetForm =
        codes.length === 0
          ? SGR_RESET
          : compactSgr(`${CSI_PREFIX}0m${codes.join('')}`)
      const deltaForm = compactSgr(
        this.stylePool.transition(this.style, styleId),
      )
      seq = resetForm.length < deltaForm.length ? resetForm : deltaForm
      this.styleChanges.set(key, seq)
    }
    this.bytes += seq
    this.style = styleId
  }

  setLink(linkId: number, pool?: HyperlinkPool): void {
    if (linkId === this.linkId) return
    if (linkId === 0) {
      this.bytes += LINK_END
    } else {
      const url = pool?.get(linkId) ?? ''
      this.bytes += url ? link(url) : LINK_END
    }
    this.linkId = linkId
  }

  resetStyle(): void {
    this.setLink(0)
    this.setStyle(0)
  }

  useBlankStyle(): void {
    this.setLink(0)
    if (this.style !== 0) this.setStyle(0)
  }

  write(text: string, nextX: number, columns: number): void {
    this.bytes += text
    if (!this.mayHaveDrifted) {
      this.mayHaveDrifted =
        text.length === 1 ? text >= '\x80' : NON_ASCII_RE.test(text)
    }
    this.x = nextX < columns ? nextX : UNSET
  }

  eraseToEndOfRow(): void {
    this.useBlankStyle()
    this.bytes += `${CSI_PREFIX}K`
  }

  repeatLast(count: number): void {
    this.bytes += csiCount(count, 'b')
    this.x += count
  }

  eraseCells(count: number): void {
    this.useBlankStyle()
    this.bytes += csiCount(count, 'X')
  }

  insertRows(y: number, count: number): void {
    this.moveTo(0, y)
    this.useBlankStyle()
    this.bytes += csiCount(count, 'L')
  }

  deleteRows(y: number, count: number): void {
    this.moveTo(0, y)
    this.useBlankStyle()
    this.bytes += csiCount(count, 'M')
  }
}

// Official 2.1.328 `US` / `WS` / `Zl` / `zr`:
// Packed word1 layout: styleId[31:17] | hyperlinkId[16:2] | width[1:0]
// Bit 17 is bit 0 of styleId (visible-on-space flag); bits [16:2] are hyperlinkId.
const CELL_VISIBLE_SPACE_OR_LINK_MASK = (0x7fff << 2) | (1 << 17)
const CELL_WIDTH_MASK = 3
const BLANK_CHAR_INDEX = 0 // WS = 0 (' ')
const DIRTY_CHAR_INDEX = 1 // Zl = 1 (unmatchable dirty sentinel when word1 = 0)

function isBlankCell(cells: Int32Array, ci: number): boolean {
  const w0 = cells[ci]!
  const w1 = cells[ci + 1]!
  return (
    (w1 & CELL_VISIBLE_SPACE_OR_LINK_MASK) === 0 &&
    (w0 === BLANK_CHAR_INDEX ||
      (w0 === DIRTY_CHAR_INDEX &&
        (w1 & CELL_WIDTH_MASK) === CellWidth.SpacerHead))
  )
}

function rowContentEnd(screen: Screen, row: number): number {
  if (row < 0 || row >= screen.height) return 0
  const w = screen.width
  const cells = screen.cells
  let end = w
  while (end > 0 && isBlankCell(cells, (row * w + end - 1) * 2)) end--
  return end
}

function rowsDiffer(a: Screen, rowA: number, b: Screen, rowB: number): boolean {
  const aValid = rowA >= 0 && rowA < a.height
  const bValid = rowB >= 0 && rowB < b.height
  if (!aValid && !bValid) return false
  if (!aValid) return rowContentEnd(b, rowB) > 0
  if (!bValid) return rowContentEnd(a, rowA) > 0
  const w = Math.min(a.width, b.width)
  const aCells = a.cells
  const bCells = b.cells
  const aBase = rowA * a.width * 2
  const bBase = rowB * b.width * 2
  for (let x = 0; x < w; x++) {
    const aCi = aBase + (x << 1)
    const bCi = bBase + (x << 1)
    if (
      (aCells[aCi] !== bCells[bCi] || aCells[aCi + 1] !== bCells[bCi + 1]) &&
      !(isBlankCell(aCells, aCi) && isBlankCell(bCells, bCi))
    ) {
      return true
    }
  }
  return false
}

function diffRowRange(
  shown: Screen,
  shownStart: number,
  next: Screen,
  nextStart: number,
  count: number,
): [number, number] {
  let first = count
  let last = 0
  for (let i = 0; i < count; i++) {
    if (rowsDiffer(shown, shownStart + i, next, nextStart + i)) {
      if (first === count) first = i
      last = i + 1
    }
  }
  return first < last ? [first, last] : [0, 0]
}

/**
 * Official 2.1.328 `No(screen, fromRow, toRow)` — fill rows `[fromRow, toRow)`
 * with the unmatchable dirty sentinel `(charId = 1, word1 = 0)` (`1n` on LE)
 * so both `diffRowRange` and `RowDrawer.draw` treat those cells as differing
 * from blank `0n` and emit `EL` / spaces to erase stale terminal content.
 */
function invalidateScreenRows(
  screen: Screen,
  fromRow: number,
  toRow: number,
): void {
  const lo = Math.max(0, fromRow)
  const hi = Math.min(screen.height, toRow)
  if (lo >= hi) return
  const { cells, width } = screen
  for (let ci = lo * width * 2, end = hi * width * 2; ci < end; ci += 2) {
    cells[ci] = DIRTY_CHAR_INDEX
    cells[ci + 1] = 0
  }
}

/**
 * Official 2.1.328 `rp` — per-row cell differ that emits minimal ANSI writes
 * through `TerminalEncoder` and keeps the `shown` screen buffer synchronized.
 */
export class RowDrawer {
  readonly encoder: TerminalEncoder
  readonly written: number[] = []
  private blankRow = new Int32Array(0)
  private capabilities: TerminalRenderCapabilities | undefined
  private charPool: CharPool | undefined

  constructor(encoder: TerminalEncoder) {
    this.encoder = encoder
  }

  begin(caps?: TerminalRenderCapabilities, charPool?: CharPool): boolean {
    this.written.length = 0
    this.capabilities = caps
    const changed =
      charPool !== undefined &&
      this.charPool !== undefined &&
      this.charPool !== charPool
    if (charPool !== undefined) {
      this.charPool = charPool
    }
    return changed
  }

  draw(shown: Screen, shownRow: number, next: Screen, nextRow: number): void {
    const cols = shown.width
    if (shownRow < 0 || shownRow >= shown.height) return
    const nextInBounds = nextRow >= 0 && nextRow < next.height
    const contentEnd = nextInBounds ? rowContentEnd(next, nextRow) : 0
    const shownCells = shown.cells
    const shownBase = shownRow * cols * 2
    if (!nextInBounds && this.blankRow.length < cols * 2) {
      this.blankRow = new Int32Array(cols * 2)
    }
    const nextCells = nextInBounds ? next.cells : this.blankRow
    const nextBase = nextInBounds ? nextRow * next.width * 2 : 0

    const cellsEqualAt = (col: number): boolean => {
      const aCi = shownBase + (col << 1)
      const bCi = nextBase + (col << 1)
      if (
        shownCells[aCi] === nextCells[bCi] &&
        shownCells[aCi + 1] === nextCells[bCi + 1]
      ) {
        return true
      }
      return isBlankCell(shownCells, aCi) && isBlankCell(nextCells, bCi)
    }

    let x = 0
    while (x < cols) {
      if (cellsEqualAt(x)) {
        x++
        continue
      }
      if (x >= contentEnd) {
        this.encoder.moveTo(contentEnd, shownRow)
        this.encoder.resetStyle()
        this.encoder.eraseToEndOfRow()
        this.written.push(nextRow, contentEnd, cols)
        break
      }
      // Step back if we landed on a wide-char SpacerTail
      if (
        x > 0 &&
        nextInBounds &&
        cellAt(next, x, nextRow)?.width === CellWidth.SpacerTail
      ) {
        x--
      }
      const runStart = x
      this.encoder.moveTo(x, shownRow)
      while (x < contentEnd) {
        if (x > runStart && cellsEqualAt(x)) break
        const bCi = nextBase + (x << 1)
        if (isBlankCell(nextCells, bCi)) {
          let blanks = 1
          while (
            x + blanks < contentEnd &&
            isBlankCell(nextCells, nextBase + ((x + blanks) << 1)) &&
            !isBlankCell(shownCells, shownBase + ((x + blanks) << 1))
          ) {
            blanks++
          }
          this.encoder.useBlankStyle()
          if (this.capabilities?.repeatCharacter && blanks > 6) {
            this.encoder.write(' ', x + 1, cols)
            this.encoder.repeatLast(blanks - 1)
          } else if (this.capabilities?.eraseCharacters && blanks > 10) {
            this.encoder.eraseCells(blanks)
            this.encoder.moveTo(x + blanks, shownRow)
          } else {
            this.encoder.write(' '.repeat(blanks), x + blanks, cols)
          }
          x += blanks
          continue
        }
        const cell = cellAt(next, x, nextRow)
        if (!cell) {
          this.encoder.useBlankStyle()
          this.encoder.write(' ', x + 1, cols)
          x++
          continue
        }
        if (cell.width === CellWidth.SpacerTail) {
          x++
          continue
        }
        const curB0 = nextCells[bCi]!
        const curB1 = nextCells[bCi + 1]!
        const linkId = cell.hyperlink
          ? next.hyperlinkPool.intern(cell.hyperlink)
          : 0
        this.encoder.setLink(linkId, next.hyperlinkPool)
        this.encoder.setStyle(cell.styleId)
        const advance = cell.width === CellWidth.Wide ? 2 : 1
        this.encoder.write(
          cell.width === CellWidth.SpacerHead ? ' ' : cell.char,
          x + advance,
          cols,
        )
        if (
          this.capabilities?.repeatCharacter &&
          advance === 1 &&
          cell.char.length === 1 &&
          x + 1 < contentEnd &&
          nextCells[nextBase + ((x + 1) << 1)] === curB0 &&
          nextCells[nextBase + ((x + 1) << 1) + 1] === curB1
        ) {
          let runEnd = x + 1
          const limit = Math.min(contentEnd, cols - 1)
          while (
            runEnd < limit &&
            nextCells[nextBase + (runEnd << 1)] === curB0 &&
            nextCells[nextBase + (runEnd << 1) + 1] === curB1
          ) {
            runEnd++
          }
          const repeatCount = runEnd - x - 1
          if (repeatCount >= (cell.char < '\x80' ? 6 : 2)) {
            this.encoder.repeatLast(repeatCount)
            x = runEnd
            continue
          }
        }
        x += advance
      }
      this.written.push(nextRow, runStart, x)
    }

    // Sync shown row with next row
    const dstBase = shownRow * cols
    if (nextInBounds) {
      const copyCols = Math.min(cols, next.width)
      shown.cells64.set(
        next.cells64.subarray(
          nextRow * next.width,
          nextRow * next.width + copyCols,
        ),
        dstBase,
      )
      if (copyCols < cols) {
        shown.cells64.fill(0n, dstBase + copyCols, dstBase + cols)
      }
    } else {
      shown.cells64.fill(0n, dstBase, dstBase + cols)
    }
  }

  /**
   * Official 2.1.328 `rp.withoutWrittenCells(screen)` — clone screen with all
   * written cell runs marked `-1` so `TerminalImages.placeIterm` re-draws any
   * iTerm2 image whose underlying cells were overwritten this frame.
   */
  withoutWrittenCells(screen: Screen): Screen {
    const { width, height } = screen
    const cells = screen.cells.slice(0, width * height * 2)
    for (let i = 0; i < this.written.length; i += 3) {
      const row = this.written[i]!
      if (row < 0 || row >= height) continue
      const rowOffset = row * width
      const fromCol = Math.max(0, this.written[i + 1]!)
      const toCol = Math.min(width, this.written[i + 2]!)
      if (fromCol < toCol) {
        cells.fill(-1, (rowOffset + fromCol) * 2, (rowOffset + toCol) * 2)
      }
    }
    return { ...screen, cells, cells64: new BigInt64Array(cells.buffer) }
  }
}

function normalizeScreenWidth(
  frame: RenderTargetFrame,
  stylePool: StylePool,
): Screen {
  const { screen, viewport } = frame
  if (screen.width === viewport.width) return screen
  const resized = createScreen(
    viewport.width,
    screen.height,
    stylePool,
    screen.charPool,
    screen.hyperlinkPool,
  )
  const cols = Math.min(screen.width, viewport.width)
  for (let y = 0; y < screen.height; y++) {
    resized.cells64.set(
      screen.cells64.subarray(y * screen.width, y * screen.width + cols),
      y * resized.width,
    )
    resized.noSelect.set(
      screen.noSelect.subarray(y * screen.width, y * screen.width + cols),
      y * resized.width,
    )
    resized.softWrap[y] = screen.softWrap[y]!
  }
  return resized
}

function finalizeBytes(
  encoder: TerminalEncoder,
  caps: TerminalRenderCapabilities,
  cursor: RenderTargetFrame['cursor'],
  meta: {
    hasChanges: boolean
    movedRows: boolean
    isRedraw: boolean
    cleared?: FlickerReason
    changedRow?: number
  },
): ByteRenderResult {
  const mayTear =
    (meta.hasChanges && caps.repaintsEveryCell) ||
    Buffer.byteLength(encoder.bytes) > caps.wholeWriteBytes ||
    (!caps.syncRedrawsEverything && (meta.movedRows || Boolean(meta.cleared)))
  const hideDuringWrite = mayTear && !cursor.staysVisible
  encoder.isCursorVisible =
    encoder.isCursorVisible &&
    (!(meta.isRedraw || meta.hasChanges) ||
      !cursor.visible ||
      (hideDuringWrite && meta.hasChanges))
  return {
    bytes: encoder.end(cursor.visible, hideDuringWrite),
    hasChanges: meta.hasChanges,
    mayTear,
    cleared: meta.cleared,
    changedRow: meta.changedRow,
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function frameTotalRows(frame: { top?: number; screen: Screen }): number {
  return (frame.top ?? 0) + frame.screen.height
}

function frameFillsViewport(frame: {
  top?: number
  screen: Screen
  viewport: { height: number }
}): boolean {
  return frameTotalRows(frame) >= frame.viewport.height
}

function frameScrollTop(frame: {
  top?: number
  screen: Screen
  viewport: { height: number }
}): number {
  return Math.max(0, frameTotalRows(frame) - frame.viewport.height + 1)
}

function visualRowsForLogicalRow(
  frame: { screen: Screen; top: number },
  row: number,
  width: number,
  caps: TerminalRenderCapabilities,
): number {
  if (!caps.reflows || width <= 0) return 1
  return Math.ceil(rowContentEnd(frame.screen, row - frame.top) / width) || 1
}

/** Official 2.1.328 `GA` — anchor row on inline redraw/resize. */
function redrawAnchorRow(
  prev: RenderTargetFrame,
  next: RenderTargetFrame,
  caps: TerminalRenderCapabilities,
  scrolledOutRows: number,
): number {
  const { width, height } = next.viewport
  let anchor =
    Math.max(0, frameTotalRows(prev) - Math.min(prev.viewport.height, height)) +
    (frameFillsViewport(prev) ? 1 : 0)
  if (!caps.shorterWindowKeepsRowsBelowCursor) {
    const floor = Math.max(frameScrollTop(prev), scrolledOutRows)
    let cur = prev.top + prev.cursor.y
    for (let budget = height - 1; cur > floor; cur--) {
      budget -= visualRowsForLogicalRow(prev, cur - 1, width, caps)
      if (budget < 0) break
    }
    anchor = Math.min(anchor, Math.max(floor, cur))
  }
  return Math.min(anchor, frameScrollTop(next))
}

function viewportGrew(
  prev: RenderTargetFrame,
  next: RenderTargetFrame,
): boolean {
  return (
    prev.viewport.width === next.viewport.width &&
    prev.viewport.height < next.viewport.height
  )
}

function viewportChanged(
  prev: RenderTargetFrame,
  next: RenderTargetFrame,
): boolean {
  return (
    prev.viewport.width !== next.viewport.width ||
    prev.viewport.height !== next.viewport.height
  )
}

/**
 * Official 2.1.328 `$m` — main-screen inline renderer with `firstRow` window
 * slicing so tall main-screen trees only paint rows near the active viewport.
 */
export class InlineRenderer {
  readonly encoder: TerminalEncoder
  readonly rows: RowDrawer
  readonly stylePool: StylePool
  scrolledOutRows = 0
  mustRedraw = false
  isCursorRowErased = false
  private front: Screen | undefined
  private beforeFrame = {
    scrolledOutRows: 0,
    isCursorRowErased: false,
    mustRedraw: false,
  }

  constructor(encoder: TerminalEncoder, rows: RowDrawer, stylePool: StylePool) {
    this.encoder = encoder
    this.rows = rows
    this.stylePool = stylePool
  }

  reset(): void {
    this.mustRedraw = false
    this.isCursorRowErased = false
    this.scrolledOutRows = 0
  }

  invalidate(): void {
    this.mustRedraw = true
  }

  frameBegins(): void {
    this.beforeFrame = {
      scrolledOutRows: this.scrolledOutRows,
      isCursorRowErased: this.isCursorRowErased,
      mustRedraw: this.mustRedraw,
    }
  }

  frameWasLost(): void {
    this.scrolledOutRows = this.beforeFrame.scrolledOutRows
    this.isCursorRowErased = this.beforeFrame.isCursorRowErased
    this.mustRedraw = this.beforeFrame.mustRedraw
  }

  cursorRowWasErased(): void {
    this.isCursorRowErased = true
  }

  firstRow(
    prevFrame: { top?: number; screen: Screen; viewport: { height: number } },
    contentHeight: number,
    viewport: { width: number; height: number },
  ): number {
    const start = Math.max(
      0,
      Math.min(frameScrollTop(prevFrame), contentHeight - viewport.height + 1) -
        viewport.height,
    )
    if ((contentHeight - start) * viewport.width < MAX_INLINE_SLICE_CELLS) {
      return start
    }
    return Math.max(
      0,
      contentHeight -
        Math.ceil(FALLBACK_SLICE_CELLS / Math.max(1, viewport.width)),
    )
  }

  render(
    prev: RenderTargetFrame,
    next: RenderTargetFrame,
    caps: TerminalRenderCapabilities,
    prefixBytes = '',
    maxAnchorRow = Infinity,
    returnRowsLimit = 0,
  ): ByteRenderResult {
    const { encoder, rows } = this
    const { width, height } = next.viewport
    const nextScreen = normalizeScreenWidth(next, this.stylePool)
    rows.begin(caps)

    const prevTotal = frameTotalRows(prev)
    const nextTotal = frameTotalRows(next)
    const deltaRows = Math.max(nextTotal, 1) - Math.max(prevTotal, 1)
    const nextScrolledOut = Math.max(
      (deltaRows > 0
        ? prevTotal - prev.viewport.height
        : Math.max(prevTotal, nextTotal) - height) +
        (frameFillsViewport(prev) ? 1 : 0),
      this.scrolledOutRows,
    )

    let cleared: FlickerReason | undefined = this.reasonToRedraw(prev, next)
    const prevScreen = cleared
      ? nextScreen
      : normalizeScreenWidth(prev, this.stylePool)
    let changedRow: number | undefined
    const checkFrom = Math.max(
      prev.top,
      next.top,
      deltaRows < 0 ? 0 : nextTotal - height + 1,
    )
    if (!cleared && checkFrom < nextScrolledOut) {
      const checkCount = nextScrolledOut - checkFrom
      const [firstDiff, lastDiff] = diffRowRange(
        prevScreen,
        checkFrom - prev.top,
        nextScreen,
        checkFrom - next.top,
        checkCount,
      )
      if (lastDiff > 0) {
        const firstChanged = Math.min(
          checkFrom + firstDiff,
          deltaRows < 0 ? nextTotal : Infinity,
        )
        if (firstChanged < nextScrolledOut) {
          cleared = 'offscreen'
          changedRow = firstChanged
        }
      }
    }
    if (next.top > nextScrolledOut && prevTotal > 0) {
      cleared ??= 'offscreen'
    }

    const anchorRow = cleared
      ? Math.min(
          redrawAnchorRow(prev, next, caps, this.scrolledOutRows),
          maxAnchorRow,
        )
      : nextScrolledOut
    const sliceStart = Math.max(next.top, anchorRow)
    const nextOffset = sliceStart - next.top
    const nextVisibleRows = Math.max(0, nextTotal - sliceStart)
    const prevVisibleRows = cleared ? 0 : Math.max(0, prevTotal - sliceStart)

    const bufRows = Math.max(prevVisibleRows, nextVisibleRows) + 2
    const front = this.blankFront(nextScreen, bufRows)
    const minCursorY = Math.max(0, nextVisibleRows - height + 1)
    // Official `Re` / `ke`: physical cursor row from prev & target cursor row in local slice coords.
    const prevCursorRow = clamp(
      prev.top + prev.cursor.y - sliceStart,
      0,
      prevVisibleRows,
    )
    const targetY = clamp(
      next.cursor.y - nextOffset,
      minCursorY,
      nextVisibleRows,
    )
    const returnSeq = cleared
      ? this.returnRowsToScrollback(
          prev,
          next,
          caps,
          anchorRow,
          returnRowsLimit,
        )
      : ''

    if (!cleared) {
      if (prevVisibleRows > 0) {
        copyRows(front, 0, prevScreen, sliceStart - prev.top, prevVisibleRows)
      }
      if (this.isCursorRowErased) {
        invalidateScreenRows(front, prevCursorRow, prevVisibleRows + 1)
      }
      invalidateScreenRows(front, nextVisibleRows, prevVisibleRows)
    }

    this.isCursorRowErased = false
    this.scrolledOutRows = cleared ? 0 : nextScrolledOut

    const [diffStart, diffEnd] = diffRowRange(
      front,
      0,
      nextScreen,
      nextOffset,
      front.height,
    )
    const hasChanges =
      Boolean(cleared) || nextTotal !== prevTotal || diffEnd > 0

    let drawnHeight = prevVisibleRows
    encoder.begin(drawnHeight)
    encoder.bytes = prefixBytes

    const ensureRow = (row: number) => {
      if (row > drawnHeight) {
        if (encoder.y !== drawnHeight) encoder.moveTo(0, drawnHeight)
        encoder.feedLines(row - drawnHeight, row)
        drawnHeight = row
      }
    }

    if (cleared) {
      const eraseSeq = caps.erasedRowsStayJoined
        ? eraseViewportInPlaceForGhostty(height)
        : eraseViewportInPlace(height, false)
      encoder.raw(returnSeq + eraseSeq, 0, 0)
      drawnHeight = 0
    } else if (hasChanges) {
      // Official `$m.render`: physical terminal cursor sits at `prevCursorRow` (Re),
      // while encoder.y starts at `drawnHeight` (Se); emit preamble delta first.
      encoder.bytes += cursorMove(0, drawnHeight - prevCursorRow)
      if (prevTotal > 0 && nextTotal !== prevTotal) {
        encoder.moveTo(0, drawnHeight)
        encoder.eraseToEndOfRow()
      }
    }
    if (sliceStart > anchorRow) {
      const omitted = `... ${sliceStart - anchorRow} rows are not shown ...`
      encoder.raw(`\r${omitted.slice(0, Math.max(0, width - 1))}\r\n`, 0, 0)
    }

    for (let r = diffStart; r < diffEnd; r++) {
      if (r <= drawnHeight || rowContentEnd(nextScreen, nextOffset + r) > 0) {
        ensureRow(r)
        rows.draw(front, r, nextScreen, nextOffset + r)
      }
    }
    ensureRow(nextVisibleRows)
    encoder.resetStyle()

    const targetX = clamp(next.cursor.x, 0, Math.max(0, width - 1))
    if (hasChanges) {
      encoder.placeCursor(targetX, targetY)
    } else if (targetY !== prevCursorRow || next.cursor.x !== prev.cursor.x) {
      encoder.bytes += cursorMove(0, targetY - prevCursorRow)
      encoder.placeCursor(targetX, encoder.y)
    }

    const wantVisible =
      next.cursor.visible ||
      (!hasChanges && nextTotal === 0 && encoder.isCursorVisible)
    return finalizeBytes(
      encoder,
      caps,
      { ...next.cursor, visible: wantVisible },
      {
        hasChanges,
        movedRows: false,
        isRedraw: prevTotal === 0 && next.cursor.visible,
        cleared,
        changedRow,
      },
    )
  }

  /**
   * Official 2.1.328 `$m.reasonToRedraw(prev, next)` — triggers full redraw on
   * width change, height shrink, height growth while filling viewport, explicit
   * `mustRedraw`, or content shrinking from overflowing down into the viewport.
   */
  private reasonToRedraw(
    prev: RenderTargetFrame,
    next: RenderTargetFrame,
  ): FlickerReason | undefined {
    const { mustRedraw } = this
    this.mustRedraw = false
    const prevVp = prev.viewport
    const nextVp = next.viewport
    if (
      nextVp.height < prevVp.height ||
      (nextVp.height > prevVp.height && frameFillsViewport(prev)) ||
      (prevVp.width !== 0 && nextVp.width !== prevVp.width)
    ) {
      return 'resize'
    }
    if (mustRedraw) return 'clear'
    return frameFillsViewport(prev) &&
      frameTotalRows(next) < frameTotalRows(prev) &&
      frameTotalRows(next) <= prevVp.height
      ? 'offscreen'
      : undefined
  }

  private returnRowsToScrollback(
    prev: RenderTargetFrame,
    next: RenderTargetFrame,
    caps: TerminalRenderCapabilities,
    anchorRow: number,
    returnLimit: number,
  ): string {
    const { width, height } = next.viewport
    const sameWidth = width === prev.viewport.width
    const limit = anchorRow === 0 ? returnLimit : sameWidth ? Infinity : 0
    if (height <= prev.viewport.height || limit === 0) return ''
    const total = frameTotalRows(prev)
    const visualRowsFrom = (from: number): number => {
      let sum = 0
      const end = Math.max(from, total)
      for (let r = from; r < end; r++) {
        sum += visualRowsForLogicalRow(prev, r, width, caps)
      }
      return sum
    }
    const pushDown = Math.min(height - 1 - visualRowsFrom(anchorRow), limit)
    if (pushDown <= 0) return ''
    const cursorRow = Math.max(
      prev.top + prev.cursor.y,
      frameScrollTop(prev),
      this.scrolledOutRows,
    )
    const belowCursor = visualRowsFrom(cursorRow)
    const firstFeed = Math.min(belowCursor, 1)
    return (
      cursorMove(0, belowCursor - firstFeed) +
      '\r' +
      '\n'.repeat(firstFeed + pushDown)
    )
  }

  private blankFront(refScreen: Screen, rows: number): Screen {
    this.front ??= createScreen(
      0,
      0,
      this.stylePool,
      refScreen.charPool,
      refScreen.hyperlinkPool,
    )
    resetScreen(this.front, refScreen.width, rows)
    return this.front
  }
}

/**
 * Official 2.1.328 `tp` — popover-aware covering wrapper around `InlineRenderer`.
 */
export class CoveringRenderer {
  readonly inline: InlineRenderer
  readonly stylePool: StylePool
  private covered: { from: number; count: number; whole: Screen } | undefined
  private wouldHaveScrolledTo = 0
  private repeatedRows = 0
  private beforeFrame: {
    covered?: { from: number; count: number; whole: Screen }
    wouldHaveScrolledTo: number
    repeatedRows: number
  } = { wouldHaveScrolledTo: 0, repeatedRows: 0 }

  constructor(inline: InlineRenderer, stylePool: StylePool) {
    this.inline = inline
    this.stylePool = stylePool
  }

  frameBegins(): void {
    this.beforeFrame = {
      covered: this.covered,
      wouldHaveScrolledTo: this.wouldHaveScrolledTo,
      repeatedRows: this.repeatedRows,
    }
  }

  frameWasLost(): void {
    this.covered = this.beforeFrame.covered
    this.wouldHaveScrolledTo = this.beforeFrame.wouldHaveScrolledTo
    this.repeatedRows = this.beforeFrame.repeatedRows
  }

  countIn(frame: { screen: Screen }): number {
    return this.covered?.whole === frame.screen ? this.covered.count : 0
  }

  firstRow(
    prevFrame: { top?: number; screen: Screen; viewport: { height: number } },
    contentHeight: number,
    viewport: { width: number; height: number },
  ): number {
    const start = this.inline.firstRow(prevFrame, contentHeight, viewport)
    return Math.max(0, start - 2 * this.countIn(prevFrame))
  }

  uncover(prev: RenderTargetFrame, caps: TerminalRenderCapabilities): string {
    if (this.countIn(prev) === 0) return ''
    const shown = this.asShown(prev)
    this.covered = undefined
    return this.inline.render(shown, prev, caps).bytes
  }

  render(
    prev: RenderTargetFrame,
    next: RenderTargetFrame,
    caps: TerminalRenderCapabilities,
    prefixBytes = '',
  ): ByteRenderResult {
    if (prev.screen.height === 0) this.wouldHaveScrolledTo = 0
    const nextHeight = next.viewport.height
    const nextTotal = next.top + next.screen.height
    let prevShown = this.asShown(prev)
    let scrollMin = Math.max(
      this.inline.scrolledOutRows,
      prevShown.top + prevShown.screen.height - prev.viewport.height + 1,
    )
    if (scrollMin >= this.wouldHaveScrolledTo) this.wouldHaveScrolledTo = 0

    const coveredCount = this.countIn(prev)
    let maxAnchorRow = Infinity
    const heightDelta = nextHeight - prev.viewport.height
    const spareRows = heightDelta - scrollMin - this.repeatedRows
    let returnRowsLimit = Math.max(
      0,
      Math.min(spareRows, this.wouldHaveScrolledTo - scrollMin),
    )
    const keepWithoutRedraw =
      !this.inline.mustRedraw && !caps.resizeDropsBlankRowsBelow
    let bytesPrefix = prefixBytes

    if (
      coveredCount > 0 &&
      scrollMin === 0 &&
      viewportGrew(prev, next) &&
      keepWithoutRedraw
    ) {
      prevShown = { ...prevShown, viewport: next.viewport }
    } else if (coveredCount > 0 && viewportChanged(prev, next)) {
      this.inline.invalidate()
      this.repeatedRows =
        spareRows >= 0 ? 0 : this.repeatedRows + Math.max(0, -heightDelta)
      scrollMin = maxAnchorRow = Math.max(
        next.top,
        Math.min(
          scrollMin - Math.max(0, heightDelta),
          nextTotal + 1 - nextHeight - coveredCount,
        ),
      )
    } else if (this.hasLostRows(prev, next, scrollMin)) {
      const extended = this.lengthened(prev)
      bytesPrefix += this.inline.render(prevShown, extended, caps).bytes
      prevShown = extended
      returnRowsLimit = 0
      if (!viewportChanged(prev, next)) {
        maxAnchorRow = Math.max(
          next.top,
          prev.top + prev.screen.height - nextHeight + 1,
        )
      }
      scrollMin = this.wouldHaveScrolledTo
      this.wouldHaveScrolledTo = 0
    }

    this.covered = this.computeCover(next, scrollMin)
    this.wouldHaveScrolledTo = Math.max(
      viewportChanged(prev, next)
        ? 0
        : Math.min(this.wouldHaveScrolledTo, nextTotal),
      this.covered ? this.covered.from + this.covered.count : 0,
    )
    return this.inline.render(
      prevShown,
      this.asShown(next),
      caps,
      bytesPrefix,
      maxAnchorRow,
      returnRowsLimit,
    )
  }

  private hasLostRows(
    prev: RenderTargetFrame,
    next: RenderTargetFrame,
    fromRow: number,
  ): boolean {
    const count = this.countIn(prev)
    if (count === 0) return false
    let netDiff = 0
    for (let row = fromRow; row < this.wouldHaveScrolledTo; row++) {
      const same = !rowsDiffer(
        prev.screen,
        row - prev.top,
        next.screen,
        row - next.top,
      )
      if (!same && row < fromRow + count) return true
      netDiff += same ? -1 : 1
    }
    return netDiff > 0
  }

  private lengthened(frame: RenderTargetFrame): RenderTargetFrame {
    const targetHeight =
      this.wouldHaveScrolledTo + frame.viewport.height - 1 - frame.top
    if (targetHeight <= frame.screen.height) return frame
    const out = createScreen(
      frame.screen.width,
      targetHeight,
      this.stylePool,
      frame.screen.charPool,
      frame.screen.hyperlinkPool,
    )
    copyRows(out, 0, frame.screen, 0, frame.screen.height)
    return { ...frame, screen: out }
  }

  private asShown(frame: RenderTargetFrame): RenderTargetFrame {
    const count = this.countIn(frame)
    if (count === 0 || !this.covered) return frame
    const { screen, top, cursor } = frame
    const out = createScreen(
      screen.width,
      Math.max(0, screen.height - count),
      this.stylePool,
      screen.charPool,
      screen.hyperlinkPool,
    )
    const cut = Math.max(0, this.covered.from - top)
    if (cut > 0) copyRows(out, 0, screen, 0, Math.min(cut, out.height))
    const tail = out.height - cut
    if (tail > 0) copyRows(out, cut, screen, cut + count, tail)
    return {
      ...frame,
      screen: out,
      cursor: { ...cursor, y: Math.max(0, cursor.y - count) },
    }
  }

  private computeCover(
    frame: RenderTargetFrame,
    minRow: number,
  ): { from: number; count: number; whole: Screen } | undefined {
    const { screen, top, viewport, cursor, popover } = frame
    if (!popover) return undefined
    const bottom = top + screen.height + 1 - viewport.height
    const from = Math.max(top, minRow, bottom - popover.height)
    const count = bottom - from
    if (count <= 0 || bottom > top + Math.min(popover.top, cursor.y)) {
      return undefined
    }
    return { from, count, whole: screen }
  }
}

/**
 * Official 2.1.328 `op` — alt-screen fullscreen byte renderer using absolute
 * cursor addressing and per-row `RowDrawer` diffing.
 */
export class FullscreenRenderer {
  readonly encoder: TerminalEncoder
  readonly rows: RowDrawer
  readonly stylePool: StylePool
  private front: Screen | undefined
  cursor: { x: number; y: number } | undefined
  private styleGeneration = 0
  private unwritten: { cleared?: FlickerReason } | undefined
  private erasesFirst: FlickerReason | undefined
  private dirtyAfterInvalidate = false

  constructor(encoder: TerminalEncoder, rows: RowDrawer, stylePool: StylePool) {
    this.encoder = encoder
    this.rows = rows
    this.stylePool = stylePool
  }

  invalidate(reason?: FlickerReason): void {
    this.front = undefined
    this.cursor = undefined
    this.erasesFirst = reason ?? this.erasesFirst
    this.dirtyAfterInvalidate = this.erasesFirst === undefined
  }

  frameWasWritten(): void {
    this.unwritten = undefined
  }

  cursorRowWasErased(): void {
    if (this.front && this.cursor) {
      invalidateScreenRows(this.front, this.cursor.y, this.cursor.y + 1)
    }
    this.cursor = undefined
  }

  render(
    next: RenderTargetFrame,
    caps: TerminalRenderCapabilities,
  ): ByteRenderResult {
    const { encoder, rows } = this
    const { width, height } = next.viewport
    const nextScreen = normalizeScreenWidth(next, this.stylePool)
    encoder.begin()

    const hadUnwritten = this.unwritten !== undefined
    if (hadUnwritten) {
      this.invalidate(this.unwritten?.cleared)
    }
    const charPoolChanged = rows.begin(caps, nextScreen.charPool)

    if (
      this.front &&
      (this.front.width !== width || this.front.height !== height)
    ) {
      this.invalidate('resize')
    }

    const isRedraw = this.cursor === undefined
    if (isRedraw) {
      const initSeq = SGR_RESET + (caps.printsUnknownSequences ? '' : LINK_END)
      encoder.raw(initSeq, encoder.x, encoder.y)
    }

    const cleared = this.erasesFirst
    const needsRowInvalidate = this.dirtyAfterInvalidate && !cleared
    this.dirtyAfterInvalidate = false
    this.unwritten = { cleared }
    if (cleared) {
      this.erasesFirst = undefined
      encoder.raw(
        caps.clearSavesToScrollback
          ? eraseViewportInPlace(height, caps.erasedRowsStayJoined)
          : ERASE_SCREEN + CURSOR_HOME,
        0,
        0,
      )
    }

    const poolsChanged =
      this.front !== undefined &&
      (this.styleGeneration !== this.stylePool.generation ||
        this.front.hyperlinkPool !== nextScreen.hyperlinkPool)
    this.styleGeneration = this.stylePool.generation
    if (poolsChanged) {
      this.front = undefined
    }

    const front = (this.front ??= createScreen(
      width,
      height,
      this.stylePool,
      nextScreen.charPool,
      nextScreen.hyperlinkPool,
    ))
    if (
      hadUnwritten ||
      poolsChanged ||
      caps.repaintsEveryCell ||
      charPoolChanged ||
      needsRowInvalidate
    ) {
      invalidateScreenRows(front, 0, height)
    }

    const [firstDiff, lastDiff] = diffRowRange(front, 0, nextScreen, 0, height)
    for (let r = firstDiff; r < lastDiff; r++) {
      rows.draw(front, r, nextScreen, r)
    }
    encoder.resetStyle()

    const hasChanges = encoder.bytes !== ''
    const cx = clamp(next.cursor.x, 0, Math.max(0, width - 1))
    const cy = clamp(next.cursor.y, 0, Math.max(0, height - 1))
    if (hasChanges || cx !== this.cursor?.x || cy !== this.cursor?.y) {
      encoder.placeCursor(cx, cy)
      this.cursor = { x: cx, y: cy }
    }

    return finalizeBytes(encoder, caps, next.cursor, {
      hasChanges,
      movedRows: false,
      isRedraw,
      cleared,
    })
  }
}

export type NewRendererBundle = {
  readonly encoder: TerminalEncoder
  readonly rows: RowDrawer
  readonly inline: InlineRenderer
  readonly covering: CoveringRenderer
  readonly fullscreen: FullscreenRenderer
}

/**
 * Official 2.1.328 `XS(stylePool)` — constructs the coordinated new-renderer
 * pipeline (`encoder`, `rows`, `inline`, `covering`, `fullscreen`).
 */
export function createNewRenderers(stylePool: StylePool): NewRendererBundle {
  const encoder = new TerminalEncoder(stylePool)
  const rows = new RowDrawer(encoder)
  const inline = new InlineRenderer(encoder, rows, stylePool)
  return {
    encoder,
    rows,
    inline,
    covering: new CoveringRenderer(inline, stylePool),
    fullscreen: new FullscreenRenderer(encoder, rows, stylePool),
  }
}

/** Helper to wrap a `Frame` into a `RenderTargetFrame` for `InlineRenderer`/`CoveringRenderer`. */
export function frameToRenderTarget(
  frame: Frame,
  viewport: { width: number; height: number },
  cursor?: RenderTargetFrame['cursor'],
  popover?: RenderTargetFrame['popover'],
): RenderTargetFrame {
  return {
    screen: frame.screen,
    top: frame.top ?? 0,
    viewport,
    cursor: cursor ?? {
      x: frame.cursor.x,
      y: frame.cursor.y,
      visible: frame.cursor.visible,
    },
    ...(popover !== undefined ? { popover } : {}),
  }
}
