import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { AppState } from '../../../state/AppStateStore.js'
import {
  createHeadlessMcpIdentityBoundary,
  isRetryableRemoteMcpFailure,
  resolveIdentityBoundaryMcpConfig,
  type HeadlessMcpIdentityBoundaryDeps,
} from '../headlessMcpIdentityBoundary.js'
import {
  mcpSlotSignature,
  type HeadlessDynamicMcpState,
} from '../headlessMcpReconnect.js'
import {
  getMcpIdentityEpoch,
  resetMcpIdentityStateForTests,
  seedMcpIdentityCheck,
  setMcpAccountIdentityResolver,
} from '../mcpIdentity.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../types.js'
import {
  connectToServer,
  disposeServerConnectionDetached,
  evictAllMcpMemosOnIdentityChange,
  fetchToolsForClient,
  getServerCacheKey,
} from '../client.js'

const previousDiscovery = process.env.MCP_DISCOVERY_CACHE
afterEach(() => {
  if (previousDiscovery === undefined) delete process.env.MCP_DISCOVERY_CACHE
  else process.env.MCP_DISCOVERY_CACHE = previousDiscovery
  resetMcpIdentityStateForTests()
})
const config: ScopedMcpServerConfig = {
  type: 'http',
  url: 'https://example.test/mcp',
  scope: 'dynamic',
}
function fixture() {
  resetMcpIdentityStateForTests()
  process.env.MCP_DISCOVERY_CACHE = 'true'
  let account: string | undefined = 'a'
  setMcpAccountIdentityResolver(() =>
    account ? { accountUuid: account, credentialInstalled: true } : undefined,
  )
  seedMcpIdentityCheck()
  const remote: MCPServerConnection = {
    name: 'remote',
    type: 'pending',
    config,
  }
  const localConfig: ScopedMcpServerConfig = {
    type: 'stdio',
    command: 'unused',
    args: [],
    scope: 'dynamic',
  }
  const local: MCPServerConnection = {
    name: 'local',
    type: 'pending',
    config: localConfig,
  }
  let app = {
    mcp: {
      clients: [remote, local],
      tools: [],
      commands: [],
      resources: { remote: [] },
      resourceTemplates: {},
    },
  } as unknown as AppState
  let dynamic: HeadlessDynamicMcpState = {
    clients: [remote],
    tools: [],
    configs: { remote: config },
  }
  const disposed: string[] = []
  let kept = new Set<string>()
  const dials: Record<string, ScopedMcpServerConfig>[] = []
  const deps: HeadlessMcpIdentityBoundaryDeps = {
    getAppState: () => app,
    setAppState: fn => {
      app = fn(app)
    },
    getDynamicMcpState: () => dynamic,
    setDynamicMcpState: next => {
      dynamic = next
    },
    isControlReconnectInFlight: () => false,
    isRunEnding: () => false,
    onReconnected: () => {},
    clearNeedsAuth: () => {},
    clearConnectorConfigs: () => {},
    fetchConnectorConfigs: async () => ({}),
    sleep: async () => {},
    clientModule: {
      disposeServerConnectionDetached: name => {
        disposed.push(name)
      },
      evictAllMcpMemosOnIdentityChange: keys => {
        kept = keys ?? new Set()
      },
      discardMemoizedConnectResult: async () => true,
      getMcpToolsCommandsAndResources: async (report, configs) => {
        dials.push(configs ?? {})
        for (const [name, cfg] of Object.entries(configs ?? {})) {
          report({
            client: { name, config: cfg, type: 'failed', errorCode: '401' },
            tools: [],
            commands: [],
            attemptEpoch: getMcpIdentityEpoch(),
          })
        }
      },
    },
  }
  return {
    deps,
    remote,
    local,
    disposed,
    dials,
    kept: () => kept,
    app: () => app,
    dynamic: () => dynamic,
    account: (next: string | undefined) => {
      account = next
    },
  }
}

describe('headless account identity boundary 289', () => {
  test('production print host mounts identity boundary and both plugin hosts use the shared connect lifecycle', () => {
    const print = readFileSync(
      join(import.meta.dir, '../../../cli/print.ts'),
      'utf8',
    )
    const repl = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf8',
    )
    expect(print).toContain('createHeadlessMcpIdentityBoundary({')
    expect(print).toContain('registerMcpIdentityChangeHandler(() =>')
    expect(print).toContain('takeUnownedMcpIdentityChange()')
    expect(print).toContain('headlessMcpIdentityBoundary.refresh()')
    expect(print).toContain('releaseIdentityBoundary()')
    expect(print).toContain('options.subscribeAppState?.(')
    expect(repl).toContain('connectPluginMcpServer(')
    expect(print).toContain('connectHeadlessMcpServer')
    for (const host of [print, repl]) {
      expect(host).toContain('resolvePluginMcpServer({')
      expect(host).toContain('awaitPluginMcpServer(')
    }
  })
  test('production cache eviction preserves local slots and closes a detached dial that finishes late', async () => {
    fixture()
    const name = 'identity-boundary-late-test'
    const localName = 'identity-boundary-local-test'
    const key = getServerCacheKey(name, config)
    const localKey = getServerCacheKey(localName, config)
    let resolve!: (row: MCPServerConnection) => void
    const pending = new Promise<MCPServerConnection>(done => {
      resolve = done
    })
    const local = Promise.resolve<MCPServerConnection>({
      name: localName,
      config,
      type: 'pending',
    })
    let cleaned = 0
    const connection: ConnectedMCPServer = {
      name,
      config,
      type: 'connected',
      capabilities: {},
      client: { onclose: () => {} } as ConnectedMCPServer['client'],
      cleanup: async () => {
        cleaned++
      },
    }
    const tools = Promise.resolve([])
    connectToServer.cache.set(key, pending)
    connectToServer.cache.set(localKey, local)
    fetchToolsForClient.cache.set(localName, tools)
    try {
      disposeServerConnectionDetached(name, config)
      expect(connectToServer.cache.has(key)).toBe(false)
      evictAllMcpMemosOnIdentityChange(new Set([localKey, localName]))
      expect(connectToServer.cache.get(localKey)).toBe(local)
      expect(fetchToolsForClient.cache.get(localName)).toBe(tools)
      resolve(connection)
      await pending
      await Promise.resolve()
      expect(cleaned).toBe(1)
      expect(connection.client.onclose).toBeUndefined()
    } finally {
      connectToServer.cache.delete(key)
      connectToServer.cache.delete(localKey)
      fetchToolsForClient.cache.delete(localName)
    }
  })

  test('connect waiters remove abort listeners after the shared memo settles', async () => {
    const f = fixture()
    const name = 'identity-abort-cleanup-test'
    const key = getServerCacheKey(name, config)
    const ac = new AbortController()
    let adds = 0
    let removes = 0
    const add = ac.signal.addEventListener.bind(ac.signal)
    const remove = ac.signal.removeEventListener.bind(ac.signal)
    ac.signal.addEventListener = (...args: Parameters<typeof add>) => {
      adds++
      add(...args)
    }
    ac.signal.removeEventListener = (...args: Parameters<typeof remove>) => {
      removes++
      remove(...args)
    }
    connectToServer.cache.set(key, Promise.resolve(f.remote))
    try {
      expect(
        await connectToServer(name, config, undefined, { signal: ac.signal }),
      ).toBe(f.remote)
      expect(adds).toBe(1)
      expect(removes).toBe(1)
    } finally {
      connectToServer.cache.delete(key)
    }
  })

  test('host configs override rows; file-scoped rows re-read current config', () => {
    const read = () => ({ ...config, url: 'https://new.test/mcp' })
    expect(
      resolveIdentityBoundaryMcpConfig(
        'remote',
        { remote: null },
        config,
        read,
      ),
    ).toBeNull()
    expect(resolveIdentityBoundaryMcpConfig('remote', {}, config, read)).toBe(
      config,
    )
    expect(
      resolveIdentityBoundaryMcpConfig(
        'remote',
        {},
        { ...config, scope: 'user' },
        read,
      ),
    ).toEqual(read())
  })

  test('account switch disposes remote rows, preserves local memo keys and converges both stores', async () => {
    const f = fixture()
    const nextConfig = { ...config, url: 'https://new.test/mcp' }
    f.deps.getHostOwnedConfigs = () => ({ remote: nextConfig })
    f.account('b')
    const boundary = createHeadlessMcpIdentityBoundary(f.deps)
    await boundary.refresh()
    await Promise.resolve()
    expect(f.disposed).toEqual(['remote', 'remote'])
    expect(f.kept().has(mcpSlotSignature('local', f.local.config))).toBe(true)
    expect(f.kept().has('local')).toBe(true)
    expect(f.app().mcp.clients.find(row => row.name === 'local')).toBe(f.local)
    expect(f.app().mcp.clients.find(row => row.name === 'remote')?.config).toBe(
      nextConfig,
    )
    expect(f.dynamic().clients[0]?.config).toBe(nextConfig)
    expect(f.dials.some(configs => configs.remote === nextConfig)).toBe(true)
    boundary.dispose()
  })

  test('forced logout clears identity-owned rows without redialing', async () => {
    const f = fixture()
    f.account(undefined)
    const boundary = createHeadlessMcpIdentityBoundary(f.deps)
    await boundary.refresh({ force: true })
    const row = f.app().mcp.clients.find(client => client.name === 'remote')
    expect(row?.type).toBe('failed')
    expect(row && 'errorCode' in row ? row.errorCode : undefined).toBe(
      'IDENTITY_CHANGED',
    )
    expect(f.dials).toEqual([])
    boundary.dispose()
  })

  test('spareUnchangedFrom keeps unchanged rows but never spares pending rows', async () => {
    const f = fixture()
    f.account('b')
    const boundary = createHeadlessMcpIdentityBoundary(f.deps)
    await boundary.refresh({ spareUnchangedFrom: new Set([f.remote, f.local]) })
    expect(f.disposed).toContain('remote')
    expect(f.disposed).not.toContain('local')
    boundary.dispose()
  })

  test('retries transient failures on the gold delay ladder and stops after recovery classification changes', async () => {
    const f = fixture()
    const delays: number[] = []
    f.deps.sleep = async ms => {
      delays.push(ms)
    }
    let attempts = 0
    f.deps.clientModule!.getMcpToolsCommandsAndResources = async (
      report,
      configs,
    ) => {
      if (!configs?.remote) return
      attempts++
      report({
        client: {
          name: 'remote',
          config: configs.remote,
          type: 'failed',
          errorCode: attempts < 3 ? 'CONNECT_TIMEOUT' : '401',
        },
        tools: [],
        commands: [],
        attemptEpoch: getMcpIdentityEpoch(),
      })
    }
    f.account('b')
    const boundary = createHeadlessMcpIdentityBoundary(f.deps)
    await boundary.refresh()
    for (let i = 0; i < 15; i++) await Promise.resolve()
    expect(attempts).toBe(3)
    expect(delays).toEqual([500, 1500])
    boundary.dispose()
  })

  test('connector remount suppresses plugin twins and restores previously suppressed installed plugins', async () => {
    const f = fixture()
    const duplicateName = 'plugin:test:duplicate'
    const restoreName = 'plugin:test:restore'
    const missingName = 'plugin:removed:missing'
    f.deps.setDynamicMcpState({ clients: [], tools: [], configs: {} })
    const duplicateConfig = { ...config, pluginSource: 'test' }
    const restoreConfig = {
      ...config,
      url: 'https://restore.test/mcp',
      pluginSource: 'test',
    }
    f.deps.setAppState(prev => ({
      ...prev,
      mcp: {
        ...prev.mcp,
        clients: [
          { name: duplicateName, type: 'pending', config: duplicateConfig },
        ],
        suppressedPluginMcpServers: [
          { name: restoreName, duplicateOf: 'old-connector' },
          { name: missingName, duplicateOf: 'old-connector' },
        ],
      },
    }))
    f.deps.fetchConnectorConfigs = async () => ({
      connector: { ...config, scope: 'claudeai' },
    })
    f.deps.readInstalledConfigs = async () => ({ [restoreName]: restoreConfig })
    f.account('b')
    const boundary = createHeadlessMcpIdentityBoundary(f.deps)
    await boundary.refresh()
    expect(f.app().mcp.suppressedPluginMcpServers).toEqual([
      { name: duplicateName, duplicateOf: 'connector' },
    ])
    expect(f.app().mcp.clients.some(row => row.name === duplicateName)).toBe(
      false,
    )
    expect(f.app().mcp.clients.some(row => row.name === restoreName)).toBe(true)
    expect(
      f.dials.some(
        configs =>
          configs[restoreName] === restoreConfig &&
          configs.connector !== undefined,
      ),
    ).toBe(true)
    boundary.dispose()
  })

  test('a connector list returned after a newer account switch does not mount', async () => {
    const f = fixture()
    let resolve!: (configs: Record<string, ScopedMcpServerConfig>) => void
    f.deps.fetchConnectorConfigs = () =>
      new Promise(done => {
        resolve = done
      })
    f.account('b')
    const boundary = createHeadlessMcpIdentityBoundary(f.deps)
    const mounting = boundary.refresh()
    f.account('c')
    getMcpIdentityEpoch()
    resolve({ connector: { ...config, scope: 'claudeai' } })
    await mounting
    expect(f.app().mcp.clients.some(row => row.name === 'connector')).toBe(
      false,
    )
    boundary.dispose()
  })

  test('retry selector excludes auth/policy/local failures and retries SSE unclassified failure', () => {
    expect(
      isRetryableRemoteMcpFailure({
        name: 'r',
        config,
        type: 'failed',
        errorCode: 'CONNECT_TIMEOUT',
      }),
    ).toBe(true)
    expect(
      isRetryableRemoteMcpFailure({
        name: 'r',
        config,
        type: 'failed',
        errorCode: '401',
      }),
    ).toBe(false)
    expect(
      isRetryableRemoteMcpFailure({
        name: 'r',
        config: { ...config, type: 'sse' },
        type: 'failed',
      }),
    ).toBe(true)
    expect(
      isRetryableRemoteMcpFailure({
        name: 'r',
        config: {
          command: 'unused',
          args: [],
          type: 'stdio',
          scope: 'dynamic',
        },
        type: 'failed',
        errorCode: 'CONNECT_TIMEOUT',
      }),
    ).toBe(false)
  })
})
