/**
 * densable 2.1.238 #11 WBc — URL elicitation one-click / exact-show gates.
 *
 * Gold (SEA WBc / R2g / Ufr / IqE / PqE / A2g=8000). Does **not** invent a
 * `url.length > 4096 → ''` cap. Full `rL` sanitizer is not ported; KCt-lite
 * withholds when hidden chars / newlines / tabs / truncation markers / unit
 * cap would make rL mutate or withhold the string.
 */
import { wrapAnsi } from '@anthropic/ink'

/** densable `A2g` */
export const BROWSER_READY_MAX = 8000

/** densable `wO` — rL maxUnits for URL withhold */
export const URL_SANITIZE_MAX_UNITS = 200_000

/** densable `CMi` */
export const URL_WITHHELD_MARKER =
  '(value cannot be shown in full — approval withheld; one-time options only)'

/** densable `kqE` — extra shell-metachar cost in browser-ready length */
const SHELL_META_RE = /[()\][%!^"`<>&|;, *?]/g

/** densable `fmt` — rL withhold if truncation marker leaked into the value */
const GRAPHEME_TRUNCATION_RE = /… \[\+\d+ graphemes\]/

/** densable `t5v` / `r5v` used by `RMi` */
const DEFAULT_IGNORABLE_RE = /\p{Default_Ignorable_Code_Point}/u
const FORMAT_CHAR_RE = /\p{Cf}/u

/** densable WBc warning when KCt && !y2 */
export const URL_TOO_LONG_FOR_BROWSER =
  'This URL’s browser-ready form is too long to hand to a browser safely, so one-click opening is disabled. The URL above is shown in full. Decline to continue.'

/** densable WBc warning when !KCt && !y2 */
export const URL_NOT_EXACT =
  'This URL cannot be shown exactly as it would open, so opening it is disabled. Decline to continue.'

/** densable WBc warning when y2 && PCr */
export const URL_EXTENDS_PAST_SCREEN =
  'This URL extends past this screen — its beginning is not visible here. Review it in full before accepting.'

/**
 * densable `RMi` — hidden / format / surrogate / LS-PS / braille-blank.
 */
export function isHiddenUrlChar(char: string, codePoint: number): boolean {
  return (
    DEFAULT_IGNORABLE_RE.test(char) ||
    char === '\u2028' ||
    char === '\u2029' ||
    char === '⠀' ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    FORMAT_CHAR_RE.test(char)
  )
}

/** densable `EFe` */
export function hasHiddenUrlChars(value: string): boolean {
  for (const char of value) {
    if (isHiddenUrlChar(char, char.codePointAt(0) ?? 0)) return true
  }
  return false
}

/** densable `R2g` */
export function browserReadyLength(href: string): number {
  return (
    href.length +
    3 * (href.match(SHELL_META_RE)?.length ?? 0) +
    4 * (href.match(/"/g)?.length ?? 0) +
    (href.match(/\\/g)?.length ?? 0) +
    16
  )
}

/** densable `Ufr` */
export function hrefForOpen(url: string): string {
  try {
    return new URL(url).href
  } catch {
    return url
  }
}

function wouldRWithhold(value: string): boolean {
  if (value.length > URL_SANITIZE_MAX_UNITS) return true
  if (GRAPHEME_TRUNCATION_RE.test(value)) return true
  if (value.includes('\t')) return true
  if (hasHiddenUrlChars(value)) return true
  if (/[\n\r\u2028\u2029]/.test(value)) return true
  return false
}

/**
 * densable `KCt` subset: raw + href both survive rL as exact full text.
 */
export function isExactShowableUrl(raw: string, href: string): boolean {
  return !wouldRWithhold(raw) && !wouldRWithhold(href)
}

/** densable `y2 = KCt && R2g(Yz) <= A2g` */
export function canOneClickOpen(href: string, exact: boolean): boolean {
  return exact && browserReadyLength(href) <= BROWSER_READY_MAX
}

/**
 * densable `PCr`: rows-12 line budget, columns-6 wrap width, width<20 overflow.
 */
export function urlOverflowsScreen(
  text: string,
  columns: number,
  rows: number,
): boolean {
  const lineBudget = rows - 12
  if (lineBudget < 1) return true
  const wrapWidth = columns - 6
  if (wrapWidth < 20) return true
  // SEA V3("wrap") → DH({trim:!1, hard:!0}). Without hard, a space-free URL
  // stays one line and PCr never fires URL_EXTENDS_PAST_SCREEN / IqE.
  const wrapped = wrapAnsi(text, wrapWidth, { trim: false, hard: true })
  const newlineCount = wrapped.match(/\n/g)?.length ?? 0
  return newlineCount + 1 > lineBudget
}

/** densable `IqE` — knock Accept back to Decline when unsafe / overflow. */
export function knockAcceptIfUnsafe<T extends string>(
  focused: T,
): Exclude<T, 'accept'> | 'decline' {
  return (focused === 'accept' ? 'decline' : focused) as
    | Exclude<T, 'accept'>
    | 'decline'
}

/** densable `PqE` — left/right toggle only when one-click is allowed. */
export function toggleAcceptDecline(
  focused: 'accept' | 'decline',
): 'accept' | 'decline' {
  return focused === 'accept' ? 'decline' : 'accept'
}

export function urlPromptWarning(
  exact: boolean,
  oneClick: boolean,
  overflows: boolean,
): string | null {
  if (exact && !oneClick) return URL_TOO_LONG_FOR_BROWSER
  if (!exact && !oneClick) return URL_NOT_EXACT
  if (oneClick && overflows) return URL_EXTENDS_PAST_SCREEN
  return null
}
