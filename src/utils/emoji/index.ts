/**
 * densable 2.1.217 emoji shortcode helpers (`OtS` / `NtS` / `bZo` / `LtS=20`).
 * Map extracted 1:1 from densable `bZo={...}` (1567 shortcodes).
 * densable 2.1.221 — alternate shortcodes `O0m` resolve to base keys.
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

/**
 * densable 2.1.221 `O0m` — common alternate shortcodes → base map key.
 * SEA: `celebrate→tada, hundred→100, love→heart, minus_one→-1, plus_one→+1,
 * thumbs_down→-1, thumbs_up→+1, thumbsdown→-1, thumbsup→+1`.
 */
export const EMOJI_SHORTCODE_ALIASES: Readonly<Record<string, string>> = {
  celebrate: 'tada',
  hundred: '100',
  love: 'heart',
  minus_one: '-1',
  plus_one: '+1',
  thumbs_down: '-1',
  thumbs_up: '+1',
  thumbsdown: '-1',
  thumbsup: '+1',
}

const baseEmojiMap = shortcodes as Record<string, string>

/** Base shortcodes + densable 221 aliases resolved to the same glyph. */
const emojiMap: Record<string, string> = { ...baseEmojiMap }
for (const [alias, target] of Object.entries(EMOJI_SHORTCODE_ALIASES)) {
  const glyph = baseEmojiMap[target]
  if (glyph !== undefined) {
    emojiMap[alias] = glyph
  }
}
const shortcodeKeys = Object.keys(emojiMap)

/** densable `OtS` / `getEmoji`. */
export function getEmoji(shortcode: string): string | undefined {
  return emojiMap[shortcode]
}

/**
 * densable `NtS` / `getEmojiSuggestions`:
 * filter includes query → sort startsWith first, then shorter name → slice LtS.
 * Aliases (thumbsup/love/…) are first-class keys so typeahead matches them.
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
