/**
 * Function hooks submodule: raster
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { stringWidth } from '@anthropic/ink'
import { isAbsolute } from 'path'
import { isEventRecord } from './constants.js'
import type {
  RasterAdmission,
  RasterPalette,
  RasterPaletteAlias,
  RasterPaletteEntry,
  RasterPaletteState,
} from './types.js'

/** densable `ZHt` join for Raster/Image site keys: plugin, requestId, key. */
const MOUNT_KEY_JOIN = '\0'

export const RASTER_BLIT_WINDOW_MS = 1000

export const RASTER_BLITS_PER_WINDOW = 120

export const RASTER_MAX_COLUMNS = 512

export const RASTER_MAX_ROWS = 256

export function mountSiteKey(
  requestId: string,
  key: string,
  plugin: string,
): string {
  return [plugin, requestId, key].join(MOUNT_KEY_JOIN)
}

/** densable `FW` / `wA` / `Tk` — each cell is 12 bytes → 3 uint32 words. */
const RASTER_CELL_BYTES = 12

const RASTER_CELL_WORDS = 3

const BASE64_GROUP_BYTES = 3

const BASE64_GROUP_CHARS = 4

const RASTER_DEFAULT_COLOR = 16_777_216

const RASTER_COLOR_MASK = 16_777_215

const BMP_LAST = 65_535

const IMAGE_SOURCE_SHAPE =
  '{ png }, { rgba, width, height }, { file, format } or { shm, format, width, height }'

const IMAGE_SOURCE_KINDS: Array<[string, string[]]> = [
  ['png', ['png']],
  ['rgba', ['rgba', 'width', 'height']],
  ['file', ['file', 'format', 'width', 'height', 'generation']],
  ['shm', ['shm', 'format', 'width', 'height', 'generation']],
]

const IMAGE_PNG_MAX_SIDE = 4096

const IMAGE_RGBA_MAX_SIDE = 2048

const IMAGE_FILE_MAX_SIDE = 4096

const IMAGE_DECODE_MAX_BYTES = 2_097_152

const IMAGE_FILE_PATH_MAX = 3072

const SHM_NAME_RE = /^\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,254}$/

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10]

const rasterWidthCache = new Uint8Array(BMP_LAST + 1)

function rasterBase64Chars(columns: number, rows: number): number {
  return (
    Math.ceil((columns * rows * RASTER_CELL_BYTES) / BASE64_GROUP_BYTES) *
    BASE64_GROUP_CHARS
  )
}

function paddedBase64Bytes(value: unknown): number | undefined {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value.length % BASE64_GROUP_CHARS !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    return undefined
  }
  const pad = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / BASE64_GROUP_CHARS) * BASE64_GROUP_BYTES - pad
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isNarrowPrintable(codePoint: number): boolean {
  const cached = rasterWidthCache[codePoint] ?? 0
  if (cached === 1) return true
  if (cached === 2) return false
  const ok =
    codePoint > 31 &&
    (codePoint < 127 || codePoint > 159) &&
    (codePoint < 55296 || codePoint > 57343) &&
    stringWidth(String.fromCodePoint(codePoint)) === 1
  rasterWidthCache[codePoint] = ok ? 1 : 2
  return ok
}

/** densable `ymt` — one printable width-1 BMP code point. */
function rasterGlyphProblem(
  codePoint: number,
  index: number,
): string | undefined {
  if (codePoint > BMP_LAST) {
    return `cell ${index} holds code point ${codePoint}, beyond the Basic Multilingual Plane`
  }
  if (isNarrowPrintable(codePoint)) return undefined
  const hex = codePoint.toString(16).toUpperCase().padStart(4, '0')
  return `cell ${index} holds U+${hex}, which is not one printable width-1 code point (a control, combining or wide character)`
}

function isRasterColor(value: number): boolean {
  return value <= RASTER_COLOR_MASK || value === RASTER_DEFAULT_COLOR
}

/** densable `yIn` — decode Raster cells to uint32 words, or `{problem}`. */
export function decodeRasterCells(
  cells: unknown,
  columns: number,
  rows: number,
): { words: Uint32Array } | { problem: string } {
  const count = columns * rows
  const needed = rasterBase64Chars(columns, rows)
  if (typeof cells !== 'string' || cells.length !== needed) {
    return {
      problem: `cells must be the base64 of ${count} cells of ${RASTER_CELL_BYTES} bytes (${needed} characters for ${columns}x${rows})`,
    }
  }
  const raw = Buffer.from(cells, 'base64')
  if (raw.length !== count * RASTER_CELL_BYTES) {
    return { problem: 'cells is not base64 (standard alphabet, padded)' }
  }
  const words = new Uint32Array(count * RASTER_CELL_WORDS)
  new Uint8Array(words.buffer).set(raw)
  for (let i = 0; i < count; i++) {
    const at = i * RASTER_CELL_WORDS
    const glyph = rasterGlyphProblem(words[at] ?? 0, i)
    if (glyph !== undefined) return { problem: glyph }
    if (
      !isRasterColor(words[at + 1] ?? 0) ||
      !isRasterColor(words[at + 2] ?? 0)
    ) {
      return {
        problem: `cell ${i} holds a color that is neither 0xRRGGBB nor 0x1000000 (the default)`,
      }
    }
  }
  return { words }
}

/** densable `Ay` / `xL` / `kA` — pack RGB into 15-step SGR palette keys. */
const SGR_CHANNEL_MAX = 15

const SGR_STEP = 17

const SGR_GREEN_SHIFT = 4

const SGR_RED_SHIFT = 8

const SGR_DEFAULT_PACKED = 32768

const SGR_SET_FG = 38

const SGR_SET_BG = 48

const SGR_RESET_FG = 39

const SGR_RESET_BG = 49

const SGR_TRUECOLOR = 2

function packSgrChannel(value: number): number {
  if (value === RASTER_DEFAULT_COLOR) return SGR_DEFAULT_PACKED
  const n = (shift: number) => Math.round(((value >> shift) & 255) / SGR_STEP)
  return (n(16) << SGR_RED_SHIFT) | (n(8) << SGR_GREEN_SHIFT) | n(0)
}

function packSgrPair(fg: number, bg: number): number {
  return packSgrChannel(fg) | (packSgrChannel(bg) << 16)
}

function unpackSgrHalf(packed: number, which: 'lo' | 'hi'): number {
  return which === 'lo' ? packed & 65535 : (packed >>> 16) & 65535
}

function sgrChannelByte(packed: number, shift: number): number {
  return ((packed >> shift) & SGR_CHANNEL_MAX) * SGR_STEP
}

function sgrSelect(packed: number, which: 'foreground' | 'background'): string {
  const reset = which === 'foreground' ? SGR_RESET_FG : SGR_RESET_BG
  const set = which === 'foreground' ? SGR_SET_FG : SGR_SET_BG
  if (packed === SGR_DEFAULT_PACKED) return String(reset)
  return [
    set,
    SGR_TRUECOLOR,
    sgrChannelByte(packed, SGR_RED_SHIFT),
    sgrChannelByte(packed, SGR_GREEN_SHIFT),
    sgrChannelByte(packed, 0),
  ].join(';')
}

function sgrOfPacked(packed: number): string {
  const fg = unpackSgrHalf(packed, 'lo')
  const bg = unpackSgrHalf(packed, 'hi')
  return `\x1b[${sgrSelect(fg, 'foreground')}m\x1b[${sgrSelect(bg, 'background')}m`
}

/** densable `XQ` / `zp` / `QQ` / `wmt` / `mmt` / `Rmt` / `Cmt` / `xmt` / `pmt`. */
const RASTER_PALETTE_SLOTS = 1024

const RASTER_SLOT_WIDTH = 8

const RASTER_HALF_WIDTH = 4

export const RASTER_ADMISSION_TOKENS = 4096

const RASTER_ADMISSION_REFILL_PER_S = 160

const RASTER_ADMISSION_REFILL_MS = 1000

const RASTER_EVICT_COST = 1024

const RASTER_ALIAS_CAP = 16384

const RASTER_ALIAS_SCAN = 64

const RASTER_EVAL_BUDGET = 131072

const RASTER_DEFAULT_MISMATCH = 4096

/** densable `YQ` — default fg/bg SGR. */
function defaultRasterSgr(): string {
  return sgrOfPacked(packSgrPair(RASTER_DEFAULT_COLOR, RASTER_DEFAULT_COLOR))
}

/** densable `Tmt` / `Emt` — shared admission bucket. */

function createRasterPaletteState(): RasterPaletteState {
  return {
    slots: [],
    held: new Map(),
    table: new Uint8Array(RASTER_PALETTE_SLOTS * RASTER_SLOT_WIDTH),
    probe: new Uint8Array(RASTER_SLOT_WIDTH),
    aliases: new Map(),
    admissions: 0,
    paint: 0,
    frame: new Set(),
    evaluated: 0,
    lastSgr: defaultRasterSgr(),
    isStarved: false,
    hasCarried: false,
    netMatched: 0,
    hasStale: false,
  }
}

/** densable `bmt` — stale slot indices, oldest lastPaint first. */
function staleRasterSlotIndices(state: RasterPaletteState): number[] {
  const stale: number[] = []
  state.slots.forEach((slot, index) => {
    if (slot.lastPaint < state.paint) stale.push(index)
  })
  return stale.toSorted(
    (a, b) =>
      (state.slots[a]?.lastPaint ?? 0) - (state.slots[b]?.lastPaint ?? 0),
  )
}

/** densable `jve` — pack a fg/bg key into 8 probe/table bytes. */
function writePackedPair(table: Uint8Array, slot: number, key: number): void {
  const writeHalf = (at: number, packed: number): void => {
    table[at] = packed === SGR_DEFAULT_PACKED ? 1 : 0
    table[at + 1] = (packed >> SGR_RED_SHIFT) & SGR_CHANNEL_MAX
    table[at + 2] = (packed >> SGR_GREEN_SHIFT) & SGR_CHANNEL_MAX
    table[at + 3] = packed & SGR_CHANNEL_MAX
  }
  const at = slot * RASTER_SLOT_WIDTH
  writeHalf(at, unpackSgrHalf(key, 'lo'))
  writeHalf(at + RASTER_HALF_WIDTH, unpackSgrHalf(key, 'hi'))
}

/** densable `vmt` — nearest slot by default-flag / RGB distance. */
function nearestRasterSlot(
  table: Uint8Array,
  slotCount: number,
  probe: Uint8Array,
): number {
  let best = -1
  let bestCost = Number.POSITIVE_INFINITY
  for (let slot = 0; slot < slotCount; slot++) {
    const base = slot * RASTER_SLOT_WIDTH
    let cost = 0
    for (let half = 0; half < RASTER_SLOT_WIDTH; half += RASTER_HALF_WIDTH) {
      const tableDefault = (table[base + half] ?? 0) === 1
      const probeDefault = (probe[half] ?? 0) === 1
      if (tableDefault || probeDefault) {
        cost += tableDefault === probeDefault ? 0 : RASTER_DEFAULT_MISMATCH
        continue
      }
      const dr = (table[base + half + 1] ?? 0) - (probe[half + 1] ?? 0)
      const dg = (table[base + half + 2] ?? 0) - (probe[half + 2] ?? 0)
      const db = (table[base + half + 3] ?? 0) - (probe[half + 3] ?? 0)
      cost += dr * dr + dg * dg + db * db
    }
    if (cost < bestCost) {
      bestCost = cost
      best = slot
    }
  }
  return best
}

/** densable `Amt` — refill 160/s, admit if tokens-cost >= 1, spend 1. */
function admitRasterToken(
  admission: RasterAdmission,
  now: number,
  cost: number,
): boolean {
  admission.tokens = Math.min(
    RASTER_ADMISSION_TOKENS,
    admission.tokens +
      Math.max(0, now - admission.refilledAt) *
        (RASTER_ADMISSION_REFILL_PER_S / RASTER_ADMISSION_REFILL_MS),
  )
  admission.refilledAt = now
  const ok = admission.tokens - cost >= 1
  admission.tokens -= ok ? 1 : 0
  return ok
}

/**
 * densable `PLo` — 1024-slot palette with admission, aliases, nearest probe.
 * `beginPaint` increments paint and sets frame to the distinct Set.
 */
export function createRasterPaletteWithAdmission(
  now: () => number,
  admission: RasterAdmission,
): RasterPalette {
  const state = createRasterPaletteState()
  const aliasLive = (alias: RasterPaletteAlias | undefined): boolean =>
    alias !== undefined && state.held.get(alias.entry.key) === alias.entry

  function admitSlot(slot: number, key: number): void {
    const entry: RasterPaletteEntry = {
      key,
      sgr: sgrOfPacked(key),
      lastPaint: state.paint,
    }
    const previous = state.slots[slot]
    if (previous !== undefined) state.held.delete(previous.key)
    state.slots[slot] = entry
    state.held.set(key, entry)
    state.admissions += 1
    writePackedPair(state.table, slot, key)
  }

  function admitFrame(): void {
    const missing: number[] = []
    for (const key of state.frame) {
      const held = state.held.get(key)
      const alias = state.aliases.get(key)
      if (held !== undefined) {
        held.lastPaint = state.paint
        continue
      }
      missing.push(key)
      if (alias !== undefined) {
        state.aliases.delete(key)
        state.aliases.set(key, alias)
      }
    }
    const evictable = staleRasterSlotIndices(state)
    let evictAt = 0
    for (const key of missing) {
      const growing = state.slots.length < RASTER_PALETTE_SLOTS
      const slot = growing ? state.slots.length : evictable[evictAt]
      if (slot === undefined) break
      if (
        !admitRasterToken(admission, now(), growing ? 0 : RASTER_EVICT_COST)
      ) {
        state.isStarved = true
        break
      }
      admitSlot(slot, key)
      evictAt += growing ? 0 : 1
    }
  }

  const aliasDisposable = (key: number): boolean =>
    !state.frame.has(key) ||
    state.held.has(key) ||
    !aliasLive(state.aliases.get(key))

  function evictAlias(): void {
    let pick: number | undefined
    let scanned = 0
    for (const key of state.aliases.keys()) {
      pick ??= key
      if (aliasDisposable(key)) {
        pick = key
        break
      }
      scanned += 1
      if (scanned >= RASTER_ALIAS_SCAN) break
    }
    if (pick !== undefined) {
      state.netMatched -= aliasDisposable(pick) ? 0 : 1
      state.aliases.delete(pick)
    }
  }

  function rememberAlias(key: number, entry: RasterPaletteEntry): void {
    const wasDead = !aliasLive(state.aliases.get(key))
    if (state.aliases.has(key)) state.aliases.delete(key)
    else if (state.aliases.size >= RASTER_ALIAS_CAP) evictAlias()
    state.aliases.set(key, { entry, after: state.admissions })
    state.netMatched += wasDead ? 1 : 0
  }

  function probeNearest(key: number): RasterPaletteEntry | undefined {
    if (
      !(
        state.slots.length > 0 &&
        state.evaluated + state.slots.length <= RASTER_EVAL_BUDGET
      )
    ) {
      return undefined
    }
    writePackedPair(state.probe, 0, key)
    state.evaluated += state.slots.length
    const nearest = nearestRasterSlot(
      state.table,
      state.slots.length,
      state.probe,
    )
    const entry = state.slots[nearest]
    if (entry !== undefined) rememberAlias(key, entry)
    return entry
  }

  function lookup(key: number): RasterPaletteEntry | undefined {
    const alias = state.aliases.get(key)
    const live = alias !== undefined && aliasLive(alias)
    if (live && alias !== undefined && alias.after === state.admissions) {
      return alias.entry
    }
    const nearest = probeNearest(key)
    if (nearest === undefined && live && alias !== undefined) {
      state.hasStale = true
      return alias.entry
    }
    state.hasCarried ||= nearest === undefined && state.slots.length > 0
    return nearest
  }

  return {
    beginPaint(distinctSet) {
      state.paint += 1
      state.frame = distinctSet
      state.evaluated = 0
      state.lastSgr = defaultRasterSgr()
      state.isStarved = false
      state.hasCarried = false
      state.netMatched = 0
      state.hasStale = false
      admitFrame()
    },
    sgrOf(key) {
      state.lastSgr = (state.held.get(key) ?? lookup(key))?.sgr ?? state.lastSgr
      return state.lastSgr
    },
    size: () => state.held.size,
    standing() {
      const progressing =
        (state.hasCarried && state.netMatched > 0) ||
        (state.hasStale && !state.isStarved)
      if (progressing) return 'progressing'
      return state.isStarved ? 'waiting' : 'complete'
    },
  }
}

/** densable `Pmt` — packed fg/bg keys in row order + distinct Set. */
function collectRasterPaintKeys(
  words: Uint32Array,
  size: { columns: number; rows: number },
): { keys: number[]; distinct: Set<number> } {
  const { columns, rows } = size
  const keys: number[] = []
  const distinct = new Set<number>()
  for (let y = 0; y < rows; y++) {
    let prevFg = -1
    let prevBg = -1
    for (let x = 0; x < columns; x++) {
      const at = (y * columns + x) * RASTER_CELL_WORDS
      const fg = words[at + 1] ?? 0
      const bg = words[at + 2] ?? 0
      if (fg !== prevFg || bg !== prevBg) {
        const packed = packSgrPair(fg, bg)
        keys.push(packed)
        distinct.add(packed)
        prevFg = fg
        prevBg = bg
      }
    }
  }
  return { keys, distinct }
}

/**
 * densable `Joo` — uint32 words → ANSI rows joined by newline.
 * `beginPaint(distinct)` then `sgrOf` on fg/bg change + fromCharCode.
 */
export function rasterWordsToAnsi(
  words: Uint32Array,
  columns: number,
  rows: number,
  palette: RasterPalette,
): string {
  const collected = collectRasterPaintKeys(words, { columns, rows })
  const lines = Array<string>(rows)
  let keyAt = 0
  palette.beginPaint(collected.distinct)
  for (let y = 0; y < rows; y++) {
    let line = ''
    let prevFg = -1
    let prevBg = -1
    for (let x = 0; x < columns; x++) {
      const at = (y * columns + x) * RASTER_CELL_WORDS
      const fg = words[at + 1] ?? 0
      const bg = words[at + 2] ?? 0
      if (fg !== prevFg || bg !== prevBg) {
        line += palette.sgrOf(collected.keys[keyAt] ?? 0)
        keyAt += 1
        prevFg = fg
        prevBg = bg
      }
      line += String.fromCharCode(words[at] ?? 0)
    }
    lines[y] = line
  }
  return lines.join('\n')
}

function imageSizeProblem(
  width: unknown,
  height: unknown,
  max: number,
): string | undefined {
  return isWholeNumber(width) &&
    isWholeNumber(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= max &&
    height <= max
    ? undefined
    : `source width and height must be whole numbers from 1 to ${max}`
}

function generationProblem(value: unknown): string | undefined {
  return value === undefined ||
    (isWholeNumber(value) && Number.isSafeInteger(value))
    ? undefined
    : 'source.generation must be a whole number when given'
}

function pngSourceProblem(png: unknown): string | undefined {
  const decoded = paddedBase64Bytes(png)
  if (decoded === undefined || typeof png !== 'string') {
    return 'source.png must be standard padded base64'
  }
  if (decoded > IMAGE_DECODE_MAX_BYTES) {
    return `source.png decodes to more than ${IMAGE_DECODE_MAX_BYTES} bytes`
  }
  const headerChars = Math.ceil(33 / BASE64_GROUP_BYTES) * BASE64_GROUP_CHARS
  const header = Buffer.from(png.slice(0, headerChars), 'base64')
  if (!PNG_SIG.every((byte, i) => header[i] === byte)) {
    return 'source.png does not start as a PNG file does'
  }
  if (!(header.length >= 33 && header.toString('latin1', 12, 16) === 'IHDR')) {
    return 'source.png has no IHDR header after its signature'
  }
  const width = header.readUInt32BE(16)
  const height = header.readUInt32BE(20)
  return width >= 1 &&
    width <= IMAGE_PNG_MAX_SIDE &&
    height >= 1 &&
    height <= IMAGE_PNG_MAX_SIDE
    ? undefined
    : `source.png declares ${width}x${height} pixels; a side is 1 to ${IMAGE_PNG_MAX_SIDE}`
}

function rgbaSourceProblem(
  rgba: unknown,
  width: unknown,
  height: unknown,
): string | undefined {
  const decoded = paddedBase64Bytes(rgba)
  if (decoded === undefined) return 'source.rgba must be standard padded base64'
  const size = imageSizeProblem(width, height, IMAGE_RGBA_MAX_SIDE)
  if (size !== undefined) return size
  if (decoded > IMAGE_DECODE_MAX_BYTES) {
    return `source.rgba decodes to more than ${IMAGE_DECODE_MAX_BYTES} bytes`
  }
  const need = Number(width) * Number(height) * 4
  return decoded === need
    ? undefined
    : `source.rgba decodes to ${decoded} bytes, not width * height * 4 (${need})`
}

function fileSourceProblem(
  file: unknown,
  rec: Record<string, unknown>,
): string | undefined {
  if (typeof file !== 'string' || file === '' || !isAbsolute(file)) {
    return 'source.file must be an absolute path'
  }
  for (const ch of file) {
    if (ch.charCodeAt(0) < 32) {
      return 'source.file holds a control character'
    }
  }
  if (/^[\\/]{2}/.test(file) || /^[\\/]\?\?[\\/]/.test(file)) {
    return 'source.file names a network location or device path, as spelled; the terminal would open it as the person ($.fs refuses it too)'
  }
  if (Buffer.byteLength(file, 'utf8') > IMAGE_FILE_PATH_MAX) {
    return `source.file is longer than ${IMAGE_FILE_PATH_MAX} bytes`
  }
  const format = rec.format
  if (format !== 'png' && format !== 'rgba' && format !== 'rgb') {
    return 'source.format must be "png", "rgba" or "rgb" beside file'
  }
  if (
    format === 'png' &&
    (rec.width !== undefined || rec.height !== undefined)
  ) {
    return 'source width and height go with format "rgba" or "rgb"; a png sizes itself'
  }
  return format === 'png'
    ? generationProblem(rec.generation)
    : (imageSizeProblem(rec.width, rec.height, IMAGE_FILE_MAX_SIDE) ??
        generationProblem(rec.generation))
}

function shmSourceProblem(
  shm: unknown,
  rec: Record<string, unknown>,
): string | undefined {
  if (typeof shm !== 'string' || !SHM_NAME_RE.test(shm)) {
    return 'source.shm must be "/" then 1 to 254 of A-Z a-z 0-9 . _ - (not "." or ".." alone), a POSIX shared-memory name'
  }
  return rec.format === 'rgba' || rec.format === 'rgb'
    ? (imageSizeProblem(rec.width, rec.height, IMAGE_FILE_MAX_SIDE) ??
        generationProblem(rec.generation))
    : 'source.format must be "rgba" or "rgb" beside shm'
}

/** densable `umt` — ImageSource check. */
export function imageSourceProblem(source: unknown): string | undefined {
  if (!isEventRecord(source)) return `source must be ${IMAGE_SOURCE_SHAPE}`
  const hits = IMAGE_SOURCE_KINDS.filter(([kind]) =>
    Object.hasOwn(source, kind),
  )
  const first = hits[0]
  const second = hits[1]
  if (first === undefined) return `source must be ${IMAGE_SOURCE_SHAPE}`
  const [kind, allowed] = first
  if (second !== undefined) {
    return `source holds both "${kind}" and "${second[0]}"; it is one of ${IMAGE_SOURCE_SHAPE}`
  }
  const extra = Object.keys(source).find(key => !allowed.includes(key))
  if (extra !== undefined) {
    return `source field "${extra}" is not allowed beside "${kind}"`
  }
  switch (kind) {
    case 'png':
      return pngSourceProblem(source.png)
    case 'rgba':
      return rgbaSourceProblem(source.rgba, source.width, source.height)
    case 'file':
      return fileSourceProblem(source.file, source)
    case 'shm':
      return shmSourceProblem(source.shm, source)
    default:
      return `source must be ${IMAGE_SOURCE_SHAPE}`
  }
}
