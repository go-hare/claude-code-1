import { feature } from 'bun:bundle'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getModeFromInput,
  getValueFromInput,
} from '../components/PromptInput/inputModes.js'
import {
  expandPastedTextRefs,
  historyPasteIdentityKey,
  makeHistoryReader,
  parseReferences,
  renumberHistoryEntryPastes,
} from '../history.js'
import type { KeyboardEvent } from '@anthropic/ink'
import { useKeybinding, useKeybindings } from '../keybindings/useKeybinding.js'
import type { PromptInputMode } from '../types/textInputTypes.js'
import type { HistoryEntry } from '../utils/config.js'

const MAX_HISTORY_PASTE_SEARCH_CHARS = 32768

/**
 * Gold `RIs`: expand text paste placeholders up to `MAX_HISTORY_PASTE_SEARCH_CHARS`
 * per paste so Ctrl+R can match text inside collapsed `[Pasted text]` pills.
 */
export function expandHistoryEntryForSearch(
  display: string,
  pastedContents: HistoryEntry['pastedContents'],
): string {
  const capped: HistoryEntry['pastedContents'] = {}
  for (const [k, v] of Object.entries(pastedContents)) {
    capped[Number(k)] =
      v.type === 'text' && v.content.length > MAX_HISTORY_PASTE_SEARCH_CHARS
        ? { ...v, content: v.content.slice(0, MAX_HISTORY_PASTE_SEARCH_CHARS) }
        : v
  }
  return expandPastedTextRefs(display, capped)
}

/**
 * Gold `KGe`: locate cursor offset for a history search match — direct match
 * in `value` first, otherwise the start index of the last matching `[Pasted text #N]`
 * placeholder, or `value.length` if none.
 */
export function findHistoryMatchCursorOffset(
  value: string,
  pastedContents: HistoryEntry['pastedContents'],
  lowerQuery: string,
): number {
  const idx = value.toLowerCase().lastIndexOf(lowerQuery)
  if (idx !== -1) return idx
  const ref = parseReferences(value).findLast(r => {
    const content = pastedContents[r.id]
    return (
      content?.type === 'text' &&
      !content.unavailable &&
      content.content.toLowerCase().includes(lowerQuery)
    )
  })
  return ref ? ref.index : value.length
}

export function useHistorySearch(
  onAcceptHistory: (entry: HistoryEntry) => void,
  currentInput: string,
  onInputChange: (input: string) => void,
  onCursorChange: (cursorOffset: number) => void,
  currentCursorOffset: number,
  onModeChange: (mode: PromptInputMode) => void,
  currentMode: PromptInputMode,
  isSearching: boolean,
  setIsSearching: (isSearching: boolean) => void,
  setPastedContents: (pastedContents: HistoryEntry['pastedContents']) => void,
  currentPastedContents: HistoryEntry['pastedContents'],
): {
  historyQuery: string
  setHistoryQuery: (query: string) => void
  historyMatch: HistoryEntry | undefined
  historyFailedMatch: boolean
  handleKeyDown: (e: KeyboardEvent) => void
} {
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyFailedMatch, setHistoryFailedMatch] = useState(false)
  const [originalInput, setOriginalInput] = useState('')
  const [originalCursorOffset, setOriginalCursorOffset] = useState(0)
  const [originalMode, setOriginalMode] = useState<PromptInputMode>('prompt')
  const [originalPastedContents, setOriginalPastedContents] = useState<
    HistoryEntry['pastedContents']
  >({})
  const [historyMatch, setHistoryMatch] = useState<HistoryEntry | undefined>(
    undefined,
  )
  const historyReader = useRef<AsyncGenerator<HistoryEntry> | undefined>(
    undefined,
  )
  const seenPrompts = useRef<Set<string>>(new Set())
  const searchAbortController = useRef<AbortController | null>(null)

  const closeHistoryReader = useCallback((): void => {
    if (historyReader.current) {
      // Must explicitly call .return() to trigger the finally block in readLinesReverse,
      // which closes the file handle. Without this, file descriptors leak.
      void historyReader.current.return(undefined)
      historyReader.current = undefined
    }
  }, [])

  const reset = useCallback((): void => {
    setIsSearching(false)
    setHistoryQuery('')
    setHistoryFailedMatch(false)
    setOriginalInput('')
    setOriginalCursorOffset(0)
    setOriginalMode('prompt')
    setOriginalPastedContents({})
    setHistoryMatch(undefined)
    closeHistoryReader()
    seenPrompts.current.clear()
  }, [setIsSearching, closeHistoryReader])

  const searchHistory = useCallback(
    async (resume: boolean, signal?: AbortSignal): Promise<void> => {
      if (!isSearching) {
        return
      }

      if (historyQuery.length === 0) {
        closeHistoryReader()
        seenPrompts.current.clear()
        setHistoryMatch(undefined)
        setHistoryFailedMatch(false)
        onInputChange(originalInput)
        onCursorChange(originalCursorOffset)
        onModeChange(originalMode)
        setPastedContents(originalPastedContents)
        return
      }

      if (!resume) {
        closeHistoryReader()
        historyReader.current = makeHistoryReader()
        seenPrompts.current.clear()
      }

      if (!historyReader.current) {
        return
      }

      while (true) {
        if (signal?.aborted) {
          return
        }

        const item = await historyReader.current.next()
        if (item.done) {
          // No match found - keep last match but mark as failed
          setHistoryFailedMatch(true)
          return
        }

        const display = item.value.display
        // densable Jqs: dedup by paste identity (dead/hash/inline), not display alone
        const identity = historyPasteIdentityKey(
          display,
          item.value.pastedContents,
        )

        const lowerQuery = historyQuery.toLowerCase()
        const matched =
          display.toLowerCase().includes(lowerQuery) ||
          expandHistoryEntryForSearch(display, item.value.pastedContents)
            .toLowerCase()
            .includes(lowerQuery)
        if (matched && !seenPrompts.current.has(identity)) {
          seenPrompts.current.add(identity)
          setHistoryMatch(item.value)
          setHistoryFailedMatch(false)
          const mode = getModeFromInput(display)
          onModeChange(mode)
          onInputChange(display)
          setPastedContents(item.value.pastedContents)

          // Position cursor relative to the clean value, not the display
          const value = getValueFromInput(display)
          onCursorChange(
            findHistoryMatchCursorOffset(
              value,
              item.value.pastedContents,
              lowerQuery,
            ),
          )
          return
        }
      }
    },
    [
      isSearching,
      historyQuery,
      closeHistoryReader,
      onInputChange,
      onCursorChange,
      onModeChange,
      setPastedContents,
      originalInput,
      originalCursorOffset,
      originalMode,
      originalPastedContents,
    ],
  )

  // Handler: Start history search (when not searching)
  const handleStartSearch = useCallback(() => {
    setIsSearching(true)
    setOriginalInput(currentInput)
    setOriginalCursorOffset(currentCursorOffset)
    setOriginalMode(currentMode)
    setOriginalPastedContents(currentPastedContents)
    historyReader.current = makeHistoryReader()
    seenPrompts.current.clear()
  }, [
    setIsSearching,
    currentInput,
    currentCursorOffset,
    currentMode,
    currentPastedContents,
  ])

  // Handler: Find next match (when searching)
  const handleNextMatch = useCallback(() => {
    void searchHistory(true)
  }, [searchHistory])

  // Handler: Accept current match and exit search
  const handleAccept = useCallback(() => {
    if (historyMatch) {
      // densable f6e (#27): renumber on accept into live input
      const renumbered = renumberHistoryEntryPastes({
        display: historyMatch.display,
        pastedContents: historyMatch.pastedContents,
      })
      const mode = getModeFromInput(renumbered.display)
      const value = getValueFromInput(renumbered.display)
      onInputChange(value)
      onCursorChange(
        findHistoryMatchCursorOffset(
          value,
          renumbered.pastedContents,
          historyQuery.toLowerCase(),
        ),
      )
      onModeChange(mode)
      setPastedContents(renumbered.pastedContents)
    } else {
      // No match - restore original pasted contents
      setPastedContents(originalPastedContents)
    }
    reset()
  }, [
    historyMatch,
    historyQuery,
    onInputChange,
    onCursorChange,
    onModeChange,
    setPastedContents,
    originalPastedContents,
    reset,
  ])

  // Handler: Cancel search and restore original input
  const handleCancel = useCallback(() => {
    onInputChange(originalInput)
    onCursorChange(originalCursorOffset)
    setPastedContents(originalPastedContents)
    reset()
  }, [
    onInputChange,
    onCursorChange,
    setPastedContents,
    originalInput,
    originalCursorOffset,
    originalPastedContents,
    reset,
  ])

  // Handler: Execute (accept and submit)
  const handleExecute = useCallback(() => {
    if (historyQuery.length === 0) {
      onAcceptHistory({
        display: originalInput,
        pastedContents: originalPastedContents,
      })
    } else if (historyMatch) {
      // densable f6e (#27): renumber before submit-accept path
      const renumbered = renumberHistoryEntryPastes({
        display: historyMatch.display,
        pastedContents: historyMatch.pastedContents,
      })
      const mode = getModeFromInput(renumbered.display)
      const value = getValueFromInput(renumbered.display)
      onModeChange(mode)
      onAcceptHistory({
        display: value,
        pastedContents: renumbered.pastedContents,
      })
    }
    reset()
  }, [
    historyQuery,
    historyMatch,
    onAcceptHistory,
    onModeChange,
    originalInput,
    originalPastedContents,
    reset,
  ])

  // Gated off under HISTORY_PICKER — the modal dialog owns ctrl+r there.
  useKeybinding('history:search', handleStartSearch, {
    context: 'Global',
    isActive: feature('HISTORY_PICKER') ? false : !isSearching,
  })

  // History search context keybindings (only active when searching)
  const historySearchHandlers = useMemo(
    () => ({
      'historySearch:next': handleNextMatch,
      'historySearch:accept': handleAccept,
      'historySearch:cancel': handleCancel,
      'historySearch:execute': handleExecute,
    }),
    [handleNextMatch, handleAccept, handleCancel, handleExecute],
  )

  useKeybindings(historySearchHandlers, {
    context: 'HistorySearch',
    isActive: isSearching,
  })

  // Handle backspace when query is empty (cancels search).
  // densable vo(Bt): wired via PromptInput onKeyDownBefore before typeahead/base.
  // Conditional — backspace only cancels when query is empty (not a keybinding).
  const handleKeyDown = (e: KeyboardEvent): void => {
    if (!isSearching) return
    if (
      (e.name === 'backspace' || e.key === 'backspace') &&
      historyQuery === ''
    ) {
      e.preventDefault()
      handleCancel()
    }
  }

  // Keep a ref to searchHistory to avoid it being a dependency of useEffect
  const searchHistoryRef = useRef(searchHistory)
  searchHistoryRef.current = searchHistory

  // Reset history search when query changes
  useEffect(() => {
    searchAbortController.current?.abort()
    const controller = new AbortController()
    searchAbortController.current = controller
    void searchHistoryRef.current(false, controller.signal)
    return () => {
      controller.abort()
    }
  }, [historyQuery])

  return {
    historyQuery,
    setHistoryQuery,
    historyMatch,
    historyFailedMatch,
    handleKeyDown,
  }
}
