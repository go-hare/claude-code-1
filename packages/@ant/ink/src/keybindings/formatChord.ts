/**
 * densable DualInk `R` / `F` / `z` / `q` shortcut display.
 * Gold `B`/`c1` consume this. Never `export function B|c1|R`.
 */
import { parseChord } from './parser.js'
import type { Chord, ParsedKeystroke } from './types.js'

export type ShortcutFormatStyle = 'default' | 'compact' | 'symbol'

export type ShortcutFormatPlatform = 'macos' | 'other'

export type ShortcutFormat = {
  style?: ShortcutFormatStyle
  keyCase?: 'title' | 'lower' | 'glyph'
  modCase?: 'title' | 'lower' | 'glyph'
  caretCtrl?: boolean
  modSep?: string
  arrowSep?: string
  chordSep?: string
  shiftAsCase?: boolean
  charCase?: 'preserve' | 'upper'
  platform?: ShortcutFormatPlatform
}

type ResolvedFormat = {
  keyCase: 'title' | 'lower' | 'glyph'
  modCase: 'title' | 'lower' | 'glyph'
  caretCtrl: boolean
  modSep: string
  arrowSep: string
  chordSep: string
  shiftAsCase: boolean
  charCase: 'preserve' | 'upper'
  platform: ShortcutFormatPlatform
}

/** densable `j` presets. */
const PRESETS: Record<ShortcutFormatStyle, ResolvedFormat> = {
  default: {
    keyCase: 'title',
    modCase: 'lower',
    caretCtrl: false,
    modSep: '+',
    arrowSep: '/',
    chordSep: ' ',
    shiftAsCase: false,
    charCase: 'preserve',
    platform: 'other',
  },
  compact: {
    keyCase: 'lower',
    modCase: 'lower',
    caretCtrl: true,
    modSep: '+',
    arrowSep: '',
    chordSep: ' ',
    shiftAsCase: true,
    charCase: 'preserve',
    platform: 'other',
  },
  symbol: {
    keyCase: 'glyph',
    modCase: 'glyph',
    caretCtrl: false,
    modSep: '',
    arrowSep: '',
    chordSep: ' ',
    shiftAsCase: true,
    charCase: 'upper',
    platform: 'other',
  },
}

const KEY_NAMES: Record<string, [string, string, string]> = {
  enter: ['Enter', 'enter', '⏎'],
  escape: ['Esc', 'esc', '⎋'],
  tab: ['Tab', 'tab', '⇥'],
  ' ': ['Space', 'space', '␣'],
  backspace: ['Backspace', 'backspace', '⌫'],
  delete: ['Delete', 'delete', '⌦'],
  up: ['↑', '↑', '↑'],
  down: ['↓', '↓', '↓'],
  left: ['←', '←', '←'],
  right: ['→', '→', '→'],
  pageup: ['PageUp', 'pgup', '⇞'],
  pagedown: ['PageDown', 'pgdn', '⇟'],
  home: ['Home', 'home', '↖'],
  end: ['End', 'end', '↘'],
}

const CASE_INDEX = { title: 0, lower: 1, glyph: 2 } as const

const ARROW_KEYS = new Set(['up', 'down', 'left', 'right'])

const NO_MODS: Pick<
  ParsedKeystroke,
  'ctrl' | 'alt' | 'shift' | 'meta' | 'super'
> = {
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  super: false,
}

function definedOnly(input: ShortcutFormat): Partial<ResolvedFormat> {
  const out: Partial<ResolvedFormat> = {}
  if (input.keyCase !== undefined) out.keyCase = input.keyCase
  if (input.modCase !== undefined) out.modCase = input.modCase
  if (input.caretCtrl !== undefined) out.caretCtrl = input.caretCtrl
  if (input.modSep !== undefined) out.modSep = input.modSep
  if (input.arrowSep !== undefined) out.arrowSep = input.arrowSep
  if (input.chordSep !== undefined) out.chordSep = input.chordSep
  if (input.shiftAsCase !== undefined) out.shiftAsCase = input.shiftAsCase
  if (input.charCase !== undefined) out.charCase = input.charCase
  if (input.platform !== undefined) out.platform = input.platform
  return out
}

/** densable `F`. */
function resolveFormat(input: ShortcutFormat = {}): ResolvedFormat {
  return {
    ...PRESETS[input.style ?? 'default'],
    ...definedOnly(input),
  }
}

function modNames(ks: ParsedKeystroke): string[] {
  const out: string[] = []
  if (ks.ctrl) out.push('ctrl')
  if (ks.shift) out.push('shift')
  if (ks.alt || ks.meta) out.push('alt')
  if (ks.super) out.push('super')
  return out
}

function formatMod(name: string, format: ResolvedFormat): string {
  switch (name) {
    case 'ctrl':
      return format.modCase === 'title'
        ? 'Ctrl'
        : format.modCase === 'glyph'
          ? '⌃'
          : 'ctrl'
    case 'shift':
      return format.modCase === 'title'
        ? 'Shift'
        : format.modCase === 'glyph'
          ? '⇧'
          : 'shift'
    case 'alt':
      if (format.modCase === 'glyph') return '⌥'
      if (format.modCase === 'title') {
        return format.platform === 'macos' ? 'Opt' : 'Alt'
      }
      return format.platform === 'macos' ? 'opt' : 'alt'
    case 'super':
      if (format.modCase === 'glyph') return '⌘'
      if (format.modCase === 'title') {
        return format.platform === 'macos' ? 'Cmd' : 'Super'
      }
      return format.platform === 'macos' ? 'cmd' : 'super'
    default:
      return name
  }
}

function formatKey(key: string, format: ResolvedFormat): string {
  const named = KEY_NAMES[key]
  if (named) return named[CASE_INDEX[format.keyCase]]
  return format.charCase === 'upper' ? key.toUpperCase() : key
}

function isShiftLetter(ks: ParsedKeystroke): boolean {
  return (
    ks.shift &&
    !ks.ctrl &&
    !ks.alt &&
    !ks.meta &&
    !ks.super &&
    ks.key.length === 1 &&
    ks.key >= 'a' &&
    ks.key <= 'z'
  )
}

/** densable `z`. */
function formatKeystroke(ks: ParsedKeystroke, format: ResolvedFormat): string {
  if (format.shiftAsCase && isShiftLetter(ks)) return ks.key.toUpperCase()
  const mods = modNames(ks)
  const key = formatKey(ks.key, format)
  if (format.caretCtrl && mods.length === 1 && mods[0] === 'ctrl') {
    return `^${key}`
  }
  if (format.modCase === 'glyph') {
    return mods.map(m => formatMod(m, format)).join('') + key
  }
  return [...mods.map(m => formatMod(m, format)), key].join(format.modSep)
}

function visibleMods(ks: ParsedKeystroke, format: ResolvedFormat): string[] {
  if (format.shiftAsCase && isShiftLetter(ks)) return []
  return modNames(ks)
}

function sameVisibleMods(
  a: ParsedKeystroke,
  b: ParsedKeystroke,
  format: ResolvedFormat,
): boolean {
  const left = visibleMods(a, format)
  const right = visibleMods(b, format)
  return left.length === right.length && left.every((m, i) => m === right[i])
}

/** densable `I` — shared modifier prefix across single-stroke chords. */
function sharedModStroke(
  strokes: ParsedKeystroke[],
  format: ResolvedFormat,
): ParsedKeystroke | undefined {
  const first = strokes[0]
  if (!first || visibleMods(first, format).length === 0) return undefined
  return strokes.slice(1).every(ks => sameVisibleMods(first, ks, format))
    ? first
    : undefined
}

function sharedModPrefix(ks: ParsedKeystroke, format: ResolvedFormat): string {
  const mods = modNames(ks)
  if (format.caretCtrl && mods.length === 1 && mods[0] === 'ctrl') return '^'
  if (format.modCase === 'glyph') {
    return mods.map(m => formatMod(m, format)).join('')
  }
  return mods.map(m => formatMod(m, format)).join(format.modSep) + format.modSep
}

/**
 * densable `R` — format one or more chords (each chord is a keystroke list).
 */
export function formatChords(
  chords: readonly Chord[],
  options: ShortcutFormat = {},
): string {
  const format = resolveFormat(options)
  const one = (chord: Chord) =>
    chord.map(ks => formatKeystroke(ks, format)).join(format.chordSep)
  if (chords.length === 0) return ''
  if (chords.length === 1) return one(chords[0]!)
  const singles = chords.every(c => c.length === 1)
    ? chords.map(c => c[0]!)
    : undefined
  if (!singles) return chords.map(one).join('/')
  const shared = sharedModStroke(singles, format)
  const sep =
    singles.every(ks => ARROW_KEYS.has(ks.key)) &&
    (shared !== undefined ||
      singles.every(ks => visibleMods(ks, format).length === 0))
      ? format.arrowSep
      : '/'
  if (shared) {
    const keys = singles.map(ks =>
      formatKeystroke({ ...ks, ...NO_MODS }, format),
    )
    return sharedModPrefix(shared, format) + keys.join(sep)
  }
  return singles.map(ks => formatKeystroke(ks, format)).join(sep)
}

/**
 * densable `v` — format a DualInk `chord` string (or list of chord strings).
 */
export function formatShortcutString(
  chord: string | readonly string[],
  options: ShortcutFormat = {},
): string {
  const parts = (typeof chord === 'string' ? [chord] : chord).filter(
    part => part !== '',
  )
  return formatChords(
    parts.map(part => parseChord(part)),
    options,
  )
}

/** densable `S` — macos vs other. */
export function shortcutFormatPlatform(): ShortcutFormatPlatform {
  return process.platform === 'darwin' ? 'macos' : 'other'
}
