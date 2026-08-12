/**
 * densable 2.1.227 slash-menu match ranges (Zsm + tam).
 *
 * - Lowercase index match; if toLowerCase changes string length (emoji /
 *   accented edge cases), return no ranges so glyphs stay intact.
 * - Prefer contiguous substring; else sequential per-char fuzzy ranges.
 * - When text has code points outside BMP/BMP-adjacent printable range
 *   (`/[^ -˿]/`), expand ranges to grapheme boundaries via
 *   Intl.Segmenter so highlight slices never split a glyph.
 */
import { getGraphemeSegmenter } from '../intl.js'

export type MatchRange = [start: number, end: number]

/** densable UgT — `/[^ -˿]/` (outside basic latin…spacing modifiers). */
const NEEDS_GRAPHEME_EXPAND = /[^ -˿]/

/**
 * densable `tam` — expand match ranges to grapheme boundaries when needed.
 */
export function expandMatchRangesToGraphemes(
  text: string,
  ranges: MatchRange[],
): MatchRange[] {
  if (ranges.length === 0 || !NEEDS_GRAPHEME_EXPAND.test(text)) {
    return ranges
  }
  const boundaries = new Set<number>()
  for (const { index } of getGraphemeSegmenter().segment(text)) {
    boundaries.add(index)
  }
  const expanded: MatchRange[] = []
  for (const [start, end] of ranges) {
    let s = start
    while (s > 0 && !boundaries.has(s)) s--
    let e = end
    while (e < text.length && !boundaries.has(e)) e++
    const last = expanded.at(-1)
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e)
    } else {
      expanded.push([s, e])
    }
  }
  return expanded
}

/**
 * densable `Zsm` — find match ranges of `query` inside `text`.
 * @param contiguousOnly when true, only contiguous substring (description path)
 */
export function findQueryMatchRanges(
  text: string,
  query: string,
  contiguousOnly = false,
): MatchRange[] {
  if (!query) return []
  const lower = text.toLowerCase()
  // densable: if lowercasing changes length, skip highlight (emoji/accent safety)
  if (lower.length !== text.length) return []

  const contiguous = lower.indexOf(query)
  if (contiguous !== -1) {
    return expandMatchRangesToGraphemes(text, [
      [contiguous, contiguous + query.length],
    ])
  }
  if (contiguousOnly) return []

  const ranges: MatchRange[] = []
  let cursor = 0
  for (const ch of query) {
    const at = lower.indexOf(ch, cursor)
    if (at === -1) return []
    const end = at + ch.length
    const last = ranges.at(-1)
    if (last && last[1] === at) {
      last[1] = end
    } else {
      ranges.push([at, end])
    }
    cursor = end
  }
  return expandMatchRangesToGraphemes(text, ranges)
}
