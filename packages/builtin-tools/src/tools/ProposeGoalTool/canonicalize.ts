/**
 * densable 2.1.239 ProposeGoal canonicalize — Cen / Y4r / BH / cHn / hZ_ / wzn / __p / $ci / Y4t / So.
 *
 * Y4r = __p(wzn(BH(e)), false). Tab expansion lives in __p → $ci (tabstop 8).
 * cAv grapheme budget is skipped: Y4r passes t=false, and schema cap 500 never
 * trips the display-budget path.
 * $ci gold uses _Nt ANSI tokenizer + Bun.stringWidth; ProposeGoal conditions
 * are BH-stripped (no ANSI), so tabstop-8 + stringWidth is the 1:1 remainder.
 */

const UNPAIRED_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** densable hZ_ — Cf/Co/Cn + explicit bidi / ZWSP / BOM / PUA. */
const FORMAT_AND_INVISIBLE =
  /[\p{Cf}\p{Co}\p{Cn}\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\uE000-\uF8FF]/gu

/** densable wzn / uAv */
const DEFAULT_IGNORABLE = /\p{DI}/gu

const TABSTOP = 8

const isWellFormed = String.prototype.isWellFormed

/** densable cHn */
export function stripUnpairedSurrogates(input: string): string {
  if (typeof isWellFormed === 'function' && isWellFormed.call(input)) {
    return input
  }
  return input.replace(UNPAIRED_SURROGATE, '')
}

/** densable hZ_ */
export function stripFormatAndInvisible(input: string): string {
  return input.replace(FORMAT_AND_INVISIBLE, '')
}

/** densable BH — cHn + at most 10 hZ_ passes. */
export function stripHomoglyphNoise(input: string): string {
  let next = stripUnpairedSurrogates(input)
  for (let i = 0; i < 10; i++) {
    const stripped = stripFormatAndInvisible(next)
    if (stripped === next) break
    next = stripped
  }
  return next
}

/** densable wzn */
export function stripDefaultIgnorable(input: string): string {
  return input.replace(DEFAULT_IGNORABLE, '')
}

function isVariationSelector(cp: number): boolean {
  // densable eAv: VS15 / VS16
  return cp === 65038 || cp === 65039
}

function isC0C1(cp: number): boolean {
  // densable f_p: skip TAB/LF, else C0 or C1
  if (cp === 9 || cp === 10) return false
  return cp < 32 || (cp >= 127 && cp <= 159)
}

function isBidiControl(cp: number): boolean {
  // densable m_p: 1564 / 8234-8238 / 8294-8297
  return cp === 1564 || (cp >= 8234 && cp <= 8238) || (cp >= 8294 && cp <= 8297)
}

function isSurrogateCodePoint(cp: number): boolean {
  return cp >= 55296 && cp <= 57343
}

function codePointWidth(ch: string): number {
  try {
    return Bun.stringWidth(ch, { ambiguousIsNarrow: true })
  } catch {
    return 1
  }
}

/** densable $ci — tabstop 8; no ANSI tokenizer (BH already stripped SGR). */
export function expandTabs(input: string, tabstop: number = TABSTOP): string {
  if (!input.includes('\t')) return input
  let col = 0
  let out = ''
  for (const ch of input) {
    if (ch === '\n') {
      out += ch
      col = 0
      continue
    }
    if (ch === '\t') {
      const spaces = tabstop - (col % tabstop)
      out += ' '.repeat(spaces)
      col += spaces
      continue
    }
    out += ch
    col += codePointWidth(ch)
  }
  return out
}

/**
 * densable __p. t=true is the Y4t display path (cAv skipped under the 500 cap).
 * VS15/16 dropped; C0/C1 (except TAB/LF), bidi, surrogates → U+FFFD; then $ci.
 */
export function sanitizeForDisplay(
  input: string,
  _forDisplayBudget: boolean,
): string {
  let out = ''
  for (const ch of input) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue
    if (isVariationSelector(cp)) continue
    if (isC0C1(cp) || isBidiControl(cp) || isSurrogateCodePoint(cp)) {
      out += '�'
      continue
    }
    out += ch
  }
  return expandTabs(out)
}

/** densable Y4r */
export function canonicalizeGoalCondition(input: string): string {
  return sanitizeForDisplay(
    stripDefaultIgnorable(stripHomoglyphNoise(input)),
    false,
  )
}

/** densable Cen — CR/LF/NEL/LS/PS → space */
export function flattenNewlines(input: string): string {
  return input.replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')
}

/** densable So — UTF-16 slice that does not cut a high surrogate. */
export function sliceUtf16Safe(input: string, max: number): string {
  if (input.length <= max) return input
  let sliced = input.slice(0, max)
  const last = sliced.charCodeAt(sliced.length - 1)
  if (last >= 55296 && last <= 56319) {
    sliced = sliced.slice(0, -1)
  }
  return sliced
}

const Y4T_MORE_SUFFIX = (n: number): string =>
  ` … (${n} more characters follow that are NOT shown in this message)`

/** densable Y4t — __p(e, true) then So. */
export function truncateGoalConditionForRender(
  input: string,
  max: number,
): string {
  const sanitized = sanitizeForDisplay(input, true)
  if (sanitized.length <= max) return sanitized
  const sliced = sliceUtf16Safe(sanitized, max)
  return `${sliced}${Y4T_MORE_SUFFIX(sanitized.length - sliced.length)}`
}
