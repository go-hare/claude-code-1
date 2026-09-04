import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import type { AppState } from '../../../state/AppStateStore.js'
import type { Tool } from '../../../Tool.js'
import {
  attachHeadlessRemoteMcpReconnect,
  chainMcpClientOnclose,
  HEADLESS_MCP_MAX_RECONNECT_ATTEMPTS,
  headlessReconnectBackoffMs,
  isHeadlessReconnectingTransport,
  reconnectHeadlessRemoteMcpAfterClose,
  type HeadlessDynamicMcpState,
  type HeadlessMcpReconnectDeps,
} from '../headlessMcpReconnect.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../types.js'

function httpConfig(): ScopedMcpServerConfig {
  return {
    type: 'http',
    url: 'https://example.test/mcp',
    scope: 'user',
  } as ScopedMcpServerConfig
}

function fakeConnected(
  name: string,
  config: ScopedMcpServerConfig = httpConfig(),
): ConnectedMCPServer {
  return {
    type: 'connected',
    name,
    config,
    client: { onclose: undefined } as ConnectedMCPServer['client'],
    capabilities: {},
    cleanup: async () => {},
  }
}

function emptyMcp(): AppState['mcp'] {
  return {
    clientsInitialized: true,
    clients: [],
    tools: [],
    commands: [],
    resources: {},
    resourceTemplates: {},
    suppressedPluginMcpServers: [],
    pluginReconnectKey: 0,
  }
}

function makeDeps(seed: MCPServerConnection[]): {
  deps: HeadlessMcpReconnectDeps
  getClients: () => MCPServerConnection[]
  reconnected: string[]
} {
  let app: AppState = {
    mcp: { ...emptyMcp(), clients: seed },
  } as AppState
  let dynamic: HeadlessDynamicMcpState = { clients: [], tools: [] }
  const reconnected: string[] = []
  const deps: HeadlessMcpReconnectDeps = {
    getAppState: () => app,
    setAppState: f => {
      app = f(app)
    },
    getDynamicMcpState: () => dynamic,
    setDynamicMcpState: next => {
      dynamic = next
    },
    isControlReconnectInFlight: () => false,
    isRunEnding: () => false,
    onReconnected: client => {
      reconnected.push(client.name)
    },
    sleep: async () => {},
  }
  return {
    deps,
    getClients: () => app.mcp.clients,
    reconnected,
  }
}

describe('headless MCP reconnect 243', () => {
  test('JA: remote transports reconnect; stdio/sdk/undefined do not', () => {
    expect(isHeadlessReconnectingTransport({ type: 'http' })).toBe(true)
    expect(isHeadlessReconnectingTransport({ type: 'sse' })).toBe(true)
    expect(isHeadlessReconnectingTransport({ type: 'claudeai-proxy' })).toBe(
      true,
    )
    expect(isHeadlessReconnectingTransport({ type: 'stdio' })).toBe(false)
    expect(isHeadlessReconnectingTransport({ type: 'sdk' })).toBe(false)
    expect(isHeadlessReconnectingTransport({ type: undefined })).toBe(false)
  })

  test('iu: exponential backoff 1s/2s/4s capped at 30s', () => {
    expect(headlessReconnectBackoffMs(1)).toBe(1000)
    expect(headlessReconnectBackoffMs(2)).toBe(2000)
    expect(headlessReconnectBackoffMs(3)).toBe(4000)
    expect(headlessReconnectBackoffMs(10)).toBe(30000)
  })

  test('kUu chains previous onclose then the reconnect hook', () => {
    const conn = fakeConnected('remote')
    const order: string[] = []
    conn.client.onclose = () => {
      order.push('cache-clear')
    }
    chainMcpClientOnclose(conn, () => {
      order.push('reconnect')
    })
    conn.client.onclose?.()
    expect(order).toEqual(['cache-clear', 'reconnect'])
  })

  test('mS wires each remote client once and skips stdio', () => {
    const remote = fakeConnected('http')
    const stdio = fakeConnected('local', {
      type: 'stdio',
      command: 'echo',
      args: [],
      scope: 'user',
    } as ScopedMcpServerConfig)
    const { deps } = makeDeps([remote, stdio])
    const attach = attachHeadlessRemoteMcpReconnect(deps)
    attach([remote, stdio])
    attach([remote, stdio])
    expect(remote.client.onclose).toBeTypeOf('function')
    expect(stdio.client.onclose).toBeUndefined()
  })

  test('ZA reconnects then reports failed after ko attempts', async () => {
    const closed = fakeConnected('http')
    const { deps, getClients, reconnected } = makeDeps([closed])
    let calls = 0
    deps.mcpClient = {
      reconnectMcpServerImpl: async (name, config) => {
        calls++
        return {
          client: { name, type: 'failed', config, error: 'down' },
          tools: [] as Tool[],
          commands: [],
        }
      },
      peekSettledConnection: async () => undefined,
      detachAndCloseConnection: async () => {},
      dropDiscoveryEntry: async () => {},
      seedMcpIdentityCheck: () => {},
      getMcpIdentityEpoch: () => 0,
      mcpIdentityChangedSinceLastCheck: () => false,
      cleanupConnectedMcpClients: async () => {},
    }
    await reconnectHeadlessRemoteMcpAfterClose(deps, closed)
    expect(calls).toBe(HEADLESS_MCP_MAX_RECONNECT_ATTEMPTS)
    expect(getClients()[0]?.type).toBe('failed')
    expect(reconnected).toEqual([])
  })

  test('ZA applies a successful reconnect only when peekSettled === connected', async () => {
    const closed = fakeConnected('http')
    const { deps, getClients, reconnected } = makeDeps([closed])
    const next = fakeConnected('http')
    deps.mcpClient = {
      reconnectMcpServerImpl: async () => ({
        client: next,
        tools: [],
        commands: [],
      }),
      peekSettledConnection: async () => next,
      detachAndCloseConnection: async () => {},
      dropDiscoveryEntry: async () => {},
      seedMcpIdentityCheck: () => {},
      getMcpIdentityEpoch: () => 0,
      mcpIdentityChangedSinceLastCheck: () => false,
      cleanupConnectedMcpClients: async () => {},
    }
    await reconnectHeadlessRemoteMcpAfterClose(deps, closed)
    expect(getClients()[0]).toBe(next)
    expect(reconnected).toEqual(['http'])
  })

  test('ZA marks failed when connected result is no longer the settled memo', async () => {
    const closed = fakeConnected('http')
    const { deps, getClients, reconnected } = makeDeps([closed])
    const next = fakeConnected('http')
    let detached = 0
    deps.mcpClient = {
      reconnectMcpServerImpl: async () => ({
        client: next,
        tools: [],
        commands: [],
      }),
      peekSettledConnection: async () => undefined,
      detachAndCloseConnection: async () => {
        detached++
      },
      dropDiscoveryEntry: async () => {},
      seedMcpIdentityCheck: () => {},
      getMcpIdentityEpoch: () => 0,
      mcpIdentityChangedSinceLastCheck: () => false,
      cleanupConnectedMcpClients: async () => {},
    }
    await reconnectHeadlessRemoteMcpAfterClose(deps, closed)
    expect(detached).toBeGreaterThan(0)
    expect(getClients()[0]?.type).toBe('failed')
    expect((getClients()[0] as { error?: string }).error).toBe(
      'Connection closed again while reconnecting',
    )
    expect(reconnected).toEqual([])
  })

  test('print.ts attaches mS, $d session-end, and identity seed', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../cli/print.ts'),
      'utf8',
    )
    expect(src).toContain('attachHeadlessRemoteMcpReconnect')
    expect(src).toContain('isControlReconnectInFlight')
    expect(src).toContain('headlessMcpRunEnding')
    expect(src).toContain('seedMcpIdentityCheck')
    expect(src).toContain('cleanupConnectedMcpClients')
  })
})
