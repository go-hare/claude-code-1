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
