/**
 * densable 2.1.248 #36 — DM / peer @ typeahead query (official `bP` + `Bn=dr(...)`).
 *
 * Official gme: `match(bP)` then `Bn=dr(jn[2]??"")`, names via `dr(name).startsWith(Bn)`.
 * Ejn itself does not fold `t` — the caller already folded.
 */
import { normalizeSessionNameKey } from './sessionNameUniqueness.js'

/**
 * Official `bP` @202917073.
 * Boundary: start / whitespace / CJK punct 。、？！
 * Capture: letters, numbers, combining marks, ZWNJ/ZWJ, `_` / `-`.
 */
export const DM_AT_MENTION_RE =
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: official bP @202917073 includes ZWNJ/ZWJ in the class
  /(^|[\s\u3002\u3001\uFF1F\uFF01])@([\p{L}\p{N}\p{M}\u200C\u200D_-]*)$/u

/** Official `Bn=dr(jn[2]??"")`. `null` when `bP` does not match. */
export function foldDmAtMentionQuery(text: string): string | null {
  const m = text.match(DM_AT_MENTION_RE)
  if (!m) return null
  return normalizeSessionNameKey(m[2] ?? '')
}

/** Official `dr(name).startsWith(Bn)` — `foldedQuery` is already `dr`'d. */
export function mentionNameMatchesFoldedQuery(
  name: string,
  foldedQuery: string,
): boolean {
  return normalizeSessionNameKey(name).startsWith(foldedQuery)
}
