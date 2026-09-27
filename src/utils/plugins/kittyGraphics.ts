/**
 * Local kitty graphics sink for PluginImage (densable `xo` / `co` / `Pqr` / `Iqr`).
 * Ink has no `terminalImages`; this sink is used only by the Image widget.
 */

const ESC = '\x1b'
const CSI = `${ESC}[`
const APC_G = `${ESC}_G`
const ST = `${ESC}\\`
const PLACEHOLDER = String.fromCodePoint(1_109_742)
const SMALL_ID_LIMIT = 256
const PAYLOAD_CHUNK = 4096
const ID_MAX = 4_294_967_295
const RGB_MASK = 255
const RED_SHIFT = 16
const GREEN_SHIFT = 8

/**
 * densable combining marks `y` (Pqr cell diacritics). Kitty paints over this
 * grid; SGR fg encodes the image id.
 */
const KITTY_MARKS = [
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

const FORMAT_CTRL: Record<string, string> = {
  png: 'f=100',
  rgba: 'f=32',
  rgb: 'f=24',
}

const MEDIUM_CTRL: Record<string, string> = {
  file: 't=f',
  shm: 't=s',
}

const freeSmallIds = new Set<number>()
let nextSmallId = 1

/** densable `No()` kitty branch: TERM contains kitty, or KITTY_WINDOW_ID. */
export function isKittyGraphicsTerminal(): boolean {
  return (
    process.env.TERM?.includes('kitty') === true ||
    process.env.KITTY_WINDOW_ID !== undefined
  )
}

/** densable `Zd.takeSmall` — 8-bit ids 1..255. */
export function allocateKittyImageId(): number | undefined {
  for (const recycled of freeSmallIds) {
    freeSmallIds.delete(recycled)
    return recycled
  }
  if (nextSmallId >= SMALL_ID_LIMIT) return undefined
  const id = nextSmallId
  nextSmallId += 1
  return id
}

export function freeKittyImageId(id: number): void {
  if (id >= 1 && id < SMALL_ID_LIMIT) freeSmallIds.add(id)
}

function requirePositiveInt(value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new TypeError(
      'kitty graphics: an id, cell count or pixel size must be a positive integer within its range',
    )
  }
}

function sgrForId(id: number): string {
  requirePositiveInt(id, ID_MAX)
  if (id < SMALL_ID_LIMIT) return `${CSI}38;5;${id}m`
  const red = (id >>> RED_SHIFT) & RGB_MASK
  const green = (id >>> GREEN_SHIFT) & RGB_MASK
  const blue = id & RGB_MASK
  return `${CSI}38;2;${red};${green};${blue}m`
}

function markRun(count: number): string[] {
  return KITTY_MARKS.slice(0, count).map(code => String.fromCodePoint(code))
}

/**
 * densable `Pqr(id, columns, rows)` — unicode placeholder cells.
 * Falls back to a same-size blank grid when the mark table cannot cover the box.
 */
export function kittyPlaceholderGrid(
  id: number,
  columns: number,
  rows: number,
): string {
  if (
    columns < 1 ||
    rows < 1 ||
    columns > KITTY_MARKS.length ||
    rows > KITTY_MARKS.length
  ) {
    return Array.from({ length: Math.max(0, rows) }, () =>
      ' '.repeat(Math.max(0, columns)),
    ).join('\n')
  }
  const color = sgrForId(id)
  const colMarks = markRun(columns)
  const rowMarks = markRun(rows)
  const reset = `${CSI}39m`
  return rowMarks
    .map(
      rowMark =>
        color +
        colMarks.map(colMark => PLACEHOLDER + rowMark + colMark).join('') +
        reset,
    )
    .join('\n')
}

function apcFrame(params: string, payload?: string): string {
  const extra = payload === undefined ? '' : `;${payload}`
  return `${APC_G}${params}${extra}${ST}`
}

type WireSource =
  | { format: 'png'; base64: string }
  | { format: 'rgba' | 'rgb'; base64: string; width: number; height: number }
  | {
      medium: 'file' | 'shm'
      name: string
      format: 'png' | 'rgba' | 'rgb'
      width?: number
      height?: number
    }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

/** densable `Xoo` — ImageSource → kitty payload. */
function wireSource(source: unknown): WireSource | undefined {
  const rec = asRecord(source)
  if (rec === undefined) return undefined
  if (typeof rec.png === 'string') {
    return { format: 'png', base64: rec.png }
  }
  if (typeof rec.rgba === 'string') {
    const width = rec.width
    const height = rec.height
    if (typeof width !== 'number' || typeof height !== 'number')
      return undefined
    return { format: 'rgba', base64: rec.rgba, width, height }
  }
  const medium = Object.hasOwn(rec, 'shm') ? 'shm' : 'file'
  const name = medium === 'shm' ? rec.shm : rec.file
  if (typeof name !== 'string' || name === '') return undefined
  const format = rec.format
  if (format !== 'png' && format !== 'rgba' && format !== 'rgb')
    return undefined
  if (format === 'png') return { medium, name, format }
  const width = rec.width
  const height = rec.height
  if (typeof width !== 'number' || typeof height !== 'number') return undefined
  return { medium, name, format, width, height }
}

/** densable `Iqr` — APC transmit (`a=T,U=1`, png `f=100`, placement `c`/`r`). */
export function encodeKittyTransmit(
  id: number,
  source: unknown,
  columns: number,
  rows: number,
): string | undefined {
  const wired = wireSource(source)
  if (wired === undefined) return undefined
  requirePositiveInt(id, ID_MAX)
  requirePositiveInt(columns, KITTY_MARKS.length)
  requirePositiveInt(rows, KITTY_MARKS.length)
  const sizeCtrl =
    wired.format !== 'png' && 'width' in wired && wired.width !== undefined
      ? `,s=${wired.width},v=${wired.height}`
      : ''
  const formatCtrl = `${FORMAT_CTRL[wired.format] ?? 'f=100'}${sizeCtrl}`
  const place = `i=${id},c=${columns},r=${rows}`
  if ('medium' in wired) {
    const mediumCtrl = MEDIUM_CTRL[wired.medium]
    const nameB64 = Buffer.from(wired.name, 'utf8').toString('base64')
    return apcFrame(`a=T,U=1,q=1,${formatCtrl},${mediumCtrl},${place}`, nameB64)
  }
  const payload = wired.base64
  const head = `a=T,U=1,q=2,${formatCtrl},${place}`
  if (payload.length <= PAYLOAD_CHUNK) return apcFrame(head, payload)
  const frames: string[] = []
  for (let at = 0; at < payload.length; at += PAYLOAD_CHUNK) {
    const last = at + PAYLOAD_CHUNK >= payload.length
    const more = last ? 'm=0' : 'm=1'
    const params = at === 0 ? `${head},${more}` : `${more},q=2`
    frames.push(apcFrame(params, payload.slice(at, at + PAYLOAD_CHUNK)))
  }
  return frames.join('')
}

/**
 * densable `images.transmit`. Returns false when the sink refuses (gold
 * swap string: "the terminal sink refused the source").
 */
export function transmitKittyImage(
  id: number,
  source: unknown,
  columns: number,
  rows: number,
): boolean {
  try {
    const sequence = encodeKittyTransmit(id, source, columns, rows)
    if (sequence === undefined) return false
    process.stdout.write(sequence)
    return true
  } catch {
    return false
  }
}

export const KITTY_SINK_REFUSED = 'the terminal sink refused the source'
