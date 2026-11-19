import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { isMcpSessionExpiredError as isMcpSessionExpiredErrorFromPackage } from '@claude-code/mcp-client'
import {
  createFetchWithInit,
  type FetchLike,
} from '@modelcontextprotocol/client'
import pMap from 'p-map'
import type { Tool } from '../../Tool.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
  handleOAuth401Error,
} from '../../utils/auth.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../utils/errors.js'
import { logMCPDebug, logMCPError } from '../../utils/log.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  ClaudeAuthProvider,
  dialedWithoutOAuth,
  getServerKey,
  hasRecentTransientMcpRefreshFailure,
  wrapFetchWithStepUpDetection,
} from './auth.js'
import {
  getCliOwnedAsyncBearerProvider,
  getCliOwnedBearerProvider,
  isCliOwnedBearerConfig,
  isCliOwnedConfig,
  wrapCliOwnedFetch,
} from './cliOwnedConfigs.js'
import {
  type ConnectAuthFlags,
  type ConnectAuthHeaderRejection,
  classifyConnectAuthHeaderRejection,
  connectAuthStatusCode,
  resolveConnectAuthFlags,
  shouldSkipOAuthAuthProvider,
} from './connectAuthClassify.js'
import { getMcpTimeoutMs } from './mcpConnectTimeout.js'
import {
  type FirstPartyAuthRejection,
  type FirstPartyBearerBag,
  shouldUseFirstPartyAutoAuth,
  wrapFirstPartyAutoAuthFetch,
} from './mcpFirstPartyAutoAuth.js'
import type {
  MCPServerConnection,
  McpHTTPServerConfig,
  McpSSEServerConfig,
  ScopedMcpServerConfig,
} from './types.js'
import { getLoggingSafeMcpBaseUrl } from './utils.js'

/**
 * Custom error class to indicate that an MCP tool call failed due to
 * authentication issues (e.g., expired OAuth token returning 401).
 * This error should be caught at the tool execution layer to update
 * the client's status to 'needs-auth'.
 */
export class McpAuthError extends Error {
  serverName: string
  authErrorKind: 'token_expired' | 'insufficient_scope' | 'not_connected'
  firstPartyBearer?: unknown
  requestedScope?: string
  constructor(
    serverName: string,
    message: string,
    authErrorKind:
      | 'token_expired'
      | 'insufficient_scope'
      | 'not_connected' = 'token_expired',
    firstPartyBearer?: unknown,
    requestedScope?: string,
  ) {
    super(message)
    this.name = 'McpAuthError'
    this.serverName = serverName
    this.authErrorKind = authErrorKind
    this.firstPartyBearer = firstPartyBearer
    this.requestedScope = requestedScope
  }
}

export type McpSessionExpiryKind =
  | 'session_expired_404'
  | 'connection_closed_call_refused'
  | 'connection_closed_call_not_run'
  | 'connection_closed_http'

/**
 * Thrown when an MCP session has expired and the connection cache has been cleared.
 * The caller should get a fresh client via ensureConnectedClient and retry
 * (gated by `mayHaveRun` / `readOnlyHint` / `idempotentHint`).
 */
export class McpSessionExpiredError extends Error {
  readonly expiryKind: McpSessionExpiryKind

  constructor(
    serverName: string,
    expiryKind: McpSessionExpiryKind = 'session_expired_404',
  ) {
    super(`MCP server "${serverName}" session expired`)
    this.name = 'McpSessionExpiredError'
    this.expiryKind = expiryKind
  }

  get mayHaveRun(): boolean {
    switch (this.expiryKind) {
      case 'session_expired_404':
      case 'connection_closed_call_refused':
      case 'connection_closed_call_not_run':
        return false
      case 'connection_closed_http':
      default:
        return true
    }
  }
}

/**
 * 2.1.307 #1078 (SEA zlt): Thrown when the credential store (e.g. locked macOS
 * login keychain) cannot be read, so the client does not report stored
 * credentials as absent / overwrite needs-auth state.
 */
export class McpCredentialStoreUnavailableError extends TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  readonly code = 'CREDENTIAL_STORE_UNAVAILABLE' as const

  constructor(
    serverName: string,
    reason: 'unreadable' | 'read-too-late' = 'unreadable',
  ) {
    if (reason === 'unreadable') {
      super(
        `Couldn't read the stored credentials for MCP server "${serverName}", so the request didn't run. ${process.platform === 'darwin' ? "If your Mac's keychain is locked, unlock it, then try again." : 'Try again.'}`,
        'MCP credential store could not be read',
      )
    } else {
      super(
        `A request to MCP server "${serverName}" was sent without your stored credentials, so the server rejected it. The credentials are available now. Try again.`,
        'MCP credentials were read only after a request went out without them',
      )
    }
    this.name = 'McpCredentialStoreUnavailableError'
  }
}

/**
 * Thrown when an MCP tool returns `isError: true`. Carries the result's `_meta`
 * so SDK consumers can still receive it — per the MCP spec, `_meta` is on the
 * base Result type and is valid on error results.
 */
export class McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS extends TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  constructor(
    message: string,
    telemetryMessage: string,
    readonly mcpMeta?: { _meta?: Record<string, unknown> },
  ) {
    super(message, telemetryMessage)
    this.name = 'McpToolCallError'
  }
}

/**
 * Detects whether an error is an MCP "Session not found" error (HTTP 404 + JSON-RPC code -32001).
 * Per the MCP spec, servers return 404 when a session ID is no longer valid.
 * We check both signals to avoid false positives from generic 404s (wrong URL, server gone, etc.).
 */
export const isMcpSessionExpiredError = isMcpSessionExpiredErrorFromPackage

const MCP_AUTH_CACHE_TTL_MS = 15 * 60 * 1000 // 15 min

type McpAuthCacheData = Record<string, { timestamp: number }>

function getMcpAuthCachePath(): string {
  return join(getClaudeConfigHomeDir(), 'mcp-needs-auth-cache.json')
}

// Memoized so N concurrent isMcpAuthCached() calls during batched connection
// share a single file read instead of N reads of the same file. Invalidated
// on write (setMcpAuthCacheEntry) and clear (clearMcpAuthCache). Not using
// lodash memoize because we need to null out the cache, not delete by key.
let authCachePromise: Promise<McpAuthCacheData> | null = null

function getMcpAuthCache(): Promise<McpAuthCacheData> {
  if (!authCachePromise) {
    authCachePromise = readFile(getMcpAuthCachePath(), 'utf-8')
      .then(data => jsonParse(data) as McpAuthCacheData)
      .catch(() => ({}))
  }
  return authCachePromise
}

export async function isMcpAuthCached(serverId: string): Promise<boolean> {
  const cache = await getMcpAuthCache()
  const entry = cache[serverId]
  if (!entry) {
    return false
  }
  return Date.now() - entry.timestamp < MCP_AUTH_CACHE_TTL_MS
}

// Serialize cache writes through a promise chain to prevent concurrent
// read-modify-write races when multiple servers return 401 in the same batch
let writeChain = Promise.resolve()

export function setMcpAuthCacheEntry(serverId: string): void {
  writeChain = writeChain
    .then(async () => {
      const cache = await getMcpAuthCache()
      cache[serverId] = { timestamp: Date.now() }
      const cachePath = getMcpAuthCachePath()
      await mkdir(dirname(cachePath), { recursive: true })
      await writeFile(cachePath, jsonStringify(cache))
      // Invalidate the read cache so subsequent reads see the new entry.
      // Safe because writeChain serializes writes: the next write's
      // getMcpAuthCache() call will re-read the file with this entry present.
      authCachePromise = null
    })
    .catch(() => {
      // Best-effort cache write
    })
}

export function clearMcpAuthCache(): void {
  authCachePromise = null
  void unlink(getMcpAuthCachePath()).catch(() => {
    // Cache file may not exist
  })
}

/**
 * Spread-ready analytics field for the server's base URL. Calls
 * getLoggingSafeMcpBaseUrl once (not twice like the inline ternary it replaces).
 * Typed as AnalyticsMetadata since the URL is query-stripped and safe to log.
 */
export function mcpBaseUrlAnalytics(serverRef: ScopedMcpServerConfig): {
  mcpServerBaseUrl?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
} {
  const url = getLoggingSafeMcpBaseUrl(serverRef)
  return url
    ? {
        mcpServerBaseUrl:
          url as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }
    : {}
}

/**
 * Shared handler for sse/http/claudeai-proxy auth failures during connect:
 * emits tengu_mcp_server_needs_auth, caches the needs-auth entry, and returns
 * the needs-auth connection result.
 */
export function wrapRemoteMcpFetch(
  authProvider: ClaudeAuthProvider | undefined,
  firstPartyBag?: FirstPartyBearerBag,
  serverRef?: object,
): FetchLike {
  const base = createFetchWithInit()
  let fetch: FetchLike = authProvider
    ? wrapFetchWithStepUpDetection(base, authProvider)
    : base
  // Gold: if(k) U=jZe(U,k); U=St(U,t); if(L) U=Gt(U,d).
  // Gt = Hr — per-request Ukn/Bkn/jkn on cli-owned configs (not Bt).
  fetch = wrapFetchWithTimeout(fetch)
  if (firstPartyBag) {
    fetch = wrapFirstPartyAutoAuthFetch(fetch, firstPartyBag) as FetchLike
  }
  if (serverRef && isCliOwnedConfig(serverRef)) {
    fetch = wrapCliOwnedFetch(fetch as never, serverRef) as FetchLike
  }
  return fetch
}

export function connectAuthRejectedResult(
  name: string,
  serverRef: ScopedMcpServerConfig,
  transportType: 'sse' | 'http',
  classified: ConnectAuthHeaderRejection | FirstPartyAuthRejection,
): MCPServerConnection {
  logEvent('tengu_mcp_server_connection_failed', {
    transportType:
      transportType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    errorCode:
      classified.errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...mcpBaseUrlAnalytics(serverRef),
  })
  logMCPError(name, classified.message)
  return {
    name,
    type: 'failed',
    config: serverRef,
    error: classified.message,
    errorCode: classified.errorCode,
    ...('displayDetail' in classified && classified.displayDetail !== undefined
      ? { displayDetail: classified.displayDetail }
      : {}),
  }
}

export function maybeConnectAuthHeaderRejection(
  error: unknown,
  flags: ConnectAuthFlags | undefined,
): ConnectAuthHeaderRejection | undefined {
  if (!flags) return undefined
  return classifyConnectAuthHeaderRejection({
    error,
    statusCode: connectAuthStatusCode(error),
    hasUserAuthHeader: flags.hasUserAuthHeader,
    helperMintsAuthHeader: flags.helperMintsAuthHeader,
  })
}

export async function resolveRemoteConnectAuth(
  name: string,
  serverRef: ScopedMcpServerConfig,
  combinedHeaders: Record<string, string>,
): Promise<{
  flags: ConnectAuthFlags
  authProvider: ClaudeAuthProvider | undefined
  useFirstPartyAuth: boolean
}> {
  const flags = resolveConnectAuthFlags(serverRef, combinedHeaders)
  // Official `k=ce||re||L||me?void 0:new EFe`.
  // ce/re = Authorization already set. me skip EFe stays Ste (sync bearer).
  // L !me uses bOe (sync or async). L = o$+Jn+mn token || (Vx && e9), not jo.
  const cliOwned =
    getCliOwnedBearerProvider(serverRef) !== undefined ||
    getCliOwnedAsyncBearerProvider(serverRef) !== undefined
  const useFirstPartyAuth = await shouldUseFirstPartyAutoAuth({
    type: serverRef.type,
    url: 'url' in serverRef ? serverRef.url : undefined,
    flags,
    cliOwned,
  })
  if (useFirstPartyAuth) {
    logEvent('tengu_mcp_first_party_auto_auth', {
      transportType:
        serverRef.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...mcpBaseUrlAnalytics(serverRef),
    })
  }
  const skipOAuth =
    ('url' in serverRef && dialedWithoutOAuth.get(name) === serverRef.url) ||
    shouldSkipOAuthAuthProvider(flags) ||
    isCliOwnedBearerConfig(serverRef) ||
    useFirstPartyAuth
  const authProvider = skipOAuth
    ? undefined
    : new ClaudeAuthProvider(
        name,
        serverRef as McpSSEServerConfig | McpHTTPServerConfig,
      )
  return { flags, authProvider, useFirstPartyAuth }
}

export function handleRemoteAuthFailure(
  name: string,
  serverRef: ScopedMcpServerConfig,
  transportType: 'sse' | 'http' | 'claudeai-proxy',
): MCPServerConnection {
  // Official 2.1.325 #2304: if OAuth token refresh only suffered a brief
  // transient refusal (5xx / timeout / non-permanent OAuth error), do NOT
  // stick the server in the 15-minute needs-auth cache — allow automatic
  // recovery and keep mcp_tool hooks active on retry.
  const isTransientRefresh =
    (serverRef.type === 'sse' || serverRef.type === 'http') &&
    hasRecentTransientMcpRefreshFailure(getServerKey(name, serverRef))
  if (isTransientRefresh) {
    logMCPDebug(
      name,
      `Transient token refresh failure — skipping sticky needs-auth cache so next call can recover`,
    )
    return {
      name,
      type: 'failed',
      config: serverRef,
      error: 'Temporary OAuth token refresh failure',
      errorCode: 'TRANSIENT_REFRESH_FAILED',
    }
  }
  logEvent('tengu_mcp_server_needs_auth', {
    transportType:
      transportType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...mcpBaseUrlAnalytics(serverRef),
  })
  const label: Record<typeof transportType, string> = {
    sse: 'SSE',
    http: 'HTTP',
    'claudeai-proxy': 'claude.ai proxy',
  }
  logMCPDebug(
    name,
    `Authentication required for ${label[transportType]} server`,
  )
  setMcpAuthCacheEntry(name)
  return { name, type: 'needs-auth', config: serverRef }
}

/**
 * densable LOs / ClaudeAiProxyBearerRejectedError — session token rejected by
 * claude.ai proxy after refresh attempt. Distinct from generic 401 so tools/list
 * can set discoveryBearerRejected and UI can prompt `/login` without flipping
 * the client to needs-auth.
 */
export class ClaudeAiProxyBearerRejectedError extends Error {
  code = 'CLAUDEAI_BEARER_REJECTED' as const
  reasonCode = 'claudeai_bearer_rejected' as const
  constructor() {
    super(
      'claude.ai rejected the session token — it may lack connector scopes or be invalid. Run /login.',
    )
    this.name = 'ClaudeAiProxyBearerRejectedError'
  }
}

/** densable kXe — Error with code CLAUDEAI_BEARER_REJECTED. */
export function isClaudeAiBearerRejectedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: unknown }).code === 'CLAUDEAI_BEARER_REJECTED'
  )
}

/**
 * #2002: Remember the last claude.ai bearer token rejected by the connector
 * gateway so that when the user runs `/login` in another terminal and a new
 * access token lands in storage, subsequent messages/calls automatically
 * detect the refreshed sign-in and reconnect instead of staying stuck in a
 * failed state.
 */
let lastRejectedClaudeAiBearerToken: string | undefined

export function recordRejectedClaudeAiBearerToken(token: string): void {
  lastRejectedClaudeAiBearerToken = token
}

export function clearRejectedClaudeAiBearerToken(): void {
  lastRejectedClaudeAiBearerToken = undefined
}

export function hasClaudeAiBearerRecoveredAfterLogin(
  readToken: () => string | undefined = () =>
    getClaudeAIOAuthTokens()?.accessToken,
): boolean {
  if (!lastRejectedClaudeAiBearerToken) return false
  const current = readToken()
  return Boolean(current && current !== lastRejectedClaudeAiBearerToken)
}

/**
 * Fetch wrapper for claude.ai proxy connections. Attaches the OAuth bearer
 * token and retries once on 401 via handleOAuth401Error (force-refresh).
 *
 * densable Xmd: after 401 + !tokenChanged + token still same → throw
 * ClaudeAiProxyBearerRejectedError (not return 401). That surfaces
 * discoveryBearerRejected on tools/list while keeping the client connected.
 *
 * The Anthropic API path has this retry (withRetry.ts, grove.ts) to handle
 * memoize-cache staleness and clock drift. Without the same here, a single
 * stale token mass-401s every claude.ai connector and sticks them all in the
 * 15-min needs-auth cache.
 */
export function createClaudeAiProxyFetch(innerFetch: FetchLike): FetchLike {
  return async (url, init) => {
    const doRequest = async () => {
      await checkAndRefreshOAuthTokenIfNeeded()
      const currentTokens = getClaudeAIOAuthTokens()
      if (!currentTokens) {
        throw new Error('No claude.ai OAuth token available')
      }
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${currentTokens.accessToken}`)
      const redirect: RequestRedirect =
        init?.redirect === 'error' ? 'error' : 'manual'
      const response = await innerFetch(url, { ...init, headers, redirect })
      // Return the exact token that was sent. Reading getClaudeAIOAuthTokens()
      // again after the request is wrong under concurrent 401s: another
      // connector's handleOAuth401Error clears the memoize cache, so we'd read
      // the NEW token from keychain, pass it to handleOAuth401Error, which
      // finds same-as-keychain → returns false → skips retry. Same pattern as
      // bridgeApi.ts withOAuthRetry (token passed as fn param).
      return { response, sentToken: currentTokens.accessToken }
    }

    const { response, sentToken } = await doRequest()
    if (response.status !== 401) {
      return response
    }
    // densable: proxy-classified error code → return 401 (not bearer-reject throw)
    const proxyErrorCode = response.headers.get('X-Mcp-Error-Code') ?? undefined
    if (proxyErrorCode) {
      logEvent('tengu_mcp_claudeai_proxy_401', {
        tokenChanged:
          false as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        proxyErrorCode:
          proxyErrorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return response
    }
    // handleOAuth401Error returns true only if the token actually changed
    // (keychain had a newer one, or force-refresh succeeded). Gate retry on
    // that — otherwise we double round-trip time for every connector whose
    // downstream service genuinely needs auth (the common case: 30+ servers
    // with "MCP server requires authentication but no OAuth token configured").
    const tokenChanged = await handleOAuth401Error(sentToken).catch(() => false)
    logEvent('tengu_mcp_claudeai_proxy_401', {
      tokenChanged:
        tokenChanged as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (!tokenChanged) {
      // densable: ELOCKED contention check — if token still same, throw LOs
      // #2002: Also clear memoized token cache once so a fresh `/login` from
      // another terminal is immediately picked up on the next message.
      const now = getClaudeAIOAuthTokens()?.accessToken
      if (!now || now === sentToken) {
        recordRejectedClaudeAiBearerToken(sentToken)
        throw new ClaudeAiProxyBearerRejectedError()
      }
    }
    try {
      const retryResult = await doRequest()
      if (
        retryResult.response.status === 401 &&
        !retryResult.response.headers.get('X-Mcp-Error-Code')
      ) {
        recordRejectedClaudeAiBearerToken(retryResult.sentToken)
        throw new ClaudeAiProxyBearerRejectedError()
      }
      if (retryResult.response.status !== 401) {
        clearRejectedClaudeAiBearerToken()
      }
      return retryResult.response
    } catch (error) {
      // densable: retry itself failed — rethrow bearer reject; else return 401
      if (isClaudeAiBearerRejectedError(error)) throw error
      // Retry itself failed (network error). Return the original 401 so the
      // outer handler can classify it.
      return response
    }
  }
}

// Minimal interface for WebSocket instances passed to mcpWebSocketTransport
export type WsClientLike = {
  readonly readyState: number
  close(): void
  send(data: string): void
}

/**
 * Create a ws.WebSocket client with the MCP protocol.
 * Bun's ws shim types lack the 3-arg constructor (url, protocols, options)
 * that the real ws package supports, so we cast the constructor here.
 */
export async function createNodeWsClient(
  url: string,
  options: Record<string, unknown>,
): Promise<WsClientLike> {
  const wsModule = await import('ws')
  const WS = wsModule.default as unknown as new (
    url: string,
    protocols: string[],
    options: Record<string, unknown>,
  ) => WsClientLike
  return new WS(url, ['mcp'], options)
}

/** densable y0 — outer MCP connection race (MCP_TIMEOUT, default 30s). */
export function getConnectionTimeoutMs(): number {
  return getMcpTimeoutMs()
}

/**
 * Default timeout for individual MCP requests (auth, tool calls, etc.)
 */
export const MCP_REQUEST_TIMEOUT_MS = 60000

/**
 * MCP Streamable HTTP spec requires clients to advertise acceptance of both
 * JSON and SSE on every POST. Servers that enforce this strictly reject
 * requests without it (HTTP 406).
 * https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#sending-messages-to-the-server
 */
const MCP_STREAMABLE_HTTP_ACCEPT = 'application/json, text/event-stream'

/**
 * Wraps a fetch function to apply a fresh timeout signal to each request.
 * This avoids the bug where a single AbortSignal.timeout() created at connection
 * time becomes stale after 60 seconds, causing all subsequent requests to fail
 * immediately with "The operation timed out." Uses a 60-second timeout.
 *
 * Also ensures the Accept header required by the MCP Streamable HTTP spec is
 * present on POSTs. The MCP SDK sets this inside StreamableHTTPClientTransport.send(),
 * but it is attached to a Headers instance that passes through an object spread here,
 * and some runtimes/agents have been observed dropping it before it reaches the wire.
 * See https://github.com/anthropics/claude-agent-sdk-typescript/issues/202.
 * Normalizing here (the last wrapper before fetch()) guarantees it is sent.
 *
 * GET requests are excluded from the timeout since, for MCP transports, they are
 * long-lived SSE streams meant to stay open indefinitely. (Auth-related GETs use
 * a separate fetch wrapper with its own timeout in auth.ts.)
 *
 * @param baseFetch - The fetch function to wrap
 */
function isJsonRpcNotificationBody(
  body: RequestInit['body'] | undefined,
): boolean {
  if (typeof body !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(body)
    const messages = Array.isArray(parsed) ? parsed : [parsed]
    return (
      messages.length > 0 &&
      messages.every(
        (m): m is Record<string, unknown> =>
          typeof m === 'object' &&
          m !== null &&
          'method' in m &&
          (!('id' in m) || m.id === undefined),
      )
    )
  } catch {
    return false
  }
}

export function wrapFetchWithTimeout(baseFetch: FetchLike): FetchLike {
  return async (url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()

    // Skip timeout for GET requests - in MCP transports, these are long-lived SSE streams.
    // (OAuth discovery GETs in auth.ts use a separate createAuthFetch() with its own timeout.)
    if (method === 'GET') {
      return baseFetch(url, init)
    }

    // Normalize headers and guarantee the Streamable-HTTP Accept value. new Headers()
    // accepts HeadersInit | undefined and copies from plain objects, tuple arrays,
    // and existing Headers instances — so whatever shape the SDK handed us, the
    // Accept value survives the spread below as an own property of a concrete object.
    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    const headers = new Headers(init?.headers)
    if (!headers.has('accept')) {
      headers.set('accept', MCP_STREAMABLE_HTTP_ACCEPT)
    }

    // Use setTimeout instead of AbortSignal.timeout() so we can clearTimeout on
    // completion. AbortSignal.timeout's internal timer is only released when the
    // signal is GC'd, which in Bun is lazy — ~2.4KB of native memory per request
    // lingers for the full 60s even when the request completes in milliseconds.
    const controller = new AbortController()
    const timer = setTimeout(
      c =>
        c.abort(new DOMException('The operation timed out.', 'TimeoutError')),
      MCP_REQUEST_TIMEOUT_MS,
      controller,
    )
    timer.unref?.()

    const parentSignal = init?.signal
    const abort = () => controller.abort(parentSignal?.reason)
    parentSignal?.addEventListener('abort', abort)
    if (parentSignal?.aborted) {
      controller.abort(parentSignal.reason)
    }

    const cleanup = () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', abort)
    }

    try {
      const response = await baseFetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      })
      cleanup()
      // #643: @modelcontextprotocol/client calls await response.text() on
      // notification replies (e.g. 202 or !hasRequests); cancel the body so a
      // server that leaves the body open does not hang for 30s.
      if (
        method === 'POST' &&
        response.ok &&
        isJsonRpcNotificationBody(init?.body)
      ) {
        void response.body?.cancel().catch(() => {})
      }
      return response
    } catch (error) {
      cleanup()
      throw error
    }
  }
}

export function getMcpServerConnectionBatchSize(): number {
  return parseInt(process.env.MCP_SERVER_CONNECTION_BATCH_SIZE || '', 10) || 3
}

export function getRemoteMcpServerConnectionBatchSize(): number {
  return (
    parseInt(process.env.MCP_REMOTE_SERVER_CONNECTION_BATCH_SIZE || '', 10) ||
    20
  )
}

export function isLocalMcpServer(config: ScopedMcpServerConfig): boolean {
  return !config.type || config.type === 'stdio' || config.type === 'sdk'
}

// For the IDE MCP servers, we only include specific tools
const ALLOWED_IDE_TOOLS = ['mcp__ide__executeCode', 'mcp__ide__getDiagnostics']
export function isIncludedMcpTool(tool: Tool): boolean {
  return (
    !tool.name.startsWith('mcp__ide__') || ALLOWED_IDE_TOOLS.includes(tool.name)
  )
}

/**
 * Generates the cache key for a server connection
 * @param name Server name
 * @param serverRef Server configuration
 * @returns Cache key string
 */
export function getServerCacheKey(
  name: string,
  serverRef: ScopedMcpServerConfig,
): string {
  return `${name}-${jsonStringify(serverRef)}`
}

/**
 * Compares two MCP server configurations for equality (ignoring scope metadata).
 */
export function areMcpConfigsEqual(
  a: ScopedMcpServerConfig,
  b: ScopedMcpServerConfig,
): boolean {
  // Quick type check first
  if (a.type !== b.type) return false

  // Compare by serializing - this handles all config variations
  // We exclude 'scope' from comparison since it's metadata, not connection config
  const { scope: _scopeA, ...configA } = a
  const { scope: _scopeB, ...configB } = b
  return jsonStringify(configA) === jsonStringify(configB)
}

// Process items with bounded concurrency using p-map (sliding window), so a
// slow server only occupies one slot instead of blocking an entire batch
// boundary. Same concurrency ceiling, same results, better scheduling.
export async function processBatched<T>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<void>,
): Promise<void> {
  await pMap(items, processor, { concurrency })
}
