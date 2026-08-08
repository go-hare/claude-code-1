/**
 * densable 2.1.218 #19 — DYo/Kka mcpNeedsAuthCount filter.
 * claude.ai connectors not connected in claude.ai must not inflate the
 * "N MCP servers need authentication" startup notice.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { MCPServerConnection, ScopedMcpServerConfig } from '../types.js'
import {
  countMcpNeedsAuth,
  shouldCountMcpClientForAuthNotice,
} from '../utils.js'

function proxy(
  name: string,
  opts: {
    eligible?: boolean
    type?: 'needs-auth' | 'failed' | 'connected'
  } = {},
): MCPServerConnection {
  const { eligible, type = 'needs-auth' } = opts
  const config = {
    type: 'claudeai-proxy' as const,
    url: 'https://example.com',
    id: 'id-' + name,
    scope: 'claudeai' as const,
    ...(eligible !== undefined ? { eligible } : {}),
  } satisfies ScopedMcpServerConfig
  if (type === 'connected') {
    return {
      name,
      type: 'connected',
      config,
      client: {} as never,
      capabilities: {},
      cleanup: async () => {},
    }
  }
  return { name, type, config }
}

function local(
  name: string,
  type: 'needs-auth' | 'failed' = 'needs-auth',
  transport: 'http' | 'sse-ide' | 'ws-ide' = 'http',
): MCPServerConnection {
  if (transport === 'sse-ide') {
    return {
      name,
      type,
      config: {
        type: 'sse-ide',
        url: 'http://localhost',
        ideName: 'vscode',
        scope: 'dynamic',
      },
    }
  }
  if (transport === 'ws-ide') {
    return {
      name,
      type,
      config: {
        type: 'ws-ide',
        url: 'ws://localhost',
        ideName: 'vscode',
        scope: 'dynamic',
      },
    }
  }
  return {
    name,
    type,
    config: {
      type: 'http',
      url: 'https://example.com',
      scope: 'user',
    },
  }
}

describe('densable 2.1.218 #19 DYo/Kka', () => {
  const ever = new Set<string>()
  const session = new Set<string>()
  const everFn = (n: string) => ever.has(n)
  const sessionFn = (n: string) => session.has(n)

  beforeEach(() => {
    ever.clear()
    session.clear()
  })

  afterEach(() => {
    ever.clear()
    session.clear()
  })

  test('DYo: local needs-auth counts', () => {
    expect(
      shouldCountMcpClientForAuthNotice(local('a'), everFn, sessionFn),
    ).toBe(true)
  })

  test('DYo: excludes sse-ide and ws-ide', () => {
    expect(
      shouldCountMcpClientForAuthNotice(
        local('ide', 'needs-auth', 'sse-ide'),
        everFn,
        sessionFn,
      ),
    ).toBe(false)
    expect(
      shouldCountMcpClientForAuthNotice(
        local('ide2', 'needs-auth', 'ws-ide'),
        everFn,
        sessionFn,
      ),
    ).toBe(false)
  })

  test('DYo: claudeai-proxy without ever-connected is excluded', () => {
    expect(
      shouldCountMcpClientForAuthNotice(proxy('c1'), everFn, sessionFn),
    ).toBe(false)
  })

  test('DYo: claudeai-proxy with ever-connected counts', () => {
    ever.add('c1')
    expect(
      shouldCountMcpClientForAuthNotice(proxy('c1'), everFn, sessionFn),
    ).toBe(true)
  })

  test('DYo: eligible===false without session-connected is excluded even if ever', () => {
    ever.add('c1')
    expect(
      shouldCountMcpClientForAuthNotice(
        proxy('c1', { eligible: false }),
        everFn,
        sessionFn,
      ),
    ).toBe(false)
  })

  test('DYo: eligible===false with session-connected uses Vsr path', () => {
    ever.add('c1')
    session.add('c1')
    expect(
      shouldCountMcpClientForAuthNotice(
        proxy('c1', { eligible: false }),
        everFn,
        sessionFn,
      ),
    ).toBe(true)
  })

  test('Kka: overcount fix — ineligible connectors do not inflate total', () => {
    ever.add('was-working')
    const clients: MCPServerConnection[] = [
      local('local-http'),
      proxy('never-used'),
      proxy('ineligible', { eligible: false }),
      proxy('was-working'),
      local('ide', 'needs-auth', 'sse-ide'),
    ]
    expect(countMcpNeedsAuth(clients, everFn, sessionFn)).toBe(2)
  })

  test('Kka: zero when only never-connected claude.ai connectors', () => {
    const clients = [proxy('a'), proxy('b', { eligible: false })]
    expect(countMcpNeedsAuth(clients, everFn, sessionFn)).toBe(0)
  })
})
