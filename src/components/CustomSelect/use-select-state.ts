import { useCallback, useState } from 'react'
import type { OptionWithDescription } from './select.js'
import { useSelectNavigation } from './use-select-navigation.js'

export type UseSelectStateProps<T> = {
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
   * Initially selected option's value.
   */
  defaultValue?: T

  /**
   * densable `$e` `ki` `selectedValue` — controlled value (`a!==void 0?a:I`).
   */
  selectedValue?: T

  /**
   * Callback for selecting an option.
   */
  onChange?: (value: T) => void

  /**
   * Callback for canceling the select.
   */
  onCancel?: () => void

  /**
   * Callback for focusing an option.
   */
  onFocus?: (value: T) => void

  /**
   * Value to focus
   */
  focusValue?: T

  /**
   * densable inner oo `moreRowLines` / bn `markerLines`.
   */
  moreRowLines?: boolean
}

export type SelectState<T> = {
  /**
   * Value of the currently focused option.
   */
  focusedValue: T | undefined

  /**
   * densable getFocusedValue — live read after same-tick navigation.
   */
  getFocusedValue: () => T | undefined

  /**
   * 1-based index of the focused option in the full list.
   * Returns 0 if no option is focused.
   */
  focusedIndex: number

  /**
   * Index of the first visible option.
   */
  visibleFromIndex: number

  /**
   * Index of the last visible option.
   */
  visibleToIndex: number

  /**
   * Value of the selected option.
   */
  value: T | undefined

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
   * Focus next option and scroll the list down, if needed.
   */
  focusNextOption: () => void

  /**
   * Focus previous option and scroll the list up, if needed.
   */
  focusPreviousOption: () => void

  /**
   * Focus next page and scroll the list down by a page.
   */
  focusNextPage: () => void

  /**
   * Focus previous page and scroll the list up by a page.
   */
  focusPreviousPage: () => void

  /**
   * Focus a specific option by value.
   */
  focusOption: (value: T | undefined) => void

  /**
   * densable inner oo `scrollToEdge` — je onPress Ae(±1).
   */
  scrollToEdge: (direction: number, force?: boolean) => void

  /**
   * densable inner `$e` `onScrollTo`.
   */
  scrollTo: (offset: number) => void

  /**
   * densable inner `$e` `onScrollBy`.
   */
  scrollBy: (delta: number) => void

  /**
   * densable `$e` `KMn` `scrollViewport`.
   */
  scrollViewport: (delta: number) => boolean

  /**
   * Select currently focused option.
   */
  selectFocusedOption: () => void

  /**
   * Callback for selecting an option.
   */
  onChange?: (value: T) => void

  /**
   * Callback for canceling the select.
   */
  onCancel?: () => void
}

export function useSelectState<T>({
  visibleOptionCount = 5,
  options,
  defaultValue,
  selectedValue,
  onChange,
  onCancel,
  onFocus,
  focusValue,
  moreRowLines,
}: UseSelectStateProps<T>): SelectState<T> {
  const [value, setValue] = useState<T | undefined>(defaultValue)

  const navigation = useSelectNavigation<T>({
    visibleOptionCount,
    options,
    initialFocusValue: undefined,
    onFocus,
    focusValue,
    moreRowLines,
  })

  // densable Ovl: setValue(getFocusedValue()) — not closed-over focusedValue
  const selectFocusedOption = useCallback(() => {
    setValue(navigation.getFocusedValue())
  }, [navigation.getFocusedValue])

  return {
    ...navigation,
    value: selectedValue !== undefined ? selectedValue : value,
    selectFocusedOption,
    onChange,
    onCancel,
  }
}
