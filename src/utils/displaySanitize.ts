/**
 * densable a0 / M$ display sanitizer (2.1.239).
 *
 * Wwe / GPi / _g / __p / $ci / cAv. Used by $bn aJ0 (`_g(e)!==e`).
 * $ci ANSI tokenizer (_Nt) is unused here: ESC is already FFFD in __p.
 */
import { stringWidth } from '@anthropic/ink'
import {
  isBidiControlCode,
  isHiddenControlCode,
  isLoneSurrogateCode,
} from './controlChars.js'
import { getGraphemeSegmenter } from './intl.js'

const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u
const FORMAT_CHAR = /\p{Cf}/u

/** densable Szn / rAv / nAv / uIa / aAv / lAv / Q0v */
const LINE_CHAR_CAP = 4096
const LINE_SOFT_CAP = 4064
const TAB_WIDTH = 8
const HARD_SLICE = 1024
const PRIMARY_BUDGET = 4 * LINE_CHAR_CAP * LINE_CHAR_CAP
const FALLBACK_BUDGET = 64 * HARD_SLICE * HARD_SLICE
const GRAPHEME_SUFFIX = /\u2026 \[\+\d+ graphemes\]$/
const GRAPHEME_ONLY = /^\u2026 \[\+\d+ graphemes\]$/

function graphemesOf(text: string): Intl.SegmentData[] {
  return [...getGraphemeSegmenter().segment(text)]
}

/** densable GPi */
export function isGpiChar(ch: string, cp: number): boolean {
  return (
    DEFAULT_IGNORABLE.test(ch) ||
    ch === '\u2028' ||
    ch === '\u2029' ||
    ch === '\u2800' ||
    (cp >= 0xd800 && cp <= 0xdfff) ||
    FORMAT_CHAR.test(ch)
  )
}

/** densable Wwe */
export function hasWweChars(text: string): boolean {
  for (const ch of text) {
    if (isGpiChar(ch, ch.codePointAt(0) ?? 0)) return true
  }
  return false
}

/** densable eAv */
function isVariationSelector(cp: number): boolean {
  return cp === 0xfe0e || cp === 0xfe0f
}

/** densable $ci without _Nt — tab stops via stringWidth. */
export function expandTabs(text: string, tabWidth = TAB_WIDTH): string {
  if (!text.includes('\t')) return text
  let out = ''
  let col = 0
  for (const part of text.split(/(\t|\n)/)) {
    if (part === '\t') {
      const pad = tabWidth - (col % tabWidth)
      out += ' '.repeat(pad)
      col += pad
    } else if (part === '\n') {
      out += part
      col = 0
    } else {
      out += part
      col += stringWidth(part)
    }
  }
  return out
}

/** densable h_p */
function graphemeDisplayWidth(segment: string): number {
  const cp = segment.codePointAt(0)
  if (segment.length === 1 && cp !== undefined) {
    if (cp <= 31) return 0
    if (isBidiControlCode(cp)) return 1
  }
  const width = stringWidth(segment)
  return width === 0 ? 0 : width === 1 ? 1 : width
}

/** densable d_p */
function widthsMatchGraphemes(text: string): boolean {
  let prefix = ''
  let prev = 0
  for (const { segment } of graphemesOf(text)) {
    prefix += segment
    const next = stringWidth(prefix)
    if (next - prev !== graphemeDisplayWidth(segment)) return false
    prev = next
  }
  return true
}

/** densable oAv */
function replaceMismatchedGraphemes(text: string): string {
  let out = ''
  let run = ''
  let prev = 0
  for (const { segment } of graphemesOf(text)) {
    run += segment
    const next = stringWidth(run)
    const delta = next - prev
    prev = next
    out += delta === graphemeDisplayWidth(segment) ? segment : '\uFFFD'
  }
  return out
}

/** densable p_p */
function stabilizeWidths(text: string): string {
  let cur = text
  for (let i = 0; i < 16; i++) {
    if (widthsMatchGraphemes(cur)) return cur
    const next = replaceMismatchedGraphemes(cur)
    if (next === cur) break
    cur = next
  }
  if (widthsMatchGraphemes(cur)) return cur
  return graphemesOf(cur)
    .map(() => '\uFFFD')
    .join('')
}

/** densable iAv */
function sliceGraphemes(text: string, maxChars: number): string {
  let out = ''
  for (const { segment } of graphemesOf(text)) {
    if (out.length + segment.length > maxChars) break
    out += segment
  }
  return out
}

/** densable y_p */
function sliceDisplay(text: string, maxChars: number): string {
  const sliced = sliceGraphemes(text, maxChars)
  if (sliced.length > 0) return sliced
  let n = Math.min(maxChars, text.length)
  const last = text.charCodeAt(n - 1)
  if (last >= 0xd800 && last <= 0xdbff) n -= 1
  return text.slice(0, n)
}

function graphemeCount(text: string): number {
  return graphemesOf(text).length
}

function plusGraphemes(count: number): string {
  return `\u2026 [+${count} graphemes]`
}

/** densable cAv */
export function capDisplayGraphemes(text: string): string {
  let primary = PRIMARY_BUDGET
  let fallback = FALLBACK_BUDGET
  return text
    .split('\n')
    .map(line => {
      if (line === '') return line
      if (GRAPHEME_ONLY.test(line)) return line
      const suffixMatch = line.match(GRAPHEME_SUFFIX)
      const suffix = suffixMatch ? suffixMatch[0] : ''
      const body = suffixMatch
        ? line.slice(0, line.length - suffix.length)
        : line
      const overflow = body.length > LINE_CHAR_CAP
      const kept = overflow ? sliceDisplay(body, LINE_SOFT_CAP) : body
      const extra = overflow
        ? plusGraphemes(graphemeCount(body.slice(kept.length)))
        : ''
      const cost = (kept.length + extra.length + suffix.length) ** 2
      if (cost <= primary) {
        primary -= cost
        return stabilizeWidths(kept) + extra + suffix
      }
      const hard = sliceDisplay(body, HARD_SLICE)
      const hardExtra =
        hard.length < body.length
          ? plusGraphemes(graphemeCount(body.slice(hard.length)))
          : ''
      const hardCost = (hard.length + hardExtra.length + suffix.length) ** 2
      if (hard.length > 0 && hardCost <= fallback) {
        fallback -= hardCost
        return stabilizeWidths(hard) + hardExtra + suffix
      }
      return plusGraphemes(graphemeCount(body)) + suffix
    })
    .join('\n')
}

/** densable __p */
export function sanitizeDisplayTextInner(text: string, cap: boolean): string {
  let cleaned = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (isVariationSelector(cp)) continue
    cleaned +=
      isHiddenControlCode(cp) ||
      isBidiControlCode(cp) ||
      isLoneSurrogateCode(cp)
        ? '\uFFFD'
        : ch
  }
  const expanded = expandTabs(cleaned)
  return cap ? capDisplayGraphemes(expanded) : expanded
}

/** densable _g */
export function sanitizeDisplayText(text: string): string {
  return sanitizeDisplayTextInner(text, true)
}

/** densable aJ0 `_g(e)!==e` */
export function displaySanitizeChanged(text: string): boolean {
  return sanitizeDisplayText(text) !== text
}

/** densable WP — chunk size when soft-wrapping lines > LINE_CHAR_CAP (4096). */
const SOFT_WRAP_CHUNK_CAP = 256

/**
 * densable ROa — split lines exceeding LINE_CHAR_CAP (4096) into <=256-char
 * grapheme-safe chunks joined by `\n` so terminal soft-wrap does not stall.
 */
export function softWrapLongLines(text: string): string {
  if (text.length <= LINE_CHAR_CAP) return text
  const segmenter = getGraphemeSegmenter()
  return text
    .split('\n')
    .map(line => {
      if (line.length <= LINE_CHAR_CAP) return line
      const chunks: string[] = []
      let cur = ''
      for (const { segment } of segmenter.segment(line)) {
        if (
          cur.length > 0 &&
          cur.length + segment.length > SOFT_WRAP_CHUNK_CAP
        ) {
          chunks.push(cur)
          cur = segment
        } else {
          cur += segment
        }
      }
      if (cur.length > 0) chunks.push(cur)
      return chunks.join('\n')
    })
    .join('\n')
}

/** densable ba — replace line/paragraph separators with U+FFFD for single-line display. */
export function sanitizeNewlinesForDisplay(text: string): string {
  return text.replace(/[\n\r\u2028\u2029]/g, '\uFFFD')
}

/** densable pz — strip Cc/Cf/Cs/Zl/Zp control/format/surrogate/separator chars. */
export function stripControlChars(text: unknown): string {
  return typeof text === 'string'
    ? text.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, '')
    : ''
}

/** densable Pkt — strip Cc/Cf/Cs/Zl/Zp except `\n` and `\t`. */
export function stripControlCharsKeepWhitespace(text: unknown): string {
  return typeof text === 'string'
    ? text.replace(/(?![\n\t])[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, '')
    : ''
}

// --- densable eui / pe / ce — O(n) combining-mark run guard for normalize() ---

const EXTRA_COMBINING_MARKS =
  '\\u05C8\\u05C9\\u1ADE\\u1ADF\\u1AEC-\\u1AF0\\u{10ECB}-\\u{10ECF}\\u{10EF0}-\\u{10EF9}\\u{1D127}\\u{1D128}\\u{1D250}-\\u{1D252}\\u{1D25B}\\u{1D25C}\\u{1D25F}\\u{1D280}\\u{1D281}'
const COMBINING_MARK_CLASS = `[\\p{M}\\uFF9E\\uFF9F${EXTRA_COMBINING_MARKS}]`
/** densable ce */
const COMBINING_RUN_RE = new RegExp(`${COMBINING_MARK_CLASS}{32,}`, 'gu')
/** densable le */
const SINGLE_COMBINING_RE = new RegExp(COMBINING_MARK_CLASS, 'u')

type CombiningOrderEntry = { order: number; sample: string }
const cccOrderCache = new Map<number, CombiningOrderEntry | null>()
const cccOrderTable: CombiningOrderEntry[] = []
const nfkdCache = new Map<number, number[]>()

function reordersBefore(a: string, b: string): boolean {
  return a !== b && (a + b).normalize('NFD') === b + a
}

function getCombiningOrder(cp: number): CombiningOrderEntry | null {
  const cached = cccOrderCache.get(cp)
  if (cached !== undefined) return cached
  const ch = String.fromCodePoint(cp)
  let entry: CombiningOrderEntry | null = null
  if (
    ch === '\u0334' ||
    reordersBefore(ch, '\u0334') ||
    reordersBefore('\u0345', ch)
  ) {
    let lo = 0
    let hi = cccOrderTable.length
    while (lo < hi && entry === null) {
      const mid = (lo + hi) >> 1
      const probe = cccOrderTable[mid]!
      if (reordersBefore(ch, probe.sample)) lo = mid + 1
      else if (reordersBefore(probe.sample, ch)) hi = mid
      else entry = probe
    }
    if (entry === null) {
      entry = { order: lo, sample: ch }
      cccOrderTable.splice(lo, 0, entry)
      for (let i = lo + 1; i < cccOrderTable.length; i++) {
        cccOrderTable[i]!.order = i
      }
    }
  }
  cccOrderCache.set(cp, entry)
  return entry
}

function getNfkdCodePoints(cp: number): number[] {
  let cached = nfkdCache.get(cp)
  if (cached === undefined) {
    cached = Array.from(
      String.fromCodePoint(cp).normalize('NFKD'),
      c => c.codePointAt(0)!,
    )
    nfkdCache.set(cp, cached)
  }
  return cached
}

const CODE_POINT_CHUNK = 4096
function fromCodePointsChunked(buf: Int32Array, len: number): string {
  let out = ''
  for (let i = 0; i < len; i += CODE_POINT_CHUNK) {
    out += String.fromCodePoint(
      ...buf.subarray(i, Math.min(i + CODE_POINT_CHUNK, len)),
    )
  }
  return out
}

/** densable pe — O(n) canonical-order sort for long combining-mark runs. */
function sortCombiningRun(run: string): string {
  let buf = new Int32Array(run.length + 16)
  let len = 0
  for (let i = 0; i < run.length; ) {
    const cp = run.codePointAt(i)!
    i += cp > 0xffff ? 2 : 1
    for (const expanded of getNfkdCodePoints(cp)) {
      if (len === buf.length) {
        const grown = new Int32Array(buf.length * 2)
        grown.set(buf)
        buf = grown
      }
      buf[len++] = expanded
      getCombiningOrder(expanded)
    }
  }
  const orders = new Int16Array(len)
  for (let i = 0; i < len; i++) {
    orders[i] = cccOrderCache.get(buf[i]!)?.order ?? -1
  }
  const sorted = buf.slice(0, len)
  const counts = new Int32Array(cccOrderTable.length)
  for (let i = 0; i < len; ) {
    let end = i
    let alreadySorted = true
    while (end < len && orders[end]! >= 0) {
      alreadySorted &&= end === i || orders[end - 1]! <= orders[end]!
      end++
    }
    if (alreadySorted) {
      i = end + 1
      continue
    }
    counts.fill(0)
    for (let k = i; k < end; k++) counts[orders[k]!]!++
    let offset = i
    for (let k = 0; k < counts.length; k++) {
      const c = counts[k]!
      counts[k] = offset
      offset += c
    }
    for (let k = i; k < end; k++) {
      sorted[counts[orders[k]!]!++] = buf[k]!
    }
    i = end
  }
  return fromCodePointsChunked(sorted, len)
}

/** densable eui — pre-sort combining runs >= 32 chars before normalize(). */
export function guardCombiningRuns(text: string): string {
  return text.length < 32
    ? text
    : text.replace(COMBINING_RUN_RE, sortCombiningRun)
}

const NORMALIZE_CHUNK = 128
function isStarterCodePoint(cp: number): boolean {
  if (cp < 0x300) return true
  const cached = nfkdCache.get(cp)
  if (
    cached === undefined &&
    !SINGLE_COMBINING_RE.test(String.fromCodePoint(cp))
  ) {
    return true
  }
  return getCombiningOrder((cached ?? getNfkdCodePoints(cp))[0]!) === null
}

function findNextStarter(text: string, from: number): number {
  let i = from
  if (
    i < text.length &&
    (text.charCodeAt(i) & 0xfc00) === 0xdc00 &&
    (text.charCodeAt(i - 1) & 0xfc00) === 0xd800
  ) {
    i++
  }
  while (i < text.length) {
    const cp = text.codePointAt(i)!
    if (isStarterCodePoint(cp)) break
    i += cp > 0xffff ? 2 : 1
  }
  return Math.min(i, text.length)
}

function findLastStarter(text: string): number {
  let i = text.length
  while (i > 0) {
    i--
    if (
      i > 0 &&
      (text.charCodeAt(i) & 0xfc00) === 0xdc00 &&
      (text.charCodeAt(i - 1) & 0xfc00) === 0xd800
    ) {
      i--
    }
    if (isStarterCodePoint(text.codePointAt(i)!)) return i
  }
  return 0
}

/** densable V — chunked NFKC/NFKD normalization guarded by eui. */
function safeNormalize(text: string, form: 'NFKC' | 'NFKD'): string {
  const guarded = guardCombiningRuns(text)
  if (guarded.length <= NORMALIZE_CHUNK) return guarded.normalize(form)
  const parts: string[] = []
  let carry = ''
  for (let i = 0; i < guarded.length; ) {
    const next = findNextStarter(guarded, i + NORMALIZE_CHUNK)
    const normalized = (carry + guarded.slice(i, next)).normalize(form)
    const split =
      next === guarded.length ? normalized.length : findLastStarter(normalized)
    parts.push(normalized.slice(0, split))
    carry = normalized.slice(split)
    i = next
  }
  return parts.join('')
}

/** densable A6 */
export function safeNormalizeNFKC(text: string): string {
  return safeNormalize(text, 'NFKC')
}

/** densable lUa */
export function safeNormalizeNFKD(text: string): string {
  return safeNormalize(text, 'NFKD')
}
