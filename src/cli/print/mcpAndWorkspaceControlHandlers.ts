/**
 * Headless streaming MCP, plugin, settings, workspace, and extras control request handlers.
 */
import type {
  ControlRequestDispatchContext,
  HeadlessStreamingContext,
} from './streamingTypes.js'
import type {
  SDKControlRequest,
  SDKControlReloadPluginsResponse,
} from 'src/entrypoints/sdk/controlTypes.js'
import {
  raceWithTimeoutMs,
  resolveSyncPluginsInstallTimeoutMs,
} from 'src/utils/residualFinalEnvGates.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { feature } from 'bun:bundle'
import {
  getIsRemoteMode,
  getOriginalCwd,
  getRegisteredHooks,
  getAdditionalDirectoriesForClaudeMd,
  setAdditionalDirectoriesForClaudeMd,
  getMainThreadAgentId,
  getSessionId,
} from 'src/bootstrap/state.js'
import { redownloadUserSettings } from 'src/services/settingsSync/index.js'
import { settingsChangeDetector } from 'src/utils/settings/changeDetector.js'
import { refreshActivePlugins } from '../../utils/plugins/refresh.js'
import { getCommands } from '../../commands.js'
import { getCwd } from 'src/utils/cwd.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import { logError } from 'src/utils/log.js'
import { filterCloudSlashCommands } from './startupAndAccount.js'
import { getCommandName, formatDescriptionWithSource } from 'src/commands.js'
import { errorMessage } from '../../utils/errors.js'
import {
  createAbortErrorReason,
  createAbortController,
} from 'src/utils/abortController.js'
import {
  getMcpConfigByName,
  isMcpServerDisabled,
  setMcpServerEnabled,
} from 'src/services/mcp/config.js'
import { reconnectDisabledElsewhereResult } from 'src/services/mcp/mcpReconnectRemedy.js'
import {
  reconnectMcpServerImpl,
  clearServerCache,
} from 'src/services/mcp/client.js'
import { getMcpPrefix } from 'src/services/mcp/mcpStringUtils.js'
import reject from 'lodash-es/reject.js'
import { commandBelongsToServer } from 'src/services/mcp/utils.js'
import omit from 'lodash-es/omit.js'
import {
  reregisterChannelHandlerAfterReconnect,
  handleChannelEnable,
} from 'src/cli/headless/HeadlessControlPlane.js'
import { parseMcpPermissionModeOverride } from 'src/utils/permissions/mcpPermissionMode.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  isAutoModeGateEnabled,
  getAutoModeUnavailableReason,
  getAutoModeUnavailableNotification,
} from 'src/utils/permissions/permissionSetup.js'
import {
  resolveControlConnectionTrustLevel,
  redactSettingsResponseForRemote,
  dispatchPrintControlExtra,
} from 'src/cli/printControlExtras.js'
import { RemoteIO } from 'src/cli/remoteIO.js'
import {
  parseEffortValue,
  toPersistableEffort,
  EFFORT_LEVELS,
  effortModelSettingsPatch,
  pdSessionEffort,
  modelSupportsEffort,
  resolveAppliedEffort,
  isUltracodeModeActive,
  getSupportedEffortLevels,
  isUltracodeOfferable,
} from 'src/utils/effort.js'
import { getMainLoopModel } from 'src/utils/model/model.js'
import {
  updateSettingsForSource,
  getSettingsWithErrors,
  getSettingsWithSources,
} from 'src/utils/settings/settings.js'
import { applySettingsChange } from 'src/utils/settings/applySettingsChange.js'
import { resolveAppliedAdvisorModel } from 'src/utils/advisor.js'
import { applyPermissionUpdate } from 'src/utils/permissions/PermissionUpdate.js'
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js'
import { executeDirectoryAddedHooks } from 'src/utils/hooks.js'
import { enqueue, peek } from 'src/utils/messageQueueManager.js'
import { getRunningTasks } from '../../utils/task/framework.js'
import { stopTask } from '../../tasks/stopTask.js'
import { homedir } from 'os'
import { getLastCacheSafeParams } from 'src/utils/forkedAgent.js'
import { getBootstrapSession } from 'src/utils/sessionRoot.js'
import type { UUID } from 'crypto'
import stripAnsi from 'strip-ansi'

export async function handleMcpAndWorkspaceControlRequest(
  streamCtx: HeadlessStreamingContext,
  ctrlDispatch: ControlRequestDispatchContext,
): Promise<boolean> {
  const {
    msg,
    req,
    inFlightControlRequests,
    deferControlLifecycleUntilDone,
    completeControlLifecycleImmediately,
  } = ctrlDispatch
  if (msg.request.subtype === 'mcp_set_servers') {
    await streamCtx.controlPlane.handleMcpSetServersRequest(
      msg as SDKControlRequest & {
        request: {
          subtype: 'mcp_set_servers'
          servers: Record<string, unknown>
        }
      },
      {
        applyMcpServerChanges: streamCtx.applyMcpServerChanges,
        updateSdkMcp: streamCtx.updateSdkMcp,
        workSecretSession: streamCtx.workSecretSession,
        hearthMount: streamCtx.hearthMount,
      },
    )
  } else if (msg.request.subtype === 'reload_plugins') {
    try {
      // leftover 239 $1h — Uln.discardInflight + remint zXl raced with fun()
      const { isSyncedPluginSyncKickEnabled, remintFirstSyncedPluginSync } =
        await import('../../utils/plugins/syncedPluginCloudSync.js')
      if (isSyncedPluginSyncKickEnabled()) {
        await raceWithTimeoutMs(
          Promise.allSettled([remintFirstSyncedPluginSync()]),
          resolveSyncPluginsInstallTimeoutMs(),
        )
      }
      // Official REMOTE densable.
      let isRemoteReload = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
      try {
        const { isRemoteEnvEnabled } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
        isRemoteReload = isRemoteEnvEnabled()
      } catch {
        // keep raw env fallback
      }
      if (
        feature('DOWNLOAD_USER_SETTINGS') &&
        (isRemoteReload || getIsRemoteMode())
      ) {
        // Re-pull user settings so enabledPlugins pushed from the
        // user's local CLI take effect before the cache sweep.
        const applied = await redownloadUserSettings()
        if (applied) {
          settingsChangeDetector.notifyChange('userSettings')
        }
      }

      const r = await refreshActivePlugins(streamCtx.setAppState, {
        applyStagedInstalls: false,
      })

      const sdkAgents = streamCtx.currentAgents.filter(
        a => a.source === 'flagSettings',
      )
      streamCtx.currentAgents = [...r.agentDefinitions.allAgents, ...sdkAgents]

      // Reload succeeded — gather response data best-effort so a
      // read failure doesn't mask the successful state change.
      // allSettled so one failure doesn't discard the others.
      let plugins: SDKControlReloadPluginsResponse['plugins'] = []
      const [cmdsR, mcpR, pluginsR] = await Promise.allSettled([
        getCommands(getCwd()),
        streamCtx.applyPluginMcpDiff(),
        loadAllPluginsCacheOnly(),
      ])
      if (cmdsR.status === 'fulfilled') {
        streamCtx.currentCommands = cmdsR.value
      } else {
        logError(cmdsR.reason)
      }
      if (mcpR.status === 'rejected') {
        logError(mcpR.reason)
      }
      if (pluginsR.status === 'fulfilled') {
        plugins = pluginsR.value.enabled.map(p => ({
          name: p.name,
          path: p.path,
          source: p.source,
        }))
      } else {
        logError(pluginsR.reason)
      }

      streamCtx.sendControlResponseSuccess(msg, {
        commands: filterCloudSlashCommands(streamCtx.currentCommands).map(
          cmd => ({
            name: getCommandName(cmd),
            description: formatDescriptionWithSource(cmd),
            argumentHint: cmd.argumentHint || '',
          }),
        ),
        agents: streamCtx.currentAgents.map(a => ({
          name: a.agentType,
          description: a.whenToUse,
          model: a.model === 'inherit' ? undefined : a.model,
        })),
        plugins,
        mcpServers:
          streamCtx.buildMcpServerStatuses() as SDKControlReloadPluginsResponse['mcpServers'],
        error_count: r.error_count,
      } satisfies SDKControlReloadPluginsResponse)
    } catch (error) {
      streamCtx.sendControlResponseError(msg, errorMessage(error))
    }
  } else if (req.subtype === 'reload_skills') {
    // densable print @206564194
    try {
      const { getSkillDirCommands } = await import(
        'src/skills/loadSkillsDir.js'
      )
      getSkillDirCommands.cache?.clear?.()
      const reloaded = await getSkillDirCommands(getOriginalCwd())
      const names = new Set(reloaded.map(cmd => cmd.name))
      streamCtx.currentCommands = [
        ...streamCtx.currentCommands.filter(cmd => !names.has(cmd.name)),
        ...reloaded,
      ]
      streamCtx.sendControlResponseSuccess(msg, {
        commands: filterCloudSlashCommands(streamCtx.currentCommands).map(
          cmd => ({
            name: getCommandName(cmd),
            description: formatDescriptionWithSource(cmd),
            argumentHint: cmd.argumentHint || '',
          }),
        ),
      })
    } catch (err) {
      streamCtx.sendControlResponseError(msg, errorMessage(err))
    }
  } else if (req.subtype === 'mcp_call') {
    // densable print @206564468 — Ns-style: completed now, work continues.
    const {
      mcpCallToolMustBeString,
      mcpCallNotFullyQualified,
      mcpCallServerNotConnected,
      mcpCallStagedDisabled,
      mcpCallSdkUnsupported,
      parseMcpCallTool,
      isStagedMcpCall,
    } = await import('../printControlHosts.js')
    if (typeof req.tool !== 'string') {
      streamCtx.sendControlResponseError(msg, mcpCallToolMustBeString())
      return true
    }
    const parsedTool = parseMcpCallTool(req.tool)
    if (!parsedTool) {
      streamCtx.sendControlResponseError(
        msg,
        mcpCallNotFullyQualified(req.tool),
      )
      return true
    }
    inFlightControlRequests
      .get(msg.request_id)
      ?.abort(createAbortErrorReason('remote-cancel'))
    inFlightControlRequests.delete(msg.request_id)
    completeControlLifecycleImmediately(async () => {
      const reqAbort = createAbortController()
      inFlightControlRequests.set(msg.request_id, reqAbort)
      try {
        if (isStagedMcpCall(req)) {
          streamCtx.sendControlResponseError(msg, mcpCallStagedDisabled())
          return
        }
        const clients = [
          ...streamCtx.getAppState().mcp.clients,
          ...streamCtx.dynamicMcpState.clients,
        ]
        const client = clients.find(c => c.name === parsedTool.serverName)
        if (!client || client.type !== 'connected') {
          streamCtx.sendControlResponseError(
            msg,
            mcpCallServerNotConnected(parsedTool.serverName),
          )
          return
        }
        if (client.config.type === 'sdk') {
          streamCtx.sendControlResponseError(
            msg,
            mcpCallSdkUnsupported(parsedTool.serverName),
          )
          return
        }
        const { callMCPToolWithUrlElicitationRetry } = await import(
          'src/services/mcp/client.js'
        )
        const args =
          req.arguments !== null &&
          typeof req.arguments === 'object' &&
          !Array.isArray(req.arguments)
            ? (req.arguments as Record<string, unknown>)
            : {}
        const result = await callMCPToolWithUrlElicitationRetry({
          client,
          clientConnection: client,
          tool: parsedTool.toolName,
          args,
          signal: reqAbort.signal,
          setAppState: streamCtx.setAppState,
        })
        streamCtx.sendControlResponseSuccess(msg, {
          isError: result.isError === true,
          content: result.content,
          structuredContent: result.structuredContent,
          _meta: result._meta,
        })
      } catch (err) {
        streamCtx.sendControlResponseError(msg, errorMessage(err))
      } finally {
        if (inFlightControlRequests.get(msg.request_id) === reqAbort) {
          inFlightControlRequests.delete(msg.request_id)
        }
      }
    })
  } else if (msg.request.subtype === 'mcp_reconnect') {
    const currentAppState = streamCtx.getAppState()
    const { serverName } = msg.request
    streamCtx.elicitationRegistered.delete(serverName)
    // Config-existence gate must cover the SAME sources as the
    // operations below. SDK-injected servers (query({mcpServers:{...}}))
    // and dynamically-added servers were missing here, so
    // toggleMcpServer/reconnect returned "Server not found" even though
    // the disconnect/reconnect would have worked (gh-31339 / CC-314).
    const config =
      getMcpConfigByName(serverName) ??
      streamCtx.mcpClients.find(c => c.name === serverName)?.config ??
      streamCtx.sdkClients.find(c => c.name === serverName)?.config ??
      streamCtx.dynamicMcpState.clients.find(c => c.name === serverName)
        ?.config ??
      currentAppState.mcp.clients.find(c => c.name === serverName)?.config ??
      null
    const driftedClient = currentAppState.mcp.clients.find(
      c => c.name === serverName,
    )
    const driftedRemedy = reconnectDisabledElsewhereResult(
      driftedClient
        ? [
            {
              name: driftedClient.name,
              type: driftedClient.type,
              ...(driftedClient.type === 'failed' &&
              driftedClient.errorCode !== undefined
                ? { errorCode: driftedClient.errorCode }
                : {}),
            },
          ]
        : [],
      serverName,
      isMcpServerDisabled,
    )
    if (driftedRemedy !== null) {
      streamCtx.sendControlResponseError(msg, driftedRemedy)
    } else if (!config) {
      streamCtx.sendControlResponseError(msg, `Server not found: ${serverName}`)
    } else {
      const isSdkOwnedServer = Object.hasOwn(
        streamCtx.sdkMcpConfigs,
        serverName,
      )
      const result = await streamCtx.withControlReconnect(serverName, () =>
        reconnectMcpServerImpl(serverName, config),
      )
      if (isSdkOwnedServer) {
        streamCtx.sdkClients = streamCtx.sdkClients.map(c =>
          c.name === serverName ? result.client : c,
        )
        const prefix = getMcpPrefix(serverName)
        streamCtx.sdkTools = [
          ...reject(streamCtx.sdkTools, t => t.name?.startsWith(prefix)),
          ...result.tools,
        ]
      } else {
        // Update appState.mcp with the new client, tools, commands, and resources
        const prefix = getMcpPrefix(serverName)
        streamCtx.setAppState(prev => ({
          ...prev,
          mcp: {
            ...prev.mcp,
            clients: prev.mcp.clients.map(c =>
              c.name === serverName ? result.client : c,
            ),
            tools: [
              ...reject(prev.mcp.tools, t => t.name?.startsWith(prefix)),
              ...result.tools,
            ],
            commands: [
              ...reject(prev.mcp.commands, c =>
                commandBelongsToServer(c, serverName),
              ),
              ...result.commands,
            ],
            resources:
              result.resources && result.resources.length > 0
                ? {
                    ...prev.mcp.resources,
                    [serverName]: result.resources,
                  }
                : omit(prev.mcp.resources, serverName),
          },
        }))
        // Also update dynamicMcpState so run() picks up the new tools
        // on the next turn (run() reads dynamicMcpState, not appState)
        streamCtx.dynamicMcpState = {
          ...streamCtx.dynamicMcpState,
          clients: [
            ...streamCtx.dynamicMcpState.clients.filter(
              c => c.name !== serverName,
            ),
            result.client,
          ],
          tools: [
            ...streamCtx.dynamicMcpState.tools.filter(
              t => !t.name?.startsWith(prefix),
            ),
            ...result.tools,
          ],
        }
      }
      if (result.client.type === 'connected') {
        streamCtx.registerElicitationHandlers([result.client])
        reregisterChannelHandlerAfterReconnect(result.client)
        streamCtx.sendControlResponseSuccess(msg)
      } else {
        const errorMessage =
          result.client.type === 'failed'
            ? (result.client.error ?? 'Connection failed')
            : `Server status: ${result.client.type}`
        streamCtx.sendControlResponseError(msg, errorMessage)
      }
    }
  } else if (msg.request.subtype === 'mcp_toggle') {
    const currentAppState = streamCtx.getAppState()
    const { serverName, enabled } = msg.request
    streamCtx.elicitationRegistered.delete(serverName)
    // Gate must match the client-lookup spread below (which
    // includes sdkClients and dynamicMcpState.clients). Same fix as
    // mcp_reconnect above (gh-31339 / CC-314).
    const config =
      getMcpConfigByName(serverName) ??
      streamCtx.mcpClients.find(c => c.name === serverName)?.config ??
      streamCtx.sdkClients.find(c => c.name === serverName)?.config ??
      streamCtx.dynamicMcpState.clients.find(c => c.name === serverName)
        ?.config ??
      currentAppState.mcp.clients.find(c => c.name === serverName)?.config ??
      null

    if (!config) {
      streamCtx.sendControlResponseError(msg, `Server not found: ${serverName}`)
    } else if (!enabled) {
      // Disabling: persist + disconnect (matches TUI toggleMcpServer behavior)
      setMcpServerEnabled(serverName, false)
      const client = [
        ...streamCtx.mcpClients,
        ...streamCtx.sdkClients,
        ...streamCtx.dynamicMcpState.clients,
        ...currentAppState.mcp.clients,
      ].find(c => c.name === serverName)
      if (client && client.type === 'connected') {
        await clearServerCache(serverName, config)
      }
      // Update appState.mcp to reflect disabled status and remove tools/commands/resources
      const prefix = getMcpPrefix(serverName)
      streamCtx.setAppState(prev => ({
        ...prev,
        mcp: {
          ...prev.mcp,
          clients: prev.mcp.clients.map(c =>
            c.name === serverName
              ? { name: serverName, type: 'disabled' as const, config }
              : c,
          ),
          tools: reject(prev.mcp.tools, t => t.name?.startsWith(prefix)),
          commands: reject(prev.mcp.commands, c =>
            commandBelongsToServer(c, serverName),
          ),
          resources: omit(prev.mcp.resources, serverName),
        },
      }))
      streamCtx.sendControlResponseSuccess(msg)
    } else {
      // Enabling: persist + reconnect
      setMcpServerEnabled(serverName, true)
      const result = await streamCtx.withControlReconnect(serverName, () =>
        reconnectMcpServerImpl(serverName, config),
      )
      // Update appState.mcp with the new client, tools, commands, and resources
      // This ensures the LLM sees updated tools after enabling the server
      const prefix = getMcpPrefix(serverName)
      streamCtx.setAppState(prev => ({
        ...prev,
        mcp: {
          ...prev.mcp,
          clients: prev.mcp.clients.map(c =>
            c.name === serverName ? result.client : c,
          ),
          tools: [
            ...reject(prev.mcp.tools, t => t.name?.startsWith(prefix)),
            ...result.tools,
          ],
          commands: [
            ...reject(prev.mcp.commands, c =>
              commandBelongsToServer(c, serverName),
            ),
            ...result.commands,
          ],
          resources:
            result.resources && result.resources.length > 0
              ? {
                  ...prev.mcp.resources,
                  [serverName]: result.resources,
                }
              : omit(prev.mcp.resources, serverName),
        },
      }))
      if (result.client.type === 'connected') {
        streamCtx.registerElicitationHandlers([result.client])
        reregisterChannelHandlerAfterReconnect(result.client)
        streamCtx.sendControlResponseSuccess(msg)
      } else {
        const errorMessage =
          result.client.type === 'failed'
            ? (result.client.error ?? 'Connection failed')
            : `Server status: ${result.client.type}`
        streamCtx.sendControlResponseError(msg, errorMessage)
      }
    }
  } else if (req.subtype === 'set_mcp_permission_mode_override') {
    // Official 2.1.x: tighten-only per-server mode pin (WDu + snt).
    const serverName = req.serverName as string
    const mode = req.mode as string | null
    const parsed = parseMcpPermissionModeOverride(mode)
    if (!parsed.ok) {
      logForDebugging(
        `set_mcp_permission_mode_override: rejected mode='${parsed.rejected}' for ${serverName} (tighten-only)`,
        { level: 'warn' },
      )
      streamCtx.sendControlResponseError(
        msg,
        `Permission mode override over the control channel is tighten-only ('default', 'auto', or null); rejected '${parsed.rejected}'`,
      )
    } else if (parsed.override === 'auto' && !isAutoModeGateEnabled()) {
      const reason = getAutoModeUnavailableReason()
      streamCtx.sendControlResponseError(
        msg,
        reason
          ? `Cannot pin MCP server '${serverName}' to auto: ${getAutoModeUnavailableNotification(reason)}`
          : `Cannot pin MCP server '${serverName}' to auto`,
      )
    } else {
      const override = parsed.override
      streamCtx.setAppState(prev => {
        const current =
          prev.toolPermissionContext.mcpPermissionModeOverrides ?? {}
        const nextOverrides =
          override === undefined
            ? omit(current, serverName)
            : { ...current, [serverName]: override }
        return {
          ...prev,
          toolPermissionContext: {
            ...prev.toolPermissionContext,
            mcpPermissionModeOverrides: nextOverrides,
          },
        }
      })
      const currentAppState = streamCtx.getAppState()
      const known =
        streamCtx.mcpClients.some(c => c.name === serverName) ||
        streamCtx.sdkClients.some(c => c.name === serverName) ||
        streamCtx.dynamicMcpState.clients.some(c => c.name === serverName) ||
        currentAppState.mcp.clients.some(c => c.name === serverName) ||
        getMcpConfigByName(serverName) !== null
      streamCtx.sendControlResponseSuccess(
        msg,
        known
          ? undefined
          : {
              warning:
                override === undefined
                  ? `MCP server '${serverName}' is not known; no override was present to clear.`
                  : `MCP server '${serverName}' is not yet known; override stored but will not apply until a server with that exact name connects.`,
            },
      )
    }
  } else if (req.subtype === 'channel_enable') {
    const currentAppState = streamCtx.getAppState()
    handleChannelEnable(
      msg.request_id,
      req.serverName as string,
      // Pool spread matches mcp_status — all three client sources.
      [
        ...currentAppState.mcp.clients,
        ...streamCtx.sdkClients,
        ...streamCtx.dynamicMcpState.clients,
      ],
      streamCtx.output,
    )
  } else if (req.subtype === 'mcp_authenticate') {
    await streamCtx.controlPlane.handleMcpAuthenticate(msg, req, {
      mcpClients: streamCtx.mcpClients,
      withControlReconnect: streamCtx.withControlReconnect,
      onDynamicMcpStateUpdate: (serverName, client, tools) => {
        const prefix = getMcpPrefix(serverName)
        streamCtx.dynamicMcpState = {
          ...streamCtx.dynamicMcpState,
          clients: [
            ...streamCtx.dynamicMcpState.clients.filter(
              c => c.name !== serverName,
            ),
            client,
          ],
          tools: [
            ...streamCtx.dynamicMcpState.tools.filter(
              t => !t.name?.startsWith(prefix),
            ),
            ...tools,
          ],
        }
      },
    })
  } else if (req.subtype === 'mcp_oauth_callback_url') {
    await streamCtx.controlPlane.handleMcpOAuthCallbackUrl(msg, req)
  } else if (req.subtype === 'claude_authenticate') {
    await streamCtx.controlPlane.handleClaudeAuthenticate(msg, req, {
      headlessMcpIdentityBoundary: streamCtx.headlessMcpIdentityBoundary,
    })
  } else if (
    req.subtype === 'claude_oauth_callback' ||
    req.subtype === 'claude_oauth_wait_for_completion'
  ) {
    streamCtx.controlPlane.handleClaudeOAuthCallbackOrWait(msg, req)
  } else if (req.subtype === 'mcp_clear_auth') {
    await streamCtx.controlPlane.handleMcpClearAuth(msg, req, {
      mcpClients: streamCtx.mcpClients,
      withControlReconnect: streamCtx.withControlReconnect,
    })
  } else if (msg.request.subtype === 'apply_flag_settings') {
    streamCtx.controlPlane.handleApplyFlagSettings(
      msg as SDKControlRequest & {
        request: {
          subtype: 'apply_flag_settings'
          settings: Record<string, unknown>
        }
      },
      {
        setActiveUserSpecifiedModel: model => {
          streamCtx.activeUserSpecifiedModel = model
        },
        injectModelSwitchBreadcrumbs: streamCtx.injectModelSwitchBreadcrumbs,
      },
    )
  } else if (req.subtype === 'get_memory_dialog') {
    streamCtx.sendControlResponseError(
      msg,
      'get_memory_dialog is not available on this connection',
    )
  } else if (req.subtype === 'get_skills_dialog') {
    streamCtx.sendControlResponseError(
      msg,
      'get_skills_dialog is not available on this connection',
    )
  } else if (req.subtype === 'get_hooks_listing') {
    // Official 2.1.325 #2375: refuse `get_hooks_listing` on cloud /
    // self-hosted / remote control connections.
    const hooksTrustLevel = resolveControlConnectionTrustLevel({
      isRemoteTransport:
        streamCtx.structuredIO instanceof RemoteIO ||
        Boolean(streamCtx.bridgeHandle),
      isCloudHosted: isEnvTruthy(process.env.CLAUDE_CODE_REMOTE),
    })
    if (hooksTrustLevel !== 'full') {
      streamCtx.sendControlResponseError(
        msg,
        'get_hooks_listing is not available on this connection',
      )
      return true
    }
    const { listHooksForControl } = await import('../printControlHosts.js')
    streamCtx.sendControlResponseSuccess(
      msg,
      listHooksForControl(getRegisteredHooks()),
    )
  } else if (req.subtype === 'update_settings') {
    const { validateUpdateSettingsRequest, isSettingSourceEnabledForUpdate } =
      await import('../printControlHosts.js')
    const source = req.source
    const settings = req.settings
    const err = validateUpdateSettingsRequest(
      streamCtx.structuredIO instanceof RemoteIO,
      typeof source === 'string'
        ? isSettingSourceEnabledForUpdate(
            source as Parameters<typeof isSettingSourceEnabledForUpdate>[0],
          )
        : false,
      source,
      settings,
    )
    if (err) {
      streamCtx.sendControlResponseError(msg, err)
      return true
    }
    const bag = settings as Record<string, string>
    if (source === 'userSettings') {
      const parsedEffort = parseEffortValue(String(bag.effortLevel))
      const persistableEffort =
        parsedEffort !== undefined
          ? toPersistableEffort(parsedEffort)
          : undefined
      if (persistableEffort === undefined) {
        const persistableLevels = EFFORT_LEVELS.filter(
          l => toPersistableEffort(l) !== undefined,
        )
        streamCtx.sendControlResponseError(
          msg,
          `update_settings: effortLevel must be one of ${persistableLevels.join(', ')}`,
        )
        return true
      }
      const currentModel = getMainLoopModel()
      const patch =
        currentModel.length > 0
          ? effortModelSettingsPatch(currentModel, persistableEffort)
          : { effortLevel: persistableEffort }
      const result = updateSettingsForSource('userSettings', patch)
      if (result.error) {
        streamCtx.sendControlResponseError(msg, result.error.message)
      } else {
        applySettingsChange('userSettings', streamCtx.setAppState)
        streamCtx.sendControlResponseSuccess(msg, {})
      }
      return true
    }
    const result = updateSettingsForSource('localSettings', {
      outputStyle: bag.outputStyle,
    })
    if (result.error) {
      streamCtx.sendControlResponseError(msg, result.error.message)
    } else {
      applySettingsChange('localSettings', streamCtx.setAppState)
      streamCtx.sendControlResponseSuccess(msg, {})
    }
  } else if (msg.request.subtype === 'get_settings') {
    // Official 2.1.325 #2375: gate / redact `get_settings` over cloud
    // or self-hosted session connections by trust level.
    const settingsTrustLevel = resolveControlConnectionTrustLevel({
      isRemoteTransport:
        streamCtx.structuredIO instanceof RemoteIO ||
        Boolean(streamCtx.bridgeHandle),
      isCloudHosted: isEnvTruthy(process.env.CLAUDE_CODE_REMOTE),
    })
    if (settingsTrustLevel === 'refused') {
      streamCtx.sendControlResponseError(
        msg,
        'get_settings is not available on this connection',
      )
      return true
    }
    const currentAppState = streamCtx.getAppState()
    const model = getMainLoopModel()
    const sessionEffortValue = pdSessionEffort(currentAppState, model)
    // modelSupportsEffort gate matches claude.ts — applied.effort must
    // mirror what actually goes to the API, not just what's configured.
    const effort = modelSupportsEffort(model)
      ? resolveAppliedEffort(model, sessionEffortValue)
      : undefined
    // densable Dee / nZn on applied.
    const ultracode = isUltracodeModeActive(
      model,
      sessionEffortValue,
      currentAppState.ultracode,
    )
    const advisor =
      resolveAppliedAdvisorModel(currentAppState.advisorModel, model) ?? null
    // densable: non-warning validation errors only.
    const settingsErrors = getSettingsWithErrors()
      .errors.filter(e => e.mcpErrorMetadata?.severity !== 'warning')
      .map(e => ({
        file: e.file,
        path: String(e.path ?? ''),
        message: e.message,
      }))
    const rawSettingsPayload = {
      ...getSettingsWithSources(),
      ...(settingsErrors.length > 0 ? { errors: settingsErrors } : {}),
    }
    const settingsPayload =
      settingsTrustLevel === 'redacted'
        ? redactSettingsResponseForRemote(
            rawSettingsPayload as Parameters<
              typeof redactSettingsResponseForRemote
            >[0],
          )
        : rawSettingsPayload
    streamCtx.sendControlResponseSuccess(msg, {
      ...settingsPayload,
      applied: {
        model,
        // Numeric effort (ant-only) → null; SDK schema is string-level only.
        effort: typeof effort === 'string' ? effort : null,
        advisor,
        ultracode,
        // Fork extension: host slider capability surface (densable
        // applied does not include these; optional + backward-compat).
        effortLevels: getSupportedEffortLevels(model),
        ultracodeOfferable: isUltracodeOfferable(model),
      },
    })
  } else if (req.subtype === 'get_workspace_diff') {
    // densable print `buildWorkspaceDiffResponse` after ui_client_fault.
    deferControlLifecycleUntilDone(async () => {
      try {
        const { buildWorkspaceDiffResponse } = await import(
          'src/bridge/buildWorkspaceDiffResponse.js'
        )
        const host = streamCtx.getAppState()
        streamCtx.sendControlResponseSuccess(
          msg,
          await buildWorkspaceDiffResponse(host, host.toolPermissionContext),
        )
      } catch (err) {
        streamCtx.sendControlResponseError(msg, errorMessage(err))
      }
    })
  } else if (req.subtype === 'stage_file') {
    // densable print `stageFile` @206558753 (gold Xcs).
    deferControlLifecycleUntilDone(async () => {
      try {
        const {
          stageFile,
          stageFileWireResult,
          STAGE_FILE_OUTPUTS_MOUNT_PREFIX,
        } = await import('src/utils/stageFile.js')
        const mountPath =
          typeof req.mount_path === 'string' ? req.mount_path : ''
        if (mountPath.startsWith(`${STAGE_FILE_OUTPUTS_MOUNT_PREFIX}/`)) {
          // Gold `Uy` effort-attribution probe; CLI analog is a no-op.
        }
        const result = await stageFile(
          {
            mount_path: mountPath,
            force: req.force === true,
            ...(typeof req.filestore_path === 'string' && {
              filestore_path: req.filestore_path,
            }),
          },
          undefined,
          'off',
        )
        if (result.ok) {
          streamCtx.sendControlResponseSuccess(msg, stageFileWireResult(result))
        } else {
          logForDebugging(`stage_file: ${result.error}`, {
            level: 'error',
          })
          streamCtx.sendControlResponseError(
            msg,
            result.error || 'stage_file failed',
          )
        }
      } catch (err) {
        streamCtx.sendControlResponseError(msg, errorMessage(err))
      }
    })
  } else if (req.subtype === 'get_plan') {
    try {
      const { getPlan, getPlanFilePath } = await import('src/utils/plans.js')
      const content = getPlan()
      streamCtx.sendControlResponseSuccess(
        msg,
        content !== null
          ? { exists: true, content, path: getPlanFilePath() }
          : { exists: false },
      )
    } catch (err) {
      streamCtx.sendControlResponseError(msg, errorMessage(err))
    }
  } else if (req.subtype === 'add_directory') {
    // densable `Xb` @206521996 — stage mount_path then add dest.
    deferControlLifecycleUntilDone(async () => {
      try {
        const { stageFile, addDirectoryDestFromMountPath } = await import(
          'src/utils/stageFile.js'
        )
        const { isAdditionalDirectoriesClaudeMdEnabled } = await import(
          'src/utils/residualFinalEnvGates.js'
        )
        const mountPath =
          typeof req.mount_path === 'string' ? req.mount_path : ''
        let dest: string
        try {
          dest = addDirectoryDestFromMountPath(mountPath)
        } catch (err) {
          logForDebugging(`add_directory dest: ${errorMessage(err)}`, {
            level: 'error',
          })
          streamCtx.sendControlResponseError(
            msg,
            errorMessage(err) || 'add_directory failed',
          )
          return
        }
        if (!isAdditionalDirectoriesClaudeMdEnabled()) {
          streamCtx.sendControlResponseError(
            msg,
            'add_directory requires CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD to be set in the container environment',
          )
          return
        }
        const staged = await stageFile({
          mount_path: mountPath,
          force: true,
        })
        if (!staged.ok) {
          logForDebugging(`add_directory stage: ${staged.error}`, {
            level: 'error',
          })
          streamCtx.sendControlResponseError(
            msg,
            staged.error || 'add_directory failed',
          )
          return
        }
        const { realpath } = await import('fs/promises')
        const directory = await realpath(dest).catch(() => dest)
        const currentDirs = getAdditionalDirectoriesForClaudeMd()
        if (!currentDirs.includes(directory)) {
          setAdditionalDirectoriesForClaudeMd([...currentDirs, directory])
        }
        streamCtx.setAppState(prev => ({
          ...prev,
          toolPermissionContext: applyPermissionUpdate(
            prev.toolPermissionContext,
            {
              type: 'addDirectories',
              directories: [directory],
              destination: 'session',
            },
          ),
        }))
        SandboxManager.refreshConfig()
        // DirectoryAdded source stays the SDK twin (gold print
        // `pT(...,"directory_added")` is not this string union).
        await executeDirectoryAddedHooks(directory, 'register_repo_root')
        streamCtx.ccrFolderRestorer.attached(mountPath)
        logForDebugging(`add_directory staged: ${dest} (${directory})`)
        streamCtx.sendControlResponseSuccess(msg, {
          staged_path: dest,
          directory,
        })
      } catch (err) {
        streamCtx.sendControlResponseError(msg, errorMessage(err))
      }
    })
  } else if (
    typeof req.subtype === 'string' &&
    dispatchPrintControlExtra(req.subtype, req, {
      getMcpClients: () =>
        (streamCtx.getAppState().mcp.clients as Array<{
          name: string
          type: string
        }>) ?? [],
      getPermissionContext: () => streamCtx.getAppState().toolPermissionContext,
      setPromptSuggestionEnabled: enabled => {
        streamCtx.setAppState(prev => ({
          ...prev,
          promptSuggestionEnabled: enabled,
        }))
      },
      sendSuccess: response =>
        streamCtx.sendControlResponseSuccess(msg, response),
      sendError: error => streamCtx.sendControlResponseError(msg, error),
      defer: deferControlLifecycleUntilDone,
      isRemoteTransport:
        streamCtx.structuredIO instanceof RemoteIO ||
        Boolean(streamCtx.bridgeHandle),
      errorMessage,
      abortSignal: streamCtx.abortController?.signal,
      setAppState: streamCtx.setAppState as never,
      exportConversation: async () => {
        const { renderMessagesToPlainText } = await import(
          'src/utils/exportRenderer.js'
        )
        const text = await renderMessagesToPlainText(
          streamCtx.mutableMessages,
          streamCtx.tools,
        )
        return { text }
      },
      getChromeClient: () => {
        const found = streamCtx
          .getAppState()
          .mcp.clients.find(
            client =>
              client.name === 'claude-in-chrome' && client.type === 'connected',
          )
        if (!found) return undefined
        return found as {
          name: string
          type: string
          config: { type: string }
        }
      },
      enqueuePollEvent: command => {
        enqueue({
          ...command,
          uuid: command.uuid as never,
        })
      },
      enqueueHandoff: command => {
        enqueue({
          mode: command.mode,
          value: command.value,
          isMeta: command.isMeta,
          agentId: command.agentId ?? getMainThreadAgentId(),
          handedOffTurn: command.handedOffTurn,
        })
      },
      peekHandoff: () => peek(cmd => cmd.handedOffTurn !== undefined),
      convertHandoff: handedOffTurn => {
        const pending = peek(cmd => cmd.handedOffTurn !== undefined)
        if (pending?.handedOffTurn) {
          pending.handedOffTurn = {
            ...pending.handedOffTurn,
            ...handedOffTurn,
          }
        }
      },
      peekRunningHandoff: () =>
        streamCtx.drainingHandoff
          ? {
              handedOffTurn: streamCtx.drainingHandoff.handedOffTurn,
              messages: streamCtx.drainingHandoff.handedOffTurn?.messages,
            }
          : undefined,
      stopRunningHandoff: () => {
        if (
          streamCtx.abortController &&
          !streamCtx.abortController.signal.aborted
        ) {
          streamCtx.abortController.abort(
            createAbortErrorReason('remote-cancel'),
          )
        }
        for (const t of getRunningTasks(streamCtx.getAppState())) {
          if (t.status === 'running' && t.type !== 'in_process_teammate') {
            void stopTask(t.id, {
              getAppState: streamCtx.getAppState,
              setAppState: streamCtx.setAppState,
              source: 'user',
              killedBy: 'system',
            })
          }
        }
      },
      getMainThreadAgentId,
      recoveredToolUseIds: () => streamCtx.recoveredToolUseIds,
      knownTools: streamCtx.tools.map(tool => tool.name),
      carriedWrites: () => {
        const mode = streamCtx.getAppState().toolPermissionContext.mode
        return {
          switchedOn: true,
          cwd: getCwd(),
          home: homedir(),
          permissionMode: mode,
          writeTool: true,
        }
      },
      getSdkUrl: () => streamCtx.options.sdkUrl,
      getMessages: () => streamCtx.mutableMessages,
      isCloudHosted: () =>
        process.env.CLAUDE_CODE_ENVIRONMENT_KIND !== undefined ||
        isEnvTruthy(process.env.CLAUDE_CODE_REMOTE),
      createForkSession: async input => {
        const { createBridgeSession } = await import(
          'src/bridge/createSession.js'
        )
        const { detectCurrentRepositoryWithHost } = await import(
          'src/utils/detectRepository.js'
        )
        const { getBranch, getDefaultBranch } = await import('src/utils/git.js')
        const repo = await detectCurrentRepositoryWithHost()
        const gitRepoUrl = repo
          ? `https://${repo.host}/${repo.owner}/${repo.name}`
          : null
        const branch =
          (await getBranch()) || (await getDefaultBranch()) || 'main'
        const environmentId =
          streamCtx.bridgeHandle?.environmentId ??
          process.env.CLAUDE_CODE_ENVIRONMENT_ID
        if (!environmentId) {
          throw new Error('unsupported')
        }
        const sessionId = await createBridgeSession({
          environmentId,
          title: input.title,
          events: [],
          gitRepoUrl,
          branch,
          signal:
            streamCtx.abortController?.signal ?? new AbortController().signal,
          baseUrl: input.sdkUrl,
        })
        if (!sessionId) {
          throw new Error('unsupported')
        }
        return sessionId
      },
      // densable VLe → LFn analog: snapshot ToolUseContext, else print
      // locals so first-turn proceed can still call launchRemoteReview.
      getToolUseContext: () => {
        const saved = getLastCacheSafeParams()?.toolUseContext
        if (saved) {
          return saved
        }
        return {
          getAppState: streamCtx.getAppState,
          taskRegistry: streamCtx.sessionTaskRegistry,
          session: getBootstrapSession(),
          setAppState: streamCtx.setAppState,
          abortController:
            streamCtx.abortController &&
            !streamCtx.abortController.signal.aborted
              ? streamCtx.abortController
              : createAbortController(),
          options: { tools: streamCtx.buildAllTools(streamCtx.getAppState()) },
          toolState: streamCtx.sessionToolState,
        }
      },
    })
  ) {
    // densable extras; rewind_conversation / mcp_call / dialogs /
    // update_settings / reload_skills stay owned elsewhere.
  } else if (req.subtype === 'rename_session') {
    const title =
      typeof (req as { title?: unknown }).title === 'string'
        ? (req as { title: string }).title
        : ''
    if (!title.trim()) {
      streamCtx.sendControlResponseError(msg, 'title is required')
    } else {
      try {
        const { saveCustomTitle } = await import('src/utils/sessionStorage.js')
        const source =
          (req as { source?: unknown }).source === 'host' ? 'user' : 'remote'
        await saveCustomTitle(
          getSessionId() as import('crypto').UUID,
          title,
          undefined,
          source,
        )
        streamCtx.sendControlResponseSuccess(msg, { title })
      } catch (err) {
        streamCtx.sendControlResponseError(msg, errorMessage(err))
      }
    }
  } else if (req.subtype === 'get_session_cost') {
    const { formatTotalCost } = await import('src/cost-tracker.js')
    streamCtx.sendControlResponseSuccess(msg, {
      text: stripAnsi(formatTotalCost()),
    })
  } else if (req.subtype === 'list_models') {
    try {
      const { getModelOptions } = await import(
        'src/utils/model/modelOptions.js'
      )
      streamCtx.sendControlResponseSuccess(msg, {
        models: getModelOptions().map(option => ({
          value: option.value,
          label: option.label,
          description: option.description,
        })),
      })
    } catch (err) {
      streamCtx.sendControlResponseError(msg, errorMessage(err))
    }
  } else if (req.subtype === 'get_usage') {
    const { formatTotalCost } = await import('src/cost-tracker.js')
    streamCtx.sendControlResponseSuccess(msg, { text: formatTotalCost() })
  } else if (req.subtype === 'get_binary_version') {
    streamCtx.sendControlResponseSuccess(msg, { version: MACRO.VERSION })
  } else if (req.subtype === 'get_task_output') {
    const taskId =
      typeof (req as { task_id?: unknown }).task_id === 'string'
        ? (req as { task_id: string }).task_id
        : ''
    if (!taskId) {
      streamCtx.sendControlResponseError(msg, 'task_id is required')
    } else {
      try {
        const { getTaskOutput } = await import('src/utils/task/diskOutput.js')
        const maxBytes =
          typeof (req as { max_bytes?: unknown }).max_bytes === 'number'
            ? (req as { max_bytes: number }).max_bytes
            : undefined
        const output = await getTaskOutput(taskId, maxBytes)
        streamCtx.sendControlResponseSuccess(msg, { output })
      } catch (err) {
        streamCtx.sendControlResponseError(msg, errorMessage(err))
      }
    }
  } else if (req.subtype === 'reload_output_styles') {
    try {
      const { clearAllOutputStylesCache, getAllOutputStyles } = await import(
        'src/constants/outputStyles.js'
      )
      clearAllOutputStylesCache()
      const styles = await getAllOutputStyles(getCwd())
      streamCtx.sendControlResponseSuccess(msg, {
        available_output_styles: Object.keys(styles),
      })
    } catch (err) {
      streamCtx.sendControlResponseError(msg, errorMessage(err))
    }
  } else if (req.subtype === 'file_suggestions') {
    try {
      const query =
        typeof (req as { query?: unknown }).query === 'string'
          ? (req as { query: string }).query
          : ''
      const { generateFileSuggestions } = await import(
        'src/hooks/fileSuggestions.js'
      )
      const items = await generateFileSuggestions(query, true)
      streamCtx.sendControlResponseSuccess(msg, {
        suggestions: items.map(item => ({ path: item.displayText })),
        cwd: getCwd(),
      })
    } catch (err) {
      streamCtx.sendControlResponseError(msg, errorMessage(err))
    }
  } else {
    return false
  }
  return true
}
