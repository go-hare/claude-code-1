import { useEffect, useState } from 'react'
import type { VimMode } from 'src/types/textInputTypes.js'
import type { PastedContent } from 'src/utils/config.js'
import { getPromptInputStoreVimMode } from 'src/utils/promptInputCursorStore.js'
import { maybeTruncateInput } from './inputPaste.js'
import { isVimModeEnabled } from './utils.js'

type Props = {
  input: string
  pastedContents: Record<number, PastedContent>
  onInputChange: (input: string) => void
  setCursorOffset: (offset: number) => void
  setPastedContents: (contents: Record<number, PastedContent>) => void
  vimMode?: VimMode
}

export function useMaybeTruncateInput({
  input,
  pastedContents,
  onInputChange,
  setCursorOffset,
  setPastedContents,
  vimMode,
}: Props) {
  // Track if we've initialized this specific input value
  const [hasAppliedTruncationToInput, setHasAppliedTruncationToInput] =
    useState(false)

  // Process input for truncation and pasted images from MessageSelector.
  useEffect(() => {
    if (hasAppliedTruncationToInput) {
      return
    }

    if (input.length <= 10_000) {
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
    setHasAppliedTruncationToInput(true)
  }, [
    input,
    hasAppliedTruncationToInput,
    pastedContents,
    onInputChange,
    setPastedContents,
    setCursorOffset,
    vimMode,
  ])

  // Reset hasInitializedInput when input is cleared (e.g., after submission)
  useEffect(() => {
    if (input === '') {
      setHasAppliedTruncationToInput(false)
    }
  }, [input])
}
