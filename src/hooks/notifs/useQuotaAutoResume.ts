/**
 * densable 2.1.234 oTl / veo — quota auto-resume wait UI + tick loop.
 *
 * SEA: subscribe events → notice messages; Tp(tick, armed?30s:null);
 * sticky status via notification while armed/stale.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { useInterval } from 'usehooks-ts'
import { useNotifications } from 'src/context/notifications.js'
import {
  ensureQuotaAutoResumeLimitsSubscription,
  formatAutoContinuePinnedStatus,
  formatAutoContinueWaitNotice,
  getQuotaAutoResumeState,
  QUOTA_AUTO_RESUME_TICK_MS,
  subscribeQuotaAutoResumeChanged,
  subscribeQuotaAutoResumeEvents,
  tickQuotaAutoResume,
  type QuotaAutoResumeEvent,
} from 'src/services/quotaAutoResume.js'
import { createSystemMessage } from 'src/utils/messages.js'
import type { Message } from 'src/types/message.js'

const PINNED_KEY = 'quota-auto-resume'
const CANCELLED_KEY = 'quota-auto-resume-cancelled'
const CAP_KEY = 'quota-auto-resume-cap'

type Props = {
  isLoading: boolean
  setMessages: (f: (prev: Message[]) => Message[]) => void
}

export function useQuotaAutoResume({ isLoading, setMessages }: Props): void {
  const { addNotification, removeNotification } = useNotifications()
  const state = useSyncExternalStore(
    subscribeQuotaAutoResumeChanged,
    getQuotaAutoResumeState,
    getQuotaAutoResumeState,
  )

  useEffect(() => {
    ensureQuotaAutoResumeLimitsSubscription()
  }, [])

  // densable _5e(sYm,"high", armed|stale, footer text)
  useEffect(() => {
    const waiting = state.phase === 'armed' || state.phase === 'stale'
    if (!waiting) {
      removeNotification(PINNED_KEY)
      return
    }
    const text = formatAutoContinuePinnedStatus(state)
    if (!text) {
      removeNotification(PINNED_KEY)
      return
    }
    addNotification({
      key: PINNED_KEY,
      text,
      color: 'suggestion',
      priority: 'high',
      // pinned-ish: long timeout; refreshed on state change
      timeoutMs: 24 * 60 * 60 * 1000,
    })
  }, [state, addNotification, removeNotification])

  useEffect(() => {
    return subscribeQuotaAutoResumeEvents((event: QuotaAutoResumeEvent) => {
      if (event === 'armed' || event === 'rearmed') {
        removeNotification(CAP_KEY)
        removeNotification(CANCELLED_KEY)
        return
      }
      if (event === 'auto-armed') {
        const notice = formatAutoContinueWaitNotice(getQuotaAutoResumeState())
        if (notice) {
          setMessages(prev => [...prev, createSystemMessage(notice, 'info')])
        }
        return
      }
      if (event === 'cancelled') {
        addNotification({
          key: CANCELLED_KEY,
          text: 'Automatic continue cancelled · /rate-limit-options to re-arm',
          priority: 'immediate',
          timeoutMs: 8000,
        })
        return
      }
      if (event === 'fired-now' || event === 'stale') {
        // tick path also appends; event path covers early fire
        return
      }
      if (event === 'disabled' || event === 'horizon-exceeded') {
        addNotification({
          key: CANCELLED_KEY,
          text:
            event === 'horizon-exceeded'
              ? 'Automatic continue stopped — the usage limit now resets more than 24 hours out; the task will not resume on its own'
              : 'Automatic continue was turned off — the task will not resume on its own',
          color: 'warning',
          priority: 'high',
          timeoutMs: 12000,
        })
        return
      }
      if (event === 'cap-exhausted') {
        addNotification({
          key: CAP_KEY,
          text: 'Automatic continue stopped after repeated usage-limit hits · /rate-limit-options to try again',
          color: 'warning',
          priority: 'high',
          timeoutMs: 20000,
        })
      }
    })
  }, [addNotification, removeNotification, setMessages])

  // densable Tp(uOE, phase==="armed"?iYm:null) — 30s tick while armed
  useInterval(
    () => {
      if (getQuotaAutoResumeState().phase !== 'armed') return
      const result = tickQuotaAutoResume(Date.now(), isLoading)
      if (result === 'fired') {
        setMessages(prev => [
          ...prev,
          createSystemMessage(
            'Usage limit reset — Claude is continuing your task',
            'info',
          ),
        ])
        addNotification({
          key: 'quota-auto-resume-fired',
          text: 'Usage limit reset — Claude is continuing your task',
          priority: 'high',
          timeoutMs: 8000,
        })
      } else if (result === 'stale') {
        setMessages(prev => [
          ...prev,
          createSystemMessage(
            'Usage limit reset — press enter to continue',
            'info',
          ),
        ])
        addNotification({
          key: 'quota-auto-resume-stale',
          text: 'Usage limit reset — press enter to continue',
          priority: 'high',
          timeoutMs: 12000,
        })
      }
    },
    state.phase === 'armed' ? QUOTA_AUTO_RESUME_TICK_MS : null,
  )
}
