import { useCallback, useContext, useRef, useState } from 'react'
import { isDeepStrictEqual } from 'util'
import { useRegisterOverlay } from '../../context/overlayContext.js'
import {
  leftoverG5Disabled,
  leftoverG5Dze,
  leftoverG5EmptyInput,
  leftoverG5Refuse,
  leftoverScreenReaderRadio,
  leftoverVmnCursorOn,
  leftoverVmnHa,
  leftoverVmnInputPrompt,
  leftoverVmnNormalize,
  leftoverVmnParseOptions,
  leftoverVmnPrompt,
  leftoverVmnRace,
  leftoverVmnSpaceToggle,
  leftoverVmnToken,
  leftoverVmnToggleSet,
  leftoverVmnEscapeTyped,
} from '../FullscreenLayout.js'
import {
  AccessibilityContext,
  type InputEvent,
  type KeyboardEvent,
  useInput,
} from '@anthropic/ink'
import {
  normalizeFullWidthDigits,
  normalizeFullWidthSpace,
} from '../../utils/stringUtils.js'
import type { OptionWithDescription } from './select.js'
import { useSelectNavigation } from './use-select-navigation.js'

export type UseMultiSelectStateProps<T> = {
  /**
   * When disabled, user input is ignored.
   *
   * @default false
   */
  isDisabled?: boolean

  /**
   * Number of items to display.
   *
   * @default 5
   */
  visibleOptionCount?: number

  /**
   * Options.
   */
  options: OptionWithDescription<T>[]

  /**
   * Initially selected values.
   */
  defaultValue?: T[]

  /**
   * Callback when selection changes.
   */
  onChange?: (values: T[]) => void

  /**
   * Callback for canceling the select.
   */
  onCancel: () => void

  /**
   * Callback for focusing an option.
   */
  onFocus?: (value: T) => void

  /**
   * Value to focus
   */
  focusValue?: T

  /**
   * Text for the submit button. When provided, a submit button is shown and
   * Enter toggles selection (submit only fires when the button is focused).
   * When omitted, Enter submits directly and Space toggles selection.
   */
  submitButtonText?: string

  /**
   * Callback when user submits. Receives the currently selected values.
   */
  onSubmit?: (values: T[]) => void

  /**
   * Callback when user presses down from the last item (submit button).
   * If provided, navigation will not wrap to the first item.
   */
  onDownFromLastItem?: () => void

  /**
   * Callback when user presses up from the first item.
   * If provided, navigation will not wrap to the last item.
   */
  onUpFromFirstItem?: () => void

  /**
   * Focus the last option initially instead of the first.
   */
  initialFocusLast?: boolean

  /**
   * When true, numeric keys (1-9) do not toggle options by index.
   * Mirrors the rendering layer's hideIndexes: if index labels aren't shown,
   * pressing a number shouldn't silently toggle an invisible mapping.
   */
  hideIndexes?: boolean

  /**
   * densable VMn `refuseInput`.
   */
  refuseInput?: () => boolean

  /**
   * densable VMn `DZe` analog — SR radio arrow nav (default false).
   */
  arrowNav?: boolean
}

export type MultiSelectState<T> = {
  /**
   * Value of the currently focused option.
   */
  focusedValue: T | undefined

  /**
   * densable getFocusedValue — live read after same-tick navigation.
   */
  getFocusedValue: () => T | undefined

  /**
   * Index of the first visible option.
   */
  visibleFromIndex: number

  /**
   * Index of the last visible option.
   */
  visibleToIndex: number

  /**
   * All options.
   */
  options: OptionWithDescription<T>[]

  /**
   * Visible options.
   */
  visibleOptions: Array<OptionWithDescription<T> & { index: number }>

  /**
   * Whether the focused option is an input type.
   */
  isInInput: boolean

  /**
   * Currently selected values.
   */
  selectedValues: T[]

  /**
   * Current input field values.
   */
  inputValues: Map<T, string>

  /**
   * Whether the submit button is focused.
   */
  isSubmitFocused: boolean

  /**
   * Update an input field value.
   */
  updateInputValue: (value: T, inputValue: string) => void

  /**
   * Callback for canceling the select.
   */
  onCancel: () => void

  /**
   * densable `focusOption` — click an input option focuses it (yln-guarded).
   */
  focusOption: (value: T | undefined) => void

  /**
   * densable `toggleValue` — click a text option toggles membership.
   */
  toggleValue: (value: T) => void

  /** densable VMn `Xe` radio. */
  leftoverSrRadio: boolean
  leftoverVmnPrompt?: string
  leftoverVmnError: string | null
  leftoverVmnCursorOn: boolean
  leftoverVmnArrowIndex: number | null
  leftoverVmnToggle: ReadonlySet<number> | null
  leftoverVmnRaw: string
  leftoverBindKeyDown: (event: KeyboardEvent) => void
}

export function useMultiSelectState<T>({
  isDisabled = false,
  visibleOptionCount = 5,
  options,
  defaultValue = [],
  onChange,
  onCancel,
  onFocus,
  focusValue,
  submitButtonText,
  onSubmit,
  onDownFromLastItem,
  onUpFromFirstItem,
  initialFocusLast,
  hideIndexes = false,
  refuseInput,
  arrowNav = false,
}: UseMultiSelectStateProps<T>): MultiSelectState<T> {
  const leftoverScreenReader = useContext(AccessibilityContext)
  const leftoverSrRadio = leftoverScreenReaderRadio(
    leftoverScreenReader,
    onChange !== undefined || onSubmit !== undefined,
  )
  const leftoverArrowNav = leftoverG5Dze(arrowNav)
  const leftoverRaceRef = useRef(false)
  const leftoverStashRef = useRef<T[] | null>(null)
  const leftoverInputIndexRef = useRef<number | null>(null)
  const leftoverVmnRawRef = useRef('')
  const [leftoverVmnTyped, setLeftoverVmnTyped] = useState('')
  const [leftoverVmnError, setLeftoverVmnError] = useState<string | null>(null)
  const [leftoverVmnArrowIndex, setLeftoverVmnArrowIndex] = useState<
    number | null
  >(null)
  const [leftoverVmnToggle, setLeftoverVmnToggle] =
    useState<Set<number> | null>(null)
  const leftoverDefaults = options.flatMap((option, index) =>
    !option.disabled && defaultValue.includes(option.value) ? [index] : [],
  )
  const [selectedValues, setSelectedValues] = useState<T[]>(defaultValue)
  const [isSubmitFocused, setIsSubmitFocused] = useState(false)

  // Reset selectedValues when options change (e.g. async-loaded data changes
  // defaultValue after mount). Mirrors the reset pattern in use-select-navigation.ts
  // and the deleted ui/useMultiSelectState.ts — without this, MCPServerDesktopImportDialog
  // keeps colliding servers checked after getAllMcpConfigs() resolves.
  const [lastOptions, setLastOptions] = useState(options)
  if (options !== lastOptions && !isDeepStrictEqual(options, lastOptions)) {
    setSelectedValues(defaultValue)
    setLastOptions(options)
  }

  // State for input type options
  const [inputValues, setInputValues] = useState<Map<T, string>>(() => {
    const initialMap = new Map<T, string>()
    options.forEach(option => {
      if (option.type === 'input' && option.initialValue) {
        initialMap.set(option.value, option.initialValue)
      }
    })
    return initialMap
  })

  const updateSelectedValues = useCallback(
    (values: T[] | ((prev: T[]) => T[])) => {
      const newValues =
        typeof values === 'function' ? values(selectedValues) : values
      setSelectedValues(newValues)
      onChange?.(newValues)
    },
    [selectedValues, onChange],
  )

  const navigation = useSelectNavigation<T>({
    visibleOptionCount,
    options,
    initialFocusValue: initialFocusLast
      ? options[options.length - 1]?.value
      : undefined,
    onFocus,
    focusValue,
  })

  // Automatically register as an overlay.
  // This ensures CancelRequestHandler won't intercept Escape when the multi-select is active.
  useRegisterOverlay('multi-select', leftoverVmnHa(true, isDisabled))

  const toggleValue = useCallback(
    (value: T) => {
      updateSelectedValues(prev =>
        prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value],
      )
    },
    [updateSelectedValues],
  )

  const updateInputValue = useCallback(
    (value: T, inputValue: string) => {
      setInputValues(prev => {
        const next = new Map(prev)
        next.set(value, inputValue)
        return next
      })

      // Find the option and call its onChange
      const option = options.find(opt => opt.value === value)
      if (option && option.type === 'input') {
        option.onChange(inputValue)
      }

      // Update selected values to include/exclude based on input
      updateSelectedValues(prev => {
        if (inputValue) {
          if (!prev.includes(value)) {
            return [...prev, value]
          }
          return prev
        } else {
          return prev.filter(v => v !== value)
        }
      })
    },
    [options, updateSelectedValues],
  )

  const leftoverLabel = (option: OptionWithDescription<T> | undefined) =>
    typeof option?.label === 'string' || typeof option?.label === 'number'
      ? String(option.label)
      : ''

  const leftoverVmnCommit = useCallback(
    (typed: string) => {
      leftoverRaceRef.current = false
      const inputIndex = leftoverInputIndexRef.current
      if (inputIndex !== null) {
        const option = options[inputIndex]
        if (typed === '') {
          setLeftoverVmnError(leftoverG5EmptyInput())
          return
        }
        if (option?.type === 'input') {
          option.onChange(typed)
          const next = [...(leftoverStashRef.current ?? []), option.value]
          leftoverStashRef.current = null
          leftoverInputIndexRef.current = null
          updateSelectedValues(next)
          onSubmit?.(next)
        }
        setLeftoverVmnTyped('')
        setLeftoverVmnError(null)
        return
      }
      if (typed.trim() === '') {
        updateSelectedValues(defaultValue)
        onSubmit?.(defaultValue)
        setLeftoverVmnTyped('')
        setLeftoverVmnError(null)
        return
      }
      const parsed = leftoverVmnParseOptions(typed, options)
      if ('error' in parsed) {
        setLeftoverVmnError(parsed.error)
        return
      }
      if (parsed.inputIndex !== undefined) {
        leftoverStashRef.current = parsed.indexes.map(i => options[i]!.value)
        leftoverInputIndexRef.current = parsed.inputIndex
        leftoverVmnRawRef.current = typed
        const option = options[parsed.inputIndex]
        const initial =
          option?.type === 'input' ? (option.initialValue ?? '') : ''
        setLeftoverVmnTyped(initial)
        if (option?.type === 'input') option.onChange(initial)
        if (option) onFocus?.(option.value)
        setLeftoverVmnError(null)
        return
      }
      const values = parsed.indexes.map(i => options[i]!.value)
      updateSelectedValues(values)
      onSubmit?.(values)
      setLeftoverVmnTyped('')
      setLeftoverVmnError(null)
    },
    [defaultValue, onFocus, onSubmit, options, updateSelectedValues],
  )

  const leftoverBindKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (isDisabled) return
      if (event.ctrl || event.meta) return
      if (event.key === 'escape' && event.name === 'escape') {
        event.preventDefault()
        if (leftoverInputIndexRef.current !== null) {
          leftoverInputIndexRef.current = null
          leftoverStashRef.current = null
          setLeftoverVmnTyped(
            leftoverVmnEscapeTyped(true, leftoverVmnRawRef.current),
          )
          leftoverVmnRawRef.current = ''
          return
        }
        onCancel()
        return
      }
      if (event.key === 'return' && event.name === 'return') {
        event.preventDefault()
        if (leftoverRaceRef.current) {
          leftoverG5Refuse(refuseInput)
          leftoverRaceRef.current = false
          setLeftoverVmnTyped('')
          setLeftoverVmnError(leftoverVmnRace())
          return
        }
        if (leftoverG5Refuse(refuseInput)) return
        if (
          leftoverVmnTyped.length > 0 ||
          leftoverInputIndexRef.current !== null
        ) {
          leftoverVmnCommit(leftoverVmnTyped)
          return
        }
        if (leftoverVmnToggle !== null) {
          leftoverVmnCommit(
            [...leftoverVmnToggle]
              .sort((a, b) => a - b)
              .map(i => String(i + 1))
              .join(' '),
          )
          return
        }
        leftoverVmnCommit('')
        return
      }
      if (event.key === 'backspace' || event.key === 'delete') {
        event.preventDefault()
        setLeftoverVmnTyped(prev => prev.slice(0, -1))
        setLeftoverVmnError(null)
        return
      }
      if (
        leftoverArrowNav &&
        leftoverInputIndexRef.current === null &&
        (event.name === 'up' || event.name === 'down')
      ) {
        event.preventDefault()
        if (leftoverG5Refuse(refuseInput)) return
        setLeftoverVmnError(null)
        setLeftoverVmnTyped('')
        leftoverRaceRef.current = false
        const n = options.length
        if (n === 0) return
        setLeftoverVmnArrowIndex(prev => {
          const next =
            prev === null
              ? event.name === 'down'
                ? 0
                : n - 1
              : (prev + (event.name === 'down' ? 1 : -1) + n) % n
          const option = options[next]
          if (option) onFocus?.(option.value)
          return next
        })
        return
      }
      if (
        leftoverVmnSpaceToggle(
          leftoverArrowNav,
          leftoverVmnArrowIndex !== null,
          leftoverVmnNormalize(event.key),
        ) &&
        leftoverVmnTyped === '' &&
        leftoverInputIndexRef.current === null
      ) {
        event.preventDefault()
        if (leftoverG5Refuse(refuseInput)) return
        const i = leftoverVmnArrowIndex
        if (i === null) return
        const option = options[i]
        if (!option) return
        if (option.disabled === true) {
          setLeftoverVmnError(leftoverG5Disabled(i + 1))
          return
        }
        setLeftoverVmnToggle(prev =>
          leftoverVmnToggleSet(prev, leftoverDefaults, i),
        )
        return
      }
      if (leftoverInputIndexRef.current !== null) {
        if (event.key.length === 1 && !event.ctrl && !event.meta) {
          event.preventDefault()
          setLeftoverVmnTyped(prev => prev + event.key)
        }
        return
      }
      const gn = leftoverVmnNormalize(event.key)
      if (leftoverVmnToken(gn)) {
        event.preventDefault()
        if (leftoverRaceRef.current) {
          leftoverG5Refuse(refuseInput)
          return
        }
        if (leftoverG5Refuse(refuseInput)) {
          leftoverRaceRef.current = true
          return
        }
        setLeftoverVmnError(null)
        setLeftoverVmnTyped(prev => prev + gn)
        setLeftoverVmnArrowIndex(null)
      }
    },
    [
      isDisabled,
      leftoverArrowNav,
      leftoverVmnArrowIndex,
      leftoverVmnCommit,
      leftoverVmnToggle,
      leftoverVmnTyped,
      leftoverDefaults,
      onCancel,
      onFocus,
      options,
      refuseInput,
      toggleValue,
    ],
  )

  const leftoverInputIndex = leftoverInputIndexRef.current
  const leftoverVmnPromptText = leftoverSrRadio
    ? leftoverInputIndex !== null
      ? leftoverVmnInputPrompt(
          leftoverInputIndex + 1,
          leftoverLabel(options[leftoverInputIndex]),
          leftoverVmnTyped,
        )
      : leftoverVmnPrompt(
          options.length,
          true,
          leftoverArrowNav,
          submitButtonText,
          leftoverVmnTyped,
          defaultValue.length > 0 && leftoverVmnArrowIndex === null,
          leftoverArrowNav,
        )
    : undefined

  // Handle all keyboard input
  useInput(
    (input, key, event: InputEvent) => {
      const normalizedInput = leftoverVmnNormalize(
        normalizeFullWidthDigits(input),
      )
      // densable #16: live-read focus for toggle/edge (same tick after arrow)
      const liveFocused = navigation.getFocusedValue()
      const focusedOption = options.find(opt => opt.value === liveFocused)
      const isInInput = focusedOption?.type === 'input'

      // When in input field, only allow navigation keys
      if (isInInput) {
        const isAllowedKey =
          key.upArrow ||
          key.downArrow ||
          key.escape ||
          key.tab ||
          key.return ||
          (key.ctrl && (input === 'n' || input === 'p' || key.return))
        if (!isAllowedKey) return
      }

      const lastOptionValue = options[options.length - 1]?.value

      // Handle Tab to move forward
      if (key.tab && !key.shift) {
        if (
          submitButtonText &&
          onSubmit &&
          liveFocused === lastOptionValue &&
          !isSubmitFocused
        ) {
          setIsSubmitFocused(true)
        } else if (!isSubmitFocused) {
          navigation.focusNextOption()
        }
        return
      }

      // Handle Shift+Tab to move backward
      if (key.tab && key.shift) {
        if (submitButtonText && onSubmit && isSubmitFocused) {
          setIsSubmitFocused(false)
          navigation.focusOption(lastOptionValue)
        } else {
          navigation.focusPreviousOption()
        }
        return
      }

      // Handle arrow down / Ctrl+N / j
      if (
        key.downArrow ||
        (key.ctrl && input === 'n') ||
        (!key.ctrl && !key.shift && input === 'j')
      ) {
        if (leftoverG5Refuse(refuseInput)) return
        if (isSubmitFocused && onDownFromLastItem) {
          onDownFromLastItem()
        } else if (
          submitButtonText &&
          onSubmit &&
          liveFocused === lastOptionValue &&
          !isSubmitFocused
        ) {
          setIsSubmitFocused(true)
        } else if (
          !submitButtonText &&
          onDownFromLastItem &&
          liveFocused === lastOptionValue
        ) {
          // No submit button — exit from the last option
          onDownFromLastItem()
        } else if (!isSubmitFocused) {
          navigation.focusNextOption()
        }
        return
      }

      // Handle arrow up / Ctrl+P / k
      if (
        key.upArrow ||
        (key.ctrl && input === 'p') ||
        (!key.ctrl && !key.shift && input === 'k')
      ) {
        if (leftoverG5Refuse(refuseInput)) return
        if (submitButtonText && onSubmit && isSubmitFocused) {
          setIsSubmitFocused(false)
          navigation.focusOption(lastOptionValue)
        } else if (
          onUpFromFirstItem &&
          navigation.getFocusedValue() === options[0]?.value
        ) {
          onUpFromFirstItem()
        } else {
          navigation.focusPreviousOption()
        }
        return
      }

      // Handle page navigation
      if (key.pageDown) {
        navigation.focusNextPage()
        return
      }

      if (key.pageUp) {
        navigation.focusPreviousPage()
        return
      }

      // densable VMn typed buffer — Enter submits leftoverVmnParseOptions.
      if (key.return && leftoverVmnTyped.length > 0) {
        if (leftoverRaceRef.current) {
          leftoverG5Refuse(refuseInput)
          leftoverRaceRef.current = false
          setLeftoverVmnTyped('')
          setLeftoverVmnError(leftoverVmnRace())
          return
        }
        if (leftoverG5Refuse(refuseInput)) return
        leftoverVmnCommit(leftoverVmnTyped)
        return
      }

      // Handle Enter or Space for selection/submit
      if (key.return || normalizeFullWidthSpace(input) === ' ') {
        if (leftoverG5Refuse(refuseInput)) return
        // Ctrl+Enter from input field submits
        if (key.ctrl && key.return && isInInput && onSubmit) {
          onSubmit(selectedValues)
          return
        }

        // Enter on submit button submits
        if (isSubmitFocused && onSubmit) {
          onSubmit(selectedValues)
          return
        }

        // No submit button: Enter submits directly, Space still toggles
        if (key.return && !submitButtonText && onSubmit) {
          onSubmit(selectedValues)
          return
        }

        // Enter or Space toggles selection (including for input fields)
        const focused = navigation.getFocusedValue()
        if (focused !== undefined) {
          toggleValue(focused)
        }
        return
      }

      // densable VMn `^[0-9, ]$` buffer (visual Space still toggles above).
      if (!hideIndexes && leftoverVmnToken(normalizedInput)) {
        if (leftoverRaceRef.current) {
          leftoverG5Refuse(refuseInput)
          return
        }
        if (leftoverG5Refuse(refuseInput)) {
          leftoverRaceRef.current = true
          return
        }
        setLeftoverVmnError(null)
        setLeftoverVmnTyped(prev => prev + normalizedInput)
        return
      }

      // Handle Escape
      if (key.escape) {
        onCancel()
        event.stopImmediatePropagation()
      }
    },
    { isActive: !isDisabled && !leftoverSrRadio },
  )

  return {
    ...navigation,
    selectedValues,
    inputValues,
    isSubmitFocused,
    updateInputValue,
    onCancel,
    toggleValue,
    leftoverSrRadio,
    leftoverVmnPrompt: leftoverVmnPromptText,
    leftoverVmnError,
    leftoverVmnCursorOn: leftoverVmnCursorOn(
      isDisabled,
      leftoverVmnArrowIndex !== null,
    ),
    leftoverVmnArrowIndex,
    leftoverVmnToggle,
    leftoverVmnRaw: leftoverVmnRawRef.current,
    leftoverBindKeyDown,
  }
}
