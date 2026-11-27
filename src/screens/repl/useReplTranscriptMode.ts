import { useInput, useSearchHighlight } from '@anthropic/ink'
import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JumpHandle } from '../../components/VirtualMessageList.js'
import type { GlobalKeybindingHandlers } from '../../hooks/useGlobalKeybindings.js'
import { markPersonActivityForPromptSuggestion } from '../../services/PromptSuggestion/promptSuggestion.js'
import type { Tools } from '../../Tool.js'
import type { Message as MessageType } from '../../types/message.js'
import { openFileInExternalEditor } from '../../utils/editor.js'
import { renderMessagesToPlainText } from '../../utils/exportRenderer.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import type { StreamingToolUse } from '../../utils/messages.js'
import type { ScrollPin } from '../../utils/scrollPin.js'
import type { Screen } from './types.js'

/**
 * Manages transcript mode (`ctrl+o`) state: frozen lengths, `/` search bar &
 * highlight scanning, `n`/`N`/`?`/`[`/`v` modal keybindings, resize search
 * reset, and `GlobalKeybindingHandlers` props.
 */
export function useReplTranscriptMode(params: {
  screen: Screen
  setScreen: React.Dispatch<React.SetStateAction<Screen>>
  showAllInTranscript: boolean
  setShowAllInTranscript: React.Dispatch<React.SetStateAction<boolean>>
  dumpMode: boolean
  setDumpMode: React.Dispatch<React.SetStateAction<boolean>>
  disableVirtualScroll: boolean
  messages: MessageType[]
  messagesRef: React.RefObject<MessageType[]>
  streamingToolUses: StreamingToolUse[]
  tools: Tools
  scrollPin: ScrollPin
  transcriptCols: number
}): {
  inTranscript: boolean
  virtualScrollActive: boolean
  jumpRef: React.RefObject<JumpHandle | null>
  searchOpen: boolean
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  transcriptHelpOpen: boolean
  searchQuery: string
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>
  searchCount: number
  setSearchCount: React.Dispatch<React.SetStateAction<number>>
  searchCurrent: number
  setSearchCurrent: React.Dispatch<React.SetStateAction<number>>
  onSearchMatchesChange: (count: number, current: number) => void
  setHighlight: (query: string) => void
  scanElement: ReturnType<typeof useSearchHighlight>['scanElement']
  setPositions: ReturnType<typeof useSearchHighlight>['setPositions']
  editorStatus: string
  globalKeybindingProps: React.ComponentProps<typeof GlobalKeybindingHandlers>
  transcriptMessages: MessageType[]
  transcriptStreamingToolUses: StreamingToolUse[]
} {
  const {
    screen,
    setScreen,
    showAllInTranscript,
    setShowAllInTranscript,
    dumpMode,
    setDumpMode,
    disableVirtualScroll,
    messages,
    messagesRef,
    streamingToolUses,
    tools,
    scrollPin,
    transcriptCols,
  } = params

  const [frozenTranscriptState, setFrozenTranscriptState] = useState<{
    messagesLength: number
    streamingToolUsesLength: number
  } | null>(null)
  const [editorStatus, setEditorStatus] = useState('')
  const editorGenRef = useRef(0)
  const editorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const editorRenderingRef = useRef(false)

  const handleEnterTranscript = useCallback(() => {
    setFrozenTranscriptState({
      messagesLength: messagesRef.current.length,
      streamingToolUsesLength: streamingToolUses.length,
    })
  }, [messagesRef, streamingToolUses.length])

  const handleExitTranscript = useCallback(() => {
    setFrozenTranscriptState(null)
    scrollPin.resetForTranscriptExit()
  }, [scrollPin])

  const virtualScrollActive = isFullscreenEnvEnabled() && !disableVirtualScroll

  const jumpRef = useRef<JumpHandle | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [transcriptHelpOpen, setTranscriptHelpOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchCount, setSearchCount] = useState(0)
  const [searchCurrent, setSearchCurrent] = useState(0)
  const onSearchMatchesChange = useCallback(
    (count: number, current: number) => {
      setSearchCount(count)
      setSearchCurrent(current)
    },
    [],
  )

  useInput(
    (input, key, event) => {
      markPersonActivityForPromptSuggestion()
      if (key.ctrl || key.meta) return
      if (input === '/') {
        jumpRef.current?.setAnchor()
        setSearchOpen(true)
        setTranscriptHelpOpen(false)
        event.stopImmediatePropagation()
        return
      }
      const c = input[0]
      if (
        (c === 'n' || c === 'N') &&
        input === c.repeat(input.length) &&
        searchCount > 0
      ) {
        const fn =
          c === 'n' ? jumpRef.current?.nextMatch : jumpRef.current?.prevMatch
        if (fn) for (let i = 0; i < input.length; i++) fn()
        event.stopImmediatePropagation()
      }
    },
    {
      isActive:
        screen === 'transcript' &&
        virtualScrollActive &&
        !searchOpen &&
        !dumpMode,
    },
  )

  const {
    setQuery: setHighlight,
    scanElement,
    setPositions,
  } = useSearchHighlight()

  const prevColsRef = useRef(transcriptCols)
  useEffect(() => {
    if (prevColsRef.current !== transcriptCols) {
      prevColsRef.current = transcriptCols
      if (searchQuery || searchOpen) {
        setSearchOpen(false)
        setSearchQuery('')
        setSearchCount(0)
        setSearchCurrent(0)
        jumpRef.current?.disarmSearch()
        setHighlight('')
      }
    }
  }, [transcriptCols, searchQuery, searchOpen, setHighlight])

  useInput(
    (input, key, event) => {
      markPersonActivityForPromptSuggestion()
      if (key.ctrl || key.meta) return
      if (input === '?' && !dumpMode) {
        setTranscriptHelpOpen(prev => !prev)
        event.stopImmediatePropagation()
        return
      }
      if (input === '[' && !dumpMode) {
        setDumpMode(true)
        setShowAllInTranscript(true)
        setTranscriptHelpOpen(false)
        event.stopImmediatePropagation()
      } else if (input === 'v') {
        setTranscriptHelpOpen(false)
        event.stopImmediatePropagation()
        if (editorRenderingRef.current) return
        editorRenderingRef.current = true
        const gen = editorGenRef.current
        const setStatus = (s: string): void => {
          if (gen !== editorGenRef.current) return
          clearTimeout(editorTimerRef.current)
          setEditorStatus(s)
        }
        const exportMessages = messagesRef.current
        setStatus(`rendering ${exportMessages.length} messages…`)
        void (async () => {
          try {
            // eslint-disable-next-line custom-rules/prefer-use-terminal-size -- one-shot at keypress time
            const w = Math.max(80, (process.stdout.columns ?? 80) - 6)
            const raw = await renderMessagesToPlainText(
              exportMessages,
              tools,
              w,
            )
            const text = raw.replace(/[ \t]+$/gm, '')
            const path = join(tmpdir(), `cc-transcript-${Date.now()}.txt`)
            await writeFile(path, text)
            const opened = openFileInExternalEditor(path)
            setStatus(
              opened
                ? `opening ${path}`
                : `wrote ${path} · no $VISUAL/$EDITOR set`,
            )
          } catch (e) {
            setStatus(
              `render failed: ${e instanceof Error ? e.message : String(e)}`,
            )
          }
          editorRenderingRef.current = false
          if (gen !== editorGenRef.current) return
          editorTimerRef.current = setTimeout(s => s(''), 4000, setEditorStatus)
        })()
      }
    },
    { isActive: screen === 'transcript' && virtualScrollActive && !searchOpen },
  )

  const inTranscript = screen === 'transcript' && virtualScrollActive
  const prevInTranscriptRef = useRef(inTranscript)
  useEffect(() => {
    if (!inTranscript) {
      if (prevInTranscriptRef.current) {
        scrollPin.resetForTranscriptExit()
      }
      setSearchQuery('')
      setSearchCount(0)
      setSearchCurrent(0)
      setSearchOpen(false)
      setTranscriptHelpOpen(false)
      editorGenRef.current++
      clearTimeout(editorTimerRef.current)
      setDumpMode(false)
      setEditorStatus('')
    }
    prevInTranscriptRef.current = inTranscript
  }, [inTranscript, scrollPin, setDumpMode])

  useEffect(() => {
    setHighlight(inTranscript ? searchQuery : '')
    if (!inTranscript) setPositions(null)
  }, [inTranscript, searchQuery, setHighlight, setPositions])

  const globalKeybindingProps: React.ComponentProps<
    typeof GlobalKeybindingHandlers
  > = {
    screen,
    setScreen,
    showAllInTranscript,
    setShowAllInTranscript,
    messageCount: messages.length,
    onEnterTranscript: handleEnterTranscript,
    onExitTranscript: handleExitTranscript,
    virtualScrollActive,
    searchBarOpen: searchOpen,
  }

  const transcriptMessages =
    frozenTranscriptState && !dumpMode
      ? messages.slice(0, frozenTranscriptState.messagesLength)
      : messages
  const transcriptStreamingToolUses = frozenTranscriptState
    ? streamingToolUses.slice(0, frozenTranscriptState.streamingToolUsesLength)
    : streamingToolUses

  return {
    inTranscript,
    virtualScrollActive,
    jumpRef,
    searchOpen,
    setSearchOpen,
    transcriptHelpOpen,
    searchQuery,
    setSearchQuery,
    searchCount,
    setSearchCount,
    searchCurrent,
    setSearchCurrent,
    onSearchMatchesChange,
    setHighlight,
    scanElement,
    setPositions,
    editorStatus,
    globalKeybindingProps,
    transcriptMessages,
    transcriptStreamingToolUses,
  }
}
