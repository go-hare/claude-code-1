/**
 * densable eee residual pure — strip outer markdown code fences.
 *
 * densable:
 *   e.trim()
 *     .replace(/^``` + lang + whitespace, "")
 *     .replace(trailing whitespace + ```, "")
 *     .trim()
 */

export function stripOuterMarkdownFences(text: string): string {
  return text
    .trim()
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim()
}
