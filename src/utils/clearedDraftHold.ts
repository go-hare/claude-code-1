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

export type HeldClearedDraft = {
  text: string
  mode: PromptInputMode
  pastedContents: Record<number, PastedContent>
  clearedAt: number
  intoHistory: boolean
}

let held: HeldClearedDraft | null = null
let justHeld = false

function flushHeldClearedDraftToHistory(): void {
  const prev = held
  held = null
  const wasJustHeld = justHeld
  justHeld = false
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
  justHeld = false
  flushHeldClearedDraftToHistory()
  held = {
    text: draft.text,
    mode: draft.mode,
    pastedContents: { ...draft.pastedContents },
    clearedAt: Date.now(),
    intoHistory: draft.intoHistory ?? true,
  }
  justHeld = true
}

/**
 * densable restoreCleared — restores only when the prompt is empty and a
 * hold exists. Returns the held payload after clearing the slot.
 */
export function restoreCleared(currentValue: string): HeldClearedDraft | null {
  if (held === null || currentValue !== '') return null
  const out = held
  held = null
  justHeld = false
  return out
}

/**
 * densable outside-empty: drop the hold (flushing to in-memory clearedDrafts
 * history when `intoHistory` is armed so Up after a slash command or sent
 * message still reaches the cleared prompt).
 */
export function clearHeldClearedDraft(): void {
  justHeld = false
  flushHeldClearedDraftToHistory()
}

export function peekHeldClearedDraftForTests(): HeldClearedDraft | null {
  return held
}

export function resetHeldClearedDraftForTests(): void {
  held = null
  justHeld = false
}
