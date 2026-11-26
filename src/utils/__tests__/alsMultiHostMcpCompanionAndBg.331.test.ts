import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { Client } from '@modelcontextprotocol/client'
import type { UUID } from 'crypto'
import {
  executeAutoDream,
  getAutoDreamStateForTesting,
  initAutoDream,
  resetAutoDreamForTests,
} from '../../services/autoDream/autoDream.js'
import {
  drainPendingExtraction,
  executeExtractMemories,
  getMemoryExtractorStateForTesting,
  initExtractMemories,
  resetExtractMemoriesForTests,
} from '../../services/extractMemories/extractMemories.js'
import {
  getInitializationStatus,
  resetLspManagerForTests,
  setLspManagerForTests,
} from '../../services/lsp/manager.js'
import {
  ClaudeAuthProvider,
  getServerKey,
  resetCredentialStoreStrictProbeState,
} from '../../services/mcp/auth.js'
import {
  connectToServer,
  fetchCommandsForClient,
  fetchResourcesForClient,
  fetchToolsForClient,
} from '../../services/mcp/client.js'
import {
  markCliOwnedConfig,
  wrapCliOwnedFetch,
} from '../../services/mcp/cliOwnedConfigs.js'
import {
  advanceMcpIdentityEpoch,
  getMcpIdentityEpoch,
  isMcpIdentityBoundaryEnabled,
  rearmMcpIdentityBaseline,
  registerMcpIdentityChangeHandler,
  resetMcpIdentityStateForTests,
  seedMcpIdentityCheck,
  setMcpAccountIdentityResolver,
} from '../../services/mcp/mcpIdentity.js'
import {
  clearMcpListenPostReopenHandlers,
  invokeMcpListenPostReopenRefetch,
  registerMcpListenPostReopenHandler,
} from '../../services/mcp/mcpListenReopen.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../../services/mcp/types.js'
import '../../skills/loadSkillsDir.js'
import { fetchMcpSkillsForClient } from '../../skills/mcpSkills.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../types/message.js'
import type { REPLHookContext } from '../hooks/postSamplingHooks.js'
import * as logMod from '../log.js'
import * as secureStorageMod from '../secureStorage/index.js'
import type {
  SecureStorage,
  SecureStorageData,
} from '../secureStorage/types.js'
import {
  getActiveSessionFromAls,
  runWithNewHostSession,
  runWithSession,
} from '../sessionRoot.js'

function createDeferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (err?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeUserMsg(content: string, uuid: string): UserMessage {
  return {
    type: 'user',
    uuid: uuid as UUID,
    message: { role: 'user', content },
  } as UserMessage
}

function makeAssistantMsg(text: string, uuid: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: uuid as UUID,
    requestId: `req-${uuid}`,
    message: {
      id: `msg-${uuid}`,
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      type: 'message',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 500,
      },
    },
  } as unknown as AssistantMessage
}

function makeHookContext(messages: Message[]): REPLHookContext {
  let state = getDefaultAppState()
  const setAppState = (
    updater: (
      prev: ReturnType<typeof getDefaultAppState>,
    ) => ReturnType<typeof getDefaultAppState>,
  ) => {
    state = updater(state)
  }
  const toolUseContext = {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-6',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => state,
    setAppState,
    setToolJSX: () => {},
    addNotification: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as unknown as ToolUseContext

  return {
    messages,
    systemPrompt: [] as unknown as REPLHookContext['systemPrompt'],
    userContext: {},
    systemContext: {},
    toolUseContext,
    querySource: 'repl_main_thread',
  }
}

const mockUsage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  service_tier: 'standard' as const,
  cache_creation: {
    ephemeral_1h_input_tokens: 0,
    ephemeral_5m_input_tokens: 0,
  },
  inference_geo: '',
  iterations: [],
  speed: 'standard' as const,
}

function makeSkillMcpClient(
  serverName: string,
  skillUri: string,
  description: string,
): ConnectedMCPServer {
  const sdkClient = {
    listResources: async () => ({
      resources: [{ uri: skillUri, name: skillUri }],
    }),
    readResource: async () => ({
      contents: [
        {
          uri: skillUri,
          text: `---\ndescription: ${description}\n---\nBody for ${description}`,
        },
      ],
    }),
  } as unknown as Client

  return {
    type: 'connected',
    name: serverName,
    capabilities: { resources: {} },
    client: sdkClient,
    config: { type: 'sdk', name: serverName, scope: 'dynamic' },
    cleanup: async () => {},
  }
}

describe('2.1.331 Multi-Host MCP Companion Caches, OAuth Provider, ExtractMemories, AutoDream & LSP GC', () => {
  const spies: Array<{ mockRestore(): void }> = []
  const prevDiscoveryCache = process.env.MCP_DISCOVERY_CACHE

  afterEach(() => {
    while (spies.length > 0) {
      spies.pop()?.mockRestore()
    }
    if (prevDiscoveryCache === undefined) {
      delete process.env.MCP_DISCOVERY_CACHE
    } else {
      process.env.MCP_DISCOVERY_CACHE = prevDiscoveryCache
    }
    resetCredentialStoreStrictProbeState()
    resetMcpIdentityStateForTests()
    resetExtractMemoriesForTests()
    resetAutoDreamForTests()
    resetLspManagerForTests()
  })

  test('fetchMcpSkillsForClient isolates same-name server caches, full .cache proxy API, and .cache.delete across Host A & Host B', async () => {
    const clientA = makeSkillMcpClient(
      'shared-skills',
      'skill://deploy-a',
      'Deploy Host A',
    )
    const clientB = makeSkillMcpClient(
      'shared-skills',
      'skill://deploy-b',
      'Deploy Host B',
    )

    const barrierA = createDeferred<void>()
    const barrierB = createDeferred<void>()

    await Promise.all([
      runWithNewHostSession(
        { id: 'skills-host-a', diskless: true },
        async () => {
          const skillsA = await fetchMcpSkillsForClient(clientA)
          expect(skillsA.map(c => c.name)).toEqual([
            'mcp__shared-skills__deploy-a',
          ])
          expect(fetchMcpSkillsForClient.cache.has('shared-skills')).toBe(true)
          expect(fetchMcpSkillsForClient.cache.size).toBe(1)
          expect([...fetchMcpSkillsForClient.cache.keys()]).toEqual([
            'shared-skills',
          ])
          expect([...fetchMcpSkillsForClient.cache.values()].length).toBe(1)
          expect(
            [...fetchMcpSkillsForClient.cache.entries()].map(([k]) => k),
          ).toEqual(['shared-skills'])
          expect([...fetchMcpSkillsForClient.cache].map(([k]) => k)).toEqual([
            'shared-skills',
          ])

          // Chained .set() returns the proxy itself
          const extraPromise = Promise.resolve([])
          const returned = fetchMcpSkillsForClient.cache.set(
            'extra-a',
            extraPromise,
          )
          expect(returned).toBe(fetchMcpSkillsForClient.cache)
          expect(fetchMcpSkillsForClient.cache.get('extra-a')).toBe(
            extraPromise,
          )
          expect(fetchMcpSkillsForClient.cache.size).toBe(2)

          barrierA.resolve()
          await barrierB.promise

          // Deleting & clearing in Host A must NOT affect Host B
          expect(fetchMcpSkillsForClient.cache.delete('shared-skills')).toBe(
            true,
          )
          expect(fetchMcpSkillsForClient.cache.has('shared-skills')).toBe(false)
          fetchMcpSkillsForClient.cache.clear()
          expect(fetchMcpSkillsForClient.cache.size).toBe(0)
        },
      ),
      runWithNewHostSession(
        { id: 'skills-host-b', diskless: true },
        async () => {
          await barrierA.promise
          // Host B must NOT see Host A's cached skills for same server name
          expect(fetchMcpSkillsForClient.cache.has('shared-skills')).toBe(false)
          expect(fetchMcpSkillsForClient.cache.has('extra-a')).toBe(false)

          const skillsB = await fetchMcpSkillsForClient(clientB)
          expect(skillsB.map(c => c.name)).toEqual([
            'mcp__shared-skills__deploy-b',
          ])
          barrierB.resolve()

          // Wait for Host A's delete + clear to complete
          await new Promise<void>(r => setTimeout(r, 15))
          expect(fetchMcpSkillsForClient.cache.has('shared-skills')).toBe(true)
          expect(fetchMcpSkillsForClient.cache.size).toBe(1)
          const cachedB =
            await fetchMcpSkillsForClient.cache.get('shared-skills')
          expect(cachedB?.map(c => c.name)).toEqual([
            'mcp__shared-skills__deploy-b',
          ])
        },
      ),
    ])
  })

  test('mcpIdentity isolates diskless offLatched, identityEpoch, and change handlers across Host A & Host B', async () => {
    process.env.MCP_DISCOVERY_CACHE = 'true'

    const disklessHost = await runWithNewHostSession(
      { id: 'id-diskless', diskless: true },
      async session => {
        // Diskless host latches offLatched = 'diskless'
        expect(isMcpIdentityBoundaryEnabled()).toBe(false)
        expect(advanceMcpIdentityEpoch()).toBe(0)
        return session
      },
    )

    const handlerACalls: Array<string | undefined> = []
    const handlerBCalls: Array<string | undefined> = []

    let accountA = {
      accountUuid: 'acct-a-1',
      organizationUuid: 'org-a',
      credentialInstalled: true,
    }
    let accountB = {
      accountUuid: 'acct-b-1',
      organizationUuid: 'org-b',
      credentialInstalled: true,
    }

    let releaseA!: () => void
    let releaseB!: () => void

    const sessionA = await runWithNewHostSession(
      { id: 'id-host-a', diskless: false },
      async session => {
        // Non-diskless Host A MUST still be enabled despite disklessHost latching earlier!
        expect(isMcpIdentityBoundaryEnabled()).toBe(true)
        setMcpAccountIdentityResolver(() => accountA)
        seedMcpIdentityCheck()
        releaseA = registerMcpIdentityChangeHandler(() => {
          handlerACalls.push(getActiveSessionFromAls()?.id)
        })
        expect(getMcpIdentityEpoch()).toBe(0)
        return session
      },
    )

    const sessionB = await runWithNewHostSession(
      { id: 'id-host-b', diskless: false },
      async session => {
        // Non-diskless Host B registers its own handler without overwriting Host A's
        expect(isMcpIdentityBoundaryEnabled()).toBe(true)
        setMcpAccountIdentityResolver(() => accountB)
        seedMcpIdentityCheck()
        releaseB = registerMcpIdentityChangeHandler(() => {
          handlerBCalls.push(getActiveSessionFromAls()?.id)
        })
        expect(getMcpIdentityEpoch()).toBe(0)
        return session
      },
    )

    // Mutate Host A's account -> only Host A bumps epoch and fires handler A
    runWithSession(sessionA, () => {
      accountA = { ...accountA, accountUuid: 'acct-a-2' }
      expect(getMcpIdentityEpoch()).toBe(1)
    })
    await Promise.resolve()

    expect(handlerACalls).toEqual(['id-host-a'])
    expect(handlerBCalls).toEqual([])

    // Host B's epoch stays 0; diskless host stays disabled
    runWithSession(sessionB, () => {
      expect(getMcpIdentityEpoch()).toBe(0)
      expect(advanceMcpIdentityEpoch()).toBe(1)
      expect(getMcpIdentityEpoch()).toBe(1)
    })
    runWithSession(sessionA, () => {
      expect(getMcpIdentityEpoch()).toBe(1)
    })
    runWithSession(disklessHost, () => {
      expect(isMcpIdentityBoundaryEnabled()).toBe(false)
      expect(getMcpIdentityEpoch()).toBe(0)
    })

    // Trigger Host B change -> fires handler B without touching Host A
    runWithSession(sessionB, () => {
      accountB = { ...accountB, accountUuid: 'acct-b-2' }
      expect(getMcpIdentityEpoch()).toBe(2)
    })
    await Promise.resolve()

    expect(handlerACalls).toEqual(['id-host-a'])
    expect(handlerBCalls).toEqual(['id-host-b'])

    // Verify rearmMcpIdentityBaseline stays per-host as well
    runWithSession(sessionB, () => {
      rearmMcpIdentityBaseline()
    })
    runWithSession(sessionA, () => {
      expect(getMcpIdentityEpoch()).toBe(1)
    })

    releaseA()
    releaseB()
  })

  test('mcpListenReopen isolates same-name "foo" post-reopen handlers and clear calls across Host A & Host B', async () => {
    const callsA: Array<string | undefined> = []
    const callsB: Array<string | undefined> = []

    const sessionA = await runWithNewHostSession(
      { id: 'reopen-host-a', diskless: true },
      async session => {
        registerMcpListenPostReopenHandler('foo', 'tools', () => {
          callsA.push(getActiveSessionFromAls()?.id)
        })
        return session
      },
    )

    const sessionB = await runWithNewHostSession(
      { id: 'reopen-host-b', diskless: true },
      async session => {
        registerMcpListenPostReopenHandler('foo', 'tools', () => {
          callsB.push(getActiveSessionFromAls()?.id)
        })
        return session
      },
    )

    // Clearing "foo" in Host A must NEVER delete Host B's handler for "foo"
    runWithSession(sessionA, () => {
      clearMcpListenPostReopenHandlers('foo')
      invokeMcpListenPostReopenRefetch('foo', { toolsListChanged: true })
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(callsA).toEqual([])
    expect(callsB).toEqual([])

    // Invoking "foo" in Host B fires Host B's handler inside Host B's ALS
    runWithSession(sessionB, () => {
      invokeMcpListenPostReopenRefetch('foo', { toolsListChanged: true })
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(callsA).toEqual([])
    expect(callsB).toEqual(['reopen-host-b'])

    runWithSession(sessionB, () => {
      clearMcpListenPostReopenHandlers('foo')
    })
  })

  test('ClaudeAuthProvider re-enters sessionA across all OAuthClientProvider methods even when invoked inside sessionB ALS', async () => {
    const serverConfig = {
      type: 'http' as const,
      url: 'https://oauth-als.example.com/mcp',
    }
    const serverKey = getServerKey('oauth-srv', serverConfig)

    let storedData: SecureStorageData = {
      mcpOAuth: {
        [serverKey]: {
          serverName: 'oauth-srv',
          serverUrl: serverConfig.url,
          clientId: 'cid-a',
          clientSecret: 'csec-a',
          accessToken: 'tok-a',
          refreshToken: 'ref-a',
          expiresAt: Date.now() + 3_600_000,
          scope: 'read',
          discoveryState: {
            authorizationServerUrl: 'https://auth.example.com',
          },
        },
      },
    }

    const observedByOp: Record<string, Array<string | undefined>> = {}
    const record = (op: string) => {
      ;(observedByOp[op] ??= []).push(getActiveSessionFromAls()?.id)
    }

    const storage: SecureStorage = {
      name: 'als-tracking-memory',
      read: () => {
        record('storage.read')
        return structuredClone(storedData)
      },
      readAsync: async () => {
        record('storage.readAsync')
        return structuredClone(storedData)
      },
      readAsyncStrict: async () => {
        record('storage.readAsyncStrict')
        return structuredClone(storedData)
      },
      update: next => {
        record('storage.update')
        storedData = structuredClone(next)
        return { success: true }
      },
      delete: () => {
        record('storage.delete')
        storedData = {}
        return true
      },
    }

    spies.push(
      spyOn(secureStorageMod, 'getSecureStorage').mockReturnValue(storage),
    )
    spies.push(
      spyOn(logMod, 'logMCPDebug').mockImplementation(() => {
        record('logMCPDebug')
      }),
    )

    let providerA!: ClaudeAuthProvider
    const redirectSessions: Array<string | undefined> = []

    const sessionA = await runWithNewHostSession(
      { id: 'oauth-session-a', diskless: true },
      async session => {
        providerA = new ClaudeAuthProvider(
          'oauth-srv',
          serverConfig,
          'http://127.0.0.1:43210/callback',
          true,
          () => {
            redirectSessions.push(getActiveSessionFromAls()?.id)
          },
          true,
        )
        return session
      },
    )

    const clearObserved = () => {
      for (const k of Object.keys(observedByOp)) {
        delete observedByOp[k]
      }
    }

    await runWithNewHostSession(
      { id: 'oauth-session-b', diskless: true },
      async sessionB => {
        expect(getActiveSessionFromAls()?.id).toBe(sessionB.id)

        // 1. tokens()
        clearObserved()
        const toks = await providerA.tokens()
        expect(toks?.access_token).toBe('tok-a')
        expect(observedByOp['storage.readAsync']).toEqual([sessionA.id])
        expect(observedByOp.logMCPDebug?.every(id => id === sessionA.id)).toBe(
          true,
        )
        expect(getActiveSessionFromAls()?.id).toBe(sessionB.id)

        // 2. saveTokens()
        clearObserved()
        await providerA.saveTokens({
          access_token: 'tok-a-2',
          token_type: 'Bearer',
          expires_in: 3600,
        })
        expect(observedByOp['storage.read']).toEqual([sessionA.id])
        expect(observedByOp['storage.update']).toEqual([sessionA.id])

        // 3. clientInformation()
        clearObserved()
        const ci = await providerA.clientInformation()
        expect(ci?.client_id).toBe('cid-a')
        expect(observedByOp['storage.readAsync']).toEqual([sessionA.id])

        // 4. saveClientInformation()
        clearObserved()
        await providerA.saveClientInformation({
          client_id: 'cid-a-2',
          redirect_uris: ['http://127.0.0.1:43210/callback'],
        })
        expect(observedByOp['storage.read']).toEqual([sessionA.id])
        expect(observedByOp['storage.update']).toEqual([sessionA.id])

        // 5. discoveryState()
        clearObserved()
        const ds = await providerA.discoveryState()
        expect(ds?.authorizationServerUrl).toBe('https://auth.example.com')
        expect(observedByOp['storage.read']).toEqual([sessionA.id])

        // 6. saveDiscoveryState()
        clearObserved()
        await providerA.saveDiscoveryState({
          authorizationServerUrl: 'https://auth2.example.com',
        })
        expect(observedByOp['storage.read']).toEqual([sessionA.id])
        expect(observedByOp['storage.update']).toEqual([sessionA.id])

        // 7. redirectToAuthorization()
        clearObserved()
        await providerA.redirectToAuthorization(
          new URL('https://auth2.example.com/authorize?scope=read'),
        )
        expect(redirectSessions).toEqual([sessionA.id])
        expect(observedByOp.logMCPDebug?.every(id => id === sessionA.id)).toBe(
          true,
        )

        // 8. saveCodeVerifier() & codeVerifier()
        clearObserved()
        await providerA.saveCodeVerifier('verifier-xyz')
        expect(await providerA.codeVerifier()).toBe('verifier-xyz')
        expect(observedByOp.logMCPDebug?.every(id => id === sessionA.id)).toBe(
          true,
        )

        // 9. invalidateCredentials()
        clearObserved()
        await providerA.invalidateCredentials('tokens')
        expect(observedByOp['storage.read']).toEqual([sessionA.id])
        expect(observedByOp['storage.update']).toEqual([sessionA.id])

        // Session B ALS remains intact after all providerA calls
        expect(getActiveSessionFromAls()?.id).toBe(sessionB.id)
      },
    )
  })

  test('client.ts cache proxies return proxy on .set() chaining and wrapCliOwnedFetch re-enters root session via WeakRef', async () => {
    const cfg: ScopedMcpServerConfig = {
      type: 'http',
      url: 'https://chain.example.com/mcp',
      scope: 'user',
    }
    const fakeConn: MCPServerConnection = {
      type: 'needs-auth',
      name: 'chain-srv',
      config: cfg,
    }

    await runWithNewHostSession(
      { id: 'proxy-chain-a', diskless: true },
      async () => {
        const r1: unknown = connectToServer.cache.set(
          'k1',
          Promise.resolve(fakeConn),
        )
        expect(r1).toBe(connectToServer.cache)
        const r2: unknown = fetchToolsForClient.cache.set(
          'chain-srv',
          Promise.resolve([]),
        )
        expect(r2).toBe(fetchToolsForClient.cache)
        const r3: unknown = fetchResourcesForClient.cache.set(
          'chain-srv',
          Promise.resolve([]),
        )
        expect(r3).toBe(fetchResourcesForClient.cache)
        const r4: unknown = fetchCommandsForClient.cache.set(
          'chain-srv',
          Promise.resolve([]),
        )
        expect(r4).toBe(fetchCommandsForClient.cache)
      },
    )

    // wrapCliOwnedFetch captured inside a withProject fork re-enters root session
    const cliCfg = { type: 'http', url: 'https://cli-weakref.example.com' }
    let observedFetchSessionId: string | undefined
    let observedFetchIsRoot = false
    let wrappedFetch!: ReturnType<typeof wrapCliOwnedFetch>

    const sessionA = await runWithNewHostSession(
      { id: 'cli-root-a', cwd: '/root-a', diskless: true },
      async rootSession => {
        const fork = rootSession.withProject({ cwd: '/root-a/sub' })
        runWithSession(fork, () => {
          markCliOwnedConfig(cliCfg, {
            getBearerToken: () => 'tok-root-a',
          })
          wrappedFetch = wrapCliOwnedFetch(async (_input, init) => {
            const active = getActiveSessionFromAls()
            observedFetchSessionId = active?.id
            observedFetchIsRoot = active === rootSession
            return new Response(new Headers(init?.headers).get('Authorization'))
          }, cliCfg)
        })
        return rootSession
      },
    )

    // Invoke wrappedFetch from inside Session B while sessionA is strongly alive
    await runWithNewHostSession(
      { id: 'cli-root-b', cwd: '/root-b', diskless: true },
      async () => {
        const resp = await wrappedFetch('https://cli-weakref.example.com/rpc')
        expect(await resp.text()).toBe('Bearer tok-root-a')
        expect(observedFetchSessionId).toBe(sessionA.id)
        expect(observedFetchIsRoot).toBe(true)
      },
    )
  })

  test('extractMemories: initExtractMemories(undefined) clears stale defaultExtractorDeps and pre-init calls do not freeze a stale slot', async () => {
    const turns: Message[] = [
      makeUserMsg('remember our build uses bun', 'em-u1'),
      makeAssistantMsg('got it', 'em-a1'),
    ]

    // 1. Pre-init call inside isolated session must NOT freeze a slot with undefined deps
    resetExtractMemoriesForTests()
    let bootForkCalls = 0
    const sessionPreInit = await runWithNewHostSession(
      { id: 'em-pre-init', cwd: '/em-pre', originalCwd: '/em-pre' },
      async session => {
        await executeExtractMemories(makeHookContext(turns))
        expect(getMemoryExtractorStateForTesting().lastMemoryMessageUuid).toBe(
          undefined,
        )
        return session
      },
    )

    // Simulate async boot init settling outside ALS with bootDeps
    initExtractMemories({
      isGateEnabledFn: () => true,
      isAutoMemoryEnabledFn: () => true,
      isRemoteModeFn: () => false,
      scanMemoryFilesFn: async () => [],
      runForkedAgentFn: async () => {
        bootForkCalls += 1
        return { messages: [], totalUsage: mockUsage }
      },
    })

    // Re-enter the same sessionPreInit -> must pick up bootDeps (not a frozen pre-init slot!)
    await runWithSession(sessionPreInit, async () => {
      await executeExtractMemories(makeHookContext(turns))
      await drainPendingExtraction(5_000)
      expect(bootForkCalls).toBe(1)
      expect(getMemoryExtractorStateForTesting().lastMemoryMessageUuid).toBe(
        'em-a1',
      )
    })

    // 2. Calling initExtractMemories() with undefined outside ALS MUST clear stale defaultExtractorDeps
    let staleMockCalls = 0
    initExtractMemories({
      isGateEnabledFn: () => {
        staleMockCalls += 1
        return true
      },
      isAutoMemoryEnabledFn: () => true,
      isRemoteModeFn: () => false,
      scanMemoryFilesFn: async () => [],
      runForkedAgentFn: async () => ({ messages: [], totalUsage: mockUsage }),
    })

    // Reset with undefined (as test beforeEach does)
    initExtractMemories()

    await runWithNewHostSession(
      { id: 'em-after-clear', cwd: '/em-clear', originalCwd: '/em-clear' },
      async () => {
        await executeExtractMemories(makeHookContext(turns))
      },
    )
    expect(staleMockCalls).toBe(0)
  })

  test('autoDream: initAutoDream(undefined) clears stale deps, pre-init does not freeze slot, and concurrent calls hit inFlight lock before first await', async () => {
    const turns: Message[] = [
      makeUserMsg('consolidate memory', 'ad-u1'),
      makeAssistantMsg('done', 'ad-a1'),
    ]

    // 1. Pre-init call does NOT freeze a stale slot
    resetAutoDreamForTests()
    let bootGateCalls = 0
    const sessionPreInit = await runWithNewHostSession(
      { id: 'ad-pre-init', cwd: '/ad-pre', originalCwd: '/ad-pre' },
      async session => {
        await executeAutoDream(makeHookContext(turns))
        expect(getAutoDreamStateForTesting().lastSessionScanAt).toBe(0)
        return session
      },
    )

    initAutoDream({
      isGateOpenFn: () => {
        bootGateCalls += 1
        return false
      },
    })

    await runWithSession(sessionPreInit, async () => {
      await executeAutoDream(makeHookContext(turns))
    })
    expect(bootGateCalls).toBe(1)

    // 2. initAutoDream() with undefined clears stale defaultAutoDreamDeps
    let staleGateCalls = 0
    initAutoDream({
      isGateOpenFn: () => {
        staleGateCalls += 1
        return false
      },
    })
    initAutoDream()
    await runWithNewHostSession(
      { id: 'ad-after-clear', cwd: '/ad-clear', originalCwd: '/ad-clear' },
      async () => {
        await executeAutoDream(makeHookContext(turns))
      },
    )
    expect(staleGateCalls).toBe(0)

    // 3. Concurrent executeAutoDream calls on the SAME session hit inFlight lock BEFORE first await
    await runWithNewHostSession(
      { id: 'ad-race-host', cwd: '/ad-race', originalCwd: '/ad-race' },
      async () => {
        const readGate = createDeferred<number>()
        const listGate = createDeferred<string[]>()
        let readCalls = 0
        let listCalls = 0
        let lockCalls = 0
        let forkCalls = 0

        initAutoDream({
          isGateOpenFn: () => true,
          getConfigFn: () => ({ minHours: 1, minSessions: 2 }),
          readLastConsolidatedAtFn: async () => {
            readCalls += 1
            return readGate.promise
          },
          listSessionsTouchedSinceFn: async () => {
            listCalls += 1
            return listGate.promise
          },
          tryAcquireConsolidationLockFn: async () => {
            lockCalls += 1
            return Date.now() - 10 * 3_600_000
          },
          runForkedAgentFn: async () => {
            forkCalls += 1
            return { messages: [], totalUsage: mockUsage }
          },
        })

        const ctx = makeHookContext(turns)
        const p1 = executeAutoDream(ctx)
        // Synchronously inFlight BEFORE first await settles!
        expect(getAutoDreamStateForTesting().inFlight).toBe(true)
        const p2 = executeAutoDream(ctx)
        const p3 = executeAutoDream(ctx)

        readGate.resolve(Date.now() - 10 * 3_600_000)
        listGate.resolve(['other-1', 'other-2'])
        await Promise.all([p1, p2, p3])

        expect(readCalls).toBe(1)
        expect(listCalls).toBe(1)
        expect(lockCalls).toBe(1)
        expect(forkCalls).toBe(1)
        expect(getAutoDreamStateForTesting().inFlight).toBe(false)
      },
    )
  })

  test('lsp/manager handles >64 transient hosts cleanly with dead WeakRef pruning and per-host isolation', async () => {
    for (let i = 0; i < 70; i++) {
      await runWithNewHostSession(
        { id: `lsp-transient-${i}`, diskless: true },
        async () => {
          expect(getInitializationStatus()).toEqual({ status: 'not-started' })
        },
      )
    }

    await Promise.all([
      runWithNewHostSession({ id: 'lsp-host-a', diskless: true }, async () => {
        setLspManagerForTests({ status: 'success' })
        expect(getInitializationStatus()).toEqual({ status: 'success' })
      }),
      runWithNewHostSession({ id: 'lsp-host-b', diskless: true }, async () => {
        expect(getInitializationStatus()).toEqual({ status: 'not-started' })
      }),
    ])
  })
})
