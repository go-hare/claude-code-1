import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { KeyboardEvent } from '../core/events/keyboard-event.js'
import type { PasteEvent } from '../core/events/paste-event.js'
import {
  Cursor,
  getLastKill,
  pushToKillRing,
  recordYank,
  resetKillAccumulation,
  resetYankState,
  updateYankLength,
  yankPop,
} from '../core/utils/Cursor.js'
import { useTerminalSize } from './useTerminalSize.js'

export type SearchInputBuffer = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => { query: string; cursorOffset: number }
  setQueryAndCursor: (query: string, cursorOffset: number) => void
}

type UseSearchInputOptions = {
  isActive: boolean
  onExit: () => void
  onCancel?: () => void
  onExitUp?: () => void
  onExitDown?: () => void
  columns?: number
  passthroughCtrlKeys?: string[]
  initialQuery?: string
  buffer?: SearchInputBuffer
  backspaceExitsOnEmpty?: boolean
  multiline?: boolean
  onSpaceOnEmpty?: () => void
  onTabOnEmpty?: () => void
}

const UNHANDLED_SPECIAL_KEYS = new Set([
  'pageup',
  'pagedown',
  'insert',
  'wheelup',
  'wheeldown',
  'mouse',
  'clear',
  'enter',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
])

const noopSubscribeBuffer =
  (_listener: () => void): (() => void) =>
  () => {}

/** Gold 289 ph: focused input handlers, with the prompt's shared Cursor/kill ring. */
export function useSearchInput({
  isActive,
  onExit,
  onCancel,
  onExitUp,
  onExitDown,
  columns,
  passthroughCtrlKeys = [],
  initialQuery = '',
  buffer,
  backspaceExitsOnEmpty = true,
  multiline = false,
  onSpaceOnEmpty,
  onTabOnEmpty,
}: UseSearchInputOptions) {
  const { columns: terminalColumns } = useTerminalSize()
  const effectiveColumns = columns ?? terminalColumns
  const [localQuery, setQueryState] = useState(initialQuery)
  const [localCursorOffset, setCursorOffsetState] = useState(
    initialQuery.length,
  )
  const bufferQuery = useSyncExternalStore(
    buffer ? buffer.subscribe : noopSubscribeBuffer,
    () => (buffer ? buffer.getSnapshot().query : undefined),
    () => (buffer ? buffer.getSnapshot().query : undefined),
  )
  const bufferCursorOffset = useSyncExternalStore(
    buffer ? buffer.subscribe : noopSubscribeBuffer,
    () => (buffer ? buffer.getSnapshot().cursorOffset : undefined),
    () => (buffer ? buffer.getSnapshot().cursorOffset : undefined),
  )
  const query = bufferQuery ?? localQuery
  const cursorOffset = bufferCursorOffset ?? localCursorOffset
  const localQueryRef = useRef(localQuery)
  const localCursorOffsetRef = useRef(localCursorOffset)
  const queryRef = useMemo(
    () =>
      buffer
        ? {
            get current(): string {
              return buffer.getSnapshot().query
            },
            set current(value: string) {
              buffer.setQueryAndCursor(value, buffer.getSnapshot().cursorOffset)
            },
          }
        : localQueryRef,
    [buffer],
  )
  const cursorOffsetRef = useMemo(
    () =>
      buffer
        ? {
            get current(): number {
              return buffer.getSnapshot().cursorOffset
            },
            set current(value: number) {
              buffer.setQueryAndCursor(buffer.getSnapshot().query, value)
            },
          }
        : localCursorOffsetRef,
    [buffer],
  )
  const updateQuery = useCallback(
    (value: string) => {
      if (buffer) {
        buffer.setQueryAndCursor(value, buffer.getSnapshot().cursorOffset)
        return
      }
      localQueryRef.current = value
      setQueryState(value)
    },
    [buffer],
  )
  const setCursorOffset = useCallback(
    (offset: number) => {
      if (buffer) {
        buffer.setQueryAndCursor(buffer.getSnapshot().query, offset)
        return
      }
      localCursorOffsetRef.current = offset
      setCursorOffsetState(offset)
    },
    [buffer],
  )
  const setQuery = useCallback(
    (value: string) => {
      if (buffer) {
        buffer.setQueryAndCursor(value, value.length)
        return
      }
      updateQuery(value)
      setCursorOffset(value.length)
    },
    [buffer, updateQuery, setCursorOffset],
  )
  const applyCursor = (cursor: Cursor) => {
    if (buffer) {
      buffer.setQueryAndCursor(cursor.text, cursor.offset)
      return
    }
    updateQuery(cursor.text)
    setCursorOffset(cursor.offset)
  }
  const willInsertNewline = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!isActive || !multiline || event.name !== 'return') return false
      const offset = cursorOffsetRef.current
      return (
        (offset > 0 && queryRef.current[offset - 1] === '\\') ||
        event.shift ||
        event.meta
      )
    },
    [isActive, multiline, cursorOffsetRef, queryRef],
  )
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!isActive) return
    const text = queryRef.current
    const offset = cursorOffsetRef.current
    const cursor = Cursor.fromText(text, effectiveColumns, offset)
    const key = event.key.toLowerCase()
    const kill =
      (event.ctrl && ['k', 'u', 'w'].includes(key)) ||
      ((event.meta || event.ctrl) && event.name === 'backspace') ||
      (event.meta && !event.ctrl && key === 'd')
    const yank = (event.ctrl || event.meta) && key === 'y'
    if (!kill && !yank) {
      resetKillAccumulation()
      resetYankState()
    }
    if (event.ctrl && passthroughCtrlKeys.includes(key)) return
    if (event.name === 'return') {
      event.preventDefault()
      if (willInsertNewline(event)) {
        if (text[offset - 1] === '\\') {
          updateQuery(text.slice(0, offset - 1) + '\n' + text.slice(offset))
        } else {
          updateQuery(text.slice(0, offset) + '\n' + text.slice(offset))
          setCursorOffset(offset + 1)
        }
      } else onExit()
      return
    }
    if (
      multiline &&
      (event.name === 'enter' ||
        (event.ctrl && !event.shift && !event.meta && event.name === 'j'))
    ) {
      event.preventDefault()
      applyCursor(cursor.insert('\n'))
      return
    }
    if (event.name === 'down' || event.name === 'up') {
      event.preventDefault()
      if (multiline) {
        const next = event.name === 'down' ? cursor.down() : cursor.up()
        if (!next.equals(cursor)) {
          setCursorOffset(next.offset)
          return
        }
      }
      if (event.name === 'up') onExitUp?.()
      else if (onExitDown) onExitDown()
      else if (!multiline) onExit()
      return
    }
    if (event.name === 'escape') {
      event.preventDefault()
      if (onCancel) onCancel()
      else if (text.length > 0) setQuery('')
      else onExit()
      return
    }
    if (event.name === 'backspace') {
      event.preventDefault()
      if (event.ctrl || event.meta) {
        const killed = cursor.backwardKillWord()
        pushToKillRing(killed.killed, 'prepend')
        applyCursor(killed.cursor)
      } else if (text.length === 0) {
        if (backspaceExitsOnEmpty) (onCancel ?? onExit)()
      } else applyCursor(cursor.backspace())
      return
    }
    if (event.name === 'delete') {
      event.preventDefault()
      applyCursor(cursor.del())
      return
    }
    if (event.name === 'left' || event.name === 'right') {
      event.preventDefault()
      const word = event.ctrl || event.meta || event.fn
      const next =
        event.name === 'left'
          ? word
            ? cursor.backwardWord()
            : cursor.left()
          : word
            ? cursor.forwardWord()
            : cursor.right()
      setCursorOffset(next.offset)
      return
    }
    if (event.name === 'home' || event.name === 'end') {
      event.preventDefault()
      setCursorOffset(
        (event.name === 'home' ? cursor.startOfLine() : cursor.endOfLine())
          .offset,
      )
      return
    }
    if (event.ctrl) {
      event.preventDefault()
      switch (key) {
        case 'a':
          setCursorOffset(cursor.startOfLogicalLine().offset)
          return
        case 'e':
          setCursorOffset(cursor.endOfLogicalLine().offset)
          return
        case 'b':
          setCursorOffset(cursor.left().offset)
          return
        case 'f':
          setCursorOffset(cursor.right().offset)
          return
        case 'd':
          if (text.length === 0) (onCancel ?? onExit)()
          else applyCursor(cursor.del())
          return
        case 'h':
          if (text.length === 0) {
            if (backspaceExitsOnEmpty) (onCancel ?? onExit)()
          } else applyCursor(cursor.backspace())
          return
        case 'k':
        case 'u':
        case 'w': {
          const killed =
            key === 'k'
              ? cursor.deleteToLineEnd()
              : key === 'u'
                ? cursor.deleteToLineStart()
                : cursor.deleteWORDBefore()
          pushToKillRing(killed.killed, key === 'k' ? 'append' : 'prepend')
          applyCursor(killed.cursor)
          return
        }
        case 'y': {
          const text = getLastKill()
          if (text.length > 0) {
            recordYank(cursor.offset, text.length)
            applyCursor(cursor.insert(text))
          }
          return
        }
        case 'g':
        case 'c':
          onCancel?.()
          return
      }
      return
    }
    if (event.meta) {
      event.preventDefault()
      switch (key) {
        case 'b':
          setCursorOffset(cursor.backwardWord().offset)
          return
        case 'f':
          setCursorOffset(cursor.forwardWord().offset)
          return
        case 'd': {
          const killed = cursor.killWord()
          pushToKillRing(killed.killed, 'append')
          applyCursor(killed.cursor)
          return
        }
        case 'y': {
          const pop = yankPop()
          if (pop) {
            updateQuery(
              text.slice(0, pop.start) +
                pop.text +
                text.slice(pop.start + pop.length),
            )
            setCursorOffset(pop.start + pop.text.length)
            updateYankLength(pop.text.length)
          }
          return
        }
      }
      return
    }
    if (event.name === 'tab') {
      event.preventDefault()
      if (text === '') onTabOnEmpty?.()
      return
    }
    if (onSpaceOnEmpty && event.key === ' ' && text === '') {
      event.preventDefault()
      onSpaceOnEmpty()
      return
    }
    if (event.key.length >= 1 && !UNHANDLED_SPECIAL_KEYS.has(event.name)) {
      event.preventDefault()
      applyCursor(cursor.insert(event.key))
    }
  }
  const handlePaste = (event: PasteEvent): void => {
    if (!isActive || event.text.length === 0) return
    event.preventDefault()
    const text = multiline
      ? event.text.replace(/\r\n|\r/g, '\n')
      : (event.text.split(/\r\n|\r|\n/, 2)[0] ?? '')
    if (text.length === 0) return
    applyCursor(
      Cursor.fromText(
        queryRef.current,
        effectiveColumns,
        cursorOffsetRef.current,
      ).insert(text),
    )
  }
  return {
    query,
    queryRef,
    setQuery,
    cursorOffset,
    cursorOffsetRef,
    setCursorOffset,
    handleKeyDown,
    handlePaste,
    willInsertNewline,
  }
}
