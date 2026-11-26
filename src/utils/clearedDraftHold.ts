/**
 * densable 2.1.289 draft `#S` — holdCleared / restoreCleared.
 *
 * Ctrl+C on a non-empty prompt calls holdCleared before clearing.
 * Up on an empty prompt calls restoreCleared before history/queue.
 * Outside clears of the value to empty drop the held draft (gold clear
 * path with source "outside").
 */

import type { PastedContent } from './config.js'
import type { PromptInputMode } from '../types/textInputTypes.js'
import { keepClearedDraftToHistory } from '../history.js'
import { getBootstrapSession, RootSessionSlot } from './sessionHost.js'

export type HeldClearedDraft = {
  text: string
  mode: PromptInputMode
  pastedContents: Record<number, PastedContent>
  clearedAt: number
  intoHistory: boolean
}

class ClearedDraftHoldSessionState {
  held: HeldClearedDraft | null = null
  justHeld = false
}

const fallbackClearedDraftHoldSession = { root: {} as object }
const clearedDraftHoldBySession =
  new RootSessionSlot<ClearedDraftHoldSessionState>(
    () => new ClearedDraftHoldSessionState(),
  )

function getClearedDraftHoldState(): ClearedDraftHoldSessionState {
  try {
    const session = getBootstrapSession()
    if (session?.root) return clearedDraftHoldBySession.of(session)
  } catch {
    // Fall back when sessionHost is mocked
  }
  return clearedDraftHoldBySession.of(fallbackClearedDraftHoldSession)
}

function flushHeldClearedDraftToHistory(): void {
  const state = getClearedDraftHoldState()
  const prev = state.held
  state.held = null
  const wasJustHeld = state.justHeld
  state.justHeld = false
  if (prev === null || wasJustHeld || !prev.intoHistory) return
  const display = prev.mode === 'bash' ? `!${prev.text}` : prev.text
  keepClearedDraftToHistory(
    {
      display,
      pastedContents: prev.pastedContents,
    },
    prev.clearedAt,
  )
}

/** densable holdCleared — only stores when trim is non-empty. */
export function holdCleared(draft: {
  text: string
  mode: PromptInputMode
  pastedContents: Record<number, PastedContent>
  intoHistory?: boolean
}): void {
  if (draft.text.trim() === '') return
  const state = getClearedDraftHoldState()
  state.justHeld = false
  flushHeldClearedDraftToHistory()
  state.held = {
    text: draft.text,
    mode: draft.mode,
    pastedContents: { ...draft.pastedContents },
    clearedAt: Date.now(),
    intoHistory: draft.intoHistory ?? true,
  }
  state.justHeld = true
}

/**
 * densable restoreCleared — restores only when the prompt is empty and a
 * hold exists. Returns the held payload after clearing the slot.
 */
export function restoreCleared(currentValue: string): HeldClearedDraft | null {
  const state = getClearedDraftHoldState()
  if (state.held === null || currentValue !== '') return null
  const out = state.held
  state.held = null
  state.justHeld = false
  return out
}

/**
 * densable outside-empty: drop the hold (flushing to in-memory clearedDrafts
 * history when `intoHistory` is armed so Up after a slash command or sent
 * message still reaches the cleared prompt).
 */
export function clearHeldClearedDraft(): void {
  getClearedDraftHoldState().justHeld = false
  flushHeldClearedDraftToHistory()
}

export function peekHeldClearedDraftForTests(): HeldClearedDraft | null {
  return getClearedDraftHoldState().held
}

export function resetHeldClearedDraftForTests(): void {
  const state = getClearedDraftHoldState()
  state.held = null
  state.justHeld = false
}
