/**
 * Official GGy / SFs densable — vim INSERT-mode two-key remaps.
 *
 * Settings key: `vimInsertModeRemaps` e.g. `{"jj":"<Esc>"}`.
 * Each key is exactly two printable graphemes; only target `"<Esc>"` is kept.
 * Applied when editorMode is "vim" (caller responsibility).
 */

import { getGraphemeSegmenter } from '../utils/intl.js'
import { getSettingsForSource } from '../utils/settings/settings.js'

/** Official eqd — max ms between first and second key of a remap sequence. */
export const VIM_INSERT_REMAP_TIMEOUT_MS = 1000

export type VimInsertRemapTarget = '<Esc>'

export type PendingVimInsertRemap = {
  char: string
  at: number
  offsetAfter: number
  /** Official recorded: first key was a single code-unit keystroke. */
  recorded: boolean
}

function countGraphemes(text: string): number {
  if (!text) return 0
  let n = 0
  for (const _ of getGraphemeSegmenter().segment(text)) n++
  return n
}

/**
 * Official GGy — filter/normalize raw settings map to Map(key → "<Esc>").
 * Drops non-string targets, non-"<esc>" targets, and keys that are not
 * exactly two printable (non-control, non-separator) graphemes.
 */
export function parseVimInsertModeRemaps(
  raw: Record<string, unknown> | null | undefined,
): Map<string, VimInsertRemapTarget> {
  const out = new Map<string, VimInsertRemapTarget>()
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string' || value.toLowerCase() !== '<esc>') continue
    const nfc = key.normalize('NFC')
    // Official: /^[^\p{C}\p{Z}]{2}$/u && grapheme count === 2
    if (!/^[^\p{C}\p{Z}]{2}$/u.test(nfc) || countGraphemes(nfc) !== 2) continue
    out.set(nfc, '<Esc>')
  }
  return out
}

/**
 * Official R9t("vimInsertModeRemaps") then GGy — first non-undefined among
 * policySettings / flagSettings / userSettings (official source order).
 */
export function getVimInsertModeRemaps(
  getSource: typeof getSettingsForSource = getSettingsForSource,
): Map<string, VimInsertRemapTarget> {
  for (const source of [
    'policySettings',
    'flagSettings',
    'userSettings',
  ] as const) {
    const value = getSource(source)?.vimInsertModeRemaps
    if (value !== undefined) {
      return parseVimInsertModeRemaps(
        value as Record<string, unknown> | null | undefined,
      )
    }
  }
  return new Map()
}

/** Whether any remap key starts with the given first grapheme (prefix arm). */
export function isVimInsertRemapPrefix(
  remaps: Map<string, VimInsertRemapTarget>,
  first: string,
): boolean {
  if (!first) return false
  for (const key of remaps.keys()) {
    if (key.startsWith(first)) return true
  }
  return false
}

/**
 * Official sequential complete: pending first char + new input forms a remap
 * key within the timeout and at the expected cursor offset.
 */
export function matchPendingVimInsertRemap(
  remaps: Map<string, VimInsertRemapTarget>,
  pending: PendingVimInsertRemap | null,
  input: string,
  offset: number,
  text: string,
  now: number = Date.now(),
): { matchedKey: string; removeLen: number } | null {
  if (!pending || remaps.size === 0) return null
  if (now - pending.at > VIM_INSERT_REMAP_TIMEOUT_MS) return null
  if (offset !== pending.offsetAfter) return null
  // Official: B.text.startsWith(G.char, B.offset - G.char.length)
  const start = offset - pending.char.length
  if (start < 0 || !text.startsWith(pending.char, start)) return null
  // First grapheme of the new keystroke(s)
  let first = ''
  for (const { segment } of getGraphemeSegmenter().segment(input)) {
    first = segment
    break
  }
  if (!first) return null
  const candidate = (pending.char + first).normalize('NFC')
  if (!remaps.has(candidate)) return null
  return { matchedKey: candidate, removeLen: pending.char.length }
}
