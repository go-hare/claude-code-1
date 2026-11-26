import { describe, expect, test } from 'bun:test'
import type { Client } from '@modelcontextprotocol/client'
import {
  dialedWithoutOAuth,
  emitMcpAuthRecovered,
  getActiveOAuthPromise,
  getServerKey,
  hasRecentTransientMcpRefreshFailure,
  markTransientMcpRefreshFailure,
  rejectedStoredTokens,
  setActiveOAuthPromise,
  subscribeMcpAuthRecovered,
} from '../../services/mcp/auth.js'
import {
  hasAuthReconnectInFlight,
  joinOrStartAuthReconnect,
} from '../../services/mcp/authReconnect.js'
import {
  fetchClaudeAIMcpConfigsIfEligible,
  hasClaudeAiMcpSessionConnected,
  markClaudeAiMcpConnected,
} from '../../services/mcp/claudeai.js'
import {
  _registerLiveMcpClientForTests,
  connectToServer,
  fetchCommandsForClient,
  fetchResourcesForClient,
  fetchToolsForClient,
  getConnectedClientWiring,
  isMcpServerRemovedFromSession,
  markMcpServerRemovedFromSession,
  notifyMcpRootsListChanged,
  notifyMcpServerConnected,
  onMcpServerConnected,
  registerConnectedClientWiring,
  registerMcpToolsSwapper,
  setupSdkMcpClients,
  swapMcpServerTools,
} from '../../services/mcp/client.js'
import {
  isCliOwnedConfig,
  markCliOwnedConfig,
  resolveCliOwnedBearerToken,
  wrapCliOwnedFetch,
} from '../../services/mcp/cliOwnedConfigs.js'
import {
  getMcpConfigServerErrors,
  isCloudPluginStartupPending,
  setCloudPluginStartupPending,
  storeMcpConfigServerErrors,
  subscribeToManagedMcpArrival,
} from '../../services/mcp/config.js'
import {
  dropDiscoveryCacheEntry,
  readDiscoveryCacheEntry,
  runCachedFirstDialArms,
  subscribeCachedAdopt,
  subscribeCachedDialFailed,
  takeSettledCachedDialFailure,
  writeDiscoveryCacheEntry,
} from '../../services/mcp/discoveryCache.js'
import {
  emitMcpNeedsReauth,
  isMcpHeadersHelperConfig,
  markMcpHeadersHelperConfig,
  subscribeMcpNeedsReauth,
} from '../../services/mcp/mcpReauthSignal.js'
import {
  isMcpStepUpReauthExhausted,
  markMcpStepUpReauthExhausted,
} from '../../services/mcp/mcpStepUpReauth.js'
import {
  getActiveMcpSwitchedOffRecord,
  McpSwitchedOffRecord,
  notifyMcpSwitchedOffSaved,
  setActiveMcpSwitchedOffRecord,
} from '../../services/mcp/mcpSwitchedOffRecord.js'
import type {
  ConnectedMCPServer,
  FailedMCPServer,
  JSONRPCMessage,
  McpHTTPServerConfig,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../../services/mcp/types.js'
import type { ToolUseContext } from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'
import {
  exitSessionContext,
  getActiveSessionFromAls,
  runWithNewHostSession,
} from '../sessionRoot.js'

function makeMockConnectedPostgres(opts: {
  tenantLabel: string
  extraToolName: string
  resourceUri: string
  promptName: string
  onCallTool: (args: Record<string, unknown> | undefined) => string
  onGetPrompt: (args: Record<string, string> | undefined) => string
}): ConnectedMCPServer {
  const sdkClient = {
    request: async (req: { method: string }) => {
      if (req.method === 'tools/list') {
        return {
          tools: [
            {
              name: 'query',
              description: `SQL query on ${opts.tenantLabel}`,
              inputSchema: {
                type: 'object',
                properties: { sql: { type: 'string' } },
              },
            },
            {
              name: opts.extraToolName,
              description: `Extra tool for ${opts.tenantLabel}`,
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }
      }
      if (req.method === 'resources/list') {
        return {
          resources: [
            {
              uri: opts.resourceUri,
              name: `${opts.tenantLabel}-resource`,
            },
          ],
        }
      }
      if (req.method === 'prompts/list') {
        return {
          prompts: [
            {
              name: opts.promptName,
              description: `Prompt for ${opts.tenantLabel}`,
              arguments: [{ name: 'table', required: true }],
            },
          ],
        }
      }
      return {}
    },
    callTool: async (params: {
      name: string
      arguments?: Record<string, unknown>
    }) => ({
      content: [
        {
          type: 'text' as const,
          text: opts.onCallTool(params.arguments),
        },
      ],
    }),
    getPrompt: async (params: {
      name: string
      arguments?: Record<string, string>
    }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: opts.onGetPrompt(params.arguments),
          },
        },
      ],
    }),
  } as unknown as Client

  return {
    type: 'connected',
    name: 'postgres',
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
    client: sdkClient,
    config: {
      type: 'sdk',
      name: 'postgres',
      scope: 'dynamic',
    },
    cleanup: async () => {},
  }
}

function makeToolUseContext(): ToolUseContext {
  return {
    abortController: new AbortController(),
    options: {
      commands: [],
      tools: [],
      mainLoopModel: 'claude-sonnet-4-6',
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      debug: false,
      verbose: false,
      maxThinkingTokens: 0,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    getAppState: () =>
      ({
        toolPermissionContext: {
          mode: 'default',
          additionalWorkingDirectories: new Map(),
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable: false,
        },
      }) as ReturnType<ToolUseContext['getAppState']>,
    setAppState: () => {},
    readFileState: new Map(),
    messages: [],
  } as unknown as ToolUseContext
}

describe('ALS Multi-Host MCP Isolation (2.1.331)', () => {
  test('same-name "postgres" MCP servers isolate fetchToolsForClient, fetchResourcesForClient, fetchCommandsForClient, and .call() routing across concurrent hosts', async () => {
    const callsA: Array<Record<string, unknown> | undefined> = []
    const callsB: Array<Record<string, unknown> | undefined> = []
    const promptsA: Array<Record<string, string> | undefined> = []
    const promptsB: Array<Record<string, string> | undefined> = []

    const clientA = makeMockConnectedPostgres({
      tenantLabel: 'Host-A',
      extraToolName: 'tenant_a_admin',
      resourceUri: 'postgres://host-a/users',
      promptName: 'inspect_a',
      onCallTool: args => {
        callsA.push(args)
        return `rows-from-A:${String(args?.sql ?? '')}`
      },
      onGetPrompt: args => {
        promptsA.push(args)
        return `prompt-from-A:${String(args?.table ?? '')}`
      },
    })

    const clientB = makeMockConnectedPostgres({
      tenantLabel: 'Host-B',
      extraToolName: 'tenant_b_audit',
      resourceUri: 'postgres://host-b/ledger',
      promptName: 'inspect_b',
      onCallTool: args => {
        callsB.push(args)
        return `rows-from-B:${String(args?.sql ?? '')}`
      },
      onGetPrompt: args => {
        promptsB.push(args)
        return `prompt-from-B:${String(args?.table ?? '')}`
      },
    })

    let barrierResolveA!: () => void
    const barrierA = new Promise<void>(r => {
      barrierResolveA = r
    })
    let barrierResolveB!: () => void
    const barrierB = new Promise<void>(r => {
      barrierResolveB = r
    })

    const canUseTool = (async () => ({
      behavior: 'allow' as const,
      updatedInput: {},
    })) as unknown as Parameters<
      NonNullable<
        Awaited<ReturnType<typeof fetchToolsForClient>>[number]
      >['call']
    >[2]
    const parentMessage = {
      type: 'assistant',
      message: { id: 'msg-1', content: [] },
    } as unknown as AssistantMessage

    await Promise.all([
      runWithNewHostSession({ diskless: true }, async () => {
        const toolsA = await fetchToolsForClient(clientA)
        const resourcesA = await fetchResourcesForClient(clientA)
        const commandsA = await fetchCommandsForClient(clientA)
        barrierResolveA()
        await barrierB

        expect(toolsA.map(t => t.name)).toEqual([
          'mcp__postgres__query',
          'mcp__postgres__tenant_a_admin',
        ])
        expect(resourcesA.map(r => r.uri)).toEqual(['postgres://host-a/users'])
        expect(commandsA.map(c => c.name)).toEqual(['mcp__postgres__inspect_a'])

        const ctxA = makeToolUseContext()
        const queryToolA = toolsA.find(t => t.name === 'mcp__postgres__query')!
        expect(
          await queryToolA.description(
            {},
            {
              isNonInteractiveSession: true,
              toolPermissionContext: ctxA.getAppState().toolPermissionContext,
              tools: [],
            },
          ),
        ).toBe('SQL query on Host-A')
        const callOutA = await queryToolA.call(
          { sql: 'SELECT * FROM a_secret' },
          ctxA,
          canUseTool,
          parentMessage,
        )
        expect(callOutA.data).toEqual([
          { type: 'text', text: 'rows-from-A:SELECT * FROM a_secret' },
        ])

        const cmdA = commandsA[0]!
        if (cmdA.type === 'prompt') {
          const rendered = await cmdA.getPromptForCommand('accounts', ctxA)
          expect(JSON.stringify(rendered)).toContain('prompt-from-A:accounts')
        }

        // Evicting 'postgres' in Host A must NOT evict Host B's cache
        expect(fetchToolsForClient.cache.has('postgres')).toBe(true)
        fetchToolsForClient.cache.delete('postgres')
        fetchResourcesForClient.cache.delete('postgres')
        fetchCommandsForClient.cache.delete('postgres')
        expect(fetchToolsForClient.cache.has('postgres')).toBe(false)
        expect(fetchResourcesForClient.cache.has('postgres')).toBe(false)
        expect(fetchCommandsForClient.cache.has('postgres')).toBe(false)
      }),
      runWithNewHostSession({ diskless: true }, async () => {
        // Wait for Host A to populate its 'postgres' caches first so a shared
        // cache would have poisoned Host B with Host A's closures!
        await barrierA
        const toolsB = await fetchToolsForClient(clientB)
        const resourcesB = await fetchResourcesForClient(clientB)
        const commandsB = await fetchCommandsForClient(clientB)
        barrierResolveB()

        expect(toolsB.map(t => t.name)).toEqual([
          'mcp__postgres__query',
          'mcp__postgres__tenant_b_audit',
        ])
        expect(resourcesB.map(r => r.uri)).toEqual(['postgres://host-b/ledger'])
        expect(commandsB.map(c => c.name)).toEqual(['mcp__postgres__inspect_b'])

        const ctxB = makeToolUseContext()
        const queryToolB = toolsB.find(t => t.name === 'mcp__postgres__query')!
        expect(
          await queryToolB.description(
            {},
            {
              isNonInteractiveSession: true,
              toolPermissionContext: ctxB.getAppState().toolPermissionContext,
              tools: [],
            },
          ),
        ).toBe('SQL query on Host-B')
        const callOutB = await queryToolB.call(
          { sql: 'SELECT * FROM b_secret' },
          ctxB,
          canUseTool,
          parentMessage,
        )
        expect(callOutB.data).toEqual([
          { type: 'text', text: 'rows-from-B:SELECT * FROM b_secret' },
        ])

        const cmdB = commandsB[0]!
        if (cmdB.type === 'prompt') {
          const rendered = await cmdB.getPromptForCommand('invoices', ctxB)
          expect(JSON.stringify(rendered)).toContain('prompt-from-B:invoices')
        }

        // Wait a tick for Host A's .cache.delete('postgres') to run and verify
        // Host B's caches are still populated!
        await new Promise<void>(r => setTimeout(r, 10))
        expect(fetchToolsForClient.cache.has('postgres')).toBe(true)
        expect(fetchResourcesForClient.cache.has('postgres')).toBe(true)
        expect(fetchCommandsForClient.cache.has('postgres')).toBe(true)
        expect(fetchToolsForClient.cache.size()).toBe(1)
      }),
    ])

    expect(callsA).toEqual([{ sql: 'SELECT * FROM a_secret' }])
    expect(callsB).toEqual([{ sql: 'SELECT * FROM b_secret' }])
    expect(promptsA).toEqual([{ table: 'accounts' }])
    expect(promptsB).toEqual([{ table: 'invoices' }])
  })

  test('async notifications/tools/list_changed on SDK MCP transport re-enters the owning host session', async () => {
    const makeSdkResponder =
      (toolName: string) =>
      async (
        _serverName: string,
        message: JSONRPCMessage,
      ): Promise<JSONRPCMessage> => {
        const req = message as { id?: number | string; method?: string }
        if (req.method === 'initialize') {
          return {
            jsonrpc: '2.0',
            id: req.id ?? 1,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: { tools: { listChanged: true } },
              serverInfo: { name: 'postgres', version: '1.0.0' },
            },
          } as JSONRPCMessage
        }
        if (req.method === 'tools/list') {
          return {
            jsonrpc: '2.0',
            id: req.id ?? 2,
            result: {
              tools: [
                {
                  name: toolName,
                  description: toolName,
                  inputSchema: { type: 'object', properties: {} },
                },
              ],
            },
          } as JSONRPCMessage
        }
        return {
          jsonrpc: '2.0',
          id: req.id ?? 0,
          result: {},
        } as JSONRPCMessage
      }

    let connA!: ConnectedMCPServer
    let connB!: ConnectedMCPServer
    let sessionAId!: string
    let observedNotificationSessionId: string | undefined

    const hostARun = await runWithNewHostSession(
      { diskless: true },
      async session => {
        sessionAId = session.id
        const setup = await setupSdkMcpClients(
          { postgres: { type: 'sdk', name: 'postgres' } },
          makeSdkResponder('tool_host_a'),
        )
        expect(setup.tools.map(t => t.name)).toEqual([
          'mcp__postgres__tool_host_a',
        ])
        connA = setup.clients[0] as ConnectedMCPServer
        connA.client.setNotificationHandler(
          'notifications/tools/list_changed',
          async () => {
            observedNotificationSessionId = getActiveSessionFromAls()?.id
            fetchToolsForClient.cache.delete('postgres')
          },
        )
        expect(fetchToolsForClient.cache.has('postgres')).toBe(true)
        return session
      },
    )

    const hostBRun = await runWithNewHostSession(
      { diskless: true },
      async session => {
        const setup = await setupSdkMcpClients(
          { postgres: { type: 'sdk', name: 'postgres' } },
          makeSdkResponder('tool_host_b'),
        )
        expect(setup.tools.map(t => t.name)).toEqual([
          'mcp__postgres__tool_host_b',
        ])
        connB = setup.clients[0] as ConnectedMCPServer
        expect(fetchToolsForClient.cache.has('postgres')).toBe(true)
        return session
      },
    )

    // Deliver inbound notification outside any ALS context (simulating raw socket frame)
    exitSessionContext(() => {
      expect(getActiveSessionFromAls()).toBeUndefined()
      connA.client.transport?.onmessage?.({
        jsonrpc: '2.0',
        method: 'notifications/tools/list_changed',
      } as JSONRPCMessage)
    })
    await new Promise<void>(r => setTimeout(r, 10))

    expect(observedNotificationSessionId).toBe(sessionAId)

    // Verify Host A's cache was invalidated while Host B's cache was NOT touched
    const { runWithSession } = await import('../sessionRoot.js')
    runWithSession(hostARun, () => {
      expect(fetchToolsForClient.cache.has('postgres')).toBe(false)
    })
    runWithSession(hostBRun, () => {
      expect(fetchToolsForClient.cache.has('postgres')).toBe(true)
    })

    await connA.cleanup()
    await connB.cleanup()
  })

  test('connectToServer.cache, removedMcpServerNames, mcpToolsSwapper, connectedClientWiring, onMcpServerConnected, and liveMcpClients isolate across hosts', async () => {
    const sharedConfig: ScopedMcpServerConfig = {
      type: 'http',
      url: 'https://db.example.com/mcp',
      scope: 'user',
    }
    let rootsChangedA = 0
    let rootsChangedB = 0
    const swappedA: string[] = []
    const swappedB: string[] = []
    const connectedEventsA: string[] = []
    const connectedEventsB: string[] = []
    let unsubLiveA!: () => void

    await Promise.all([
      runWithNewHostSession({ diskless: true }, async () => {
        const fakeConnA: MCPServerConnection = {
          type: 'needs-auth',
          name: 'postgres',
          config: sharedConfig,
        }
        connectToServer.cache.set('postgres-key', Promise.resolve(fakeConnA))
        expect(connectToServer.cache.has('postgres-key')).toBe(true)
        expect([
          ...(connectToServer.cache as unknown as Map<string, unknown>).keys(),
        ]).toEqual(['postgres-key'])

        markMcpServerRemovedFromSession('postgres', sharedConfig)
        expect(isMcpServerRemovedFromSession('postgres', sharedConfig)).toBe(
          true,
        )

        const wiringA = () => {}
        registerConnectedClientWiring(wiringA)
        expect(getConnectedClientWiring()).toBe(wiringA)

        registerMcpToolsSwapper(serverName => {
          swappedA.push(serverName)
          return true
        })
        onMcpServerConnected('postgres', conn => {
          connectedEventsA.push(`${conn.name}-A`)
        })
        unsubLiveA = _registerLiveMcpClientForTests({
          sendRootsListChanged: async () => {
            rootsChangedA++
          },
        } as unknown as Client)

        expect(swapMcpServerTools('postgres', [], sharedConfig)).toBe(true)
        notifyMcpServerConnected({
          type: 'connected',
          name: 'postgres',
          capabilities: {},
          client: {} as Client,
          config: sharedConfig,
          cleanup: async () => {},
        })
        notifyMcpRootsListChanged()
      }),
      runWithNewHostSession({ diskless: true }, async () => {
        expect(connectToServer.cache.has('postgres-key')).toBe(false)
        expect(isMcpServerRemovedFromSession('postgres', sharedConfig)).toBe(
          false,
        )
        expect(getConnectedClientWiring()).toBeUndefined()
        expect(swapMcpServerTools('postgres', [], sharedConfig)).toBe(false)

        registerMcpToolsSwapper(serverName => {
          swappedB.push(serverName)
          return true
        })
        onMcpServerConnected('postgres', conn => {
          connectedEventsB.push(`${conn.name}-B`)
        })
        _registerLiveMcpClientForTests({
          sendRootsListChanged: async () => {
            rootsChangedB++
          },
        } as unknown as Client)

        expect(swapMcpServerTools('shared-db', [], sharedConfig)).toBe(true)
        notifyMcpRootsListChanged()
      }),
    ])

    unsubLiveA()
    expect(swappedA).toEqual(['postgres'])
    expect(swappedB).toEqual(['shared-db'])
    expect(connectedEventsA).toEqual(['postgres-A'])
    expect(connectedEventsB).toEqual([])
    expect(rootsChangedA).toBe(1)
    expect(rootsChangedB).toBe(1)
  })

  test('mcpSwitchedOffRecord, discoveryCache, config, cliOwnedConfigs, and claudeai state isolate across hosts', async () => {
    const httpCfg: ScopedMcpServerConfig = {
      type: 'http',
      url: 'https://mcp.example.com/v1',
      scope: 'user',
    }
    const disabledPatchesA: Array<string[] | null> = []
    const disabledPatchesB: Array<string[] | null> = []
    const adoptedA: string[] = []
    const adoptedB: string[] = []
    const dialFailedA: string[] = []
    const dialFailedB: string[] = []
    const arrivalA: string[] = []
    const arrivalB: string[] = []
    const sharedCliOwnedObj = { type: 'http', url: 'https://cli.example.com' }
    let wrappedFetchA!: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>

    await Promise.all([
      runWithNewHostSession({ diskless: true }, async () => {
        // 1. mcpSwitchedOffRecord
        let disabledA = ['postgres']
        const recordA = new McpSwitchedOffRecord(
          {
            restoredWorkerState: Promise.resolve({}),
            rereadWorkerState: async () => ({}),
            sessionState: {
              notifyInternalMetadataChanged: patch => {
                disabledPatchesA.push(patch.disabled_mcp_servers)
              },
            },
          },
          { getDisabledServers: () => disabledA },
        )
        setActiveMcpSwitchedOffRecord(recordA)
        expect(getActiveMcpSwitchedOffRecord()).toBe(recordA)
        notifyMcpSwitchedOffSaved('postgres', false)
        disabledA = []

        // 2. discoveryCache
        subscribeCachedAdopt(name => adoptedA.push(name))
        subscribeCachedDialFailed(f => dialFailedA.push(f.name))
        expect(
          writeDiscoveryCacheEntry(
            'postgres',
            httpCfg,
            {
              capabilities: { tools: {} },
              tools: [
                {
                  name: 'a_tool',
                  inputSchema: { type: 'object', properties: {} },
                },
              ],
              commands: [],
              resources: [],
              templates: [],
            },
            { now: 1000 },
          ),
        ).toBe('written')
        const readA = readDiscoveryCacheEntry('postgres', httpCfg, {
          enabled: true,
          now: 1500,
        })
        expect(readA.kind).toBe('fresh')

        const failedConn: FailedMCPServer = {
          type: 'failed',
          name: 'postgres',
          config: httpCfg,
          error: 'boom',
        }
        const p = Promise.resolve(failedConn as MCPServerConnection)
        runCachedFirstDialArms(failedConn, p, 0, {
          isSuperseded: () => false,
          getCurrentDial: () => p,
          deleteCurrentDial: () => {},
          getIdentityEpoch: () => 0,
          detachAndClose: () => {},
        })
        expect(takeSettledCachedDialFailure('postgres', httpCfg)?.failure).toBe(
          failedConn,
        )

        // 3. config.ts
        storeMcpConfigServerErrors([
          { name: 'bad-a', type: 'http', message: 'invalid url' },
        ])
        setCloudPluginStartupPending(true)
        subscribeToManagedMcpArrival(msg => arrivalA.push(msg))
        expect(getMcpConfigServerErrors().map(e => e.name)).toEqual(['bad-a'])
        expect(isCloudPluginStartupPending()).toBe(true)

        // 4. cliOwnedConfigs.ts
        markCliOwnedConfig(sharedCliOwnedObj, {
          getBearerToken: () => 'secret-bearer-A',
        })
        expect(isCliOwnedConfig(sharedCliOwnedObj)).toBe(true)
        expect(await resolveCliOwnedBearerToken(sharedCliOwnedObj)).toBe(
          'secret-bearer-A',
        )
        wrappedFetchA = wrapCliOwnedFetch(async (_input, init) => {
          const auth = new Headers(init?.headers).get('Authorization')
          return new Response(auth ?? 'none', { status: 200 })
        }, sharedCliOwnedObj)

        // 5. claudeai.ts
        markClaudeAiMcpConnected('claude.ai Slack A')
        expect(hasClaudeAiMcpSessionConnected('claude.ai Slack A')).toBe(true)
        fetchClaudeAIMcpConfigsIfEligible.cache.set(
          undefined,
          Promise.resolve({ 'claude.ai Slack A': httpCfg }),
        )
        expect(fetchClaudeAIMcpConfigsIfEligible.cache.has(undefined)).toBe(
          true,
        )
      }),
      runWithNewHostSession({ diskless: true }, async () => {
        // 1. mcpSwitchedOffRecord untouched in Host B
        const recordB = new McpSwitchedOffRecord({
          restoredWorkerState: Promise.resolve({}),
          rereadWorkerState: async () => ({}),
          sessionState: {
            notifyInternalMetadataChanged: patch => {
              disabledPatchesB.push(patch.disabled_mcp_servers)
            },
          },
        })
        setActiveMcpSwitchedOffRecord(recordB)
        expect(getActiveMcpSwitchedOffRecord()).toBe(recordB)

        // 2. discoveryCache untouched in Host B
        subscribeCachedAdopt(name => adoptedB.push(name))
        subscribeCachedDialFailed(f => dialFailedB.push(f.name))
        const readB = readDiscoveryCacheEntry('postgres', httpCfg, {
          enabled: true,
          now: 1500,
        })
        expect(readB).toEqual({ kind: 'miss', reason: 'absent' })
        expect(
          takeSettledCachedDialFailure('postgres', httpCfg),
        ).toBeUndefined()
        dropDiscoveryCacheEntry('postgres', httpCfg)

        // 3. config.ts untouched in Host B
        subscribeToManagedMcpArrival(msg => arrivalB.push(msg))
        expect(getMcpConfigServerErrors()).toEqual([])
        expect(isCloudPluginStartupPending()).toBe(false)

        // 4. cliOwnedConfigs.ts untouched in Host B
        expect(isCliOwnedConfig(sharedCliOwnedObj)).toBe(false)
        expect(await resolveCliOwnedBearerToken(sharedCliOwnedObj)).toBeNull()

        // 5. claudeai.ts untouched in Host B
        expect(hasClaudeAiMcpSessionConnected('claude.ai Slack A')).toBe(false)
        expect(fetchClaudeAIMcpConfigsIfEligible.cache.has(undefined)).toBe(
          false,
        )
      }),
    ])

    // Wrapped CLI-owned fetch from Host A still resolves Host A's bearer outside ALS!
    const respOutsideAls = await exitSessionContext(() =>
      wrappedFetchA('https://cli.example.com/rpc'),
    )
    expect(await respOutsideAls.text()).toBe('Bearer secret-bearer-A')

    expect(disabledPatchesA).toEqual([['postgres']])
    expect(disabledPatchesB).toEqual([])
    expect(adoptedA).toEqual([])
    expect(adoptedB).toEqual([])
    expect(dialFailedA).toEqual(['postgres'])
    expect(dialFailedB).toEqual([])
    expect(arrivalA).toEqual([])
    expect(arrivalB).toEqual([])
  })

  test('auth, authReconnect, mcpStepUpReauth, and mcpReauthSignal state isolate across hosts', async () => {
    const httpCfg: McpHTTPServerConfig = {
      type: 'http',
      url: 'https://oauth.example.com/mcp',
    }
    const recoveredA: string[] = []
    const recoveredB: string[] = []
    const reauthA: string[] = []
    const reauthB: string[] = []
    const rolesA: string[] = []
    const rolesB: string[] = []
    const helperCfg = { type: 'http', url: 'https://helper.example.com' }

    let releaseReconnectA!: () => void
    const gateA = new Promise<void>(r => {
      releaseReconnectA = r
    })

    await Promise.all([
      runWithNewHostSession({ diskless: true }, async () => {
        dialedWithoutOAuth.set('postgres', 'https://a.example.com')
        rejectedStoredTokens.set('postgres-key', 'bad-token-a')
        const pendingOAuth = new Promise<void>(r => setTimeout(r, 20))
        setActiveOAuthPromise('postgres', pendingOAuth)
        expect(getActiveOAuthPromise('postgres')).toBe(pendingOAuth)

        const oauthKey = getServerKey('postgres', httpCfg)
        markTransientMcpRefreshFailure(oauthKey)
        expect(hasRecentTransientMcpRefreshFailure(oauthKey)).toBe(true)

        subscribeMcpAuthRecovered(name => recoveredA.push(name))
        emitMcpAuthRecovered('postgres', httpCfg)
        expect(hasRecentTransientMcpRefreshFailure(oauthKey)).toBe(false)

        markMcpStepUpReauthExhausted(
          'postgres-key',
          'admin write',
          'write admin',
        )
        expect(isMcpStepUpReauthExhausted('postgres-key', 'admin write')).toBe(
          true,
        )

        markMcpHeadersHelperConfig(helperCfg)
        expect(isMcpHeadersHelperConfig(helperCfg)).toBe(true)
        subscribeMcpNeedsReauth(name => reauthA.push(name))
        emitMcpNeedsReauth('postgres')

        const reconnectPromiseA = joinOrStartAuthReconnect(
          'postgres-cache-key',
          'mcp_oauth_refresh',
          async () => {
            await gateA
            return { type: 'connected', host: 'A' }
          },
          join => rolesA.push(join.role),
        )
        expect(hasAuthReconnectInFlight('postgres-cache-key')).toBe(true)
        await pendingOAuth
        const resA = await reconnectPromiseA
        expect(resA).toEqual({ type: 'connected', host: 'A' })
      }),
      runWithNewHostSession({ diskless: true }, async () => {
        // Yield once so Host A sets all maps/in-flight state first
        await new Promise<void>(r => setTimeout(r, 5))

        const oauthKey = getServerKey('postgres', httpCfg)
        markTransientMcpRefreshFailure('host-b-only-key')
        expect(dialedWithoutOAuth.get('postgres')).toBeUndefined()
        expect(rejectedStoredTokens.get('postgres-key')).toBeUndefined()
        expect(getActiveOAuthPromise('postgres')).toBeUndefined()
        expect(hasRecentTransientMcpRefreshFailure(oauthKey)).toBe(false)
        expect(hasRecentTransientMcpRefreshFailure('host-b-only-key')).toBe(
          true,
        )
        expect(isMcpStepUpReauthExhausted('postgres-key', 'admin write')).toBe(
          false,
        )
        expect(isMcpHeadersHelperConfig(helperCfg)).toBe(false)
        expect(hasAuthReconnectInFlight('postgres-cache-key')).toBe(false)

        subscribeMcpAuthRecovered(name => recoveredB.push(name))
        subscribeMcpNeedsReauth(name => reauthB.push(name))

        // Host B's reconnect for the same cacheKey must be its own leader, NOT
        // collateral-joining Host A's in-flight reconnect!
        const resB = await joinOrStartAuthReconnect(
          'postgres-cache-key',
          'mcp_oauth_refresh',
          async () => ({ type: 'connected', host: 'B' }),
          join => rolesB.push(join.role),
        )
        expect(resB).toEqual({ type: 'connected', host: 'B' })
        releaseReconnectA()
      }),
    ])

    expect(recoveredA).toEqual(['postgres'])
    expect(recoveredB).toEqual([])
    expect(reauthA).toEqual(['postgres'])
    expect(reauthB).toEqual([])
    expect(rolesA).toEqual(['leader'])
    expect(rolesB).toEqual(['leader'])
  })
})
