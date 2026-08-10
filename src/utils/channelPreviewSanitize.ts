/**
 * densable 2.1.211 channel permission preview neutralize.
 *
 * Permission previews relayed to chat channels must not let tool inputs
 * visually alter the approval message via bidirectional-override, zero-width,
 * or look-alike quote characters.
 *
 * Charset mirrors deepResearchSourceLabel LABEL_STRIP (C0/C1 + bidi/ZW +
 * curly/look-alike quotes) so channel SMS/Telegram previews cannot smuggle
 * direction flips or spoof quote boundaries.
 */

/** densable 211 channel preview — strip set built without control-char regex literals. */
function buildChannelPreviewStrip(): RegExp {
  const c0c1: string[] = []
  for (let i = 0; i <= 0x1f; i++) c0c1.push(String.fromCharCode(i))
  for (let i = 0x7f; i <= 0x9f; i++) c0c1.push(String.fromCharCode(i))
  // Zero-width / bidi overrides / isolates / BOM + quote lookalikes
  const extras =
    '\u200b\u200c\u200d\u200e\u200f' +
    '\u202a\u202b\u202c\u202d\u202e' +
    '\u2066\u2067\u2068\u2069' +
    '\ufeff' +
    // look-alike / smart quotes (keep ASCII " for JSON structure — strip
    // only curly and fullwidth so the JSON stays parseable-looking)
    '\u201c\u201d\u201e\u201f\u2033\u2036\u275d\u275e\u301d\u301e\uff02'
  const escaped = [...c0c1, ...extras]
    .map(ch => ch.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&'))
    .join('')
  return new RegExp(`[${escaped}]`, 'g')
}

const CHANNEL_PREVIEW_STRIP = buildChannelPreviewStrip()

/**
 * Neutralize bidi / zero-width / look-alike quotes in a channel permission
 * input preview string. Does not change length-cap policy (caller truncates).
 */
export function neutralizeChannelPreviewText(text: string): string {
  return text.replace(CHANNEL_PREVIEW_STRIP, '')
}
