import { describe, expect, test } from 'bun:test'
import type { Notification } from '../../context/notifications.js'
import type { Message } from '../../types/message.js'
import {
  IDLE_RETURN_HINT_KEY,
  IdleReturnController,
  createIdleReturnTurnSource,
} from '../idleReturnController.js'

function assistantMsgWithTokens(totalInputTokens: number): Message {
  return {
    type: 'assistant',
    uuid: 'u1',
    message: {
      id: 'm1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  } as unknown as Message
}

describe('IdleReturnController #871 lastTurnStopTime', () => {
  test('updating lastTurnStopTime delays the idle-return hint after interrupt', () => {
    let now = 1_000_000
    const scheduled: Array<{ fn: () => void; ms: number; cancelled: boolean }> =
      []
    const added: Notification[] = []
    const removed: string[] = []

    const turn = createIdleReturnTurnSource({
      isLoading: false,
      lastQueryCompletionTime: 100_000,
      lastTurnStopTime: 0,
      submitCount: 1,
    })

    const ctrl = new IdleReturnController({
      turn: turn.turn,
      getMessages: () => [assistantMsgWithTokens(150_000)],
      clock: {
        setTimeout: (fn, ms) => {
          const entry = { fn, ms, cancelled: false }
          scheduled.push(entry)
          return () => {
            entry.cancelled = true
          }
        },
      },
      now: () => now,
      getLastInteractionTime: () => 0,
      isDialogOnScreen: () => false,
      hasPendingLoopWakeup: () => false,
      hasArmedQuotaAutoResume: () => false,
      getIdleNotifThresholdMs: () => 60_000,
      sendIdleNotification: () => {},
      addNotification: n => added.push(n),
      removeNotification: k => removed.push(k),
      hasSeededRemotePrompt: false,
    })

    // Interrupt happens at now = 1_000_000; lastTurnStopTime updates to 1_000_000.
    // The previous hint timer (which had 0ms remaining) must be cancelled and
    // rescheduled using lastTurnStopTime (full idle threshold remaining, not 0ms).
    turn.publish({
      isLoading: false,
      lastQueryCompletionTime: 100_000,
      lastTurnStopTime: 1_000_000,
      submitCount: 1,
    })

    const active = scheduled.filter(s => !s.cancelled)
    expect(active.length).toBeGreaterThan(0)
    const lastHintTimer = active[active.length - 1]!
    expect(lastHintTimer.ms).toBeGreaterThan(0)
    expect(added.find(n => n.key === IDLE_RETURN_HINT_KEY)).toBeUndefined()
    expect(removed).toContain(IDLE_RETURN_HINT_KEY)

    ctrl.dispose()
  })
})
