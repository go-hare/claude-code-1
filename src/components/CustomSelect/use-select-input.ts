import { useMemo } from 'react'
import { useRegisterOverlay } from '../../context/overlayContext.js'
import { leftoverG5HaSelect } from '../FullscreenLayout.js'
import { type InputEvent, useInput } from '@anthropic/ink'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import {
  normalizeFullWidthDigits,
  normalizeFullWidthSpace,
} from '../../utils/stringUtils.js'
import type { OptionWithDescription } from './select.js'
import type { SelectState } from './use-select-state.js'

export type UseSelectProps<T> = {
  /**
   * When disabled, user input is ignored.
   *
   * @default false
   */
  isDisabled?: boolean

  /**
   * When true, prevents selection on Enter or number keys, but allows
   * scrolling.
   * When 'numeric', prevents selection on number keys, but allows Enter (and
   * scrolling).
   *
   * @default false
   */
  readonly disableSelection?: boolean | 'numeric'

  /**
   * Select state.
   */
  state: SelectState<T>

  /**
   * Options.
   */
  options: OptionWithDescription<T>[]

  /**
   * Whether this is a multi-select component.
   *
   * @default false
   */
  isMultiSelect?: boolean

  /**
   * Callback when user presses up from the first item.
   * If provided, navigation will not wrap to the last item.
   */
  onUpFromFirstItem?: () => void

  /**
   * Callback when user presses down from the last item.
   * If provided, navigation will not wrap to the first item.
   */
  onDownFromLastItem?: () => void

  /**
   * Callback when input mode should be toggled for an option.
   * Called when Tab is pressed (to enter or exit input mode).
   */
  onInputModeToggle?: (value: T) => void

  /**
   * Current input values for input-type options.
   * Used to determine if number key should submit an empty input option.
   */
  inputValues?: Map<T, string>

  /**
   * Whether image selection mode is active on the focused input option.
   * When true, arrow key navigation in useInput is suppressed so that
   * Attachments keybindings can handle image navigation instead.
   */
  imagesSelected?: boolean

  /**
   * Callback to attempt entering image selection mode on DOWN arrow.
   * Returns true if image selection was entered (images exist), false otherwise.
   */
  onEnterImageSelection?: () => boolean

  /**
   * Official 2.1.326 (#29, #315, #343): when true, printable letter shortcuts
   * such as j/k are ignored (arrows and Ctrl+P/Ctrl+N still navigate).
   * If `declineValue` is also set, typing printable text moves focus to it.
   */
  disablePrintableKeybindings?: boolean

  /**
   * Option value to focus when printable text is typed while
   * `disablePrintableKeybindings` is true.
   */
  declineValue?: T
}

export const useSelectInput = <T>({
  isDisabled = false,
  disableSelection = false,
  state,
  options,
  isMultiSelect = false,
  onUpFromFirstItem,
  onDownFromLastItem,
  onInputModeToggle,
  inputValues,
  imagesSelected = false,
  onEnterImageSelection,
  disablePrintableKeybindings = false,
  declineValue,
}: UseSelectProps<T>) => {
  // Automatically register as an overlay when onCancel is provided.
  // This ensures CancelRequestHandler won't intercept Escape when the select is active.
  useRegisterOverlay('select', leftoverG5HaSelect(!!state.onCancel, isDisabled))

  // Determine if the focused option is an input type
  const isInInput = useMemo(() => {
    const focusedOption = options.find(opt => opt.value === state.focusedValue)
    return focusedOption?.type === 'input'
  }, [options, state.focusedValue])

  // Core navigation via keybindings (up/down/enter/escape)
  // When in input mode or when disablePrintableKeybindings is true, exclude
  // select:next/select:previous keybindings so j/k do not move selection.
  const keybindingHandlers = useMemo(() => {
    const handlers: Record<string, () => void> = {}

    if (!isInInput) {
      if (!disablePrintableKeybindings) {
        handlers['select:next'] = () => {
          if (onDownFromLastItem) {
            const lastOption = options[options.length - 1]
            // densable: edge wrap checks live-read getFocusedValue()
            if (lastOption && state.getFocusedValue() === lastOption.value) {
              onDownFromLastItem()
              return
            }
          }
          state.focusNextOption()
        }
        handlers['select:previous'] = () => {
          if (onUpFromFirstItem && state.visibleFromIndex === 0) {
            const firstOption = options[0]
            if (firstOption && state.getFocusedValue() === firstOption.value) {
              onUpFromFirstItem()
              return
            }
          }
          state.focusPreviousOption()
        }
      }
      handlers['select:accept'] = () => {
        if (disableSelection === true) return
        // densable select:accept — live focused value, not React snapshot
        const focused = state.getFocusedValue()
        if (focused === undefined) return

        const focusedOption = options.find(opt => opt.value === focused)
        if (focusedOption?.disabled === true) return
        if (focusedOption?.type === 'input') return

        state.selectFocusedOption?.()
        state.onChange?.(focused)
      }
    }

    if (state.onCancel) {
      handlers['select:cancel'] = () => {
        state.onCancel!()
      }
    }

    return handlers
  }, [
    options,
    state,
    onDownFromLastItem,
    onUpFromFirstItem,
    isInInput,
    disableSelection,
    disablePrintableKeybindings,
  ])

  useKeybindings(keybindingHandlers, {
    context: 'Select',
    isActive: !isDisabled,
  })

  // Remaining keys that stay as useInput: number keys, pageUp/pageDown, tab, space,
  // and arrow key navigation when in input mode
  useInput(
    (input, key, event: InputEvent) => {
      const normalizedInput = normalizeFullWidthDigits(input)
      // densable handleKeyDown: S=r.getFocusedValue()
      const liveFocused = state.getFocusedValue()
      const focusedOption = options.find(opt => opt.value === liveFocused)
      const currentIsInInput = focusedOption?.type === 'input'

      // Handle Tab key for input mode toggling
      if (key.tab && onInputModeToggle && liveFocused !== undefined) {
        onInputModeToggle(liveFocused)
        return
      }

      if (currentIsInInput) {
        // When in image selection mode, suppress all input handling so
        // Attachments keybindings can handle navigation/deletion instead
        if (imagesSelected) return

        // DOWN arrow enters image selection mode if images exist
        if (key.downArrow && onEnterImageSelection?.()) {
          event.stopImmediatePropagation()
          return
        }

        // Arrow keys still navigate the select even while in input mode
        if (key.downArrow || (key.ctrl && input === 'n')) {
          if (onDownFromLastItem) {
            const lastOption = options[options.length - 1]
            if (lastOption && state.getFocusedValue() === lastOption.value) {
              onDownFromLastItem()
              event.stopImmediatePropagation()
              return
            }
          }
          state.focusNextOption()
          event.stopImmediatePropagation()
          return
        }
        if (key.upArrow || (key.ctrl && input === 'p')) {
          if (onUpFromFirstItem && state.visibleFromIndex === 0) {
            const firstOption = options[0]
            if (firstOption && state.getFocusedValue() === firstOption.value) {
              onUpFromFirstItem()
              event.stopImmediatePropagation()
              return
            }
          }
          state.focusPreviousOption()
          event.stopImmediatePropagation()
          return
        }

        // All other keys (including digits) pass through to TextInput.
        // Digits should type literally into the input rather than select
        // options — the user has focused a text field and expects typing
        // to insert characters, not jump to a different option.
        return
      }

      if (disablePrintableKeybindings) {
        if (key.downArrow || (key.ctrl && input === 'n')) {
          if (onDownFromLastItem) {
            const lastOption = options[options.length - 1]
            if (lastOption && state.getFocusedValue() === lastOption.value) {
              onDownFromLastItem()
              return
            }
          }
          state.focusNextOption()
          return
        }
        if (key.upArrow || (key.ctrl && input === 'p')) {
          if (onUpFromFirstItem && state.visibleFromIndex === 0) {
            const firstOption = options[0]
            if (firstOption && state.getFocusedValue() === firstOption.value) {
              onUpFromFirstItem()
              return
            }
          }
          state.focusPreviousOption()
          return
        }
        // Ignore printable characters; move focus to declineValue if provided (#29, #315, #343)
        if (
          !key.ctrl &&
          !key.meta &&
          input.length > 0 &&
          !/\p{Cc}/u.test(input)
        ) {
          if (declineValue !== undefined) {
            state.focusOption(declineValue)
          }
          event.stopImmediatePropagation()
          return
        }
      }

      if (key.home) {
        const firstOption = options[0]
        if (firstOption) state.focusOption(firstOption.value)
        return
      }

      if (key.end) {
        const lastOption = options[options.length - 1]
        if (lastOption) state.focusOption(lastOption.value)
        return
      }

      if (key.pageDown) {
        state.focusNextPage()
      }

      if (key.pageUp) {
        state.focusPreviousPage()
      }

      if (disableSelection !== true) {
        // Space for multi-select toggle
        if (
          isMultiSelect &&
          normalizeFullWidthSpace(input) === ' ' &&
          liveFocused !== undefined
        ) {
          const isFocusedOptionDisabled = focusedOption?.disabled === true
          if (!isFocusedOptionDisabled) {
            state.selectFocusedOption?.()
            state.onChange?.(liveFocused)
          }
        }

        if (
          disableSelection !== 'numeric' &&
          /^[0-9]+$/.test(normalizedInput)
        ) {
          const index = parseInt(normalizedInput, 10) - 1
          if (index >= 0 && index < state.options.length) {
            const selectedOption = state.options[index]!
            if (selectedOption.disabled === true) {
              return
            }
            if (selectedOption.type === 'input') {
              const currentValue = inputValues?.get(selectedOption.value) ?? ''
              if (currentValue.trim()) {
                // Pre-filled input: auto-submit (user can Tab to edit instead)
                state.onChange?.(selectedOption.value)
                return
              }
              if (selectedOption.allowEmptySubmitToCancel) {
                state.onChange?.(selectedOption.value)
                return
              }
              state.focusOption(selectedOption.value)
              return
            }
            state.onChange?.(selectedOption.value)
            return
          }
        }
      }
    },
    { isActive: !isDisabled },
  )
}
