import { useEffect, useState, useSyncExternalStore } from 'react'
import { getTerminalFocusState, subscribeTerminalFocus } from '@anthropic/ink'
import { getLastInteractionTime } from '../bootstrap/state.js'
import type { PrReviewState } from '../utils/ghPrStatus.js'
import {
  fetchPrStatusForPoller,
  getPrStatusShared,
  isDirectApiEnabled,
  PR_STATUS_FOCUS_RECHECK_MS,
  PrStatusPoller,
  type PrStatusSnapshot,
} from '../utils/prStatusPoller.js'

/** densable 2.1.247 Wut / 248 p5e=60000 — official #b still uses 60000. */
export { PR_STATUS_FOCUS_RECHECK_MS }

/**
 * densable y6 #b — lastFetch===0 ignore; >=Wut refresh; else skip.
 */
export function classifyPrStatusFocusRecheck(
  lastFetchAt: number,
  now: number,
): 'ignore' | 'refresh' | 'skip' {
  if (lastFetchAt === 0) return 'ignore'
  if (now - lastFetchAt >= PR_STATUS_FOCUS_RECHECK_MS) return 'refresh'
  return 'skip'
}

export type PrStatusState = {
  number: number | null
  url: string | null
  reviewState: PrReviewState | null
  lastUpdated: number
}

function subscribeFocus(cb: () => void): () => void {
  return subscribeTerminalFocus(cb)
}

function getFocused(): boolean {
  return getTerminalFocusState() !== 'blurred'
}

function snapshotToState(snap: PrStatusSnapshot): PrStatusState {
  return {
    number: snap.pr?.number ?? null,
    url: snap.pr?.url ?? null,
    reviewState: snap.pr?.reviewState ?? null,
    lastUpdated: snap.lastUpdated,
  }
}

function createCancelTimeout(): (fn: () => void, ms: number) => () => void {
  return (fn, ms) => {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  }
}

/**
 * densable nge @203023644 — `new wY({fetchPrStatus:eDt, shared:JE(), ...})`.
 * Footer PromptInputFooterLeftSide is the production caller.
 */
export function usePrStatus(isLoading: boolean, enabled = true): PrStatusState {
  const focused = useSyncExternalStore(subscribeFocus, getFocused, getFocused)
  const [poller] = useState(
    () =>
      new PrStatusPoller(
        {
          setTimeout: createCancelTimeout(),
          now: () => Date.now(),
          getLastInteractionTime,
          fetchPrStatus: fetchPrStatusForPoller,
          isDirectApiEnabled,
          shared: getPrStatusShared(),
        },
        { isLoading, enabled, focused },
      ),
  )

  useEffect(() => {
    poller.setInputs({ isLoading, enabled, focused })
  }, [poller, isLoading, enabled, focused])

  const snap = useSyncExternalStore(
    poller.subscribe,
    poller.getSnapshot,
    poller.getSnapshot,
  )
  return snapshotToState(snap)
}
