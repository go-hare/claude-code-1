/**
 * Official `Q2r` / `Tve` / `Gei` / `BH` — anti-confusable tag scrub for
 * untrusted web/markdown bodies. Gold: densable 2.1.239 SEA ~303678207.
 *
 * Call graph is the official one: BH → Z2r → Tve; if Gei+dash still differs,
 * split on `<` and backslash leftover confusable opens.
 */

const UNPAIRED_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

const isWellFormed =
  typeof String.prototype.isWellFormed === 'function'
    ? Function.prototype.call.bind(String.prototype.isWellFormed)
    : undefined

/** Official `cHn`. */
function stripUnpairedSurrogates(input: string): string {
  if (isWellFormed?.(input)) return input
  return input.replace(UNPAIRED_SURROGATE, '')
}

/** Official `hZ_`. */
function stripHiddenFormatChars(input: string): string {
  let next = input.replace(/[\p{Cf}\p{Co}\p{Cn}]/gu, '')
  next = next
    .replace(/[\u200B-\u200F]/g, '')
    .replace(/[\u202A-\u202E]/g, '')
    .replace(/[\u2066-\u2069]/g, '')
    .replace(/[\uFEFF]/g, '')
    .replace(/[\uE000-\uF8FF]/g, '')
  return next
}

/** Official `BH`. */
export function stripHiddenUnicode(input: string): string {
  let current = stripUnpairedSurrogates(input)
  for (let i = 0; i < 10; i++) {
    const next = stripHiddenFormatChars(current)
    if (next === current) return current
    current = next
  }
  return current
}

function once<T>(factory: () => T): () => T {
  let value: T | undefined
  let ready = false
  return () => {
    if (!ready) {
      value = factory()
      ready = true
    }
    return value as T
  }
}

const INVISIBLE_CLASS =
  '\\u00ad\\u034f\\u0600-\\u0605\\u061c\\u06dd\\u070f\\u0890\\u0891\\u08e2\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\ufff0-\\ufffb\\u{110bd}\\u{110cd}\\u{13430}-\\u{1343f}\\u{1bca0}-\\u{1bca3}\\u{1d173}-\\u{1d17a}\\u{e0000}-\\u{e0fff}'

const COMBINING_CLASS =
  '\\u0300-\\u0344\\u0346-\\u036f\\u0483-\\u0489\\u0591-\\u05bd\\u05bf\\u05c1\\u05c2\\u05c4\\u05c5\\u05c7\\u0610-\\u061a\\u064b-\\u065f\\u0670\\u06d6-\\u06dc\\u06df-\\u06e4\\u06e7\\u06e8\\u06ea-\\u06ed\\u1ab0-\\u1aff\\u1dc0-\\u1dff\\u20d0-\\u20ff\\u3099\\u309a\\ufe20-\\ufe2f'

const NAME_CLASS = 'A-Za-z0-9_\\-'

const DASH_CLASS =
  '\\p{Pd}\\u2212\\u207b\\u208b\\u02d7\\u2796\\u2043\\u30fc\\uff70'

/** Official `Jya`. */
const LOOKALIKE: Record<string, string> = {
  '\uFF1C': '<',
  '\uFF1E': '>',
  '\uFE64': '<',
  '\uFE65': '>',
  '\u2329': '<',
  '\u232A': '>',
  '\u27E8': '<',
  '\u27E9': '>',
  '\u3008': '<',
  '\u3009': '>',
  '\u2039': '<',
  '\u203A': '>',
  '\u02C2': '<',
  '\u02C3': '>',
  '\u1438': '<',
  '\u1433': '>',
  '\u276C': '<',
  '\u276D': '>',
  '\u276E': '<',
  '\u276F': '>',
  '\u2770': '<',
  '\u2771': '>',
  '\u29FC': '<',
  '\u29FD': '>',
  '\u226E': '<',
  '\u226F': '>',
  '\u227A': '<',
  '\u227B': '>',
  '\u22D6': '<',
  '\u22D7': '>',
  '\uFF0F': '/',
  '\u2215': '/',
  '\u2044': '/',
}

const FILLER_AND_INVISIBLE = `${INVISIBLE_CLASS}${COMBINING_CLASS}\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f\\u2028\\u2029`

const NAME_TAIL = `(?:[^${NAME_CLASS}]|$)`

type BracketClasses = {
  open: string
  close: string
  slash: string
  filler: string
  lookalikePattern: RegExp
  invisiblePattern: RegExp
  dashPattern: RegExp
}

const bracketClasses = once((): BracketClasses => {
  const grouped: Record<string, string> = { '<': '<', '>': '>', '/': '/' }
  for (const [lookalike, ascii] of Object.entries(LOOKALIKE)) {
    grouped[ascii] += lookalike
  }
  return {
    open: grouped['<']!,
    close: grouped['>']!,
    slash: grouped['/']!,
    filler: `^${NAME_CLASS}${grouped['<']}${grouped['>']}`,
    lookalikePattern: new RegExp(`[${Object.keys(LOOKALIKE).join('')}]`, 'g'),
    invisiblePattern: new RegExp(`[${INVISIBLE_CLASS}]`, 'gu'),
    dashPattern: new RegExp(`[${DASH_CLASS}]`, 'gu'),
  }
})

/** Official `w4d`. */
const LATIN_CONFUSABLE: Record<string, string> = {
  '\u0430': 'a',
  '\u0435': 'e',
  '\u043E': 'o',
  '\u0440': 'p',
  '\u0441': 'c',
  '\u0443': 'y',
  '\u0445': 'x',
  '\u043A': 'k',
  '\u0456': 'i',
  '\u0458': 'j',
  '\u0455': 's',
  '\u0501': 'd',
  '\u051B': 'q',
  '\u051D': 'w',
  '\u04BB': 'h',
  '\u04CF': 'l',
  '\u0412': 'b',
  '\u041C': 'm',
  '\u041D': 'h',
  '\u0422': 't',
  '\u03B1': 'a',
  '\u03B5': 'e',
  '\u03B9': 'i',
  '\u03BA': 'k',
  '\u03BD': 'v',
  '\u03BF': 'o',
  '\u03C1': 'p',
  '\u03C4': 't',
  '\u03C5': 'u',
  '\u03C7': 'x',
  '\u03F3': 'j',
  '\u0392': 'b',
  '\u0396': 'z',
  '\u0397': 'h',
  '\u039C': 'm',
  '\u039D': 'n',
  '\u03A5': 'y',
  '\u1D00': 'a',
  '\u0299': 'b',
  '\u1D04': 'c',
  '\u1D05': 'd',
  '\u1D07': 'e',
  '\uA730': 'f',
  '\u0262': 'g',
  '\u029C': 'h',
  '\u026A': 'i',
  '\u1D0A': 'j',
  '\u1D0B': 'k',
  '\u029F': 'l',
  '\u1D0D': 'm',
  '\u0274': 'n',
  '\u1D0F': 'o',
  '\u1D18': 'p',
  '\u0280': 'r',
  '\uA731': 's',
  '\u1D1B': 't',
  '\u1D1C': 'u',
  '\u1D20': 'v',
  '\u1D21': 'w',
  '\u028F': 'y',
  '\u1D22': 'z',
  '\u0251': 'a',
  '\u0261': 'g',
  '\u0131': 'i',
  '\u0475': 'v',
  '\u0442': 't',
  '\u043C': 'm',
  '\uAB70': 'd',
  '\uAB71': 'r',
  '\uAB72': 't',
  '\uAB79': 'y',
  '\uAB7A': 'a',
  '\uAB7B': 'j',
  '\uAB7C': 'e',
  '\uAB83': 'w',
  '\uAB87': 'm',
  '\uAB8B': 'h',
  '\uAB90': 'g',
  '\uAB92': 'h',
  '\uAB93': 'z',
  '\uAB9C': 'u',
  '\uAB9F': 'b',
  '\uABA2': 'r',
  '\uABA4': 'w',
  '\uABA9': 'v',
  '\uABAA': 's',
  '\uABAE': 'l',
  '\uABAF': 'c',
  '\uABB2': 'p',
  '\uABB6': 'k',
  '\uABB7': 'd',
  '\u13FC': 'b',
  '\uA4D0': 'b',
  '\uA4D1': 'p',
  '\uA4D3': 'd',
  '\uA4D4': 't',
  '\uA4D6': 'g',
  '\uA4D7': 'k',
  '\uA4D9': 'j',
  '\uA4DA': 'c',
  '\uA4DC': 'z',
  '\uA4DD': 'f',
  '\uA4DF': 'm',
  '\uA4E0': 'n',
  '\uA4E1': 'l',
  '\uA4E2': 's',
  '\uA4E3': 'r',
  '\uA4E6': 'v',
  '\uA4E7': 'h',
  '\uA4EA': 'w',
  '\uA4EB': 'x',
  '\uA4EC': 'y',
  '\uA4EE': 'a',
  '\uA4F0': 'e',
  '\uA4F2': 'i',
  '\uA4F3': 'o',
  '\uA4F4': 'u',
  '\u0566': 'q',
  '\u0570': 'h',
  '\u0578': 'n',
  '\u057D': 'u',
  '\u0581': 'g',
  '\u0585': 'o',
  '\u03F2': 'c',
  '\u2CA5': 'c',
  '\u0269': 'i',
  '\u2C81': 'a',
  '\u2C83': 'b',
  '\u2C89': 'e',
  '\u2C8F': 'h',
  '\u2C93': 'i',
  '\u2C95': 'k',
  '\u2C99': 'm',
  '\u2C9B': 'n',
  '\u2C9F': 'o',
  '\u2CA3': 'p',
  '\u2CA7': 't',
  '\u2CA9': 'y',
  '\u2CAD': 'x',
  '\u2C8D': 'z',
}

const confusableTable = once(() => {
  const table: Record<string, string> = { ...LATIN_CONFUSABLE }
  for (const [glyph, latin] of Object.entries(LATIN_CONFUSABLE)) {
    const upper = glyph.toUpperCase()
    if (
      upper !== glyph &&
      [...upper].length === 1 &&
      !(upper in table) &&
      !/^[A-Za-z]$/.test(upper)
    ) {
      table[upper] = latin
    }
  }
  return {
    table,
    pattern: new RegExp(`[${Object.keys(table).join('')}]`, 'gu'),
  }
})

const TAG_PATTERN_CACHE = new Map<string, RegExp>()
const TAG_PATTERN_CACHE_CAP = 64

/** Official `Vnr`. */
function capturedFiller(classExpr: string, group: number): string {
  return `(?=([${classExpr}]*))(?:\\${group})`
}

/** Official `jei`. */
function capturedInvisible(group: number): string {
  return capturedFiller(FILLER_AND_INVISIBLE, group)
}

/** Official `T4d`. */
function buildTagOpenPattern({
  tags,
  closeOnly,
  fillerClass,
  spell,
  tail,
}: {
  tags: string[]
  closeOnly: boolean
  fillerClass: string
  spell: (ch: string) => string
  tail: string | undefined
}): RegExp {
  const { open, slash } = bracketClasses()
  let group = 0
  const prefix = closeOnly
    ? `${capturedFiller(`${fillerClass}${slash}`, ++group)}[${slash}]${capturedFiller(fillerClass, ++group)}`
    : capturedFiller(fillerClass, ++group)
  const spelled = tags.map(tag =>
    [...tag]
      .map((ch, i) => (i === 0 ? '' : capturedInvisible(++group)) + spell(ch))
      .join(''),
  )
  const suffix =
    tail === undefined ? NAME_TAIL : `${capturedInvisible(++group)}${tail}`
  return new RegExp(
    `[${open}](?!\\\\)(?=${prefix}(?:${spelled.join('|')})${suffix})`,
    'giu',
  )
}

/** Official `t_a`. */
function tagOpenPattern(tag: string, closeOnly: boolean): RegExp {
  const key = `${closeOnly ? '/' : ''}${tag}`
  const cached = TAG_PATTERN_CACHE.get(key)
  if (cached) return cached
  const pattern = buildTagOpenPattern({
    tags: [tag],
    closeOnly,
    fillerClass: bracketClasses().filler,
    spell: ch => ch,
    tail: undefined,
  })
  if (TAG_PATTERN_CACHE.size >= TAG_PATTERN_CACHE_CAP) TAG_PATTERN_CACHE.clear()
  TAG_PATTERN_CACHE.set(key, pattern)
  return pattern
}

/** Official `Tve`. */
function escapeConfusableOpenTags(tag: string, body: string): string {
  return body.replace(tagOpenPattern(tag, false), '<\\')
}

/** Official `Z2r`. */
function foldLookalikeBrackets(body: string): string {
  return body.replace(
    bracketClasses().lookalikePattern,
    ch => LOOKALIKE[ch] ?? ch,
  )
}

/** Official `OKb`. */
function stripCombiningMarks(input: string): string {
  return input.normalize('NFKD').replace(/\p{M}+/gu, '')
}

/** Official `Gei`. */
function foldConfusableLatin(input: string): string {
  const { table, pattern } = confusableTable()
  const replace = (value: string) =>
    value.replace(pattern, ch => table[ch] ?? ch)
  return replace(stripCombiningMarks(replace(input)).normalize('NFKC'))
}

/** Official `E4d`. */
function normalizeTagProbe(input: string): string {
  return foldConfusableLatin(input).replace(bracketClasses().dashPattern, '-')
}

/**
 * Official `Q2r(tag, body)`.
 * Neutral pages (no confusable open) return the BH+lookalike+invisible-stripped
 * string unchanged. Confusable leftovers that still look like `<tag` after
 * Gei get a backslash before the raw remainder.
 */
export function scrubConfusableTags(tag: string, body: string): string {
  const stripped = escapeConfusableOpenTags(
    tag,
    foldLookalikeBrackets(
      stripHiddenUnicode(body).replace(bracketClasses().invisiblePattern, ''),
    ),
  )
  if (normalizeTagProbe(stripped) === stripped) return stripped
  const open = tagOpenPattern(tag, false)
  return stripped
    .split('<')
    .map((part, index) => {
      if (index === 0 || part.startsWith('\\')) return part
      const probed = normalizeTagProbe(part)
      return probed !== part && `< ${probed}`.search(open) === 0
        ? `\\${part}`
        : part
    })
    .join('<')
}
