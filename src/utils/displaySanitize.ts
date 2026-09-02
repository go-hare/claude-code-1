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
