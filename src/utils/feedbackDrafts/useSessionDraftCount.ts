import { useEffect, useSyncExternalStore } from 'react'
import { getSessionId } from '../../bootstrap/state.js'
import { useSessionServices } from '../../context/sessionServices.js'
import { isSendFeedbackEnabled } from './gates.js'
import {
  getFeedbackNoticeState,
  seedSessionDraftCount,
  subscribeFeedbackNotice,
  tryStartFeedbackDraftSeed,
} from './notice.js'
import { countQueuedDraftsForSession } from './writeDraft.js'

/** densable leftover `_6` */
export function useFeedbackNoticeState() {
  return useSyncExternalStore(
    subscribeFeedbackNotice,
    getFeedbackNoticeState,
    getFeedbackNoticeState,
  )
}

/** densable leftover zO */
export function useSessionDraftCount(): number {
  const state = useFeedbackNoticeState()
  const { storageV5 } = useSessionServices()
  useEffect(() => {
    if (!isSendFeedbackEnabled() || !tryStartFeedbackDraftSeed()) return
    void countQueuedDraftsForSession(getSessionId(), storageV5)
      .then(seedSessionDraftCount)
      .catch(() => {})
  }, [storageV5])
  return isSendFeedbackEnabled() ? state.sessionDraftCount : 0
}
