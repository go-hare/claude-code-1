import { feature } from 'bun:bundle'
import {
  SSEClientTransport,
  type SSEClientTransportOptions,
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
  type FetchLike,
  type Transport,
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import {
  isMcpCcrProxyServerConfig,
  shouldApplyLegacyHttpSseGet401Guard,
  wrapLegacyHttpSseGet401Guard,
  createLegacyHttpSseFallbackFetches,
} from '../mcpConnectTimeout.js'
import { wrapFetchWithResponseLimit } from '../httpResponseLimit.js'
import mapValues from 'lodash-es/mapValues.js'
import { getProjectRoot, getSessionId } from '../../../bootstrap/state.js'
import { getOauthConfig } from '../../../constants/oauth.js'
import { getClaudeAIOAuthTokens } from '../../../utils/auth.js'
import { getMCPUserAgent } from '../../../utils/http.js'
import { logMCPDebug } from '../../../utils/log.js'
import { WebSocketTransport } from '../../../utils/mcpWebSocketTransport.js'
import { getWebSocketTLSOptions } from '../../../utils/mtls.js'
import {
  getProxyFetchOptions,
  getWebSocketProxyAgent,
  getWebSocketProxyUrl,
} from '../../../utils/proxy.js'
import {
  getCliOwnedBearerProvider,
  isCliOwnedBearerConfig,
} from '../cliOwnedConfigs.js'
import {
  getRegisteredUpstreamProxyEnv,
  subprocessEnv,
} from '../../../utils/subprocessEnv.js'
import { ClaudeAuthProvider } from '../auth.js'
import {
  isStatelessClaudeAiProxy,
  suppressGetSseOnEndpoint,
} from '../claudeAiProxyStateless.js'
import { getMcpServerHeaders } from '../headersHelper.js'
import type { ConnectAuthFlags } from '../connectAuthClassify.js'
import {
  isFirstPartyAnthropicMcpUrl,
  wrapFirstPartyAutoAuthFetch,
  type FirstPartyBearerBag,
} from '../mcpFirstPartyAutoAuth.js'
import type { McpStdioServerConfig, ScopedMcpServerConfig } from '../types.js'
import {
  createClaudeAiProxyFetch,
  createNodeWsClient,
  MCP_REQUEST_TIMEOUT_MS,
  resolveRemoteConnectAuth,
  wrapFetchWithTimeout,
  wrapRemoteMcpFetch,
  type WsClientLike,
} from '../connectionHelpers.js'
import { isClaudeInChromeMCPServer } from '../../../utils/claudeInChrome/common.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import {
  isComputerUseMCPServer,
  unsetEmptyAwsBearerTokenBedrock,
} from './errorsAndKeys.js'

export type InProcessMcpServer = {
  connect(t: Transport): Promise<void>
  close(): Promise<void>
}

export type LegacySseFallbackFactory = (opts: {
  postMethodNotAllowed: boolean
  dialSignal: AbortSignal
  dialConnected: () => boolean
}) => Transport

export type McpTransportBuildState = {
  inProcessServer: InProcessMcpServer | undefined
  connectAuthFlags: ConnectAuthFlags | undefined
  connectAuthProvider: ClaudeAuthProvider | undefined
  useFirstPartyAuth: boolean
  lacksHelperHeaders: boolean
  firstPartyBearerBag: FirstPartyBearerBag
}

export type InitialMcpTransportResult = {
  transport: Transport
  legacySseFallback: LegacySseFallbackFactory | undefined
}

export async function buildInitialMcpTransport(
  name: string,
  serverRef: ScopedMcpServerConfig,
  sessionIngressToken: string | null | undefined,
  transportState: McpTransportBuildState,
): Promise<InitialMcpTransportResult> {
  let transport: Transport
  let legacySseFallback: LegacySseFallbackFactory | undefined
  if (serverRef.type === 'sse') {
    // Get combined headers (static + dynamic) before deciding on OAuth.
    const combinedHeaders = await getMcpServerHeaders(name, serverRef, {
      onHelperFailed: () => {
        transportState.lacksHelperHeaders = true
      },
    })
    const remoteAuth = await resolveRemoteConnectAuth(
      name,
      serverRef,
      combinedHeaders,
    )
    transportState.connectAuthFlags = remoteAuth.flags
    transportState.useFirstPartyAuth = remoteAuth.useFirstPartyAuth
    const authProvider = remoteAuth.authProvider
    const firstPartyBag = transportState.useFirstPartyAuth
      ? transportState.firstPartyBearerBag
      : undefined

    // Use the auth provider with SSEClientTransport
    const transportOptions: SSEClientTransportOptions = {
      ...(authProvider
        ? { authProvider, skipIssuerMetadataValidation: true }
        : {}),
      // Use fresh timeout per request to avoid stale AbortSignal bug.
      // Step-up detection wraps innermost so the 403 is seen before the
      // SDK's handler calls auth() → tokens().
      fetch: wrapRemoteMcpFetch(authProvider, firstPartyBag, serverRef),
      requestInit: {
        ...((isMcpCcrProxyServerConfig(serverRef) ||
          isFirstPartyAnthropicMcpUrl(serverRef.url)) && {
          redirect: 'manual' as const,
        }),
        headers: {
          'User-Agent': getMCPUserAgent(),
          ...combinedHeaders,
        },
      },
    }

    // IMPORTANT: Always set eventSourceInit with a fetch that does NOT use the
    // timeout wrapper. The EventSource connection is long-lived (stays open indefinitely
    // to receive server-sent events), so applying a 60-second timeout would kill it.
    // The timeout is only meant for individual API requests (POST, auth refresh), not
    // the persistent SSE stream.
    const sseEventSourceFetch: FetchLike = async (url, init) => {
      // Get auth headers from the auth provider
      const authHeaders: Record<string, string> = {}
      const tokens = await authProvider?.tokens()
      if (tokens) {
        authHeaders.Authorization = `Bearer ${tokens.access_token}`
      }

      const proxyOptions = getProxyFetchOptions()
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      return fetch(url, {
        ...init,
        ...proxyOptions,
        headers: {
          'User-Agent': getMCPUserAgent(),
          ...authHeaders,
          ...init?.headers,
          ...combinedHeaders,
          Accept: 'text/event-stream',
        },
      })
    }
    // Gold: v?Trn(ve,v):X?Bt(ve,u,he):ve — L wrap, not timeout (GET SSE).
    const sseFetch = firstPartyBag
      ? wrapFirstPartyAutoAuthFetch(sseEventSourceFetch, firstPartyBag)
      : sseEventSourceFetch
    transportOptions.eventSourceInit = {
      fetch: sseFetch,
    }

    transport = new SSEClientTransport(new URL(serverRef.url), transportOptions)
    logMCPDebug(name, `SSE transport initialized, awaiting connection`)
  } else if (serverRef.type === 'sse-ide') {
    logMCPDebug(name, `Setting up SSE-IDE transport to ${serverRef.url}`)
    // IDE servers don't need authentication
    // TODO: Use the auth token provided in the lockfile
    const proxyOptions = getProxyFetchOptions()
    const transportOptions: SSEClientTransportOptions = proxyOptions.dispatcher
      ? {
          eventSourceInit: {
            fetch: async (url, init) => {
              // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
              return fetch(url, {
                ...init,
                ...proxyOptions,
                headers: {
                  'User-Agent': getMCPUserAgent(),
                  ...init?.headers,
                },
              })
            },
          },
        }
      : {}

    transport = new SSEClientTransport(
      new URL(serverRef.url),
      Object.keys(transportOptions).length > 0 ? transportOptions : undefined,
    )
  } else if (serverRef.type === 'ws-ide') {
    const tlsOptions = getWebSocketTLSOptions()
    const wsHeaders = {
      'User-Agent': getMCPUserAgent(),
      ...(serverRef.authToken && {
        'X-Claude-Code-Ide-Authorization': serverRef.authToken,
      }),
    }

    let wsClient: WsClientLike
    if (typeof Bun !== 'undefined') {
      // Bun's WebSocket supports headers/proxy/tls options but the DOM typings don't
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      wsClient = new globalThis.WebSocket(serverRef.url, {
        protocols: ['mcp'],
        headers: wsHeaders,
        proxy: getWebSocketProxyUrl(serverRef.url),
        tls: tlsOptions || undefined,
      } as unknown as string[])
    } else {
      wsClient = await createNodeWsClient(serverRef.url, {
        headers: wsHeaders,
        agent: getWebSocketProxyAgent(serverRef.url),
        ...(tlsOptions || {}),
      })
    }
    transport = new WebSocketTransport(wsClient)
  } else if (serverRef.type === 'ws') {
    logMCPDebug(name, `Initializing WebSocket transport to ${serverRef.url}`)

    const combinedHeaders = await getMcpServerHeaders(name, serverRef)

    const tlsOptions = getWebSocketTLSOptions()
    const wsHeaders = {
      'User-Agent': getMCPUserAgent(),
      ...(sessionIngressToken && {
        Authorization: `Bearer ${sessionIngressToken}`,
      }),
      ...combinedHeaders,
    }

    // Redact sensitive headers before logging
    const wsHeadersForLogging = mapValues(wsHeaders, (value, key) =>
      key.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
    )

    logMCPDebug(
      name,
      `WebSocket transport options: ${jsonStringify({
        url: serverRef.url,
        headers: wsHeadersForLogging,
        hasSessionAuth: !!sessionIngressToken,
      })}`,
    )

    let wsClient: WsClientLike
    if (typeof Bun !== 'undefined') {
      // Bun's WebSocket supports headers/proxy/tls options but the DOM typings don't
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      wsClient = new globalThis.WebSocket(serverRef.url, {
        protocols: ['mcp'],
        headers: wsHeaders,
        proxy: getWebSocketProxyUrl(serverRef.url),
        tls: tlsOptions || undefined,
      } as unknown as string[])
    } else {
      wsClient = await createNodeWsClient(serverRef.url, {
        headers: wsHeaders,
        agent: getWebSocketProxyAgent(serverRef.url),
        ...(tlsOptions || {}),
      })
    }
    transport = new WebSocketTransport(wsClient)
  } else if (serverRef.type === 'http') {
    logMCPDebug(name, `Initializing HTTP transport to ${serverRef.url}`)
    logMCPDebug(
      name,
      `Node version: ${process.version}, Platform: ${process.platform}`,
    )
    logMCPDebug(
      name,
      `Environment: ${jsonStringify({
        NODE_OPTIONS: process.env.NODE_OPTIONS || 'not set',
        UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || 'default',
        HTTP_PROXY: process.env.HTTP_PROXY || 'not set',
        HTTPS_PROXY: process.env.HTTPS_PROXY || 'not set',
        NO_PROXY: process.env.NO_PROXY || 'not set',
      })}`,
    )

    // Get combined headers (static + dynamic) before deciding on OAuth.
    const combinedHeaders = await getMcpServerHeaders(name, serverRef, {
      onHelperFailed: () => {
        transportState.lacksHelperHeaders = true
      },
    })
    const remoteAuth = await resolveRemoteConnectAuth(
      name,
      serverRef,
      combinedHeaders,
    )
    transportState.connectAuthFlags = remoteAuth.flags
    transportState.useFirstPartyAuth = remoteAuth.useFirstPartyAuth
    const authProvider = remoteAuth.authProvider
    transportState.connectAuthProvider = authProvider
    const firstPartyBag = transportState.useFirstPartyAuth
      ? transportState.firstPartyBearerBag
      : undefined

    // Check if this server has stored OAuth tokens. If so, the SDK's
    // authProvider will set Authorization — don't override with the
    // session ingress token (SDK merges requestInit AFTER authProvider).
    // CCR proxy URLs (ccr_shttp_mcp) have no stored OAuth, so they still
    // get the ingress token. See PR #24454 discussion.
    const hasOAuthTokens = !!(await authProvider?.tokens())
    // densable cliOwnedBearerProviders — bridge projects/meta mounts.
    // Prefer owned bearer; do not overwrite Authorization already in headers.
    const cliOwnedBearer = getCliOwnedBearerProvider(serverRef)?.()
    const hasAuthHeader = Object.keys(combinedHeaders).some(
      k => k.toLowerCase() === 'authorization',
    )
    const bearerToken =
      !hasOAuthTokens && !hasAuthHeader
        ? cliOwnedBearer || sessionIngressToken
        : undefined

    // Use the auth provider with StreamableHTTPClientTransport
    const proxyOptions = getProxyFetchOptions()
    logMCPDebug(
      name,
      `Proxy options: ${proxyOptions.dispatcher ? 'custom dispatcher' : 'default'}`,
    )

    const httpBaseFetch = wrapFetchWithResponseLimit(
      wrapRemoteMcpFetch(authProvider, firstPartyBag, serverRef),
    )
    const allowLegacySse = shouldApplyLegacyHttpSseGet401Guard({
      isCcrProxy: isMcpCcrProxyServerConfig(serverRef),
      isFirstPartyAnthropicMcp: isFirstPartyAnthropicMcpUrl(serverRef.url),
      isCliOwnedBearer: isCliOwnedBearerConfig(serverRef),
    })
    const transportOptions: StreamableHTTPClientTransportOptions = {
      ...(authProvider
        ? { authProvider, skipIssuerMetadataValidation: true }
        : {}),
      // Use fresh timeout per request to avoid stale AbortSignal bug.
      // Step-up detection wraps innermost so the 403 is seen before the
      // SDK's handler calls auth() → tokens().
      fetch: httpBaseFetch,
      requestInit: {
        ...proxyOptions,
        ...((isMcpCcrProxyServerConfig(serverRef) ||
          isFirstPartyAnthropicMcpUrl(serverRef.url)) && {
          redirect: 'manual' as const,
        }),
        headers: {
          'User-Agent': getMCPUserAgent(),
          ...(bearerToken && {
            Authorization: `Bearer ${bearerToken}`,
          }),
          ...combinedHeaders,
        },
      },
    }

    // Redact sensitive headers before logging
    const headersForLogging = transportOptions.requestInit?.headers
      ? mapValues(
          transportOptions.requestInit.headers as Record<string, string>,
          (value, key) =>
            key.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
        )
      : undefined

    logMCPDebug(
      name,
      `HTTP transport options: ${jsonStringify({
        url: serverRef.url,
        headers: headersForLogging,
        hasAuthProvider: !!authProvider,
        timeoutMs: MCP_REQUEST_TIMEOUT_MS,
      })}`,
    )

    transport = new StreamableHTTPClientTransport(
      new URL(serverRef.url),
      transportOptions,
    )
    logMCPDebug(name, `HTTP transport created successfully`)
    // densable W — HTTP→legacy SSE rescue factory (!HEe && !o$ && !ce).
    if (allowLegacySse) {
      const sseUrl = new URL(serverRef.url)
      const sseAuth = authProvider
      const sseRequestInit = transportOptions.requestInit
      legacySseFallback = ({
        postMethodNotAllowed,
        dialSignal,
        dialConnected,
      }) => {
        const { fetch, eventSourceFetch } = createLegacyHttpSseFallbackFetches({
          baseFetch: httpBaseFetch,
          postMethodNotAllowed,
          dialSignal,
          dialConnected,
        })
        return new SSEClientTransport(sseUrl, {
          ...(sseAuth
            ? { authProvider: sseAuth, skipIssuerMetadataValidation: true }
            : {}),
          fetch,
          eventSourceInit: { fetch: eventSourceFetch },
          requestInit: sseRequestInit,
        })
      }
    }
  } else if (serverRef.type === 'sdk') {
    throw new Error('SDK servers should be handled in print.ts')
  } else if (serverRef.type === 'claudeai-proxy') {
    logMCPDebug(
      name,
      `Initializing claude.ai proxy transport for server ${serverRef.id}`,
    )

    const tokens = getClaudeAIOAuthTokens()
    if (!tokens) {
      throw new Error('No claude.ai OAuth token found')
    }

    const oauthConfig = getOauthConfig()
    const proxyUrl = `${oauthConfig.MCP_PROXY_URL}${oauthConfig.MCP_PROXY_PATH.replace('{server_id}', serverRef.id)}`

    logMCPDebug(name, `Using claude.ai proxy at ${proxyUrl}`)

    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    const fetchWithAuth = createClaudeAiProxyFetch(globalThis.fetch)

    const proxyOptions = getProxyFetchOptions()
    const timedFetch = wrapFetchWithResponseLimit(
      wrapFetchWithTimeout(fetchWithAuth),
    )
    const transportOptions: StreamableHTTPClientTransportOptions = {
      // Wrap fetchWithAuth with fresh timeout per request.
      // densable: oGn(t)?F_f(dGn(oe,t),re):dGn(oe,t) + Accept-Encoding identity.
      fetch: isStatelessClaudeAiProxy(serverRef)
        ? suppressGetSseOnEndpoint(timedFetch, proxyUrl)
        : timedFetch,
      requestInit: {
        ...proxyOptions,
        headers: {
          'User-Agent': getMCPUserAgent(),
          'Accept-Encoding': 'identity',
          'X-Mcp-Client-Session-Id': getSessionId(),
        },
      },
    }

    transport = new StreamableHTTPClientTransport(
      new URL(proxyUrl),
      transportOptions,
    )
    logMCPDebug(name, `claude.ai proxy transport created successfully`)
  } else if (
    ((serverRef as ScopedMcpServerConfig).type === 'stdio' ||
      !(serverRef as ScopedMcpServerConfig).type) &&
    isClaudeInChromeMCPServer(name)
  ) {
    // Run the Chrome MCP server in-process to avoid spawning a ~325 MB subprocess
    const { createChromeContext } = await import(
      '../../../utils/claudeInChrome/mcpServer.js'
    )
    const { createChromeSocketClient, createClaudeForChromeMcpServer } =
      await import('@ant/claude-for-chrome-mcp')
    const { createLinkedTransportPair } = await import(
      '../InProcessTransport.js'
    )
    const { registerChromeTabGroupCleanup, setChromeBinding } = await import(
      '../../../utils/claudeInChrome/tabGroupCleanup.js'
    )
    const context = createChromeContext((serverRef as McpStdioServerConfig).env)
    const socketClient = createChromeSocketClient(context)
    setChromeBinding(context, socketClient)
    registerChromeTabGroupCleanup()
    const chromeServer = createClaudeForChromeMcpServer(context, socketClient)
    transportState.inProcessServer = chromeServer
    const [clientTransport, serverTransport] = createLinkedTransportPair()
    await transportState.inProcessServer.connect(serverTransport)
    transport = clientTransport
    logMCPDebug(name, `In-process Chrome MCP server started`)
  } else if (
    feature('CHICAGO_MCP') &&
    ((serverRef as ScopedMcpServerConfig).type === 'stdio' ||
      !(serverRef as ScopedMcpServerConfig).type) &&
    isComputerUseMCPServer!(name)
  ) {
    // Run the Computer Use MCP server in-process — same rationale as
    // Chrome above. The package's CallTool handler is a stub; real
    // dispatch goes through wrapper.tsx's .call() override.
    const { createComputerUseMcpServerForCli } = await import(
      '../../../utils/computerUse/mcpServer.js'
    )
    const { createLinkedTransportPair } = await import(
      '../InProcessTransport.js'
    )
    transportState.inProcessServer = await createComputerUseMcpServerForCli()
    const [clientTransport, serverTransport] = createLinkedTransportPair()
    await transportState.inProcessServer.connect(serverTransport)
    transport = clientTransport
    logMCPDebug(name, `In-process Computer Use MCP server started`)
  } else if (
    (serverRef as ScopedMcpServerConfig).type === 'stdio' ||
    !(serverRef as ScopedMcpServerConfig).type
  ) {
    const stdioRef = serverRef as McpStdioServerConfig
    // Official SHELL_PREFIX densable.
    let shellPrefix: string | null =
      process.env.CLAUDE_CODE_SHELL_PREFIX || null
    try {
      const { resolveShellPrefix } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../utils/residualFinalEnvGates.js') as typeof import('../../../utils/residualFinalEnvGates.js')
      shellPrefix = resolveShellPrefix()
    } catch {
      // keep raw env fallback
    }
    const finalCommand = shellPrefix || stdioRef.command
    const finalArgs = shellPrefix
      ? [[stdioRef.command, ...stdioRef.args].join(' ')]
      : stdioRef.args
    // Official eUi densable consumer: eUi()?{...lqi(),...kVt()}:GO(), then
    // strip CLAUDE_CODE_CHILD_SESSION and inject PROJECT_DIR/SESSION_ID/CLAUDECODE.
    let stdioEnv: Record<string, string>
    try {
      const {
        shouldEnforceMcpAllowlistEnv,
        buildMcpStdioBaseEnv,
        buildMcpStdioTransportEnv,
      } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../utils/residualMoreEnvGates.js') as typeof import('../../../utils/residualMoreEnvGates.js')
      const base = buildMcpStdioBaseEnv({
        enforceAllowlist: shouldEnforceMcpAllowlistEnv(),
        processEnv: process.env,
        injectedEnv: getRegisteredUpstreamProxyEnv(),
        managedEnv: subprocessEnv(),
      })
      stdioEnv = buildMcpStdioTransportEnv({
        baseEnv: base,
        projectDir: getProjectRoot(),
        sessionId: getSessionId(),
        serverEnv: stdioRef.env ?? null,
      })
    } catch {
      // raw-env fallback when densables unavailable
      const { CLAUDE_CODE_CHILD_SESSION: _child, ...rest } =
        subprocessEnv() as Record<string, string | undefined>
      stdioEnv = {
        ...(Object.fromEntries(
          Object.entries(rest).filter(
            (e): e is [string, string] => e[1] !== undefined,
          ),
        ) as Record<string, string>),
        CLAUDE_PROJECT_DIR: getProjectRoot(),
        CLAUDE_CODE_SESSION_ID: getSessionId(),
        CLAUDECODE: '1',
        ...stdioRef.env,
      }
    }
    unsetEmptyAwsBearerTokenBedrock(stdioEnv)
    transport = new StdioClientTransport({
      command: finalCommand,
      args: finalArgs,
      env: stdioEnv,
      stderr: 'pipe', // prevents error output from the MCP server from printing to the UI
    })
  } else {
    throw new Error(
      `Unsupported server type: ${(serverRef as ScopedMcpServerConfig).type}`,
    )
  }
  return { transport, legacySseFallback }
}

export async function recreateMcpTransportForPinnedLegacy(
  name: string,
  serverRef: ScopedMcpServerConfig,
  sessionIngressToken: string | null | undefined,
  transportState: McpTransportBuildState,
): Promise<Transport> {
  // densable `l=u()` / `l=new por(c)` — rebuild same transport kind for legacy.
  if (serverRef.type === 'http') {
    const combinedHeaders = await getMcpServerHeaders(name, serverRef, {
      onHelperFailed: () => {
        transportState.lacksHelperHeaders = true
      },
    })
    const remoteAuth = await resolveRemoteConnectAuth(
      name,
      serverRef,
      combinedHeaders,
    )
    transportState.connectAuthFlags = remoteAuth.flags
    transportState.useFirstPartyAuth = remoteAuth.useFirstPartyAuth
    const authProvider = remoteAuth.authProvider
    transportState.connectAuthProvider = authProvider
    const firstPartyBag = transportState.useFirstPartyAuth
      ? transportState.firstPartyBearerBag
      : undefined
    const hasOAuthTokens = !!(await authProvider?.tokens())
    const cliOwnedBearer = getCliOwnedBearerProvider(serverRef)?.()
    const hasAuthHeader = Object.keys(combinedHeaders).some(
      k => k.toLowerCase() === 'authorization',
    )
    const bearerToken =
      !hasOAuthTokens && !hasAuthHeader
        ? cliOwnedBearer || sessionIngressToken
        : undefined
    const proxyOptions = getProxyFetchOptions()
    const httpFetch = wrapFetchWithResponseLimit(
      wrapLegacyHttpSseGet401Guard(
        wrapRemoteMcpFetch(authProvider, firstPartyBag, serverRef),
        shouldApplyLegacyHttpSseGet401Guard({
          isCcrProxy: isMcpCcrProxyServerConfig(serverRef),
          isFirstPartyAnthropicMcp: isFirstPartyAnthropicMcpUrl(serverRef.url),
          isCliOwnedBearer: isCliOwnedBearerConfig(serverRef),
        }),
      ),
    )
    const transportOptions: StreamableHTTPClientTransportOptions = {
      ...(authProvider
        ? { authProvider, skipIssuerMetadataValidation: true }
        : {}),
      fetch: httpFetch,
      requestInit: {
        ...proxyOptions,
        ...((isMcpCcrProxyServerConfig(serverRef) ||
          isFirstPartyAnthropicMcpUrl(serverRef.url)) && {
          redirect: 'manual' as const,
        }),
        headers: {
          'User-Agent': getMCPUserAgent(),
          ...(bearerToken && {
            Authorization: `Bearer ${bearerToken}`,
          }),
          ...combinedHeaders,
        },
      },
    }
    return new StreamableHTTPClientTransport(
      new URL(serverRef.url),
      transportOptions,
    )
  }
  if (serverRef.type === 'claudeai-proxy') {
    const tokens = getClaudeAIOAuthTokens()
    if (!tokens) {
      throw new Error('No claude.ai OAuth token found')
    }
    const oauthConfig = getOauthConfig()
    const proxyUrl = `${oauthConfig.MCP_PROXY_URL}${oauthConfig.MCP_PROXY_PATH.replace('{server_id}', serverRef.id)}`
    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    const fetchWithAuth = createClaudeAiProxyFetch(globalThis.fetch)
    const proxyOptions = getProxyFetchOptions()
    const timedFetch = wrapFetchWithResponseLimit(
      wrapFetchWithTimeout(fetchWithAuth),
    )
    const transportOptions: StreamableHTTPClientTransportOptions = {
      fetch: isStatelessClaudeAiProxy(serverRef)
        ? suppressGetSseOnEndpoint(timedFetch, proxyUrl)
        : timedFetch,
      requestInit: {
        ...proxyOptions,
        headers: {
          'User-Agent': getMCPUserAgent(),
          'Accept-Encoding': 'identity',
          'X-Mcp-Client-Session-Id': getSessionId(),
        },
      },
    }
    return new StreamableHTTPClientTransport(
      new URL(proxyUrl),
      transportOptions,
    )
  }
  // stdio (or untyped stdio)
  const stdioRef = serverRef as McpStdioServerConfig
  let shellPrefix: string | null = process.env.CLAUDE_CODE_SHELL_PREFIX || null
  try {
    const { resolveShellPrefix } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../utils/residualFinalEnvGates.js') as typeof import('../../../utils/residualFinalEnvGates.js')
    shellPrefix = resolveShellPrefix()
  } catch {
    // keep raw env fallback
  }
  const finalCommand = shellPrefix || stdioRef.command
  const finalArgs = shellPrefix
    ? [[stdioRef.command, ...stdioRef.args].join(' ')]
    : stdioRef.args
  let stdioEnv: Record<string, string>
  try {
    const {
      shouldEnforceMcpAllowlistEnv,
      buildMcpStdioBaseEnv,
      buildMcpStdioTransportEnv,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../utils/residualMoreEnvGates.js') as typeof import('../../../utils/residualMoreEnvGates.js')
    const base = buildMcpStdioBaseEnv({
      enforceAllowlist: shouldEnforceMcpAllowlistEnv(),
      processEnv: process.env,
      injectedEnv: getRegisteredUpstreamProxyEnv(),
      managedEnv: subprocessEnv(),
    })
    stdioEnv = buildMcpStdioTransportEnv({
      baseEnv: base,
      projectDir: getProjectRoot(),
      sessionId: getSessionId(),
      serverEnv: stdioRef.env ?? null,
    })
  } catch {
    const { CLAUDE_CODE_CHILD_SESSION: _child, ...rest } =
      subprocessEnv() as Record<string, string | undefined>
    stdioEnv = {
      ...(Object.fromEntries(
        Object.entries(rest).filter(
          (e): e is [string, string] => e[1] !== undefined,
        ),
      ) as Record<string, string>),
      CLAUDE_PROJECT_DIR: getProjectRoot(),
      CLAUDE_CODE_SESSION_ID: getSessionId(),
      CLAUDECODE: '1',
      ...stdioRef.env,
    }
  }
  unsetEmptyAwsBearerTokenBedrock(stdioEnv)
  return new StdioClientTransport({
    command: finalCommand,
    args: finalArgs,
    env: stdioEnv,
    stderr: 'pipe',
  })
}
