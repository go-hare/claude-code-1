export const SEND_MESSAGE_TOOL_NAME = 'SendMessage'

/** densable Cpr — SendMessage summary soft max (chars); longer → coerce truncate. */
export const SEND_MESSAGE_SUMMARY_MAX_CHARS = 200

/** densable Mpv — accepted SendMessage param names (incl. notify_when_idle). */
export const SEND_MESSAGE_PARAM_SET = new Set([
  'to',
  'summary',
  'message',
  'notify_when_idle',
])

/**
 * densable 2.1.234 #11 / SEA `Agf`:
 * `Agf = Math.max(lie + (2+WWs+1), BWs) = Math.max(200+15, 300) = 300`
 * Unicode-aware (`u` flag) so emoji-heavy ListAgents names at the 200 display
 * cap still fit under the schema max.
 */
export const SEND_MESSAGE_TO_MAX_CHARS = 300

/** densable `b4a` — single-line recipient. */
export const SEND_MESSAGE_TO_SINGLE_LINE_RE = /^[^\n\r]*$/u

/** densable `Tgf(Agf)` / `bVv` — unicode length cap for `to`. */
export const SEND_MESSAGE_TO_MAX_RE = new RegExp(
  `^[\\s\\S]{0,${SEND_MESSAGE_TO_MAX_CHARS}}$`,
  'u',
)
