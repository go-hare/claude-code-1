/**
 * densable 2.1.235 #15 — PromptInput cursor/vim sticky store ($4 / acf / Oyr / RgE).
 *
 * Survives PromptInput remount (e.g. ctrl+o transcript panel) so NORMAL-mode
 * cursor offset is restored instead of jumping to end.
 */
import { createStore } from '../state/store.js'
import type { VimMode } from '../types/textInputTypes.js'
import { lastGrapheme } from './intl.js'

export type PromptInputCursorState = {
  value: string
  active: boolean
  launchWarning: { type: string; prefillLength: number } | null
  vimMode: VimMode
  savedCursorOffset: number | null
}

const initialState: PromptInputCursorState = {
  value: '',
  active: false,
  launchWarning: null,
  vimMode: 'INSERT',
  savedCursorOffset: null,
}

const store = createStore<PromptInputCursorState>(initialState)

export function getPromptInputCursorState(): PromptInputCursorState {
  return store.getState()
}

/** densable B4 */
export function getPromptInputStoreValue(): string {
  return store.getState().value
}

/** densable pyt — set value and clear savedCursorOffset (and launchWarning on empty). */
export function setPromptInputStoreValue(value: string): void {
  store.setState(prev => {
    if (prev.value === value) return prev
    if (prev.launchWarning !== null && prev.value !== '' && value === '') {
      return {
        ...prev,
        value,
        launchWarning: null,
        savedCursorOffset: null,
      }
    }
    return { ...prev, value, savedCursorOffset: null }
  })
}

/** densable acf — persist cursor offset across remount. */
export function savePromptInputCursorOffset(offset: number): void {
  store.setState(prev =>
    prev.savedCursorOffset === offset
      ? prev
      : { ...prev, savedCursorOffset: offset },
  )
}

export function getSavedPromptInputCursorOffset(): number | null {
  return store.getState().savedCursorOffset
}

/** densable q4a */
export function setPromptInputStoreVimMode(vimMode: VimMode): void {
  store.setState(prev =>
    prev.vimMode === vimMode ? prev : { ...prev, vimMode },
  )
}

export function getPromptInputStoreVimMode(): VimMode {
  return store.getState().vimMode
}

/**
 * densable RgE — VISUAL / VISUAL LINE collapse to NORMAL for cursor restore
 * decisions (preserve NORMAL-like caret on remount). Local VimMode is still
 * INSERT|NORMAL only; string widen keeps SEA parity without inventing VISUAL.
 */
export function normalizeVimModeForCursorRestore(
  mode: VimMode | string,
): VimMode {
  if (mode === 'VISUAL' || mode === 'VISUAL LINE') return 'NORMAL'
  return mode as VimMode
}

/**
 * densable Oyr — when restoring NORMAL caret, avoid landing past the last
 * grapheme of the current line / EOF (cursor sits on last char, not after).
 */
export function clampNormalModeCursorOffset(
  text: string,
  offset: number,
): number {
  if (text[offset] === '\n' && offset > 0 && text[offset - 1] !== '\n') {
    const last = lastGrapheme(text.slice(0, offset))
    return offset - (last.length || 1)
  }
  if (offset >= text.length && !text.endsWith('\n')) {
    const last = lastGrapheme(text)
    return Math.max(0, text.length - (last.length || 1))
  }
  return offset
}

/**
 * densable PromptInput useState initializer for cursorOffset.
 */
export function resolveRemountCursorOffset(options: {
  input: string
  vimEnabled: boolean
  vimMode: VimMode
}): number {
  const nfc = options.input.normalize('NFC')
  const saved = getSavedPromptInputCursorOffset()
  const base =
    saved !== null && saved <= options.input.length
      ? saved
      : options.input.length
  if (
    options.vimEnabled &&
    normalizeVimModeForCursorRestore(options.vimMode) === 'NORMAL'
  ) {
    return clampNormalModeCursorOffset(nfc, base)
  }
  return base
}

/** Test helper — reset module store. */
export function resetPromptInputCursorStoreForTests(): void {
  store.setState(() => ({ ...initialState }))
}
