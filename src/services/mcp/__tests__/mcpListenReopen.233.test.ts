/**
 * densable 2.1.233 #6 — subscriptions/listen re-open / park helpers.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'

const growthbookMock = {
  getFeatureValue_CACHED_MAY_BE_STALE: mock((k: string, d: unknown) => {
    if (k === 'tengu_mcp_listen_reopen_park') return true
    if (k === 'tengu_mcp_listen_reopen_park_tuning') return null
    return d
  }),
}
mock.module('src/services/analytics/growthbook.ts', () => growthbookMock)
mock.module('src/services/analytics/growthbook.js', () => growthbookMock)

const analyticsMock = { logEvent: mock(() => {}) }
mock.module('src/services/analytics/index.ts', () => analyticsMock)
mock.module('src/services/analytics/index.js', () => analyticsMock)

mock.module('src/utils/debug.ts', () => ({ logForDebugging: () => {} }))
mock.module('src/utils/debug.js', () => ({ logForDebugging: () => {} }))

import {
  computeMcpListenParkUntilMs,
  hashMcpServerKey,
  MCP_LISTEN_HEALTHY_MS,
  MCP_LISTEN_PARK_WINDOW_MAX_DEFAULT,
  MCP_LISTEN_REOPEN_BACKOFF_MS,
  nextMcpListenReopenBackoffMs,
  resetDelayIndexIfHealthy,
  resolveMcpListenParkTuning,
  shouldParkMcpListenReopen,
  tryReopenMcpListen,
} from '../mcpListenReopen.js'

afterEach(() => {
  growthbookMock.getFeatureValue_CACHED_MAY_BE_STALE.mockClear()
  analyticsMock.logEvent.mockClear()
})

describe('MCP listen re-open constants densable Q3r/YdS/ZdS', () => {
  test('backoff matches densable Q3r', () => {
    expect([...MCP_LISTEN_REOPEN_BACKOFF_MS]).toEqual([1000, 2000, 4000])
  })

  test('healthy threshold YdS = 10s', () => {
    expect(MCP_LISTEN_HEALTHY_MS).toBe(10_000)
    expect(resetDelayIndexIfHealthy(10_000, 2)).toBe(0)
    expect(resetDelayIndexIfHealthy(9_999, 2)).toBe(2)
  })

  test('next backoff clamps at last slot', () => {
    expect(nextMcpListenReopenBackoffMs(0)).toBe(1000)
    expect(nextMcpListenReopenBackoffMs(2)).toBe(4000)
    expect(nextMcpListenReopenBackoffMs(99)).toBe(4000)
  })
})

describe('shouldParkMcpListenReopen densable park gate', () => {
  test('parks after windowMax reopens in trailing hour', () => {
    const now = 1_000_000
    const stamps = Array.from(
      { length: MCP_LISTEN_PARK_WINDOW_MAX_DEFAULT },
      (_, i) => now - i * 1000,
    )
    expect(
      shouldParkMcpListenReopen({
        reopenTimestampsMs: stamps,
        delayIndex: 0,
        nowMs: now,
        parkEnabled: true,
        tuning: { windowMax: 5, parkDelayMs: 1000 },
      }),
    ).toBe(true)
  })

  test('does not park below windowMax', () => {
    expect(
      shouldParkMcpListenReopen({
        reopenTimestampsMs: [1, 2, 3],
        delayIndex: 0,
        nowMs: 10,
        parkEnabled: true,
        tuning: { windowMax: 5, parkDelayMs: 1000 },
      }),
    ).toBe(false)
  })

  test('park disabled by GB', () => {
    expect(
      shouldParkMcpListenReopen({
        reopenTimestampsMs: [1, 2, 3, 4, 5],
        delayIndex: 0,
        nowMs: 10,
        parkEnabled: false,
        tuning: { windowMax: 5, parkDelayMs: 1000 },
      }),
    ).toBe(false)
  })

  test('does not park when delay budget exhausted', () => {
    expect(
      shouldParkMcpListenReopen({
        reopenTimestampsMs: [1, 2, 3, 4, 5],
        delayIndex: MCP_LISTEN_REOPEN_BACKOFF_MS.length,
        nowMs: 10,
        parkEnabled: true,
        tuning: { windowMax: 5, parkDelayMs: 1000 },
      }),
    ).toBe(false)
  })
})

describe('resolveMcpListenParkTuning', () => {
  test('defaults ZdS/QdS', () => {
    const t = resolveMcpListenParkTuning(null)
    expect(t.windowMax).toBe(5)
    expect(t.parkDelayMs).toBe(21_600_000)
  })

  test('GB windowMax + parkDelayMinutes', () => {
    const t = resolveMcpListenParkTuning({
      windowMax: 3,
      parkDelayMinutes: 10,
    })
    expect(t.windowMax).toBe(3)
    expect(t.parkDelayMs).toBe(600_000)
  })
})

describe('computeMcpListenParkUntilMs jitter', () => {
  test('applies 0.8–1.2 factor', () => {
    const now = 1000
    const delay = 10_000
    expect(computeMcpListenParkUntilMs(delay, now, () => 0)).toBe(
      now + Math.round(delay * 0.8),
    )
    expect(computeMcpListenParkUntilMs(delay, now, () => 1)).toBe(
      now + Math.round(delay * 1.2),
    )
  })
})

describe('tryReopenMcpListen', () => {
  test('no-op without listChanged / listen', async () => {
    const r = await tryReopenMcpListen({
      client: { transport: {} },
      serverName: 't',
      delayIndex: 0,
      trigger: 'remote',
      sleepFn: async () => {},
    })
    expect(r).toBeUndefined()
  })

  test('opens when listen + listChanged present', async () => {
    const sub = { closed: Promise.resolve('remote' as const) }
    const listen = mock(async () => sub)
    const r = await tryReopenMcpListen({
      client: {
        transport: {},
        getServerCapabilities: () => ({ tools: { listChanged: true } }),
        listen,
      },
      serverName: 't',
      delayIndex: 0,
      trigger: 'remote',
      sleepFn: async () => {},
      timeoutMs: 30_000,
    })
    expect(r?.subscription).toBe(sub)
    expect(listen).toHaveBeenCalledWith(
      { toolsListChanged: true },
      { timeout: 30_000 },
    )
    expect(analyticsMock.logEvent).toHaveBeenCalled()
    const payload = analyticsMock.logEvent.mock.calls[0]?.[1] as {
      mcpServerKeyHash?: string
      outcome?: string
    }
    expect(payload?.outcome).toBe('reopened')
    expect(payload?.mcpServerKeyHash).toBe(hashMcpServerKey('t'))
  })
})

describe('hashMcpServerKey densable wce/hu', () => {
  test('sha256 hex slice 0..12', () => {
    expect(hashMcpServerKey('t')).toMatch(/^[0-9a-f]{12}$/)
    expect(hashMcpServerKey('t')).toBe(hashMcpServerKey('t'))
    expect(hashMcpServerKey('a')).not.toBe(hashMcpServerKey('b'))
  })
})

describe('densable LVa / rpS post-reopen refetch', () => {
  test('invokes only honored filter handlers', async () => {
    const {
      clearMcpListenPostReopenHandlers,
      invokeMcpListenPostReopenRefetch,
      registerMcpListenPostReopenHandler,
    } = await import('../mcpListenReopen.js')
    const tools = mock(() => {})
    const prompts = mock(() => {})
    registerMcpListenPostReopenHandler('srv', 'tools', tools)
    registerMcpListenPostReopenHandler('srv', 'prompts', prompts)
    invokeMcpListenPostReopenRefetch('srv', {
      toolsListChanged: true,
      promptsListChanged: false,
    })
    // microtask handlers fire async
    await Promise.resolve()
    await Promise.resolve()
    expect(tools).toHaveBeenCalled()
    expect(prompts).not.toHaveBeenCalled()
    clearMcpListenPostReopenHandlers('srv')
    tools.mockClear()
    invokeMcpListenPostReopenRefetch('srv', { toolsListChanged: true })
    await Promise.resolve()
    expect(tools).not.toHaveBeenCalled()
  })
})
