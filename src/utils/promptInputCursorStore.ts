/**
 * densable 2.1.289 valueStore (`nD`) + 2.1.235 cursor sticky (`$4` / acf / Oyr / RgE).
 *
 * Gold `nD(host)` fields: value, active, launchWarning, linkSuppliedTexts,
 * submittedLinkPrefill, vimMode, stash. Local keeps savedCursorOffset for
 * PromptInput remount restore (gold uses P$ cursor field + acf).
 *
 * Survives PromptInput remount (e.g. ctrl+o transcript panel) so NORMAL-mode
 * cursor offset is restored instead of jumping to end.
 */
import { createStore, type Store } from '../state/store.js'
import type { PromptInputMode, VimMode } from '../types/textInputTypes.js'
import type { PastedContent } from './config.js'
import { lastGrapheme } from './intl.js'

export type PromptDraftLaunchWarning = {
  type: string
  prefillLength?: number
  text?: string
} | null

export type PromptDraftStash = {
  text: string
  cursorOffset: number
  mode: PromptInputMode
  pastedContents: Record<number, PastedContent>
  launchWarning?: PromptDraftLaunchWarning
} | null

export type PromptInputCursorState = {
  value: string
  active: boolean
  launchWarning: PromptDraftLaunchWarning
  linkSuppliedTexts: ReadonlySet<string>
  submittedLinkPrefill: string | null
  vimMode: VimMode
  stash: PromptDraftStash
  savedCursorOffset: number | null
}

const initialState: PromptInputCursorState = {
  value: '',
  active: false,
  launchWarning: null,
  linkSuppliedTexts: new Set(),
  submittedLinkPrefill: null,
  vimMode: 'INSERT',
  stash: null,
  savedCursorOffset: null,
}

const store = createStore<PromptInputCursorState>(initialState)

/** densable `nD` — expose the store object for PromptDraftController. */
export function getPromptInputValueStore(): Store<PromptInputCursorState> {
  return store
}

export function getPromptInputCursorState(): PromptInputCursorState {
  return store.getState()
}

/** densable IW.subscribe — PromptInput typing latch / draft value. */
export function subscribePromptInputCursorStore(
  listener: () => void,
): () => void {
  return store.subscribe(listener)
}

/** densable hyr / Zwn / `nQt` — set IW.active (REPL mirrors after commit). */
export function setPromptInputStoreActive(active: boolean): void {
  store.setState(prev => (prev.active === active ? prev : { ...prev, active }))
}

/** densable B4 / `nSr` */
export function getPromptInputStoreValue(): string {
  return store.getState().value
}

/**
 * densable `wLe` / pyt — set value and clear savedCursorOffset.
 * Emptying a non-empty draft clears launchWarning and may record
 * submittedLinkPrefill (gold deep-link path).
 */
export function setPromptInputStoreValue(value: string): void {
  store.setState(prev => {
    if (prev.value === value) return prev
    if (prev.value !== '' && value === '') {
      const trimmed = prev.value.trim()
      const linkSuppliedTexts =
        prev.launchWarning?.type === 'deep-link' &&
        prev.launchWarning.text === undefined
          ? new Set(prev.linkSuppliedTexts).add(trimmed)
          : prev.linkSuppliedTexts
      return {
        ...prev,
        value,
        launchWarning: null,
        linkSuppliedTexts,
        submittedLinkPrefill: linkSuppliedTexts.has(trimmed)
          ? prev.value
          : null,
        savedCursorOffset: null,
      }
    }
    return { ...prev, value, savedCursorOffset: null }
  })
}

/** densable `sSr` */
export function setPromptInputStoreStash(stash: PromptDraftStash): void {
  store.setState(prev => (prev.stash === stash ? prev : { ...prev, stash }))
}

export function getPromptInputStoreStash(): PromptDraftStash {
  return store.getState().stash
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

/** densable q4a / `_xt` */
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
  store.setState(() => ({
    ...initialState,
    linkSuppliedTexts: new Set(),
  }))
}
