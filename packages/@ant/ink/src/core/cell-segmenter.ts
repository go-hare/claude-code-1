/**
 * Official 2.1.328 `TFn` / `ku` — CellSegmenter factory and pure-JS fallback.
 *
 * When running on Anthropic's internal Bun build (`Bun.ant.CellSegmenter`),
 * instantiates the native segmenter directly with identical options.
 * On public Bun 1.3.11 and Node.js, provides `JsCellSegmenter` implementing
 * the exact official `CellSegmenter` interface:
 *   - `graphemes`, `sgrKeys`, `sgrCloseKeys`, `uris`
 *   - `segment(text, cells, runs, reorderBidi)`
 *   - `paint(screenCells, screenWidth, x, y, cells, count, clipX, charMap, runWords)`
 */

import bidiFactory from 'bidi-js'
import emojiRegex from 'emoji-regex'
import { eastAsianWidth } from 'get-east-asian-width'
import {
  computeGraphemeExtraWidth,
  needsWidthCalibration,
} from './stringWidth.js'
import { getGraphemeSegmenter } from './utils/grapheme.js'

/** Official 2.1.328 `L$t` — native intern table reset cap. */
export const CELL_SEGMENTER_TABLE_CAP = 16384

/** Official 2.1.328 `R_t` — ALM + bidi embeddings/overrides/isolates. */
export const BIDI_SUBSTITUTE_RANGES: readonly (readonly [number, number])[] =
  Object.freeze([
    [1564, 1564],
    [8234, 8238],
    [8294, 8297],
  ] as const)

/** Official 2.1.328 `m$e` — default tab stop interval. */
export const DEFAULT_TAB_WIDTH = 8

/** Cell metadata bit layout matching official `bm` (`kv = 10, Es = 255, ym = 256`). */
export const CELL_RUN_SHIFT = 10
export const CELL_WIDTH_MASK = 255
export const CELL_TAB_FLAG = 256

/** Official `ku` screen configuration passed to `Bun.ant.CellSegmenter`. */
export type CellSegmenterScreenConfig = {
  readonly widthMask: number
  readonly narrow: number
  readonly wide: number
  readonly spacerTail: number
  readonly spacerHead: number
  readonly emptyCharIndex: number
  readonly spacerCharIndex: number
  readonly emptyWord: number
  readonly tabWidth: number
}

export type CellSegmenterOptions = {
  readonly ambiguousIsNarrow: boolean
  readonly substitute: readonly (readonly [number, number])[]
  readonly screen?: CellSegmenterScreenConfig
}

export interface CellSegmenter {
  readonly graphemes: string[]
  readonly sgrKeys: string[]
  readonly sgrCloseKeys: string[]
  readonly uris: string[]
  segment(
    text: string,
    cells: Int32Array,
    runs: Int32Array,
    reorderBidi: boolean,
  ): number
  paint(
    screenCells: Int32Array,
    screenWidth: number,
    x: number,
    y: number,
    cells: Int32Array,
    count: number,
    clipX: number | undefined,
    charMap: Int32Array,
    runWords: Int32Array,
  ): number
}

type BunAntCellSegmenterCtor = new (
  options: CellSegmenterOptions,
) => CellSegmenter

type GlobalWithBunAnt = typeof globalThis & {
  Bun?: {
    ant?: {
      CellSegmenter?: BunAntCellSegmenterCtor
    }
    stringWidth?: (
      str: string,
      opts?: { ambiguousIsNarrow?: boolean },
    ) => number
  }
}

type BidiInstance = {
  getEmbeddingLevels: (
    text: string,
    defaultDirection?: string,
  ) => { paragraphLevel?: number; levels: Uint8Array }
}

const DEFAULT_SCREEN_CONFIG: CellSegmenterScreenConfig = {
  widthMask: 3,
  narrow: 0,
  wide: 1,
  spacerTail: 2,
  spacerHead: 3,
  emptyCharIndex: 0,
  spacerCharIndex: 1,
  emptyWord: 0,
  tabWidth: DEFAULT_TAB_WIDTH,
}

const EMOJI_RE = emojiRegex()
const RTL_OR_RLM_RE =
  /[\u0590-\u05FF\uFB1D-\uFB4F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0780-\u07BF\u0700-\u074F\u200F]/u

const BUN_SW_OPTS = { ambiguousIsNarrow: true } as const

let cachedBidi: BidiInstance | undefined

function getBidi(): BidiInstance {
  if (!cachedBidi) {
    cachedBidi = (bidiFactory as unknown as () => BidiInstance)()
  }
  return cachedBidi
}

function getBunStringWidth():
  | ((str: string, opts?: { ambiguousIsNarrow?: boolean }) => number)
  | undefined {
  const bunObj = (globalThis as GlobalWithBunAnt).Bun
  return typeof bunObj?.stringWidth === 'function'
    ? bunObj.stringWidth
    : undefined
}

function isZeroWidthCodePoint(codePoint: number): boolean {
  if (codePoint >= 0x20 && codePoint < 0x7f) return false
  if (codePoint >= 0xa0 && codePoint < 0x0300) return codePoint === 0x00ad
  if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true
  if (
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    codePoint === 0xfeff ||
    (codePoint >= 0x2060 && codePoint <= 0x2064)
  ) {
    return true
  }
  if (
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  ) {
    return true
  }
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  ) {
    return true
  }
  if (codePoint >= 0x0900 && codePoint <= 0x0d4f) {
    const offset = codePoint & 0x7f
    if (offset <= 0x03) return true
    if (offset >= 0x3a && offset <= 0x4f) return true
    if (offset >= 0x51 && offset <= 0x57) return true
    if (offset >= 0x62 && offset <= 0x63) return true
  }
  if (
    codePoint === 0x0e31 ||
    (codePoint >= 0x0e34 && codePoint <= 0x0e3a) ||
    (codePoint >= 0x0e47 && codePoint <= 0x0e4e) ||
    codePoint === 0x0eb1 ||
    (codePoint >= 0x0eb4 && codePoint <= 0x0ebc) ||
    (codePoint >= 0x0ec8 && codePoint <= 0x0ecd)
  ) {
    return true
  }
  if (
    (codePoint >= 0x0600 && codePoint <= 0x0605) ||
    codePoint === 0x06dd ||
    codePoint === 0x070f ||
    codePoint === 0x08e2
  ) {
    return true
  }
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return true
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return true
  return false
}

/**
 * Uncalibrated base grapheme width (matches `Bun.stringWidth(g, { ambiguousIsNarrow: true })`,
 * i.e. official `d_o`). `LineCells.segment()` applies `computeGraphemeExtraWidth` (`nFi`)
 * on top when `needsWidthCalibration(text)` (`Lsn`) is true — never double-counted.
 */
function baseGraphemeWidth(
  grapheme: string,
  ambiguousIsNarrow: boolean,
): number {
  const bunSw = getBunStringWidth()
  if (bunSw && ambiguousIsNarrow) {
    return bunSw(grapheme, BUN_SW_OPTS)
  }
  if (grapheme.length === 1) {
    const code = grapheme.charCodeAt(0)
    if (code >= 0x20 && code < 0x7f) return 1
    if (isZeroWidthCodePoint(code)) return 0
    return eastAsianWidth(code, { ambiguousAsWide: !ambiguousIsNarrow })
  }
  EMOJI_RE.lastIndex = 0
  if (EMOJI_RE.test(grapheme)) {
    const first = grapheme.codePointAt(0)!
    if (first >= 0x1f1e6 && first <= 0x1f1ff) {
      let count = 0
      for (const _ of grapheme) count++
      return count === 1 ? 1 : 2
    }
    if (grapheme.length === 2) {
      const second = grapheme.codePointAt(1)
      if (
        second === 0xfe0f &&
        ((first >= 0x30 && first <= 0x39) || first === 0x23 || first === 0x2a)
      ) {
        return 1
      }
    }
    return 2
  }
  for (const ch of grapheme) {
    const cp = ch.codePointAt(0)!
    if (!isZeroWidthCodePoint(cp)) {
      return eastAsianWidth(cp, { ambiguousAsWide: !ambiguousIsNarrow })
    }
  }
  return 0
}

function lastGraphemeOf(text: string): string {
  // Scan back to a guaranteed grapheme boundary (two adjacent printable ASCII chars,
  // or index 0) so we avoid segmenting long preceding spans from the start.
  let start = 0
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text.charCodeAt(i)
    if (c >= 0x20 && c < 0x7f) {
      if (i === 0) {
        start = 0
        break
      }
      const prevC = text.charCodeAt(i - 1)
      if (prevC >= 0x20 && prevC < 0x7f) {
        start = i
        break
      }
    }
  }
  let last = ''
  for (const { segment } of getGraphemeSegmenter().segment(text.slice(start))) {
    last = segment
  }
  return last
}

type ActiveSgrEntry = {
  slot: number
  code: string
  endCode: string
}

function setSgrSlot(
  active: ActiveSgrEntry[],
  slot: number,
  code: string,
  endCode: string,
): void {
  for (let i = 0; i < active.length; i++) {
    if (active[i]!.slot === slot) {
      active.splice(i, 1)
      break
    }
  }
  active.push({ slot, code, endCode })
}

function removeSgrSlot(active: ActiveSgrEntry[], slot: number): void {
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i]!.slot === slot) {
      active.splice(i, 1)
    }
  }
}

function applySgrParams(paramsStr: string, active: ActiveSgrEntry[]): void {
  if (paramsStr === '') {
    active.length = 0
    return
  }
  const parts = paramsStr.split(';')
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]!
    if (raw.includes(':')) {
      const sub = raw.split(':')
      const head = Number(sub[0] || '0')
      if (head === 4) {
        const style = Number(sub[1] || '1')
        if (style === 0) removeSgrSlot(active, 4)
        else setSgrSlot(active, 4, '\x1b[4m', '\x1b[24m')
      } else if (head === 38 || head === 48 || head === 58) {
        const slot = head === 38 ? 39 : head === 48 ? 49 : 59
        const endCode = `\x1b[${slot}m`
        const mode = Number(sub[1] || '0')
        if (mode === 5 && sub.length >= 3 && sub[2] !== '') {
          const idx = Number(sub[2])
          if (Number.isInteger(idx) && idx >= 0 && idx <= 255) {
            setSgrSlot(active, slot, `\x1b[${head};5;${idx}m`, endCode)
          }
        } else if (mode === 2 && sub.length >= 5) {
          // Support both 38:2:r:g:b and 38:2:cs:r:g:b (e.g. 38:2::r:g:b)
          const off = sub.length >= 6 ? 3 : 2
          const rStr = sub[off]
          const gStr = sub[off + 1]
          const bStr = sub[off + 2]
          if (rStr !== '' && gStr !== '' && bStr !== '') {
            const r = Number(rStr)
            const g = Number(gStr)
            const b = Number(bStr)
            if (
              Number.isInteger(r) &&
              Number.isInteger(g) &&
              Number.isInteger(b) &&
              r >= 0 &&
              r <= 255 &&
              g >= 0 &&
              g <= 255 &&
              b >= 0 &&
              b <= 255
            ) {
              setSgrSlot(
                active,
                slot,
                `\x1b[${head};2;${r};${g};${b}m`,
                endCode,
              )
            }
          }
        }
      }
      continue
    }

    const n = raw === '' ? 0 : Number(raw)
    if (!Number.isInteger(n) || n < 0) continue

    if (n === 0) {
      active.length = 0
    } else if (n === 1) {
      setSgrSlot(active, 1, '\x1b[1m', '\x1b[22m')
    } else if (n === 2) {
      setSgrSlot(active, 2, '\x1b[2m', '\x1b[22m')
    } else if (n === 3) {
      setSgrSlot(active, 3, '\x1b[3m', '\x1b[23m')
    } else if (n === 4) {
      setSgrSlot(active, 4, '\x1b[4m', '\x1b[24m')
    } else if (n === 5 || n === 6) {
      setSgrSlot(active, 5, `\x1b[${n}m`, '\x1b[25m')
    } else if (n === 7) {
      setSgrSlot(active, 7, '\x1b[7m', '\x1b[27m')
    } else if (n === 8) {
      setSgrSlot(active, 8, '\x1b[8m', '\x1b[28m')
    } else if (n === 9) {
      setSgrSlot(active, 9, '\x1b[9m', '\x1b[29m')
    } else if (n === 22) {
      removeSgrSlot(active, 1)
      removeSgrSlot(active, 2)
    } else if (n === 23) {
      removeSgrSlot(active, 3)
    } else if (n === 24) {
      removeSgrSlot(active, 4)
    } else if (n === 25) {
      removeSgrSlot(active, 5)
    } else if (n === 27) {
      removeSgrSlot(active, 7)
    } else if (n === 28) {
      removeSgrSlot(active, 8)
    } else if (n === 29) {
      removeSgrSlot(active, 9)
    } else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) {
      setSgrSlot(active, 39, `\x1b[${n}m`, '\x1b[39m')
    } else if (n === 39) {
      removeSgrSlot(active, 39)
    } else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) {
      setSgrSlot(active, 49, `\x1b[${n}m`, '\x1b[49m')
    } else if (n === 49) {
      removeSgrSlot(active, 49)
    } else if (n === 53) {
      setSgrSlot(active, 53, '\x1b[53m', '\x1b[55m')
    } else if (n === 55) {
      removeSgrSlot(active, 53)
    } else if (n === 59) {
      removeSgrSlot(active, 59)
    } else if (n === 38 || n === 48 || n === 58) {
      const slot = n === 38 ? 39 : n === 48 ? 49 : 59
      const endCode = `\x1b[${slot}m`
      if (i + 1 >= parts.length) break
      const modeRaw = parts[i + 1]!
      const mode = modeRaw === '' ? -1 : Number(modeRaw)
      if (mode === 5) {
        if (i + 2 >= parts.length) {
          // Truncated 38;5 / 48;5 / 58;5 — consume rest so '5' is not misparsed as blink
          break
        }
        const idx = Number(parts[i + 2])
        if (
          parts[i + 2] !== '' &&
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx <= 255
        ) {
          setSgrSlot(active, slot, `\x1b[${n};5;${idx}m`, endCode)
        }
        i += 2
      } else if (mode === 2) {
        if (i + 4 >= parts.length) {
          // Truncated 38;2;... — consume rest so '2' is never misparsed as SGR 2 (dim)
          break
        }
        const r = Number(parts[i + 2])
        const g = Number(parts[i + 3])
        const b = Number(parts[i + 4])
        if (
          parts[i + 2] !== '' &&
          parts[i + 3] !== '' &&
          parts[i + 4] !== '' &&
          Number.isInteger(r) &&
          Number.isInteger(g) &&
          Number.isInteger(b) &&
          r >= 0 &&
          r <= 255 &&
          g >= 0 &&
          g <= 255 &&
          b >= 0 &&
          b <= 255
        ) {
          setSgrSlot(active, slot, `\x1b[${n};2;${r};${g};${b}m`, endCode)
        }
        i += 4
      } else {
        // Unsupported extended-color subcommand (e.g. 38;3;... or 38;4;...)
        break
      }
    }
  }
}

function buildSubstituteRegex(
  ranges: readonly (readonly [number, number])[],
): { testRe: RegExp; replaceRe: RegExp; hasAscii: boolean } | undefined {
  if (ranges.length === 0) return undefined
  let hasAscii = false
  const parts: string[] = []
  for (const [lo, hi] of ranges) {
    if (lo < 0x7f) hasAscii = true
    parts.push(
      `\\u{${lo.toString(16)}}${hi > lo ? `-\\u{${hi.toString(16)}}` : ''}`,
    )
  }
  const source = `[${parts.join('')}]`
  return {
    testRe: new RegExp(source, 'u'),
    replaceRe: new RegExp(source, 'gu'),
    hasAscii,
  }
}

function growScratch(
  buf: Int32Array<ArrayBuffer>,
  needed: number,
): Int32Array<ArrayBuffer> {
  if (buf.length >= needed) return buf
  const next = new Int32Array(Math.max(needed, buf.length * 2))
  next.set(buf)
  return next
}

function reverseCellRange(
  cells: Int32Array,
  levels: number[],
  start: number,
  end: number,
): void {
  let lo = start
  let hi = end
  while (lo < hi) {
    const a = lo << 1
    const b = hi << 1
    const g0 = cells[a]!
    const m0 = cells[a + 1]!
    cells[a] = cells[b]!
    cells[a + 1] = cells[b + 1]!
    cells[b] = g0
    cells[b + 1] = m0

    const lv = levels[lo]!
    levels[lo] = levels[hi]!
    levels[hi] = lv
    lo++
    hi--
  }
}

type StyledSpan = {
  text: string
  sgrIdx: number
  uriIdx: number
}

/**
 * Pure-JS fallback implementing the exact `Bun.ant.CellSegmenter` contract
 * for public Bun 1.3.11 and Node.js runtimes.
 */
export class JsCellSegmenter implements CellSegmenter {
  readonly graphemes: string[] = []
  readonly sgrKeys: string[] = ['']
  readonly sgrCloseKeys: string[] = ['']
  readonly uris: string[] = ['']

  private readonly ambiguousIsNarrow: boolean
  private readonly screen: CellSegmenterScreenConfig
  private readonly subTestRe: RegExp | undefined
  private readonly subReplaceRe: RegExp | undefined
  private readonly subHasAscii: boolean

  private readonly graphemeMap = new Map<string, number>()
  private readonly graphemeWidths: number[] = []
  private readonly asciiGraphemes = new Int32Array(128).fill(-1)
  private readonly sgrMap = new Map<string, number>([['', 0]])
  private readonly uriMap = new Map<string, number>([['', 0]])

  private scratchCells = new Int32Array(512)
  private scratchRuns = new Int32Array(512)

  constructor(options: CellSegmenterOptions) {
    this.ambiguousIsNarrow = options.ambiguousIsNarrow
    this.screen = options.screen ?? DEFAULT_SCREEN_CONFIG
    const sub = buildSubstituteRegex(options.substitute)
    this.subTestRe = sub?.testRe
    this.subReplaceRe = sub?.replaceRe
    this.subHasAscii = sub?.hasAscii ?? false
  }

  private internAsciiGrapheme(code: number): number {
    const cached = this.asciiGraphemes[code]!
    if (cached !== -1) return cached
    const ch = String.fromCharCode(code)
    const idx = this.graphemes.length
    this.graphemes.push(ch)
    this.graphemeWidths.push(1)
    this.graphemeMap.set(ch, idx)
    this.asciiGraphemes[code] = idx
    return idx
  }

  private internGrapheme(grapheme: string): { idx: number; width: number } {
    if (grapheme.length === 1) {
      const code = grapheme.charCodeAt(0)
      if (code >= 0x20 && code < 0x7f) {
        return { idx: this.internAsciiGrapheme(code), width: 1 }
      }
    }
    const existing = this.graphemeMap.get(grapheme)
    if (existing !== undefined) {
      return { idx: existing, width: this.graphemeWidths[existing]! }
    }
    const width =
      grapheme === '\t'
        ? 0
        : baseGraphemeWidth(grapheme, this.ambiguousIsNarrow)
    const idx = this.graphemes.length
    this.graphemes.push(grapheme)
    this.graphemeWidths.push(width)
    this.graphemeMap.set(grapheme, idx)
    return { idx, width }
  }

  private internSgr(active: ActiveSgrEntry[]): number {
    if (active.length === 0) return 0
    let key = active[0]!.code
    let closeKey = active[0]!.endCode
    for (let i = 1; i < active.length; i++) {
      key += `\x00${active[i]!.code}`
      closeKey += `\x00${active[i]!.endCode}`
    }
    const existing = this.sgrMap.get(key)
    if (existing !== undefined) return existing
    const idx = this.sgrKeys.length
    this.sgrKeys.push(key)
    this.sgrCloseKeys.push(closeKey)
    this.sgrMap.set(key, idx)
    return idx
  }

  private internUri(uri: string): number {
    if (uri === '') return 0
    const existing = this.uriMap.get(uri)
    if (existing !== undefined) return existing
    const idx = this.uris.length
    this.uris.push(uri)
    this.uriMap.set(uri, idx)
    return idx
  }

  private applySubstitute(text: string): string {
    if (this.subTestRe && this.subReplaceRe && this.subTestRe.test(text)) {
      return text.replace(this.subReplaceRe, '\uFFFD')
    }
    return text
  }

  private extractSpans(text: string): StyledSpan[] {
    if (!text.includes('\x1b')) {
      return [{ text: this.applySubstitute(text), sgrIdx: 0, uriIdx: 0 }]
    }

    const spans: StyledSpan[] = []
    const activeSgr: ActiveSgrEntry[] = []
    let currentSgrIdx = 0
    let currentUriIdx = 0
    let plainStart = 0
    const len = text.length

    const flushPlain = (end: number): void => {
      if (end <= plainStart) return
      const slice = this.applySubstitute(text.slice(plainStart, end))
      const prev = spans.at(-1)
      if (
        prev !== undefined &&
        prev.sgrIdx === currentSgrIdx &&
        prev.uriIdx === currentUriIdx
      ) {
        prev.text += slice
      } else {
        spans.push({
          text: slice,
          sgrIdx: currentSgrIdx,
          uriIdx: currentUriIdx,
        })
      }
    }

    let i = 0
    while (i < len) {
      if (text.charCodeAt(i) !== 0x1b) {
        i++
        continue
      }
      flushPlain(i)
      const next = i + 1 < len ? text.charCodeAt(i + 1) : -1
      if (next === 0x5b) {
        // CSI: ESC [ params(0x30..0x3F) intermediates(0x20..0x2F) final(0x40..0x7E)
        let j = i + 2
        let pureSgrParams = true
        while (j < len) {
          const c = text.charCodeAt(j)
          if (c === 0x1b) break
          if (c >= 0x40 && c <= 0x7e) break
          // Valid SGR parameter bytes are strictly 0x30..0x3b ('0'-'9', ':', ';');
          // private prefixes ('<', '=', '>', '?') and intermediates (0x20..0x2f) disqualify SGR.
          if (c < 0x30 || c > 0x3b) {
            pureSgrParams = false
          }
          j++
        }
        if (j < len && text.charCodeAt(j) === 0x1b) {
          // Unterminated CSI aborted by a new ESC — let the outer loop parse the new ESC cleanly.
          i = j
        } else if (j < len) {
          if (text.charCodeAt(j) === 0x6d && pureSgrParams) {
            // SGR ('m')
            applySgrParams(text.slice(i + 2, j), activeSgr)
            currentSgrIdx = this.internSgr(activeSgr)
          }
          i = j + 1
        } else {
          i = len
        }
      } else if (next === 0x5d) {
        // OSC: ESC ] ... (BEL or ESC \)
        let j = i + 2
        let contentEnd = len
        while (j < len) {
          const c = text.charCodeAt(j)
          if (c === 0x07) {
            contentEnd = j
            j++
            break
          }
          if (c === 0x1b && j + 1 < len && text.charCodeAt(j + 1) === 0x5c) {
            contentEnd = j
            j += 2
            break
          }
          j++
        }
        const oscBody = text.slice(i + 2, contentEnd)
        if (oscBody.startsWith('8;')) {
          const secondSep = oscBody.indexOf(';', 2)
          if (secondSep !== -1) {
            const uri = oscBody.slice(secondSep + 1)
            currentUriIdx = this.internUri(uri)
          }
        }
        i = j
      } else if (
        next === 0x28 ||
        next === 0x29 ||
        next === 0x2a ||
        next === 0x2b
      ) {
        // Charset selection: ESC ( X, ESC ) X, ESC * X, ESC + X
        i = Math.min(len, i + 3)
      } else if (
        next === 0x50 ||
        next === 0x5f ||
        next === 0x5e ||
        next === 0x58
      ) {
        // DCS / APC / PM / SOS terminated by BEL or ST
        let j = i + 2
        while (j < len) {
          const c = text.charCodeAt(j)
          if (c === 0x07) {
            j++
            break
          }
          if (c === 0x1b && j + 1 < len && text.charCodeAt(j + 1) === 0x5c) {
            j += 2
            break
          }
          j++
        }
        i = j
      } else if (next >= 0x30 && next <= 0x7e) {
        // Single-char escape sequence (ESC 7, ESC 8, ESC c, etc.)
        i = Math.min(len, i + 2)
      } else {
        i++
      }
      plainStart = i
    }
    flushPlain(len)

    // Keep grapheme clusters that cross a style boundary (combining marks,
    // ZWJ emoji chains, skin-tone modifiers, regional indicators) intact on
    // the starting span (official 2.1.323 #1989 grapheme-preserving style boundary).
    if (spans.length > 1) {
      const segmenter = getGraphemeSegmenter()
      for (let idx = 1; idx < spans.length; idx++) {
        const cur = spans[idx]!
        if (cur.text.length === 0) continue
        let prevIdx = idx - 1
        while (prevIdx >= 0 && spans[prevIdx]!.text.length === 0) prevIdx--
        if (prevIdx < 0) continue
        const prev = spans[prevIdx]!
        // Fast path: two adjacent ASCII characters (outside CR+LF) cannot merge.
        const prevLast = prev.text.charCodeAt(prev.text.length - 1)
        const curFirst = cur.text.charCodeAt(0)
        if (prevLast < 0x80 && curFirst < 0x80) continue

        const tail = lastGraphemeOf(prev.text)
        if (tail.length === 0) continue
        const probe = cur.text.length > 64 ? cur.text.slice(0, 64) : cur.text
        let joined = tail + probe
        let first = segmenter.segment(joined)[Symbol.iterator]().next()
          .value?.segment
        if (
          first &&
          first.length === joined.length &&
          probe.length < cur.text.length
        ) {
          joined = tail + cur.text
          first = segmenter.segment(joined)[Symbol.iterator]().next()
            .value?.segment
        }
        if (first && first.length > tail.length) {
          const cut = first.length - tail.length
          prev.text += cur.text.slice(0, cut)
          cur.text = cur.text.slice(cut)
        }
      }
    }

    return spans
  }

  segment(
    text: string,
    cells: Int32Array,
    runs: Int32Array,
    reorderBidi: boolean,
  ): number {
    const len = text.length
    if (len === 0) return 0

    // Fast path: pure printable ASCII without substitution ranges in ASCII
    if (!this.subHasAscii) {
      let pureAscii = true
      for (let i = 0; i < len; i++) {
        const c = text.charCodeAt(i)
        if (c < 0x20 || c >= 0x7f) {
          pureAscii = false
          break
        }
      }
      if (pureAscii) {
        if (len > cells.length >>> 1 || 1 > runs.length >>> 1) {
          return -len
        }
        runs[0] = 0
        runs[1] = 0
        for (let i = 0; i < len; i++) {
          cells[i << 1] = this.internAsciiGrapheme(text.charCodeAt(i))
          cells[(i << 1) | 1] = 1
        }
        return len
      }
    }

    const spans = this.extractSpans(text)
    let cellCount = 0
    let runCount = 0
    let lastRunSgr = -1
    let lastRunUri = -1

    let bidiPlain = ''
    const bidiCellOffsets: number[] = []
    const segmenter = getGraphemeSegmenter()

    for (let s = 0; s < spans.length; s++) {
      const span = spans[s]!
      if (span.text.length === 0) continue

      let runIdx: number
      if (
        runCount > 0 &&
        span.sgrIdx === lastRunSgr &&
        span.uriIdx === lastRunUri
      ) {
        runIdx = runCount - 1
      } else {
        runIdx = runCount++
        lastRunSgr = span.sgrIdx
        lastRunUri = span.uriIdx
        this.scratchRuns = growScratch(this.scratchRuns, runCount << 1)
        this.scratchRuns[runIdx << 1] = span.sgrIdx
        this.scratchRuns[(runIdx << 1) | 1] = span.uriIdx
      }

      const runBits = runIdx << CELL_RUN_SHIFT
      for (const { segment: grapheme } of segmenter.segment(span.text)) {
        const cp = grapheme.codePointAt(0)
        if (cp === undefined) continue

        if (cp === 0x09) {
          const { idx: gIdx } = this.internGrapheme('\t')
          const cellPos = cellCount++
          this.scratchCells = growScratch(this.scratchCells, cellCount << 1)
          this.scratchCells[cellPos << 1] = gIdx
          this.scratchCells[(cellPos << 1) | 1] = runBits | CELL_TAB_FLAG
          if (reorderBidi) {
            bidiCellOffsets.push(bidiPlain.length)
            bidiPlain += '\t'
          }
          continue
        }

        if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) {
          continue
        }

        const { idx: gIdx, width } = this.internGrapheme(grapheme)
        if (width <= 0) {
          // Preserve LRM/RLM directional marks in bidiPlain so UBA picks up
          // explicit direction prefixes (`\u200E`/`\u200F`) without emitting a cell.
          if (reorderBidi && (cp === 0x200e || cp === 0x200f)) {
            bidiPlain += grapheme
          }
          // Keep zero-base-width graphemes that gain positive display width during
          // calibration (e.g. standalone Indic spacing vowel signs like U+093E).
          // Emit with base width 0 so LineCells.segment() adds extra width without
          // double-counting.
          if (
            !needsWidthCalibration(grapheme) ||
            computeGraphemeExtraWidth(grapheme, 0) <= 0
          ) {
            continue
          }
        }

        const clampedWidth = width > CELL_WIDTH_MASK ? CELL_WIDTH_MASK : width
        const cellPos = cellCount++
        this.scratchCells = growScratch(this.scratchCells, cellCount << 1)
        this.scratchCells[cellPos << 1] = gIdx
        this.scratchCells[(cellPos << 1) | 1] = runBits | clampedWidth
        if (reorderBidi) {
          bidiCellOffsets.push(bidiPlain.length)
          bidiPlain += grapheme
        }
      }
    }

    if (cellCount === 0) return 0

    if (reorderBidi && RTL_OR_RLM_RE.test(bidiPlain)) {
      const { levels } = getBidi().getEmbeddingLevels(bidiPlain, 'auto')
      const cellLevels: number[] = new Array(cellCount)
      let maxLevel = 0
      for (let i = 0; i < cellCount; i++) {
        const lv = levels[bidiCellOffsets[i]!] ?? 0
        cellLevels[i] = lv
        if (lv > maxLevel) maxLevel = lv
      }
      for (let level = maxLevel; level >= 1; level--) {
        let i = 0
        while (i < cellCount) {
          if (cellLevels[i]! >= level) {
            let j = i + 1
            while (j < cellCount && cellLevels[j]! >= level) j++
            reverseCellRange(this.scratchCells, cellLevels, i, j - 1)
            i = j
          } else {
            i++
          }
        }
      }
    }

    const needed = Math.max(cellCount, runCount)
    if (cellCount > cells.length >>> 1 || runCount > runs.length >>> 1) {
      return -needed
    }

    cells.set(this.scratchCells.subarray(0, cellCount << 1))
    runs.set(this.scratchRuns.subarray(0, runCount << 1))
    return cellCount
  }

  paint(
    screenCells: Int32Array,
    screenWidth: number,
    x: number,
    y: number,
    cells: Int32Array,
    count: number,
    _clipX: number | undefined,
    charMap: Int32Array,
    runWords: Int32Array,
  ): number {
    const {
      widthMask,
      narrow,
      wide,
      spacerTail,
      spacerHead,
      emptyCharIndex,
      spacerCharIndex,
      emptyWord,
      tabWidth,
    } = this.screen

    const canWriteRow =
      y >= 0 &&
      screenWidth > 0 &&
      ((y + 1) * screenWidth) << 1 <= screenCells.length
    const rowBase = y * screenWidth

    let damageMin = screenWidth
    let damageMax = 0
    const expandDamage = (lo: number, hi: number): void => {
      if (lo < damageMin) damageMin = lo
      if (hi > damageMax) damageMax = hi
    }

    const clearTrailingTails = (startX: number): void => {
      let tx = startX
      while (tx < screenWidth) {
        const tCI = (rowBase + tx) << 1
        if ((screenCells[tCI + 1]! & widthMask) !== spacerTail) break
        screenCells[tCI] = emptyCharIndex
        screenCells[tCI + 1] = emptyWord
        expandDamage(tx, tx + 1)
        tx++
      }
    }

    const clearOwningWideSpan = (cx: number): void => {
      const ci = (rowBase + cx) << 1
      const prevW = screenCells[ci + 1]! & widthMask
      // Overwriting Wide (with any width, including a narrower Wide) -> clear ALL
      // trailing SpacerTails (handles w >= 3 calibrated graphemes).
      if (prevW === wide) {
        clearTrailingTails(cx + 1)
      } else if (prevW === spacerTail) {
        // Overwriting SpacerTail -> walk left to clear preceding SpacerTails and
        // owning Wide head, and walk right to clear remaining trailing SpacerTails.
        let lx = cx - 1
        while (lx >= 0) {
          const lCI = (rowBase + lx) << 1
          const lw = screenCells[lCI + 1]! & widthMask
          if (lw === spacerTail) {
            screenCells[lCI] = emptyCharIndex
            screenCells[lCI + 1] = emptyWord
            expandDamage(lx, lx + 1)
            lx--
            continue
          }
          if (lw === wide) {
            screenCells[lCI] = emptyCharIndex
            screenCells[lCI + 1] = emptyWord
            expandDamage(lx, lx + 1)
          }
          break
        }
        clearTrailingTails(cx + 1)
      }
    }

    const writeRawCell = (cx: number, charId: number, word1: number): void => {
      if (!canWriteRow || cx < 0 || cx >= screenWidth) return
      clearOwningWideSpan(cx)
      const ci = (rowBase + cx) << 1
      screenCells[ci] = charId
      screenCells[ci + 1] = word1
      expandDamage(cx, cx + 1)
    }

    let col = x
    for (let i = 0; i < count; i++) {
      if (col >= screenWidth) break
      const gIdx = cells[i << 1]!
      const meta = cells[(i << 1) | 1]!
      const runIdx = meta >>> CELL_RUN_SHIFT

      if ((meta & CELL_TAB_FLAG) !== 0) {
        const mod = ((col % tabWidth) + tabWidth) % tabWidth
        const spaces = tabWidth - mod
        for (let s = 0; s < spaces && col < screenWidth; s++) {
          writeRawCell(col, emptyCharIndex, emptyWord | narrow)
          col++
        }
        continue
      }

      const w = meta & CELL_WIDTH_MASK
      if (w === 0) continue

      if (w === 1) {
        writeRawCell(col, charMap[gIdx]!, runWords[runIdx]! | narrow)
        col++
        continue
      }

      // Wide grapheme (w >= 2) starting left of column 0: clear any visible
      // right-hand columns (0 .. col + w - 1) so stale content is not left behind.
      if (col < 0) {
        if (col + w > 0) {
          const visibleEnd = Math.min(col + w, screenWidth)
          for (let vx = 0; vx < visibleEnd; vx++) {
            writeRawCell(vx, emptyCharIndex, emptyWord | narrow)
          }
        }
        col += w
        continue
      }

      if (col + w > screenWidth) {
        while (col < screenWidth) {
          writeRawCell(col, emptyCharIndex, emptyWord | spacerHead)
          col++
        }
        break
      }

      writeRawCell(col, charMap[gIdx]!, runWords[runIdx]! | wide)
      // Fill SpacerTail cells for columns col+1 .. col+w-1 (clearing ALL trailing
      // SpacerTails of any overwritten Wide or stray SpacerTail cell).
      for (let k = 1; k < w; k++) {
        const sx = col + k
        if (canWriteRow && sx < screenWidth) {
          const sCI = (rowBase + sx) << 1
          const existingW = screenCells[sCI + 1]! & widthMask
          if (existingW === wide || existingW === spacerTail) {
            clearTrailingTails(sx + 1)
          }
          screenCells[sCI] = spacerCharIndex
          screenCells[sCI + 1] = emptyWord | spacerTail
          expandDamage(sx, sx + 1)
        }
      }
      col += w
    }

    const endCol = col < 0 ? 0 : col > 0xfffff ? 0xfffff : col
    const dMin = damageMin < damageMax ? damageMin : 0
    const dMax = damageMin < damageMax ? damageMax : 0
    return dMax * 68719476736 + dMin * 1048576 + endCol
  }
}

/**
 * Official 2.1.328 `TFn(substitute, screenConfig)` — creates native
 * `Bun.ant.CellSegmenter` when available on Anthropic's internal Bun runtime,
 * falling back seamlessly to `JsCellSegmenter` on public Bun 1.3.11 and Node.js.
 */
export function createCellSegmenter(
  substitute: readonly (readonly [number, number])[],
  screen?: CellSegmenterScreenConfig,
): CellSegmenter {
  const bunAntCtor = (globalThis as GlobalWithBunAnt).Bun?.ant?.CellSegmenter
  const options: CellSegmenterOptions = {
    ambiguousIsNarrow: true,
    substitute,
    screen,
  }
  if (typeof bunAntCtor === 'function') {
    return new bunAntCtor(options)
  }
  return new JsCellSegmenter(options)
}

/**
 * Official 2.1.328 `ku(substitute)` — builds a `CellSegmenter` configured for
 * Ink's packed `Screen` Int32 cell layout.
 */
export function createScreenCellSegmenter(
  substitute: readonly (readonly [number, number])[] = BIDI_SUBSTITUTE_RANGES,
): CellSegmenter {
  return createCellSegmenter(substitute, DEFAULT_SCREEN_CONFIG)
}
