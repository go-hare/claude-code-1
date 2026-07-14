import React, { useCallback, useState } from 'react'
import type { Key } from '@anthropic/ink'
import type { VimInputState, VimMode } from '../types/textInputTypes.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { Cursor } from '../utils/Cursor.js'
import { firstGrapheme, lastGrapheme } from '../utils/intl.js'
import {
  executeIndent,
  executeJoin,
  executeOpenLine,
  executeOperatorFind,
  executeOperatorMotion,
  executeOperatorTextObj,
  executeReplace,
  executeToggleCase,
  executeX,
  type OperatorContext,
} from '../vim/operators.js'
import { type TransitionContext, transition } from '../vim/transitions.js'
import {
  createInitialPersistentState,
  createInitialVimState,
  type PersistentState,
  type RecordedChange,
  type VimState,
} from '../vim/types.js'
import {
  getVimInsertModeRemaps,
  isVimInsertRemapPrefix,
  matchPendingVimInsertRemap,
  type PendingVimInsertRemap,
} from '../vim/vimInsertModeRemaps.js'
import { type UseTextInputProps, useTextInput } from './useTextInput.js'

type UseVimInputProps = Omit<UseTextInputProps, 'inputFilter'> & {
  onModeChange?: (mode: VimMode) => void
  onUndo?: () => void
  onHistorySearch?: () => void
  inputFilter?: UseTextInputProps['inputFilter']
}

export function useVimInput(props: UseVimInputProps): VimInputState {
  const vimStateRef = React.useRef<VimState>(createInitialVimState())
  const [mode, setMode] = useState<VimMode>('INSERT')

  const persistentRef = React.useRef<PersistentState>(
    createInitialPersistentState(),
  )
  // Official _.current — first key of a two-key INSERT remap sequence.
  const pendingRemapRef = React.useRef<PendingVimInsertRemap | null>(null)

  // inputFilter is applied once at the top of handleVimInput (not here) so
  // vim-handled paths that return without calling textInput.onInput still
  // run the filter — otherwise a stateful filter (e.g. lazy-space-after-
  // pill) stays armed across an Escape → NORMAL → INSERT round-trip.
  const textInput = useTextInput({ ...props, inputFilter: undefined })
  const { onModeChange, inputFilter } = props

  const switchToInsertMode = useCallback(
    (offset?: number): void => {
      if (offset !== undefined) {
        textInput.setOffset(offset)
      }
      pendingRemapRef.current = null
      vimStateRef.current = { mode: 'INSERT', insertedText: '' }
      setMode('INSERT')
      onModeChange?.('INSERT')
    },
    [textInput, onModeChange],
  )

  const switchToNormalMode = useCallback(
    (opts?: { claimEmptyInsert?: boolean }): void => {
      const current = vimStateRef.current
      // Official claimEmptyInsert: do not record the insert as lastChange
      // (used when a remap sequence exits INSERT without a real edit).
      if (
        !opts?.claimEmptyInsert &&
        current.mode === 'INSERT' &&
        current.insertedText
      ) {
        persistentRef.current.lastChange = {
          type: 'insert',
          text: current.insertedText,
        }
      }

      pendingRemapRef.current = null

      // Vim behavior: move cursor left by 1 when exiting insert mode
      // (unless at beginning of line or at offset 0)
      const offset = textInput.offset
      if (offset > 0 && props.value[offset - 1] !== '\n') {
        textInput.setOffset(offset - 1)
      }

      vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      setMode('NORMAL')
      onModeChange?.('NORMAL')
    },
    [onModeChange, textInput, props.value],
  )

  function createOperatorContext(
    cursor: Cursor,
    isReplay: boolean = false,
  ): OperatorContext {
    return {
      cursor,
      text: props.value,
      setText: (newText: string) => props.onChange(newText),
      setOffset: (offset: number) => textInput.setOffset(offset),
      enterInsert: (offset: number) => switchToInsertMode(offset),
      getRegister: () => persistentRef.current.register,
      setRegister: (content: string, linewise: boolean) => {
        persistentRef.current.register = content
        persistentRef.current.registerIsLinewise = linewise
      },
      getLastFind: () => persistentRef.current.lastFind,
      setLastFind: (type, char) => {
        persistentRef.current.lastFind = { type, char }
      },
      recordChange: isReplay
        ? () => {}
        : (change: RecordedChange) => {
            persistentRef.current.lastChange = change
          },
    }
  }

  function replayLastChange(): void {
    const change = persistentRef.current.lastChange
    if (!change) return

    const cursor = Cursor.fromText(props.value, props.columns, textInput.offset)
    const ctx = createOperatorContext(cursor, true)

    switch (change.type) {
      case 'insert':
        if (change.text) {
          const newCursor = cursor.insert(change.text)
          props.onChange(newCursor.text)
          textInput.setOffset(newCursor.offset)
        }
        break

      case 'x':
        executeX(change.count, ctx)
        break

      case 'replace':
        executeReplace(change.char, change.count, ctx)
        break

      case 'toggleCase':
        executeToggleCase(change.count, ctx)
        break

      case 'indent':
        executeIndent(change.dir, change.count, ctx)
        break

      case 'join':
        executeJoin(change.count, ctx)
        break

      case 'openLine':
        executeOpenLine(change.direction, ctx)
        break

      case 'operator':
        executeOperatorMotion(change.op, change.motion, change.count, ctx)
        break

      case 'operatorFind':
        executeOperatorFind(
          change.op,
          change.find,
          change.char,
          change.count,
          ctx,
        )
        break

      case 'operatorTextObj':
        executeOperatorTextObj(
          change.op,
          change.scope,
          change.objType,
          change.count,
          ctx,
        )
        break
    }
  }

  function handleVimInput(rawInput: string, key: Key): void {
    const state = vimStateRef.current
    // Run inputFilter in all modes so stateful filters disarm on any key,
    // but only apply the transformed input in INSERT — NORMAL-mode command
    // lookups expect single chars and a prepended space would break them.
    const filtered = inputFilter ? inputFilter(rawInput, key) : rawInput
    const input = state.mode === 'INSERT' ? filtered : rawInput
    const cursor = Cursor.fromText(props.value, props.columns, textInput.offset)

    if (key.ctrl) {
      textInput.onInput(input, key)
      return
    }

    // NOTE(keybindings): This escape handler is intentionally NOT migrated to the keybindings system.
    // It's vim's standard INSERT->NORMAL mode switch - a vim-specific behavior that should not be
    // configurable via keybindings. Vim users expect Esc to always exit INSERT mode.
    if (key.escape && state.mode === 'INSERT') {
      switchToNormalMode()
      return
    }

    // Escape in NORMAL mode cancels any pending command (replace, operator, etc.)
    if (key.escape && state.mode === 'NORMAL') {
      vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      return
    }

    // Pass Enter to base handler regardless of mode (allows submission from NORMAL)
    if (key.return) {
      textInput.onInput(input, key)
      return
    }

    if (state.mode === 'INSERT') {
      // Official SFs/GGy: two-key INSERT remaps (e.g. jj → Esc).
      if (!(key.backspace || key.delete || key.return || key.escape)) {
        const remaps = getVimInsertModeRemaps()
        if (remaps.size > 0 && input) {
          const nfcInput = input.normalize('NFC')
          // Whole input is already a remap key (paste / multi-char burst).
          if (remaps.has(nfcInput)) {
            pendingRemapRef.current = null
            logEvent('vim_insert_remap', {
              sequence:
                nfcInput as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            switchToNormalMode({ claimEmptyInsert: true })
            return
          }
          // Complete a pending first-key within timeout at same offset.
          const pendingMatch = matchPendingVimInsertRemap(
            remaps,
            pendingRemapRef.current,
            nfcInput,
            textInput.offset,
            props.value,
          )
          if (pendingMatch) {
            const pending = pendingRemapRef.current!
            pendingRemapRef.current = null
            // Undo the first key from buffer if it was recorded into text.
            if (pending.recorded && state.insertedText.endsWith(pending.char)) {
              vimStateRef.current = {
                mode: 'INSERT',
                insertedText: state.insertedText.slice(0, -pending.char.length),
              }
            }
            const removeStart = textInput.offset - pendingMatch.removeLen
            if (removeStart >= 0) {
              const nextText =
                props.value.slice(0, removeStart) +
                props.value.slice(textInput.offset)
              props.onChange(nextText)
              textInput.setOffset(removeStart)
            }
            logEvent('vim_insert_remap', {
              sequence:
                pendingMatch.matchedKey as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            switchToNormalMode({ claimEmptyInsert: true })
            return
          }
          // Arm pending if this grapheme is a remap prefix.
          const first = firstGrapheme(nfcInput)
          if (first && isVimInsertRemapPrefix(remaps, first)) {
            pendingRemapRef.current = {
              char: first,
              at: Date.now(),
              offsetAfter: textInput.offset + nfcInput.length,
              recorded: [...nfcInput].length === 1,
            }
          } else {
            pendingRemapRef.current = null
          }
        } else {
          pendingRemapRef.current = null
        }
      } else {
        pendingRemapRef.current = null
      }

      // Track inserted text for dot-repeat
      if (key.backspace || key.delete) {
        if (state.insertedText.length > 0) {
          vimStateRef.current = {
            mode: 'INSERT',
            insertedText: state.insertedText.slice(
              0,
              -(lastGrapheme(state.insertedText).length || 1),
            ),
          }
        }
      } else {
        vimStateRef.current = {
          mode: 'INSERT',
          insertedText: state.insertedText + input,
        }
      }
      textInput.onInput(input, key)
      return
    }

    if (state.mode !== 'NORMAL') {
      return
    }

    // In idle state, delegate arrow keys to base handler for cursor movement
    // and history fallback (upOrHistoryUp / downOrHistoryDown)
    if (
      state.command.type === 'idle' &&
      (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow)
    ) {
      textInput.onInput(input, key)
      return
    }

    const ctx: TransitionContext = {
      ...createOperatorContext(cursor, false),
      onUndo: props.onUndo,
      onDotRepeat: replayLastChange,
    }

    // Backspace/Delete are only mapped in motion-expecting states. In
    // literal-char states (replace, find, operatorFind), mapping would turn
    // r+Backspace into "replace with h" and df+Delete into "delete to next x".
    // Delete additionally skips count state: in vim, N<Del> removes a count
    // digit rather than executing Nx; we don't implement digit removal but
    // should at least not turn a cancel into a destructive Nx.
    const expectsMotion =
      state.command.type === 'idle' ||
      state.command.type === 'count' ||
      state.command.type === 'operator' ||
      state.command.type === 'operatorCount'

    // Map arrow keys to vim motions in NORMAL mode
    let vimInput = input
    if (key.leftArrow) vimInput = 'h'
    else if (key.rightArrow) vimInput = 'l'
    else if (key.upArrow) vimInput = 'k'
    else if (key.downArrow) vimInput = 'j'
    else if (expectsMotion && key.backspace) vimInput = 'h'
    else if (expectsMotion && state.command.type !== 'count' && key.delete)
      vimInput = 'x'

    const result = transition(state.command, vimInput, ctx)

    if (result.execute) {
      result.execute()
    }

    // Update command state (only if execute didn't switch to INSERT)
    if (vimStateRef.current.mode === 'NORMAL') {
      if (result.next) {
        vimStateRef.current = { mode: 'NORMAL', command: result.next }
      } else if (result.execute) {
        vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      }
    }

    if (
      input === '?' &&
      state.mode === 'NORMAL' &&
      state.command.type === 'idle'
    ) {
      props.onChange('?')
    }

    // Vim NORMAL mode: / opens reverse history search (like Ctrl+R)
    if (
      input === '/' &&
      state.mode === 'NORMAL' &&
      state.command.type === 'idle'
    ) {
      props.onHistorySearch?.()
    }
  }

  const setModeExternal = useCallback(
    (newMode: VimMode) => {
      if (newMode === 'INSERT') {
        vimStateRef.current = { mode: 'INSERT', insertedText: '' }
      } else {
        vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      }
      setMode(newMode)
      onModeChange?.(newMode)
    },
    [onModeChange],
  )

  return {
    ...textInput,
    onInput: handleVimInput,
    mode,
    setMode: setModeExternal,
  }
}
