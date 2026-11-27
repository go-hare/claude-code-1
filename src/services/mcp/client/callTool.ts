import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  ProtocolErrorCode,
  SdkError,
  UrlElicitationRequiredError,
} from '@modelcontextprotocol/client'
import { checkMcpToolRemovedByPlugin } from '../../../utils/plugins/pluginToolList.js'
import type {
  ElicitRequestURLParams,
  ElicitResult,
  ConnectedMCPServer,
  McpCallWatchdog,
  MCPServerConnection,
} from '../types.js'
import type { AppState } from '../../../state/AppState.js'
import type { MCPProgress } from '@claude-code/builtin-tools/tools/MCPTool/MCPTool.js'
import { createAbortController } from '../../../utils/abortController.js'
import { detectCodeIndexingFromMcpServerName } from '../../../utils/codeIndexing.js'
import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../../utils/errors.js'
import type { ImageLimits } from '../../../utils/imageResizer.js'
import { logMCPDebug, logMCPError } from '../../../utils/log.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../analytics/index.js'
import {
  consumeMcpElicitationDeclinedDuringCall,
  runElicitationHooks,
  runElicitationResultHooks,
} from '../elicitationHandler.js'
import { normalizeNameForMCP } from '../normalization.js'
import { isMcpConnectionClosedError } from '../authReconnect.js'
import {
  clearCallWatchdogArm,
  shouldAbortForTransportDrop,
} from '../transportErrorState.js'
import {
  getMcpToolIdleTimeoutMs,
  getMcpToolTimeoutMs,
  MCP_TOOL_CALL_INTERRUPTED,
  type MCPToolCallResult,
  processMCPResult,
} from '../clientHelpers.js'
import {
  getServerCacheKey,
  isMcpSessionExpiredError,
  McpAuthError,
  McpSessionExpiredError,
  McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../connectionHelpers.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import {
  MCP_CALL_OUTCOME_UNKNOWN_NOTE,
  classifyMcpToolCallAuthError,
  formatMcpElicitationDeclinedError,
  formatMcpServerRemovedError,
  formatMcpToolTimeoutMessage,
  isClaudeAiProxyCutOffAfterSend,
} from './errorsAndKeys.js'
import { clearServerCache, isMcpServerRemovedFromSession } from './hostState.js'

/**
 * Call an IDE tool directly as an RPC
 * @param toolName The name of the tool to call
 * @param args The arguments to pass to the tool
 * @param client The IDE client to use for the RPC call
 * @returns The result of the tool call
 */
export async function callIdeRpc(
  toolName: string,
  args: Record<string, unknown>,
  client: ConnectedMCPServer,
): Promise<string | ContentBlockParam[] | undefined> {
  const result = await callMCPTool({
    client,
    tool: toolName,
    args,
    signal: createAbortController().signal,
  })
  return result.content
}

/** @internal Exported for testing. */
export async function callMCPToolWithUrlElicitationRetry({
  client: connectedClient,
  clientConnection,
  tool,
  args,
  meta,
  signal,
  setAppState: _setAppState,
  onProgress,
  imageLimits,
  hasResultSizeAnnotation = false,
  callToolFn = callMCPTool,
  handleElicitation,
  requestDialog,
  canUseTool,
  toolUseContext,
  model,
}: {
  client: ConnectedMCPServer
  clientConnection: MCPServerConnection
  tool: string
  args: Record<string, unknown>
  meta?: Record<string, unknown>
  signal: AbortSignal
  setAppState: (f: (prev: AppState) => AppState) => void
  onProgress?: (data: MCPProgress) => void
  imageLimits?: ImageLimits
  hasResultSizeAnnotation?: boolean
  /** Injectable for testing. Defaults to callMCPTool. */
  callToolFn?: (opts: {
    client: ConnectedMCPServer
    tool: string
    args: Record<string, unknown>
    meta?: Record<string, unknown>
    signal: AbortSignal
    onProgress?: (data: MCPProgress) => void
    imageLimits?: ImageLimits
    hasResultSizeAnnotation?: boolean
    model?: string
  }) => Promise<MCPToolCallResult>
  /** Handler for URL elicitations when no hook handles them.
   * In print/SDK mode, delegates to structuredIO. In REPL, falls back to queue. */
  handleElicitation?: (
    serverName: string,
    params: ElicitRequestURLParams,
    signal: AbortSignal,
  ) => Promise<ElicitResult>
  /** densable `c` — requestDialog(Gbt, {serverName, params}, {signal}). */
  requestDialog?: (
    spec: {
      kind: string
      default: unknown
      payload?: () => {
        safeParse: (v: unknown) => { success: boolean; data?: unknown }
      }
      result?: () => {
        safeParse: (v: unknown) => { success: boolean; data?: unknown }
      }
    },
    payload: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>
  canUseTool?: import('../../../hooks/useCanUseTool.js').CanUseToolFn
  toolUseContext?: import('../../../Tool.js').ToolUseContext
  model?: string
}): Promise<MCPToolCallResult> {
  // Official 2.1.326 #80: Refuse calls to a server removed from the session
  // (e.g. by SDK `mcp_set_servers`) instead of reconnecting or asking for auth.
  if (
    isMcpServerRemovedFromSession(
      clientConnection.name,
      clientConnection.config,
    )
  ) {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      formatMcpServerRemovedError(clientConnection.name),
      'MCP server removed from session',
    )
  }
  // Official 2.1.323 #2188 (`tLs`): refuse MCP tool call if a `tool.list`
  // plugin hook removed this tool from the current session.
  const pluginRemovedMessage =
    checkMcpToolRemovedByPlugin(connectedClient.name, tool) ??
    checkMcpToolRemovedByPlugin(normalizeNameForMCP(connectedClient.name), tool)
  if (pluginRemovedMessage) {
    throw new Error(pluginRemovedMessage)
  }
  const MAX_URL_ELICITATION_RETRIES = 3
  const effectiveModel = model ?? toolUseContext?.options.mainLoopModel
  let didStepUp = false
  for (let attempt = 0; ; attempt++) {
    try {
      return await callToolFn({
        client: connectedClient,
        tool,
        args,
        meta,
        signal,
        onProgress,
        imageLimits,
        hasResultSizeAnnotation,
        model: effectiveModel,
      })
    } catch (error) {
      if (
        error instanceof McpAuthError &&
        error.requestedScope !== undefined &&
        canUseTool !== undefined &&
        toolUseContext !== undefined &&
        clientConnection.config.type === 'http'
      ) {
        const {
          shouldOfferMcpStepUpReauth,
          requestMcpStepUpReauth,
          isMcpStepUpReauthExhausted,
          markMcpStepUpReauthExhausted,
        } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../mcpStepUpReauth.js') as typeof import('../mcpStepUpReauth.js')
        const cacheKey = getServerCacheKey(
          clientConnection.name,
          clientConnection.config,
        )
        if (didStepUp) {
          markMcpStepUpReauthExhausted(
            cacheKey,
            error.requestedScope,
            error.requestedScope,
          )
        }
        if (
          !isMcpStepUpReauthExhausted(cacheKey, error.requestedScope) &&
          shouldOfferMcpStepUpReauth({
            requestedScope: error.requestedScope,
            config: clientConnection.config,
            canUseTool,
            toolUseContext,
            alreadyRetried: didStepUp,
          })
        ) {
          const outcome = await requestMcpStepUpReauth({
            serverName: clientConnection.name,
            config: clientConnection.config,
            requestedScope: error.requestedScope,
            canUseTool,
            toolUseContext,
            signal,
            cacheKey,
          })
          if (outcome === 'reauthenticated') {
            didStepUp = true
            logMCPDebug(
              clientConnection.name,
              `Retrying tool '${tool}' after the consented step-up re-auth`,
            )
            continue
          }
        }
        throw error
      }
      // densable / v2: UrlElicitationRequiredError or ProtocolErrorCode.
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined
      const isUrlElicit =
        error instanceof UrlElicitationRequiredError ||
        code === ProtocolErrorCode.UrlElicitationRequired ||
        code === -32042
      if (!isUrlElicit) {
        throw error
      }

      // Limit the number of URL elicitation retries
      if (attempt >= MAX_URL_ELICITATION_RETRIES) {
        throw error
      }

      // Prefer typed UrlElicitationRequiredError.elicitations; fall back to data bag.
      const rawElicitations: unknown[] =
        error instanceof UrlElicitationRequiredError
          ? error.elicitations
          : (() => {
              const errorData =
                error && typeof error === 'object' && 'data' in error
                  ? (error as { data?: unknown }).data
                  : undefined
              return errorData != null &&
                typeof errorData === 'object' &&
                'elicitations' in errorData &&
                Array.isArray(
                  (errorData as { elicitations?: unknown }).elicitations,
                )
                ? (errorData as { elicitations: unknown[] }).elicitations
                : []
            })()

      // Validate each element has the required fields for ElicitRequestURLParams
      const elicitations = rawElicitations.filter(
        (e): e is ElicitRequestURLParams => {
          if (e == null || typeof e !== 'object') return false
          const obj = e as Record<string, unknown>
          return (
            obj.mode === 'url' &&
            typeof obj.url === 'string' &&
            typeof obj.elicitationId === 'string' &&
            typeof obj.message === 'string'
          )
        },
      )

      const serverName =
        clientConnection.type === 'connected'
          ? clientConnection.name
          : 'unknown'

      if (elicitations.length === 0) {
        logMCPDebug(
          serverName,
          `Tool '${tool}' returned -32042 but no valid elicitations in error data`,
        )
        throw error
      }

      logMCPDebug(
        serverName,
        `Tool '${tool}' requires URL elicitation (error -32042, attempt ${attempt + 1}), processing ${elicitations.length} elicitation(s)`,
      )

      // Process each URL elicitation from the error.
      // Official: c?await c(Gbt,{serverName,params},{signal}):{action:"cancel"}.
      // NMs complete settles the mailbox via answerMcpUrlElicitationComplete.
      // densable $cy: mark pending so MCP auto-background defers while open.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { beginMcpElicitation, endMcpElicitation } =
        require('../transportErrorState.js') as typeof import('../transportErrorState.js')
      beginMcpElicitation()
      try {
        for (const elicitation of elicitations) {
          const { elicitationId } = elicitation

          // Run elicitation hooks — they can resolve URL elicitations programmatically
          const hookResponse = await runElicitationHooks(
            serverName,
            elicitation,
            signal,
          )
          if (hookResponse) {
            logMCPDebug(
              serverName,
              `URL elicitation ${elicitationId} resolved by hook: ${jsonStringify(hookResponse)}`,
            )
            if (hookResponse.action !== 'accept') {
              return {
                content: `URL elicitation was ${hookResponse.action === 'decline' ? 'declined' : hookResponse.action + 'ed'} by a hook. The tool "${tool}" could not complete because it requires the user to open a URL.`,
              }
            }
            // Hook accepted — skip the UI and proceed to retry
            continue
          }

          // Official: M=c?await c(Gbt,{serverName,params},{signal}):{action:"cancel"}
          let userResult: ElicitResult
          if (requestDialog) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { mcpUrlElicitationSpec } =
              require('../../../dialog/specs/jsuKinds.js') as typeof import('../../../dialog/specs/jsuKinds.js')
            userResult = (await requestDialog(
              mcpUrlElicitationSpec,
              { serverName, params: elicitation },
              { signal },
            )) as ElicitResult
          } else if (handleElicitation) {
            userResult = await handleElicitation(
              serverName,
              elicitation,
              signal,
            )
          } else {
            userResult = { action: 'cancel' }
          }

          // Run ElicitationResult hooks — they can modify or block the response
          const finalResult = await runElicitationResultHooks(
            serverName,
            userResult,
            signal,
            'url',
            elicitationId,
          )

          if (finalResult.action !== 'accept') {
            logMCPDebug(
              serverName,
              `User ${finalResult.action === 'decline' ? 'declined' : finalResult.action + 'ed'} URL elicitation ${elicitationId}`,
            )
            return {
              content: `URL elicitation was ${finalResult.action === 'decline' ? 'declined' : finalResult.action + 'ed'} by the user. The tool "${tool}" could not complete because it requires the user to open a URL.`,
            }
          }

          logMCPDebug(
            serverName,
            `Elicitation ${elicitationId} completed, retrying tool call`,
          )
        }
      } finally {
        endMcpElicitation()
      }

      // Loop back to retry the tool call
    }
  }
}

async function callMCPTool({
  client: { client, name, config, transportErrorState },
  tool,
  args,
  meta,
  signal,
  onProgress,
  imageLimits,
  hasResultSizeAnnotation = false,
  model,
}: {
  client: ConnectedMCPServer
  tool: string
  args: Record<string, unknown>
  meta?: Record<string, unknown>
  signal: AbortSignal
  onProgress?: (data: MCPProgress) => void
  imageLimits?: ImageLimits
  hasResultSizeAnnotation?: boolean
  model?: string
}): Promise<MCPToolCallResult> {
  // Official 2.1.326 #80: Refuse calls to a server removed from the session
  // (e.g. by SDK `mcp_set_servers`) instead of reconnecting or asking for auth.
  if (isMcpServerRemovedFromSession(name, config)) {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      formatMcpServerRemovedError(name),
      'MCP server removed from session',
    )
  }
  // Official 2.1.323 #2188 (`tLs`): refuse MCP tool call if a `tool.list`
  // plugin hook removed this tool from the current session.
  const pluginRemovedMessage =
    checkMcpToolRemovedByPlugin(name, tool) ??
    checkMcpToolRemovedByPlugin(normalizeNameForMCP(name), tool)
  if (pluginRemovedMessage) {
    throw new Error(pluginRemovedMessage)
  }
  const toolStartTime = Date.now()
  let progressInterval: NodeJS.Timeout | undefined
  let idleTimeoutId: NodeJS.Timeout | undefined
  let armIdleWatchdog: (() => void) | undefined
  // Official S={armedAt:0} registered on transportErrorState for mid-call drop.
  const callWatchdog: McpCallWatchdog = { armedAt: 0, openQuestions: 0 }
  const transportState = transportErrorState
  transportState?.activeCallWatchdogs.add(callWatchdog)
  let rejectTransportDrop: ((err: Error) => void) | undefined
  const transportDropPromise = new Promise<never>((_, reject) => {
    rejectTransportDrop = reject
  })

  try {
    logMCPDebug(name, `Calling MCP tool: ${tool}`)

    // Set up progress logging for long-running tools (every 30 seconds).
    // Official: also abort if transport error armed this call >90s ago.
    progressInterval = setInterval(
      (startTime, name, tool) => {
        const elapsed = Date.now() - startTime
        const elapsedSeconds = Math.floor(elapsed / 1000)
        const duration = `${elapsedSeconds}s`
        logMCPDebug(name, `Tool '${tool}' still running (${duration} elapsed)`)
        if (shouldAbortForTransportDrop(callWatchdog)) {
          const armedSec = Math.floor(
            (Date.now() - callWatchdog.armedAt) / 1000,
          )
          logMCPDebug(
            name,
            `Tool '${tool}' aborting: transport error ${armedSec}s ago, response presumed lost`,
          )
          rejectTransportDrop?.(
            new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
              `MCP server "${name}" transport dropped mid-call; response for tool "${tool}" was lost`,
              'MCP transport lost mid-call',
            ),
          )
        }
      },
      30000, // Log every 30 seconds
      toolStartTime,
      name,
      tool,
    )

    // Use Promise.race with our own timeout to handle cases where SDK's
    // internal timeout doesn't work (e.g., SSE stream breaks mid-request)
    const timeoutMs = getMcpToolTimeoutMs()
    let timeoutId: NodeJS.Timeout | undefined

    // Official 2.1.187: abort if neither progress nor final response arrives
    // within the idle window (default 5 min). Progress resets the idle timer.
    const idleTimeoutMs = getMcpToolIdleTimeoutMs(
      config as { timeout?: number } | undefined,
    )
    const idlePromise =
      idleTimeoutMs === null
        ? null
        : new Promise<never>((_, reject) => {
            armIdleWatchdog = () => {
              if (idleTimeoutId) clearTimeout(idleTimeoutId)
              idleTimeoutId = setTimeout(() => {
                const idleSec = Math.floor(idleTimeoutMs / 1000)
                reject(
                  new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
                    `MCP server "${name}" tool "${tool}" sent no response or progress for ${idleSec}s; aborting. If this server is configured in your MCP settings, set a per-server "timeout" (ms) to allow longer silent runs for just this server; otherwise set CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT (ms) globally (0 disables).`,
                    'MCP tool idle timeout',
                  ),
                )
              }, idleTimeoutMs)
            }
            armIdleWatchdog()
          })

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        (reject, name, tool, timeoutMs, watchdog) => {
          reject(
            new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
              formatMcpToolTimeoutMessage(
                name,
                tool,
                timeoutMs,
                (watchdog.openQuestions ?? 0) > 0,
              ),
              'MCP tool timeout',
            ),
          )
        },
        timeoutMs,
        reject,
        name,
        tool,
        timeoutMs,
        callWatchdog,
      )
    })

    const races: Promise<unknown>[] = [
      // densable: callTool(params, options) — no result schema arg on v2.
      client.callTool(
        {
          name: tool,
          arguments: args,
          _meta: meta,
        },
        {
          signal,
          timeout: timeoutMs,
          onprogress: sdkProgress => {
            // Any progress notification resets the idle + transport-drop watchdogs.
            armIdleWatchdog?.()
            clearCallWatchdogArm(callWatchdog)
            if (onProgress) {
              onProgress({
                type: 'mcp_progress',
                status: 'progress',
                serverName: name,
                toolName: tool,
                progress: sdkProgress.progress,
                total: sdkProgress.total,
                progressMessage: sdkProgress.message,
              })
            }
          },
        },
      ),
      timeoutPromise,
      transportDropPromise,
    ]
    if (idlePromise) races.push(idlePromise)

    const result = (await Promise.race(races).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      if (idleTimeoutId) {
        clearTimeout(idleTimeoutId)
      }
      armIdleWatchdog = undefined
    })) as Awaited<ReturnType<typeof client.callTool>>

    if ('isError' in result && result.isError) {
      let errorDetails = 'Unknown error'
      if (
        'content' in result &&
        Array.isArray(result.content) &&
        result.content.length > 0
      ) {
        const firstContent = result.content[0]
        if (
          firstContent &&
          typeof firstContent === 'object' &&
          'text' in firstContent
        ) {
          errorDetails = firstContent.text
        }
      } else if ('error' in result) {
        // Fallback for legacy error format
        errorDetails = String(result.error)
      }
      logMCPError(name, errorDetails)
      // Official 2.1.326 #81 (`q9a`): If a remote elicitation question for this
      // server was declined during this call, tell Claude the decline still stands.
      if (consumeMcpElicitationDeclinedDuringCall(name, toolStartTime)) {
        throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
          formatMcpElicitationDeclinedError(errorDetails),
          'MCP tool failed after declined elicitation',
        )
      }
      throw new McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
        errorDetails,
        'MCP tool returned error',
        '_meta' in result && result._meta ? { _meta: result._meta } : undefined,
      )
    }
    const elapsed = Date.now() - toolStartTime
    const duration =
      elapsed < 1000
        ? `${elapsed}ms`
        : elapsed < 60000
          ? `${Math.floor(elapsed / 1000)}s`
          : `${Math.floor(elapsed / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`

    logMCPDebug(name, `Tool '${tool}' completed successfully in ${duration}`)

    // Log code indexing tool usage
    const codeIndexingTool = detectCodeIndexingFromMcpServerName(name)
    if (codeIndexingTool) {
      logEvent('tengu_code_indexing_tool_used', {
        tool: codeIndexingTool as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        source:
          'mcp' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        success: true,
      })
    }

    const content = await processMCPResult(
      result,
      tool,
      name,
      imageLimits,
      hasResultSizeAnnotation,
      model,
    )
    return {
      content,
      _meta: result._meta as Record<string, unknown> | undefined,
      structuredContent: result.structuredContent as
        | Record<string, unknown>
        | undefined,
    }
  } catch (e) {
    // Clear intervals on error
    if (progressInterval !== undefined) {
      clearInterval(progressInterval)
    }

    const elapsed = Date.now() - toolStartTime

    if (e instanceof Error && e.name !== 'AbortError') {
      logMCPDebug(
        name,
        `Tool '${tool}' failed after ${Math.floor(elapsed / 1000)}s: ${e.message}`,
      )
    }

    // Check for 401/OAuth errors indicating expired/invalid OAuth tokens (#1996)
    // The MCP SDK's StreamableHTTPError has a `code` property with the HTTP status,
    // while sign-in servers may return OAuth-shaped errors such as `TOKEN_EXPIRED`.
    if (e instanceof Error) {
      const errorCode = 'code' in e ? (e.code as number | undefined) : undefined
      const hasHeadersHelper =
        (config.type === 'http' ||
          config.type === 'sse' ||
          config.type === 'ws') &&
        Boolean((config as { headersHelper?: string }).headersHelper)
      const authClassification = classifyMcpToolCallAuthError(e, {
        hasHeadersHelper,
      })
      if (authClassification === 'credential_rejected') {
        logMCPDebug(
          name,
          `Tool call returned auth rejection (${e.message}) - token may have expired`,
        )
        logEvent('tengu_mcp_tool_call_auth_error', {})
        throw new McpAuthError(
          name,
          `MCP server "${name}" requires re-authorization (token expired)`,
        )
      }

      if (errorCode === 403 || authClassification === 'step_up') {
        const { extractInsufficientScope } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../mcpStepUpReauth.js') as typeof import('../mcpStepUpReauth.js')
        const scope = extractInsufficientScope(e)
        if (scope) {
          logMCPDebug(
            name,
            `Tool call returned 403 insufficient_scope (scope: ${scope})`,
          )
          logEvent('tengu_mcp_tool_call_auth_error', {})
          throw new McpAuthError(
            name,
            `MCP server "${name}" needs additional permissions (scope: "${scope}") — run /mcp to re-authenticate`,
            'insufficient_scope',
            undefined,
            scope,
          )
        }
      }

      // Official 2.1.326 #81: If a remote MCP server's elicitation question was
      // declined during this call and the server then failed the call with a
      // JSON-RPC error (other than -32003 needs_approval / -32042 url_elicitation),
      // tell Claude the decline still stands.
      if (
        errorCode !== -32003 &&
        errorCode !== ProtocolErrorCode.UrlElicitationRequired &&
        consumeMcpElicitationDeclinedDuringCall(name, toolStartTime)
      ) {
        throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
          formatMcpElicitationDeclinedError(e.message),
          'MCP tool failed after declined elicitation',
        )
      }

      // Official 2.1.326 #255 (`HHt` @335430481): When a `claudeai-proxy` call
      // is cut off after it was sent (connection closed, timeout, network drop,
      // or 5xx), explicitly tell Claude that the call's outcome is unknown.
      if (isClaudeAiProxyCutOffAfterSend(e, config.type, signal.aborted)) {
        logMCPDebug(
          name,
          `Tool '${tool}' failed: its POST through the proxy does not show whether the server got the call`,
        )
        if (isMcpConnectionClosedError(e)) {
          await clearServerCache(name, config)
        }
        throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
          `${e.message.trimEnd()}\n${MCP_CALL_OUTCOME_UNKNOWN_NOTE}`,
          'MCP call went out and got no answer',
        )
      }

      // Official WZe expired arm:
      // `te=q2t(E)` (404/-32001) OR
      // `(E instanceof hr && E.code === mr.ConnectionClosed ||
      //   E instanceof us && E.code === -32000 && message includes Connection closed)
      //  && (http || claudeai-proxy)`
      // then clear cache + throw VS (session_expired_404 / connection_closed_http).
      const isSessionExpired = isMcpSessionExpiredError(e)
      const isConnectionClosedOnHttp =
        isMcpConnectionClosedError(e) &&
        (config.type === 'http' || config.type === 'claudeai-proxy')
      if (isSessionExpired || isConnectionClosedOnHttp) {
        logMCPDebug(
          name,
          `MCP session expired during tool call (${isSessionExpired ? '404/-32001' : 'connection closed'}), clearing connection cache for re-initialization`,
        )
        logEvent('tengu_mcp_session_expired', {})
        await clearServerCache(name, config)
        throw new McpSessionExpiredError(
          name,
          isSessionExpired ? 'session_expired_404' : 'connection_closed_http',
        )
      }
    }

    // densable 2.1.246 #10 WZe:
    // `if(!(E instanceof Error&&E.name==="AbortError")&&!(a?.aborted===!0&&E instanceof hr))throw E`
    // SEA `hr` @211850148 is v2 `SdkError` (`this.name="SdkError"`,
    // `mcpBrand:"mcp.SdkError"`). `SdkHttpError` extends it. The old
    // `F`/`McpError` class @210489608 is a different binding (`us` in
    // the ConnectionClosed arm), not this abort predicate.
    if (
      !(e instanceof Error && e.name === 'AbortError') &&
      !(signal.aborted === true && e instanceof SdkError)
    ) {
      throw e
    }
    return {
      content: MCP_TOOL_CALL_INTERRUPTED,
      interrupted: true,
      isError: true,
    }
  } finally {
    // Always clear intervals + mid-call drop watchdog registration
    if (progressInterval !== undefined) {
      clearInterval(progressInterval)
    }
    transportState?.activeCallWatchdogs.delete(callWatchdog)
  }
}
