import { useEffect, useRef } from 'react'
import type { VimMode } from 'src/types/textInputTypes.js'
import type { PastedContent } from 'src/utils/config.js'
import { isFullscreenEnvEnabled } from 'src/utils/fullscreen.js'
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

/**
 * Official 2.1.326 #172:
 * - In fullscreen mode the prompt viewport scrolls, so never hide the middle of
 *   a >10,000-character paste ("paste again to expand") or typed prompt.
 * - Outside fullscreen, only auto-truncate when a >10,000-char prompt arrives
 *   all at once from an empty/restored state (e.g. MessageSelector), never
 *   mid-typing as the user crosses 10,000 characters.
 */
export function useMaybeTruncateInput({
  input,
  pastedContents,
  onInputChange,
  setCursorOffset,
  setPastedContents,
  vimMode,
}: Props) {
  const hasAppliedTruncationRef = useRef(false)
  const prevInputLengthRef = useRef(0)

  useEffect(() => {
    const prevLen = prevInputLengthRef.current
    prevInputLengthRef.current = input.length

    if (input === '') {
      hasAppliedTruncationRef.current = false
      return
    }

    if (isFullscreenEnvEnabled()) {
      return
    }

    if (hasAppliedTruncationRef.current) {
      return
    }

    if (input.length <= 10_000) {
      return
    }

    // Do not collapse a prompt the user is actively typing past 10,000 chars
    // (small incremental growth from a non-empty prompt).
    if (prevLen > 0 && input.length - prevLen < 1_000) {
      hasAppliedTruncationRef.current = true
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
    hasAppliedTruncationRef.current = true
  }, [
    input,
    pastedContents,
    onInputChange,
    setPastedContents,
    setCursorOffset,
    vimMode,
  ])
}
