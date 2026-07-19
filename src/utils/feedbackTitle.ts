/**
 * densable feedback title helpers (c8_ / l8_ / waa first-line half).
 * Behavior only — used by Feedback.tsx generateTitle.
 */

/**
 * densable l8_ — refusal / apology prefix on Haiku title.
 * Includes both ASCII and curly apostrophe variants.
 */
export const FEEDBACK_TITLE_REFUSAL_RE =
  /^(i can['\u2019]t|i cannot|i['\u2019]m unable|i am unable|i['\u2019]m sorry|i am sorry|i apologize|sorry,)/i

/**
 * densable c8_ — empty or refusal-like title → use fallback.
 */
export function isFeedbackTitleRefusalLike(title: string): boolean {
  const trimmed = title.trim()
  return trimmed === '' || FEEDBACK_TITLE_REFUSAL_RE.test(trimmed)
}

/**
 * densable Nd portable — first line of description for fallback title.
 */
export function feedbackTitleFirstLine(description: string): string {
  return description.split('\n')[0] || ''
}

/**
 * densable waa — safe fallback title from bug description first line.
 */
export function createFeedbackFallbackTitle(description: string): string {
  const firstLine = feedbackTitleFirstLine(description)
  if (firstLine.length <= 60 && firstLine.length > 5) {
    return firstLine
  }
  let truncated = firstLine.slice(0, 60)
  if (firstLine.length > 60) {
    const lastSpace = truncated.lastIndexOf(' ')
    if (lastSpace > 30) {
      truncated = truncated.slice(0, lastSpace)
    }
    truncated += '...'
  }
  return truncated.length < 10 ? 'Bug Report' : truncated
}
