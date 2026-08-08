import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type {
  Resource,
  ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'

// Configuration schemas and types
export const ConfigScopeSchema = lazySchema(() =>
  z.enum([
    'local',
    'user',
    'project',
    'dynamic',
    'enterprise',
    'claudeai',
    'managed',
  ]),
)
export type ConfigScope = z.infer<ReturnType<typeof ConfigScopeSchema>>

export const TransportSchema = lazySchema(() =>
  z.enum(['stdio', 'sse', 'sse-ide', 'http', 'ws', 'sdk', 'claudeai-proxy']),
)
export type Transport = z.infer<ReturnType<typeof TransportSchema>>

/** Official 2.1.206: cap when folding `request_timeout_ms` into `timeout`. */
const MCP_REQUEST_TIMEOUT_MS_CAP = 300_000

/**
 * Official 2.1.206 `RAn`: CCR/`request_timeout_ms` wire hint folds into
 * `timeout` when `timeout` is unset (capped at 5 minutes).
 */
function foldRequestTimeoutMs<
  T extends { timeout?: number; request_timeout_ms?: number },
>(value: T): Omit<T, 'request_timeout_ms'> & { timeout?: number } {
  const { request_timeout_ms, ...rest } = value
  if (rest.timeout === undefined && request_timeout_ms !== undefined) {
    return {
      ...rest,
      timeout: Math.min(request_timeout_ms, MCP_REQUEST_TIMEOUT_MS_CAP),
    }
  }
  return rest
}

const requestTimeoutMsField = () =>
  z
    .number()
    .int()
    .positive()
    .optional()
    .catch(undefined)
    .describe('@internal CCR backend wire hint; folded into timeout at parse.')

export const McpStdioServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('stdio').optional(), // Optional for backwards compatibility
    command: z.string().min(1, 'Command cannot be empty'),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).optional(),
    // Official 2.1.187: per-server silent-run idle timeout (ms). Overrides
    // CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT for this server only.
    timeout: z.number().int().nonnegative().optional(),
  }),
)

// Cross-App Access (XAA / SEP-990): just a per-server flag. IdP connection
// details (issuer, clientId, callbackPort) come from settings.xaaIdp — configured
// once, shared across all XAA-enabled servers. clientId/clientSecret (parent
// oauth config + keychain slot) are for the MCP server's AS.
const McpXaaConfigSchema = lazySchema(() => z.boolean())

const McpOAuthConfigSchema = lazySchema(() =>
  z.object({
    clientId: z.string().optional(),
    callbackPort: z.number().int().positive().optional(),
    authServerMetadataUrl: z
      .string()
      .url()
      .startsWith('https://', {
        message: 'authServerMetadataUrl must use https://',
      })
      .optional(),
    xaa: McpXaaConfigSchema().optional(),
  }),
)

/**
 * Official 2.1.x: org/admin per-tool ceiling for remote MCP tools
 * (`allow` | `ask` | `blocked`). Drives auto-mode org_ask_ceiling and
 * strips blocked tools from the model tool list.
 */
export const McpToolPermissionSchema = lazySchema(() =>
  z.enum(['allow', 'ask', 'blocked']),
)
export type McpToolPermission = z.infer<
  ReturnType<typeof McpToolPermissionSchema>
>

export const McpSSEServerConfigSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('sse'),
      url: z.string(),
      headers: z.record(z.string(), z.string()).optional(),
      headersHelper: z.string().optional(),
      oauth: McpOAuthConfigSchema().optional(),
      // Official 2.1.187: per-server silent-run idle timeout (ms).
      timeout: z.number().int().nonnegative().optional(),
      // Official 2.1.206: CCR wire alias → folded into timeout at parse.
      request_timeout_ms: requestTimeoutMsField(),
      alwaysLoad: z.boolean().optional(),
      // Official: org max permission map keyed by upstream tool name.
      toolPermissions: z
        .record(z.string(), McpToolPermissionSchema())
        .optional(),
    })
    .transform(foldRequestTimeoutMs),
)

// Internal-only server type for IDE extensions
export const McpSSEIDEServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('sse-ide'),
    url: z.string(),
    ideName: z.string(),
    ideRunningInWindows: z.boolean().optional(),
  }),
)

// Internal-only server type for IDE extensions
export const McpWebSocketIDEServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('ws-ide'),
    url: z.string(),
    ideName: z.string(),
    authToken: z.string().optional(),
    ideRunningInWindows: z.boolean().optional(),
  }),
)

export const McpHTTPServerConfigSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('http'),
      url: z.string(),
      headers: z.record(z.string(), z.string()).optional(),
      headersHelper: z.string().optional(),
      oauth: McpOAuthConfigSchema().optional(),
      // Official 2.1.187: per-server silent-run idle timeout (ms).
      timeout: z.number().int().nonnegative().optional(),
      // Official 2.1.206: CCR wire alias → folded into timeout at parse.
      request_timeout_ms: requestTimeoutMsField(),
      alwaysLoad: z.boolean().optional(),
      // Official: org max permission map keyed by upstream tool name.
      toolPermissions: z
        .record(z.string(), McpToolPermissionSchema())
        .optional(),
    })
    .transform(foldRequestTimeoutMs),
)

export const McpWebSocketServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('ws'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    headersHelper: z.string().optional(),
    // Official 2.1.187: per-server silent-run idle timeout (ms).
    timeout: z.number().int().nonnegative().optional(),
  }),
)

export const McpSdkServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('sdk'),
    name: z.string(),
  }),
)

// Config type for Claude.ai proxy servers
export const McpClaudeAIProxyServerConfigSchema = lazySchema(() =>
  z.object({
    type: z.literal('claudeai-proxy'),
    url: z.string(),
    id: z.string(),
    displayName: z.string().optional(),
    iconUrl: z.string().optional(),
    timeout: z.number().int().nonnegative().optional(),
    alwaysLoad: z.boolean().optional(),
    // Official: org max permission map keyed by upstream tool name.
    toolPermissions: z.record(z.string(), McpToolPermissionSchema()).optional(),
    stateless: z.boolean().optional(),
    cachedInitResponse: z.record(z.string(), z.unknown()).nullish(),
    // densable 2.1.218: org connector eligibility from claude.ai API.
    // eligible===false means not connected/authorized in claude.ai — exclude
    // from needs-auth startup count unless session-connected this process.
    eligible: z.boolean().optional(),
    ineligibleReason: z.string().optional(),
  }),
)

export const McpServerConfigSchema = lazySchema(() =>
  z.union([
    McpStdioServerConfigSchema(),
    McpSSEServerConfigSchema(),
    McpSSEIDEServerConfigSchema(),
    McpWebSocketIDEServerConfigSchema(),
    McpHTTPServerConfigSchema(),
    McpWebSocketServerConfigSchema(),
    McpSdkServerConfigSchema(),
    McpClaudeAIProxyServerConfigSchema(),
  ]),
)

export type McpStdioServerConfig = z.infer<
  ReturnType<typeof McpStdioServerConfigSchema>
>
export type McpSSEServerConfig = z.infer<
  ReturnType<typeof McpSSEServerConfigSchema>
>
export type McpSSEIDEServerConfig = z.infer<
  ReturnType<typeof McpSSEIDEServerConfigSchema>
>
export type McpWebSocketIDEServerConfig = z.infer<
  ReturnType<typeof McpWebSocketIDEServerConfigSchema>
>
export type McpHTTPServerConfig = z.infer<
  ReturnType<typeof McpHTTPServerConfigSchema>
>
export type McpWebSocketServerConfig = z.infer<
  ReturnType<typeof McpWebSocketServerConfigSchema>
>
export type McpSdkServerConfig = z.infer<
  ReturnType<typeof McpSdkServerConfigSchema>
>
export type McpClaudeAIProxyServerConfig = z.infer<
  ReturnType<typeof McpClaudeAIProxyServerConfigSchema>
>
export type McpServerConfig = z.infer<ReturnType<typeof McpServerConfigSchema>>

export type ScopedMcpServerConfig = McpServerConfig & {
  scope: ConfigScope
  // For plugin-provided servers: the providing plugin's LoadedPlugin.source
  // (e.g. 'slack@anthropic'). Stashed at config-build time so the channel
  // gate doesn't have to race AppState.plugins.enabled hydration.
  pluginSource?: string
}

export const McpJsonConfigSchema = lazySchema(() =>
  z.object({
    mcpServers: z.record(z.string(), McpServerConfigSchema()),
  }),
)

export type McpJsonConfig = z.infer<ReturnType<typeof McpJsonConfigSchema>>

// Server connection types
/**
 * Official 2.1.x transportErrorState (O): shared across concurrent callTool
 * watchdogs on one connection. When onerror fires, all unarmed watchdogs get
 * armedAt=now; if still armed after 90s without progress/response, the call
 * aborts as "transport dropped mid-call".
 */
export type McpCallWatchdog = {
  armedAt: number
}

export type McpTransportErrorState = {
  consecutiveErrors: number
  activeCallWatchdogs: Set<McpCallWatchdog>
  pendingElicitations: number
  lastElicitationClosedAt: number
}

export type ConnectedMCPServer = {
  client: Client
  name: string
  type: 'connected'
  capabilities: ServerCapabilities
  serverInfo?: {
    name: string
    version: string
  }
  instructions?: string
  config: ScopedMcpServerConfig
  cleanup: () => Promise<void>
  /** Official transportErrorState — mid-call drop detection. */
  transportErrorState?: McpTransportErrorState
}

export type FailedMCPServer = {
  name: string
  type: 'failed'
  config: ScopedMcpServerConfig
  error?: string
  /**
   * densable 2.1.219 `Mvs` / connect catch: HTTP status string, Node errno,
   * or named code (INVALID_CONFIG, ENDPOINT_NOT_FOUND, …). Used by `mcp list`
   * / `/mcp` issue text (`fSp`/`mSp`).
   */
  errorCode?: string
  /** densable `displayDetail` — secondary detail appended after error. */
  displayDetail?: string
}

export type NeedsAuthMCPServer = {
  name: string
  type: 'needs-auth'
  config: ScopedMcpServerConfig
}

export type PendingMCPServer = {
  name: string
  type: 'pending'
  config: ScopedMcpServerConfig
  reconnectAttempt?: number
  maxReconnectAttempts?: number
}

export type DisabledMCPServer = {
  name: string
  type: 'disabled'
  config: ScopedMcpServerConfig
}

export type MCPServerConnection =
  | ConnectedMCPServer
  | FailedMCPServer
  | NeedsAuthMCPServer
  | PendingMCPServer
  | DisabledMCPServer

// Resource types
export type ServerResource = Resource & { server: string }

// MCP CLI State types
export interface SerializedTool {
  name: string
  description: string
  inputJSONSchema?: {
    [x: string]: unknown
    type: 'object'
    properties?: {
      [x: string]: unknown
    }
  }
  isMcp?: boolean
  originalToolName?: string // Original unnormalized tool name from MCP server
}

export interface SerializedClient {
  name: string
  type: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  capabilities?: ServerCapabilities
}

export interface MCPCliState {
  clients: SerializedClient[]
  configs: Record<string, ScopedMcpServerConfig>
  tools: SerializedTool[]
  resources: Record<string, ServerResource[]>
  normalizedNames?: Record<string, string> // Maps normalized names to original names
}
