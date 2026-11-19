import { useCallback, useRef, useState } from 'react'
import type { PastedContent } from '../utils/config.js'

export type BufferEntry = {
  text: string
  cursorOffset: number
  pastedContents: Record<number, PastedContent>
  timestamp: number
}

export type UseInputBufferProps = {
  maxBufferSize: number
  debounceMs: number
}

export type PushToBufferOptions = {
  /** Official 2.1.326 #145 (`w_e`): bypass debounce before destructive deletes so Ctrl+_ restores last typed words. */
  immediate?: boolean
}

export type UseInputBufferResult = {
  pushToBuffer: (
    text: string,
    cursorOffset: number,
    pastedContents?: Record<number, PastedContent>,
    options?: PushToBufferOptions,
  ) => void
  undo: () => BufferEntry | undefined
  canUndo: boolean
  clearBuffer: () => void
}

type BufferState = {
  entries: BufferEntry[]
  index: number
}

export function useInputBuffer({
  maxBufferSize,
  debounceMs,
}: UseInputBufferProps): UseInputBufferResult {
  const stateRef = useRef<BufferState>({ entries: [], index: -1 })
  const [state, setState] = useState<BufferState>(stateRef.current)
  const lastPushTime = useRef<number>(0)
  const pendingPush = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pushToBuffer = useCallback(
    (
      text: string,
      cursorOffset: number,
      pastedContents: Record<number, PastedContent> = {},
      options: PushToBufferOptions = {},
    ) => {
      const now = Date.now()

      // Clear any pending push
      if (pendingPush.current) {
        clearTimeout(pendingPush.current)
        pendingPush.current = null
      }

      // Debounce rapid changes unless `immediate` is requested (e.g. before line/word delete)
      if (!options.immediate && now - lastPushTime.current < debounceMs) {
        pendingPush.current = setTimeout(
          pushToBuffer,
          debounceMs,
          text,
          cursorOffset,
          pastedContents,
        )
        return
      }

      lastPushTime.current = now
      const cur = stateRef.current
      if (cur.entries[cur.index]?.text === text) {
        return
      }
      const nextEntries = [
        ...cur.entries.slice(0, cur.index + 1),
        { text, cursorOffset, pastedContents, timestamp: now },
      ]
      const trimmed =
        nextEntries.length > maxBufferSize
          ? nextEntries.slice(-maxBufferSize)
          : nextEntries
      stateRef.current = { entries: trimmed, index: trimmed.length - 1 }
      setState(stateRef.current)
    },
    [debounceMs, maxBufferSize],
  )

  const undo = useCallback((): BufferEntry | undefined => {
    if (pendingPush.current) {
      clearTimeout(pendingPush.current)
      pendingPush.current = null
    }
    const cur = stateRef.current
    const entry = cur.entries[cur.index]
    if (!entry) {
      return undefined
    }
    stateRef.current = { entries: cur.entries, index: cur.index - 1 }
    setState(stateRef.current)
    return entry
  }, [])

  const clearBuffer = useCallback(() => {
    stateRef.current = { entries: [], index: -1 }
    setState(stateRef.current)
    lastPushTime.current = 0
    if (pendingPush.current) {
      clearTimeout(pendingPush.current)
      pendingPush.current = null
    }
  }, [])

  const canUndo = state.index >= 0 && state.entries[state.index] !== undefined

  return {
    pushToBuffer,
    undo,
    canUndo,
    clearBuffer,
  }
}
