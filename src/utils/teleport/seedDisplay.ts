/**
 * densable `_749` `$l`/`D`, `_845` `bp`/`H` + `mt`/`L`, TCt `sA`.
 * Gold: gold-forged-H-Wzd-mod.txt (`function D` / `function H` / `function L`)
 * and TCt `function sA` @215251114.
 */

import { mapControlFormatToSpace } from '../sessionTitleSanitize.js'
import { truncateCodeUnitsSafe } from '../stringUtils.js'

export const SEED_PATH_LIST_CAP = 10
export const SEED_PATH_DISPLAY_CAP = 120

/** densable `$l` / `_749` `D` — Cc/Cf/LS/PS runs → space. */
export function sanitizeSeedDisplay(text: string): string {
  return mapControlFormatToSpace(text)
}

/**
 * densable `bp` / `_845` `H`:
 * `if(t.length<=n)return t; let e=u(t,n); return \`${e}… [+${t.length-e.length} chars]\``
 * `u` is the UTF-16-safe prefix (`truncateCodeUnitsSafe` / `_845` `u`).
 */
export function truncateSeedDisplay(text: string, cap: number): string {
  if (text.length <= cap) return text
  const kept = truncateCodeUnitsSafe(text, cap)
  return `${kept}… [+${text.length - kept.length} chars]`
}

/** densable `mt` / `_845` `L(t,n,e=n+"s"){return t===1?n:e}` */
export function seedPlural(
  count: number,
  singular: string,
  plural: string = `${singular}s`,
): string {
  return count === 1 ? singular : plural
}

/** densable `$I` — `t?bp($l(e),200):e.slice(0,200)`. */
export function clipSeedGitError(text: string, hardened: boolean): string {
  return hardened
    ? truncateSeedDisplay(sanitizeSeedDisplay(text), 200)
    : text.slice(0, 200)
}

/** densable `sA` — O4n=10, nYn=120, `bp($l(r), nYn)`. */
export function formatSeedPathList(paths: string[]): string {
  const shown = paths
    .slice(0, SEED_PATH_LIST_CAP)
    .map(p =>
      truncateSeedDisplay(sanitizeSeedDisplay(p), SEED_PATH_DISPLAY_CAP),
    )
  const extra = paths.length - SEED_PATH_LIST_CAP
  return extra > 0 ? `${shown.join(', ')} and ${extra} more` : shown.join(', ')
}
