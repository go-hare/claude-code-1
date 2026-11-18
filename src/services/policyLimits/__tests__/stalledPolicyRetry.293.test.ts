import { describe, expect, test } from 'bun:test'
import {
  STALLED_POLICY_FETCH_HEDGE_DELAY_MS,
  hedgeStalledRequest,
  startAbortableAttempt,
} from '../stalledPolicyRetry.js'

describe('v2.1.293 #324 3s stalled policy fetch hedge retry', () => {
  test('STALLED_POLICY_FETCH_HEDGE_DELAY_MS is 3000ms', () => {
    expect(STALLED_POLICY_FETCH_HEDGE_DELAY_MS).toBe(3000)
  })

  test('fast first attempt resolves without hedging', async () => {
    let calls = 0
    const res = await hedgeStalledRequest({
      first: startAbortableAttempt(async () => {
        calls++
        return { ok: true, id: 1 }
      }),
      send: async () => {
        calls++
        return { ok: true, id: 2 }
      },
      isAnswer: v => v.ok,
      delayMs: 30,
    })
    expect(res).toEqual({ result: { ok: true, id: 1 }, hedged: false })
    expect(calls).toBe(1)
  })

  test('stalled first attempt launches hedged request after delayMs and aborts loser', async () => {
    let firstAborted = false
    let secondCalled = false
    const res = await hedgeStalledRequest({
      first: startAbortableAttempt(
        signal =>
          new Promise<{ ok: boolean; id: number }>(resolve => {
            signal.addEventListener('abort', () => {
              firstAborted = true
            })
            setTimeout(() => resolve({ ok: true, id: 1 }), 500)
          }),
      ),
      send: async () => {
        secondCalled = true
        return { ok: true, id: 2 }
      },
      isAnswer: v => v.ok,
      delayMs: 15,
    })
    expect(secondCalled).toBe(true)
    expect(firstAborted).toBe(true)
    expect(res).toEqual({ result: { ok: true, id: 2 }, hedged: true })
  })
})
