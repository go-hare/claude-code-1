/**
 * densable 2.1.221 session-title sanitize (ly / vhn / uge).
 *
 * SEA gold (darwin 2.1.221):
 *   ly(e)  = e.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ")
 *   vhn(e) = [...e.replace(/[\x00-\x1f\x7f-\x9f]/g, "")].slice(0, OMb).join("")
 *   OMb    = 200
 *   uge(e) = vhn(ly(e.trim())).trim()
 *
 * Shared by /rename (FXe), LogSelector rename submit, ACP titles, and any
 * other surface that must not store control/format-only names.
 */

/** densable `OMb` — max unicode code points after sanitize. */
export const SESSION_TITLE_MAX_CODE_POINTS = 200

/**
 * densable `ly` — map Cc/Cf + LS/PS runs to a single space (preserves word
 * boundaries instead of deleting).
 */
export function mapControlFormatToSpace(input: string): string {
  return input.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ')
}

/**
 * densable `vhn` — strip residual C0/C1, then cap by unicode code-point count
 * (spread, not UTF-16 length).
 */
export function capSessionTitleCodePoints(
  input: string,
  max: number = SESSION_TITLE_MAX_CODE_POINTS,
): string {
  // densable vhn — exact C0/C1 strip (biome disallows control-char regex literals)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: densable vhn gold
  const cleaned = input.replace(/[\x00-\x1f\x7f-\x9f]/g, '')
  return [...cleaned].slice(0, max).join('')
}

/**
 * densable `uge` — shared rename sanitize for all surfaces.
 * Returns empty string when only invisible/control content remains.
 */
export function sanitizeSessionTitle(input: string): string {
  return capSessionTitleCodePoints(mapControlFormatToSpace(input.trim())).trim()
}

/** densable empty-after-sanitize copy for /rename (i7o / FXe null). */
export const RENAME_EMPTY_AFTER_SANITIZE_MESSAGE =
  'That name is empty once invisible characters are removed. Usage: /rename <name>'

/** @deprecated densable name is `mapControlFormatToSpace` (ly); kept as alias. */
export const stripInvisibleTitleChars = mapControlFormatToSpace
