/**
 * densable 2.1.289 PromptDraftController ≈ gold `P$`.
 *
 * Owns the rich draft snapshot (value/cursor/mode/pasted/stash flags/…).
 * Persists durable fields through `promptInputCursorStore` ≈ `nD` via
 * `setPromptInputStoreValue` ≈ `wLe` and `setPromptInputStoreActive` ≈ `nQt`.
 *
 * Write rules (gold `#y`):
 * - `setValue` / `setValueTyped` / `setValueWithCursor` / `insertText` /
 *   `clear` / stash restore → store write + `onEdit(new, old)` + active latch
 * - `setValueRaw` → store write only (no onEdit, no active latch)
 *
 * Do not export minify names (`P$`, `nD`, `wLe`, `nQt`).
 */
import type { PastedContent } from './config.js'
import {
  clearHeldClearedDraft,
  holdCleared,
  restoreCleared,
} from './clearedDraftHold.js'
import {
  getPromptInputCursorState,
  getPromptInputValueStore,
  setPromptInputStoreActive,
  setPromptInputStoreStash,
  setPromptInputStoreValue,
  type PromptDraftLaunchWarning,
  type PromptDraftStash,
} from './promptInputCursorStore.js'
import type { PromptInputMode } from '../types/textInputTypes.js'
import type { Store } from '../state/store.js'
import type { PromptInputCursorState } from './promptInputCursorStore.js'

/** densable `Xwt` — clear `active` after idle typing. */
export const PROMPT_DRAFT_ACTIVE_MS = 1500

export type PromptDraftDecorationRun = {
  start: number
  end: number
  // Keep opaque — PromptInput paint path fills this later.
  style?: unknown
}

export type PromptDraftSnapshot = {
  value: string
  cursorOffset: number
  mode: PromptInputMode
  pastedContents: Record<number, PastedContent>
  stashedPrompt: PromptDraftStash
  isInputOverlayActive: boolean
  isVimEditing: boolean
  inputOwnsEscape: boolean
  interimRange: { start: number; end: number } | null
  decorations: readonly PromptDraftDecorationRun[]
}

export type PromptDraftWriteSource = 'input' | 'outside'

export type PromptDraftControllerOptions = {
  valueStore?: Store<PromptInputCursorState>
  scheduleTimeout?: (
    fn: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>
  clearTimeout?: (id: ReturnType<typeof setTimeout>) => void
  rewriteEdit?: (next: string, prev: string) => string
  onEdit?: (next: string, prev: string) => void
}

const EMPTY_DECORATIONS: readonly PromptDraftDecorationRun[] = Object.freeze([])

const SNAPSHOT_KEYS = [
  'value',
  'cursorOffset',
  'mode',
  'pastedContents',
  'stashedPrompt',
  'isInputOverlayActive',
  'isVimEditing',
  'inputOwnsEscape',
  'interimRange',
  'decorations',
] as const satisfies ReadonlyArray<keyof PromptDraftSnapshot>

function isSingleCharAppend(prev: string, next: string): boolean {
  return next.length === prev.length + 1 && next.startsWith(prev)
}

export class PromptDraftController {
  readonly #valueStore: Store<PromptInputCursorState>
  readonly #scheduleTimeout: (
    fn: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>
  readonly #clearTimeout: (id: ReturnType<typeof setTimeout>) => void
  readonly #rewriteEdit: (next: string, prev: string) => string
  readonly #onEdit: (next: string, prev: string) => void
  readonly #listeners = new Set<() => void>()
  readonly #submitListeners = new Set<
    (payload: unknown, fromKeybinding: boolean) => void
  >()

  #snapshot: PromptDraftSnapshot
  #activeTimer: ReturnType<typeof setTimeout> | null = null
  #pendingCursorWrite: { value: string; cursorOffset: number } | null = null
  #changedFromOutside = false
  #typedOnly = true
  #paintCarry: {
    value: string
    runs: readonly PromptDraftDecorationRun[]
  } | null = null
  #submitRefCount = 0
  #disposed = false
  #unsubStore: () => void

  constructor(options: PromptDraftControllerOptions = {}) {
    this.#valueStore = options.valueStore ?? getPromptInputValueStore()
    this.#scheduleTimeout = options.scheduleTimeout ?? setTimeout
    this.#clearTimeout = options.clearTimeout ?? clearTimeout
    this.#rewriteEdit = options.rewriteEdit ?? ((next: string) => next)
    this.#onEdit = options.onEdit ?? (() => {})

    const { value, stash } = this.#valueStore.getState()
    this.#typedOnly = value === ''
    this.#snapshot = {
      value,
      cursorOffset: value.length,
      mode: 'prompt',
      pastedContents: {},
      stashedPrompt: stash,
      isInputOverlayActive: false,
      isVimEditing: false,
      inputOwnsEscape: false,
      interimRange: null,
      decorations: EMPTY_DECORATIONS,
    }
    this.#unsubStore = this.#valueStore.subscribe(this.#onStoreChange)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  getSnapshot = (): PromptDraftSnapshot => this.#snapshot

  get value(): string {
    return this.#snapshot.value
  }

  get cursorOffset(): number {
    return this.#snapshot.cursorOffset
  }

  get mode(): PromptInputMode {
    return this.#snapshot.mode
  }

  get pastedContents(): Record<number, PastedContent> {
    return this.#snapshot.pastedContents
  }

  get stashedPrompt(): PromptDraftStash {
    return this.#snapshot.stashedPrompt
  }

  get changedFromOutside(): boolean {
    return this.#changedFromOutside
  }

  get typedOnly(): boolean {
    return this.#typedOnly
  }

  setValue = (value: string): void => {
    this.#write(value, undefined, 'input')
  }

  setValueTyped = (value: string): void => {
    this.#write(value, undefined, 'input', true)
  }

  setValueWithCursor = (value: string, cursorOffset: number): void => {
    this.#write(value, cursorOffset, 'input')
  }

  replaceValue = (value: string): void => {
    this.#write(value, value.length, 'outside')
  }

  /** densable `setValueRaw` — `wLe` only; no onEdit / active latch. */
  setValueRaw = (value: string): void => {
    setPromptInputStoreValue(value)
  }

  setCursorOffset = (cursorOffset: number): void => {
    this.#patch({ cursorOffset })
  }

  insertText = (
    text: string,
    source: PromptDraftWriteSource = 'input',
  ): void => {
    const { value, cursorOffset } = this.#snapshot
    this.#write(
      value.slice(0, cursorOffset) + text + value.slice(cursorOffset),
      cursorOffset + text.length,
      source,
    )
  }

  clear = (): void => {
    this.#write('', 0, 'outside')
    this.#patch({ pastedContents: {} })
  }

  setMode = (mode: PromptInputMode): void => {
    this.#patch({ mode })
  }

  setPastedContents = (
    next:
      | Record<number, PastedContent>
      | ((
          prev: Record<number, PastedContent>,
        ) => Record<number, PastedContent>),
  ): void => {
    const pastedContents =
      typeof next === 'function' ? next(this.#snapshot.pastedContents) : next
    this.#patch({ pastedContents })
  }

  stash = (): void => {
    const { value, cursorOffset, mode, pastedContents } = this.#snapshot
    const launchWarning = this.#valueStore.getState().launchWarning
    const payload: NonNullable<PromptDraftStash> = {
      text: value,
      cursorOffset,
      mode,
      pastedContents,
      launchWarning: launchWarning ?? undefined,
    }
    setPromptInputStoreStash(payload)
    this.#write('', 0, 'input')
    this.#patch({ pastedContents: {}, mode: 'prompt' })
  }

  popStash = (source: PromptDraftWriteSource = 'outside'): boolean => {
    const stash = this.#valueStore.getState().stash
    if (stash === null) return false
    setPromptInputStoreStash(null)
    this.#write(stash.text, stash.cursorOffset, source)
    this.#patch({
      pastedContents: stash.pastedContents,
      mode: stash.mode,
    })
    return true
  }

  holdCleared = (): void => {
    const { value, mode, pastedContents } = this.#snapshot
    holdCleared({ text: value, mode, pastedContents })
  }

  restoreCleared = (): boolean => {
    const held = restoreCleared(this.#snapshot.value)
    if (held === null) return false
    this.#write(held.text, held.text.length, 'input')
    this.#patch({
      pastedContents: held.pastedContents,
      mode: held.mode,
    })
    return true
  }

  setInputOverlayActive = (isInputOverlayActive: boolean): void => {
    this.#patch({ isInputOverlayActive })
  }

  setVimEditing = (isVimEditing: boolean): void => {
    this.#patch({ isVimEditing })
  }

  setInputOwnsEscape = (inputOwnsEscape: boolean): void => {
    this.#patch({ inputOwnsEscape })
  }

  setInterimRange = (
    interimRange: { start: number; end: number } | null,
  ): void => {
    const prev = this.#snapshot.interimRange
    if (
      interimRange !== null &&
      prev !== null &&
      interimRange.start === prev.start &&
      interimRange.end === prev.end
    ) {
      return
    }
    this.#patch({ interimRange })
  }

  paint = (runs: readonly PromptDraftDecorationRun[]): void => {
    if (runs.length === 0 && this.#paintCarry === null) return
    this.#paintCarry =
      runs.length === 0
        ? null
        : { value: this.#snapshot.value, runs: [...runs] }
    this.#patch({})
  }

  submit = (payload: unknown, fromKeybinding = false): boolean => {
    if (this.#submitRefCount === 0) return false
    for (const listener of this.#submitListeners) {
      listener(payload, fromKeybinding)
    }
    return true
  }

  onSubmitRequest = (
    listener: (payload: unknown, fromKeybinding: boolean) => void,
  ): (() => void) => {
    this.#submitListeners.add(listener)
    this.#submitRefCount++
    let alive = true
    return () => {
      if (!alive) return
      alive = false
      this.#submitRefCount--
      this.#submitListeners.delete(listener)
    }
  }

  dispose = (): void => {
    if (this.#disposed) return
    this.#disposed = true
    this.#unsubStore()
    if (this.#activeTimer !== null) {
      this.#clearTimeout(this.#activeTimer)
      this.#activeTimer = null
      setPromptInputStoreActive(false)
    }
    this.#submitListeners.clear()
    this.#submitRefCount = 0
    this.#listeners.clear()
  }

  #emit = (): void => {
    for (const listener of this.#listeners) listener()
  }

  #patch = (partial: Partial<PromptDraftSnapshot>): void => {
    const prev = this.#snapshot
    const next: PromptDraftSnapshot = {
      ...prev,
      ...partial,
      cursorOffset: Math.max(
        0,
        Math.min(
          (partial.value ?? prev.value).length,
          partial.cursorOffset ?? prev.cursorOffset,
        ),
      ),
    }
    if (next.value !== prev.value) {
      this.#paintCarry = null
    }
    next.decorations =
      this.#paintCarry?.value === next.value
        ? this.#paintCarry.runs
        : EMPTY_DECORATIONS
    if (SNAPSHOT_KEYS.every(key => Object.is(next[key], prev[key]))) return
    this.#snapshot = next
    this.#emit()
  }

  #onStoreChange = (): void => {
    const { value, stash } = this.#valueStore.getState()
    const stashPrompt = stash
    if (value === this.#snapshot.value) {
      this.#patch({ stashedPrompt: stashPrompt })
      return
    }
    const pending = this.#pendingCursorWrite
    const keepCursor = pending !== null && pending.value === value
    if (!keepCursor) {
      this.#changedFromOutside = true
      this.#typedOnly = value === ''
    }
    this.#patch({
      value,
      cursorOffset: keepCursor ? pending.cursorOffset : value.length,
      stashedPrompt: stashPrompt,
    })
  }

  #write = (
    nextRaw: string,
    cursorOffset: number | undefined,
    source: PromptDraftWriteSource,
    keepTypedOnly = false,
  ): void => {
    if (this.#disposed) return
    const prev = this.#snapshot.value
    const next = this.#rewriteEdit(nextRaw, prev)
    const nextCursor = cursorOffset ?? this.#snapshot.cursorOffset
    if (next === prev) {
      if (source === 'input' && nextCursor !== this.#snapshot.cursorOffset) {
        this.#patch({ cursorOffset: nextCursor })
      }
      return
    }
    if (source === 'input') {
      this.#changedFromOutside = false
    } else {
      this.#changedFromOutside = true
    }
    if (source === 'outside' && next === '') {
      clearHeldClearedDraft()
    }
    if (next === '') {
      this.#typedOnly = true
    } else if (
      this.#typedOnly &&
      !(keepTypedOnly && isSingleCharAppend(prev, next))
    ) {
      this.#typedOnly = false
    }

    this.#pendingCursorWrite = { value: next, cursorOffset: nextCursor }
    setPromptInputStoreValue(next)
    this.#pendingCursorWrite = null

    // If store short-circuited (same value), still update cursor for input path.
    if (this.#snapshot.value === next && source === 'input') {
      this.#patch({ cursorOffset: nextCursor })
    }

    this.#onEdit(next, prev)
    this.#bumpActive(next.trim().length > 0)
  }

  #bumpActive = (active: boolean): void => {
    if (this.#disposed) return
    setPromptInputStoreActive(active)
    if (this.#activeTimer !== null) {
      this.#clearTimeout(this.#activeTimer)
      this.#activeTimer = null
    }
    if (!active) return
    this.#activeTimer = this.#scheduleTimeout(() => {
      this.#activeTimer = null
      setPromptInputStoreActive(false)
    }, PROMPT_DRAFT_ACTIVE_MS)
  }
}

/** Convenience: seed store then build a controller. */
export function createPromptDraftController(
  options: PromptDraftControllerOptions & { initialValue?: string } = {},
): PromptDraftController {
  if (options.initialValue !== undefined) {
    setPromptInputStoreValue(options.initialValue)
  }
  // Touch store so callers that only import controller still share state.
  void getPromptInputCursorState()
  return new PromptDraftController(options)
}

// Re-export for consumers that only import the controller module.
export type { PromptDraftLaunchWarning, PromptDraftStash }
