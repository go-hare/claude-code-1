import { describe, expect, test } from 'bun:test'
import {
  applyContentBlockStartCompletionState,
  applyContentBlockStopCompletionState,
  applyMessageDeltaCompletionState,
  isStreamPingEvent,
  isStreamResponseAlreadyComplete,
  planStreamCloseAfterComplete,
  STREAM_KEEPALIVE_HEARTBEAT_MS,
  STREAM_KEEPALIVE_MAX_PINGS,
  type StreamCompletionState,
  withStreamKeepAlivePings,
} from '../streamKeepAlive.js'
import type { BodyChunkTimes } from '../bodyIdleWatchdog.js'

describe('isStreamPingEvent densable _0r', () => {
  test('true only for type ping', () => {
    expect(isStreamPingEvent({ type: 'ping' })).toBe(true)
    expect(isStreamPingEvent({ type: 'message_delta' })).toBe(false)
    expect(isStreamPingEvent(null)).toBe(false)
  })
})

describe('close-after-complete densable #5', () => {
  test('La&&To&&at===null → already complete', () => {
    let state: StreamCompletionState = {
      stopReason: null,
      messageDeltaCompleted: false,
      openContentBlockIndex: null,
    }
    state = applyContentBlockStartCompletionState(state, 0)
    expect(state.openContentBlockIndex).toBe(0)
    expect(state.messageDeltaCompleted).toBe(false)
    state = applyContentBlockStopCompletionState(state)
    expect(state.openContentBlockIndex).toBe(null)
    state = applyMessageDeltaCompletionState(state, 'end_turn')
    expect(state.stopReason).toBe('end_turn')
    expect(state.messageDeltaCompleted).toBe(true)
    expect(isStreamResponseAlreadyComplete(state)).toBe(true)
    expect(planStreamCloseAfterComplete(state)).toEqual({
      alreadyComplete: true,
      event: 'tengu_streaming_close_after_complete',
    })
  })

  test('open content block → not complete (mid-response)', () => {
    let state: StreamCompletionState = {
      stopReason: 'end_turn',
      messageDeltaCompleted: true,
      openContentBlockIndex: null,
    }
    // unusual but: if a block reopened after delta, densable To cleared
    state = applyContentBlockStartCompletionState(state, 1)
    expect(isStreamResponseAlreadyComplete(state)).toBe(false)
    expect(planStreamCloseAfterComplete(state).alreadyComplete).toBe(false)
  })

  test('stop_reason null → not complete', () => {
    expect(
      isStreamResponseAlreadyComplete({
        stopReason: null,
        messageDeltaCompleted: true,
        openContentBlockIndex: null,
      }),
    ).toBe(false)
  })

  test('messageDeltaCompleted false → not complete', () => {
    expect(
      isStreamResponseAlreadyComplete({
        stopReason: 'end_turn',
        messageDeltaCompleted: false,
        openContentBlockIndex: null,
      }),
    ).toBe(false)
  })
})

describe('withStreamKeepAlivePings densable Tfb #9', () => {
  test('no chunkTimes → pass-through', async () => {
    async function* src() {
      yield { type: 'message_start' as const }
      yield { type: 'message_stop' as const }
    }
    const out: unknown[] = []
    for await (const p of withStreamKeepAlivePings(src(), undefined)) {
      out.push(p)
    }
    expect(out).toEqual([{ type: 'message_start' }, { type: 'message_stop' }])
  })

  test('synthetic ping when lastAt advances during silence', async () => {
    const times: BodyChunkTimes = { lastAt: 0 }
    let clock = 0
    async function* src() {
      // hang until after a few heartbeats then emit
      await new Promise(r => setTimeout(r, 45))
      yield { type: 'text_delta' as const }
    }
    const gen = withStreamKeepAlivePings(src(), times, {
      heartbeatMs: 10,
      maxConsecutivePings: 5,
      now: () => {
        clock += 1
        return clock
      },
    })
    // After first heartbeat window, bump lastAt (gateway keep-alive bytes)
    setTimeout(() => {
      times.lastAt = 1_000
    }, 5)

    const out: unknown[] = []
    for await (const p of gen) {
      out.push(p)
    }
    expect(out.some(isStreamPingEvent)).toBe(true)
    expect(out.some(e => (e as { type: string }).type === 'text_delta')).toBe(
      true,
    )
  })

  test('constants match densable vfb/Afb', () => {
    expect(STREAM_KEEPALIVE_HEARTBEAT_MS).toBe(10_000)
    expect(STREAM_KEEPALIVE_MAX_PINGS).toBe(30)
  })
})
