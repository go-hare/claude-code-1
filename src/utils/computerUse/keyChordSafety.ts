/**
 * 2.1.323 #2200: macOS/cross-platform computer-use key chord & system shortcut
 * guardrails (aligned with official `chunk-sks3v3p9` `Z`/`Q`/`ee`/`fen`/`le`/`ue`).
 */

const MODIFIER_ALIASES: Record<string, 'ctrl' | 'alt' | 'shift' | 'meta'> = {
  meta: 'meta',
  super: 'meta',
  command: 'meta',
  cmd: 'meta',
  windows: 'meta',
  win: 'meta',
  ctrl: 'ctrl',
  control: 'ctrl',
  lctrl: 'ctrl',
  lcontrol: 'ctrl',
  rctrl: 'ctrl',
  rcontrol: 'ctrl',
  shift: 'shift',
  lshift: 'shift',
  rshift: 'shift',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  del: 'delete',
  ' ': 'space',
  '\t': 'tab',
  '\x1b': 'escape',
  '\x7f': 'delete',
}

const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const

const ALL_MODIFIERS = new Set(Object.keys(MODIFIER_ALIASES))
const SHIFT_ONLY_MODIFIERS = new Set(['shift', 'lshift', 'rshift'])
const CTRL_OR_OPTION_MODIFIERS = new Set([
  'control',
  'ctrl',
  'lcontrol',
  'lctrl',
  'rcontrol',
  'rctrl',
  'alt',
  'option',
  'opt',
])
const NAV_KEYS = new Set([
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'page_up',
  'page_down',
])

export const MAX_CHORD_COMPONENTS = 8

/**
 * Official `le`: macOS system shortcuts that require the `systemKeyCombos` grant.
 * 2.1.323 #2200 adds `ctrl+f2`, `ctrl+f3`, `ctrl+f8`, `ctrl+up`, `ctrl+down`,
 * `ctrl+meta+q`, `alt+meta+escape`, `shift+meta+q`, `alt+shift+meta+q`, etc.
 */
export const MACOS_SYSTEM_KEY_COMBOS: ReadonlySet<string> = new Set([
  'meta+q',
  'shift+meta+q',
  'alt+shift+meta+q',
  'alt+meta+escape',
  'meta+tab',
  'shift+meta+tab',
  'meta+space',
  'ctrl+meta+q',
  'ctrl+f2',
  'ctrl+f3',
  'ctrl+f8',
  'ctrl+up',
  'ctrl+down',
])

/**
 * Official `ue`: Windows/Linux system shortcuts that require the `systemKeyCombos` grant.
 */
export const NON_MACOS_SYSTEM_KEY_COMBOS: ReadonlySet<string> = new Set([
  'ctrl+alt+delete',
  'alt+f4',
  'alt+tab',
  'alt+shift+tab',
  'ctrl+alt+tab',
  'ctrl+alt+shift+tab',
  'meta+l',
  'meta+d',
  'meta+r',
  'meta+e',
  'meta+s',
  'meta+q',
  'ctrl+escape',
  'meta+i',
  'meta+u',
  'meta+x',
])

function sortMods(mods: string[]): string[] {
  return [...new Set(mods)].sort(
    (a, b) =>
      MODIFIER_ORDER.indexOf(a as (typeof MODIFIER_ORDER)[number]) -
      MODIFIER_ORDER.indexOf(b as (typeof MODIFIER_ORDER)[number]),
  )
}

function parseChordString(chord: string): {
  mods: string[]
  keys: string[]
  ordered: Array<{ name: string; isMod: boolean }>
} {
  const ordered: Array<{ name: string; isMod: boolean }> = []
  for (const part of chord.toLowerCase().split('+')) {
    let token = part.trim()
    if (token === '') {
      if (part.length === 1) token = part
      else continue
    }
    const mod = MODIFIER_ALIASES[token]
    if (mod !== undefined) {
      ordered.push({ name: mod, isMod: true })
    } else {
      ordered.push({ name: KEY_ALIASES[token] ?? token, isMod: false })
    }
  }
  const mods = sortMods(ordered.filter(e => e.isMod).map(e => e.name))
  const keys = ordered.filter(e => !e.isMod).map(e => e.name)
  return { mods, keys, ordered }
}

/**
 * Official `fen` / `Zhs`: checks whether a chord matches a restricted system shortcut.
 */
export function isSystemKeyCombo(
  chord: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const table =
    platform === 'darwin'
      ? MACOS_SYSTEM_KEY_COMBOS
      : NON_MACOS_SYSTEM_KEY_COMBOS
  const { mods, keys, ordered } = parseChordString(chord)
  if (keys.length === 0) return table.has(mods.join('+'))
  const prefix = mods.length > 0 ? `${mods.join('+')}+` : ''
  for (const k of keys) {
    if (table.has(prefix + k)) return true
  }
  const seenMods: string[] = []
  for (const item of ordered) {
    if (item.isMod) {
      seenMods.push(item.name)
    } else {
      const sorted = sortMods(seenMods)
      const p = sorted.length > 0 ? `${sorted.join('+')}+` : ''
      if (table.has(p + item.name)) return true
    }
  }
  return false
}

function cleanComponents(parts: readonly string[]): string[] {
  return parts.flatMap(p => {
    const trimmed = p.trim()
    if (trimmed !== '') return [trimmed]
    return p.length === 1 ? [p] : []
  })
}

function isSpaceOrInvisibleKey(key: string): boolean {
  return key.toLowerCase() === 'space' || /^[\p{Zs}\p{Cf}]$/u.test(key)
}

/**
 * Official `G(parts)`: true if the keys hold Control or Option together with Space
 * (or a Unicode space/format character).
 */
export function isControlOrOptionWithSpace(parts: readonly string[]): boolean {
  const cleaned = cleanComponents(parts)
  return (
    cleaned.some(p => CTRL_OR_OPTION_MODIFIERS.has(p.toLowerCase())) &&
    cleaned.some(isSpaceOrInvisibleKey)
  )
}

function formatChordForError(parts: readonly string[]): string {
  const shown = parts
    .slice(0, MAX_CHORD_COMPONENTS)
    .map(p => (p.length > 32 ? `${p.slice(0, 32)}…` : p))
    .join('+')
  const extra = parts.length - MAX_CHORD_COMPONENTS
  return extra > 0
    ? `${JSON.stringify(shown)} (+${extra} more)`
    : JSON.stringify(shown)
}

function powerSet<T>(arr: readonly T[]): T[][] {
  return arr.reduce<T[][]>(
    (acc, item) => acc.concat(acc.map(subset => [...subset, item])),
    [[]],
  )
}

function extractMods(parts: readonly string[]): string[] {
  const modStr = parts.filter(p => ALL_MODIFIERS.has(p.toLowerCase())).join('+')
  if (!modStr) return []
  return parseChordString(modStr).mods
}

function extractNonMods(parts: readonly string[]): string[] {
  return parts
    .filter(p => !ALL_MODIFIERS.has(p.toLowerCase()))
    .map(p => (isSpaceOrInvisibleKey(p) ? 'space' : p))
}

export type KeyChordValidationOptions = {
  platform?: NodeJS.Platform
  allowSystemKeyCombos?: boolean
  heldKeys?: readonly string[]
}

/**
 * Active held chords across concurrent computer-use calls in this process.
 */
const activeHeldChords = new Set<string[]>()

export function getActiveHeldKeys(): string[] {
  const out: string[] = []
  for (const chord of activeHeldChords) {
    out.push(...chord)
  }
  return out
}

export function trackHeldChord(keys: readonly string[]): () => void {
  const copy = [...keys]
  activeHeldChords.add(copy)
  return () => {
    activeHeldChords.delete(copy)
  }
}

/**
 * Validates and enforces 2.1.323 #2200 key chord safety rules on macOS (and
 * system shortcuts on all platforms). Throws an Error describing why the chord
 * was refused when blocked.
 */
export function assertSafeKeyChord(
  rawParts: readonly string[],
  label: 'Key chord' | 'Hold key' | 'Typed text' = 'Key chord',
  options: KeyChordValidationOptions = {},
): string[] {
  const platform = options.platform ?? process.platform
  const parts = cleanComponents(rawParts)

  if (parts.length > MAX_CHORD_COMPONENTS) {
    throw new Error(
      `${label} ${formatChordForError(parts)} has ${parts.length} components; at most ${MAX_CHORD_COMPONENTS} are allowed. Send one key, with its modifiers, per action.`,
    )
  }

  const mods = parts.filter(p => ALL_MODIFIERS.has(p.toLowerCase()))
  const nonMods = parts.filter(p => !ALL_MODIFIERS.has(p.toLowerCase()))
  if (
    nonMods.length > 1 &&
    !(
      label === 'Key chord' &&
      mods.every(m => SHIFT_ONLY_MODIFIERS.has(m.toLowerCase())) &&
      nonMods.every(k => NAV_KEYS.has(k.toLowerCase()))
    )
  ) {
    throw new Error(
      `${label} ${formatChordForError(parts)} has ${nonMods.length} keys that are not modifiers; a chord is modifier keys plus at most one other key. Send a separate action for each key.`,
    )
  }

  const heldKeys = options.heldKeys ?? getActiveHeldKeys()

  // 2.1.323 #2200: on macOS, refuse Space with Control or Option held (always, even with systemKeyCombos)
  if (platform === 'darwin') {
    if (isControlOrOptionWithSpace(parts)) {
      throw new Error(
        `${label} ${formatChordForError(parts)} was refused and nothing was pressed: Space with Control or Option held can open an app launcher, which is outside the apps you have access to. If this shortcut is needed, ask the user to press it.`,
      )
    }
    if (
      heldKeys.length > 0 &&
      isControlOrOptionWithSpace([...heldKeys, ...parts])
    ) {
      if (label === 'Typed text') {
        throw new Error(
          'A space or invisible character in the typed text was refused: another action is holding Control or Option, and together they can open an app launcher. Earlier characters may already have been typed, so check before you try again once that action has finished.',
        )
      }
      throw new Error(
        `${label} ${formatChordForError(parts)} was refused and nothing was pressed: another action is holding Control, Option or Space, and together they can open an app launcher. Try again once that action has finished.`,
      )
    }
  }

  // System shortcut checks (direct and combined with held keys) when systemKeyCombos is not granted
  if (!options.allowSystemKeyCombos) {
    const chordStr = parts.join('+')
    if (isSystemKeyCombo(chordStr, platform)) {
      throw new Error(
        `${label} ${formatChordForError(parts)} was refused and nothing was pressed: it is a system shortcut that requires the \`systemKeyCombos\` grant via request_access.`,
      )
    }
    if (heldKeys.length > 0) {
      const cleanedHeld = cleanComponents(heldKeys)
      const partMods = extractMods(parts)
      const heldMods = extractMods(cleanedHeld)
      const allMods = [...new Set([...heldMods, ...partMods])]
      const partNonMods = extractNonMods(parts)
      const heldNonMods = extractNonMods(cleanedHeld)
      const combinedMatchesSystem = powerSet(allMods).some(subset => {
        const candidates = [
          ...(subset.some(m => partMods.includes(m)) ? heldNonMods : []),
          ...(subset.some(m => heldMods.includes(m)) ? partNonMods : []),
        ]
        return candidates.some(k =>
          isSystemKeyCombo([...subset, k].join('+'), platform),
        )
      })
      if (combinedMatchesSystem) {
        if (label === 'Typed text') {
          throw new Error(
            'A character in the typed text was refused: together with keys another action is pressing, it would make a system shortcut. Earlier characters may already have been typed, so check before you try again once that action has finished.',
          )
        }
        throw new Error(
          `${label} ${formatChordForError(parts)} was refused: together with keys another action is pressing, it would make a system shortcut. Try again once that action has finished, or request the \`systemKeyCombos\` grant via request_access if you need the shortcut.`,
        )
      }
    }
  }

  return parts
}
