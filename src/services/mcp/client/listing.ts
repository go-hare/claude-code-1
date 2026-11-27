import { feature } from 'bun:bundle'
import type { Tool as McpWireTool } from '@modelcontextprotocol/client'
import { isChromeBrowserMcpToolBlockedByOrgPolicy } from '../../../utils/claudeInChrome/chromeMcpReadOnly.js'
import type {
  CachedMCPServer,
  ConnectedMCPServer,
  MCPServerConnection,
  ServerResource,
} from '../types.js'
import {
  isMcpDiscoveryCacheEnabled,
  recordDiscoveryFetchErrorForResult,
  recordRawCommandsForResult,
  recordRawResourcesForResult,
  recordRawToolsForResult,
  type CachedMcpPromptEntry,
} from '../discoveryCache.js'
import { readClientProtocolEra } from '../channelPermissions.js'
import {
  listMcpCursorPages,
  listMcpToolsAggregated,
} from '../listPagination.js'
import zipObject from 'lodash-es/zipObject.js'
import type { Command } from '../../../commands.js'
import type { Tool, ToolCallProgress } from '../../../Tool.js'
import {
  type MCPProgress,
  MCPTool,
} from '@claude-code/builtin-tools/tools/MCPTool/MCPTool.js'
import { logForDebugging } from '../../../utils/debug.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import {
  errorMessage,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../../utils/errors.js'
import { logMCPDebug, logMCPError } from '../../../utils/log.js'
import {
  isFixedUrlOfficialMarketplacePluginMcp,
  markMcpServerLoggable,
} from '../../../utils/mcpUsageAttribution.js'
import { mcpInfoSource } from '../../../utils/plugins/toolDescribe.js'
import {
  getBootstrapSession,
  runWithSession,
} from '../../../utils/sessionRoot.js'
import { isCliOwnedConfig } from '../cliOwnedConfigs.js'
import {
  isAccountMemoryServerTool,
  isAccountMemoryTool,
} from '../accountMemoryMcp.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../analytics/index.js'
import {
  applyConnectorDesignMembership,
  connectorDesignOmitsPersistentAllow,
  connectorDesignTokenlessWriteDeny,
  isFirstPartyDesignMcpServer,
} from '../connectorDesign.js'
import {
  isMcpRequiresUserInteraction,
  mcpToolCheckPermissionsResult,
} from '../mcpToolInteraction.js'
import { buildMcpToolName } from '../mcpStringUtils.js'
import {
  coerceMcpToolInputForSchema,
  type DroppedMcpToolRecord,
  filterListedMcpToolsBySchema,
} from '../mcpToolSchema.js'
import { wrapDocsConnectorToolForTerminalAutoOpen } from '../docsConnectorAutoOpen.js'
import { normalizeNameForMCP } from '../normalization.js'
import { recursivelySanitizeUnicode } from '@claude-code/mcp-client'
import { classifyMcpToolForCollapse } from '@claude-code/builtin-tools/tools/MCPTool/classifyForCollapse.js'
import { serverHasStoredRefreshToken } from '../auth.js'
import {
  classifyAuthReconnectKind,
  hasAuthReconnectInFlight,
  isConnectionClosedWhileReconnecting,
  joinOrStartAuthReconnect,
} from '../authReconnect.js'
import { headersHaveAuthorization } from '../connectAuthClassify.js'
import {
  extractToolUseId,
  filterMcpToolsByNameLength,
  getMaxMcpDescriptionLengthForConfig,
  isClaudeAiProxyListAuthError,
  MAX_MCP_TOOL_NAME_LENGTH,
  mcpToolInputToAutoClassifierInput,
  throwIfMcpToolCallInterrupted,
  transformResultContent,
} from '../clientHelpers.js'
import {
  getServerCacheKey,
  isClaudeAiBearerRejectedError,
  isIncludedMcpTool,
  McpAuthError,
  McpSessionExpiredError,
} from '../connectionHelpers.js'
import { isClaudeInChromeMCPServer } from '../../../utils/claudeInChrome/common.js'
import {
  isChromeFileUploadToolName,
  prepareChromeFileUploadInput,
} from '../../../utils/claudeInChrome/fileUpload.js'
import { join } from 'path'
import {
  type McpToolInfoWithKeys,
  composeMcpTool,
  computeMcpDenyKey,
  computeMcpStandardKey,
  isComputerUseMCPServer,
  nextDroppedToolsSeq,
} from './errorsAndKeys.js'
import {
  clearServerCache,
  connectToServer,
  ensureConnectedClient,
  fetchToolsForClient,
  getHostMcpClientState,
  onMcpServerConnected,
  peekSettledConnection,
  swapMcpServerTools,
} from './hostState.js'
import { callMCPToolWithUrlElicitationRetry } from './callTool.js'

// Lazy: toolRendering.tsx pulls React/ink; only needed when Claude-in-Chrome MCP server is connected
/* eslint-disable @typescript-eslint/no-require-imports */
const claudeInChromeToolRendering =
  (): typeof import('../../../utils/claudeInChrome/toolRendering.js') =>
    require('../../../utils/claudeInChrome/toolRendering.js')

// Lazy: wrapper.tsx → hostAdapter.ts → executor.ts pulls both native modules
// (@ant/computer-use-input + @ant/computer-use-swift). Runtime-gated by
// GrowthBook tengu_malort_pedway (see gates.ts).
const computerUseWrapper = feature('CHICAGO_MCP')
  ? (): typeof import('../../../utils/computerUse/wrapper.js') =>
      require('../../../utils/computerUse/wrapper.js')
  : undefined

/**
 * Compose Claude Code `Tool` wrappers from raw MCP wire tool entries for either
 * a live `ConnectedMCPServer` or a discovery-cache-hydrated `CachedMCPServer`.
 * Matches official 2.1.331 `Pu`.
 */
export function composeMcpToolsFromRawListing(
  client: ConnectedMCPServer | CachedMCPServer,
  validListedTools: McpWireTool[],
): Tool[] {
  // Sanitize tool data from MCP server
  const toolsToProcess = recursivelySanitizeUnicode(validListedTools)

  // Check if we should skip the mcp__ prefix for SDK MCP servers
  const skipPrefix =
    client.config.type === 'sdk' &&
    isEnvTruthy(process.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX)

  // Official: org ceiling map on remote MCP configs (claudeai-proxy/http/sse).
  const toolPermissions =
    client.config.type === 'claudeai-proxy' ||
    client.config.type === 'http' ||
    client.config.type === 'sse'
      ? client.config.toolPermissions
      : undefined
  if (toolPermissions) {
    const entries = Object.keys(toolPermissions).length
    if (
      entries > 0 &&
      // hasOwn: avoid prototype hits for tool names like `constructor`
      !toolsToProcess.some(t => Object.hasOwn(toolPermissions, t.name))
    ) {
      logForDebugging(
        `[claudeai-mcp] ${client.name}: toolPermissions has ${entries} entries but none matched upstream tool names — backend name drift?`,
        { level: 'warn' },
      )
    }
  }

  // densable vxi/wxi after toolPermissions warn — flatten or skip
  // #2151: Collect omitted tools + reasons and publish onto client.droppedTools.
  const droppedSeq = nextDroppedToolsSeq(client)
  const droppedRaw: DroppedMcpToolRecord[] = []
  const toolsWithValidNames = toolsToProcess.filter(tool => {
    if (tool.name.trim().length === 0) {
      droppedRaw.push({
        toolName: tool.name || '(empty)',
        reason: 'tool name is empty',
      })
      return false
    }
    return true
  })
  const listedAfterSchema = filterListedMcpToolsBySchema(toolsWithValidNames, {
    serverName: client.name,
    config: client.config,
    onDroppedTool: entry => droppedRaw.push(entry),
  })

  // densable jo — sse/http Design MCP on api.anthropic.com, no Authorization.
  const isFirstPartyDesignServer = isFirstPartyDesignMcpServer(client.config)
  // densable oe @214518400 — server-wide accountMemoryServer stamp via SZe.
  const serverRefForMemory = { name: client.name, config: client.config }
  const accountMemoryServer =
    toolsToProcess.some(t =>
      isAccountMemoryServerTool(serverRefForMemory, t.name),
    ) ||
    listedAfterSchema.some(t =>
      isAccountMemoryServerTool(serverRefForMemory, t.name),
    )

  // Official 325 #1949: host-provided Claude in Chrome / Browser / Preview /
  // remote-devices MCP tools follow the organization's `allow_claude_browser_extension` policy.
  const listedAfterBrowserPolicy = listedAfterSchema.filter(tool => {
    const fq = buildMcpToolName(client.name, tool.name)
    if (isChromeBrowserMcpToolBlockedByOrgPolicy(fq)) {
      logForDebugging(
        `[mcp] ${client.name}: hiding ${fq} — disallowed by organization allow_claude_browser_extension policy`,
      )
      return false
    }
    return true
  })

  // Official 2.1.328 (chunk@335138039.js@219009 / @222896): detect tools
  // on the same server whose normalized fully-qualified names collide so
  // allow-rules cannot be spoofed across colliding tool names.
  const normalizedFqCounts = new Map<string, number>()
  for (const listed of listedAfterBrowserPolicy) {
    const fq = buildMcpToolName(client.name, listed.name)
    normalizedFqCounts.set(fq, (normalizedFqCounts.get(fq) ?? 0) + 1)
  }
  const serverStandardKey = computeMcpStandardKey(client.name, client.config)
  const serverDenyKey = computeMcpDenyKey(client.config)

  // Convert MCP tools to our Tool format
  const composedTools = listedAfterBrowserPolicy
    .map((tool): Tool => {
      const fullyQualifiedName = buildMcpToolName(client.name, tool.name)
      const requiresUserInteraction = isMcpRequiresUserInteraction(tool._meta)
      const toolNameShared =
        (normalizedFqCounts.get(fullyQualifiedName) ?? 0) > 1
      const mcpInfo: McpToolInfoWithKeys = {
        serverName: client.name,
        toolName: tool.name,
        scope: client.config.scope,
        source: mcpInfoSource(client.name, client.config),
        // Official org/admin ceiling from server config toolPermissions.
        // hasOwn: plain maps + prototype-key tool names must not leak
        // Object.prototype.constructor (Function) as a permission value.
        effectiveMaxPermission:
          toolPermissions && Object.hasOwn(toolPermissions, tool.name)
            ? toolPermissions[tool.name]
            : undefined,
        // densable Dn — cliOwned / accountMemory (X2e) / accountMemoryServer (oe) stamps.
        ...(isCliOwnedConfig(client.config) ? { cliOwned: true } : {}),
        ...(isAccountMemoryTool(serverRefForMemory, tool.name)
          ? { accountMemory: true }
          : {}),
        ...(accountMemoryServer ? { accountMemoryServer: true } : {}),
      }
      const {
        create: _mcpCreate,
        validateInput: _mcpValidateInput,
        permissionCheckFailureDecision: _mcpPermFail,
        deriveObservableInput: _mcpDeriveObs,
        ...mcpToolTemplate
      } = MCPTool
      const chromeToolOverrides =
        isClaudeInChromeMCPServer(client.name) &&
        (client.config.type === 'stdio' || !client.config.type)
          ? claudeInChromeToolRendering().getClaudeInChromeMCPToolOverrides(
              tool.name,
            )
          : undefined
      const baseTool: Tool = {
        ...mcpToolTemplate,
        // In skip-prefix mode, use the original name for model invocation so MCP tools
        // can override builtins by name. mcpInfo is used for permission checking.
        name: skipPrefix ? tool.name : fullyQualifiedName,
        mcpInfo,
        isMcp: true,
        // Collapse whitespace: _meta is open to external MCP servers, and
        // a newline here would inject orphan lines into the deferred-tool
        // list (formatDeferredToolLine joins on '\n').
        searchHint:
          typeof tool._meta?.['anthropic/searchHint'] === 'string'
            ? tool._meta['anthropic/searchHint'].replace(/\s+/g, ' ').trim() ||
              undefined
            : undefined,
        alwaysLoad: tool._meta?.['anthropic/alwaysLoad'] === true,
        async description() {
          return tool.description ?? ''
        },
        async prompt(
          options?: Parameters<Tool['prompt']>[0] & {
            loadedThroughToolSearch?: boolean
          },
        ) {
          const desc = tool.description ?? ''
          const cap = getMaxMcpDescriptionLengthForConfig(
            client.config,
            options?.loadedThroughToolSearch === true,
          )
          return desc.length > cap ? desc.slice(0, cap) + '… [truncated]' : desc
        },
        isConcurrencySafe() {
          return tool.annotations?.readOnlyHint ?? false
        },
        isReadOnly() {
          return tool.annotations?.readOnlyHint ?? false
        },
        toAutoClassifierInput(input) {
          return mcpToolInputToAutoClassifierInput(input, tool.name)
        },
        isDestructive() {
          return tool.annotations?.destructiveHint ?? false
        },
        isOpenWorld() {
          return tool.annotations?.openWorldHint ?? false
        },
        isSearchOrReadCommand() {
          return classifyMcpToolForCollapse(client.name, tool.name)
        },
        requiresUserInteraction() {
          return requiresUserInteraction
        },
        suppressesAlwaysAllowRule: () =>
          requiresUserInteraction ||
          connectorDesignOmitsPersistentAllow(
            isFirstPartyDesignServer,
            tool.name,
          ),
        inputJSONSchema: tool.inputSchema as Tool['inputJSONSchema'],
        async checkPermissions(input: unknown) {
          // densable Gr/Ui — tokenless writes are native-tool-only here.
          const denied = connectorDesignTokenlessWriteDeny(
            isFirstPartyDesignServer,
            tool.name,
            input,
          )
          if (denied) return denied
          return mcpToolCheckPermissionsResult(
            requiresUserInteraction,
            fullyQualifiedName,
            client.name,
            connectorDesignOmitsPersistentAllow(
              isFirstPartyDesignServer,
              tool.name,
            ),
          )
        },
        async call(
          args: Record<string, unknown>,
          context,
          _canUseTool,
          parentMessage,
          onProgress?: ToolCallProgress<MCPProgress>,
        ) {
          // densable Vr/Fi — one local path for both gold connector copies.
          applyConnectorDesignMembership(
            isFirstPartyDesignServer,
            tool.name,
            args,
            (operation, projectId) => {
              // Lazy: designProjectGrant pulls function-hook modules.
              // A static import here would load that graph for every MCP client.
              const { designSessionState, noteDesignProjectMembershipChange } =
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('../../designProjectGrant.js') as typeof import('../../designProjectGrant.js')
              noteDesignProjectMembershipChange(
                designSessionState(context),
                operation,
                projectId,
              )
            },
          )
          // densable 2.1.222 #6 — stamp active MCP for next API cost share
          // (cleared after one attributed main/subagent request).
          context.options.activeMcpServer = client.name
          context.options.activeMcpTool = tool.name
          if (isFixedUrlOfficialMarketplacePluginMcp(client.config)) {
            markMcpServerLoggable(client.name)
          }

          // Official 2.1.328 (@335374540): prefer context.toolUseId (set by
          // Code Mode inner calls and sub-dispatches) before falling back to
          // scanning parentMessage for the first tool_use block.
          const toolUseId = context.toolUseId ?? extractToolUseId(parentMessage)
          const meta = toolUseId ? { 'claudecode/toolUseId': toolUseId } : {}

          // Emit progress when tool starts
          if (onProgress && toolUseId) {
            onProgress({
              toolUseID: toolUseId,
              data: {
                type: 'mcp_progress',
                status: 'started',
                serverName: client.name,
                toolName: tool.name,
              },
            })
          }

          const startTime = Date.now()
          // densable Biy: Host-side file_upload path policy (Uiy/Ned) with live
          // ToolPermissionContext before forwarding to Claude in Chrome MCP.
          // Official 2.1.326 #82: Coerce numeric text args (e.g. "42") to
          // numbers when a merged anyOf/oneOf branch accepts a number.
          let callArgs = coerceMcpToolInputForSchema(args, tool.inputSchema)
          if (
            isClaudeInChromeMCPServer(client.name) &&
            isChromeFileUploadToolName(tool.name)
          ) {
            const permCtx = context.getAppState().toolPermissionContext
            const prepared = await prepareChromeFileUploadInput(
              tool.name,
              args,
              permCtx,
            )
            if ('error' in prepared) {
              throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
                prepared.error,
                'chrome file_upload path rejected',
              )
            }
            callArgs = prepared.input
          }
          const MAX_SESSION_RETRIES = 1
          // Official 2.1.193/206: headersHelper may mint short-lived auth
          // headers; OAuth may hold a refresh_token. On 401 re-run the
          // helper / refresh once, then reconnect (reauth_retry).
          // Official recursive path retries with the new connected client
          // object (isAuthRetry); we keep that client for the next loop
          // iteration instead of only relying on the connection cache.
          const MAX_AUTH_RECONNECT_RETRIES = 1
          let authReconnectRetries = 0
          let preferredClient: ConnectedMCPServer | null = null
          for (let attempt = 0; ; attempt++) {
            try {
              const connectedClient: ConnectedMCPServer =
                preferredClient ?? (await ensureConnectedClient(client))
              preferredClient = null
              // Official 2.1.325 #2306: if a tool call reconnected the
              // MCP server (different client instance), refresh the live
              // tool pool so subsequent SDK host calls point to the new
              // connection rather than answering "Not connected".
              if (
                connectedClient !== client &&
                connectedClient.type === 'connected'
              ) {
                const capturedCallSession = getBootstrapSession()
                void fetchToolsForClient(connectedClient)
                  .then(freshTools => {
                    runWithSession(capturedCallSession, () => {
                      swapMcpServerTools(
                        client.name,
                        freshTools,
                        connectedClient.config,
                        connectedClient,
                      )
                    })
                  })
                  .catch(() => {})
              }
              // densable 2.1.212: MCP > threshold → auto-background
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const {
                resolveMcpAutoBackgroundMs,
                callMcpToolWithAutoBackground,
                extractSep2663ServerTask,
                handleSep2663ServerTask,
              } =
                require('../../../utils/mcpAutoBackground.js') as typeof import('../../../utils/mcpAutoBackground.js')
              const transportType =
                typeof client === 'object' &&
                client &&
                'config' in client &&
                client.config &&
                typeof client.config === 'object' &&
                'type' in client.config
                  ? String((client.config as { type?: string }).type ?? '')
                  : typeof client === 'object' && client && 'type' in client
                    ? String((client as { type?: string }).type ?? '')
                    : ''
              const autoBgMs = resolveMcpAutoBackgroundMs(process.env, {
                transportType,
                isNonInteractiveSession:
                  context.options.isNonInteractiveSession,
              })

              const runMcp = (signal: AbortSignal) =>
                callMCPToolWithUrlElicitationRetry({
                  client: connectedClient,
                  clientConnection: client,
                  tool: tool.name,
                  args: callArgs,
                  meta,
                  signal,
                  setAppState: context.setAppState,
                  onProgress:
                    onProgress && toolUseId
                      ? progressData => {
                          onProgress({
                            toolUseID: toolUseId,
                            data: progressData,
                          })
                        }
                      : undefined,
                  handleElicitation: context.handleElicitation,
                  requestDialog: context.requestDialog,
                  canUseTool: _canUseTool,
                  toolUseContext: context,
                  model: context.options.mainLoopModel,
                })

              let mcpResult =
                autoBgMs > 0
                  ? await callMcpToolWithAutoBackground({
                      run: runMcp,
                      serverName: client.name,
                      toolName: tool.name,
                      toolUseId,
                      parentAbortController: context.abortController,
                      setAppState:
                        context.setAppStateForTasks ?? context.setAppState,
                      autoBackgroundMs: autoBgMs,
                      toolLabel: fullyQualifiedName,
                      foregroundSession: (context as { session?: object })
                        .session,
                      // densable $cy: defer auto-bg while URL elicitation open.
                      // Gold: process counter (begin/end around elicitation) OR
                      // AppState elicitation.queue length (REPL dialog). Prefer
                      // true on either signal — only return false when both
                      // probes say clear (or throw).
                      hasPendingElicitation: () => {
                        let processPending = false
                        try {
                          // eslint-disable-next-line @typescript-eslint/no-require-imports
                          const { hasPendingMcpElicitation } =
                            require('../transportErrorState.js') as typeof import('../transportErrorState.js')
                          processPending = hasPendingMcpElicitation()
                        } catch {
                          /* optional */
                        }
                        if (processPending) return true
                        try {
                          const q = context.getAppState().elicitation?.queue
                          return Array.isArray(q) && q.length > 0
                        } catch {
                          return false
                        }
                      },
                    })
                  : await runMcp(context.abortController.signal)

              // Official 325 #1701 & #1702: when an MCP server runs a tool
              // call as a SEP-2663 task, immediately background it (unless
              // CLAUDE_CODE_DISABLE_MCP_TASK_BACKGROUND is set).
              const sep2663Task = extractSep2663ServerTask(mcpResult)
              if (sep2663Task) {
                mcpResult = (await handleSep2663ServerTask({
                  serverName: client.name,
                  toolName: tool.name,
                  toolLabel: fullyQualifiedName,
                  toolUseId,
                  taskRef: sep2663Task,
                  setAppState:
                    context.setAppStateForTasks ?? context.setAppState,
                  parentAbortSignal: context.abortController.signal,
                  isNonInteractiveSession:
                    context.options.isNonInteractiveSession,
                  pollToCompletion: async pollSignal => {
                    type RawTaskClient = {
                      request: (
                        req: {
                          method: string
                          params: Record<string, unknown>
                        },
                        opts?: { signal?: AbortSignal },
                      ) => Promise<Record<string, unknown>>
                    }
                    // Official 2.1.325 #2308: follow server reconnects so
                    // background MCP tasks keep updating when another call
                    // drops and later reconnects the same server.
                    let activeConnected: ConnectedMCPServer = connectedClient
                    let wakeupResolve: (() => void) | undefined
                    const unsubscribe = onMcpServerConnected(
                      client.name,
                      fresh => {
                        activeConnected = fresh
                        wakeupResolve?.()
                        wakeupResolve = undefined
                      },
                    )
                    const interval = sep2663Task.pollIntervalMs ?? 2000
                    let consecutiveErrors = 0
                    const MAX_CONSECUTIVE_POLL_ERRORS = 5
                    try {
                      while (!pollSignal.aborted) {
                        const settled = await peekSettledConnection(
                          client.name,
                          client.config,
                        )
                        if (
                          settled &&
                          settled.type === 'connected' &&
                          settled !== activeConnected
                        ) {
                          activeConnected = settled
                        }
                        const rawClient =
                          activeConnected.client as unknown as RawTaskClient
                        try {
                          const statusRes = await rawClient.request(
                            {
                              method: 'tasks/get',
                              params: { taskId: sep2663Task.mcpTaskId },
                            },
                            { signal: pollSignal },
                          )
                          consecutiveErrors = 0
                          const st = String(statusRes?.status ?? '')
                          if (st === 'completed') {
                            return await rawClient.request(
                              {
                                method: 'tasks/result',
                                params: { taskId: sep2663Task.mcpTaskId },
                              },
                              { signal: pollSignal },
                            )
                          }
                          if (st === 'failed' || st === 'cancelled') {
                            throw new Error(
                              String(
                                statusRes?.statusMessage ??
                                  `MCP task ${sep2663Task.mcpTaskId} ${st}`,
                              ),
                            )
                          }
                        } catch (pollErr) {
                          if (pollSignal.aborted) throw pollErr
                          // If another call reconnected the server while
                          // this poll failed on the old socket, switch
                          // immediately and retry without counting down.
                          const fresh = await peekSettledConnection(
                            client.name,
                            client.config,
                          )
                          if (
                            fresh &&
                            fresh.type === 'connected' &&
                            fresh !== activeConnected
                          ) {
                            activeConnected = fresh
                            consecutiveErrors = 0
                            continue
                          }
                          consecutiveErrors++
                          if (
                            consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS
                          ) {
                            throw pollErr
                          }
                        }
                        await new Promise<void>(resolve => {
                          let timer: ReturnType<typeof setTimeout>
                          const onAbort = () => {
                            clearTimeout(timer)
                            wakeupResolve = undefined
                            resolve()
                          }
                          timer = setTimeout(() => {
                            pollSignal.removeEventListener('abort', onAbort)
                            wakeupResolve = undefined
                            resolve()
                          }, interval)
                          pollSignal.addEventListener('abort', onAbort, {
                            once: true,
                          })
                          wakeupResolve = () => {
                            clearTimeout(timer)
                            pollSignal.removeEventListener('abort', onAbort)
                            wakeupResolve = undefined
                            resolve()
                          }
                        })
                      }
                      throw new Error('MCP task polling aborted')
                    } finally {
                      unsubscribe()
                    }
                  },
                })) as typeof mcpResult
              }

              // densable 2.1.246 #10: `if(Ae.interrupted)throw new Rn(Q6)`
              // before completed progress — abort must not become empty
              // content → Dyo `(completed with no output)`.
              throwIfMcpToolCallInterrupted(mcpResult)

              // densable: auto-bg returns moved-to-background tool result while
              // the call still runs — do not emit false "completed" progress.
              const autoBackgrounded =
                !!mcpResult &&
                typeof mcpResult === 'object' &&
                'autoBackgrounded' in mcpResult &&
                (mcpResult as { autoBackgrounded?: boolean })
                  .autoBackgrounded === true

              // Emit progress when tool completes successfully
              if (onProgress && toolUseId && !autoBackgrounded) {
                onProgress({
                  toolUseID: toolUseId,
                  data: {
                    type: 'mcp_progress',
                    status: 'completed',
                    serverName: client.name,
                    toolName: tool.name,
                    elapsedTimeMs: Date.now() - startTime,
                  },
                })
              }

              const mcpMeta =
                mcpResult &&
                typeof mcpResult === 'object' &&
                (('_meta' in mcpResult && mcpResult._meta) ||
                  ('structuredContent' in mcpResult &&
                    mcpResult.structuredContent))
                  ? {
                      ...('_meta' in mcpResult && mcpResult._meta
                        ? {
                            _meta: mcpResult._meta as Record<string, unknown>,
                          }
                        : {}),
                      ...('structuredContent' in mcpResult &&
                      mcpResult.structuredContent
                        ? {
                            structuredContent:
                              mcpResult.structuredContent as Record<
                                string,
                                unknown
                              >,
                          }
                        : {}),
                    }
                  : undefined

              return {
                data: mcpResult.content,
                ...(mcpMeta && Object.keys(mcpMeta).length > 0
                  ? { mcpMeta }
                  : {}),
              }
            } catch (error) {
              // Session expired — the connection cache has been
              // cleared, so retry with a fresh client.
              if (
                error instanceof McpSessionExpiredError &&
                attempt < MAX_SESSION_RETRIES &&
                (!error.mayHaveRun ||
                  tool.annotations?.readOnlyHint === true ||
                  tool.annotations?.idempotentHint === true)
              ) {
                logMCPDebug(
                  client.name,
                  `Retrying tool '${tool.name}' after session recovery`,
                )
                continue
              }

              // Official 2.1.193/206: 401 auth recovery — headersHelper
              // re-mint, or OAuth refresh_token reconnect, once only.
              // Concurrent callers rejoin the same in-flight reconnect
              // (OHs Map: reauth_retry leader / collateral_rejoin).
              if (authReconnectRetries < MAX_AUTH_RECONNECT_RETRIES) {
                const serverConfig = client.config as {
                  headersHelper?: string
                  type?: string
                  url?: string
                  headers?: Record<string, string>
                  oauth?: unknown
                }
                const hasRefreshToken =
                  (serverConfig.type === 'http' ||
                    serverConfig.type === 'sse') &&
                  !!serverConfig.url &&
                  serverHasStoredRefreshToken(
                    client.name,
                    serverConfig as {
                      type: 'http' | 'sse'
                      url: string
                      headers?: Record<string, string>
                    },
                  )
                const kind = classifyAuthReconnectKind({
                  type: serverConfig.type,
                  headersHelper: serverConfig.headersHelper,
                  url: serverConfig.url,
                  hasRefreshToken,
                  hasUserAuthHeader: headersHaveAuthorization(
                    serverConfig.headers,
                  ),
                })
                const cacheKey = getServerCacheKey(client.name, client.config)
                // Official W: ConnectionClosed mid-reconnect → rejoin
                // even if this call didn't see a 401 classification.
                const closedWhileReconnecting =
                  kind !== null &&
                  isConnectionClosedWhileReconnecting(
                    error,
                    hasAuthReconnectInFlight(cacheKey),
                  )
                const shouldReconnect =
                  kind !== null &&
                  (error instanceof McpAuthError || closedWhileReconnecting)

                if (shouldReconnect && kind !== null) {
                  authReconnectRetries++
                  logMCPDebug(
                    client.name,
                    kind === 'mcp_headers_helper'
                      ? `Tool '${tool.name}' returned 401; re-running headersHelper and retrying once`
                      : `Tool '${tool.name}' returned 401; refresh token stored — reconnecting and retrying once`,
                  )
                  const reconnected: MCPServerConnection =
                    await joinOrStartAuthReconnect(
                      cacheKey,
                      kind,
                      async (): Promise<MCPServerConnection> => {
                        await clearServerCache(client.name, client.config)
                        return connectToServer(client.name, client.config)
                      },
                      join => {
                        // Official Ze(kind, role): telemetry distinguishes
                        // the leader reauth_retry from collateral_rejoin.
                        if (join.role === 'leader') {
                          logEvent(
                            kind === 'mcp_headers_helper'
                              ? 'tengu_mcp_headers_helper_retry'
                              : 'tengu_mcp_oauth_refresh_retry',
                            {},
                          )
                        } else {
                          logEvent(
                            kind === 'mcp_headers_helper'
                              ? 'tengu_mcp_headers_helper_collateral_rejoin'
                              : 'tengu_mcp_oauth_refresh_collateral_rejoin',
                            {},
                          )
                        }
                      },
                    )
                  if (reconnected.type === 'connected') {
                    // Official: retry the tool with the reconnected client
                    // (recursive JTo isAuthRetry). Prefer this object so
                    // we don't race another cache miss after clear+connect.
                    // Official 2.1.325 #2306: also refresh server tools in
                    // the live tool pool so SDK host calls point to the
                    // new connection instead of answering "Not connected".
                    preferredClient = reconnected
                    const capturedReconnectSession = getBootstrapSession()
                    void fetchToolsForClient(reconnected)
                      .then(freshTools => {
                        runWithSession(capturedReconnectSession, () => {
                          swapMcpServerTools(
                            client.name,
                            freshTools,
                            reconnected.config,
                            reconnected,
                          )
                        })
                      })
                      .catch(() => {})
                    continue
                  }
                  logMCPDebug(
                    client.name,
                    `Auth reconnect returned '${reconnected.type}'; falling through to needs-auth`,
                  )
                }
              }

              // Emit progress when tool fails
              if (onProgress && toolUseId) {
                onProgress({
                  toolUseID: toolUseId,
                  data: {
                    type: 'mcp_progress',
                    status: 'failed',
                    serverName: client.name,
                    toolName: tool.name,
                    elapsedTimeMs: Date.now() - startTime,
                  },
                })
              }
              // Wrap MCP SDK errors so telemetry gets useful context
              // instead of just "Error" or "McpError" (the constructor
              // name). MCP SDK errors are protocol-level messages and
              // don't contain user file paths or code.
              if (
                error instanceof Error &&
                !(
                  error instanceof
                  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
                )
              ) {
                const name = error.constructor.name
                if (name === 'Error') {
                  throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
                    error.message,
                    error.message.slice(0, 200),
                  )
                }
                // McpError has a numeric `code` with the JSON-RPC error
                // code (e.g. -32000 ConnectionClosed, -32001 RequestTimeout)
                if (
                  name === 'McpError' &&
                  'code' in error &&
                  typeof error.code === 'number'
                ) {
                  throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
                    error.message,
                    `McpError ${error.code}`,
                  )
                }
              }
              throw error
            }
          }
        },
        userFacingName() {
          // Prefer title annotation if available, otherwise use tool name
          const displayName = tool.annotations?.title || tool.name
          return `${client.name} - ${displayName} (MCP)`
        },
        ...(chromeToolOverrides ?? {}),
        ...(feature('CHICAGO_MCP') &&
        (client.config.type === 'stdio' || !client.config.type) &&
        isComputerUseMCPServer!(client.name)
          ? computerUseWrapper!().getComputerUseMCPToolOverrides(tool.name)
          : {}),
      }
      return composeMcpTool({
        serverName: client.name,
        config: client.config,
        toolName: tool.name,
        fullyQualifiedName,
        skipPrefix,
        standardKey: serverStandardKey,
        denyKey: serverDenyKey,
        toolNameShared,
        requiresUserInteraction,
        isFirstPartyDesignServer,
        baseTool,
        customCheckPermissions: chromeToolOverrides?.checkPermissions,
      })
    })
    .map(mappedTool =>
      wrapDocsConnectorToolForTerminalAutoOpen(
        mappedTool,
        client.name,
        client.config,
      ),
    )
    .filter(isIncludedMcpTool)

  for (const candidate of composedTools) {
    if (candidate.name.length > MAX_MCP_TOOL_NAME_LENGTH) {
      droppedRaw.push({
        toolName: candidate.mcpInfo?.toolName ?? candidate.name,
        reason: `tool name has ${candidate.name.length} characters and exceeds the ${MAX_MCP_TOOL_NAME_LENGTH}-character limit`,
      })
    }
  }

  if (droppedSeq.seq > droppedSeq.state.applied) {
    droppedSeq.state.applied = droppedSeq.seq
    const seenDropped = new Set<string>()
    const dedupedDropped: DroppedMcpToolRecord[] = []
    for (const item of droppedRaw) {
      if (!seenDropped.has(item.toolName)) {
        seenDropped.add(item.toolName)
        dedupedDropped.push(item)
      }
    }
    client.droppedTools = dedupedDropped.length > 0 ? dedupedDropped : undefined
  }

  return filterMcpToolsByNameLength(composedTools, client.name)
}

export async function fetchToolsForClientImpl(
  client: MCPServerConnection,
): Promise<Tool[]> {
  if (client.type !== 'connected') return []
  const hostState = getHostMcpClientState()

  try {
    if (!client.capabilities?.tools) {
      const empty: Tool[] = []
      if (isMcpDiscoveryCacheEnabled()) {
        recordRawToolsForResult(empty, [])
      }
      return empty
    }

    // densable 2.1.289: modern `ai` listTools aggregate; else `$n` 20-page walk.
    const listedTools = (
      readClientProtocolEra(client.client) === 'modern'
        ? await listMcpToolsAggregated(client.client, client.name)
        : await listMcpCursorPages(
            client.client,
            client.name,
            'tools/list',
            page => (Array.isArray(page.tools) ? page.tools : undefined),
          )
    ) as NonNullable<
      Awaited<ReturnType<typeof client.client.listTools>>['tools']
    >

    // densable: successful tools/list clears discovery degradation flags
    client.toolsListError = undefined
    client.discoveryAuthFailure = undefined
    // Note: discoveryBearerRejected is sticky until reconnect with a good token

    // #2055: Drop any null/undefined/non-object entries in tools/list (e.g. from
    // an SDK host) before Unicode sanitization and schema/name inspection so
    // headless sessions never crash on `t.name`.
    const validListedTools = Array.isArray(listedTools)
      ? listedTools.filter(
          (entry): entry is (typeof listedTools)[number] =>
            entry !== null &&
            typeof entry === 'object' &&
            typeof (entry as { name?: unknown }).name === 'string',
        )
      : []

    const result = composeMcpToolsFromRawListing(client, validListedTools)
    if (isMcpDiscoveryCacheEnabled()) {
      recordRawToolsForResult(result, validListedTools)
    }
    return result
  } catch (error) {
    const msg = errorMessage(error)
    // densable n4e catch: claudeai-proxy bearer reject → discoveryBearerRejected
    // (stay connected + /login); generic 401/403 list auth → discoveryAuthFailure.
    const isProxy = client.config.type === 'claudeai-proxy'
    const bearerRejected = isProxy && isClaudeAiBearerRejectedError(error)
    if (isProxy && !bearerRejected && isClaudeAiProxyListAuthError(error)) {
      logEvent('tengu_mcp_server_needs_auth', {
        transportType:
          'claudeai-proxy' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        cause:
          'discovery_tools_list' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      client.discoveryAuthFailure = true
      logMCPDebug(
        client.name,
        'tools/list 401/403 on claude.ai proxy — flagging needs-auth',
      )
      hostState.fetchToolsMemo.cache.delete(client.name)
      const empty: Tool[] = []
      recordDiscoveryFetchErrorForResult(
        empty,
        error instanceof Error ? error : new Error(String(error)),
      )
      return empty
    }
    client.toolsListError = msg
    if (bearerRejected) {
      client.discoveryBearerRejected = true
      logMCPDebug(client.name, `Failed to fetch tools: ${msg}`)
    } else {
      logMCPError(client.name, `Failed to fetch tools: ${msg}`)
    }
    hostState.fetchToolsMemo.cache.delete(client.name)
    const empty: Tool[] = []
    recordDiscoveryFetchErrorForResult(
      empty,
      error instanceof Error ? error : new Error(String(error)),
    )
    return empty
  }
}

/**
 * densable fcn / isListAuthError — 401/403 on list that is *not* a
 * CLAUDEAI_BEARER_REJECTED throw (those stay connected + /login).
 */
export async function fetchResourcesForClientImpl(
  client: MCPServerConnection,
): Promise<ServerResource[]> {
  if (client.type !== 'connected') return []

  try {
    if (!client.capabilities?.resources) {
      const empty: ServerResource[] = []
      if (isMcpDiscoveryCacheEnabled()) {
        recordRawResourcesForResult(empty, [])
      }
      return empty
    }

    // densable 2.1.289 `$n` resources/list — 20-page clamp, not SDK 64 throw.
    const resources = (await listMcpCursorPages(
      client.client,
      client.name,
      'resources/list',
      page => (Array.isArray(page.resources) ? page.resources : undefined),
    )) as NonNullable<
      Awaited<ReturnType<typeof client.client.listResources>>['resources']
    >

    if (resources.length === 0) {
      const empty: ServerResource[] = []
      if (isMcpDiscoveryCacheEnabled()) {
        recordRawResourcesForResult(empty, [])
      }
      return empty
    }

    // Add server name to each resource
    const mapped = resources.map(resource => ({
      ...resource,
      server: client.name,
    }))
    if (isMcpDiscoveryCacheEnabled()) {
      recordRawResourcesForResult(mapped, resources)
    }
    return mapped
  } catch (error) {
    logMCPError(
      client.name,
      `Failed to fetch resources: ${errorMessage(error)}`,
    )
    // densable #42: rethrow so list_changed can keep previous resources
    // (soft-returning [] would cache empty and wipe slash resources).
    throw error
  }
}

/**
 * Compose Claude Code prompt `Command` entries from raw MCP prompts for either
 * a live `ConnectedMCPServer` or a discovery-cache-hydrated `CachedMCPServer`.
 * Matches official 2.1.331 `Au`.
 */
export function composeMcpCommandsFromRawListing(
  client: ConnectedMCPServer | CachedMCPServer,
  listedPrompts: CachedMcpPromptEntry[],
): Command[] {
  if (listedPrompts.length === 0) return []
  const promptsToProcess = recursivelySanitizeUnicode(listedPrompts)
  return promptsToProcess.map(prompt => {
    const argNames = Object.values(prompt.arguments ?? {}).map(k => k.name)
    return Object.assign(
      {
        type: 'prompt' as const,
        name: 'mcp__' + normalizeNameForMCP(client.name) + '__' + prompt.name,
        description: prompt.description ?? '',
        hasUserSpecifiedDescription: !!prompt.description,
        contentLength: 0, // Dynamic MCP content
        isEnabled: () => true,
        isHidden: false,
        isMcp: true,
        progressMessage: 'running',
        userFacingName() {
          // Use prompt.name (programmatic identifier) not prompt.title (display name)
          // to avoid spaces breaking slash command parsing
          return `${client.name}:${prompt.name} (MCP)`
        },
        argNames,
        source: 'mcp' as const,
        async getPromptForCommand(args: string) {
          const argsArray = args.split(' ')
          try {
            const connectedClient = await ensureConnectedClient(client)
            const result = await connectedClient.client.getPrompt({
              name: prompt.name,
              arguments: zipObject(argNames, argsArray),
            })
            const transformed = await Promise.all(
              result.messages.map(message =>
                transformResultContent(message.content, connectedClient.name),
              ),
            )
            return transformed.flat()
          } catch (error) {
            logMCPError(
              client.name,
              `Error running command '${prompt.name}': ${errorMessage(error)}`,
            )
            throw error
          }
        },
      },
      {
        // Official 2.1.326 #79: Stamp exact server name so `commandBelongsToServer`
        // does not drop prompts when two servers share a normalized prefix.
        mcpInfo: { serverName: client.name },
      },
    )
  })
}

export async function fetchCommandsForClientImpl(
  client: MCPServerConnection,
): Promise<Command[]> {
  if (client.type !== 'connected') return []

  try {
    if (!client.capabilities?.prompts) {
      const empty: Command[] = []
      if (isMcpDiscoveryCacheEnabled()) {
        recordRawCommandsForResult(empty, [])
      }
      return empty
    }

    // densable 2.1.289 `$n` prompts/list — 20-page clamp, not SDK 64 throw.
    const listedPrompts = (await listMcpCursorPages(
      client.client,
      client.name,
      'prompts/list',
      page => (Array.isArray(page.prompts) ? page.prompts : undefined),
    )) as NonNullable<
      Awaited<ReturnType<typeof client.client.listPrompts>>['prompts']
    >

    if (listedPrompts.length === 0) {
      const empty: Command[] = []
      if (isMcpDiscoveryCacheEnabled()) {
        recordRawCommandsForResult(empty, [])
      }
      return empty
    }

    const result = composeMcpCommandsFromRawListing(client, listedPrompts)
    if (isMcpDiscoveryCacheEnabled()) {
      recordRawCommandsForResult(result, listedPrompts)
    }
    return result
  } catch (error) {
    logMCPError(client.name, `Failed to fetch commands: ${errorMessage(error)}`)
    // densable #42: rethrow so list_changed can keep previous commands
    // (soft-returning [] would cache empty and clear slash prompts).
    throw error
  }
}
