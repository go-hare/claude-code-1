import emojiRegex from 'emoji-regex'
import { eastAsianWidth } from 'get-east-asian-width'
import stripAnsi from 'strip-ansi'
import { hasInkActiveSessionAls, InkHostSlot } from './instances.js'
import { getGraphemeSegmenter } from './utils/grapheme.js'

const EMOJI_REGEX = emojiRegex()

/**
 * Fallback JavaScript implementation of stringWidth when Bun.stringWidth is not available.
 *
 * Get the display width of a string as it would appear in a terminal.
 *
 * This is a more accurate alternative to the string-width package that correctly handles
 * characters like ⚠ (U+26A0) which string-width incorrectly reports as width 2.
 *
 * The implementation uses eastAsianWidth directly with ambiguousAsWide: false,
 * which correctly treats ambiguous-width characters as narrow (width 1) as
 * recommended by the Unicode standard for Western contexts.
 */
function stringWidthJavaScript(str: string): number {
  if (typeof str !== 'string' || str.length === 0) {
    return 0
  }

  // Fast path: pure ASCII string (no ANSI codes, no wide chars)
  let isPureAscii = true
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    // Check for non-ASCII or ANSI escape (0x1b)
    if (code >= 127 || code === 0x1b) {
      isPureAscii = false
      break
    }
  }
  if (isPureAscii) {
    // Count printable characters (exclude control chars)
    let width = 0
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)
      if (code > 0x1f) {
        width++
      }
    }
    return width
  }

  // Strip ANSI if escape character is present
  if (str.includes('\x1b')) {
    str = stripAnsi(str)
    if (str.length === 0) {
      return 0
    }
  }

  // Fast path: simple Unicode (no emoji, variation selectors, or joiners)
  if (!needsSegmentation(str)) {
    let width = 0
    for (const char of str) {
      const codePoint = char.codePointAt(0)!
      if (!isZeroWidth(codePoint)) {
        width += eastAsianWidth(codePoint, { ambiguousAsWide: false })
      }
    }
    return width
  }

  let width = 0

  for (const { segment: grapheme } of getGraphemeSegmenter().segment(str)) {
    // Check for emoji first (most emoji sequences are width 2)
    EMOJI_REGEX.lastIndex = 0
    if (EMOJI_REGEX.test(grapheme)) {
      width += getEmojiWidth(grapheme)
      continue
    }

    // Calculate width for non-emoji graphemes
    // For grapheme clusters (like Devanagari conjuncts with virama+ZWJ), only count
    // the first non-zero-width character's width since the cluster renders as one glyph
    for (const char of grapheme) {
      const codePoint = char.codePointAt(0)!
      if (!isZeroWidth(codePoint)) {
        width += eastAsianWidth(codePoint, { ambiguousAsWide: false })
        break
      }
    }
  }

  return width
}

function needsSegmentation(str: string): boolean {
  for (const char of str) {
    const cp = char.codePointAt(0)!
    // Emoji ranges
    if (cp >= 0x1f300 && cp <= 0x1faff) return true
    if (cp >= 0x2600 && cp <= 0x27bf) return true
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true
    // Variation selectors, ZWJ
    if (cp >= 0xfe00 && cp <= 0xfe0f) return true
    if (cp === 0x200d) return true
  }
  return false
}

function getEmojiWidth(grapheme: string): number {
  // Regional indicators: single = 1, pair = 2
  const first = grapheme.codePointAt(0)!
  if (first >= 0x1f1e6 && first <= 0x1f1ff) {
    let count = 0
    for (const _ of grapheme) count++
    return count === 1 ? 1 : 2
  }

  // Incomplete keycap: digit/symbol + VS16 without U+20E3
  if (grapheme.length === 2) {
    const second = grapheme.codePointAt(1)
    if (
      second === 0xfe0f &&
      ((first >= 0x30 && first <= 0x39) || first === 0x23 || first === 0x2a)
    ) {
      return 1
    }
  }

  return 2
}

function isZeroWidth(codePoint: number): boolean {
  // Fast path for common printable range
  if (codePoint >= 0x20 && codePoint < 0x7f) return false
  if (codePoint >= 0xa0 && codePoint < 0x0300) return codePoint === 0x00ad

  // Control characters
  if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true

  // Zero-width and invisible characters
  if (
    (codePoint >= 0x200b && codePoint <= 0x200d) || // ZW space/joiner
    codePoint === 0xfeff || // BOM
    (codePoint >= 0x2060 && codePoint <= 0x2064) // Word joiner etc.
  ) {
    return true
  }

  // Variation selectors
  if (
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  ) {
    return true
  }

  // Combining diacritical marks
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  ) {
    return true
  }

  // Indic script combining marks (covers Devanagari through Malayalam)
  if (codePoint >= 0x0900 && codePoint <= 0x0d4f) {
    // Signs and vowel marks at start of each script block
    const offset = codePoint & 0x7f
    if (offset <= 0x03) return true // Signs at block start
    if (offset >= 0x3a && offset <= 0x4f) return true // Vowel signs, virama
    if (offset >= 0x51 && offset <= 0x57) return true // Stress signs
    if (offset >= 0x62 && offset <= 0x63) return true // Vowel signs
  }

  // Thai/Lao combining marks
  // Note: U+0E32 (SARA AA), U+0E33 (SARA AM), U+0EB2, U+0EB3 are spacing vowels (width 1), not combining marks
  if (
    codePoint === 0x0e31 || // Thai MAI HAN-AKAT
    (codePoint >= 0x0e34 && codePoint <= 0x0e3a) || // Thai vowel signs (skip U+0E32, U+0E33)
    (codePoint >= 0x0e47 && codePoint <= 0x0e4e) || // Thai vowel signs and marks
    codePoint === 0x0eb1 || // Lao MAI KAN
    (codePoint >= 0x0eb4 && codePoint <= 0x0ebc) || // Lao vowel signs (skip U+0EB2, U+0EB3)
    (codePoint >= 0x0ec8 && codePoint <= 0x0ecd) // Lao tone marks
  ) {
    return true
  }

  // Arabic formatting
  if (
    (codePoint >= 0x0600 && codePoint <= 0x0605) ||
    codePoint === 0x06dd ||
    codePoint === 0x070f ||
    codePoint === 0x08e2
  ) {
    return true
  }

  // Surrogates, tag characters
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return true
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return true

  return false
}

// Note: complex-script graphemes like Devanagari क्ष (ka+virama+ZWJ+ssa) render
// as a single ligature glyph but occupy 2 terminal cells (wcwidth sums the base
// consonants). Bun.stringWidth=2 matches terminal cell allocation, which is what
// we need for cursor positioning — the JS fallback's grapheme-cluster width of 1
// would desync Ink's layout from the terminal.
//
// Bun.stringWidth is resolved once at module scope rather than checked on every
// call — typeof guards deopt property access and this is a hot path (~100k calls/frame).
const bunStringWidth =
  typeof Bun !== 'undefined' && typeof Bun.stringWidth === 'function'
    ? Bun.stringWidth
    : null

const BUN_STRING_WIDTH_OPTS = { ambiguousIsNarrow: true } as const

// Official 2.1.326 (#222/#223): Indic spacing vowel signs, wide-drawn symbols
// (✌ U+270C, ☝ U+261D, ⛹ U+26F9, ✍ U+270D, etc.), skin-tone modifiers, ZWJ,
// and GNU screen joined-emoji width calibration (328 `m`, `sbr`, `x`, `nFi`, `Ucl`).
const INDIC_WIDE_VOWEL_RE =
  /[\u093b\u093e-\u0940\u0949-\u094c\u0982\u09be-\u09c0\u09c7\u09c8\u09cb\u09cc\u09d7\u0a3e-\u0a40\u0abe-\u0ac0\u0ac9\u0acb\u0acc\u0b02\u0b3e\u0b40\u0b47\u0b48\u0b4b\u0b4c\u0b57\u0bbe\u0bbf\u0bc1\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcc\u0bd7\u0c01\u0c02\u0c41-\u0c44\u0c82\u0cbe\u0cc0-\u0cc4\u0cc7\u0cc8\u0cca\u0ccb\u0cd5\u0cd6\u0d02\u0d3e-\u0d40\u0d46-\u0d48\u0d4a-\u0d4c]/
export const WIDE_SYMBOL_CALIBRATION_RE =
  /[\u17a4\u17d8\u261d\u26f9\u270c\u270d\u2e3a\u2e3b\u3248-\u324f\u{1f1e6}-\u{1f1ff}\u{1f3cb}\u{1f3cc}\u{1f574}\u{1f575}\u{1f590}\u{1f93b}\u{1f946}]/u
const CALIBRATION_NEEDED_RE = new RegExp(
  INDIC_WIDE_VOWEL_RE.source.slice(0, -1) +
    WIDE_SYMBOL_CALIBRATION_RE.source.slice(1),
  'u',
)
const JOINED_OR_MODIFIER_EMOJI_RE =
  /[\u200d\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]/u
const MAX_INDIC_VOWEL_EXTRA = 8

export type EmojiWidthCalibrator = (grapheme: string) => number | undefined

let defaultCustomEmojiWidthCalibrator: EmojiWidthCalibrator | null | undefined

const customEmojiCalibratorHostSlot = new InkHostSlot<{
  hasOverride: boolean
  calibrator: EmojiWidthCalibrator | null | undefined
}>(() => ({
  hasOverride: false,
  calibrator: undefined,
}))

/** Official 2.1.326/328 `Ucl` (#222/#223): register a terminal-specific emoji width calibrator. */
export function setTerminalEmojiWidthCalibrator(
  calibrator: EmojiWidthCalibrator | null | undefined,
): void {
  if (hasInkActiveSessionAls()) {
    const slot = customEmojiCalibratorHostSlot.of()
    slot.hasOverride = true
    slot.calibrator = calibrator
  } else {
    defaultCustomEmojiWidthCalibrator = calibrator
    customEmojiCalibratorHostSlot.delete()
  }
}

/**
 * Official 2.1.326 (#223): GNU screen does not collapse ZWJ / skin-tone /
 * tag-sequence emoji into a single 2-cell glyph; each visible base component
 * advances the cursor independently.
 */
export function isGnuScreenEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env['TMUX']) return false
  if (env['STY']) return true
  return (env['TERM'] ?? '').startsWith('screen')
}

const FORMAT_OR_TAG_RE = /^(?:[\p{Cf}\u2065]|[\u{e0020}-\u{e007f}])$/u

function summedJoinedEmojiWidth(
  grapheme: string,
  countFormatAsOne: boolean,
): number {
  let total = 0
  for (const ch of grapheme) {
    const cp = ch.codePointAt(0)!
    if (cp >= 0xfe00 && cp <= 0xfe0f) {
      continue
    }
    if (FORMAT_OR_TAG_RE.test(ch)) {
      if (countFormatAsOne) total += 1
      continue
    }
    if (cp >= 0x1f3fb && cp <= 0x1f3ff) {
      total += 2
      continue
    }
    total += rawBaseWidth(ch)
  }
  return Math.max(total, 2)
}

function gnuScreenJoinedEmojiWidth(grapheme: string): number {
  return summedJoinedEmojiWidth(grapheme, false)
}

// Official 2.1.328 `MA` / `Ql` / `DS` joined-emoji width profiles keyed by
// lowercase terminal name.
const JOINED_EMOJI_COLLAPSED_2 = new Set([
  'ghostty',
  'xterm-ghostty',
  'konsole',
  'wezterm',
  'foot',
  'foot-extra',
])
const JOINED_EMOJI_SUM_11 = new Set([
  'vscode',
  'codium',
  'cursor',
  'windsurf',
  'antigravity',
  'vte',
  'vte-based',
  'gnome-terminal',
  'terminator',
  'tilix',
  'alacritty',
  'zellij',
  'rxvt',
  'rxvt-unicode-256color',
  'st-256color',
  'eterm-color',
])
const JOINED_EMOJI_SUM_14 = new Set(['apple_terminal', 'mlterm'])
const JOINED_EMOJI_UNCERTAIN = new Set([
  'tmux',
  'tmux-256color',
  'kitty',
  'xterm-kitty',
  'xterm',
  'xterm.js',
])

/**
 * Official 2.1.328 `DS()` — create a terminal-specific emoji width calibrator
 * for the new renderer (`Ucl(DS())`), returning `null` when the terminal is
 * unknown or uncalibrated (daemon, Windows, JetBrains).
 */
export function createTerminalEmojiWidthCalibrator(
  env: Record<string, string | undefined> = process.env,
  versionReply?: string,
  platform: NodeJS.Platform = process.platform,
): EmojiWidthCalibrator | null {
  if (
    env['CLAUDE_CODE_BG_BACKEND'] === 'daemon' ||
    platform === 'win32' ||
    env['TERMINAL_EMULATOR'] === 'JetBrains-JediTerm'
  ) {
    return null
  }
  const replyName = versionReply?.split(/[ (]/)[0]?.toLowerCase()
  const mux = env['TMUX']
    ? 'tmux'
    : env['STY']
      ? 'screen'
      : env['ZELLIJ']
        ? 'zellij'
        : undefined
  const termProgram = env['TERM_PROGRAM']?.toLowerCase()
  const term = env['TERM']?.toLowerCase()
  const candidates =
    replyName !== undefined
      ? [replyName, termProgram]
      : term === 'xterm'
        ? [mux]
        : term === 'screen'
          ? [mux, termProgram]
          : [term, mux, termProgram]

  for (const raw of candidates) {
    if (!raw) continue
    if (raw === 'screen') return gnuScreenJoinedEmojiWidth
    if (JOINED_EMOJI_SUM_14.has(raw)) {
      return grapheme => summedJoinedEmojiWidth(grapheme, true)
    }
    if (JOINED_EMOJI_SUM_11.has(raw)) {
      return grapheme => summedJoinedEmojiWidth(grapheme, false)
    }
    if (JOINED_EMOJI_COLLAPSED_2.has(raw)) {
      return () => 2
    }
    if (JOINED_EMOJI_UNCERTAIN.has(raw)) {
      return () => undefined
    }
  }
  return null
}

function getActiveEmojiCalibrator(): EmojiWidthCalibrator | undefined {
  const slot = customEmojiCalibratorHostSlot.peek()
  const custom = slot?.hasOverride
    ? slot.calibrator
    : defaultCustomEmojiWidthCalibrator
  if (custom === null) {
    return undefined
  }
  if (custom !== undefined) {
    return custom
  }
  return isGnuScreenEnv() ? gnuScreenJoinedEmojiWidth : undefined
}

/** Official 2.1.326 `Lsn`: fast check before paying grapheme segmentation cost. */
export function needsWidthCalibration(str: string): boolean {
  return (
    CALIBRATION_NEEDED_RE.test(str) ||
    (JOINED_OR_MODIFIER_EMOJI_RE.test(str) &&
      getActiveEmojiCalibrator() !== undefined)
  )
}

/** Official 2.1.326 `nFi`: extra cell columns for a single grapheme cluster. */
export function computeGraphemeExtraWidth(
  grapheme: string,
  baseWidth: number,
  calibrator: EmojiWidthCalibrator | undefined = getActiveEmojiCalibrator(),
): number {
  const indicExtra = Math.min(
    grapheme.split(INDIC_WIDE_VOWEL_RE).length - 1,
    MAX_INDIC_VOWEL_EXTRA,
  )
  const symbolExtra =
    baseWidth === 1 && WIDE_SYMBOL_CALIBRATION_RE.test(grapheme) ? 1 : 0
  const emojiExtra =
    calibrator && JOINED_OR_MODIFIER_EMOJI_RE.test(grapheme)
      ? (calibrator(grapheme) ?? 0) - baseWidth
      : 0
  return Math.max(indicExtra + symbolExtra, emojiExtra, 0)
}

function rawBaseWidth(str: string): number {
  return bunStringWidth
    ? bunStringWidth(str, BUN_STRING_WIDTH_OPTS)
    : stringWidthJavaScript(str)
}

function computeCalibrationExtra(str: string): number {
  if (!needsWidthCalibration(str)) {
    return 0
  }
  const calibrator = getActiveEmojiCalibrator()
  const plain = str.includes('\x1b') ? stripAnsi(str) : str
  let extra = 0
  for (const { segment } of getGraphemeSegmenter().segment(plain)) {
    const base = rawBaseWidth(segment)
    extra += computeGraphemeExtraWidth(segment, base, calibrator)
  }
  return extra
}

export function stringWidth(str: string): number {
  if (typeof str !== 'string' || str.length === 0) {
    return 0
  }
  // Fast path (#240): pure printable ASCII — no regex, no ANSI strip, no segmentation.
  let asciiWidth = 0
  let pureAscii = true
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code >= 0x20 && code < 0x7f) {
      asciiWidth++
    } else {
      pureAscii = false
      break
    }
  }
  if (pureAscii) {
    return asciiWidth
  }
  return rawBaseWidth(str) + computeCalibrationExtra(str)
}
