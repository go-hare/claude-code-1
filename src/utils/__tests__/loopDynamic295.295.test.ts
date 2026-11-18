import { describe, expect, test } from 'bun:test'
import {
  addSessionCronTask,
  getSessionCronTasks,
  removeSessionCronTasks,
  setLoopTickInFlightPrompt,
} from '../../bootstrap/state.js'
import {
  cancelLoopWakeupsOnUserAbort,
  LOOP_WAKEUP_CANCELLED_NOTIFICATION_KEY,
  LOOP_WAKEUP_CANCELLED_NOTIFICATION_TEXT,
  subscribeLoopWakeupsCancelled,
  type LoopWakeupsCancelledEvent,
} from '../loopDynamic.js'

function clearAllCronTasks(): void {
  const ids = getSessionCronTasks().map(t => t.id)
  if (ids.length > 0) removeSessionCronTasks(ids)
}

describe('Official 2.1.295 #382 Esc cancelling pending /loop wakeup emits notice', () => {
  test('subscribeLoopWakeupsCancelled fires on user_abort with cancelled count', () => {
    clearAllCronTasks()
    setLoopTickInFlightPrompt(null)

    const events: LoopWakeupsCancelledEvent[] = []
    const unsubscribe = subscribeLoopWakeupsCancelled(e => events.push(e))

    try {
      addSessionCronTask({
        id: 'loop-1',
        cron: '* * * * *',
        prompt: 'check build',
        createdAt: Date.now(),
        kind: 'loop',
        scheduledFor: Date.now() + 60_000,
      })

      const count = cancelLoopWakeupsOnUserAbort('user_abort')
      expect(count).toBe(1)
      expect(events).toEqual([{ reason: 'user_abort', loopsCancelled: 1 }])
      expect(LOOP_WAKEUP_CANCELLED_NOTIFICATION_KEY).toBe(
        'loop-wakeup-cancelled',
      )
      expect(LOOP_WAKEUP_CANCELLED_NOTIFICATION_TEXT).toBe(
        'Pending wakeup cancelled',
      )
    } finally {
      unsubscribe()
      clearAllCronTasks()
      setLoopTickInFlightPrompt(null)
    }
  })

  test('does not emit when there are no pending wakeups or in-flight ticks', () => {
    clearAllCronTasks()
    setLoopTickInFlightPrompt(null)

    const events: LoopWakeupsCancelledEvent[] = []
    const unsubscribe = subscribeLoopWakeupsCancelled(e => events.push(e))

    try {
      expect(cancelLoopWakeupsOnUserAbort('user_abort')).toBe(0)
      expect(events).toEqual([])
    } finally {
      unsubscribe()
    }
  })
})
