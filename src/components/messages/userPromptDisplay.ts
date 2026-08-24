/**
# densable 2.1.234 #36 — user prompt display helpers (V3i truncate + j3i markdown gate).

Gold:
- AQm=10000 / G3i=2500 / TQm=2500 → `{head, hiddenLines, tail}` (not string ellipsis)
- hQm=4000 markdown gate: !obj && !queued && len<=4000 && !(ultrathink enabled && keyword)
*/

export const USER_PROMPT_MAX_DISPLAY_CHARS = 10_000
export const USER_PROMPT_TRUNCATE_HEAD_CHARS = 2_500
export const USER_PROMPT_TRUNCATE_TAIL_CHARS = 2_500
/** densable hQm — only render Markdown when prompt is this short or less. */
export const USER_PROMPT_MARKDOWN_MAX_CHARS = 4_000

export type TruncatedUserPromptText = {
  head: string
  hiddenLines: number
  tail: string
}

export type UserPromptDisplayText = string | TruncatedUserPromptText

export function isTruncatedUserPromptText(
  text: UserPromptDisplayText,
): text is TruncatedUserPromptText {
  return typeof text === 'object' && text !== null && 'head' in text
}

/** densable V3i truncate branch — count newlines like `dp(text, '\\n', from)`. */
export function truncateUserPromptForDisplay(
  text: string,
  countCharInString: (
    haystack: string,
    needle: string,
    fromIndex?: number,
  ) => number,
): UserPromptDisplayText {
  if (text.length <= USER_PROMPT_MAX_DISPLAY_CHARS) return text
  const head = text.slice(0, USER_PROMPT_TRUNCATE_HEAD_CHARS)
  const tail = text.slice(-USER_PROMPT_TRUNCATE_TAIL_CHARS)
  const hiddenLines =
    countCharInString(text, '\n', USER_PROMPT_TRUNCATE_HEAD_CHARS) -
    countCharInString(tail, '\n')
  return { head, hiddenLines, tail }
}

/**
 * densable j3i `Bto` — whether to route through Markdown `promptMode`.
 */
export function shouldRenderUserPromptMarkdown(
  text: UserPromptDisplayText,
  opts: {
    isQueued: boolean
    /** densable H9e() && d0n(text) — ultrathink rainbow path wins over markdown. */
    hasUltrathinkTrigger: boolean
  },
): boolean {
  if (isTruncatedUserPromptText(text)) return false
  if (opts.isQueued) return false
  if (text.length > USER_PROMPT_MARKDOWN_MAX_CHARS) return false
  if (opts.hasUltrathinkTrigger) return false
  return true
}

export function formatHiddenLinesTitle(hiddenLines: number): string {
  return `(${hiddenLines} ${hiddenLines === 1 ? 'line' : 'lines'} hidden)`
}
