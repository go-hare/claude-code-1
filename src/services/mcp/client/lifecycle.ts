import { feature } from 'bun:bundle'
import { createDensableMcpClient } from '../mcpV2Client.js'
import type {
  JSONRPCMessage,
  ConnectedMCPServer,
  MCPServerConnection,
  McpSdkServerConfig,
  ScopedMcpServerConfig,
  ServerResource,
} from '../types.js'
import {
  applyCapabilityServeTimeMiss,
  createCachedMcpClient,
  discoverySourceForMiss,
  dropDiscoveryCacheEntry,
  getDiscoveryFetchError,
  isCacheOutcomeMiss,
  isMcpDiscoveryCacheEnabled,
  logMcpDiscoverySource,
  markSwrRefreshDialInFlight,
  persistLiveListing,
  readDiscoveryCacheEntry,
  recordDiscoveryRefreshStrike,
  runCachedFirstDialArms,
  takeSettledCachedDialFailure,
  unmarkSwrRefreshDialInFlight,
} from '../discoveryCache.js'
import { readClientProtocolEra } from '../channelPermissions.js'
import type { Command } from '../../../commands.js'
import { type Tool, toolMatchesName } from '../../../Tool.js'
import { ListMcpResourcesTool } from '@claude-code/builtin-tools/tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
import { createMcpAuthTools } from '@claude-code/builtin-tools/tools/McpAuthTool/McpAuthTool.js'
import { ReadMcpResourceTool } from '@claude-code/builtin-tools/tools/ReadMcpResourceTool/ReadMcpResourceTool.js'
import { count } from '../../../utils/array.js'
import { errorMessage } from '../../../utils/errors.js'
import { logMCPDebug, logMCPError } from '../../../utils/log.js'
import { getBootstrapSession } from '../../../utils/sessionRoot.js'
import { logEvent } from '../../analytics/index.js'
import { clearKeychainCache } from '../../../utils/secureStorage/macOsKeychainHelpers.js'
import {
  dialWithSignedOutFallback,
  hasMcpDiscoveryButNoToken,
} from '../auth.js'
import { markClaudeAiMcpConnected } from '../claudeai.js'
import { getAllMcpConfigs, isMcpServerDisabled } from '../config.js'
import {
  getMcpIdentityEpoch,
  mcpConfigDependsOnAccountIdentity,
  seedMcpIdentityCheck,
  mcpIdentityChangedSinceLastCheck,
} from '../mcpIdentity.js'
import { SdkControlClientTransport } from '../SdkControlTransport.js'
import {
  inertReconnectShape,
  MAX_MCP_DESCRIPTION_LENGTH,
} from '../clientHelpers.js'
import {
  getMcpServerConnectionBatchSize,
  getRemoteMcpServerConnectionBatchSize,
  getServerCacheKey,
  isLocalMcpServer,
  isMcpAuthCached,
  isMcpSessionExpiredError,
  processBatched,
} from '../connectionHelpers.js'
import {
  bindMcpClientHandlersToSession,
  invokeToolRaw,
} from './errorsAndKeys.js'
import {
  cleanupConnectedMcpClients,
  clearServerCache,
  connectToServer,
  detachAndCloseConnection,
  discardMemoizedConnectResult,
  disposeServerConnectionDetached,
  dropDiscoveryEntry,
  ensureConnectedClient,
  evictAllMcpMemosOnIdentityChange,
  evictStaleFailedConnectMemoForServe,
  fetchCommandsForClient,
  fetchMcpSkillsForClient,
  fetchResourcesForClient,
  fetchToolsForClient,
  isSupersededMcpDial,
  peekSettledConnection,
} from './hostState.js'
import {
  composeMcpCommandsFromRawListing,
  composeMcpToolsFromRawListing,
} from './listing.js'

/** Official `Fl` / `mcpClientModule`. Gold `T()` is this bag. */
export function mcpClientModule(): {
  reconnectMcpServerImpl: typeof reconnectMcpServerImpl
  disposeServerConnectionDetached: typeof disposeServerConnectionDetached
  evictAllMcpMemosOnIdentityChange: typeof evictAllMcpMemosOnIdentityChange
  discardMemoizedConnectResult: typeof discardMemoizedConnectResult
  getMcpToolsCommandsAndResources: typeof getMcpToolsCommandsAndResources
  peekSettledConnection: typeof peekSettledConnection
  detachAndCloseConnection: typeof detachAndCloseConnection
  dropDiscoveryEntry: typeof dropDiscoveryEntry
  evictStaleFailedConnectMemoForServe: typeof evictStaleFailedConnectMemoForServe
  seedMcpIdentityCheck: typeof seedMcpIdentityCheck
  getMcpIdentityEpoch: typeof getMcpIdentityEpoch
  mcpIdentityChangedSinceLastCheck: typeof mcpIdentityChangedSinceLastCheck
  cleanupConnectedMcpClients: typeof cleanupConnectedMcpClients
  invokeToolRaw: typeof invokeToolRaw
  ensureConnectedClient: typeof ensureConnectedClient
  isMcpSessionExpiredError: typeof isMcpSessionExpiredError
  clearServerCache: typeof clearServerCache
  fetchToolsForClient: typeof fetchToolsForClient
  runCachedFirstDialArms: typeof runCachedFirstDialArms
  persistLiveListing: typeof persistLiveListing
  takeSettledCachedDialFailure: typeof takeSettledCachedDialFailure
  getDiscoveryFetchError: typeof getDiscoveryFetchError
} {
  return {
    reconnectMcpServerImpl,
    disposeServerConnectionDetached,
    evictAllMcpMemosOnIdentityChange,
    discardMemoizedConnectResult,
    getMcpToolsCommandsAndResources,
    peekSettledConnection,
    detachAndCloseConnection,
    dropDiscoveryEntry,
    evictStaleFailedConnectMemoForServe,
    seedMcpIdentityCheck,
    getMcpIdentityEpoch,
    mcpIdentityChangedSinceLastCheck,
    cleanupConnectedMcpClients,
    invokeToolRaw,
    ensureConnectedClient,
    isMcpSessionExpiredError,
    clearServerCache,
    fetchToolsForClient,
    runCachedFirstDialArms,
    persistLiveListing,
    takeSettledCachedDialFailure,
    getDiscoveryFetchError,
  }
}

/**
 * Note: This should not be called by UI components directly, they should use the reconnectMcpServer
 * function from useManageMcpConnections.
 * @param name Server name
 * @param config Server configuration
 * @returns Object containing the client connection and its resources
 */
export async function reconnectMcpServerImpl(
  name: string,
  config: ScopedMcpServerConfig,
  _storageV5?: unknown,
  _credentials?: unknown,
  options?: { keepConnectionInUse?: boolean },
): Promise<{
  client: MCPServerConnection
  tools: Tool[]
  commands: Command[]
  resources?: ServerResource[]
  keptConnectionInUse?: boolean
}> {
  const identityEpoch = getMcpIdentityEpoch()
  const identitySensitive = mcpConfigDependsOnAccountIdentity(config)
  const identityMoved = (): boolean =>
    identitySensitive && getMcpIdentityEpoch() !== identityEpoch
  let live: ConnectedMCPServer | undefined
  const keepAliveOut: { connection?: ConnectedMCPServer } | undefined =
    options?.keepConnectionInUse ? {} : undefined
  try {
    // Invalidate the keychain cache so we read fresh credentials from disk.
    // This is necessary when another process (e.g. the VS Code extension host)
    // has modified stored tokens (cleared auth, saved new OAuth tokens) and then
    // asks the CLI subprocess to reconnect.  Without this, the subprocess would
    // use stale cached data and never notice the tokens were removed.
    clearKeychainCache()

    await clearServerCache(name, config, keepAliveOut)
    if (identityMoved()) {
      if (keepAliveOut?.connection !== undefined) {
        await clearServerCache(name, config)
      }
      return inertReconnectShape(name, config)
    }
    let dialAttempt = 0
    let client = await dialWithSignedOutFallback(
      () => {
        // Official `Ci`: do NOT evict connectToServer.cache when clearServerCache
        // kept an in-use connection (keepAliveOut.connection !== undefined) or on
        // the initial dial (clearServerCache already evicted on normal teardown).
        // Only evict on a signed-out fallback retry (dialAttempt > 0).
        if (dialAttempt > 0 && keepAliveOut?.connection === undefined) {
          connectToServer.cache.delete(getServerCacheKey(name, config))
        }
        dialAttempt++
        return connectToServer(name, config)
      },
      () => !identityMoved(),
      name,
      config,
    )
    // Official HWt: needs-auth → one cache-clear retry.
    if (client.type === 'needs-auth') {
      logMCPDebug(
        name,
        `Reconnect returned 'needs-auth'; retrying once after cache clear`,
      )
      if (identityMoved()) return inertReconnectShape(name, config)
      connectToServer.cache.delete(getServerCacheKey(name, config))
      client = await connectToServer(name, config)
    }
    if (identityMoved()) {
      if (client.type === 'connected') {
        await detachAndCloseConnection(client)
      }
      return inertReconnectShape(name, config)
    }

    if (client.type !== 'connected') {
      return {
        client,
        tools: [],
        commands: [],
      }
    }
    live = client

    // densable: discoveryAuthFailure from tools/list → surface needs-auth
    // (distinct from discoveryBearerRejected which stays connected + /login).
    const supportsResources = !!client.capabilities?.resources

    // densable #42: fetchCommands/Resources throw on error (list_changed keep-
    // previous). Initial reconnect still soft-defaults empty on failure.
    const settleEmpty = async <T>(p: Promise<T>, empty: T): Promise<T> => {
      try {
        return await p
      } catch {
        return empty
      }
    }

    const [tools, mcpCommands, mcpSkills, resources] = await Promise.all([
      fetchToolsForClient(client),
      settleEmpty(fetchCommandsForClient(client), []),
      feature('MCP_SKILLS') && supportsResources
        ? settleEmpty(fetchMcpSkillsForClient!(client), [])
        : Promise.resolve([]),
      supportsResources
        ? settleEmpty(fetchResourcesForClient(client), [])
        : Promise.resolve([]),
    ])
    if (identityMoved()) {
      await detachAndCloseConnection(client)
      return inertReconnectShape(name, config)
    }

    if (client.discoveryAuthFailure) {
      // Identity-move already detaches. tools/list 401/403 must too —
      // otherwise lodash memo keeps the live SSE/HTTP and the next
      // reconnect may skip redial. peekSettled === connected stays gold.
      await detachAndCloseConnection(client)
      return {
        client: { name, type: 'needs-auth' as const, config },
        tools: [],
        commands: [],
      }
    }

    if (config.type === 'claudeai-proxy' && !client.discoveryBearerRejected) {
      markClaudeAiMcpConnected(name)
    }

    // Official 2.1.331 `Ig` (`persistLiveListing`): write-through discovery
    // cache after a live reconnect listing completes cleanly.
    void persistLiveListing(
      client,
      {
        tools,
        commands: mcpCommands,
        resources,
        identityEpoch,
      },
      {
        isDisabled: isMcpServerDisabled,
        peekSettledConnection,
        getCurrentIdentityEpoch: getMcpIdentityEpoch,
      },
    )

    const commands = [...mcpCommands, ...mcpSkills]

    // Check if we need to add resource tools
    const resourceTools: Tool[] = []
    if (supportsResources) {
      // Only add resource tools if no other server has them
      const hasResourceTools = [ListMcpResourcesTool, ReadMcpResourceTool].some(
        tool => tools.some(t => toolMatchesName(t, tool.name)),
      )
      if (!hasResourceTools) {
        resourceTools.push(ListMcpResourcesTool, ReadMcpResourceTool)
      }
    }

    return {
      client,
      tools: [...tools, ...resourceTools],
      commands,
      resources: resources.length > 0 ? resources : undefined,
      ...(keepAliveOut?.connection !== undefined &&
      client === keepAliveOut.connection
        ? { keptConnectionInUse: true }
        : {}),
    }
  } catch (error) {
    // Handle errors gracefully - connection might have closed during fetch
    logMCPError(name, `Error during reconnection: ${errorMessage(error)}`)
    if (live && keepAliveOut?.connection !== live) {
      await detachAndCloseConnection(live)
    }

    // Return with failed status
    return {
      client: { name, type: 'failed' as const, config },
      tools: [],
      commands: [],
    }
  }
}

export async function getMcpToolsCommandsAndResources(
  onConnectionAttempt: (params: {
    client: MCPServerConnection
    tools: Tool[]
    commands: Command[]
    resources?: ServerResource[]
    attemptEpoch?: number
  }) => void,
  mcpConfigs?: Record<string, ScopedMcpServerConfig>,
  deferResourcesForRemote = false,
): Promise<void> {
  let resourceToolsAdded = false

  const allConfigEntries = Object.entries(
    mcpConfigs ?? (await getAllMcpConfigs()).servers,
  )

  // Partition into disabled and active entries — disabled servers should
  // never generate HTTP connections or flow through batch processing
  const configEntries: typeof allConfigEntries = []
  for (const entry of allConfigEntries) {
    if (isMcpServerDisabled(entry[0])) {
      onConnectionAttempt({
        client: { name: entry[0], type: 'disabled', config: entry[1] },
        tools: [],
        commands: [],
        attemptEpoch: getMcpIdentityEpoch(),
      })
    } else {
      configEntries.push(entry)
    }
  }

  // Calculate transport counts for logging
  const totalServers = configEntries.length
  const stdioCount = count(configEntries, ([_, c]) => c.type === 'stdio')
  const sseCount = count(configEntries, ([_, c]) => c.type === 'sse')
  const httpCount = count(configEntries, ([_, c]) => c.type === 'http')
  const sseIdeCount = count(configEntries, ([_, c]) => c.type === 'sse-ide')
  const wsIdeCount = count(configEntries, ([_, c]) => c.type === 'ws-ide')

  // Split servers by type: local (stdio/sdk) need lower concurrency due to
  // process spawning, remote servers can connect with higher concurrency
  const localServers = configEntries.filter(([_, config]) =>
    isLocalMcpServer(config),
  )
  const remoteServers = configEntries.filter(
    ([_, config]) => !isLocalMcpServer(config),
  )

  const serverStats = {
    totalServers,
    stdioCount,
    sseCount,
    httpCount,
    sseIdeCount,
    wsIdeCount,
  }

  const processServer = async ([name, config]: [
    string,
    ScopedMcpServerConfig,
  ]): Promise<void> => {
    const attemptEpoch = getMcpIdentityEpoch()
    const report: typeof onConnectionAttempt = result =>
      onConnectionAttempt({ ...result, attemptEpoch })
    try {
      // Check if server is disabled - if so, just add it to state without connecting
      if (isMcpServerDisabled(name)) {
        report({
          client: {
            name,
            type: 'disabled',
            config,
          },
          tools: [],
          commands: [],
        })
        return
      }

      // Skip connection for servers that recently returned 401 (15min TTL),
      // or that we have probed before but hold no token for. The second
      // check closes the gap the TTL leaves open: without it, every 15min
      // we re-probe servers that cannot succeed until the user runs /mcp.
      // Each probe is a network round-trip for connect-401 plus OAuth
      // discovery, and print mode awaits the whole batch (main.tsx:3503).
      if (
        (config.type === 'claudeai-proxy' ||
          config.type === 'http' ||
          config.type === 'sse') &&
        ((await isMcpAuthCached(name)) ||
          ((config.type === 'http' || config.type === 'sse') &&
            hasMcpDiscoveryButNoToken(name, config)))
      ) {
        logMCPDebug(name, `Skipping connection (cached needs-auth)`)
        report({
          client: { name, type: 'needs-auth' as const, config },
          tools: createMcpAuthTools(name, config),
          commands: [],
        })
        return
      }

      // Official 2.1.331 cache-first MCP discovery: serve fresh/stale cached
      // listings before dialing the transport, and trigger background SWR
      // refresh on stale entries.
      const settledLive = isMcpDiscoveryCacheEnabled()
        ? await peekSettledConnection(name, config)
        : undefined
      const rawCacheOutcome = readDiscoveryCacheEntry(name, config, {
        hasLiveConnection: settledLive?.type === 'connected',
      })
      const cacheOutcome = applyCapabilityServeTimeMiss(rawCacheOutcome)
      if (cacheOutcome.kind === 'fresh' || cacheOutcome.kind === 'stale') {
        const { entry, ageMs } = cacheOutcome
        const cachedClient = createCachedMcpClient(name, config, entry)
        const cachedTools = composeMcpToolsFromRawListing(
          cachedClient,
          entry.tools,
        )
        const cachedCommands = composeMcpCommandsFromRawListing(
          cachedClient,
          entry.commands,
        )
        const cachedResources: ServerResource[] = entry.resources.map(
          resource => ({
            ...resource,
            server: name,
          }),
        )
        const cachedSupportsResources =
          Boolean(entry.capabilities?.resources) || cachedResources.length > 0
        const cachedResourceTools: Tool[] = []
        if (cachedSupportsResources && !resourceToolsAdded) {
          resourceToolsAdded = true
          cachedResourceTools.push(ListMcpResourcesTool, ReadMcpResourceTool)
        }
        logMcpDiscoverySource({
          source: cacheOutcome.kind === 'fresh' ? 'cache_fresh' : 'cache_stale',
          transportType: config.type ?? 'stdio',
          entryAgeMs: ageMs,
          cacheHit: true,
        })
        report({
          client: cachedClient,
          tools: [...cachedTools, ...cachedResourceTools],
          commands: cachedCommands,
          resources: cachedResources.length > 0 ? cachedResources : undefined,
        })

        if (cacheOutcome.kind === 'stale') {
          void (async () => {
            const dialPromise = connectToServer(name, config, serverStats)
            markSwrRefreshDialInFlight(dialPromise)
            const firstDialDeps = {
              isSuperseded: isSupersededMcpDial,
              getCurrentDial: (k: string) =>
                connectToServer.cache?.get?.(k) as
                  | Promise<MCPServerConnection>
                  | undefined,
              deleteCurrentDial: (k: string) => {
                connectToServer.cache?.delete?.(k)
              },
              getIdentityEpoch: getMcpIdentityEpoch,
              detachAndClose: (c: ConnectedMCPServer) => {
                void detachAndCloseConnection(c).catch(() => {})
              },
            }
            try {
              const liveClient = await dialPromise
              if (liveClient.type !== 'connected') {
                runCachedFirstDialArms(
                  liveClient,
                  dialPromise,
                  attemptEpoch,
                  firstDialDeps,
                )
                if (
                  !isSupersededMcpDial(dialPromise) &&
                  getMcpIdentityEpoch() === attemptEpoch
                ) {
                  recordDiscoveryRefreshStrike(name, config)
                }
                return
              }
              if (
                isSupersededMcpDial(dialPromise) ||
                getMcpIdentityEpoch() !== attemptEpoch
              ) {
                return
              }
              if (
                entry.negotiatedEra !== undefined &&
                liveClient.protocolEra !== undefined &&
                liveClient.protocolEra !== entry.negotiatedEra
              ) {
                logMCPDebug(
                  name,
                  'Discovery cache entry dropped: server negotiated a different protocol era on revalidation',
                )
                dropDiscoveryCacheEntry(name, config)
                runCachedFirstDialArms(
                  liveClient,
                  dialPromise,
                  attemptEpoch,
                  firstDialDeps,
                )
                return
              }
              const liveSupportsResources = Boolean(
                liveClient.capabilities?.resources,
              )
              const settleSwr = async <T>(
                p: Promise<T>,
                empty: T,
              ): Promise<T> => {
                try {
                  return await p
                } catch {
                  return empty
                }
              }
              const [liveTools, liveCommands, liveResources] =
                await Promise.all([
                  fetchToolsForClient(liveClient),
                  settleSwr(fetchCommandsForClient(liveClient), []),
                  liveSupportsResources
                    ? settleSwr(fetchResourcesForClient(liveClient), [])
                    : Promise.resolve([]),
                ])
              if (
                isSupersededMcpDial(dialPromise) ||
                getMcpIdentityEpoch() !== attemptEpoch
              ) {
                return
              }
              await persistLiveListing(
                liveClient,
                {
                  tools: liveTools,
                  commands: liveCommands,
                  resources: liveResources,
                  identityEpoch: attemptEpoch,
                },
                {
                  isDisabled: isMcpServerDisabled,
                  peekSettledConnection,
                  getCurrentIdentityEpoch: getMcpIdentityEpoch,
                },
              )
              runCachedFirstDialArms(
                liveClient,
                dialPromise,
                attemptEpoch,
                firstDialDeps,
              )
            } catch {
              if (
                !isSupersededMcpDial(dialPromise) &&
                getMcpIdentityEpoch() === attemptEpoch
              ) {
                recordDiscoveryRefreshStrike(name, config)
              }
            } finally {
              unmarkSwrRefreshDialInFlight(dialPromise)
            }
          })()
        }
        return
      }
      if (isMcpDiscoveryCacheEnabled() && isCacheOutcomeMiss(cacheOutcome)) {
        logMcpDiscoverySource({
          source: discoverySourceForMiss(cacheOutcome),
          transportType: config.type ?? 'stdio',
        })
      }

      const client = await connectToServer(name, config, serverStats)

      if (client.type !== 'connected') {
        report({
          client,
          tools:
            client.type === 'needs-auth'
              ? createMcpAuthTools(name, config)
              : [],
          commands: [],
        })
        return
      }

      if (config.type === 'claudeai-proxy') {
        markClaudeAiMcpConnected(name)
      }

      const supportsResources = !!client.capabilities?.resources

      // densable #42: list fetch throws; first connect soft-defaults empty.
      const settleEmpty = async <T>(p: Promise<T>, empty: T): Promise<T> => {
        try {
          return await p
        } catch {
          return empty
        }
      }

      const primaryPromise = Promise.all([
        fetchToolsForClient(client),
        settleEmpty(fetchCommandsForClient(client), []),
        // Discover skills from skill:// resources
        feature('MCP_SKILLS') && supportsResources
          ? settleEmpty(fetchMcpSkillsForClient!(client), [])
          : Promise.resolve([]),
      ])
      const resourcesPromise = supportsResources
        ? settleEmpty(fetchResourcesForClient(client), [])
        : Promise.resolve([])

      const shouldDeferResources =
        deferResourcesForRemote === true &&
        (config.type === 'http' || config.type === 'sse')
      if (shouldDeferResources) {
        resourcesPromise.catch(() => {})
      }

      const [[tools, mcpCommands, mcpSkills], eagerResources] =
        await Promise.all([
          primaryPromise,
          shouldDeferResources ? Promise.resolve(undefined) : resourcesPromise,
        ])
      const commands = [...mcpCommands, ...mcpSkills]

      // If this server resources and we haven't added resource tools yet,
      // include our resource tools with this client's tools
      const resourceTools: Tool[] = []
      if (supportsResources && !resourceToolsAdded) {
        resourceToolsAdded = true
        resourceTools.push(ListMcpResourcesTool, ReadMcpResourceTool)
      }

      const emit = (resources: ServerResource[]) => {
        report({
          client,
          tools: [...tools, ...resourceTools],
          commands,
          resources: resources.length > 0 ? resources : undefined,
        })
      }

      if (shouldDeferResources) {
        emit([])
      }
      const resources = eagerResources ?? (await resourcesPromise)
      void persistLiveListing(
        client,
        {
          tools,
          commands: mcpCommands,
          resources,
          identityEpoch: attemptEpoch,
        },
        {
          isDisabled: isMcpServerDisabled,
          peekSettledConnection,
          getCurrentIdentityEpoch: getMcpIdentityEpoch,
        },
      )
      if (!shouldDeferResources) {
        emit(resources)
      }
    } catch (error) {
      // Handle errors gracefully - connection might have closed during fetch
      logMCPError(
        name,
        `Error fetching tools/commands/resources: ${errorMessage(error)}`,
      )

      // Still update with the client but no tools/commands
      report({
        client: { name, type: 'failed' as const, config },
        tools: [],
        commands: [],
      })
    }
  }

  // Process both groups concurrently, each with their own concurrency limits:
  // - Local servers (stdio/sdk): lower concurrency to avoid process spawning resource contention
  // - Remote servers: higher concurrency since they're just network connections
  await Promise.all([
    processBatched(
      localServers,
      getMcpServerConnectionBatchSize(),
      processServer,
    ),
    processBatched(
      remoteServers,
      getRemoteMcpServerConnectionBatchSize(),
      processServer,
    ),
  ])
}

// Not memoized: called only 2-3 times at startup/reconfig. The inner work
// (connectToServer, fetch*ForClient) is already cached. Memoizing here by
// mcpConfigs object ref leaked — main.tsx creates fresh config objects each call.
export function prefetchAllMcpResources(
  mcpConfigs: Record<string, ScopedMcpServerConfig>,
): Promise<{
  clients: MCPServerConnection[]
  tools: Tool[]
  commands: Command[]
}> {
  return new Promise(resolve => {
    let pendingCount = 0
    let completedCount = 0

    pendingCount = Object.keys(mcpConfigs).length

    if (pendingCount === 0) {
      void resolve({
        clients: [],
        tools: [],
        commands: [],
      })
      return
    }

    const clients: MCPServerConnection[] = []
    const tools: Tool[] = []
    const commands: Command[] = []

    getMcpToolsCommandsAndResources(result => {
      clients.push(result.client)
      tools.push(...result.tools)
      commands.push(...result.commands)

      completedCount++
      if (completedCount >= pendingCount) {
        const commandsMetadataLength = commands.reduce((sum, command) => {
          const commandMetadataLength =
            command.name.length +
            (command.description ?? '').length +
            (command.argumentHint ?? '').length
          return sum + commandMetadataLength
        }, 0)
        logEvent('tengu_mcp_tools_commands_loaded', {
          tools_count: tools.length,
          commands_count: commands.length,
          commands_metadata_length: commandsMetadataLength,
        })

        void resolve({
          clients,
          tools,
          commands,
        })
      }
    }, mcpConfigs).catch(error => {
      logMCPError(
        'prefetchAllMcpResources',
        `Failed to get MCP resources: ${errorMessage(error)}`,
      )
      // Still resolve with empty results
      void resolve({
        clients: [],
        tools: [],
        commands: [],
      })
    })
  })
}

/**
 * Sets up SDK MCP clients by creating transports and connecting them.
 * densable 2.1.251 #29 `Rd`: each server via Promise.allSettled; only a thrown
 * server is marked failed. Callee-present arms only — no invent of
 * connect analytics names ABSENT from sink, `qo` instruction scrub, `gD`, or
 * `getNegotiatedProtocolVersion` (ABSENT).
 *
 * @param sdkMcpConfigs - The SDK MCP server configurations
 * @param sendMcpMessage - Callback to send MCP messages through the control channel
 * @returns Connected clients, their tools, and MCP skill commands
 */
export async function setupSdkMcpClients(
  sdkMcpConfigs: Record<string, McpSdkServerConfig>,
  sendMcpMessage: (
    serverName: string,
    message: JSONRPCMessage,
  ) => Promise<JSONRPCMessage>,
): Promise<{
  clients: MCPServerConnection[]
  tools: Tool[]
  commands: Command[]
}> {
  const clients: MCPServerConnection[] = []
  const tools: Tool[] = []
  const commands: Command[] = []
  const capturedSdkSession = getBootstrapSession()

  // densable Rd — connect every SDK server in parallel; catch keeps only that
  // name failed so one handshake stall does not take down the batch.
  const results = await Promise.allSettled(
    Object.entries(sdkMcpConfigs).map(async ([name, config]) => {
      const transport = new SdkControlClientTransport(name, sendMcpMessage)

      // densable: sdk-control transport is always legacy negotiation.
      // gold `co("sdk-control")` ABSENT as a discrete factory — mode:'legacy'
      // is the local densable plan equivalent.
      const client = createDensableMcpClient({ mode: 'legacy' })
      bindMcpClientHandlersToSession(client, capturedSdkSession)

      try {
        await client.connect(transport)

        const capabilities = client.getServerCapabilities()
        const serverVersion = client.getServerVersion()
        const rawInstructions = client.getInstructions()
        // densable Rd `qo(x,b)` scrub ABSENT — same truncation as connectToServer.
        let instructions = rawInstructions
        if (
          rawInstructions &&
          rawInstructions.length > MAX_MCP_DESCRIPTION_LENGTH
        ) {
          instructions =
            rawInstructions.slice(0, MAX_MCP_DESCRIPTION_LENGTH) +
            '… [truncated]'
          logMCPDebug(
            name,
            `Server instructions truncated from ${rawInstructions.length} to ${MAX_MCP_DESCRIPTION_LENGTH} chars`,
          )
        }

        const connectedClient: MCPServerConnection = {
          type: 'connected',
          name,
          capabilities: capabilities || {},
          serverInfo: serverVersion,
          instructions,
          client,
          config: { ...config, scope: 'dynamic' as const },
          cleanup: async () => {
            await client.close()
          },
          protocolEra: readClientProtocolEra(client),
        }

        // densable Rd: mr().toolLists.delete + at.invalidateMcpSkillsForServer —
        // local memo is fetchTools / fetchMcpSkills keyed by server name.
        fetchToolsForClient.cache.delete(name)
        if (feature('MCP_SKILLS')) {
          fetchMcpSkillsForClient!.cache.delete(name)
        }

        const serverTools: Tool[] = []
        if (capabilities?.tools) {
          const sdkTools = await fetchToolsForClient(connectedClient)
          serverTools.push(...sdkTools)
        }

        // densable Rd: mu() && resources → at.fetchMcpSkillsForClient
        const serverCommands =
          feature('MCP_SKILLS') && capabilities?.resources
            ? await fetchMcpSkillsForClient!(connectedClient)
            : []

        // densable success connect analytics callee ABSENT — no invent.
        return {
          client: connectedClient,
          tools: serverTools,
          commands: serverCommands,
        }
      } catch (error) {
        // densable failed-connect analytics pair ABSENT — logMCPError only.
        logMCPError(name, `Failed to connect SDK MCP server: ${error}`)
        return {
          client: {
            type: 'failed' as const,
            name,
            config: { ...config, scope: 'user' as const },
          },
          tools: [],
          commands: [],
        }
      }
    }),
  )

  for (const result of results) {
    if (result.status === 'fulfilled') {
      clients.push(result.value.client)
      tools.push(...result.value.tools)
      commands.push(...result.value.commands)
    }
  }

  // densable Rd: any connected + resources → ensure List/Read once.
  // gold also pushes `gD` (ABSENT here) — only UA/VA (List/Read) are present.
  if (
    clients.some(
      connection =>
        connection.type === 'connected' && !!connection.capabilities?.resources,
    )
  ) {
    const hasResourceTools = [ListMcpResourcesTool, ReadMcpResourceTool].some(
      tool => tools.some(t => toolMatchesName(t, tool.name)),
    )
    if (!hasResourceTools) {
      tools.push(ListMcpResourcesTool, ReadMcpResourceTool)
    }
  }

  return { clients, tools, commands }
}
