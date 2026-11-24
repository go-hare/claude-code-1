import type { AnsiCode } from '@alcalzone/ansi-tokenize'
import chalk from 'chalk'
import { isSoftwareBidiNeeded } from './bidi.js'
import {
  BIDI_SUBSTITUTE_RANGES,
  CELL_RUN_SHIFT,
  CELL_SEGMENTER_TABLE_CAP,
  CELL_TAB_FLAG,
  CELL_WIDTH_MASK,
  type CellSegmenter,
  createCellSegmenter,
  createScreenCellSegmenter,
  DEFAULT_TAB_WIDTH,
} from './cell-segmenter.js'
import { filterItalicOffTokens } from './colorize.js'
import { type Rectangle, unionRect } from './layout/geometry.js'
import {
  blitRegion,
  type CharPool,
  clearNoSelectRegion,
  type HyperlinkPool,
  markNoSelectRegion,
  resetScreen,
  restoreNoSelectRegion,
  type Screen,
  type StylePool,
  shiftRows,
} from './screen.js'
import {
  packSoftWrap,
  SW_ELIDED_SEP,
  SoftWrapKind,
  type SoftWrapKind as SoftWrapKindValue,
} from './softWrap.js'
import {
  computeGraphemeExtraWidth,
  needsWidthCalibration,
  stringWidth,
} from './stringWidth.js'
import { sanitizeBidiControls } from './tabstops.js'
import { getGraphemeSegmenter } from './utils/grapheme.js'
import sliceAnsiFallback from './utils/sliceAnsi.js'
import { isAtlasTrackingEnabled, trackAtlasKey } from './xtermAtlas.js'

/** Debug logger — no-op placeholder until proper logger injection is added */
const logForDebugging = (_message: string) => {}

const LONE_SURROGATE_RE = /\p{Cs}/gu
const CALIBRATED_SLICE_SCRATCH_CAP = 4096

type CalibratedColumns = {
  ours: number[]
  buns: number[]
}

type CalibratedSliceCache = {
  text: string
  columns: CalibratedColumns
}

let calSeg: CellSegmenter | undefined
let calScratch: { cells: Int32Array; runs: Int32Array } | undefined
let calCache: CalibratedSliceCache | undefined

function clearCalibratedSliceCache(): void {
  calCache = undefined
  if (calSeg && calSeg.graphemes.length > CELL_SEGMENTER_TABLE_CAP) {
    calSeg = undefined
  }
}

function mapCalibratedColumn(cols: CalibratedColumns, target: number): number {
  const idx = cols.ours.findIndex(col => col >= target)
  if (idx !== -1) return cols.buns[idx]!
  return cols.buns.at(-1)! + target - cols.ours.at(-1)!
}

function getCalibratedColumns(text: string): CalibratedColumns {
  if (calCache?.text === text) return calCache.columns
  if (calCache) clearCalibratedSliceCache()
  else queueMicrotask(clearCalibratedSliceCache)

  if (!calSeg) {
    calSeg = createCellSegmenter([])
  }
  const safeText =
    typeof text.isWellFormed === 'function' && text.isWellFormed()
      ? text
      : text.replace(LONE_SURROGATE_RE, '\uDC00')
  let buf =
    safeText.length > CALIBRATED_SLICE_SCRATCH_CAP
      ? {
          cells: new Int32Array(2 * safeText.length),
          runs: new Int32Array(2 * safeText.length),
        }
      : (calScratch ??= {
          cells: new Int32Array(2 * CALIBRATED_SLICE_SCRATCH_CAP),
          runs: new Int32Array(2 * CALIBRATED_SLICE_SCRATCH_CAP),
        })
  let count = calSeg.segment(safeText, buf.cells, buf.runs, false)
  if (count < 0) {
    const cap = Math.max(-count, buf.cells.length)
    buf = { cells: new Int32Array(2 * cap), runs: new Int32Array(2 * cap) }
    count = calSeg.segment(safeText, buf.cells, buf.runs, false)
  }

  const ours = [0]
  const buns = [0]
  const bunSw =
    typeof Bun !== 'undefined' && typeof Bun.stringWidth === 'function'
      ? Bun.stringWidth
      : undefined
  for (let i = 0; i < count; i++) {
    const gIdx = buf.cells[2 * i]!
    const grapheme = calSeg.graphemes[gIdx]!
    let baseW = buf.cells[2 * i + 1]! & CELL_WIDTH_MASK
    if (baseW === CELL_WIDTH_MASK) {
      baseW = bunSw
        ? bunSw(grapheme, { ambiguousIsNarrow: true })
        : stringWidth(grapheme)
    }
    const extra = computeGraphemeExtraWidth(grapheme, baseW)
    buns.push(buns[i]! + baseW)
    ours.push(ours[i]! + baseW + extra)
  }
  const columns: CalibratedColumns = { ours, buns }
  calCache = { text, columns }
  return columns
}

/**
 * Official 2.1.328 `qbt(str, from, to)` (`chunk@283862629.js`) — calibrated ANSI
 * column slice. Maps calibrated display columns (`ours`) to raw `Bun.sliceAnsi`
 * columns (`buns`) when `needsWidthCalibration(text)` is true.
 */
export function sliceAnsi(text: string, start: number, end?: number): string {
  const bunSlice =
    typeof Bun !== 'undefined' && typeof Bun.sliceAnsi === 'function'
      ? Bun.sliceAnsi
      : undefined
  if (!bunSlice) {
    return sliceAnsiFallback(text, start, end)
  }
  if (!needsWidthCalibration(text)) {
    return bunSlice(text, start, end)
  }
  const cols = getCalibratedColumns(text)
  const mappedStart = mapCalibratedColumn(cols, start)
  const mappedEnd =
    end === undefined ? undefined : mapCalibratedColumn(cols, end)
  return bunSlice(text, mappedStart, mappedEnd)
}

export { sliceAnsi as calibratedSliceAnsi }

// --- Official 2.1.328 `JDa` / `v` truecolor -> 256-color downgrade ---

// biome-ignore lint/suspicious/noControlCharactersInRegex: official JDa SGR truecolor matcher
const TRUECOLOR_SGR_RE = /^\x1b\[([34]8);2;(\d+);(\d+);(\d+)m$/
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const

function rgbToAnsi256(r: number, g: number, b: number): number {
  const toIdx = (v: number): number =>
    v < 48 ? 0 : v < 115 ? 1 : v < 155 ? 2 : v < 195 ? 3 : v < 235 ? 4 : 5
  const ri = toIdx(r)
  const gi = toIdx(g)
  const bi = toIdx(b)
  const cubeIdx = 16 + 36 * ri + 6 * gi + bi
  const avg = Math.round((r + g + b) / 3)
  if (avg < 5) return 16
  if (avg > 244 && ri === gi && gi === bi) return cubeIdx
  const grayStep = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)))
  const grayIdx = 232 + grayStep
  const grayVal = 8 + grayStep * 10
  const cr = CUBE_LEVELS[ri]!
  const cg = CUBE_LEVELS[gi]!
  const cb = CUBE_LEVELS[bi]!
  const cubeDist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
  const grayDist = (r - grayVal) ** 2 + (g - grayVal) ** 2 + (b - grayVal) ** 2
  return grayDist < cubeDist ? grayIdx : cubeIdx
}

/** Official 2.1.328 `JDa` — downgrade 24-bit RGB SGR to 256-color when `chalk.level < 3`. */
function downgradeTruecolorCodes(codes: AnsiCode[]): AnsiCode[] {
  if (chalk.level >= 3 || codes.length === 0) return codes
  let out: AnsiCode[] | undefined
  for (let i = 0; i < codes.length; i++) {
    const entry = codes[i]!
    const match = TRUECOLOR_SGR_RE.exec(entry.code)
    if (match) {
      out ??= codes.slice(0, i)
      out.push({
        type: 'ansi',
        code: `\x1b[${match[1]};5;${rgbToAnsi256(+match[2]!, +match[3]!, +match[4]!)}m`,
        endCode: entry.endCode,
      })
    } else if (out) {
      out.push(entry)
    }
  }
  return out ?? codes
}

/**
 * Official 2.1.328 `prt()` — tracks chalk color-level generation so
 * `LineCells.refreshGenerations()` invalidates cached styles whenever
 * `chalk.level` changes (e.g. truecolor -> 256-color clamp).
 */
function getChalkGeneration(): number {
  return chalk.level
}

// --- Official 2.1.323 (#1989) `gqr` leading combining-mark reordering ---

function isCombiningMarkCodeUnit(ch: string): boolean {
  if (stringWidth(ch) !== 0) return false
  const first = getGraphemeSegmenter()
    .segment(`a${ch}`)
    [Symbol.iterator]()
    .next().value?.segment
  return first !== 'a'
}

export function reorderLeadingCombiningMarks(grapheme: string): string {
  if (grapheme.length < 2 || grapheme.charCodeAt(0) <= 127) return grapheme
  let markEnd = 0
  for (const ch of grapheme) {
    if (!isCombiningMarkCodeUnit(ch)) break
    markEnd += ch.length
  }
  if (markEnd === 0) return grapheme
  let baseEnd = markEnd
  while (baseEnd < grapheme.length) {
    const cp = grapheme.codePointAt(baseEnd)!
    const ch = String.fromCodePoint(cp)
    baseEnd += ch.length
    if (stringWidth(ch) > 0) {
      if (
        baseEnd === grapheme.length &&
        grapheme.charCodeAt(markEnd - 1) === 0x200d
      ) {
        return grapheme
      }
      const reordered =
        grapheme.slice(markEnd, baseEnd) +
        grapheme.slice(0, markEnd) +
        grapheme.slice(baseEnd)
      return stringWidth(reordered) === stringWidth(grapheme)
        ? reordered
        : grapheme
    }
  }
  return grapheme
}

// --- Official 2.1.328 `bm` (`LineCells`) ---

const STYLE_SHIFT = 17 // jn
const HYPERLINK_SHIFT = 2 // Cr
const WIDTH_MASK = 3 // Ft
const SGR_RESET_THRESHOLD = 2048 // EM
const KEPT_CELLS_CAP = 131072 // Pv
const KEPT_TEXT_CAP = 262144 // wM
const KEPT_TEXT_OVERHEAD = 64 // CM
const VALID_SGR_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: official RM SGR validator
  /^\x1b\[(?:\d{1,3})(?:;5;\d{1,3}|;2;\d{1,3};\d{1,3};\d{1,3})?m$/ // RM
const HIDDEN_END_CODE = '\x1b[28m' // BPa

function packCellWord1(
  styleId: number,
  hyperlinkId: number,
  width: number,
): number {
  return (styleId << STYLE_SHIFT) | (hyperlinkId << HYPERLINK_SHIFT) | width
}

function growInt32Array(
  arr: Int32Array<ArrayBuffer>,
  needed: number,
  copyLength: number,
): Int32Array<ArrayBuffer> {
  if (arr.length >= needed) return arr
  const next = new Int32Array(Math.max(needed, 2 * arr.length))
  if (copyLength > 0) {
    next.set(arr.subarray(0, Math.min(copyLength, arr.length)))
  }
  return next
}

/**
 * Official 2.1.328 `bm` — segmented cell buffer + flat `Int32Array` `keptCells`
 * line cache backed by `Bun.ant.CellSegmenter` (when present) or `JsCellSegmenter`.
 */
export class LineCells {
  readonly stylePool: StylePool
  charPool: CharPool
  native: CellSegmenter = createScreenCellSegmenter(BIDI_SUBSTITUTE_RANGES)
  cells = new Int32Array(512)
  runs = new Int32Array(512)
  count = 0
  reordered = false
  graphemes: string[] = this.native.graphemes
  sgrKeys: string[] = this.native.sgrKeys
  sgrCloseKeys: string[] = this.native.sgrCloseKeys
  uris: string[] = this.native.uris
  private charMap = new Int32Array(256)
  private charMapLength = 0
  private styleIds = new Int32Array(64)
  private styleGeneration: number
  private chalkGeneration = getChalkGeneration()
  private linkIds = new Int32Array(16)
  private hyperlinkPool: HyperlinkPool | undefined
  private words = new Int32Array(64)
  readonly keptLines = new Map<string, number>()
  keptCells = new Int32Array(1024)
  keptLength = 0
  keptText = 0
  private keptInVisualOrder = false

  constructor(stylePool: StylePool, charPool: CharPool) {
    this.stylePool = stylePool
    this.charPool = charPool
    this.styleGeneration = stylePool.generation
  }

  segment(text: string, reorderBidi: boolean): number {
    if (
      this.sgrKeys.length > CELL_SEGMENTER_TABLE_CAP ||
      this.uris.length > CELL_SEGMENTER_TABLE_CAP ||
      this.graphemes.length > 4 * CELL_SEGMENTER_TABLE_CAP
    ) {
      this.resetNative()
    }
    this.refreshGenerations()
    let count = this.native.segment(text, this.cells, this.runs, reorderBidi)
    if (count < 0) {
      const cap = Math.max(-count, this.cells.length)
      const nextCells = new Int32Array(2 * cap)
      this.runs = new Int32Array(2 * cap)
      this.cells = nextCells
      count = this.native.segment(text, this.cells, this.runs, reorderBidi)
    }
    if (needsWidthCalibration(text)) {
      for (let i = 0; i < count; i++) {
        const meta = this.cells[2 * i + 1]!
        const baseW = meta & CELL_WIDTH_MASK
        const extra = computeGraphemeExtraWidth(
          this.graphemes[this.cells[2 * i]!]!,
          baseW,
        )
        this.cells[2 * i + 1] = meta + Math.min(extra, CELL_WIDTH_MASK - baseW)
      }
    }
    this.count = count
    this.reordered = reorderBidi
    return count
  }

  width(text: string, column: number, reorderBidi: boolean): number {
    const cached = this.keptLines.get(text)
    if (cached !== undefined) return this.keptCells[cached]!
    const count = this.segment(text, reorderBidi)
    let col = column
    for (let i = 0; i < count; i++) {
      const meta = this.cells[2 * i + 1]!
      if ((meta & CELL_TAB_FLAG) !== 0) {
        const mod =
          ((col % DEFAULT_TAB_WIDTH) + DEFAULT_TAB_WIDTH) % DEFAULT_TAB_WIDTH
        col += DEFAULT_TAB_WIDTH - mod
      } else {
        col += meta & CELL_WIDTH_MASK
      }
    }
    return col - column
  }

  keepColumns(startCol: number, x1: number, x2: number): number {
    let col = startCol
    let firstCol = Math.max(startCol, x1)
    let kept = 0
    for (let i = 0; i < this.count; i++) {
      const meta = this.cells[2 * i + 1]!
      const step =
        (meta & CELL_TAB_FLAG) !== 0
          ? DEFAULT_TAB_WIDTH -
            (((col % DEFAULT_TAB_WIDTH) + DEFAULT_TAB_WIDTH) %
              DEFAULT_TAB_WIDTH)
          : meta & CELL_WIDTH_MASK
      const nextCol = col + step
      if (col >= x1 && col < x2 && nextCol <= x2) {
        if (kept === 0) firstCol = col
        this.cells[2 * kept] = this.cells[2 * i]!
        this.cells[2 * kept + 1] = meta
        kept++
      }
      col = nextCol
    }
    this.count = kept
    return firstCol
  }

  trailingSpaces(text: string): number {
    this.segment(text, false)
    let trailing = 0
    while (
      trailing < this.count &&
      this.graphemes[this.cells[2 * (this.count - 1 - trailing)]!] === ' '
    ) {
      trailing++
    }
    return trailing
  }

  charIndices(): Int32Array {
    const graphemes = this.graphemes
    if (this.charMapLength < graphemes.length) {
      this.charMap = growInt32Array(
        this.charMap,
        graphemes.length,
        this.charMapLength,
      )
      for (let i = this.charMapLength; i < graphemes.length; i++) {
        this.charMap[i] = this.charPool.intern(
          reorderLeadingCombiningMarks(graphemes[i]!),
        )
      }
      this.charMapLength = graphemes.length
    }
    return this.charMap
  }

  runWords(hyperlinkPool: HyperlinkPool): Int32Array {
    const count = this.count
    if (count === 0) return this.words
    if (this.hyperlinkPool !== hyperlinkPool) {
      this.hyperlinkPool = hyperlinkPool
      this.linkIds.fill(0)
    }
    let maxRun = this.cells[2 * count - 1]! >>> CELL_RUN_SHIFT
    if (this.reordered) {
      for (let i = 0; i < count; i++) {
        maxRun = Math.max(maxRun, this.cells[2 * i + 1]! >>> CELL_RUN_SHIFT)
      }
    }
    const runCount = maxRun + 1
    this.words = growInt32Array(this.words, runCount, 0)
    for (let r = 0; r < runCount; r++) {
      const uriIdx = this.runs[2 * r + 1]!
      let linkId = 0
      if (uriIdx !== 0) {
        this.linkIds = growInt32Array(
          this.linkIds,
          uriIdx + 1,
          this.linkIds.length,
        )
        linkId = this.linkIds[uriIdx]!
        if (linkId === 0) {
          linkId = hyperlinkPool.intern(this.uris[uriIdx]!) + 1
          this.linkIds[uriIdx] = linkId
        }
        linkId -= 1
      }
      this.words[r] = packCellWord1(this.styleId(this.runs[2 * r]!), linkId, 0)
    }
    return this.words
  }

  paint(
    screenCells: Int32Array,
    screenWidth: number,
    x: number,
    y: number,
    hyperlinkPool: HyperlinkPool,
  ): number {
    return this.native.paint(
      screenCells,
      screenWidth,
      x,
      y,
      this.cells,
      this.count,
      undefined,
      this.charIndices(),
      this.runWords(hyperlinkPool),
    )
  }

  startFrame(
    inVisualOrder: boolean,
    hyperlinkPool: HyperlinkPool,
    charPool?: CharPool,
  ): void {
    this.refreshGenerations()
    if (charPool !== undefined && charPool !== this.charPool) {
      this.charPool = charPool
      this.charMapLength = 0
      this.forgetKept()
    }
    if (
      inVisualOrder !== this.keptInVisualOrder ||
      hyperlinkPool !== this.hyperlinkPool
    ) {
      this.keptInVisualOrder = inVisualOrder
      this.forgetKept()
    }
  }

  kept(text: string): number | undefined {
    return this.keptLines.get(text)
  }

  keep(
    text: string,
    screenCells: Int32Array,
    offset: number,
    colWidth: number,
  ): void {
    let rawSum = 0
    for (let i = 0; i < this.count; i++) {
      rawSum += this.cells[2 * i + 1]! & (CELL_WIDTH_MASK | CELL_TAB_FLAG)
    }
    const entryLen = 1 + 2 * colWidth
    if (rawSum !== colWidth || entryLen > KEPT_CELLS_CAP) return
    if (
      this.keptLength + entryLen > KEPT_CELLS_CAP ||
      this.keptText > KEPT_TEXT_CAP
    ) {
      this.forgetKept()
    }
    const base = this.keptLength
    const buf = (this.keptCells = growInt32Array(
      this.keptCells,
      base + entryLen,
      base,
    ))
    buf[base] = colWidth
    for (let i = 1; i < entryLen; i++) {
      buf[base + i] = screenCells[offset + i - 1]!
    }
    this.keptLength += entryLen
    this.keptText += text.length + KEPT_TEXT_OVERHEAD
    // Copy string via utf16le to detach from any large parent rope/slice.
    this.keptLines.set(Buffer.from(text, 'utf16le').toString('utf16le'), base)
  }

  forgetKept(): void {
    this.keptLines.clear()
    this.keptLength = 0
    this.keptText = 0
  }

  refreshGenerations(): void {
    const chalkGen = getChalkGeneration()
    if (
      this.stylePool.generation === this.styleGeneration &&
      chalkGen === this.chalkGeneration
    ) {
      return
    }
    this.styleGeneration = this.stylePool.generation
    this.chalkGeneration = chalkGen
    this.forgetKept()
    if (this.sgrKeys.length > SGR_RESET_THRESHOLD) {
      this.resetNative()
    } else {
      this.styleIds.fill(0)
    }
  }

  resetNative(): void {
    this.native = createScreenCellSegmenter(BIDI_SUBSTITUTE_RANGES)
    this.graphemes = this.native.graphemes
    this.sgrKeys = this.native.sgrKeys
    this.sgrCloseKeys = this.native.sgrCloseKeys
    this.uris = this.native.uris
    this.charMapLength = 0
    this.linkIds.fill(0)
    this.styleIds = new Int32Array(64)
  }

  styleId(sgrIdx: number): number {
    this.styleIds = growInt32Array(
      this.styleIds,
      sgrIdx + 1,
      this.styleIds.length,
    )
    let idPlusOne = this.styleIds[sgrIdx]!
    if (idPlusOne === 0) {
      idPlusOne =
        this.stylePool.intern(
          filterItalicOffTokens(
            downgradeTruecolorCodes(this.ansiCodes(sgrIdx)),
          ),
        ) + 1
      this.styleIds[sgrIdx] = idPlusOne
    }
    return idPlusOne - 1
  }

  ansiCodes(sgrIdx: number): AnsiCode[] {
    if (sgrIdx === 0) return []
    const codes = this.sgrKeys[sgrIdx]!.split('\x00')
    const closeCodes = this.sgrCloseKeys[sgrIdx]!.split('\x00')
    const result: AnsiCode[] = []
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]!
      const endCode = closeCodes[i]!
      if (VALID_SGR_RE.test(code) && endCode !== HIDDEN_END_CODE) {
        result.push({ type: 'ansi', code, endCode })
      }
    }
    return result
  }
}

// --- Official 2.1.328 `wh` / `qg` / `Ch` / `Xg` / `Hv` screen paint helpers ---

/** Official `wh` — expand `screen.damage` for `[minX, maxX)` on row `y`. */
function expandRowDamage(
  screen: Screen,
  minX: number,
  maxX: number,
  y: number,
): void {
  if (minX >= maxX || y < 0 || y >= screen.height) return
  const damage = screen.damage
  if (!damage) {
    screen.damage = { x: minX, y, width: maxX - minX, height: 1 }
    return
  }
  const right = Math.max(damage.x + damage.width, maxX)
  const bottom = Math.max(damage.y + damage.height, y + 1)
  damage.x = Math.min(damage.x, minX)
  damage.y = Math.min(damage.y, y)
  damage.width = right - damage.x
  damage.height = bottom - damage.y
}

/** Official `qg` — update screen damage and record xterm.js atlas keys. */
function recordPaintedSpan(
  screen: Screen,
  minX: number,
  maxX: number,
  y: number,
): void {
  expandRowDamage(screen, minX, maxX, y)
  if (isAtlasTrackingEnabled() && minX < maxX && y >= 0 && y < screen.height) {
    const cells = screen.cells
    for (
      let col = minX, ci = (y * screen.width + minX) << 1;
      col < maxX;
      col++, ci += 2
    ) {
      trackAtlasKey(cells[ci]!, cells[ci + 1]! >>> STYLE_SHIFT)
    }
  }
}

/** Official `Ch` — paint already-segmented `lineCells` into `screen` at `(x, y)`. */
function paintSegmentedLine(
  screen: Screen,
  x: number,
  y: number,
  lineCells: LineCells,
): number {
  const packed = lineCells.paint(
    screen.cells,
    screen.width,
    x,
    y,
    screen.hyperlinkPool,
  )
  const minX = Math.floor(packed / 1048576) % 65536
  const maxX = Math.floor(packed / 68719476736)
  recordPaintedSpan(screen, minX, maxX, y)
  return packed % 1048576
}

/**
 * Official `Xg` — paint `line` at `(x, y)` using `lineCells`'s `keptLines`
 * fast-path cache when safe (not splitting wide characters at either edge),
 * otherwise segment, paint, and cache.
 */
function paintCachedLine(
  screen: Screen,
  x: number,
  y: number,
  line: string,
  reorderBidi: boolean,
  lineCells: LineCells,
): number {
  const cells = screen.cells
  const offset = (y * screen.width + x) << 1
  const keptIdx = lineCells.kept(line)
  if (keptIdx !== undefined && x >= 0 && y >= 0 && y < screen.height) {
    const keptCells = lineCells.keptCells
    const colWidth = keptCells[keptIdx]!
    const intLen = colWidth << 1
    const endX = x + colWidth
    if (
      endX <= screen.width &&
      (cells[offset + 1]! & WIDTH_MASK) !== 2 &&
      (endX === screen.width ||
        (cells[offset + intLen + 1]! & WIDTH_MASK) !== 2)
    ) {
      for (let i = 0; i < intLen; i++) {
        cells[offset + i] = keptCells[keptIdx + 1 + i]!
      }
      recordPaintedSpan(screen, x, endX, y)
      return endX
    }
  }
  if (lineCells.segment(line, reorderBidi) === 0) return x
  const endX = paintSegmentedLine(screen, x, y, lineCells)
  if (
    keptIdx === undefined &&
    x >= 0 &&
    y >= 0 &&
    y < screen.height &&
    endX <= screen.width
  ) {
    lineCells.keep(line, cells, offset, endX - x)
  }
  return endX
}

// Official 2.1.328 `Lv` — strong directional marks prepended when software bidi
// reorders a line with an explicit `WriteOperation.direction`.
const BIDI_DIRECTION_PREFIX = {
  ltr: '\u200E',
  rtl: '\u200F',
} as const

/** Official `gm(direction)` — true when explicit direction + software bidi apply. */
function usesDirectedBidi(
  direction: 'ltr' | 'rtl' | undefined,
): direction is 'ltr' | 'rtl' {
  return direction !== undefined && isSoftwareBidiNeeded()
}

/** Official `Hv` — paint a line with optional direction prefix and column clip. */
function paintDirectedLine(
  screen: Screen,
  line: string,
  x: number,
  y: number,
  lineCells: LineCells,
  direction: 'ltr' | 'rtl' | undefined,
  clipX: { x1: number; x2: number } | undefined,
): number {
  const text = usesDirectedBidi(direction)
    ? BIDI_DIRECTION_PREFIX[direction] + line
    : line
  const reorder = isSoftwareBidiNeeded()
  if (clipX === undefined) {
    return paintCachedLine(screen, x, y, text, reorder, lineCells)
  }
  lineCells.segment(text, reorder)
  const startX = lineCells.keepColumns(x, clipX.x1, clipX.x2)
  return lineCells.count === 0
    ? startX
    : paintSegmentedLine(screen, startX, y, lineCells)
}

/**
 * Collects write/blit/clear/clip operations from the render tree, then
 * applies them to a Screen buffer in `get()`. The Screen is what gets
 * diffed against the previous frame to produce terminal updates.
 */

type Options = {
  width: number
  height: number
  stylePool: StylePool
  /**
   * Screen to render into. Will be reset before use.
   * For double-buffering, pass a reusable screen. Otherwise create a new one.
   */
  screen: Screen
}

export type Operation =
  | WriteOperation
  | ClipOperation
  | UnclipOperation
  | BlitOperation
  | ClearOperation
  | NoSelectOperation
  | ShiftOperation

type WriteOperation = {
  type: 'write'
  x: number
  y: number
  lines: string[]
  /**
   * densable softWrap kinds parallel to lines. HardBreak (0) /
   * undefined = not a continuation; Continuation / ContinuationElidedSep
   * mark wrap joins. Undefined means the producer didn't track wrapping.
   */
  softWrap?: SoftWrapKindValue[]
  /** Official 2.1.328 `direction` — explicit LTR/RTL write direction. */
  direction?: 'ltr' | 'rtl'
}

type ClipOperation = {
  type: 'clip'
  clip: Clip
}

export type Clip = {
  x1: number | undefined
  x2: number | undefined
  y1: number | undefined
  y2: number | undefined
}

/**
 * Intersect two clips. `undefined` on an axis means unbounded; the other
 * clip's bound wins. If both are bounded, take the tighter constraint
 * (max of mins, min of maxes). If the resulting region is empty
 * (x1 >= x2 or y1 >= y2), writes clipped by it will be dropped.
 */
function intersectClip(parent: Clip | undefined, child: Clip): Clip {
  if (!parent) return child
  return {
    x1: maxDefined(parent.x1, child.x1),
    x2: minDefined(parent.x2, child.x2),
    y1: maxDefined(parent.y1, child.y1),
    y2: minDefined(parent.y2, child.y2),
  }
}

function maxDefined(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
}

function minDefined(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.min(a, b)
}

type UnclipOperation = {
  type: 'unclip'
}

type BlitOperation = {
  type: 'blit'
  src: Screen
  x: number
  y: number
  width: number
  height: number
  /** densable `unclipped` — skip clip stack (hn blit past new viewport). */
  unclipped?: boolean
  /** densable `restoreNoSelect` — pg after writes (opaque skip-blit). */
  restoreNoSelect?: boolean
}

type ShiftOperation = {
  type: 'shift'
  top: number
  bottom: number
  n: number
}

type ClearOperation = {
  type: 'clear'
  region: Rectangle
  /**
   * Set when the clear is for an absolute-positioned node's old bounds.
   * Absolute nodes overlay normal-flow siblings, so their stale paint is
   * what an earlier sibling's clean-subtree blit wrongly restores from
   * prevScreen. Normal-flow siblings' clears don't have this problem —
   * their old position can't have been painted on top of a sibling.
   */
  fromAbsolute?: boolean
}

type NoSelectOperation = {
  type: 'noSelect'
  region: Rectangle
  /** densable `value`: 1 = fg mark, 0 = hg clear. */
  value: 0 | 1
}

export default class Output {
  width: number
  height: number
  private screen: Screen
  /** Official 2.1.328 `lineCells` (`new bm(stylePool, screen.charPool)`). */
  readonly lineCells: LineCells

  private readonly operations: Operation[] = []
  /** Official 2.1.328 `rowsAtRightEdge` — screen rows written at/past the right edge for `Lu`. */
  readonly rowsAtRightEdge: Set<number> = new Set()

  constructor(options: Options) {
    const { width, height, stylePool, screen } = options

    this.width = width
    this.height = height
    this.screen = screen
    this.lineCells = new LineCells(stylePool, screen.charPool)

    resetScreen(screen, width, height)
  }

  /**
   * Reuse this Output for a new frame. Zeroes the screen buffer and clears
   * the operation list while preserving `lineCells`'s `keptLines`/`keptCells`
   * cache across frames (automatically invalidated on stylePool/chalk/pool changes).
   */
  reset(width: number, height: number, screen: Screen): void {
    this.width = width
    this.height = height
    this.screen = screen
    this.operations.length = 0
    this.rowsAtRightEdge.clear()
    resetScreen(screen, width, height)
  }

  /**
   * Copy cells from a source screen region (blit = block image transfer).
   */
  blit(
    src: Screen,
    x: number,
    y: number,
    width: number,
    height: number,
    opts?: { unclipped?: boolean; restoreNoSelect?: boolean },
  ): void {
    this.operations.push({
      type: 'blit',
      src,
      x,
      y,
      width,
      height,
      unclipped: opts?.unclipped,
      restoreNoSelect: opts?.restoreNoSelect,
    })
  }

  /**
   * densable `blitsOver` — some blit op overlaps `rect`.
   */
  blitsOver(rect: Rectangle): boolean {
    for (const operation of this.operations) {
      if (
        operation.type === 'blit' &&
        operation.x < rect.x + rect.width &&
        rect.x < operation.x + operation.width &&
        operation.y < rect.y + rect.height &&
        rect.y < operation.y + operation.height
      ) {
        return true
      }
    }
    return false
  }

  /**
   * Shift full-width rows within [top, bottom] by n. n > 0 = up. Mirrors
   * what DECSTBM + SU/SD does to the terminal. Paired with blit() to reuse
   * prevScreen content during pure scroll, avoiding full child re-render.
   */
  shift(top: number, bottom: number, n: number): void {
    this.operations.push({ type: 'shift', top, bottom, n })
  }

  /**
   * Clear a region by writing empty cells. Used when a node shrinks to
   * ensure stale content from the previous frame is removed.
   */
  clear(region: Rectangle, fromAbsolute?: boolean): void {
    this.operations.push({ type: 'clear', region, fromAbsolute })
  }

  /**
   * Mark a region as non-selectable (excluded from fullscreen text
   * selection copy + highlight). Used by <NoSelect> to fence off
   * gutters (line numbers, diff sigils). Applied AFTER blit/write so
   * the mark wins regardless of what's blitted into the region.
   */
  noSelect(region: Rectangle): void {
    this.operations.push({ type: 'noSelect', region, value: 1 })
  }

  /** densable `clearNoSelect` — opaque fill arm, value 0. */
  clearNoSelect(region: Rectangle): void {
    this.operations.push({ type: 'noSelect', region, value: 0 })
  }

  write(
    x: number,
    y: number,
    text: string,
    softWrap?: SoftWrapKindValue[],
  ): void {
    if (!text) {
      return
    }

    this.writeLines(x, y, text.split('\n'), softWrap)
  }

  /** Official 2.1.328 `writeLines` — emit pre-split lines without re-splitting. */
  writeLines(
    x: number,
    y: number,
    lines: string[],
    softWrap?: SoftWrapKindValue[],
    direction?: 'ltr' | 'rtl',
  ): void {
    if (lines.length === 0) {
      return
    }
    this.operations.push({
      type: 'write',
      x,
      y,
      lines,
      softWrap,
      direction,
    })
  }

  /**
   * Official 2.1.328 `writeDirected(x, y, text, softWrap, direction, maxWidth)`:
   * only applies directed software BiDi / RTL right-alignment when
   * `usesDirectedBidi(direction)` (`gm(M)`) is true; on native BiDi terminals
   * delegates directly to `this.write()` (preserving `softWrap`).
   */
  writeDirected(
    x: number,
    y: number,
    text: string,
    softWrap: SoftWrapKindValue[] | undefined,
    direction: 'ltr' | 'rtl' | undefined,
    maxWidth: number,
  ): void {
    if (!usesDirectedBidi(direction)) {
      this.write(x, y, text, softWrap)
      return
    }
    if (direction === 'ltr') {
      if (text) this.writeLines(x, y, text.split('\n'), softWrap, direction)
      return
    }
    const lines = text.split('\n')
    const limit = Math.min(lines.length, this.height - y)
    for (let i = Math.max(0, -y); i < limit; i++) {
      const line = lines[i]!
      const width = this.lineCells.width(line, x, false)
      const nextKind = softWrap?.[i + 1] ?? SoftWrapKind.HardBreak
      const trailing =
        nextKind === SoftWrapKind.HardBreak
          ? 0
          : this.lineCells.trailingSpaces(line)
      const keepGap = nextKind === SoftWrapKind.Continuation && trailing < width
      const trimmedWidth =
        width - Math.min(trailing, Math.max(width - maxWidth, keepGap ? 1 : 0))
      if (trimmedWidth > 0) {
        const sliced =
          trimmedWidth < width ? sliceAnsi(line, 0, trimmedWidth) : line
        this.writeLines(
          x + Math.max(0, maxWidth - trimmedWidth),
          y + i,
          [sliced],
          undefined,
          direction,
        )
      }
    }
  }

  /** Official 2.1.328 `paintedWidth(line, column)` — display width at `column`. */
  paintedWidth(line: string, column: number): number {
    return this.lineCells.width(line, column, isSoftwareBidiNeeded())
  }

  clip(clip: Clip) {
    this.operations.push({
      type: 'clip',
      clip,
    })
  }

  unclip() {
    this.operations.push({
      type: 'unclip',
    })
  }

  private checkRightEdgeOf(fromRow: number, toRow: number): void {
    for (let y = Math.max(0, fromRow); y < Math.min(toRow, this.height); y++) {
      this.rowsAtRightEdge.add(y)
    }
  }

  /**
   * Official 2.1.328 `ws.paintWrite(operation, clip)` — clips and paints
   * visible lines directly via `lineCells` without intermediate `.map()` arrays
   * (skipping any line with `index < sliceStart - 1 || index >= sliceEnd`).
   */
  private paintWrite(
    operation: WriteOperation,
    clip: Clip | undefined,
  ): number {
    const { x, y, lines, softWrap, direction } = operation
    const { screen, lineCells } = this
    const clipX1 = clip?.x1 ?? -Infinity
    const clipX2 = clip?.x2 ?? Infinity
    const clipHorizontally = clip?.x1 !== undefined && clip.x2 !== undefined
    const clipVertically = clip?.y1 !== undefined && clip.y2 !== undefined

    const sliceStart = clipVertically ? Math.max(0, clip.y1! - y) : 0
    const sliceEnd = Math.min(
      lines.length,
      this.height - y,
      clipVertically ? clip.y2! - y : Infinity,
    )
    if (sliceStart >= sliceEnd) return 0
    if (clipHorizontally) {
      if (x > clip.x2!) return 0
    }

    const reorder = isSoftwareBidiNeeded()
    const directedClipX =
      clipHorizontally && usesDirectedBidi(direction)
        ? { x1: clip.x1!, x2: clip.x2! }
        : undefined
    const sliceHorizontally = clipHorizontally && directedClipX === undefined
    const swStartCol = clipHorizontally ? Math.max(x, clipX1) : x
    const paintX = directedClipX !== undefined ? x : swStartCol

    let packedPrev = 0
    if (
      sliceStart > 0 &&
      (softWrap?.[sliceStart] ?? SoftWrapKind.HardBreak) !==
        SoftWrapKind.HardBreak
    ) {
      const prevLine = sliceHorizontally
        ? this.cutToColumns(lines[sliceStart - 1]!, x, clipX1, clipX2, reorder)
        : lines[sliceStart - 1]!
      packedPrev = packSoftWrap(
        paintDirectedLine(
          screen,
          prevLine,
          paintX,
          -1,
          lineCells,
          direction,
          directedClipX,
        ),
        swStartCol,
      )
    }

    let writtenCells = 0
    for (let index = sliceStart; index < sliceEnd; index++) {
      const line = lines[index]!
      const lineY = y + index
      if (swStartCol > x && x + lineCells.width(line, x, reorder) < clipX1) {
        packedPrev = packSoftWrap(swStartCol, swStartCol)
        continue
      }
      const lineToPaint = sliceHorizontally
        ? this.cutToColumns(line, x, clipX1, clipX2, reorder)
        : line
      const contentEnd = paintDirectedLine(
        screen,
        lineToPaint,
        paintX,
        lineY,
        lineCells,
        direction,
        directedClipX,
      )
      writtenCells += contentEnd - swStartCol
      if (contentEnd >= screen.width && lineY >= 0) {
        this.rowsAtRightEdge.add(lineY)
      }
      if (softWrap) {
        const kind = softWrap[index]
        screen.softWrap[lineY] =
          kind === SoftWrapKind.HardBreak || kind === undefined
            ? 0
            : kind === SoftWrapKind.ContinuationElidedSep
              ? packedPrev | SW_ELIDED_SEP
              : packedPrev
        packedPrev = packSoftWrap(contentEnd, swStartCol)
      }
    }
    return writtenCells
  }

  /** Official 2.1.328 `ws.cutToColumns` — horizontal clip with bidi sanitization. */
  private cutToColumns(
    line: string,
    x: number,
    x1: number,
    x2: number,
    reorder: boolean,
  ): string {
    if (x >= x1 && x + this.lineCells.width(line, x, reorder) <= x2) {
      return line
    }
    const sanitized = sanitizeBidiControls(line)
    const from = Math.max(0, x1 - x)
    let to = x2 - x
    let sliced = sliceAnsi(sanitized, from, to)
    const placedX = Math.max(x, x1)
    while (
      to > from &&
      this.lineCells.width(sliced, placedX, reorder) > x2 - placedX
    ) {
      to--
      sliced = sliceAnsi(sanitized, from, to)
    }
    return sliced
  }

  get(): Screen {
    const screen = this.screen
    const screenWidth = this.width
    const screenHeight = this.height
    this.lineCells.startFrame(
      isSoftwareBidiNeeded(),
      screen.hyperlinkPool,
      screen.charPool,
    )

    // Track blit vs write cell counts for debugging
    let blitCells = 0
    let writeCells = 0

    // Pass 1: expand damage to cover clear regions and collect absolute clears.
    const absoluteClears: { rect: Rectangle; opIndex: number }[] = []
    for (let i = 0; i < this.operations.length; i++) {
      const operation = this.operations[i]!
      if (operation.type !== 'clear') continue
      const { x, y, width, height } = operation.region
      const startX = Math.max(0, x)
      const startY = Math.max(0, y)
      const maxX = Math.min(x + width, screenWidth)
      const maxY = Math.min(y + height, screenHeight)
      if (startX >= maxX || startY >= maxY) continue
      const rect = {
        x: startX,
        y: startY,
        width: maxX - startX,
        height: maxY - startY,
      }
      screen.damage = screen.damage ? unionRect(screen.damage, rect) : rect
      if (operation.fromAbsolute) absoluteClears.push({ rect, opIndex: i })
    }

    const clips: Clip[] = []
    const restoreNoSelect: {
      opIndex: number
      src: Screen
      x1: number
      y1: number
      x2: number
      y2: number
    }[] = []
    for (let opIndex = 0; opIndex < this.operations.length; opIndex++) {
      const operation = this.operations[opIndex]!
      switch (operation.type) {
        case 'clear':
          continue

        case 'clip':
          clips.push(intersectClip(clips.at(-1), operation.clip))
          continue

        case 'unclip':
          clips.pop()
          continue

        case 'blit': {
          const {
            src,
            x: regionX,
            y: regionY,
            width: regionWidth,
            height: regionHeight,
          } = operation
          const clip = operation.unclipped ? undefined : clips.at(-1)
          const startX = Math.max(regionX, clip?.x1 ?? 0)
          const startY = Math.max(regionY, clip?.y1 ?? 0)
          const maxY = Math.min(
            regionY + regionHeight,
            screenHeight,
            src.height,
            clip?.y2 ?? Infinity,
          )
          const maxX = Math.min(
            regionX + regionWidth,
            screenWidth,
            src.width,
            clip?.x2 ?? Infinity,
          )
          if (startX >= maxX || startY >= maxY) continue
          if (src.width !== screenWidth) {
            this.checkRightEdgeOf(startY, maxY)
          }
          const queueRestore = (
            x1: number,
            y1: number,
            x2: number,
            y2: number,
          ) => {
            if (operation.restoreNoSelect) {
              restoreNoSelect.push({ opIndex, src, x1, y1, x2, y2 })
            }
          }
          if (absoluteClears.length === 0) {
            blitRegion(screen, src, startX, startY, maxX, maxY)
            blitCells += (maxY - startY) * (maxX - startX)
            queueRestore(startX, startY, maxX, maxY)
            continue
          }
          const laterAbs = absoluteClears.filter(c => c.opIndex > opIndex)
          let rowStart = startY
          for (let row = startY; row <= maxY; row++) {
            const excluded =
              row < maxY &&
              laterAbs.some(
                ({ rect: r }) =>
                  row >= r.y &&
                  row < r.y + r.height &&
                  startX >= r.x &&
                  maxX <= r.x + r.width,
              )
            if (excluded || row === maxY) {
              if (row > rowStart) {
                blitRegion(screen, src, startX, rowStart, maxX, row)
                blitCells += (row - rowStart) * (maxX - startX)
                queueRestore(startX, rowStart, maxX, row)
              }
              rowStart = row + 1
            }
          }
          continue
        }

        case 'shift': {
          shiftRows(screen, operation.top, operation.bottom, operation.n)
          this.checkRightEdgeOf(operation.top, operation.bottom + 1)
          continue
        }

        case 'write': {
          writeCells += this.paintWrite(operation, clips.at(-1))
          continue
        }
      }
    }

    // Pass 2: restoreNoSelect then noSelect, in operation order so later writes
    // don't keep stomping opaque fences.
    {
      const clips2: Clip[] = []
      let restoreAt = 0
      for (let i = 0; i < this.operations.length; i++) {
        const operation = this.operations[i]!
        if (operation.type === 'clip') {
          clips2.push(intersectClip(clips2.at(-1), operation.clip))
        } else if (operation.type === 'unclip') {
          clips2.pop()
        } else if (operation.type === 'blit') {
          while (
            restoreAt < restoreNoSelect.length &&
            restoreNoSelect[restoreAt]!.opIndex === i
          ) {
            const r = restoreNoSelect[restoreAt]!
            restoreNoSelectRegion(screen, r.src, r.x1, r.y1, r.x2, r.y2)
            restoreAt++
          }
        } else if (operation.type === 'noSelect') {
          const { x, y, width, height } = operation.region
          const clip = clips2.at(-1)
          const x1 = Math.max(x, clip?.x1 ?? 0)
          const y1 = Math.max(y, clip?.y1 ?? 0)
          const x2 = Math.min(x + width, clip?.x2 ?? Infinity)
          const y2 = Math.min(y + height, clip?.y2 ?? Infinity)
          if (x2 > x1 && y2 > y1) {
            if (operation.value === 1) {
              markNoSelectRegion(screen, x1, y1, x2 - x1, y2 - y1)
            } else {
              clearNoSelectRegion(screen, x1, y1, x2 - x1, y2 - y1)
            }
          }
        }
      }
    }

    const totalCells = blitCells + writeCells
    if (totalCells > 1000 && writeCells > blitCells) {
      logForDebugging(
        `High write ratio: blit=${blitCells}, write=${writeCells} (${((writeCells / totalCells) * 100).toFixed(1)}% writes), screen=${screenHeight}x${screenWidth}`,
      )
    }

    return screen
  }
}
