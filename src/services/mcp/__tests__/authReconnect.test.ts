/**
 * Official 2.1.206 MCP auth reconnect coordinator (OHs / collateral_rejoin).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  classifyAuthReconnectKind,
  clearAuthReconnectInFlightForTests,
  getAuthReconnectInFlightKeysForTests,
  isConnectionClosedWhileReconnecting,
  joinOrStartAuthReconnect,
  planAuthReconnectJoin,
} from '../authReconnect.js'

afterEach(() => {
  clearAuthReconnectInFlightForTests()
})

describe('classifyAuthReconnectKind', () => {
  test('headersHelper on http/sse/ws', () => {
    expect(
      classifyAuthReconnectKind({
        type: 'http',
        headersHelper: 'mint.sh',
        hasRefreshToken: false,
      }),
    ).toBe('mcp_headers_helper')
  })

  test('oauth refresh_token on http/sse without headersHelper', () => {
    expect(
      classifyAuthReconnectKind({
        type: 'sse',
        url: 'https://x',
        hasRefreshToken: true,
      }),
    ).toBe('mcp_oauth_refresh')
  })

  test('no path without helper or refresh token', () => {
    expect(
      classifyAuthReconnectKind({
        type: 'http',
        url: 'https://x',
        hasRefreshToken: false,
      }),
    ).toBeNull()
  })
})

describe('planAuthReconnectJoin', () => {
  test('leader when no inflight', () => {
    expect(planAuthReconnectJoin(new Set(), 'k', 'mcp_oauth_refresh')).toEqual({
      role: 'leader',
      kind: 'mcp_oauth_refresh',
    })
  })

  test('collateral when key already inflight', () => {
    expect(
      planAuthReconnectJoin(new Set(['k']), 'k', 'mcp_headers_helper'),
    ).toEqual({ role: 'collateral', kind: 'mcp_headers_helper' })
  })
})

describe('isConnectionClosedWhileReconnecting', () => {
  test('true only with -32000 Connection closed and inflight', () => {
    const err = Object.assign(new Error('Connection closed'), { code: -32000 })
    expect(isConnectionClosedWhileReconnecting(err, true)).toBe(true)
    expect(isConnectionClosedWhileReconnecting(err, false)).toBe(false)
    expect(
      isConnectionClosedWhileReconnecting(new Error('Connection closed'), true),
    ).toBe(false)
  })
})

describe('joinOrStartAuthReconnect', () => {
  test('leader runs reconnect once; concurrent waiters rejoin', async () => {
    let runs = 0
    const logs: string[] = []
    const run = () =>
      joinOrStartAuthReconnect(
        'server-a',
        'mcp_oauth_refresh',
        async () => {
          runs++
          await Promise.resolve()
          return { type: 'connected' as const }
        },
        join => logs.push(`${join.role}:${join.kind}`),
      )

    const [a, b] = await Promise.all([run(), run()])
    expect(a.type).toBe('connected')
    expect(b.type).toBe('connected')
    expect(runs).toBe(1)
    expect(logs.filter(l => l.startsWith('leader:'))).toHaveLength(1)
    expect(logs.filter(l => l.startsWith('collateral:'))).toHaveLength(1)
    expect(getAuthReconnectInFlightKeysForTests()).toEqual([])
  })

  test('second wave after first settles becomes a new leader', async () => {
    let runs = 0
    await joinOrStartAuthReconnect(
      'server-b',
      'mcp_headers_helper',
      async () => {
        runs++
        return { type: 'connected' as const }
      },
      () => {},
    )
    await joinOrStartAuthReconnect(
      'server-b',
      'mcp_headers_helper',
      async () => {
        runs++
        return { type: 'connected' as const }
      },
      () => {},
    )
    expect(runs).toBe(2)
  })
})
