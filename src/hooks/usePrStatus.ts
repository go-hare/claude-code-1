import { useEffect, useRef, useState } from 'react'
import { getLastInteractionTime } from '../bootstrap/state.js'
import { fetchPrStatus, type PrReviewState } from '../utils/ghPrStatus.js'
import type { PrNeedsAuth } from '../utils/prStatusFooter.js'

const POLL_INTERVAL_MS = 60_000
const SLOW_GH_THRESHOLD_MS = 4_000
const IDLE_STOP_MS = 60 * 60_000 // stop polling after 60 min idle

/**
 * densable PHa / SRb — local PR poll snapshot.
 * `pr` is the open PR for this branch (null when none/unavailable).
 * `needsAuth` is only set by harbor-style direct REST paths (tengu_harbor_prism);
 * the legacy `gh pr view` path leaves it false (densable QAg).
 */
export type PrStatusState = {
  pr: {
    number: number
    url: string
    reviewState: PrReviewState
    kind?: string
  } | null
  needsAuth: PrNeedsAuth
  lastUpdated: number
}

/** @deprecated Prefer `.pr` — kept for callers that still read flat fields. */
export type PrStatusFlat = {
  number: number | null
  url: string | null
  reviewState: PrReviewState | null
  lastUpdated: number
}

const INITIAL_STATE: PrStatusState = {
  pr: null,
  needsAuth: false,
  lastUpdated: 0,
}

/**
 * Polls PR review status every 60s while the session is active.
 * When no interaction is detected for 60 minutes, the loop stops — no
 * timers remain. React re-runs the effect when isLoading changes
 * (turn starts/ends), restarting the loop. Effect setup schedules
 * the next poll relative to the last fetch time so turn boundaries
 * don't spawn `gh` more than once per interval. Disables permanently
 * if a fetch exceeds 4s.
 *
 * Pass `enabled: false` to skip polling entirely (hook still must be
 * called unconditionally to satisfy the rules of hooks).
 */
export function usePrStatus(isLoading: boolean, enabled = true): PrStatusState {
  const [prStatus, setPrStatus] = useState<PrStatusState>(INITIAL_STATE)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disabledRef = useRef(false)
  const lastFetchRef = useRef(0)

  useEffect(() => {
    if (!enabled) return
    if (disabledRef.current) return

    let cancelled = false
    let lastSeenInteractionTime = -1
    let lastActivityTimestamp = Date.now()

    async function poll() {
      if (cancelled) return

      const currentInteractionTime = getLastInteractionTime()
      if (lastSeenInteractionTime !== currentInteractionTime) {
        lastSeenInteractionTime = currentInteractionTime
        lastActivityTimestamp = Date.now()
      } else if (Date.now() - lastActivityTimestamp >= IDLE_STOP_MS) {
        return
      }

      const start = Date.now()
      const result = await fetchPrStatus()
      if (cancelled) return
      lastFetchRef.current = start

      setPrStatus(prev => {
        const nextPr: PrStatusState['pr'] = result
          ? {
              number: result.number,
              url: result.url,
              reviewState: result.reviewState,
            }
          : null
        // densable QAg path: failures are null, not needs-auth (harbor only).
        const needsAuth: PrNeedsAuth = false
        if (
          prev.lastUpdated > 0 &&
          prev.pr?.number === nextPr?.number &&
          prev.pr?.url === nextPr?.url &&
          prev.pr?.reviewState === nextPr?.reviewState &&
          prev.pr?.kind === nextPr?.kind &&
          prev.needsAuth === needsAuth
        ) {
          return prev
        }
        return {
          pr: nextPr,
          needsAuth,
          lastUpdated: Date.now(),
        }
      })

      if (Date.now() - start > SLOW_GH_THRESHOLD_MS) {
        disabledRef.current = true
        return
      }

      if (!cancelled) {
        timeoutRef.current = setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    const elapsed = Date.now() - lastFetchRef.current
    if (elapsed >= POLL_INTERVAL_MS) {
      void poll()
    } else {
      timeoutRef.current = setTimeout(poll, POLL_INTERVAL_MS - elapsed)
    }

    return () => {
      cancelled = true
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [isLoading, enabled])

  return prStatus
}
