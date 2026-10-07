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

export type HeldClearedDraft = {
  text: string
  mode: PromptInputMode
  pastedContents: Record<number, PastedContent>
}

let held: HeldClearedDraft | null = null

/** densable holdCleared — only stores when trim is non-empty. */
export function holdCleared(draft: {
  text: string
  mode: PromptInputMode
  pastedContents: Record<number, PastedContent>
}): void {
  if (draft.text.trim() === '') return
  held = {
    text: draft.text,
    mode: draft.mode,
    pastedContents: { ...draft.pastedContents },
  }
}

/**
 * densable restoreCleared — restores only when the prompt is empty and a
 * hold exists. Returns the held payload after clearing the slot.
 */
export function restoreCleared(currentValue: string): HeldClearedDraft | null {
  if (held === null || currentValue !== '') return null
  const out = held
  held = null
  return out
}

/** densable outside-empty: drop the hold without restoring. */
export function clearHeldClearedDraft(): void {
  held = null
}

export function peekHeldClearedDraftForTests(): HeldClearedDraft | null {
  return held
}

export function resetHeldClearedDraftForTests(): void {
  held = null
}
