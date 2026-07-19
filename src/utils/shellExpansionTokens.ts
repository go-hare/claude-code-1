/**
 * densable ZVn / NVc residual pure — shell expansion placeholder tokens.
 *
 * densable pOe = `__CMDSUB_OUTPUT__`, ob = `__TRACKED_VAR__`
 * ZVn: replaceAll with `$(\u2026)` / `${\u2026}`
 * NVc: startsWith either token
 */

/** densable pOe. */
export const CMDSUB_OUTPUT_TOKEN = '__CMDSUB_OUTPUT__'

/** densable ob (tracked var token in this cluster). */
export const TRACKED_VAR_TOKEN = '__TRACKED_VAR__'

/** densable ZVn. */
export function redactShellExpansionTokens(text: string): string {
  return text
    .replaceAll(CMDSUB_OUTPUT_TOKEN, '$(\u2026)')
    .replaceAll(TRACKED_VAR_TOKEN, '${\u2026}')
}

/** densable NVc. */
export function startsWithShellExpansionToken(text: string): boolean {
  return (
    text.startsWith(CMDSUB_OUTPUT_TOKEN) || text.startsWith(TRACKED_VAR_TOKEN)
  )
}
