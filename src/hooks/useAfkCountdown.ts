import { useEffect, useRef, useState } from 'react'
import { useInterval } from 'usehooks-ts'
import {
  getLastInteractionTime,
  updateLastInteractionTime,
} from '../bootstrap/state.js'

const DEFAULT_COUNTDOWN_THRESHOLD_MS = 20_000

type UseAfkCountdownOptions = {
  enabled: boolean
  timeoutMs?: number | null
  countdownThresholdMs?: number
  onTimeout: (timeoutMs: number) => void
}

/**
 * AFK auto-continue timer for AskUserQuestion (official 2.1.200).
 * Counts idle time from last user interaction; shows a countdown when
 * remaining time is within the threshold. Any key activity resets via
 * updateLastInteractionTime / getLastInteractionTime.
 */
export function useAfkCountdown({
  enabled,
  timeoutMs,
  countdownThresholdMs,
  onTimeout,
}: UseAfkCountdownOptions): {
  remainingSeconds: number
  showCountdown: boolean
  timeoutMs: number | null
} {
  const envCountdown = process.env.CLAUDE_AFK_COUNTDOWN_MS
  const parsedCountdown =
    envCountdown !== undefined && envCountdown !== ''
      ? parseInt(envCountdown, 10)
      : Number.NaN
  const effectiveTimeout = timeoutMs && timeoutMs > 0 ? timeoutMs : null
  const threshold = Math.min(
    !Number.isNaN(parsedCountdown) && parsedCountdown > 0
      ? parsedCountdown
      : (countdownThresholdMs ?? DEFAULT_COUNTDOWN_THRESHOLD_MS),
    effectiveTimeout ?? DEFAULT_COUNTDOWN_THRESHOLD_MS,
  )

  const initialSeconds = Math.ceil((effectiveTimeout ?? 0) / 1000)
  const [remainingSeconds, setRemainingSeconds] = useState(initialSeconds)
  const firedRef = useRef(false)
  const startedAtRef = useRef(Date.now())
  const onTimeoutRef = useRef(onTimeout)
  onTimeoutRef.current = onTimeout

  useEffect(() => {
    if (!enabled || !effectiveTimeout) {
      return
    }
    // Don't fire immediately for an already-stale interaction clock when the
    // dialog opens — treat dialog open as a fresh interaction baseline.
    updateLastInteractionTime(true)
    startedAtRef.current = Date.now()
    firedRef.current = false
    setRemainingSeconds(Math.ceil(effectiveTimeout / 1000))
  }, [enabled, effectiveTimeout])

  useInterval(
    () => {
      if (!enabled || !effectiveTimeout || firedRef.current) {
        return
      }
      const now = Date.now()
      const idleMs =
        now - Math.max(getLastInteractionTime(), startedAtRef.current)
      const remaining =
        idleMs >= effectiveTimeout - threshold
          ? Math.max(0, Math.ceil((effectiveTimeout - idleMs) / 1000))
          : Math.ceil(effectiveTimeout / 1000)
      setRemainingSeconds(remaining)
      if (idleMs >= effectiveTimeout) {
        firedRef.current = true
        onTimeoutRef.current(effectiveTimeout)
      }
    },
    enabled && effectiveTimeout ? 1000 : null,
  )

  const showCountdown =
    !!enabled && !!effectiveTimeout && remainingSeconds * 1000 <= threshold

  return {
    remainingSeconds,
    showCountdown,
    timeoutMs: effectiveTimeout,
  }
}
