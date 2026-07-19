import { useEffect, useRef } from 'react'
import { normalizeSurveyDigitInput } from '../../utils/stringUtils.js'

// Delay before accepting a digit as a response, to prevent accidental
// submissions when users start messages with numbers (e.g., numbered lists).
// Short enough to feel instant for intentional presses, long enough to
// cancel when the user types more characters.
const DEFAULT_DEBOUNCE_MS = 400
// densable $8b: ignore digit submit for a short window after mount/enable
const DEFAULT_MOUNT_DELAY_MS = 600

/**
 * Detects when the user types a single valid digit into the prompt input,
 * debounces to avoid accidental submissions (e.g., "1. First item"),
 * trims the digit from the input, and fires a callback.
 *
 * densable zgt residual: Z0f NFKC + AZERTY layout map; mountDelayMs.
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
  debounceMs = DEFAULT_DEBOUNCE_MS,
  mountDelayMs = DEFAULT_MOUNT_DELAY_MS,
}: {
  inputValue: string
  setInputValue: (value: string) => void
  isValidDigit: (char: string) => char is T
  onDigit: (digit: T) => void
  enabled?: boolean
  once?: boolean
  debounceMs?: number
  /** densable $8b: ignore digit acceptance for this many ms after enable */
  mountDelayMs?: number
}): void {
  const initialInputValue = useRef(inputValue)
  const hasTriggeredRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // densable p.current: when enabled became true (mount delay clock)
  const enabledAtRef = useRef<number | null>(enabled ? Date.now() : null)
  const wasEnabledRef = useRef(enabled)
  if (enabled && !wasEnabledRef.current) {
    enabledAtRef.current = Date.now()
  }
  wasEnabledRef.current = enabled

  // Latest-ref pattern so callers can pass inline callbacks without causing
  // the effect to re-run (which would reset the debounce timer every render).
  const callbacksRef = useRef({ setInputValue, isValidDigit, onDigit })
  callbacksRef.current = { setInputValue, isValidDigit, onDigit }

  useEffect(() => {
    if (!enabled || (once && hasTriggeredRef.current)) {
      return
    }

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    // densable mountDelayMs: skip until window elapses
    if (
      enabledAtRef.current !== null &&
      Date.now() - enabledAtRef.current < mountDelayMs
    ) {
      return
    }

    if (inputValue !== initialInputValue.current) {
      // densable zgt: only single-char buffer (prompt digit path)
      const raw = inputValue.length === 1 ? inputValue : inputValue.slice(-1)
      // densable Z0f: NFKC + AZERTY layout map
      const lastChar = normalizeSurveyDigitInput(raw)
      if (callbacksRef.current.isValidDigit(lastChar)) {
        // densable clears whole input on accept (setInputValue("")); residual
        // keeps trim-last-char for multi-char buffers so typing "hello1" works.
        const trimmed = inputValue.length === 1 ? '' : inputValue.slice(0, -1)
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
  }, [inputValue, enabled, once, debounceMs, mountDelayMs])
}
