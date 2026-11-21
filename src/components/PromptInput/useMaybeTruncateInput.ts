import { useEffect, useRef } from 'react'
import type { VimMode } from 'src/types/textInputTypes.js'
import type { PastedContent } from 'src/utils/config.js'
import { getPromptInputStoreVimMode } from 'src/utils/promptInputCursorStore.js'
import { maybeTruncateInput } from './inputPaste.js'
import { isVimModeEnabled } from './utils.js'

export const TRUNCATE_INPUT_THRESHOLD = 10_000

/**
 * Official 2.1.328 (`OX.setValueTyped` / `OX.insertText` / `OX.#C` @581377..583550):
 * Mark `keepsFullText = true` synchronously when user typing or cursor insertion
 * crosses `TRUNCATE_INPUT_THRESHOLD` BEFORE `useMaybeTruncateInput`'s effect
 * runs, so typing character #10,001 never collapses the prompt mid-typing.
 * Reset to `false` when the prompt is cleared to `""`.
 */
export function noteUserEditForTruncation(
  nextValue: string,
  keepsFullTextRef: { current: boolean },
): void {
  if (nextValue === '') {
    keepsFullTextRef.current = false
  } else if (nextValue.length > TRUNCATE_INPUT_THRESHOLD) {
    keepsFullTextRef.current = true
  }
}

export type DraftKeepsFullText = {
  readonly keepsFullText: boolean
  keepFullText: () => void
  resetKeepsFullText: () => void
}

type Props = {
  input: string
  pastedContents: Record<number, PastedContent>
  onInputChange: (input: string) => void
  setCursorOffset: (offset: number) => void
  setPastedContents: (contents: Record<number, PastedContent>) => void
  vimMode?: VimMode
  /**
   * Official 2.1.328 (`P_e` @320717804): draft `keepsFullText` state.
   * Set true after truncation or when expanding a >10k paste in fullscreen
   * (`maxVisibleLines !== undefined`); reset to false when `input === ''`.
   */
  keepsFullTextRef?: { current: boolean }
  /** Optional explicit draft adapter matching official `h.keepsFullText` / `h.keepFullText()`. */
  draft?: DraftKeepsFullText
}

/**
 * Official 2.1.328 (`P_e` @320717804):
 * - Truncate >10,000-character inputs (including long-input restoration in
 *   fullscreen) unless the draft's `keepsFullText` flag is already set.
 * - Reset `keepsFullText` whenever `input === ''`.
 * - Set `keepsFullText = true` after truncating once so subsequent edits or
 *   explicit fullscreen paste expansion are not immediately re-collapsed.
 */
export function useMaybeTruncateInput({
  input,
  pastedContents,
  onInputChange,
  setCursorOffset,
  setPastedContents,
  vimMode,
  keepsFullTextRef,
  draft,
}: Props) {
  const internalKeepsFullTextRef = useRef(false)
  const keepsFullText = keepsFullTextRef ?? internalKeepsFullTextRef

  useEffect(() => {
    if (input === '') {
      if (draft) {
        draft.resetKeepsFullText()
      } else {
        keepsFullText.current = false
      }
      return
    }

    const alreadyKeepsFullText = draft
      ? draft.keepsFullText
      : keepsFullText.current
    if (alreadyKeepsFullText || input.length <= TRUNCATE_INPUT_THRESHOLD) {
      return
    }

    const { newInput, newPastedContents } = maybeTruncateInput(
      input,
      pastedContents,
    )

    onInputChange(newInput)
    const effectiveVimMode = vimMode ?? getPromptInputStoreVimMode()
    const nextOffset =
      isVimModeEnabled() && effectiveVimMode === 'NORMAL' && newInput.length > 0
        ? Math.max(0, newInput.length - 1)
        : newInput.length
    setCursorOffset(nextOffset)
    setPastedContents(newPastedContents)
    if (draft) {
      draft.keepFullText()
    } else {
      keepsFullText.current = true
    }
  }, [
    input,
    pastedContents,
    onInputChange,
    setPastedContents,
    setCursorOffset,
    vimMode,
    keepsFullText,
    draft,
  ])
}
