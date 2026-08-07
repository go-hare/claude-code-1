/**
 * densable 2.1.217 emoji shortcode helpers (`OtS` / `NtS` / `bZo` / `LtS=20`).
 * Map extracted 1:1 from densable `bZo={...}` (1567 shortcodes).
 */
import shortcodes from './shortcodes.json'

export type EmojiSuggestion = {
  id: string
  displayText: string
  description: string
}

/** densable `LtS` — max typeahead results. */
export const EMOJI_SUGGESTION_LIMIT = 20

/** densable `LGa` — incomplete shortcode typeahead (`:na` …). Min 2 body chars. */
export const EMOJI_PARTIAL_RE = /(^|\s):([a-z0-9_+-]{2,})$/

/** densable `WtS` — complete `:name:` for inline replacement. */
export const EMOJI_COMPLETE_RE = /(^|\s):([a-z0-9_+-]+):$/

const emojiMap = shortcodes as Record<string, string>
const shortcodeKeys = Object.keys(emojiMap)

/** densable `OtS` / `getEmoji`. */
export function getEmoji(shortcode: string): string | undefined {
  return emojiMap[shortcode]
}

/**
 * densable `NtS` / `getEmojiSuggestions`:
 * filter includes query → sort startsWith first, then shorter name → slice LtS.
 */
export function getEmojiSuggestions(query: string): EmojiSuggestion[] {
  const t = query.toLowerCase()
  const matches = shortcodeKeys.filter(n => n.includes(t))
  matches.sort((n, o) => {
    const i = n.startsWith(t) ? 0 : 1
    const s = o.startsWith(t) ? 0 : 1
    return i - s || n.length - o.length
  })
  return matches.slice(0, EMOJI_SUGGESTION_LIMIT).map(n => ({
    id: `emoji:${n}`,
    displayText: emojiMap[n]!,
    description: `:${n}:`,
  }))
}

/**
 * densable `GtS(current, previous, cursor)` — true when user just completed a
 * shortcode by typing characters that make the slice before cursor end with `:`
 * and the only growth vs previous is that shortcode body+colon.
 */
export function isEmojiJustCompleted(
  current: string,
  previous: string | undefined,
  cursor: number,
): boolean {
  if (previous === undefined) return false
  const n = current.length - previous.length
  const o = cursor - n
  return (
    n > 0 &&
    o >= 0 &&
    current.slice(0, o) + current.slice(cursor) === previous &&
    /^[a-z0-9_+-]*:$/.test(current.slice(o, cursor))
  )
}
