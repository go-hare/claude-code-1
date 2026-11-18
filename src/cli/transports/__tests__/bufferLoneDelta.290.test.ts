import { describe, expect, test } from 'bun:test'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { CCRClient } from '../ccrClient.js'

function makeDeltaEvent(extra: Record<string, unknown> = {}): StdoutMessage {
  return {
    type: 'stream_event',
    session_id: 's1',
    parent_tool_use_id: null,
    uuid: 'u1',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hi' },
    },
    ...extra,
  } as unknown as StdoutMessage
}

function makeStartEvent(): StdoutMessage {
  return {
    type: 'stream_event',
    session_id: 's1',
    parent_tool_use_id: null,
    uuid: 'u2',
    event: {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
  } as unknown as StdoutMessage
}

describe('v2.1.290 #28: CCRClient.bufferLoneDelta', () => {
  test('returns true and buffers content_block_delta without resume_reason', () => {
    const client = new CCRClient(
      { setOnEvent: () => {} } as never,
      new URL('https://example.com/sessions/s1'),
    )
    const msg = makeDeltaEvent()
    expect(client.bufferLoneDelta(msg)).toBe(true)
    expect(
      (client as unknown as { streamedEphemeralSinceLastAssistant: boolean })
        .streamedEphemeralSinceLastAssistant,
    ).toBe(true)
    // Clean up timer so test exits cleanly
    const timer = (
      client as unknown as {
        streamEventTimer: ReturnType<typeof setTimeout> | null
      }
    ).streamEventTimer
    if (timer) clearTimeout(timer)
  })

  test('returns false for non-delta stream_event or resume_reason or barriers', () => {
    const client = new CCRClient(
      { setOnEvent: () => {} } as never,
      new URL('https://example.com/sessions/s1'),
    )
    expect(client.bufferLoneDelta(makeStartEvent())).toBe(false)
    expect(
      client.bufferLoneDelta(makeDeltaEvent({ resume_reason: 'reconnect' })),
    ).toBe(false)

    ;(client as unknown as { pickupBarriers: unknown[] }).pickupBarriers = [{}]
    expect(client.bufferLoneDelta(makeDeltaEvent())).toBe(false)
    ;(client as unknown as { pickupBarriers: unknown[] }).pickupBarriers = []

    ;(client as unknown as { guardsClientRows: unknown }).guardsClientRows = {}
    expect(client.bufferLoneDelta(makeDeltaEvent())).toBe(false)
    ;(client as unknown as { guardsClientRows: unknown }).guardsClientRows =
      undefined

    ;(
      client as unknown as { streamEventFlushIntervalMs: number }
    ).streamEventFlushIntervalMs = 0
    expect(client.bufferLoneDelta(makeDeltaEvent())).toBe(false)
  })
})
