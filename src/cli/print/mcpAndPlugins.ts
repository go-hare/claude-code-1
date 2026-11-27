/**
 * Headless streaming MCP client lifecycle, elicitation handlers, plugin installation,
 * tool pool assembly, hearth mount, and bridge message forwarding.
 */
import type { HeadlessStreamingContext } from './streamingTypes.js'
import { createModelSwitchBreadcrumbs } from 'src/utils/messages.js'
import { modelDisplayString } from 'src/utils/model/model.js'
import { LOCAL_COMMAND_STDOUT_TAG, TICK_TAG } from 'src/constants/xml.js'
import {
  getSessionId,
  getInitJsonSchema,
  getIsRemoteMode,
} from 'src/bootstrap/state.js'
import type {
  StdoutMessage,
  SDKControlMcpSetServersResponse,
} from 'src/entrypoints/sdk/controlTypes.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
} from 'src/services/mcp/types.js'
import { logMCPDebug, logError } from 'src/utils/log.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js'
import {
  runElicitationHooks,
  runElicitationResultHooks,
} from 'src/services/mcp/elicitationHandler.js'
import { executeNotificationHooks } from 'src/utils/hooks.js'
import { randomUUID } from 'crypto'
import {
  setupSdkMcpClients,
  seedMcpIdentityCheck,
  cleanupConnectedMcpClients,
} from 'src/services/mcp/client.js'
import { uniq } from 'src/utils/array.js'
import { getMcpPrefix } from 'src/services/mcp/mcpStringUtils.js'
import {
  isRefusalFallbackLaneEnabled,
  handleVscodeFeedbackSurveyEvent,
  handleVscodeAutoDefaultNudgeEvent,
  getVscodeStartupAnnouncementGate,
  isAutoDefaultLaunchEnabled,
} from 'src/services/mcp/vscodeIdeBridgeCallbacks.js'
import { setupVscodeSdkMcp } from 'src/services/mcp/vscodeSdkMcp.js'
import { getBootstrapSession } from 'src/utils/sessionRoot.js'
import { preferLiveMcpClients } from 'src/hooks/useMergedClients.js'
import { registerCleanup } from 'src/utils/cleanupRegistry.js'
import { isShuttingDown } from 'src/utils/gracefulShutdown.js'
import {
  reregisterChannelHandlerAfterReconnect,
  handleMcpSetServers,
} from 'src/cli/headless/HeadlessControlPlane.js'
import { attachHeadlessRemoteMcpReconnect } from 'src/services/mcp/headlessMcpReconnect.js'
import { type Tools, toolMatchesName } from 'src/Tool.js'
import type { AppState } from 'src/state/AppStateStore.js'
import { assembleToolPool } from 'src/tools.js'
import uniqBy from 'lodash-es/uniqBy.js'
import { mergeAndFilterTools } from 'src/utils/toolPool.js'
import {
  createSyntheticOutputTool,
  SYNTHETIC_OUTPUT_TOOL_NAME,
} from '@claude-code/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { RemoteIO } from 'src/cli/remoteIO.js'
import { getSessionIngressAuthToken } from 'src/utils/sessionIngressAuth.js'
import { takeInitialUserMessage } from 'src/utils/sessionStart.js'
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { drainSdkEvents } from '../../utils/sdkEventQueue.js'
import { clearBridgeSession } from 'src/utils/sessionStorage.js'
import { forwardParentToolUseSdkFrame } from 'src/bridge/subagentSdkFrames.js'
import type {
  McpServerConfigForProcessTransport,
  McpServerStatus,
} from 'src/entrypoints/agentSdkTypes.js'
import { isSpareParked } from 'src/cli/spareClaim.js'
import { filterToolsByServer } from 'src/services/mcp/utils.js'
import { feature } from 'bun:bundle'
import {
  isChannelsEnabled,
  isChannelAllowlisted,
} from 'src/services/mcp/channelAllowlist.js'
import { isEnvTruthy, isBareMode } from '../../utils/envUtils.js'
import {
  setCloudPluginStartupPending,
  getAllMcpConfigs,
  isMcpServerDisabled,
} from 'src/services/mcp/config.js'
import { withDiagnosticsTiming } from 'src/utils/diagLogs.js'
import { downloadUserSettings } from 'src/services/settingsSync/index.js'
import { installPluginsForHeadless } from '../../utils/plugins/headlessPluginInstall.js'
import { isSyncPluginsOrInstallEnabled } from 'src/utils/residualFinalEnvGates.js'
import { refreshActivePlugins } from '../../utils/plugins/refresh.js'
import { getCommands, clearCommandsCache } from '../../commands.js'
import { getCwd } from 'src/utils/cwd.js'
import {
  type Command,
  getCommandName,
  formatDescriptionWithSource,
} from 'src/commands.js'
import { skillChangeDetector } from '../../utils/skills/skillChangeDetector.js'
import { proactiveModule } from './featureLoaders.js'
import { createProactiveAutonomyCommands } from 'src/utils/autonomyRuns.js'
import { cancelQueuedAutonomyCommands } from 'src/utils/autonomyQueueLifecycle.js'
import { enqueue } from 'src/utils/messageQueueManager.js'

export function initializeStreamingMcpAndPlugins(
  streamCtx: HeadlessStreamingContext,
): void {
  function injectModelSwitchBreadcrumbs(
    modelArg: string,
    resolvedModel: string,
  ): void {
    const breadcrumbs = createModelSwitchBreadcrumbs(
      modelArg,
      modelDisplayString(resolvedModel),
    )
    streamCtx.mutableMessages.push(...breadcrumbs)
    for (const crumb of breadcrumbs) {
      if (
        typeof crumb.message.content === 'string' &&
        crumb.message.content.includes(`<${LOCAL_COMMAND_STDOUT_TAG}>`)
      ) {
        streamCtx.output.enqueue({
          type: 'user',
          content: crumb.message.content,
          message: crumb.message as unknown,
          session_id: getSessionId(),
          parent_tool_use_id: null,
          uuid: crumb.uuid,
          timestamp: crumb.timestamp,
          isReplay: true,
        } as unknown as StdoutMessage)
      }
    }
  }
  /**
   * Register elicitation request/completion handlers on connected MCP clients
   * that haven't been registered yet. SDK MCP servers are excluded because they
   * route through SdkControlClientTransport. Hooks run first (matching REPL
   * behavior); if no hook responds, the request is forwarded to the SDK
   * consumer via the control protocol.
   */
  function registerElicitationHandlers(clients: MCPServerConnection[]): void {
    for (const connection of clients) {
      if (
        connection.type !== 'connected' ||
        streamCtx.elicitationRegistered.get(connection.name) ===
          connection.client
      ) {
        continue
      }
      // Skip SDK MCP servers — elicitation flows through SdkControlClientTransport
      if (connection.config.type === 'sdk') {
        continue
      }
      const serverName = connection.name

      // Wrapped in try/catch because setRequestHandler throws if the client wasn't
      // created with elicitation capability declared (e.g., SDK-created clients).
      try {
        // densable: setRequestHandler("elicitation/create", ...)
        connection.client.setRequestHandler(
          'elicitation/create',
          // v2 BaseContext: signal lives on ctx.mcpReq
          async (request, ctx) => {
            logMCPDebug(
              serverName,
              `Elicitation request received in print mode: ${jsonStringify(request)}`,
            )

            const mode = request.params.mode === 'url' ? 'url' : 'form'
            const signal = ctx.mcpReq.signal

            logEvent('tengu_mcp_elicitation_shown', {
              mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })

            // Run elicitation hooks first — they can provide a response programmatically
            const hookResponse = await runElicitationHooks(
              serverName,
              request.params,
              signal,
            )
            if (hookResponse) {
              logMCPDebug(
                serverName,
                `Elicitation resolved by hook: ${jsonStringify(hookResponse)}`,
              )
              logEvent('tengu_mcp_elicitation_response', {
                mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                action:
                  hookResponse.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
              return hookResponse
            }

            // Delegate to SDK consumer via control protocol
            const url =
              'url' in request.params
                ? (request.params.url as string)
                : undefined
            const requestedSchema =
              'requestedSchema' in request.params
                ? (request.params.requestedSchema as
                    | Record<string, unknown>
                    | undefined)
                : undefined

            const elicitationId =
              'elicitationId' in request.params
                ? (request.params.elicitationId as string | undefined)
                : undefined

            const rawResult = await streamCtx.structuredIO.handleElicitation(
              serverName,
              request.params.message,
              requestedSchema,
              signal,
              mode,
              url,
              elicitationId,
            )

            const result = await runElicitationResultHooks(
              serverName,
              rawResult,
              signal,
              mode,
              elicitationId,
            )

            logEvent('tengu_mcp_elicitation_response', {
              mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              action:
                result.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            return result
          },
        )

        // Surface completion notifications to SDK consumers (URL mode)
        // densable: setNotificationHandler("notifications/elicitation/complete", ...)
        connection.client.setNotificationHandler(
          'notifications/elicitation/complete',
          notification => {
            const elicitationId = (
              notification as { params?: { elicitationId?: string } }
            ).params?.elicitationId
            // Guard before hooks/enqueue — match elicitationHandler order.
            if (typeof elicitationId !== 'string') {
              logMCPDebug(
                serverName,
                `Ignoring elicitation completion notification without elicitationId`,
              )
              return
            }
            logMCPDebug(
              serverName,
              `Elicitation completion notification: ${elicitationId}`,
            )
            void executeNotificationHooks({
              message: `MCP server "${serverName}" confirmed elicitation ${elicitationId} complete`,
              notificationType: 'elicitation_complete',
            })
            streamCtx.output.enqueue({
              type: 'system',
              subtype: 'elicitation_complete',
              mcp_server_name: serverName,
              elicitation_id: elicitationId,
              uuid: randomUUID(),
              session_id: getSessionId(),
            })
          },
        )

        streamCtx.elicitationRegistered.set(serverName, connection.client)
      } catch {
        // setRequestHandler throws if the client wasn't created with
        // elicitation capability — skip silently
      }
    }
  }
  async function updateSdkMcp(
    failedPolicy: 'retry' | 'skip' = 'retry',
  ): Promise<void> {
    // Check if SDK MCP servers need to be updated (new servers added or removed)
    const currentServerNames = new Set(Object.keys(streamCtx.sdkMcpConfigs))
    const connectedServerNames = new Set(streamCtx.sdkClients.map(c => c.name))

    // Check if there are any differences (additions or removals)
    const hasNewServers = Array.from(currentServerNames).some(
      name => !connectedServerNames.has(name),
    )
    const hasRemovedServers = Array.from(connectedServerNames).some(
      name => !currentServerNames.has(name),
    )
    // Check if any SDK clients are pending and need to be upgraded
    const hasPendingSdkClients = streamCtx.sdkClients.some(
      c => c.type === 'pending',
    )
    // Check if any SDK clients failed their handshake and need to be retried.
    // Without this, a client that lands in 'failed' (e.g. handshake timeout on
    // a WS reconnect race) stays failed forever — its name satisfies the
    // connectedServerNames diff but it contributes zero tools.
    const hasFailedSdkClients =
      failedPolicy === 'retry' &&
      streamCtx.sdkClients.some(c => c.type === 'failed')

    const haveServersChanged =
      hasNewServers ||
      hasRemovedServers ||
      hasPendingSdkClients ||
      hasFailedSdkClients

    if (haveServersChanged) {
      // Clean up removed servers
      for (const client of streamCtx.sdkClients) {
        if (!currentServerNames.has(client.name)) {
          if (client.type === 'connected') {
            await client.cleanup()
          }
        }
      }

      // Re-initialize all SDK MCP servers with current config
      const sdkSetup = await setupSdkMcpClients(
        streamCtx.sdkMcpConfigs,
        (serverName, message) =>
          streamCtx.structuredIO.sendMcpMessage(serverName, message),
      )
      streamCtx.sdkClients = sdkSetup.clients
      streamCtx.sdkTools = sdkSetup.tools

      // Store SDK MCP tools in appState so subagents can access them via
      // assembleToolPool. Only tools are stored here — SDK clients are already
      // merged separately in the query loop (allMcpClients) and mcp_status handler.
      // Use both old (connectedServerNames) and new (currentServerNames) to remove
      // stale SDK tools when servers are added or removed.
      const allSdkNames = uniq([...connectedServerNames, ...currentServerNames])
      streamCtx.setAppState(prev => ({
        ...prev,
        mcp: {
          ...prev.mcp,
          tools: [
            ...prev.mcp.tools.filter(
              t =>
                !allSdkNames.some(name =>
                  t.name.startsWith(getMcpPrefix(name)),
                ),
            ),
            ...streamCtx.sdkTools,
          ],
        },
      }))

      // densable uSm — VSCode MCP + experiment_gates options call-site
      const refusalLane = isRefusalFallbackLaneEnabled()
      setupVscodeSdkMcp(streamCtx.sdkClients, {
        onFeedbackSurveyEvent: handleVscodeFeedbackSurveyEvent,
        onAutoDefaultNudgeEvent: handleVscodeAutoDefaultNudgeEvent,
        refusalFallbackLaneEnabled: refusalLane,
        refusalFallbackSettingToggleVisible: refusalLane,
        fable5LaunchShow: false,
        startupAnnouncement: getVscodeStartupAnnouncementGate(),
        autoDefaultLaunchEnabled: isAutoDefaultLaunchEnabled(),
      })
    }
  }

  void updateSdkMcp()

  const releaseMcpClientsAccessor =
    getBootstrapSession().mcpSessionWiring.acquireClientsAccessor(() =>
      preferLiveMcpClients(
        streamCtx.dynamicMcpState.clients,
        streamCtx.getAppState().mcp.clients,
      ),
    )
  registerCleanup(releaseMcpClientsAccessor)

  // densable 2.1.243 #11 `mS` — -p/SDK never mounted useManageMCPConnections,
  // so remote MCP onclose never reconnected or marked failed.
  // Official `$d` is session-end (not per-turn finally); `gt()` is shutdown.
  const controlReconnectInFlight = new Set<string>()
  let headlessMcpRunEnding = false
  let attachHeadlessRemoteReconnect: (
    clients: readonly MCPServerConnection[],
  ) => void
  const seedHeadlessMcpIdentity = (): void => {
    if (
      streamCtx.getAppState().mcp.clients.length === 0 &&
      streamCtx.dynamicMcpState.clients.length === 0
    ) {
      return
    }
    seedMcpIdentityCheck()
  }
  const headlessMcpDeps: import('../../services/mcp/headlessMcpReconnect.js').HeadlessMcpReconnectDeps =
    {
      getAppState: streamCtx.getAppState,
      setAppState: f => {
        streamCtx.setAppState(f)
        attachHeadlessRemoteReconnect([
          ...streamCtx.getAppState().mcp.clients,
          ...streamCtx.dynamicMcpState.clients,
        ])
      },
      getDynamicMcpState: () => streamCtx.dynamicMcpState,
      setDynamicMcpState: next => {
        streamCtx.dynamicMcpState = {
          ...streamCtx.dynamicMcpState,
          clients: next.clients,
          tools: next.tools,
        }
      },
      isControlReconnectInFlight: name => controlReconnectInFlight.has(name),
      isRunEnding: () => headlessMcpRunEnding || isShuttingDown(),
      onReconnected: client => {
        registerElicitationHandlers([client])
        reregisterChannelHandlerAfterReconnect(client)
      },
    }
  attachHeadlessRemoteReconnect =
    attachHeadlessRemoteMcpReconnect(headlessMcpDeps)
  const { createHeadlessMcpIdentityBoundary } =
    require('../../services/mcp/headlessMcpIdentityBoundary.js') as typeof import('../../services/mcp/headlessMcpIdentityBoundary.js')
  const { registerMcpIdentityChangeHandler, takeUnownedMcpIdentityChange } =
    require('../../services/mcp/mcpIdentity.js') as typeof import('../../services/mcp/mcpIdentity.js')
  const headlessMcpIdentityBoundary = createHeadlessMcpIdentityBoundary({
    ...headlessMcpDeps,
    getHostOwnedConfigs: () => streamCtx.dynamicMcpState.configs,
  })
  const releaseIdentityBoundary = registerMcpIdentityChangeHandler(() => {
    void headlessMcpIdentityBoundary.refresh()
  })
  if (takeUnownedMcpIdentityChange()) {
    queueMicrotask(() => {
      void headlessMcpIdentityBoundary.refresh({ force: true })
    })
  }
  registerCleanup(() => {
    releaseIdentityBoundary()
    headlessMcpIdentityBoundary.dispose()
  })

  const withControlReconnect = async <T>(
    name: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    controlReconnectInFlight.add(name)
    try {
      return await run()
    } finally {
      controlReconnectInFlight.delete(name)
    }
  }
  const appMcpClients = streamCtx.getAppState().mcp.clients
  if (
    appMcpClients.length > 0 ||
    streamCtx.dynamicMcpState.clients.length > 0
  ) {
    seedHeadlessMcpIdentity()
  }
  attachHeadlessRemoteReconnect([
    ...appMcpClients,
    ...streamCtx.dynamicMcpState.clients,
  ])
  let lastHeadlessMcpClients = appMcpClients
  const releaseMcpStateSubscription = streamCtx.options.subscribeAppState?.(
    () => {
      const clients = streamCtx.getAppState().mcp.clients
      if (clients === lastHeadlessMcpClients) return
      lastHeadlessMcpClients = clients
      if (clients.length > 0) seedHeadlessMcpIdentity()
      attachHeadlessRemoteReconnect([
        ...clients,
        ...streamCtx.dynamicMcpState.clients,
      ])
    },
  )
  if (releaseMcpStateSubscription) registerCleanup(releaseMcpStateSubscription)
  registerCleanup(async () => {
    headlessMcpRunEnding = true
    await streamCtx.pendingContextUsagePromise.catch(() => {})
    const clients = [
      ...streamCtx.getAppState().mcp.clients,
      ...streamCtx.dynamicMcpState.clients,
    ]
    if (clients.some(c => c.type === 'connected')) {
      await cleanupConnectedMcpClients(clients)
    }
  })

  // Shared tool assembly for ask() and the get_context_usage control request.
  // Closes over the mutable sdkTools/dynamicMcpState bindings so both call
  // sites see late-connecting servers.
  const buildAllTools = (appState: AppState): Tools => {
    const assembledTools = assembleToolPool(
      appState.toolPermissionContext,
      appState.mcp.tools,
    )
    let allTools = uniqBy(
      mergeAndFilterTools(
        [
          ...streamCtx.tools,
          ...streamCtx.sdkTools,
          ...streamCtx.dynamicMcpState.tools,
        ],
        assembledTools,
        appState.toolPermissionContext.mode,
      ),
      'name',
    )
    if (streamCtx.options.permissionPromptToolName) {
      allTools = allTools.filter(
        tool =>
          !toolMatchesName(tool, streamCtx.options.permissionPromptToolName!),
      )
    }
    // densable 2.1.283: CLI `--json-schema` / SDK init schema must survive
    // `tools=[]` merge. Always (re)append StructuredOutput if missing by name.
    const initJsonSchema = getInitJsonSchema()
    const schemaForOutput = streamCtx.options.jsonSchema ?? initJsonSchema
    if (schemaForOutput) {
      const syntheticOutputResult = createSyntheticOutputTool(schemaForOutput)
      if ('tool' in syntheticOutputResult) {
        const alreadyPresent = allTools.some(tool =>
          toolMatchesName(tool, SYNTHETIC_OUTPUT_TOOL_NAME),
        )
        if (!alreadyPresent) {
          allTools = [...allTools, syntheticOutputResult.tool]
        }
      }
    }
    return allTools
  }
  // densable Ga = createHeadlessHearthMount when sdkUrl parses (uur).
  // Gold: parseBridgeSdkUrl(D.sdkUrl) → Ga.sync("startup"); when
  // CLAUDE_CODE_ENVIRONMENT_KIND==="bridge", hold that promise (bu).
  // runHeadlessStreaming is sync — use require like other densable optional hosts.
  try {
    const { parseBridgeSdkUrl } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('src/bridge/hearthBinding.js') as typeof import('src/bridge/hearthBinding.js')
    const parsedSdk = parseBridgeSdkUrl(streamCtx.options.sdkUrl)
    const remote =
      streamCtx.structuredIO instanceof RemoteIO
        ? (streamCtx.structuredIO as RemoteIO)
        : undefined
    const worker = remote?.getHearthMountWorker?.() ?? null
    if (parsedSdk && worker) {
      const { createHeadlessHearthMount } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/bridge/projectsReplyMount.js') as typeof import('src/bridge/projectsReplyMount.js')
      streamCtx.hearthMount = createHeadlessHearthMount({
        stores: {
          getAppState: streamCtx.getAppState,
          setAppState: streamCtx.setAppState,
          getDynamicMcpState: () => streamCtx.dynamicMcpState,
        },
        sessionId: parsedSdk.sessionId,
        apiBaseUrl: parsedSdk.apiBaseUrl,
        getBearerToken: () => getSessionIngressAuthToken(),
        getWorkerEpoch: () => worker.workerEpoch(),
        readHearthBinding: () => worker.readProjectsBinding(),
        sdkHostConfigs: () =>
          streamCtx.sdkMcpConfigs as Record<string, unknown>,
      })
      streamCtx.hearthMountStartup = streamCtx.hearthMount.sync('startup')
      // densable bu — hold Ga.sync("startup") under bridge; join before
      // first ask via takeFirstTurnJoins (do not void / race).
      if (process.env.CLAUDE_CODE_ENVIRONMENT_KIND !== 'bridge') {
        streamCtx.hearthMountStartup = null
      }
    }
  } catch {
    // densable optional — sdkUrl / CCR worker may be unavailable
  }
  const sessionStartState = { clears: 0 }
  const overdueSessionStartHooks = streamCtx.options.overdueSessionStartHooks
  if (overdueSessionStartHooks) {
    const snapshotClears = sessionStartState.clears
    overdueSessionStartHooks.promise
      .then(hookMessages => {
        if (sessionStartState.clears !== snapshotClears) return
        if (hookMessages.length > 0) {
          streamCtx.mutableMessages.push(...hookMessages)
        }
        const lateInitialUserMessage = takeInitialUserMessage()
        if (lateInitialUserMessage) {
          streamCtx.structuredIO.prependUserMessage(lateInitialUserMessage)
        }
      })
      .catch(err => {
        logForDebugging(
          `SessionStart hooks ended after the session stopped waiting for them, and their output could not be added to the conversation (dropped): ${errorMessage(err)}`,
          { level: 'error' },
        )
      })
  }

  function drainPrintSdkEvents(forwardParentFrames = false): void {
    const events = drainSdkEvents()
    if (
      events.some(
        event => (event as { type?: string }).type === 'conversation_reset',
      )
    ) {
      streamCtx.bridgeLastForwardedIndex = 0
      overdueSessionStartHooks?.abort()
      sessionStartState.clears++
      if (!streamCtx.bridgeHandle) {
        clearBridgeSession()
      }
    }
    for (const event of events) {
      if (forwardParentFrames) {
        forwardParentToolUseSdkFrame(
          streamCtx.bridgeHandle,
          event as {
            type?: string
            subtype?: unknown
            status?: unknown
          },
        )
      }
      streamCtx.output.enqueue(event as StdoutMessage)
    }
  }

  // Forward new messages from mutableMessages to the bridge.
  // Called incrementally during each turn (so claude.ai sees progress
  // and stays alive during permission waits) and again after the turn.
  //
  // writeMessages has its own UUID-based dedup (initialMessageUUIDs,
  // recentPostedUUIDs) — the index cursor here is a pre-filter to avoid
  // O(n) re-scanning of already-sent messages on every call.
  function forwardMessagesToBridge(): void {
    if (!streamCtx.bridgeHandle) return
    // Guard against mutableMessages shrinking (compaction truncates it).
    const startIndex = Math.min(
      streamCtx.bridgeLastForwardedIndex,
      streamCtx.mutableMessages.length,
    )
    const newMessages = streamCtx.mutableMessages
      .slice(startIndex)
      .filter(m => m.type === 'user' || m.type === 'assistant')
    streamCtx.bridgeLastForwardedIndex = streamCtx.mutableMessages.length
    if (newMessages.length > 0) {
      streamCtx.bridgeHandle.writeMessages(newMessages)
    }
  }

  // Helper to apply MCP server changes - used by both mcp_set_servers control message
  // and background plugin installation.
  // NOTE: Nested function required - mutates closure state (sdkMcpConfigs, sdkClients, etc.)
  let mcpChangesPromise: Promise<{
    response: SDKControlMcpSetServersResponse
    sdkServersChanged: boolean
  }> = Promise.resolve({
    response: {
      added: [] as string[],
      removed: [] as string[],
      errors: {} as Record<string, string>,
    },
    sdkServersChanged: false,
  })

  function applyMcpServerChanges(
    servers: Record<string, McpServerConfigForProcessTransport>,
  ): Promise<{
    response: SDKControlMcpSetServersResponse
    sdkServersChanged: boolean
  }> {
    // Serialize calls to prevent race conditions between concurrent callers
    // (background plugin install and mcp_set_servers control messages)
    const doWork = async (): Promise<{
      response: SDKControlMcpSetServersResponse
      sdkServersChanged: boolean
    }> => {
      const oldSdkClientNames = new Set(streamCtx.sdkClients.map(c => c.name))
      const deferredAppStateUpdates: Array<(prev: AppState) => AppState> = []

      const result = await handleMcpSetServers(
        servers,
        {
          configs: streamCtx.sdkMcpConfigs,
          clients: streamCtx.sdkClients,
          tools: streamCtx.sdkTools,
        },
        streamCtx.dynamicMcpState,
        updater => {
          deferredAppStateUpdates.push(updater)
        },
      )

      // Commit dynamicMcpState & SDK state BEFORE firing setAppState listeners
      // so subscribers reading preferLiveMcpClients(dynamicMcpState.clients, ...)
      // never observe stale dynamicMcpState rows.
      for (const key of Object.keys(streamCtx.sdkMcpConfigs)) {
        delete streamCtx.sdkMcpConfigs[key]
      }
      Object.assign(streamCtx.sdkMcpConfigs, result.newSdkState.configs)
      streamCtx.sdkClients = result.newSdkState.clients
      streamCtx.sdkTools = result.newSdkState.tools
      streamCtx.dynamicMcpState = result.newDynamicState

      for (const updater of deferredAppStateUpdates) {
        streamCtx.setAppState(updater)
      }

      // Keep appState.mcp.tools in sync so subagents can see SDK MCP tools.
      // Use both old and new SDK client names to remove stale tools.
      if (result.sdkServersChanged) {
        const newSdkClientNames = new Set(streamCtx.sdkClients.map(c => c.name))
        const allSdkNames = uniq([...oldSdkClientNames, ...newSdkClientNames])
        streamCtx.setAppState(prev => ({
          ...prev,
          mcp: {
            ...prev.mcp,
            tools: [
              ...prev.mcp.tools.filter(
                t =>
                  !allSdkNames.some(name =>
                    t.name.startsWith(getMcpPrefix(name)),
                  ),
              ),
              ...streamCtx.sdkTools,
            ],
          },
        }))
      }

      return {
        response: result.response,
        sdkServersChanged: result.sdkServersChanged,
      }
    }

    mcpChangesPromise = mcpChangesPromise.then(doWork, doWork)
    return mcpChangesPromise
  }

  // densable YNo + Hu session bag for $.tool.register (headless/-p).
  {
    const { ensurePluginToolRegistrarInstalled } =
      require('../../utils/plugins/pluginToolLoopbackRegistrar.js') as typeof import('../../utils/plugins/pluginToolLoopbackRegistrar.js')
    const { setPluginToolSessionHost } =
      require('../../utils/plugins/pluginToolSessionHost.js') as typeof import('../../utils/plugins/pluginToolSessionHost.js')
    const { getDenyRuleForTool } =
      require('../../utils/permissions/permissions.js') as typeof import('../../utils/permissions/permissions.js')
    const {
      resolvePluginMcpServer,
      awaitPluginMcpServer,
      pluginMcpConnectionFromRow,
    } =
      require('../../utils/plugins/pluginMcpConnect.js') as typeof import('../../utils/plugins/pluginMcpConnect.js')
    const { CLAUDE_IN_CHROME_MCP_SERVER_NAME } =
      require('../../utils/claudeInChrome/common.js') as typeof import('../../utils/claudeInChrome/common.js')
    const { COMPUTER_USE_MCP_SERVER_NAME } =
      require('../../utils/computerUse/common.js') as typeof import('../../utils/computerUse/common.js')

    const headlessMcpRows = () =>
      preferLiveMcpClients(
        streamCtx.dynamicMcpState.clients,
        streamCtx.getAppState().mcp.clients,
      )

    // densable `sA` @206391800: 100ms poll paired with subscribeAppState so
    // settledMcpServer wakes both on synchronous setAppState transitions and on
    // background dynamicMcpState reconnects when subscribeAppState is absent.
    const subscribeHeadlessMcpRows = (listener: () => void): (() => void) => {
      const unsubStore = streamCtx.options.subscribeAppState?.(listener)
      const poll = setInterval(listener, 100)
      poll.unref?.()
      return () => {
        unsubStore?.()
        clearInterval(poll)
      }
    }

    const settledMcpServer = (name: string) =>
      awaitPluginMcpServer(
        {
          rows: headlessMcpRows,
          subscribe: subscribeHeadlessMcpRows,
        },
        name,
      )

    ensurePluginToolRegistrarInstalled()

    const isConnectableProcessTransport = (config: {
      type?: string
    }): boolean =>
      config.type === undefined ||
      config.type === 'stdio' ||
      config.type === 'sse' ||
      config.type === 'http'

    const isHeldBackParkedStdioServer = (
      name: string,
      config: { type?: string; scope?: string },
    ): boolean =>
      (config.type === undefined || config.type === 'stdio') &&
      name !== CLAUDE_IN_CHROME_MCP_SERVER_NAME &&
      name !== COMPUTER_USE_MCP_SERVER_NAME &&
      config.scope !== 'project' &&
      config.scope !== 'local'

    const applySingleDynamicMcpServer = async (
      name: string,
      config: McpServerConfigForProcessTransport | undefined,
    ) => {
      const next: Record<string, McpServerConfigForProcessTransport> = {
        ...(streamCtx.dynamicMcpState.configs as Record<
          string,
          McpServerConfigForProcessTransport
        >),
      }
      for (const [sdkName, sdkCfg] of Object.entries(streamCtx.sdkMcpConfigs)) {
        if (sdkCfg.type === 'sdk' && !(sdkName in next)) {
          next[sdkName] =
            sdkCfg as unknown as McpServerConfigForProcessTransport
        }
      }
      if (config === undefined) {
        delete next[name]
      } else {
        next[name] = config
      }
      return applyMcpServerChanges(next)
    }

    const POLICY_BLOCKED_REASON =
      'Blocked by enterprise policy (allowedMcpServers/deniedMcpServers)'

    // densable 2.1.289 `Sv`/`tA`/`rA`/`nA` @206389950 — direct async headless
    // MCP connect without REPL pending-row subscription deadlock.
    const connectHeadlessMcpServer = async (
      name: string,
      config: ScopedMcpServerConfig,
    ): Promise<
      import('../../utils/plugins/pluginToolSessionHost.js').PluginMcpConnection
    > => {
      const existing = headlessMcpRows().find(row => row.name === name)
      const retryOwnedFailure =
        existing?.type === 'failed' &&
        Object.hasOwn(streamCtx.dynamicMcpState.configs, name)
      if (retryOwnedFailure) {
        await applySingleDynamicMcpServer(name, undefined)
      }
      if (existing !== undefined && !retryOwnedFailure) {
        return settledMcpServer(name)
      }
      if (isSpareParked() && isHeldBackParkedStdioServer(name, config)) {
        return {
          isConnected: false,
          refused: 'failed',
          message: `The MCP server "${name}" did not start: this session is parked until a host claims it, and its stdio servers start at the claim.`,
        }
      }
      const { scope: _scope, ...transportConfig } = config
      if (!isConnectableProcessTransport(transportConfig)) {
        return {
          isConnected: false,
          refused: 'failed',
          message: `The MCP server "${name}" has a transport this session cannot connect.`,
        }
      }
      const { response } = await applySingleDynamicMcpServer(
        name,
        transportConfig as McpServerConfigForProcessTransport,
      )
      const err = response.errors[name]
      const outcome: import('../../utils/plugins/pluginToolSessionHost.js').PluginMcpConnection =
        err === POLICY_BLOCKED_REASON
          ? {
              isConnected: false,
              refused: 'policy',
              message: `Your organization's MCP policy does not allow "${name}".`,
            }
          : (() => {
              const row = headlessMcpRows().find(r => r.name === name)
              return (
                (row && pluginMcpConnectionFromRow(row)) ?? {
                  isConnected: false,
                  refused: 'failed',
                  message: `The MCP server "${name}" did not connect: ${err ?? 'no reason given'}.`,
                }
              )
            })()
      if (!outcome.isConnected && outcome.refused !== 'auth') {
        await applySingleDynamicMcpServer(name, undefined)
      }
      return outcome
    }

    setPluginToolSessionHost({
      resolveMcpServer: input =>
        resolvePluginMcpServer({
          ...input,
          dynamicServers: streamCtx.dynamicMcpState.configs,
        }),
      settledMcpServer,
      connectMcpServer: connectHeadlessMcpServer,
      addMcpServer: async (name, config) => {
        const { scope: _scope, ...transportConfig } = config
        if (!isConnectableProcessTransport(transportConfig)) {
          logForDebugging(
            `$.tool.register: server ${name} has a config this session cannot connect (${String(config.type)}); not added`,
            { level: 'warn' },
          )
          return
        }
        await applySingleDynamicMcpServer(
          name,
          transportConfig as McpServerConfigForProcessTransport,
        )
      },
      removeMcpServer: async name => {
        if (!Object.hasOwn(streamCtx.dynamicMcpState.configs, name)) {
          return
        }
        await applySingleDynamicMcpServer(name, undefined)
      },
      tools: () => buildAllTools(streamCtx.getAppState()),
      mcpServers: () => {
        const names = new Set<string>([
          ...streamCtx.getAppState().mcp.clients.map(c => c.name),
          ...Object.keys(streamCtx.dynamicMcpState.configs),
          ...streamCtx.sdkClients.map(c => c.name),
        ])
        return [...names]
      },
      builtInToolsDisabled:
        streamCtx.getAppState().toolPermissionContext.builtInToolsDisabled ===
        true,
      isToolWithheldByDenyRule: tool =>
        Boolean(
          getDenyRuleForTool(
            streamCtx.getAppState().toolPermissionContext,
            tool,
          ),
        ),
    })
  }

  // Build McpServerStatus[] for control responses. Shared by mcp_status and
  // reload_plugins handlers. Reads closure state: sdkClients, dynamicMcpState.
  function buildMcpServerStatuses(): McpServerStatus[] {
    const currentAppState = streamCtx.getAppState()
    const currentMcpClients = currentAppState.mcp.clients
    const allMcpTools = uniqBy(
      [...currentAppState.mcp.tools, ...streamCtx.dynamicMcpState.tools],
      'name',
    )
    const existingNames = new Set([
      ...currentMcpClients.map(c => c.name),
      ...streamCtx.sdkClients.map(c => c.name),
    ])
    return [
      ...currentMcpClients,
      ...streamCtx.sdkClients,
      ...streamCtx.dynamicMcpState.clients.filter(
        c => !existingNames.has(c.name),
      ),
    ].map(connection => {
      let config
      if (
        connection.config.type === 'sse' ||
        connection.config.type === 'http'
      ) {
        config = {
          type: connection.config.type,
          url: connection.config.url,
          headers: connection.config.headers,
          oauth: connection.config.oauth,
        }
      } else if (connection.config.type === 'claudeai-proxy') {
        config = {
          type: 'claudeai-proxy' as const,
          url: connection.config.url,
          id: connection.config.id,
        }
      } else if (
        connection.config.type === 'stdio' ||
        connection.config.type === undefined
      ) {
        const stdioConfig = connection.config as {
          command: string
          args: string[]
        }
        config = {
          type: 'stdio' as const,
          command: stdioConfig.command,
          args: stdioConfig.args,
        }
      }
      const serverTools =
        connection.type === 'connected'
          ? filterToolsByServer(allMcpTools, connection.name).map(tool => ({
              name: tool.mcpInfo?.toolName ?? tool.name,
              annotations: {
                readOnly: tool.isReadOnly({}) || undefined,
                destructive: tool.isDestructive?.({}) || undefined,
                openWorld: tool.isOpenWorld?.({}) || undefined,
              },
            }))
          : undefined
      // Capabilities passthrough with allowlist pre-filter. The IDE reads
      // experimental['claude/channel'] to decide whether to show the
      // Enable-channel prompt — only echo it if channel_enable would
      // actually pass the allowlist. Not a security boundary (the
      // handler re-runs the full gate); just avoids dead buttons.
      let capabilities: { experimental?: Record<string, unknown> } | undefined
      if (
        (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
        connection.type === 'connected' &&
        connection.capabilities.experimental
      ) {
        const exp = { ...connection.capabilities.experimental }
        if (
          exp['claude/channel'] &&
          (!isChannelsEnabled() ||
            !isChannelAllowlisted(connection.config.pluginSource))
        ) {
          delete exp['claude/channel']
        }
        if (Object.keys(exp).length > 0) {
          capabilities = { experimental: exp }
        }
      }
      return {
        name: connection.name,
        status: connection.type as McpServerStatus['status'],
        serverInfo:
          connection.type === 'connected' ? connection.serverInfo : undefined,
        error: connection.type === 'failed' ? connection.error : undefined,
        config,
        scope: connection.config.scope,
        tools: serverTools,
        capabilities,
      }
    }) as McpServerStatus[]
  }

  // NOTE: Nested function required - needs closure access to applyMcpServerChanges and updateSdkMcp
  async function installPluginsAndApplyMcpInBackground(): Promise<void> {
    let markedCloudPluginStartup = false
    try {
      // Join point for user settings (fired at runHeadless entry) and managed
      // settings (fired in main.tsx preAction). downloadUserSettings() caches
      // its promise so this awaits the same in-flight request.
      // Official REMOTE densable.
      let isRemotePlugins = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
      try {
        const { isRemoteEnvEnabled } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
        isRemotePlugins = isRemoteEnvEnabled()
      } catch {
        // keep raw env fallback
      }
      // Official 2.1.325 #2328: hold connector MCP tool auto-approval in cloud
      // sessions while startup plugins are still loading.
      if (isRemotePlugins || getIsRemoteMode()) {
        setCloudPluginStartupPending(true)
        markedCloudPluginStartup = true
      }
      await Promise.all([
        feature('DOWNLOAD_USER_SETTINGS') &&
        (isRemotePlugins || getIsRemoteMode())
          ? withDiagnosticsTiming('headless_user_settings_download', () =>
              downloadUserSettings(),
            )
          : Promise.resolve(),
        Promise.resolve(),
      ])

      const pluginsInstalled = await installPluginsForHeadless()

      if (pluginsInstalled) {
        await applyPluginMcpDiff()
      }
    } catch (error) {
      logError(error)
    } finally {
      if (markedCloudPluginStartup) {
        setCloudPluginStartupPending(false)
      }
    }
  }
  // --bare / SIMPLE: skip plugin install. Scripted calls don't add plugins
  // mid-session; the next interactive run reconciles.
  if (!isBareMode()) {
    // Official: CLAUDE_CODE_SYNC_PLUGIN_INSTALL or CLAUDE_CODE_SYNC_PLUGINS
    // await install before first ask(); otherwise fire-and-forget background.
    if (isSyncPluginsOrInstallEnabled()) {
      streamCtx.pluginInstallPromise = installPluginsAndApplyMcpInBackground()
    } else {
      void installPluginsAndApplyMcpInBackground()
    }
  }
  // Clear all plugin-related caches, reload commands/agents/hooks.
  // Called after CLAUDE_CODE_SYNC_PLUGIN_INSTALL completes (before first query)
  // and after non-sync background install finishes.
  // refreshActivePlugins calls clearAllCaches() which is required because
  // loadAllPlugins() may have run during main.tsx startup BEFORE managed
  // settings were fetched. Without clearing, getCommands() would rebuild
  // from a stale plugin list.
  async function refreshPluginState(): Promise<void> {
    // Preserve SDK/CLI-provided agents (--agents CLI flag or SDK initialize
    // control_request) across plugin reload (#398).
    const sdkAgents = streamCtx.currentAgents.filter(
      a => a.source === 'flagSettings',
    )
    // refreshActivePlugins handles the full cache sweep (clearAllCaches),
    // reloads all plugin component loaders, writes AppState.plugins +
    // AppState.agentDefinitions, registers hooks, and bumps mcp.pluginReconnectKey.
    const { agentDefinitions: freshAgentDefs } = await refreshActivePlugins(
      streamCtx.setAppState,
      { cliAgents: sdkAgents },
    )

    // Headless-specific: currentCommands/currentAgents are local mutable refs
    // captured by the query loop (REPL uses AppState instead). getCommands is
    // fresh because refreshActivePlugins cleared its cache.
    streamCtx.currentCommands = await getCommands(getCwd())
    streamCtx.currentAgents = freshAgentDefs.allAgents
  }

  // Re-diff MCP configs after plugin state changes. Filters to
  // process-transport-supported types and carries SDK-mode servers through
  // so applyMcpServerChanges' diff doesn't close their transports.
  // Nested: needs closure access to sdkMcpConfigs, applyMcpServerChanges,
  // updateSdkMcp.
  async function applyPluginMcpDiff(): Promise<void> {
    const { servers: newConfigs } = await getAllMcpConfigs()
    const supportedConfigs: Record<string, McpServerConfigForProcessTransport> =
      {}
    for (const [name, config] of Object.entries(newConfigs)) {
      if (isMcpServerDisabled(name)) continue
      const type = config.type
      if (
        type === undefined ||
        type === 'stdio' ||
        type === 'sse' ||
        type === 'http' ||
        type === 'sdk'
      ) {
        supportedConfigs[name] = config as McpServerConfigForProcessTransport
      }
    }
    for (const [name, config] of Object.entries(streamCtx.sdkMcpConfigs)) {
      if (config.type === 'sdk' && !(name in supportedConfigs)) {
        supportedConfigs[name] =
          config as unknown as McpServerConfigForProcessTransport
      }
    }
    const { response, sdkServersChanged } =
      await applyMcpServerChanges(supportedConfigs)
    if (sdkServersChanged) {
      void updateSdkMcp()
    }
    logForDebugging(
      `Headless MCP refresh: added=${response.added.length}, removed=${response.removed.length}`,
    )
  }

  // densable print aa/Wl — skill watcher → clear, reload, stream-json commands_changed
  const emitCommandsChanged = (commands: Command[]) => {
    // densable: if (!el || d.outputFormat !== "stream-json") return
    if (streamCtx.options.outputFormat !== 'stream-json') return
    // densable DVe: filter user-invocable, map name via userFacingName + aliases
    const serialized = commands
      .filter(cmd => cmd.userInvocable !== false)
      .map(cmd => {
        const face = getCommandName(cmd)
        const qualified =
          cmd.name !== face && cmd.name.includes(':') ? cmd.name : undefined
        const aliases =
          qualified && !cmd.aliases?.includes(qualified)
            ? [...(cmd.aliases ?? []), qualified]
            : cmd.aliases
        return {
          name: face,
          description: formatDescriptionWithSource(cmd),
          argumentHint: cmd.argumentHint || '',
          aliases: aliases?.length ? aliases : undefined,
        }
      })
    streamCtx.output.enqueue({
      type: 'system',
      subtype: 'commands_changed',
      commands: serialized,
      uuid: randomUUID(),
      session_id: getSessionId(),
    } as StdoutMessage)
  }

  // Subscribe to skill changes for hot reloading
  const unsubscribeSkillChanges = skillChangeDetector.subscribe(() => {
    clearCommandsCache()
    void getCommands(getCwd())
      .then(newCommands => {
        streamCtx.currentCommands = newCommands
        emitCommandsChanged(newCommands)
      })
      .catch(logError)
  })

  // Proactive mode: schedule a tick to keep the model looping autonomously.
  // setTimeout(0) yields to the event loop so pending stdin messages
  // (interrupts, user messages) are processed before the tick fires.
  const scheduleProactiveTick =
    feature('PROACTIVE') || feature('KAIROS')
      ? () => {
          setTimeout(() => {
            if (
              !proactiveModule?.isProactiveActive() ||
              proactiveModule.isProactivePaused() ||
              streamCtx.inputClosed
            ) {
              return
            }
            void (async () => {
              const commands = await createProactiveAutonomyCommands({
                basePrompt: `<${TICK_TAG}>${new Date().toLocaleTimeString()}</${TICK_TAG}>`,
                currentDir: getCwd(),
                shouldCreate: () => !streamCtx.inputClosed,
              })
              if (streamCtx.inputClosed) {
                await cancelQueuedAutonomyCommands({ commands })
                return
              }
              for (const command of commands) {
                enqueue({
                  ...command,
                  uuid: randomUUID(),
                })
              }
              void streamCtx.run()
            })().catch(error => {
              logError(error)
              logForDebugging(
                `[Proactive] failed to create headless tick: ${error}`,
                {
                  level: 'error',
                },
              )
            })
          }, 0)
        }
      : undefined

  streamCtx.injectModelSwitchBreadcrumbs = injectModelSwitchBreadcrumbs
  streamCtx.registerElicitationHandlers = registerElicitationHandlers
  streamCtx.updateSdkMcp = updateSdkMcp
  streamCtx.seedHeadlessMcpIdentity = seedHeadlessMcpIdentity
  streamCtx.attachHeadlessRemoteReconnect = attachHeadlessRemoteReconnect
  streamCtx.headlessMcpIdentityBoundary = headlessMcpIdentityBoundary
  streamCtx.withControlReconnect = withControlReconnect
  streamCtx.buildAllTools = buildAllTools
  streamCtx.drainPrintSdkEvents = drainPrintSdkEvents
  streamCtx.forwardMessagesToBridge = forwardMessagesToBridge
  streamCtx.applyMcpServerChanges = applyMcpServerChanges
  streamCtx.buildMcpServerStatuses = buildMcpServerStatuses
  streamCtx.refreshPluginState = refreshPluginState
  streamCtx.applyPluginMcpDiff = applyPluginMcpDiff
  streamCtx.unsubscribeSkillChanges = unsubscribeSkillChanges
  streamCtx.scheduleProactiveTick = scheduleProactiveTick
}
