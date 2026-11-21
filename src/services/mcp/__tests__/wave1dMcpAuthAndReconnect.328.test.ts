import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import * as secureStorageMod from '../../../utils/secureStorage/index.js'
import type {
  SecureStorage,
  SecureStorageData,
} from '../../../utils/secureStorage/types.js'
import {
  ClaudeAuthProvider,
  getServerKey,
  resetCredentialStoreStrictProbeState,
} from '../auth.js'
import {
  clearServerCache,
  connectToServer,
  getServerCacheKey,
  reconnectMcpServerImpl,
} from '../client.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../types.js'
import {
  runReconnectWithBackoffForServer,
  startSlowBackgroundReconnectForServer,
} from '../useManageMCPConnections.js'

function makeMemoryStorage(initial: SecureStorageData = {}): {
  storage: SecureStorage
  data: () => SecureStorageData
} {
  let state: SecureStorageData = structuredClone(initial)
  const storage: SecureStorage = {
    name: 'memory-test',
    read: () => state,
    readAsync: async () => state,
    readAsyncStrict: async () => state,
    update: next => {
      state = structuredClone(next)
      return { success: true }
    },
    delete: () => {
      state = {}
      return true
    },
  }
  return { storage, data: () => state }
}

describe('Wave 1D — P0-17: MCP Auth SEP-2352 issuer validation & token round-trip', () => {
  const spies: Array<{ mockRestore(): void }> = []

  afterEach(() => {
    while (spies.length > 0) {
      spies.pop()?.mockRestore()
    }
    resetCredentialStoreStrictProbeState()
  })

  test('clientInformation() and tokens() enforce validateSep2352Issuer on read paths', async () => {
    const serverConfig = {
      type: 'http' as const,
      url: 'https://mcp.sep2352.example.com/v1',
    }
    const key = getServerKey('sep-srv', serverConfig)
    const mem = makeMemoryStorage({
      mcpOAuth: {
        [key]: {
          serverName: 'sep-srv',
          serverUrl: serverConfig.url,
          clientId: 'client-a',
          clientSecret: 'secret-a',
          accessToken: 'access-a',
          refreshToken: 'refresh-a',
          expiresAt: Date.now() + 3_600_000,
          scope: 'read',
          issuer: 'https://issuer-a.example.com/',
        },
      },
    })
    spies.push(
      spyOn(secureStorageMod, 'getSecureStorage').mockReturnValue(mem.storage),
    )

    const provider = new ClaudeAuthProvider(
      'sep-srv',
      serverConfig,
      undefined,
      true,
    )

    // Trailing-slash normalized match succeeds and round-trips issuer
    const matchedClient = await provider.clientInformation({
      issuer: 'https://issuer-a.example.com',
    })
    expect(matchedClient?.client_id).toBe('client-a')
    expect(matchedClient?.issuer).toBe('https://issuer-a.example.com/')

    const matchedTokens = await provider.tokens({
      issuer: 'https://issuer-a.example.com',
    })
    expect(matchedTokens?.access_token).toBe('access-a')
    expect(matchedTokens?.issuer).toBe('https://issuer-a.example.com/')

    // Issuer mismatch is rejected on BOTH clientInformation() and tokens()
    expect(
      await provider.clientInformation({
        issuer: 'https://issuer-b.example.com',
      }),
    ).toBeUndefined()
    expect(
      await provider.tokens({ issuer: 'https://issuer-b.example.com' }),
    ).toBeUndefined()

    // Expected issuer set via saveAuthorizationServerUrl also enforces SEP-2352 when called with 0 args
    await provider.saveAuthorizationServerUrl('https://issuer-b.example.com')
    expect(await provider.clientInformation()).toBeUndefined()
    expect(await provider.tokens()).toBeUndefined()
  })

  test('saveTokens() preserves stored refreshToken and issuer across non-rotating refreshes', async () => {
    const serverConfig = {
      type: 'http' as const,
      url: 'https://mcp.nonrotating.example.com/v1',
    }
    const key = getServerKey('nr-srv', serverConfig)
    const mem = makeMemoryStorage({
      mcpOAuth: {
        [key]: {
          serverName: 'nr-srv',
          serverUrl: serverConfig.url,
          accessToken: 'old-access',
          refreshToken: 'sticky-refresh-token',
          expiresAt: Date.now() + 3_600_000,
          scope: 'read',
          issuer: 'https://auth.nonrotating.example.com',
        },
      },
    })
    spies.push(
      spyOn(secureStorageMod, 'getSecureStorage').mockReturnValue(mem.storage),
    )

    const provider = new ClaudeAuthProvider(
      'nr-srv',
      serverConfig,
      undefined,
      true,
    )

    // Non-rotating AS returns new access_token without refresh_token or issuer
    await provider.saveTokens({
      access_token: 'new-access',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'read',
    })

    const saved = mem.data().mcpOAuth?.[key]
    expect(saved?.accessToken).toBe('new-access')
    expect(saved?.refreshToken).toBe('sticky-refresh-token')
    expect(saved?.issuer).toBe('https://auth.nonrotating.example.com')

    // Stored read round-trips both preserved refresh_token and issuer
    const served = await provider.tokens()
    expect(served?.access_token).toBe('new-access')
    expect(served?.refresh_token).toBe('sticky-refresh-token')
    expect(served?.issuer).toBe('https://auth.nonrotating.example.com')
  })

  test('tokens() round-trips issuer on proactive refresh branch', async () => {
    const serverConfig = {
      type: 'http' as const,
      url: 'https://mcp.proactive.example.com/v1',
    }
    const key = getServerKey('proactive-srv', serverConfig)
    const mem = makeMemoryStorage({
      mcpOAuth: {
        [key]: {
          serverName: 'proactive-srv',
          serverUrl: serverConfig.url,
          accessToken: 'expiring-access',
          refreshToken: 'rt-1',
          // Expires in 60s (< 300s proactive refresh threshold)
          expiresAt: Date.now() + 60_000,
          scope: 'read',
          issuer: 'https://auth.proactive.example.com',
        },
      },
    })
    spies.push(
      spyOn(secureStorageMod, 'getSecureStorage').mockReturnValue(mem.storage),
    )

    const provider = new ClaudeAuthProvider(
      'proactive-srv',
      serverConfig,
      undefined,
      true,
    )
    spies.push(
      spyOn(provider, 'refreshAuthorization').mockResolvedValue({
        access_token: 'refreshed-access',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    )

    const tokens = await provider.tokens()
    expect(tokens?.access_token).toBe('refreshed-access')
    expect(tokens?.issuer).toBe('https://auth.proactive.example.com')
  })
})

describe('Wave 1D — P0-18: MCP client keepConnectionInUse reuse & synchronous cache eviction', () => {
  const createdKeys: string[] = []

  afterEach(() => {
    while (createdKeys.length > 0) {
      const k = createdKeys.pop()
      if (k) connectToServer.cache.delete(k)
    }
  })

  function makeConnectedServer(
    name: string,
    config: ScopedMcpServerConfig,
    opts?: { activeWatchdogs?: number; cleanupDelayMs?: number },
  ): {
    conn: ConnectedMCPServer
    cleanupStarted: () => boolean
    cleanupFinished: () => boolean
    cacheExistedWhenCleanupStarted: () => boolean
  } {
    const key = getServerCacheKey(name, config)
    let started = false
    let finished = false
    let cacheAtCleanupStart = false
    const watchdogs = new Set<() => void>()
    for (let i = 0; i < (opts?.activeWatchdogs ?? 0); i++) {
      watchdogs.add(() => {})
    }
    const conn = {
      name,
      type: 'connected' as const,
      config,
      capabilities: { tools: {} },
      client: {
        transport: { close: async () => {} },
        onclose: () => {},
        request: async () => ({ tools: [] }),
        listTools: async () => ({ tools: [] }),
        listPrompts: async () => ({ prompts: [] }),
        listResources: async () => ({ resources: [] }),
      },
      transportErrorState: {
        activeCallWatchdogs: watchdogs,
      },
      cleanup: async () => {
        started = true
        cacheAtCleanupStart = connectToServer.cache.has(key)
        if (opts?.cleanupDelayMs) {
          await new Promise(r => setTimeout(r, opts.cleanupDelayMs))
        }
        finished = true
      },
    } as unknown as ConnectedMCPServer
    return {
      conn,
      cleanupStarted: () => started,
      cleanupFinished: () => finished,
      cacheExistedWhenCleanupStarted: () => cacheAtCleanupStart,
    }
  }

  test('clearServerCache evicts memo cache synchronously BEFORE awaiting cleanup on normal teardown', async () => {
    const config: ScopedMcpServerConfig = {
      type: 'stdio',
      command: 'echo',
      args: ['hi'],
      scope: 'user',
    }
    const key = getServerCacheKey('sync-evict-srv', config)
    createdKeys.push(key)

    const {
      conn,
      cleanupStarted,
      cleanupFinished,
      cacheExistedWhenCleanupStarted,
    } = makeConnectedServer('sync-evict-srv', config, {
      activeWatchdogs: 0,
      cleanupDelayMs: 25,
    })
    connectToServer.cache.set(key, Promise.resolve(conn))

    await clearServerCache('sync-evict-srv', config)

    expect(cleanupStarted()).toBe(true)
    expect(cleanupFinished()).toBe(true)
    // Cache MUST have been evicted synchronously BEFORE cleanup() ran
    expect(cacheExistedWhenCleanupStarted()).toBe(false)
    expect(connectToServer.cache.has(key)).toBe(false)
  })

  test('reconnectMcpServerImpl with keepConnectionInUse: true reuses kept connection and returns keptConnectionInUse: true without leaking', async () => {
    const config: ScopedMcpServerConfig = {
      type: 'stdio',
      command: 'nonexistent-binary-must-not-spawn',
      args: [],
      scope: 'user',
    }
    const key = getServerCacheKey('kept-srv', config)
    createdKeys.push(key)

    const { conn, cleanupStarted } = makeConnectedServer('kept-srv', config, {
      activeWatchdogs: 1,
    })
    connectToServer.cache.set(key, Promise.resolve(conn))

    const result = await reconnectMcpServerImpl(
      'kept-srv',
      config,
      undefined,
      undefined,
      { keepConnectionInUse: true },
    )

    expect(cleanupStarted()).toBe(false)
    expect(result.client).toBe(conn)
    expect(result.keptConnectionInUse).toBe(true)
    expect(connectToServer.cache.has(key)).toBe(true)
  })

  test('startSlowBackgroundReconnectForServer and runReconnectWithBackoffForServer pass keepConnectionInUse: true', async () => {
    const config: ScopedMcpServerConfig = {
      type: 'http',
      url: 'https://mcp.bg-keep.example.com/v1',
      scope: 'user',
    }
    const slowOptsSeen: Array<{ keepConnectionInUse?: boolean } | undefined> =
      []
    const slowTimers = new Map<string, NodeJS.Timeout>()
    let liveRow: MCPServerConnection = {
      name: 'bg-srv',
      type: 'failed',
      config,
    }
    const connectedRow = {
      name: 'bg-srv',
      type: 'connected',
      config,
      client: { close: async () => {} },
    } as unknown as ConnectedMCPServer

    const delivered: MCPServerConnection[] = []
    startSlowBackgroundReconnectForServer('bg-srv', config, {
      timers: slowTimers,
      getLiveRow: () => liveRow,
      onConnectionAttempt: res => delivered.push(res.client),
      reconnect: (async (_n, _c, _s, _cr, opts) => {
        slowOptsSeen.push(opts)
        return {
          client: connectedRow,
          tools: [],
          commands: [],
          keptConnectionInUse: true,
        }
      }) as typeof reconnectMcpServerImpl,
      computeDelayMs: () => 5,
      isDisabled: () => false,
      getPolicyBlockReason: () => null,
    })

    await new Promise(r => setTimeout(r, 30))
    expect(slowOptsSeen).toEqual([{ keepConnectionInUse: true }])
    expect(delivered).toEqual([connectedRow])

    const fastOptsSeen: Array<{ keepConnectionInUse?: boolean } | undefined> =
      []
    const fastTimers = new Map<string, NodeJS.Timeout>()
    const fastGens = new Map<string, number>()
    liveRow = { name: 'fast-srv', type: 'failed', config }

    await runReconnectWithBackoffForServer('fast-srv', config, {
      timers: fastTimers,
      generations: fastGens,
      getLiveRow: () => liveRow,
      updateServer: () => {},
      onConnectionAttempt: () => {},
      reconnect: (async (_n, _c, _s, _cr, opts) => {
        fastOptsSeen.push(opts)
        return {
          client: connectedRow,
          tools: [],
          commands: [],
          keptConnectionInUse: true,
        }
      }) as typeof reconnectMcpServerImpl,
      maxAttempts: 1,
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      isDisabled: () => false,
      getPolicyBlockReason: () => null,
    })

    expect(fastOptsSeen).toEqual([{ keepConnectionInUse: true }])
  })
})
