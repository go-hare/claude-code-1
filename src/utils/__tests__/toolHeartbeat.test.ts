import { afterEach, describe, expect, mock, test } from 'bun:test'
import { AGENT_TOOL_NAME } from '@claude-code/builtin-tools/tools/AgentTool/constants.js'
import {
  startToolHeartbeat,
  TOOL_HEARTBEAT_INTERVAL_MS,
  type ToolHeartbeatProgress,
} from '../toolHeartbeat.js'

// Avoid bootstrap side effects from logError path
mock.module('src/utils/log.ts', () => ({
  logError: () => {},
  logEvent: () => {},
}))

describe('startToolHeartbeat (densable _Lu / Pss)', () => {
  afterEach(() => {
    // no global timer stubs left — each test restores
  })

  test('returns noop for Agent tool and never schedules', () => {
    let scheduled = 0
    const originalSetInterval = globalThis.setInterval
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      scheduled++
      return originalSetInterval(...args)
    }) as unknown as typeof setInterval

    try {
      const ac = new AbortController()
      const events: ToolHeartbeatProgress[] = []
      const stop = startToolHeartbeat({
        toolName: AGENT_TOOL_NAME,
        toolUseID: 'tu-1',
        abortSignal: ac.signal,
        onProgress: e => events.push(e),
      })
      expect(scheduled).toBe(0)
      stop()
      expect(events).toEqual([])
    } finally {
      globalThis.setInterval = originalSetInterval
    }
  })

  test('emits tool_heartbeat with elapsedTimeSeconds and unique toolUseIDs', () => {
    let tick: (() => void) | undefined
    const originalSetInterval = globalThis.setInterval
    const originalClearInterval = globalThis.clearInterval
    let cleared = 0
    const fakeId = { unref() {} } as unknown as ReturnType<typeof setInterval>

    globalThis.setInterval = ((fn: TimerHandler) => {
      tick = fn as () => void
      return fakeId
    }) as unknown as typeof setInterval
    globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
      if (id === fakeId) cleared++
      else originalClearInterval(id)
    }) as unknown as typeof clearInterval

    try {
      const ac = new AbortController()
      const events: ToolHeartbeatProgress[] = []
      let now = 1_000_000
      const stop = startToolHeartbeat({
        toolName: 'Bash',
        toolUseID: 'tu-bash',
        abortSignal: ac.signal,
        onProgress: e => events.push(e),
        intervalMs: TOOL_HEARTBEAT_INTERVAL_MS,
        now: () => now,
      })

      expect(tick).toBeDefined()
      now = 1_000_000 + 30_000
      tick!()
      now = 1_000_000 + 61_000
      tick!()

      expect(events).toHaveLength(2)
      expect(events[0]).toEqual({
        type: 'progress',
        toolUseID: 'tu-bash-heartbeat-0',
        data: {
          type: 'tool_heartbeat',
          toolName: 'Bash',
          elapsedTimeSeconds: 30,
        },
      })
      expect(events[1]?.toolUseID).toBe('tu-bash-heartbeat-1')
      expect(events[1]?.data.elapsedTimeSeconds).toBe(61)

      stop()
      expect(cleared).toBeGreaterThanOrEqual(1)
      stop()
    } finally {
      globalThis.setInterval = originalSetInterval
      globalThis.clearInterval = originalClearInterval
    }
  })

  test('aborted signal stops interval on next tick', () => {
    let tick: (() => void) | undefined
    const originalSetInterval = globalThis.setInterval
    const originalClearInterval = globalThis.clearInterval
    const fakeId = { unref() {} } as unknown as ReturnType<typeof setInterval>

    globalThis.setInterval = ((fn: TimerHandler) => {
      tick = fn as () => void
      return fakeId
    }) as unknown as typeof setInterval
    globalThis.clearInterval = (() => {}) as unknown as typeof clearInterval

    try {
      const ac = new AbortController()
      const events: ToolHeartbeatProgress[] = []
      const stop = startToolHeartbeat({
        toolName: 'Bash',
        toolUseID: 'tu',
        abortSignal: ac.signal,
        onProgress: e => events.push(e),
        now: () => Date.now(),
      })
      ac.abort()
      tick!()
      expect(events).toEqual([])
      stop()
    } finally {
      globalThis.setInterval = originalSetInterval
      globalThis.clearInterval = originalClearInterval
    }
  })
})
