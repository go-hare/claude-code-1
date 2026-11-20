import { useInput } from '@anthropic/ink'
import { useEffect, useRef } from 'react'
import { normalizeFullWidthDigits } from '../../utils/stringUtils.js'

// Delay before accepting a digit as a response, to prevent accidental
// submissions when users start messages with numbers (e.g., numbered lists).
// Short enough to feel instant for intentional presses, long enough to
// cancel when the user types more characters.
const DEFAULT_DEBOUNCE_MS = 400
const DEFAULT_MOUNT_DELAY_MS = 600

/**
 * Detects when the user types a single valid digit into the prompt input,
 * optionally debounces (when `acceptAfterPause` is true) or waits for Enter
 * (when `enterConfirms` is true / `acceptAfterPause` is false), trims the
 * digit from the input, and fires a callback.
 *
 * Used by survey components that accept numeric responses typed directly
 * into the main prompt input.
 */
export function useDebouncedDigitInput<T extends string = string>({
  inputValue,
  setInputValue,
  isValidDigit,
  onDigit,
  enabled = true,
  once = false,
  enterConfirms = true,
  acceptAfterPause = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  mountDelayMs = DEFAULT_MOUNT_DELAY_MS,
}: {
  inputValue: string
  setInputValue: (value: string) => void
  isValidDigit: (char: string) => char is T
  onDigit: (digit: T) => void
  enabled?: boolean
  once?: boolean
  enterConfirms?: boolean
  acceptAfterPause?: boolean
  debounceMs?: number
  mountDelayMs?: number
}): void {
  const initialInputValue = useRef(inputValue)
  const hasTriggeredRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enabledAtRef = useRef<number | null>(enabled ? Date.now() : null)
  const typedDuringMountDelayRef = useRef(false)
  const prevInputRef = useRef(inputValue)

  useEffect(() => {
    if (enabled) {
      enabledAtRef.current = Date.now()
    }
  }, [enabled])

  const isMountDelayed = (): boolean =>
    mountDelayMs > 0 &&
    enabledAtRef.current !== null &&
    Date.now() - enabledAtRef.current < mountDelayMs

  useEffect(() => {
    if (inputValue === prevInputRef.current) return
    prevInputRef.current = inputValue
    typedDuringMountDelayRef.current =
      inputValue.length === 1 && isMountDelayed()
  })

  // Latest-ref pattern so callers can pass inline callbacks without causing
  // the effect to re-run (which would reset the debounce timer every render).
  const callbacksRef = useRef({ setInputValue, isValidDigit, onDigit })
  callbacksRef.current = { setInputValue, isValidDigit, onDigit }

  useInput(
    (_input, key, event) => {
      if (!enterConfirms || !enabled || (once && hasTriggeredRef.current)) {
        return
      }
      if (
        inputValue.length !== 1 ||
        (acceptAfterPause && inputValue === initialInputValue.current) ||
        isMountDelayed() ||
        (!acceptAfterPause && typedDuringMountDelayRef.current)
      ) {
        return
      }
      if (!key.return || key.shift || key.ctrl || key.meta || key.super) {
        return
      }
      const lastChar = normalizeFullWidthDigits(inputValue)
      if (!callbacksRef.current.isValidDigit(lastChar)) {
        return
      }
      event.stopImmediatePropagation()
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      hasTriggeredRef.current = true
      callbacksRef.current.setInputValue('')
      callbacksRef.current.onDigit(lastChar)
    },
    { isActive: enabled && enterConfirms },
  )

  useEffect(() => {
    if (!enabled || !acceptAfterPause || (once && hasTriggeredRef.current)) {
      return
    }

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    if (
      inputValue !== initialInputValue.current &&
      inputValue.length === 1 &&
      !isMountDelayed()
    ) {
      const lastChar = normalizeFullWidthDigits(inputValue)
      if (callbacksRef.current.isValidDigit(lastChar)) {
        const trimmed = inputValue.slice(0, -1)
        debounceRef.current = setTimeout(
          (debounceRef, hasTriggeredRef, callbacksRef, trimmed, lastChar) => {
            debounceRef.current = null
            hasTriggeredRef.current = true
            callbacksRef.current.setInputValue(trimmed)
            callbacksRef.current.onDigit(lastChar)
          },
          debounceMs,
          debounceRef,
          hasTriggeredRef,
          callbacksRef,
          trimmed,
          lastChar,
        )
      }
    }

    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [inputValue, enabled, once, acceptAfterPause, debounceMs, mountDelayMs])
}
