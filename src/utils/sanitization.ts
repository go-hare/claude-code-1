/**
 * Unicode Sanitization for Hidden Character Attack Mitigation
 *
 * This module implements security measures against Unicode-based hidden character attacks,
 * specifically targeting ASCII Smuggling and Hidden Prompt Injection vulnerabilities.
 * These attacks use invisible Unicode characters (such as Tag characters, format controls,
 * private use areas, and noncharacters) to hide malicious instructions that are invisible
 * to users but processed by AI models.
 *
 * The vulnerability was demonstrated in HackerOne report #3086545 targeting Claude Desktop's
 * MCP (Model Context Protocol) implementation, where attackers could inject hidden instructions
 * using Unicode Tag characters that would be executed by Claude but remain invisible to users.
 *
 * Reference: https://embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags/
 *
 * This implementation provides comprehensive protection by:
 * 1. Applying NFKC Unicode normalization to handle composed character sequences
 * 2. Removing dangerous Unicode categories while preserving legitimate text and formatting
 * 3. Supporting recursive sanitization of complex nested data structures
 * 4. Maintaining performance with efficient regex processing
 *
 * The sanitization is always enabled to protect against these attacks.
 */

export function partiallySanitizeUnicode(prompt: string): string {
  let current = prompt
  let previous = ''
  let iterations = 0
  const MAX_ITERATIONS = 10 // Safety limit to prevent infinite loops

  // Iteratively sanitize until no more changes occur or max iterations reached
  while (current !== previous && iterations < MAX_ITERATIONS) {
    previous = current

    // Apply NFKC normalization to handle composed character sequences
    current = current.normalize('NFKC')

    // Remove dangerous Unicode categories using explicit character ranges

    // Method 1: Strip dangerous Unicode property classes
    // This is the primary defence and is the solution that is widely used in OSS libraries.
    current = current.replace(/[\p{Cf}\p{Co}\p{Cn}]/gu, '')

    // Method 2: Explicit character ranges. There are some subtle issues with the above method
    // failing in certain environments that don't support regexes for unicode property classes,
    // so we also implement a fallback that strips out some specifically known dangerous ranges.
    current = current
      .replace(/[\u200B-\u200F]/g, '') // Zero-width spaces, LTR/RTL marks
      .replace(/[\u202A-\u202E]/g, '') // Directional formatting characters
      .replace(/[\u2066-\u2069]/g, '') // Directional isolates
      .replace(/[\uFEFF]/g, '') // Byte order mark
      .replace(/[\uE000-\uF8FF]/g, '') // Basic Multilingual Plane private use

    iterations++
  }

  // If we hit max iterations, crash loudly. This should only ever happen if there is a bug or if someone purposefully created a deeply nested unicode string.
  if (iterations >= MAX_ITERATIONS) {
    throw new Error(
      `Unicode sanitization reached maximum iterations (${MAX_ITERATIONS}) for input: ${prompt.slice(0, 100)}`,
    )
  }

  return current
}

export function recursivelySanitizeUnicode(value: string): string
export function recursivelySanitizeUnicode<T>(value: T[]): T[]
export function recursivelySanitizeUnicode<T extends object>(value: T): T
export function recursivelySanitizeUnicode<T>(value: T): T
export function recursivelySanitizeUnicode(value: unknown): unknown {
  if (typeof value === 'string') {
    return partiallySanitizeUnicode(value)
  }

  if (Array.isArray(value)) {
    return value.map(recursivelySanitizeUnicode)
  }

  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      sanitized[recursivelySanitizeUnicode(key)] =
        recursivelySanitizeUnicode(val)
    }
    return sanitized
  }

  // Return other primitive values (numbers, booleans, null, undefined) unchanged
  return value
}

// --- 256-char agent/skill shown-name validation (325: o8 / Enr / Qse / k5 / kH / tengu_slate_wicket) ---

export const MAX_SHOWN_NAME_LENGTH = 256
export const SHOWN_NAME_RULE_MESSAGE =
  'a name may not hold hidden, direction-changing or blank-like characters, < or >, or be over 256 characters'
const MAX_NAMES_NOT_SHOWN = 100
const SLATE_WICKET_FLAG = 'tengu_slate_wicket'

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-character and angle-bracket detection
const BASIC_CONTROL_OR_ANGLE_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029<>]/
const DEFAULT_IGNORABLE_AND_BRAILLE = '\\p{Default_Ignorable_Code_Point}\\u2800'
const HIDDEN_CHAR_CLASS = `\\p{Cc}\\p{Cf}\\p{Cs}\\p{Co}\\p{Cn}\\u2028\\u2029${DEFAULT_IGNORABLE_AND_BRAILLE}`
const HIDDEN_CHAR_RE = new RegExp(`[${HIDDEN_CHAR_CLASS}]`, 'u')
const BLANK_LIKE_OR_EDGE_SPACE_RE =
  /(?! )\p{Zs}|[\uFFFC\u{1D159}\u{13441}\u{13442}\u{16910}\u{16FE4}]|^ | $/u
const COMBINING_OR_HANGUL = '[\\p{M}\\u1160-\\u11FF\\uD7B0-\\uD7FF]'
const ZALGO_OR_COMBINING_ABUSE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}\\p{M}])${COMBINING_OR_HANGUL}|${COMBINING_OR_HANGUL}{9}|\\p{Soft_Dotted}\\p{M}*\\u0307|[\\u0131\\u0237]\\p{M}|(?<=[\\p{sc=Latin}\\p{sc=Common}]${COMBINING_OR_HANGUL}*)(?!\\p{sc=Inherited})${COMBINING_OR_HANGUL}`,
  'u',
)
const KEYCAP_OR_EMOJI_COMBINING_RE = new RegExp(
  `\\u20E3|\\u263A${COMBINING_OR_HANGUL}`,
  'u',
)
// biome-ignore lint/suspicious/noMisleadingCharacterClass: intentional detection of individual joiner/variation-selector code points
const HAS_JOINER_OR_VS_RE = /[\u200C\u200D\uFE0F\u{E007F}]/u
const ARABIC_BE = String.raw`\u0620\u0626\u0628\u062A-\u062E\u0633-\u063F\u0641-\u0647\u0649\u064A\u066E\u066F\u0678-\u0687\u069A-\u06BF\u06C1\u06C2\u06CC\u06CE\u06D0\u06D1\u06FA-\u06FC\u06FF\u0750-\u0758\u075C-\u076A\u076D-\u0770\u0772\u0775-\u0777\u077A-\u077F\u0886\u0889-\u088D\u088F\u08A0-\u08A9\u08AF\u08B0\u08B3-\u08B8\u08BA-\u08C8`
const ARABIC_FE = String.raw`\u0620\u0622-\u063F\u0641-\u064A\u066E\u066F\u0671-\u0673\u0675-\u06D3\u06D5\u06EE\u06EF\u06FA-\u06FC\u06FF\u0750-\u077F\u0870-\u0882\u0886\u0889-\u088F\u08A0-\u08AC\u08AE-\u08C8`
const INDIC_SCRIPTS = [2304, 2432, 2688, 2816, 3072, 3200, 3328].map(base => {
  const letter = `[\\u{${(base + 21).toString(16)}}-\\u{${(base + 57).toString(16)}}]`
  const opt = base === 3328 ? '' : `\\u{${(base + 60).toString(16)}}?`
  return `[\\u200C\\u200D](?<=${letter}${opt}\\u{${(base + 77).toString(16)}}.)(?=${letter})`
})
const SINHALA_LETTERS = String.raw`[\u0D9A-\u0DC6]`
const LEGIT_JOINER_RE = new RegExp(
  [
    ...INDIC_SCRIPTS,
    `\\u200D(?<=${SINHALA_LETTERS}\\u0DCA.)(?=${SINHALA_LETTERS})`,
    `\\u200C(?<=[${ARABIC_BE}](?:(?=[\\p{sc=Arabic}\\p{sc=Inherited}])(?!\\p{Default_Ignorable_Code_Point})\\p{Mn}){0,8}.)(?=[${ARABIC_FE}])`,
  ].join('|'),
  'gu',
)
const COLON_SPACE_EDGE_RE = /(?:^|:) | (?::|$)|^:|:$/
const NON_ASCII_SPACE_Z_RE = /[^\P{Z} ]/gu
let rgiEmojiRe: RegExp | undefined

function stripAllowedEmojiAndJoiners(value: string): string {
  if (!HAS_JOINER_OR_VS_RE.test(value)) return value
  rgiEmojiRe ??= /\p{RGI_Emoji}/gv
  return value.replace(rgiEmojiRe, '\u263A').replace(LEGIT_JOINER_RE, '')
}

/** 325 `o8` — non-empty, <=256 chars, no C0/C1/line-sep/angle-brackets. */
export function isSafeBasicName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_SHOWN_NAME_LENGTH &&
    !BASIC_CONTROL_OR_ANGLE_RE.test(name)
  )
}

/** 325 `Me` + `Enr` — full shown-name safety check. */
export function isShownNameSafe(name: string): boolean {
  if (!isSafeBasicName(name)) return false
  const stripped = stripAllowedEmojiAndJoiners(name)
  if (HIDDEN_CHAR_RE.test(stripped)) return false
  if (KEYCAP_OR_EMOJI_COMBINING_RE.test(stripped)) return false
  if (/\uFE0F[\u{1F3FB}-\u{1F3FF}]/u.test(name)) return false
  if (BLANK_LIKE_OR_EDGE_SPACE_RE.test(name)) return false
  if (name.includes('  ')) return false
  if (ZALGO_OR_COMBINING_ABUSE_RE.test(stripped)) return false
  return true
}

/** 325 `Hdn` — `diskless() || getFeatureValue('tengu_slate_wicket', true) !== false`. */
export function isSlateWicketEnabled(): boolean {
  try {
    const { isDisklessLaunch } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./sessionHost.js') as typeof import('./sessionHost.js')
    if (isDisklessLaunch()) return true
  } catch {
    // ignore
  }
  try {
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    return (
      getFeatureValue_CACHED_MAY_BE_STALE(SLATE_WICKET_FLAG, true) !== false
    )
  } catch {
    return true
  }
}

/** 325 `Qse` — agent name validation. */
export function isValidAgentName(name: string): boolean {
  return (
    isShownNameSafe(name) || (isSafeBasicName(name) && !isSlateWicketEnabled())
  )
}

/** 325 `k5` — skill/command name validation (also rejects `: ` / ` :` / leading/trailing `:`). */
export function isValidSkillName(name: string): boolean {
  return (
    (isShownNameSafe(name) && !COLON_SPACE_EDGE_RE.test(name)) ||
    (isSafeBasicName(name) && !isSlateWicketEnabled())
  )
}

const namesNotShown = new Set<string>()

export function getNamesNotShown(): ReadonlySet<string> {
  return namesNotShown
}

export function clearNamesNotShownForTests(): void {
  namesNotShown.clear()
}

/** 325 `kH` — record refused skill/command/agent name up to 100 entries. */
export function recordNameNotShown(name: string, reason: string): void {
  const truncated = name.length > 200 ? `${name.slice(0, 200)}…` : name
  const safeName = truncated.replace(
    NON_ASCII_SPACE_Z_RE,
    ch => `\\u{${ch.codePointAt(0)?.toString(16).toUpperCase()}}`,
  )
  const entry = `${safeName} ${reason}`
  if (namesNotShown.has(entry) || namesNotShown.size >= MAX_NAMES_NOT_SHOWN) {
    return
  }
  namesNotShown.add(entry)
  try {
    const { logForDebugging } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./debug.js') as typeof import('./debug.js')
    logForDebugging(
      `[names] ${entry}: ${SHOWN_NAME_RULE_MESSAGE}${
        namesNotShown.size === MAX_NAMES_NOT_SHOWN ? '. No more are told' : ''
      }`,
      { level: 'warn' },
    )
  } catch {
    // ignore
  }
}
