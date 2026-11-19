import reject from 'lodash-es/reject.js'
import { z } from 'zod/v4'
import {
  AuthenticationCancelledError,
  getActiveOAuthPromise,
  getOAuthCallbackState,
  getOAuthCallbackSubmitter,
  performMCPOAuthFlow,
  setActiveOAuthPromise,
} from 'src/services/mcp/auth.js'
import {
  clearMcpAuthCache,
  reconnectMcpServerImpl,
} from 'src/services/mcp/client.js'
import {
  buildMcpToolName,
  getMcpPrefix,
} from 'src/services/mcp/mcpStringUtils.js'
import type {
  McpHTTPServerConfig,
  McpSSEServerConfig,
  ScopedMcpServerConfig,
} from 'src/services/mcp/types.js'
import type { Tool, ToolUseContext } from 'src/Tool.js'
import { errorMessage } from 'src/utils/errors.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logMCPDebug, logMCPError } from 'src/utils/log.js'
import { mcpInfoSource } from 'src/utils/plugins/toolDescribe.js'
import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'

const inputSchema = lazySchema(() => z.object({}))
type InputSchema = ReturnType<typeof inputSchema>

const completeAuthInputSchema = lazySchema(() =>
  z.object({
    callback_url: z
      .string()
      .describe(
        'The full redirect callback URL copied from the browser address bar after authorizing.',
      ),
  }),
)
type CompleteAuthInputSchema = ReturnType<typeof completeAuthInputSchema>

export const COMPLETE_AUTH_SAFETY_REASON =
  "Claude submitted this URL. Approve only if you started this sign-in and just copied it from your own browser. A URL from anywhere else can connect this server to someone else's account."

export type McpAuthOutput = {
  status: 'auth_url' | 'unsupported' | 'error' | 'success'
  message: string
  authUrl?: string
}

function isUnanswerableForCompleteAuth(context: ToolUseContext): boolean {
  const permCtx = context.getAppState().toolPermissionContext
  return (
    permCtx.mode === 'dontAsk' || permCtx.shouldAvoidPermissionPrompts === true
  )
}

function hasValidCallbackParams(urlStr: string): boolean {
  try {
    const { searchParams } = new URL(urlStr)
    return Boolean(searchParams.get('code') || searchParams.get('error'))
  } catch {
    return false
  }
}

function getConfigUrl(config: ScopedMcpServerConfig): string | undefined {
  if ('url' in config) return config.url
  return undefined
}

/**
 * Creates a pseudo-tool for an MCP server that is installed but not
 * authenticated. Surfaced in place of the server's real tools so the model
 * knows the server exists and can start the OAuth flow on the user's behalf.
 *
 * When called, starts performMCPOAuthFlow with skipBrowserOpen and returns
 * the authorization URL. The OAuth callback completes in the background;
 * once it fires, reconnectMcpServerImpl runs and the server's real tools
 * are swapped into appState.mcp.tools via the existing prefix-based
 * replacement (useManageMCPConnections.updateServer wipes anything matching
 * mcp__<server>__*, so this pseudo-tool is removed automatically).
 */
export function createMcpAuthTool(
  serverName: string,
  config: ScopedMcpServerConfig,
): Tool<InputSchema, McpAuthOutput> {
  const url = getConfigUrl(config)
  const transport = config.type ?? 'stdio'
  const location = url ? `${transport} at ${url}` : transport

  const description =
    `The \`${serverName}\` MCP server (${location}) is installed but requires authentication. ` +
    `Call this tool to start the OAuth flow — you'll receive an authorization URL to share with the user. ` +
    `Once the user completes authorization in their browser, the server's real tools will become available automatically.`

  return {
    name: buildMcpToolName(serverName, 'authenticate'),
    isMcp: true,
    mcpInfo: {
      serverName,
      toolName: 'authenticate',
      // densable auth stub: `source:Tj(e,r)` (scope??source → hQ).
      source: mcpInfoSource(serverName, config),
    },
    isEnabled: () => true,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    toAutoClassifierInput: () => serverName,
    userFacingName: () => `${serverName} - authenticate (MCP)`,
    maxResultSizeChars: 10_000,
    renderToolUseMessage: () => `Authenticate ${serverName} MCP server`,
    async description() {
      return description
    },
    async prompt() {
      return description
    },
    get inputSchema(): InputSchema {
      return inputSchema()
    },
    async checkPermissions(input): Promise<PermissionDecision> {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(_input, context) {
      // claude.ai connectors use a separate auth flow (handleClaudeAIAuth in
      // MCPRemoteServerMenu) that we don't invoke programmatically here —
      // just point the user at /mcp.
      if (config.type === 'claudeai-proxy') {
        return {
          data: {
            status: 'unsupported' as const,
            message: `This is a claude.ai MCP connector. Ask the user to run /mcp and select "${serverName}" to authenticate.`,
          },
        }
      }

      // performMCPOAuthFlow only accepts sse/http. needs-auth state is only
      // set on HTTP 401 (UnauthorizedError) so other transports shouldn't
      // reach here, but be defensive.
      if (config.type !== 'sse' && config.type !== 'http') {
        return {
          data: {
            status: 'unsupported' as const,
            message: `Server "${serverName}" uses ${transport} transport which does not support OAuth from this tool. Ask the user to run /mcp and authenticate manually.`,
          },
        }
      }

      const sseOrHttpConfig = config as (
        | McpSSEServerConfig
        | McpHTTPServerConfig
      ) & { scope: ScopedMcpServerConfig['scope'] }

      // Mirror cli/print.ts mcp_authenticate: start the flow, capture the
      // URL via onAuthorizationUrl, return it immediately. The flow's
      // Promise resolves later when the browser callback fires.
      let resolveAuthUrl: ((url: string) => void) | undefined
      const authUrlPromise = new Promise<string>(resolve => {
        resolveAuthUrl = resolve
      })

      const controller = new AbortController()
      const { setAppState } = context

      const oauthPromise = performMCPOAuthFlow(
        serverName,
        sseOrHttpConfig,
        u => resolveAuthUrl?.(u),
        controller.signal,
        { skipBrowserOpen: true },
      )
      setActiveOAuthPromise(serverName, oauthPromise)

      // Background continuation: once OAuth completes, reconnect and swap
      // the real tools into appState. Prefix-based replacement removes this
      // pseudo-tool since it shares the mcp__<server>__ prefix.
      void oauthPromise
        .then(async () => {
          clearMcpAuthCache()
          const result = await reconnectMcpServerImpl(serverName, config)
          const prefix = getMcpPrefix(serverName)
          setAppState(prev => ({
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
                ...reject(prev.mcp.commands, c => c.name?.startsWith(prefix)),
                ...result.commands,
              ],
              resources: result.resources
                ? { ...prev.mcp.resources, [serverName]: result.resources }
                : prev.mcp.resources,
            },
          }))
          logMCPDebug(
            serverName,
            `OAuth complete, reconnected with ${result.tools.length} tool(s)`,
          )
        })
        .catch(err => {
          logMCPError(
            serverName,
            `OAuth flow failed after tool-triggered start: ${errorMessage(err)}`,
          )
        })

      try {
        // Race: get the URL, or the flow completes without needing one
        // (e.g. XAA with cached IdP token — silent auth).
        const authUrl = await Promise.race([
          authUrlPromise,
          oauthPromise.then(() => null as string | null),
        ])

        if (authUrl) {
          return {
            data: {
              status: 'auth_url' as const,
              authUrl,
              message: `Ask the user to open this URL in their browser to authorize the ${serverName} MCP server:\n\n${authUrl}\n\nOnce they complete the flow, the server's tools will become available automatically.`,
            },
          }
        }

        return {
          data: {
            status: 'auth_url' as const,
            message: `Authentication completed silently for ${serverName}. The server's tools should now be available.`,
          },
        }
      } catch (err) {
        return {
          data: {
            status: 'error' as const,
            message: `Failed to start OAuth flow for ${serverName}: ${errorMessage(err)}. Ask the user to run /mcp and authenticate manually.`,
          },
        }
      }
    },
    mapToolResultToToolResultBlockParam(data, toolUseID) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: data.message,
      }
    },
  } satisfies Tool<InputSchema, McpAuthOutput>
}

/**
 * #2171: Tool that finishes an in-progress MCP OAuth flow by submitting a
 * pasted callback URL. Always requires explicit user confirmation — even in
 * `bypassPermissions` and `auto` modes (`requiresUserInteraction: () => true`,
 * `suppressesAlwaysAllowRule: () => true`, `checkPermissions` returning `ask`
 * with `safetyCheck`). Where nobody can be asked (e.g. `dontAsk` mode or
 * `shouldAvoidPermissionPrompts`), instructs the user to finish via `/mcp`.
 */
export function createMcpCompleteAuthTool(
  serverName: string,
  config: ScopedMcpServerConfig,
): Tool<CompleteAuthInputSchema, McpAuthOutput> {
  const authToolName = buildMcpToolName(serverName, 'authenticate')
  const description =
    `Complete an in-progress OAuth flow for the "${serverName}" MCP server by submitting the callback URL. ` +
    `Call \`${authToolName}\` first to start the flow and get the authorization URL. ` +
    'After the user authorizes in their browser, the browser is redirected to a `http://localhost:<port>/callback?code=...&state=...` URL — ' +
    'on remote sessions that page fails to load, but the URL in the address bar is still valid. ' +
    'Pass that full URL here as `callback_url`. If the user declines this call, do not retry it. ' +
    'If this session cannot ask them, tell them to finish signing in by running /mcp.'

  const noFlowMessage = `No OAuth flow is in progress for ${serverName}; it may have timed out. Call \`${authToolName}\` to start a new one, then, once the user has approved it, ask them for the full URL in their browser's address bar.`
  const unanswerableMessage =
    "A URL pasted into this conversation cannot finish this sign-in. Ask the user to run /mcp in this session's terminal and sign in again there. If the browser then shows a connection error, they should paste the address from the browser's address bar into the box /mcp shows."
  const invalidCallbackMessage =
    "Invalid callback URL: missing authorization code. Ask the user to paste the full redirect URL from their browser's address bar, including the `?code=...&state=...` query string."
  const stateMismatchMessage = `That callback URL belongs to a different sign-in attempt for ${serverName} (its state does not match the flow in progress), or carries no authorization code. The current flow is still waiting: ask the user for the URL from the page this sign-in opened, then retry.`

  return {
    name: buildMcpToolName(serverName, 'complete_authentication'),
    isMcp: true,
    mcpInfo: {
      serverName,
      toolName: 'complete_authentication',
      source: mcpInfoSource(serverName, config),
    },
    isEnabled: () => true,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    requiresUserInteraction: () => true,
    suppressesAlwaysAllowRule: () => true,
    toAutoClassifierInput: () => serverName,
    userFacingName: () => `${serverName} - complete authentication (MCP)`,
    maxResultSizeChars: 10_000,
    renderToolUseMessage: () =>
      `Complete authentication for ${serverName} MCP server`,
    async description() {
      return description
    },
    async prompt() {
      return description
    },
    get inputSchema(): CompleteAuthInputSchema {
      return completeAuthInputSchema()
    },
    async validateInput({ callback_url }, context) {
      if (isUnanswerableForCompleteAuth(context)) {
        return {
          result: false,
          message: unanswerableMessage,
          errorCode: 3,
        }
      }
      if (!getOAuthCallbackSubmitter(serverName)) {
        return {
          result: false,
          message: noFlowMessage,
          errorCode: 1,
        }
      }
      if (!hasValidCallbackParams(callback_url)) {
        return {
          result: false,
          message: invalidCallbackMessage,
          errorCode: 2,
        }
      }
      const expectedState = getOAuthCallbackState(serverName)
      if (
        expectedState &&
        new URL(callback_url).searchParams.get('state') !== expectedState
      ) {
        return {
          result: false,
          message: stateMismatchMessage,
          errorCode: 4,
        }
      }
      return { result: true }
    },
    async checkPermissions(_input, context): Promise<PermissionDecision> {
      if (isUnanswerableForCompleteAuth(context)) {
        return {
          behavior: 'deny',
          message: unanswerableMessage,
          decisionReason: {
            type: 'safetyCheck',
            reason: COMPLETE_AUTH_SAFETY_REASON,
            classifierApprovable: false,
          },
        }
      }
      return {
        behavior: 'ask',
        message: `Finish signing in to ${serverName} with a callback URL.`,
        suggestions: [],
        decisionReason: {
          type: 'safetyCheck',
          reason: COMPLETE_AUTH_SAFETY_REASON,
          classifierApprovable: false,
        },
      }
    },
    async call({ callback_url }) {
      const submitter = getOAuthCallbackSubmitter(serverName)
      if (!submitter) {
        return {
          data: {
            status: 'error' as const,
            message: noFlowMessage,
          },
        }
      }
      if (!hasValidCallbackParams(callback_url)) {
        return {
          data: {
            status: 'error' as const,
            message: invalidCallbackMessage,
          },
        }
      }
      const activePromise = getActiveOAuthPromise(serverName)
      if (!submitter(callback_url)) {
        return {
          data: {
            status: 'error' as const,
            message: stateMismatchMessage,
          },
        }
      }
      try {
        if (activePromise) {
          await activePromise
        }
        return {
          data: {
            status: 'success' as const,
            message: `Authentication complete for ${serverName}. The server's tools should now be available.`,
          },
        }
      } catch (err) {
        if (err instanceof AuthenticationCancelledError) {
          return {
            data: {
              status: 'error' as const,
              message: `The OAuth flow for ${serverName} was cancelled (a newer attempt may have superseded it). Call \`${authToolName}\` again to restart.`,
            },
          }
        }
        return {
          data: {
            status: 'error' as const,
            message: `Authentication failed for ${serverName}: ${errorMessage(err)}`,
          },
        }
      }
    },
    mapToolResultToToolResultBlockParam(data, toolUseID) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: data.message,
      }
    },
  } satisfies Tool<CompleteAuthInputSchema, McpAuthOutput>
}

/**
 * Returns the MCP auth pseudo-tools for a `needs-auth` server:
 * `authenticate` plus `complete_authentication` for HTTP/SSE servers.
 */
export function createMcpAuthTools(
  serverName: string,
  config: ScopedMcpServerConfig,
): Tool[] {
  const tools: Tool[] = [createMcpAuthTool(serverName, config)]
  if (config.type === 'http' || config.type === 'sse') {
    tools.push(createMcpCompleteAuthTool(serverName, config))
  }
  return tools
}
