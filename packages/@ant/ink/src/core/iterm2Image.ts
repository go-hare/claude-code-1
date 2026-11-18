import { deflateSync } from 'node:zlib'
import { type Screen } from './screen.js'

const ESC = '\x1b'
const BEL = '\x07'
const ST = '\x1b\\'
const ITERM_FILE_PREFIX = `${ESC}]1337;File=`
const TMUX_PASSTHROUGH_PREFIX = `${ESC}Ptmux;`
const TMUX_LIMIT = 262_144
const TMUX_PART_OVERHEAD = 64
const SAVE_CURSOR = `${ESC}7`
const RESTORE_CURSOR = `${ESC}8`

// Official Kitty/iTerm2 diacritic table (`y_e`)
const DIACRITICS = [
  773, 781, 782, 784, 786, 829, 830, 831, 838, 842, 843, 844, 848, 849, 850,
  855, 859, 867, 868, 869, 870, 871, 872, 873, 874, 875, 876, 877, 878, 879,
  1155, 1156, 1157, 1158, 1159, 1426, 1427, 1428, 1429, 1431, 1432, 1433, 1436,
  1437, 1438, 1439, 1440, 1441, 1448, 1449, 1451, 1452, 1455, 1476, 1552, 1553,
  1554, 1555, 1556, 1557, 1558, 1559, 1623, 1624, 1625, 1626, 1627, 1629, 1630,
  1750, 1751, 1752, 1753, 1754, 1755, 1756, 1759, 1760, 1761, 1762, 1764, 1767,
  1768, 1771, 1772, 1840, 1842, 1843, 1845, 1846, 1850, 1853, 1855, 1856, 1857,
  1859, 1861, 1863, 1865, 1866, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2035,
  2070, 2071, 2072, 2073, 2075, 2076, 2077, 2078, 2079, 2080, 2081, 2082, 2083,
  2085, 2086, 2087, 2089, 2090, 2091, 2092, 2093, 2385, 2387, 2388, 3970, 3971,
  3974, 3975, 4957, 4958, 4959, 6109, 6458, 6679, 6773, 6774, 6775, 6776, 6777,
  6778, 6779, 6780, 7019, 7021, 7022, 7023, 7024, 7025, 7026, 7027, 7376, 7377,
  7378, 7386, 7387, 7392, 7616, 7617, 7619, 7620, 7621, 7622, 7623, 7624, 7625,
  7627, 7628, 7633, 7634, 7635, 7636, 7637, 7638, 7639, 7640, 7641, 7642, 7643,
  7644, 7645, 7646, 7647, 7648, 7649, 7650, 7651, 7652, 7653, 7654, 7678, 8400,
  8401, 8404, 8405, 8406, 8407, 8411, 8412, 8417, 8423, 8425, 8432, 11503,
  11504, 11505, 11744, 11745, 11746, 11747, 11748, 11749, 11750, 11751, 11752,
  11753, 11754, 11755, 11756, 11757, 11758, 11759, 11760, 11761, 11762, 11763,
  11764, 11765, 11766, 11767, 11768, 11769, 11770, 11771, 11772, 11773, 11774,
  11775, 42607, 42620, 42621, 42736, 42737, 43232, 43233, 43234, 43235, 43236,
  43237, 43238, 43239, 43240, 43241, 43242, 43243, 43244, 43245, 43246, 43247,
  43248, 43249, 43696, 43698, 43699, 43703, 43704, 43710, 43711, 43713, 65056,
  65057, 65058, 65059, 65060, 65061, 65062, 68111, 68152, 119173, 119174,
  119175, 119176, 119177, 119210, 119211, 119212, 119213, 119362, 119363,
  119364,
] as const

const BASE = DIACRITICS.length
const MAX_ID = 16_777_216
const MAX_PIXEL_DIM = 10_000
const DIACRITIC_INDEX = new Map<number, number>(
  DIACRITICS.map((cp, idx) => [cp, idx]),
)
const BRAILLE_BLANK = '\u2800'
const BRAILLE_BLANK_CP = BRAILLE_BLANK.codePointAt(0)!

function assertPositiveRange(val: number, max: number): void {
  if (!Number.isInteger(val) || val < 1 || val > max) {
    throw new TypeError(
      'iTerm2 image: an id, cell count or size must be a positive integer within its range',
    )
  }
}

function assertBase64(b64: string): void {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new TypeError(
      'iTerm2 image: payload must be standard base64 (A-Z a-z 0-9 + / =)',
    )
  }
}

function diacritic(idx: number): string {
  return String.fromCodePoint(DIACRITICS[idx]!)
}

export function iterm2PlaceholderCell(
  id: number,
  row: number,
  column: number,
): string {
  return (
    BRAILLE_BLANK +
    diacritic(row) +
    diacritic(column) +
    diacritic(Math.floor(id / (BASE * BASE))) +
    diacritic(Math.floor(id / BASE) % BASE) +
    diacritic(id % BASE)
  )
}

export function iterm2PlaceholderGrid(
  id: number,
  columns: number,
  rows: number,
): string {
  assertPositiveRange(id, MAX_ID - 1)
  assertPositiveRange(columns, BASE)
  assertPositiveRange(rows, BASE)
  const lines: string[] = []
  for (let r = 0; r < rows; r++) {
    let line = ''
    for (let c = 0; c < columns; c++) {
      line += iterm2PlaceholderCell(id, r, c)
    }
    lines.push(line)
  }
  return lines.join('\n')
}

export type DecodedIterm2Placeholder = {
  id: number
  row: number
  column: number
}

export function decodeIterm2Placeholder(
  char: string,
): DecodedIterm2Placeholder | undefined {
  if (char.codePointAt(0) !== BRAILLE_BLANK_CP) return undefined
  const rest = Array.from(char)
    .slice(1)
    .map(ch => DIACRITIC_INDEX.get(ch.codePointAt(0)!))
  if (rest.length !== 5) return undefined
  const [row, column, d2, d1, d0] = rest
  if (
    row === undefined ||
    column === undefined ||
    d2 === undefined ||
    d1 === undefined ||
    d0 === undefined
  ) {
    return undefined
  }
  const id = (d2 * BASE + d1) * BASE + d0
  if (id === 0 || id >= MAX_ID) return undefined
  return { id, row, column }
}

export function encodeIterm2InlineImage(input: {
  pngBase64: string
  columns: number
  rows: number
}): string {
  const { pngBase64, columns, rows } = input
  assertPositiveRange(columns, BASE)
  assertPositiveRange(rows, BASE)
  assertBase64(pngBase64)
  if (pngBase64 === '') {
    throw new TypeError('iTerm2 image: the payload is empty')
  }
  const padding = pngBase64.endsWith('==') ? 2 : pngBase64.endsWith('=') ? 1 : 0
  const byteSize = (pngBase64.length / 4) * 3 - padding
  const params = `inline=1;size=${byteSize};width=${columns};height=${rows};preserveAspectRatio=1;doNotMoveCursor=1`
  return `${ITERM_FILE_PREFIX}${params}:${pngBase64}${BEL}`
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of data) {
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, 'ascii')
  const body = Buffer.concat([header.subarray(4), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([header.subarray(0, 4), body, crc])
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export function rgbaToPngBase64(
  rgbaBase64: string,
  width: number,
  height: number,
): string {
  assertPositiveRange(width, MAX_PIXEL_DIM)
  assertPositiveRange(height, MAX_PIXEL_DIM)
  assertBase64(rgbaBase64)
  const raw = Buffer.from(rgbaBase64, 'base64')
  const stride = width * 4
  if (raw.length !== stride * height) {
    throw new TypeError('iTerm2 image: RGBA bytes do not match the size')
  }
  const scanlines = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', new Uint8Array(0)),
  ]).toString('base64')
}

export type CollectedIterm2Image = {
  originX: number
  originY: number
  count: number
  lastRow: number
  lastColumn: number
  isConsistent: boolean
  indexes: number[]
}

export function collectIterm2Cells(
  screen: Screen,
): Map<number, CollectedIterm2Image> {
  const result = new Map<number, CollectedIterm2Image>()
  const { width, height, cells, charPool } = screen
  const total = width * height
  for (let idx = 0; idx < total; idx++) {
    const charId = cells[idx * 2]!
    if (charId === 0) continue
    const ch = charPool.get(charId)
    const decoded = decodeIterm2Placeholder(ch)
    if (!decoded) continue
    const x = idx % width
    const y = Math.floor(idx / width)
    const existing = result.get(decoded.id)
    if (!existing) {
      result.set(decoded.id, {
        originX: x - decoded.column,
        originY: y - decoded.row,
        count: 1,
        lastRow: decoded.row,
        lastColumn: decoded.column,
        isConsistent: decoded.row >= 0 && decoded.column >= 0,
        indexes: [idx],
      })
    } else {
      existing.count++
      if (decoded.row > existing.lastRow) existing.lastRow = decoded.row
      if (decoded.column > existing.lastColumn) {
        existing.lastColumn = decoded.column
      }
      if (
        x - decoded.column !== existing.originX ||
        y - decoded.row !== existing.originY
      ) {
        existing.isConsistent = false
      }
      existing.indexes.push(idx)
    }
  }
  return result
}

function tmuxEscapedLength(seq: string): number {
  return seq.length + seq.split(ESC).length - 1
}

function wrapTmux(seq: string): string {
  return TMUX_PASSTHROUGH_PREFIX + seq.replaceAll(ESC, ESC + ESC) + ST
}

export function wrapTmuxPassthrough(seq: string): string {
  let out = ''
  let chunk = ''
  let chunkLen = 0
  let i = 0
  while (i < seq.length) {
    const next = seq[i] === ESC ? seq[i + 1] : undefined
    let end = seq.length
    if (next === '_' || next === 'P') {
      const stIdx = seq.indexOf(ST, i + 2)
      end = stIdx === -1 ? end : stIdx + ST.length
    } else if (next === ']') {
      const belIdx = seq.indexOf(BEL, i + 2)
      const stIdx = seq.indexOf(ST, i + 2)
      end =
        belIdx !== -1 && (stIdx === -1 || belIdx < stIdx)
          ? belIdx + BEL.length
          : stIdx === -1
            ? end
            : stIdx + ST.length
    } else {
      const escIdx = seq.indexOf(ESC, i + 1)
      end = escIdx === -1 ? end : escIdx
    }
    const piece = seq.slice(i, end)
    const pieceLen = tmuxEscapedLength(piece)
    i = end
    if (chunk !== '' && chunkLen + pieceLen > TMUX_LIMIT) {
      out += wrapTmux(chunk)
      chunk = ''
      chunkLen = 0
    }
    chunk += piece
    chunkLen += pieceLen
  }
  return chunk === '' ? out : out + wrapTmux(chunk)
}

export function wrapTmuxItermFile(
  seq: string,
  pos: { row: number; column: number },
): string {
  const colonIdx = seq.indexOf(':', ITERM_FILE_PREFIX.length)
  if (
    !(
      seq.startsWith(ITERM_FILE_PREFIX) &&
      seq.endsWith(BEL) &&
      seq.indexOf(ESC, 1) === -1 &&
      seq.indexOf(BEL) === seq.length - BEL.length &&
      colonIdx !== -1
    )
  ) {
    throw new TypeError(
      'tmux passthrough: expected exactly one iTerm2 File= sequence ending in BEL',
    )
  }
  const cup = `${ESC}[${pos.row + 1};${pos.column + 1}H`
  const single = SAVE_CURSOR + cup + seq + RESTORE_CURSOR
  if (tmuxEscapedLength(single) <= TMUX_LIMIT) {
    return wrapTmux(single)
  }
  const header = seq.slice(ITERM_FILE_PREFIX.length, colonIdx)
  const body = seq.slice(colonIdx + 1, -BEL.length)
  const partSize = TMUX_LIMIT - TMUX_PART_OVERHEAD
  let out = wrapTmux(`${ESC}]1337;MultipartFile=${header}${BEL}`)
  for (let i = 0; i < body.length; i += partSize) {
    out += wrapTmux(`${ESC}]1337;FilePart=${body.slice(i, i + partSize)}${BEL}`)
  }
  return (
    out +
    wrapTmux(`${SAVE_CURSOR}${cup}${ESC}]1337;FileEnd${BEL}${RESTORE_CURSOR}`)
  )
}
