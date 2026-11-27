import { feature } from 'bun:bundle'
import type {
  Base64ImageSource,
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
// densable 2.1.233: single-stack MCP client package (listen / modern era).
import {
  Client,
  createFetchWithInit,
  ProtocolErrorCode,
  SdkError,
  SdkHttpError,
  SSEClientTransport,
  type SSEClientTransportOptions,
  SseError,
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
  UnauthorizedError,
  UrlElicitationRequiredError,
  type FetchLike,
  type Tool as McpWireTool,
  type Transport,
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import {
  createDensableMcpClient,
  isJavaMcpFormUrlElicitationReject,
  JAVA_MCP_BARE_ELICITATION_HINT,
} from './mcpV2Client.js'
import { isChromeBrowserMcpToolBlockedByOrgPolicy } from '../../utils/claudeInChrome/chromeMcpReadOnly.js'
import { checkMcpToolRemovedByPlugin } from '../../utils/plugins/pluginToolList.js'
import type {
  CachedMCPServer,
  ElicitRequestURLParams,
  ElicitResult,
  JSONRPCMessage,
  PromptMessage,
  ResourceLink,
} from './types.js'
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
  persistRawDiscoveryIfComplete,
  readDiscoveryCacheEntry,
  recordDiscoveryFetchErrorForResult,
  recordDiscoveryRefreshStrike,
  recordRawCommandsForResult,
  recordRawResourcesForResult,
  recordRawToolsForResult,
  runCachedFirstDialArms,
  subscribeCachedAdopt,
  subscribeCachedDialFailed,
  takeSettledCachedDialFailure,
  unmarkSwrRefreshDialInFlight,
  writeDiscoveryCacheEntry,
  type CachedDiscoveryListing,
  type CachedMcpPromptEntry,
  type DiscoveryCacheReadOutcome,
} from './discoveryCache.js'
import { extractMcpConnectionErrorCode } from './mcpConnectionIssue.js'
import { readClientProtocolEra } from './channelPermissions.js'
import { listMcpCursorPages, listMcpToolsAggregated } from './listPagination.js'
import {
  captureConnectClockSnapshot,
  classifyMcpAutoProbeFallback,
  createMcpConnectionTimeoutError,
  detectConnectSuspendedMessage,
  formatMcpProbeFallbackDebugMessage,
  formatPinnedLegacyRetryPreserveTimeoutLog,
  getMcpClientConnectTimeoutMs,
  getMcpPinnedLegacyRetryTimeoutMs,
  getMcpTimeoutMs,
  isMcpCcrProxyServerConfig,
  isRememberedLegacyStdio,
  loadRememberedLegacyStdioFromDisk,
  type ModernCompatTransportLike,
  recordRememberedLegacyStdio,
  resolveMcpNegotiationTransportKind,
  resolveMcpProtocolNegotiationPlan,
  type McpProtocolNegotiationPlan,
  shouldApplyLegacyHttpSseGet401Guard,
  shouldPreserveConnectTimeoutAfterPinnedLegacyRetry,
  truncateMcpErrorSnippet,
  wrapLegacyHttpSseGet401Guard,
  wrapModernProtocolResultCompat,
  createLegacyHttpSseFallbackFetches,
  getLegacySseErrorStatus,
  isLegacySseAuthChallenge,
  isLegacySseFallbackEligible,
  type McpProbeFallbackReason,
  type McpProbeTimedOutTransport,
} from './mcpConnectTimeout.js'
import {
  CLAUDEAI_CONNECTORS_DISABLED_ERROR_CODE,
  isSdkServerWithConnectorsOff,
} from './claudeai.js'
import { wrapFetchWithResponseLimit } from './httpResponseLimit.js'
import mapValues from 'lodash-es/mapValues.js'
import memoize from 'lodash-es/memoize.js'
import zipObject from 'lodash-es/zipObject.js'
import pMap from 'p-map'
import { pathToFileURL } from 'url'
import {
  getAdditionalDirectoriesForClaudeMd,
  getOriginalCwd,
  getProjectRoot,
  getSessionId,
  registerEnsureConnectedClient,
} from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { getOauthConfig } from '../../constants/oauth.js'
import type { AppState } from '../../state/AppState.js'
import {
  createDefaultCanUseTool,
  resolveToolUseContext,
  type Tool,
  type ToolCallProgress,
  toolMatchesName,
} from '../../Tool.js'
import { ListMcpResourcesTool } from '@claude-code/builtin-tools/tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
import {
  type MCPProgress,
  MCPTool,
} from '@claude-code/builtin-tools/tools/MCPTool/MCPTool.js'
import { createMcpAuthTools } from '@claude-code/builtin-tools/tools/McpAuthTool/McpAuthTool.js'
import { ReadMcpResourceTool } from '@claude-code/builtin-tools/tools/ReadMcpResourceTool/ReadMcpResourceTool.js'
import { createAbortController } from '../../utils/abortController.js'
import { getPlatform } from '../../utils/platform.js'
import { count } from '../../utils/array.js'
import { resolveMcpToolIdleTimeoutMs } from '../../utils/residualMsEnvGates.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
  handleOAuth401Error,
} from '../../utils/auth.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { detectCodeIndexingFromMcpServerName } from '../../utils/codeIndexing.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../utils/envUtils.js'
import {
  AbortError,
  errorMessage,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../utils/errors.js'
import { getMCPUserAgent } from '../../utils/http.js'
import { maybeNotifyIDEConnected } from '../../utils/ide.js'
import {
  type ImageLimits,
  maybeResizeAndDownsampleImageBuffer,
} from '../../utils/imageResizer.js'
import { logMCPDebug, logMCPError } from '../../utils/log.js'
import {
  isFixedUrlOfficialMarketplacePluginMcp,
  markMcpServerLoggable,
} from '../../utils/mcpUsageAttribution.js'
import { mcpInfoSource } from '../../utils/plugins/toolDescribe.js'
import {
  getBinaryBlobSavedMessage,
  getFormatDescription,
  getLargeOutputInstructions,
  persistBinaryContent,
} from '../../utils/mcpOutputStorage.js'
import {
  getContentSizeEstimate,
  type MCPToolResult,
  mcpContentNeedsTruncation,
  truncateMcpContentIfNeeded,
} from '../../utils/mcpValidation.js'
import { WebSocketTransport } from '../../utils/mcpWebSocketTransport.js'
import { memoizeWithLRU } from '../../utils/memoize.js'
import { getWebSocketTLSOptions } from '../../utils/mtls.js'
import {
  HostSlot,
  getActiveSessionFromAls,
  getBootstrapSession,
  getBootstrapSessionHost,
  runWithSession,
} from '../../utils/sessionRoot.js'
import {
  getProxyFetchOptions,
  getWebSocketProxyAgent,
  getWebSocketProxyUrl,
} from '../../utils/proxy.js'
import { getSessionIngressAuthToken } from '../../utils/sessionIngressAuth.js'
import {
  getCliOwnedAsyncBearerProvider,
  getCliOwnedBearerProvider,
  isCliOwnedBearerConfig,
  isCliOwnedConfig,
  wrapCliOwnedFetch,
} from './cliOwnedConfigs.js'
import {
  isAccountMemoryServerTool,
  isAccountMemoryTool,
} from './accountMemoryMcp.js'
import {
  getRegisteredUpstreamProxyEnv,
  subprocessEnv,
} from '../../utils/subprocessEnv.js'
import {
  isPersistError,
  persistToolResult,
} from '../../utils/toolResultStorage.js'
import {
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '../analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  consumeMcpElicitationDeclinedDuringCall,
  runElicitationHooks,
  runElicitationResultHooks,
} from './elicitationHandler.js'
import {
  applyConnectorDesignMembership,
  connectorDesignOmitsPersistentAllow,
  connectorDesignTokenlessWriteDeny,
  isFirstPartyDesignMcpServer,
} from './connectorDesign.js'
import {
  isMcpRequiresUserInteraction,
  mcpToolCheckPermissionsResult,
} from './mcpToolInteraction.js'
import { buildMcpToolName } from './mcpStringUtils.js'
import { createHash } from 'crypto'
import { isIPv6 } from 'net'
import {
  coerceMcpToolInputForSchema,
  type DroppedMcpToolRecord,
  filterListedMcpToolsBySchema,
  LegacyDialectToleratingValidator,
  stripLegacyJsonSchemaDialect,
} from './mcpToolSchema.js'

export { LegacyDialectToleratingValidator, stripLegacyJsonSchemaDialect }
import { wrapDocsConnectorToolForTerminalAutoOpen } from './docsConnectorAutoOpen.js'
import { normalizeNameForMCP } from './normalization.js'
import { getLoggingSafeMcpBaseUrl } from './utils.js'

// Package imports — delegate to mcp-client package utilities where applicable
import {
  isMcpSessionExpiredError as isMcpSessionExpiredErrorFromPackage,
  MAX_MCP_DESCRIPTION_LENGTH as PKG_MAX_MCP_DESCRIPTION_LENGTH,
} from '@claude-code/mcp-client'
import { recursivelySanitizeUnicode } from '@claude-code/mcp-client'

/* eslint-disable @typescript-eslint/no-require-imports */
const fetchMcpSkillsForClient = feature('MCP_SKILLS')
  ? (
      require('../../skills/mcpSkills.js') as typeof import('../../skills/mcpSkills.js')
    ).fetchMcpSkillsForClient
  : null

import type { AssistantMessage } from 'src/types/message.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import { classifyMcpToolForCollapse } from '@claude-code/builtin-tools/tools/MCPTool/classifyForCollapse.js'
import { clearKeychainCache } from '../../utils/secureStorage/macOsKeychainHelpers.js'
import { sleep } from '../../utils/sleep.js'
import {
  ClaudeAuthProvider,
  clearMcpOAuthStubIfTokenless,
  dialWithSignedOutFallback,
  hasMcpDiscoveryButNoToken,
  IssuerEchoCrossOriginError,
  markStoredTokenRejectedForRedial,
  serverHasStoredRefreshToken,
  wrapFetchWithStepUpDetection,
} from './auth.js'
import {
  classifyAuthReconnectKind,
  clearAuthReconnectInFlight,
  hasAuthReconnectInFlight,
  isConnectionClosedWhileReconnecting,
  isMcpConnectionClosedError,
  joinOrStartAuthReconnect,
} from './authReconnect.js'
import { markClaudeAiMcpConnected } from './claudeai.js'
import {
  isStatelessClaudeAiProxy,
  suppressGetSseOnEndpoint,
  wrapStatelessClaudeAiProxyTransport,
} from './claudeAiProxyStateless.js'
import {
  armAllCallWatchdogs,
  clearCallWatchdogArm,
  createMcpTransportErrorState,
  shouldAbortForTransportDrop,
} from './transportErrorState.js'
import {
  getAllMcpConfigs,
  getMcpServerUrlOrigin,
  isMcpServerAllowedByPolicy,
  isMcpServerDisabled,
} from './config.js'
import {
  advanceMcpIdentityEpoch,
  ensureMcpAccountIdentityResolver,
  isMcpIdentityBoundaryEnabled,
  markMcpIdentityChanged,
  getMcpIdentityEpoch,
  mcpConfigDependsOnAccountIdentity,
  seedMcpIdentityCheck,
  mcpIdentityChangedSinceLastCheck,
} from './mcpIdentity.js'

export {
  getMcpIdentityEpoch,
  mcpConfigDependsOnAccountIdentity,
  mcpIdentityChangedSinceLastCheck,
  seedMcpIdentityCheck,
} from './mcpIdentity.js'
import { getMcpServerHeaders } from './headersHelper.js'
import {
  classifyConnectAuthHeaderRejection,
  connectAuthStatusCode,
  headersHaveAuthorization,
  resolveConnectAuthFlags,
  shouldSkipOAuthAuthProvider,
  type ConnectAuthFlags,
  type ConnectAuthHeaderRejection,
} from './connectAuthClassify.js'
import { SdkControlClientTransport } from './SdkControlTransport.js'
import {
  classifyFirstPartyAuthRejection,
  isFirstPartyAnthropicMcpUrl,
  shouldUseFirstPartyAutoAuth,
  wrapFirstPartyAutoAuthFetch,
  type FirstPartyAuthRejection,
  type FirstPartyBearerBag,
} from './mcpFirstPartyAutoAuth.js'
import type {
  ConnectedMCPServer,
  McpCallWatchdog,
  MCPServerConnection,
  McpSdkServerConfig,
  McpStdioServerConfig,
  ScopedMcpServerConfig,
  ServerResource,
} from './types.js'

import {
  DEFAULT_MCP_TOOL_TIMEOUT_MS,
  extractToolUseId,
  filterMcpToolsByNameLength,
  getMaxMcpDescriptionLengthForConfig,
  getMcpToolIdleTimeoutMs,
  getMcpToolTimeoutMs,
  gracefulShutdownWindowsStdio,
  inertReconnectShape,
  inferCompactSchema,
  isClaudeAiProxyListAuthError,
  isTerminalConnectionError,
  MAX_MCP_DESCRIPTION_LENGTH,
  MAX_MCP_TOOL_NAME_LENGTH,
  MCP_TOOL_CALL_INTERRUPTED,
  type MCPResultType,
  type MCPToolCallResult,
  mcpToolInputToAutoClassifierInput,
  processMCPResult,
  throwIfMcpToolCallInterrupted,
  type TransformedMCPResult,
  transformMCPResult,
  transformResultContent,
} from './clientHelpers.js'
import {
  areMcpConfigsEqual,
  ClaudeAiProxyBearerRejectedError,
  clearRejectedClaudeAiBearerToken,
  hasClaudeAiBearerRecoveredAfterLogin,
  clearMcpAuthCache,
  connectAuthRejectedResult,
  createClaudeAiProxyFetch,
  createNodeWsClient,
  getConnectionTimeoutMs,
  getMcpServerConnectionBatchSize,
  getRemoteMcpServerConnectionBatchSize,
  getServerCacheKey,
  handleRemoteAuthFailure,
  isClaudeAiBearerRejectedError,
  isIncludedMcpTool,
  isLocalMcpServer,
  isMcpAuthCached,
  isMcpSessionExpiredError,
  MCP_REQUEST_TIMEOUT_MS,
  maybeConnectAuthHeaderRejection,
  McpAuthError,
  McpCredentialStoreUnavailableError,
  McpSessionExpiredError,
  McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  mcpBaseUrlAnalytics,
  processBatched,
  resolveRemoteConnectAuth,
  setMcpAuthCacheEntry,
  wrapFetchWithTimeout,
  wrapRemoteMcpFetch,
  type WsClientLike,
} from './connectionHelpers.js'

export {
  areMcpConfigsEqual,
  ClaudeAiProxyBearerRejectedError,
  clearRejectedClaudeAiBearerToken,
  hasClaudeAiBearerRecoveredAfterLogin,
  clearMcpAuthCache,
  createClaudeAiProxyFetch,
  getMcpServerConnectionBatchSize,
  getServerCacheKey,
  inertReconnectShape,
  inferCompactSchema,
  isClaudeAiBearerRejectedError,
  isMcpSessionExpiredError,
  MCP_TOOL_CALL_INTERRUPTED,
  McpAuthError,
  McpCredentialStoreUnavailableError,
  type MCPResultType,
  McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  mcpToolInputToAutoClassifierInput,
  processMCPResult,
  throwIfMcpToolCallInterrupted,
  type TransformedMCPResult,
  transformMCPResult,
  transformResultContent,
  wrapFetchWithTimeout,
}

import { isClaudeInChromeMCPServer } from '../../utils/claudeInChrome/common.js'
import {
  isChromeFileUploadToolName,
  prepareChromeFileUploadInput,
} from '../../utils/claudeInChrome/fileUpload.js'

// Lazy: toolRendering.tsx pulls React/ink; only needed when Claude-in-Chrome MCP server is connected
/* eslint-disable @typescript-eslint/no-require-imports */
const claudeInChromeToolRendering =
  (): typeof import('../../utils/claudeInChrome/toolRendering.js') =>
    require('../../utils/claudeInChrome/toolRendering.js')
// Lazy: wrapper.tsx → hostAdapter.ts → executor.ts pulls both native modules
// (@ant/computer-use-input + @ant/computer-use-swift). Runtime-gated by
// GrowthBook tengu_malort_pedway (see gates.ts).
const computerUseWrapper = feature('CHICAGO_MCP')
  ? (): typeof import('../../utils/computerUse/wrapper.js') =>
      require('../../utils/computerUse/wrapper.js')
  : undefined
const isComputerUseMCPServer = feature('CHICAGO_MCP')
  ? (
      require('../../utils/computerUse/common.js') as typeof import('../../utils/computerUse/common.js')
    ).isComputerUseMCPServer
  : undefined

import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'

const MCP_FETCH_CACHE_SIZE = 20

type BoundSession = ReturnType<typeof getBootstrapSession>

type ConnectedClientWiringFn = (client: ConnectedMCPServer) => void

type McpToolsSwapperFn = (
  serverName: string,
  tools: Tool[],
  config: ScopedMcpServerConfig,
  connectedClient?: ConnectedMCPServer,
) => boolean

type McpServerConnectedListener = (client: ConnectedMCPServer) => void

function createHostCacheProxy<C extends object>(getTarget: () => C): C {
  const proxy: C = new Proxy({} as C, {
    get(_dummy, prop) {
      const target = getTarget()
      if (prop === 'set') {
        const setFn = Reflect.get(target, prop, target)
        if (typeof setFn === 'function') {
          return (...args: unknown[]) => {
            setFn.apply(target, args)
            return proxy
          }
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(_dummy, prop, value) {
      const target = getTarget()
      return Reflect.set(target, prop, value, target)
    },
    has(_dummy, prop) {
      return Reflect.has(getTarget(), prop)
    },
    ownKeys() {
      return Reflect.ownKeys(getTarget())
    },
    getOwnPropertyDescriptor(_dummy, prop) {
      const desc = Object.getOwnPropertyDescriptor(getTarget(), prop)
      if (!desc) return undefined
      return { ...desc, configurable: true }
    },
  })
  return proxy
}

function bindMcpClientHandlersToSession(
  client: Client,
  session: BoundSession,
): void {
  const wrapFn = <F extends (...args: never[]) => unknown>(fn: F): F =>
    ((...args: Parameters<F>) =>
      runWithSession(session, () => fn(...args))) as F

  const origSetNotificationHandler = client.setNotificationHandler.bind(
    client,
  ) as (...args: unknown[]) => unknown
  client.setNotificationHandler = ((
    method: unknown,
    schemasOrHandler: unknown,
    maybeHandler?: unknown,
  ) => {
    if (typeof schemasOrHandler === 'function') {
      return origSetNotificationHandler(
        method,
        wrapFn(schemasOrHandler as (...args: never[]) => unknown),
      )
    }
    if (typeof maybeHandler === 'function') {
      return origSetNotificationHandler(
        method,
        schemasOrHandler,
        wrapFn(maybeHandler as (...args: never[]) => unknown),
      )
    }
    return origSetNotificationHandler(method, schemasOrHandler, maybeHandler)
  }) as Client['setNotificationHandler']

  const origSetRequestHandler = client.setRequestHandler.bind(client) as (
    ...args: unknown[]
  ) => unknown
  client.setRequestHandler = ((
    method: unknown,
    schemasOrHandler: unknown,
    maybeHandler?: unknown,
  ) => {
    if (typeof schemasOrHandler === 'function') {
      return origSetRequestHandler(
        method,
        wrapFn(schemasOrHandler as (...args: never[]) => unknown),
      )
    }
    if (typeof maybeHandler === 'function') {
      return origSetRequestHandler(
        method,
        schemasOrHandler,
        wrapFn(maybeHandler as (...args: never[]) => unknown),
      )
    }
    return origSetRequestHandler(method, schemasOrHandler, maybeHandler)
  }) as Client['setRequestHandler']

  for (const prop of [
    'onclose',
    'onerror',
    'fallbackNotificationHandler',
    'fallbackRequestHandler',
  ] as const) {
    const initial = client[prop]
    let current =
      typeof initial === 'function'
        ? (wrapFn(initial as (...args: never[]) => unknown) as typeof initial)
        : initial
    Object.defineProperty(client, prop, {
      configurable: true,
      enumerable: true,
      get() {
        return current
      },
      set(next) {
        current =
          typeof next === 'function'
            ? (wrapFn(next as (...args: never[]) => unknown) as typeof current)
            : next
      },
    })
  }
}

function createConnectToServerMemo() {
  const fn = memoize(connectToServerImpl, getServerCacheKey)
  fn.cache = new Map() as unknown as typeof fn.cache
  return fn
}

function createFetchToolsMemo() {
  return memoizeWithLRU(
    fetchToolsForClientImpl,
    (client: MCPServerConnection) => client.name,
    MCP_FETCH_CACHE_SIZE,
  )
}

function createFetchResourcesMemo() {
  return memoizeWithLRU(
    fetchResourcesForClientImpl,
    (client: MCPServerConnection) => client.name,
    MCP_FETCH_CACHE_SIZE,
  )
}

function createFetchCommandsMemo() {
  return memoizeWithLRU(
    fetchCommandsForClientImpl,
    (client: MCPServerConnection) => client.name,
    MCP_FETCH_CACHE_SIZE,
  )
}

type HostMcpClientState = {
  connectToServerMemo: ReturnType<typeof createConnectToServerMemo>
  fetchToolsMemo: ReturnType<typeof createFetchToolsMemo>
  fetchResourcesMemo: ReturnType<typeof createFetchResourcesMemo>
  fetchCommandsMemo: ReturnType<typeof createFetchCommandsMemo>
  liveMcpClients: Set<Client>
  connectedClientWiring: ConnectedClientWiringFn | undefined
  connectedClientWiringSession: BoundSession | undefined
  mcpToolsSwapper: McpToolsSwapperFn | undefined
  mcpToolsSwapperSession: BoundSession | undefined
  mcpServerConnectedListeners: Map<string, Set<McpServerConnectedListener>>
  removedMcpServerNames: Set<string>
  removedMcpServerConfigs: WeakSet<object>
}

const hostMcpClientStateSlot = new HostSlot<HostMcpClientState>(() => ({
  connectToServerMemo: createConnectToServerMemo(),
  fetchToolsMemo: createFetchToolsMemo(),
  fetchResourcesMemo: createFetchResourcesMemo(),
  fetchCommandsMemo: createFetchCommandsMemo(),
  liveMcpClients: new Set<Client>(),
  connectedClientWiring: undefined,
  connectedClientWiringSession: undefined,
  mcpToolsSwapper: undefined,
  mcpToolsSwapperSession: undefined,
  mcpServerConnectedListeners: new Map<
    string,
    Set<McpServerConnectedListener>
  >(),
  removedMcpServerNames: new Set<string>(),
  removedMcpServerConfigs: new WeakSet<object>(),
}))

function getHostMcpClientState(): HostMcpClientState {
  return hostMcpClientStateSlot.of(getBootstrapSessionHost())
}

/**
 * TODO (ollie): The memoization here increases complexity by a lot, and im not sure it really improves performance
 * Attempts to connect to a single MCP server
 * @param name Server name
 * @param serverRef Scoped server configuration
 * @returns A wrapped client (either connected or failed)
 */
async function connectToServerImpl(
  name: string,
  serverRef: ScopedMcpServerConfig,
  serverStats?: {
    totalServers: number
    stdioCount: number
    sseCount: number
    httpCount: number
    sseIdeCount: number
    wsIdeCount: number
  },
): Promise<MCPServerConnection> {
  const hostState = getHostMcpClientState()
  const capturedSession = getBootstrapSession()
  const connectStartTime = Date.now()
  const connectClockSnapshot = captureConnectClockSnapshot()
  // #644/#645: never spawn or dial a server blocked by managed policy.
  if (
    serverRef.type !== 'sdk' &&
    !isMcpServerAllowedByPolicy(name, serverRef)
  ) {
    return {
      name,
      type: 'failed',
      config: serverRef,
      error: 'Blocked by enterprise managed policy',
      errorCode: 'POLICY_BLOCKED',
    }
  }
  let inProcessServer:
    | { connect(t: Transport): Promise<void>; close(): Promise<void> }
    | undefined
  let capturedStartupStderr = ''
  try {
    let transport: Transport
    let legacySseFallback:
      | ((opts: {
          postMethodNotAllowed: boolean
          dialSignal: AbortSignal
          dialConnected: () => boolean
        }) => Transport)
      | undefined
    let connectAuthFlags: ConnectAuthFlags | undefined
    let connectAuthProvider: ClaudeAuthProvider | undefined
    let useFirstPartyAuth = false
    let lacksHelperHeaders = false
    const firstPartyBearerBag: FirstPartyBearerBag = { last: 'none' }

    // If we have the session ingress JWT, we will connect via the session ingress rather than
    // to remote MCP's directly.
    const sessionIngressToken = getSessionIngressAuthToken()

    if (serverRef.type === 'sse') {
      // Get combined headers (static + dynamic) before deciding on OAuth.
      const combinedHeaders = await getMcpServerHeaders(name, serverRef, {
        onHelperFailed: () => {
          lacksHelperHeaders = true
        },
      })
      const remoteAuth = await resolveRemoteConnectAuth(
        name,
        serverRef,
        combinedHeaders,
      )
      connectAuthFlags = remoteAuth.flags
      useFirstPartyAuth = remoteAuth.useFirstPartyAuth
      const authProvider = remoteAuth.authProvider
      const firstPartyBag = useFirstPartyAuth ? firstPartyBearerBag : undefined

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

      transport = new SSEClientTransport(
        new URL(serverRef.url),
        transportOptions,
      )
      logMCPDebug(name, `SSE transport initialized, awaiting connection`)
    } else if (serverRef.type === 'sse-ide') {
      logMCPDebug(name, `Setting up SSE-IDE transport to ${serverRef.url}`)
      // IDE servers don't need authentication
      // TODO: Use the auth token provided in the lockfile
      const proxyOptions = getProxyFetchOptions()
      const transportOptions: SSEClientTransportOptions =
        proxyOptions.dispatcher
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
          lacksHelperHeaders = true
        },
      })
      const remoteAuth = await resolveRemoteConnectAuth(
        name,
        serverRef,
        combinedHeaders,
      )
      connectAuthFlags = remoteAuth.flags
      useFirstPartyAuth = remoteAuth.useFirstPartyAuth
      const authProvider = remoteAuth.authProvider
      connectAuthProvider = authProvider
      const firstPartyBag = useFirstPartyAuth ? firstPartyBearerBag : undefined

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
          const { fetch, eventSourceFetch } =
            createLegacyHttpSseFallbackFetches({
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
        '../../utils/claudeInChrome/mcpServer.js'
      )
      const { createChromeSocketClient, createClaudeForChromeMcpServer } =
        await import('@ant/claude-for-chrome-mcp')
      const { createLinkedTransportPair } = await import(
        './InProcessTransport.js'
      )
      const { registerChromeTabGroupCleanup, setChromeBinding } = await import(
        '../../utils/claudeInChrome/tabGroupCleanup.js'
      )
      const context = createChromeContext(
        (serverRef as McpStdioServerConfig).env,
      )
      const socketClient = createChromeSocketClient(context)
      setChromeBinding(context, socketClient)
      registerChromeTabGroupCleanup()
      inProcessServer = createClaudeForChromeMcpServer(context, socketClient)
      const [clientTransport, serverTransport] = createLinkedTransportPair()
      await inProcessServer.connect(serverTransport)
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
        '../../utils/computerUse/mcpServer.js'
      )
      const { createLinkedTransportPair } = await import(
        './InProcessTransport.js'
      )
      inProcessServer = await createComputerUseMcpServerForCli()
      const [clientTransport, serverTransport] = createLinkedTransportPair()
      await inProcessServer.connect(serverTransport)
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
          require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
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
          require('../../utils/residualMoreEnvGates.js') as typeof import('../../utils/residualMoreEnvGates.js')
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

    // Set up stderr logging for stdio transport before connecting in case there are any stderr
    // outputs emitted during the connection start (this can be useful for debugging failed connections).
    // Store handler reference for cleanup to prevent memory leaks
    let stderrHandler: ((data: Buffer) => void) | undefined
    let stderrOutput = ''
    if (serverRef.type === 'stdio' || !serverRef.type) {
      const stdioTransport = transport as StdioClientTransport
      if (stdioTransport.stderr) {
        stderrHandler = (data: Buffer) => {
          // Cap stderr accumulation to prevent unbounded memory growth
          if (stderrOutput.length < 64 * 1024 * 1024) {
            try {
              stderrOutput += data.toString()
            } catch {
              // Ignore errors from exceeding max string length
            }
          }
        }
        stdioTransport.stderr.on('data', stderrHandler)
      }
    }

    // densable n_f(type, {inProcess, ccrProxy: pMn(config)}) for Pwi.
    // sdk is handled earlier; n_f still maps it to sdk-control.
    const negotiationTransportKind = resolveMcpNegotiationTransportKind(
      serverRef.type,
      {
        inProcess: inProcessServer !== undefined,
        ccrProxy: isMcpCcrProxyServerConfig(serverRef),
      },
    )

    // densable 2.1.232/238: Pwi(kind, serverConfig) — GB denylist after auto.
    // SEA 325 #263 / #1628: lazily load persisted 7-day verdicts from disk
    // once, then skip the probe for 7 days if this stdio server previously
    // timed out/failed probe.
    if (negotiationTransportKind === 'stdio') {
      await loadRememberedLegacyStdioFromDisk(undefined, { once: true })
    }
    const protocolPlan: McpProtocolNegotiationPlan =
      negotiationTransportKind === 'stdio' &&
      isRememberedLegacyStdio(
        serverRef as {
          type?: string
          command?: string
          args?: readonly string[]
          env?: Record<string, string>
        },
      )
        ? { mode: 'legacy' }
        : resolveMcpProtocolNegotiationPlan(
            negotiationTransportKind,
            process.env,
            (key, def) => getFeatureValue_CACHED_MAY_BE_STALE(key, def),
            serverRef,
          )
    // densable k(Z) — factory takes versionNegotiation plan (BVa)
    // densable ze capability ternary + Lr initialize rewrite live in factory.
    let bareElicitationRetry = false
    const createMcpSdkClient = (
      plan: typeof protocolPlan = protocolPlan,
      opts: { forceBare?: boolean } = {},
    ): Client => {
      const c = createDensableMcpClient(plan, serverRef, {
        forceBare: opts.forceBare === true || bareElicitationRetry,
      })
      bindMcpClientHandlersToSession(c, capturedSession)
      // densable: setRequestHandler("roots/list", ...)
      c.setRequestHandler('roots/list', async () => {
        logMCPDebug(name, `Received ListRoots request from server`)
        return buildMcpRootsList()
      })
      return c
    }

    // densable C — reassigned on pinned-legacy reconnect / bare elicitation retry.
    let client = createMcpSdkClient()

    // Add debug logging for client events if available
    if (serverRef.type === 'http') {
      logMCPDebug(name, `Client created, setting up request handler`)
    }

    // Add a timeout to connection attempts to prevent tests from hanging indefinitely
    logMCPDebug(
      name,
      `Starting connection with timeout of ${getConnectionTimeoutMs()}ms`,
    )

    // For HTTP transport, try a basic connectivity test first
    if (serverRef.type === 'http') {
      logMCPDebug(name, `Testing basic HTTP connectivity to ${serverRef.url}`)
      try {
        const testUrl = new URL(serverRef.url)
        logMCPDebug(
          name,
          `Parsed URL: host=${testUrl.hostname}, port=${testUrl.port || 'default'}, protocol=${testUrl.protocol}`,
        )

        // Log DNS resolution attempt
        if (
          testUrl.hostname === '127.0.0.1' ||
          testUrl.hostname === 'localhost'
        ) {
          logMCPDebug(name, `Using loopback address: ${testUrl.hostname}`)
        }
      } catch (urlError) {
        logMCPDebug(name, `Failed to parse URL: ${urlError}`)
      }
    }

    const initializeTimeoutMs = getMcpClientConnectTimeoutMs(protocolPlan.mode)
    const outerTimeoutMs = getConnectionTimeoutMs()
    // probeFellBack retained for densable analytics shape (negotiation.probeFellBack).
    let probeFellBack: McpProbeFallbackReason | undefined
    // densable `oe` — Re() timeout only transport.close().
    let handshakeConnectTimedOut = false

    const raceConnect = async (
      c: Client,
      t: Transport,
      initTimeoutMs: number,
      raceTimeoutMs: number,
    ): Promise<void> => {
      const connectPromise = c.connect(t, { timeout: initTimeoutMs })
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timeoutId = setTimeout(() => {
          const elapsed = Date.now() - connectStartTime
          logMCPDebug(
            name,
            `Connection timeout triggered after ${elapsed}ms (limit: ${raceTimeoutMs}ms)`,
          )
          if (inProcessServer) {
            inProcessServer.close().catch(() => {})
          }
          t.close().catch(() => {})
          handshakeConnectTimedOut = true
          // densable oMf — tag CONNECT_TIMEOUT when GB default true
          reject(
            createMcpConnectionTimeoutError(
              `MCP server "${name}" connection timed out after ${outerTimeoutMs}ms`,
            ),
          )
        }, raceTimeoutMs)
        connectPromise.then(
          () => {
            clearTimeout(timeoutId)
          },
          _error => {
            clearTimeout(timeoutId)
          },
        )
      })
      await Promise.race([connectPromise, timeoutPromise])
    }

    const recreateTransportForPinnedLegacy = async (): Promise<Transport> => {
      // densable `l=u()` / `l=new por(c)` — rebuild same transport kind for legacy.
      if (serverRef.type === 'http') {
        const combinedHeaders = await getMcpServerHeaders(name, serverRef, {
          onHelperFailed: () => {
            lacksHelperHeaders = true
          },
        })
        const remoteAuth = await resolveRemoteConnectAuth(
          name,
          serverRef,
          combinedHeaders,
        )
        connectAuthFlags = remoteAuth.flags
        useFirstPartyAuth = remoteAuth.useFirstPartyAuth
        const authProvider = remoteAuth.authProvider
        const firstPartyBag = useFirstPartyAuth
          ? firstPartyBearerBag
          : undefined
        const hasOAuthTokens = !!(await authProvider?.tokens())
        const proxyOptions = getProxyFetchOptions()
        const httpFetch = wrapFetchWithResponseLimit(
          wrapLegacyHttpSseGet401Guard(
            wrapRemoteMcpFetch(authProvider, firstPartyBag, serverRef),
            shouldApplyLegacyHttpSseGet401Guard({
              isCcrProxy: isMcpCcrProxyServerConfig(serverRef),
              isFirstPartyAnthropicMcp: isFirstPartyAnthropicMcpUrl(
                serverRef.url,
              ),
              isCliOwnedBearer: isCliOwnedBearerConfig(serverRef),
            }),
          ),
        )
        const transportOptions: StreamableHTTPClientTransportOptions = {
          ...(authProvider ? { authProvider } : {}),
          fetch: httpFetch,
          requestInit: {
            ...proxyOptions,
            ...((isMcpCcrProxyServerConfig(serverRef) ||
              isFirstPartyAnthropicMcpUrl(serverRef.url)) && {
              redirect: 'manual' as const,
            }),
            headers: {
              'User-Agent': getMCPUserAgent(),
              ...(sessionIngressToken &&
                !hasOAuthTokens && {
                  Authorization: `Bearer ${sessionIngressToken}`,
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
      let shellPrefix: string | null =
        process.env.CLAUDE_CODE_SHELL_PREFIX || null
      try {
        const { resolveShellPrefix } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
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
          require('../../utils/residualMoreEnvGates.js') as typeof import('../../utils/residualMoreEnvGates.js')
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

    const canRecreateForPinnedLegacy =
      serverRef.type === 'http' ||
      serverRef.type === 'claudeai-proxy' ||
      serverRef.type === 'stdio' ||
      !serverRef.type

    // densable N_f(u,S,v) — claudeai-proxy send-intercept only (never stdio).
    if (serverRef.type === 'claudeai-proxy') {
      wrapStatelessClaudeAiProxyTransport(transport, serverRef, msg =>
        logMCPDebug(name, msg),
      )
    }
    if (protocolPlan.mode === 'auto') {
      wrapModernProtocolResultCompat(
        transport as unknown as ModernCompatTransportLike,
        name,
        msg => logMCPDebug(name, msg),
      )
    }

    const recreateTransportAndClientForBareElicitation =
      async (): Promise<void> => {
        bareElicitationRetry = true
        await transport.close().catch(() => {})
        if (stderrHandler) {
          const stdioT = transport as StdioClientTransport
          stdioT.stderr?.off('data', stderrHandler)
        }
        if (stderrOutput) {
          logMCPDebug(
            name,
            `stderr of the stdio server that refused elicitation form and url, before restarting it: ${stderrOutput}`,
          )
          stderrOutput = ''
        }
        transport = await recreateTransportForPinnedLegacy()
        if (serverRef.type === 'claudeai-proxy') {
          wrapStatelessClaudeAiProxyTransport(
            transport,
            serverRef,
            msg => logMCPDebug(name, msg),
            { includeDiscover: false },
          )
        }
        if (
          (serverRef.type === 'stdio' || !serverRef.type) &&
          transport instanceof StdioClientTransport &&
          transport.stderr
        ) {
          stderrHandler = (data: Buffer) => {
            if (stderrOutput.length < 64 * 1024 * 1024) {
              try {
                stderrOutput += data.toString()
              } catch {
                // ignore
              }
            }
          }
          transport.stderr.on('data', stderrHandler)
        }
        // densable ze(Ee?TDt()) — bare elicitation bag on Java reject retry.
        client = createMcpSdkClient({ mode: 'legacy' }, { forceBare: true })
      }

    try {
      try {
        await raceConnect(
          client,
          transport,
          initializeTimeoutMs,
          outerTimeoutMs,
        )
      } catch (firstError) {
        const alreadyHttpInited =
          transport instanceof StreamableHTTPClientTransport &&
          (transport as { protocolVersion?: unknown }).protocolVersion !==
            undefined
        const gbLegacySse =
          getFeatureValue_CACHED_MAY_BE_STALE(
            'tengu_mcp_legacy_sse_fallback',
            true,
          ) === true
        if (
          legacySseFallback !== undefined &&
          !alreadyHttpInited &&
          isLegacySseFallbackEligible(firstError) &&
          gbLegacySse
        ) {
          const snippet =
            firstError instanceof Error
              ? firstError.message
              : String(firstError)
          logMCPDebug(
            name,
            `initialize POST rejected (${snippet.slice(0, 200)}); trying legacy HTTP+SSE`,
          )
          const post405 =
            firstError instanceof SdkHttpError && firstError.status === 405
          await transport.close().catch(() => {})
          const dial = new AbortController()
          let sseConnected = false
          transport = legacySseFallback({
            postMethodNotAllowed: post405,
            dialSignal: dial.signal,
            dialConnected: () => sseConnected,
          })
          client = createMcpSdkClient()
          const remainingMs = Math.min(
            5_000,
            Math.max(
              1_000,
              getConnectionTimeoutMs() - (Date.now() - connectStartTime),
            ),
          )
          // densable De = R?.sawAuthChallenge; Trn stamps the field.
          const sawAuthChallengeBeforeFallback =
            (connectAuthProvider as { sawAuthChallenge?: boolean } | undefined)
              ?.sawAuthChallenge === true
          handshakeConnectTimedOut = false
          try {
            await raceConnect(client, transport, remainingMs, remainingMs)
            sseConnected = true
            logMCPDebug(name, 'connected over legacy HTTP+SSE')
          } catch (sseError) {
            await transport.close().catch(() => {})
            dial.abort()
            const newAuthChallenge =
              !sawAuthChallengeBeforeFallback &&
              (
                connectAuthProvider as
                  | { sawAuthChallenge?: boolean }
                  | undefined
              )?.sawAuthChallenge === true
            const isAuthChallenge = isLegacySseAuthChallenge(
              sseError,
              getLegacySseErrorStatus(sseError),
              newAuthChallenge,
            )
            if (handshakeConnectTimedOut && post405 && newAuthChallenge) {
              logMCPDebug(
                name,
                'legacy HTTP+SSE stream GET answered with an auth challenge; its auth flow outran the fallback budget, so routing to needs-auth',
              )
              throw new UnauthorizedError(
                `MCP server "${name}" requires authorization: its legacy HTTP+SSE stream answered with an auth challenge and the authorization flow did not finish within the connect budget`,
              )
            }
            if (
              handshakeConnectTimedOut ||
              (sseError instanceof SseError && !isAuthChallenge) ||
              (isAuthChallenge && !post405)
            ) {
              const snippet = truncateMcpErrorSnippet(
                sseError instanceof Error ? sseError.message : String(sseError),
              )
              logMCPDebug(
                name,
                `legacy HTTP+SSE not confirmed (${snippet}); surfacing the POST failure`,
              )
              throw firstError
            }
            throw sseError
          }
        } else {
          const decision = classifyMcpAutoProbeFallback(
            protocolPlan,
            firstError,
            {
              transportType: serverRef.type,
              transport: transport as McpProbeTimedOutTransport,
              canRecreateTransport: canRecreateForPinnedLegacy,
              elapsedMs: Date.now() - connectStartTime,
            },
          )
          if (decision.shouldFallback && negotiationTransportKind === 'stdio') {
            recordRememberedLegacyStdio(
              serverRef as {
                type?: string
                command?: string
                args?: readonly string[]
                env?: Record<string, string>
              },
            )
          }
          if (!decision.shouldFallback) {
            // densable bn → reconnect once without elicitation form/url.
            if (
              canRecreateForPinnedLegacy &&
              !bareElicitationRetry &&
              isJavaMcpFormUrlElicitationReject(
                firstError,
                serverRef,
                transport,
              )
            ) {
              logMCPDebug(
                name,
                'server rejected elicitation form and url at initialize (Java MCP SDK 0.17.0 or older); reconnecting once without elicitation form and url',
              )
              await recreateTransportAndClientForBareElicitation()
              const bareTimeoutMs =
                getMcpPinnedLegacyRetryTimeoutMs(connectStartTime)
              await raceConnect(client, transport, bareTimeoutMs, bareTimeoutMs)
            } else {
              throw firstError
            }
          } else {
            probeFellBack = decision.reason
            logMCPDebug(
              name,
              formatMcpProbeFallbackDebugMessage(
                decision.reason,
                serverRef.type || 'stdio',
              ),
            )
            if (decision.reason === 'closed' && stderrOutput) {
              logMCPDebug(name, `Probe-closed server stderr: ${stderrOutput}`)
              stderrOutput = ''
            }
            await transport.close().catch(() => {})
            if (stderrHandler) {
              const stdioT = transport as StdioClientTransport
              stdioT.stderr?.off('data', stderrHandler)
            }
            transport = await recreateTransportForPinnedLegacy()
            // densable reconnect `_9a(u,M)` — init intercept only (discover omitted).
            if (serverRef.type === 'claudeai-proxy') {
              wrapStatelessClaudeAiProxyTransport(
                transport,
                serverRef,
                msg => logMCPDebug(name, msg),
                { includeDiscover: false },
              )
            }
            if (
              (serverRef.type === 'stdio' || !serverRef.type) &&
              transport instanceof StdioClientTransport &&
              transport.stderr
            ) {
              stderrHandler = (data: Buffer) => {
                if (stderrOutput.length < 64 * 1024 * 1024) {
                  try {
                    stderrOutput += data.toString()
                  } catch {
                    // ignore
                  }
                }
              }
              transport.stderr.on('data', stderrHandler)
            }
            // densable C=k({mode:"legacy"}) — new client, pinned legacy mode.
            client = createMcpSdkClient({ mode: 'legacy' })
            const retryTimeoutMs =
              getMcpPinnedLegacyRetryTimeoutMs(connectStartTime)
            let outerTimedOut = false
            try {
              // densable: race remaining budget; oMf message still cites y0()
              const connectPromise = client.connect(transport, {
                timeout: retryTimeoutMs,
              })
              await Promise.race([
                connectPromise,
                new Promise<never>((_, reject) => {
                  const timeoutId = setTimeout(() => {
                    outerTimedOut = true
                    transport.close().catch(() => {})
                    reject(
                      createMcpConnectionTimeoutError(
                        `MCP server "${name}" connection timed out after ${outerTimeoutMs}ms`,
                      ),
                    )
                  }, retryTimeoutMs)
                  connectPromise.then(
                    () => clearTimeout(timeoutId),
                    () => clearTimeout(timeoutId),
                  )
                }),
              ])
            } catch (retryError) {
              if (
                canRecreateForPinnedLegacy &&
                !bareElicitationRetry &&
                isJavaMcpFormUrlElicitationReject(
                  retryError,
                  serverRef,
                  transport,
                )
              ) {
                logMCPDebug(
                  name,
                  'server rejected elicitation form and url on the reconnect (Java MCP SDK 0.17.0 or older); reconnecting once more without elicitation form and url',
                )
                await recreateTransportAndClientForBareElicitation()
                const bareTimeoutMs =
                  getMcpPinnedLegacyRetryTimeoutMs(connectStartTime)
                await raceConnect(
                  client,
                  transport,
                  bareTimeoutMs,
                  bareTimeoutMs,
                )
              } else if (
                shouldPreserveConnectTimeoutAfterPinnedLegacyRetry(
                  decision.reason,
                  retryError,
                  { outerTimedOut },
                )
              ) {
                const snippet = truncateMcpErrorSnippet(
                  retryError instanceof Error
                    ? retryError.message
                    : String(retryError),
                )
                logMCPDebug(
                  name,
                  formatPinnedLegacyRetryPreserveTimeoutLog(snippet),
                )
                throw firstError
              } else {
                throw retryError
              }
            }
          }
        }
      }
      // silence unused until analytics wiring; densable passes probeFellBack out.
      void probeFellBack
      void bareElicitationRetry

      if (stderrOutput) {
        logMCPError(name, `Server stderr: ${stderrOutput}`)
        stderrOutput = '' // Release accumulated string to prevent memory growth
      }
      const elapsed = Date.now() - connectStartTime
      logMCPDebug(
        name,
        `Successfully connected (transport: ${serverRef.type || 'stdio'}) in ${elapsed}ms`,
      )
    } catch (caught) {
      const elapsed = Date.now() - connectStartTime
      // densable: !Ee && bn → rewrite failed-connect message to Java bare hint.
      const error =
        !bareElicitationRetry &&
        isJavaMcpFormUrlElicitationReject(caught, serverRef, transport)
          ? new Error(JAVA_MCP_BARE_ELICITATION_HINT, { cause: caught })
          : caught
      // SSE-specific error logging
      if (serverRef.type === 'sse' && error instanceof Error) {
        logMCPDebug(
          name,
          `SSE Connection failed after ${elapsed}ms: ${jsonStringify({
            url: serverRef.url,
            error: error.message,
            errorType: error.constructor.name,
            stack: error.stack,
          })}`,
        )
        logMCPError(name, error)

        const classified = maybeConnectAuthHeaderRejection(
          error,
          connectAuthFlags,
        )
        if (classified) {
          return connectAuthRejectedResult(name, serverRef, 'sse', classified)
        }
        if (useFirstPartyAuth) {
          const firstParty = classifyFirstPartyAuthRejection({
            error,
            statusCode: connectAuthStatusCode(error),
            serverRef,
            firstPartyBearer: firstPartyBearerBag.last,
          })
          if (firstParty) {
            return connectAuthRejectedResult(name, serverRef, 'sse', firstParty)
          }
        }
        if (error instanceof UnauthorizedError) {
          return markStoredTokenRejectedForRedial(name, serverRef, () =>
            handleRemoteAuthFailure(name, serverRef, 'sse', {
              lacksHelperHeaders,
            }),
          )
        }
      } else if (serverRef.type === 'http' && error instanceof Error) {
        const errorObj = error as Error & {
          cause?: unknown
          code?: string
          errno?: string | number
          syscall?: string
        }
        logMCPDebug(
          name,
          `HTTP Connection failed after ${elapsed}ms: ${error.message} (code: ${errorObj.code || 'none'}, errno: ${errorObj.errno || 'none'})`,
        )
        logMCPError(name, error)

        const classified = maybeConnectAuthHeaderRejection(
          error,
          connectAuthFlags,
        )
        if (classified) {
          return connectAuthRejectedResult(name, serverRef, 'http', classified)
        }
        if (useFirstPartyAuth) {
          const firstParty = classifyFirstPartyAuthRejection({
            error,
            statusCode: connectAuthStatusCode(error),
            serverRef,
            firstPartyBearer: firstPartyBearerBag.last,
          })
          if (firstParty) {
            return connectAuthRejectedResult(
              name,
              serverRef,
              'http',
              firstParty,
            )
          }
        }
        if (error instanceof UnauthorizedError) {
          return markStoredTokenRejectedForRedial(name, serverRef, () =>
            handleRemoteAuthFailure(name, serverRef, 'http', {
              lacksHelperHeaders,
            }),
          )
        }
      } else if (
        serverRef.type === 'claudeai-proxy' &&
        error instanceof Error
      ) {
        logMCPDebug(
          name,
          `claude.ai proxy connection failed after ${elapsed}ms: ${error.message}`,
        )
        // densable: CLAUDEAI_BEARER_REJECTED on connect is session-token scope
        // (/login), not connector OAuth needs-auth cache.
        if (isClaudeAiBearerRejectedError(error)) {
          logMCPDebug(
            name,
            'claude.ai session token rejected during connect — run /login',
          )
        } else {
          logMCPError(name, error)
        }

        // StreamableHTTPError has a `code` property with the HTTP status;
        // SdkHttpError carries `status`. Both 401 and 403 are user_auth
        // failures (early abort to needs-auth instead of retrying).
        const errorCode =
          error instanceof SdkHttpError
            ? error.status
            : (error as Error & { code?: number }).code
        if (
          (errorCode === 401 || errorCode === 403) &&
          !isClaudeAiBearerRejectedError(error)
        ) {
          return handleRemoteAuthFailure(name, serverRef, 'claudeai-proxy')
        }
      } else if (serverRef.type === 'sse-ide' || serverRef.type === 'ws-ide') {
        logEvent('tengu_mcp_ide_server_connection_failed', {
          connectionDurationMs: elapsed,
        })
      }
      if (inProcessServer) {
        inProcessServer.close().catch(() => {})
      }
      transport.close().catch(() => {})
      if (stderrOutput) {
        logMCPError(name, `Server stderr: ${stderrOutput}`)
        // Official 2.1.326 #84: retain startup stderr snippet so `/mcp` can
        // explain why a local (stdio) MCP server failed to start.
        capturedStartupStderr = stderrOutput.trim().slice(-2000)
      }
      throw error
    }

    const capabilities = client.getServerCapabilities()
    if (isSdkServerWithConnectorsOff(serverRef, capabilities)) {
      client.close().catch(() => {})
      logMCPDebug(name, 'Skipping connection (disableClaudeAiConnectors)')
      logEvent(
        'mcp_connectors_off_in_desktop' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        {},
      )
      return {
        name,
        config: serverRef,
        type: 'failed',
        error: 'Disabled by disableClaudeAiConnectors setting',
        errorCode: CLAUDEAI_CONNECTORS_DISABLED_ERROR_CODE,
      }
    }
    const serverVersion = client.getServerVersion()
    const rawInstructions = client.getInstructions()
    const maxInstructionsLength = getMaxMcpDescriptionLengthForConfig(serverRef)
    let instructions = rawInstructions
    if (rawInstructions && rawInstructions.length > maxInstructionsLength) {
      instructions =
        rawInstructions.slice(0, maxInstructionsLength) + '… [truncated]'
      logMCPDebug(
        name,
        `Server instructions truncated from ${rawInstructions.length} to ${maxInstructionsLength} chars`,
      )
    }

    // Log successful connection details
    logMCPDebug(
      name,
      `Connection established with capabilities: ${jsonStringify({
        hasTools: !!capabilities?.tools,
        hasPrompts: !!capabilities?.prompts,
        hasResources: !!capabilities?.resources,
        hasResourceSubscribe: !!capabilities?.resources?.subscribe,
        serverVersion: serverVersion || 'unknown',
      })}`,
    )
    logForDebugging(
      `[MCP] Server "${name}" connected with subscribe=${!!capabilities?.resources?.subscribe}`,
    )

    // Register default elicitation handler that returns cancel during the
    // window before registerElicitationHandler overwrites it in
    // onConnectionAttempt (useManageMCPConnections).
    // densable: setRequestHandler("elicitation/create", ...)
    client.setRequestHandler('elicitation/create', async request => {
      logMCPDebug(
        name,
        `Elicitation request received during initialization: ${jsonStringify(request)}`,
      )
      return { action: 'cancel' as const }
    })

    if (serverRef.type === 'sse-ide' || serverRef.type === 'ws-ide') {
      const ideConnectionDurationMs = Date.now() - connectStartTime
      logEvent('tengu_mcp_ide_server_connection_succeeded', {
        connectionDurationMs: ideConnectionDurationMs,
        serverVersion:
          serverVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      try {
        void maybeNotifyIDEConnected(client)
      } catch (error) {
        logMCPError(name, `Failed to send ide_connected notification: ${error}`)
      }
    }

    // Enhanced connection drop detection and logging for all transport types
    const connectionStartTime = Date.now()
    let hasErrorOccurred = false

    // Store original handlers
    const originalOnerror = client.onerror
    const originalOnclose = client.onclose

    // Official transportErrorState (O): mid-call drop detection for concurrent tools.
    const transportErrorState = createMcpTransportErrorState()

    // The SDK's transport calls onerror on connection failures but doesn't call onclose,
    // which CC uses to trigger reconnection. We bridge this gap by tracking consecutive
    // terminal errors and manually closing after MAX_ERRORS_BEFORE_RECONNECT failures.
    let consecutiveConnectionErrors = 0
    const MAX_ERRORS_BEFORE_RECONNECT = 3

    // Guard against re-entry: close() aborts in-flight streams which may fire
    // onerror again before the close chain completes.
    let hasTriggeredClose = false

    // client.close() → transport.close() → transport.onclose → SDK's _onclose():
    // rejects all pending request handlers (so hung callTool() promises fail with
    // McpError -32000 "Connection closed") and then invokes our client.onclose
    // handler below (which clears the memo cache so the next call reconnects).
    // Calling client.onclose?.() directly would only clear the cache — pending
    // tool calls would stay hung.
    const closeTransportAndRejectPending = (reason: string) => {
      if (hasTriggeredClose) return
      hasTriggeredClose = true
      logMCPDebug(name, `Closing transport (${reason})`)
      void client.close().catch(e => {
        logMCPDebug(name, `Error during close: ${errorMessage(e)}`)
      })
    }

    // Enhanced error handler with detailed logging
    client.onerror = (error: Error) => {
      const transportType = serverRef.type || 'stdio'
      if (
        (transportType === 'sse' ||
          transportType === 'http' ||
          transportType === 'claudeai-proxy') &&
        error instanceof SyntaxError
      ) {
        hasErrorOccurred = true
        closeTransportAndRejectPending(
          connectAuthProvider?.authChallengeOpen === true &&
            transportErrorState.activeCallWatchdogs.size <= 1
            ? 'malformed message after an auth challenge'
            : 'malformed JSON-RPC message (response truncated)',
        )
        if (originalOnerror) {
          originalOnerror(error)
        }
        return
      }
      const uptime = Date.now() - connectionStartTime
      hasErrorOccurred = true

      // Log the connection drop with context
      logMCPDebug(
        name,
        `${transportType.toUpperCase()} connection dropped after ${Math.floor(uptime / 1000)}s uptime`,
      )

      // Log specific error details for debugging
      if (error.message) {
        if (error.message.includes('ECONNRESET')) {
          logMCPDebug(
            name,
            `Connection reset - server may have crashed or restarted`,
          )
        } else if (error.message.includes('ETIMEDOUT')) {
          logMCPDebug(
            name,
            `Connection timeout - network issue or server unresponsive`,
          )
        } else if (error.message.includes('ECONNREFUSED')) {
          logMCPDebug(name, `Connection refused - server may be down`)
        } else if (error.message.includes('EPIPE')) {
          logMCPDebug(
            name,
            `Broken pipe - server closed connection unexpectedly`,
          )
        } else if (error.message.includes('EHOSTUNREACH')) {
          logMCPDebug(name, `Host unreachable - network connectivity issue`)
        } else if (error.message.includes('ESRCH')) {
          logMCPDebug(
            name,
            `Process not found - stdio server process terminated`,
          )
        } else if (error.message.includes('spawn')) {
          logMCPDebug(
            name,
            `Failed to spawn process - check command and permissions`,
          )
        } else {
          logMCPDebug(name, `Connection error: ${error.message}`)
        }
      }

      // For HTTP transports, detect session expiry (404 + JSON-RPC -32001)
      // and close the transport so pending tool calls reject and the next
      // call reconnects with a fresh session ID.
      if (
        (transportType === 'http' || transportType === 'claudeai-proxy') &&
        isMcpSessionExpiredError(error)
      ) {
        logMCPDebug(
          name,
          `MCP session expired (server returned 404 with session-not-found), triggering reconnection`,
        )
        closeTransportAndRejectPending('session expired')
        if (originalOnerror) {
          originalOnerror(error)
        }
        return
      }

      // For remote transports (SSE/HTTP), track terminal connection errors
      // and trigger reconnection via close if we see repeated failures.
      if (
        transportType === 'sse' ||
        transportType === 'http' ||
        transportType === 'claudeai-proxy'
      ) {
        // The SDK's StreamableHTTP transport fires this after exhausting its
        // own SSE reconnect attempts (default maxRetries: 2) — but it never
        // calls onclose, so pending callTool() promises hang indefinitely.
        // This is the definitive "transport gave up" signal.
        if (error.message.includes('Maximum reconnection attempts')) {
          closeTransportAndRejectPending('SSE reconnection exhausted')
          if (originalOnerror) {
            originalOnerror(error)
          }
          return
        }

        if (isTerminalConnectionError(error)) {
          consecutiveConnectionErrors++
          transportErrorState.consecutiveErrors = consecutiveConnectionErrors
          // Official M(): arm in-flight callTool watchdogs so they abort if
          // no progress arrives within 90s (response presumed lost).
          armAllCallWatchdogs(transportErrorState)
          logMCPDebug(
            name,
            `Terminal connection error ${consecutiveConnectionErrors}/${MAX_ERRORS_BEFORE_RECONNECT}`,
          )

          if (consecutiveConnectionErrors >= MAX_ERRORS_BEFORE_RECONNECT) {
            consecutiveConnectionErrors = 0
            transportErrorState.consecutiveErrors = 0
            closeTransportAndRejectPending('max consecutive terminal errors')
          }
        } else {
          // Non-terminal error (e.g., transient issue), reset counter
          consecutiveConnectionErrors = 0
          transportErrorState.consecutiveErrors = 0
        }
      }

      // Call original handler
      if (originalOnerror) {
        originalOnerror(error)
      }
    }

    // Enhanced close handler with connection drop context
    client.onclose = () => {
      const uptime = Date.now() - connectionStartTime
      const transportType = serverRef.type ?? 'unknown'

      logMCPDebug(
        name,
        `${transportType.toUpperCase()} connection closed after ${Math.floor(uptime / 1000)}s (${hasErrorOccurred ? 'with errors' : 'cleanly'})`,
      )

      // Clear the memoization cache so next operation reconnects
      const key = getServerCacheKey(name, serverRef)

      // Also clear fetch caches (keyed by server name). Reconnection
      // creates a new connection object; without clearing, the next
      // fetch would return stale tools/resources from the old connection.
      fetchToolsForClient.cache.delete(name)
      fetchResourcesForClient.cache.delete(name)
      fetchCommandsForClient.cache.delete(name)
      if (feature('MCP_SKILLS')) {
        fetchMcpSkillsForClient!.cache.delete(name)
      }

      connectToServer.cache.delete(key)
      logMCPDebug(name, `Cleared connection cache for reconnection`)

      if (originalOnclose) {
        originalOnclose()
      }
    }

    const cleanup = async () => {
      // In-process servers (e.g. Chrome MCP) don't have child processes or stderr
      if (inProcessServer) {
        try {
          await inProcessServer.close()
        } catch (error) {
          logMCPDebug(name, `Error closing in-process server: ${error}`)
        }
        try {
          await client.close()
        } catch (error) {
          logMCPDebug(name, `Error closing client: ${error}`)
        }
        return
      }

      // Remove stderr event listener to prevent memory leaks
      if (stderrHandler && (serverRef.type === 'stdio' || !serverRef.type)) {
        const stdioTransport = transport as StdioClientTransport
        stdioTransport.stderr?.off('data', stderrHandler)
      }

      // For stdio transports, explicitly terminate the child process with proper signals
      // NOTE: StdioClientTransport.close() only sends an abort signal, but many MCP servers
      // (especially Docker containers) need explicit SIGINT/SIGTERM signals to trigger graceful shutdown
      if (serverRef.type === 'stdio') {
        try {
          const stdioTransport = transport as StdioClientTransport
          const stdioTransportWithProc = stdioTransport as unknown as {
            _process?: import('child_process').ChildProcess
            serverProcess?: import('child_process').ChildProcess
          }
          const stdioProc =
            stdioTransportWithProc.serverProcess ??
            stdioTransportWithProc._process
          const childPid = stdioTransport.pid

          if (stdioProc && getPlatform() === 'windows') {
            logMCPDebug(name, 'Closing MCP server stdin')
            await gracefulShutdownWindowsStdio(stdioProc)
          } else if (childPid) {
            logMCPDebug(name, 'Sending SIGINT to MCP server process')

            // First try SIGINT (like Ctrl+C)
            try {
              process.kill(childPid, 'SIGINT')
            } catch (error) {
              logMCPDebug(name, `Error sending SIGINT: ${error}`)
              return
            }

            // Wait for graceful shutdown with rapid escalation (total 500ms to keep CLI responsive)
            // biome-ignore lint/suspicious/noAsyncPromiseExecutor: async needed for sequential await inside executor
            await new Promise<void>(async resolve => {
              let resolved = false

              // Set up a timer to check if process still exists
              const checkInterval = setInterval(() => {
                try {
                  // process.kill(pid, 0) checks if process exists without killing it
                  process.kill(childPid, 0)
                } catch {
                  // Process no longer exists
                  if (!resolved) {
                    resolved = true
                    clearInterval(checkInterval)
                    clearTimeout(failsafeTimeout)
                    logMCPDebug(name, 'MCP server process exited cleanly')
                    resolve()
                  }
                }
              }, 50)

              // Absolute failsafe: clear interval after 600ms no matter what
              const failsafeTimeout = setTimeout(() => {
                if (!resolved) {
                  resolved = true
                  clearInterval(checkInterval)
                  logMCPDebug(
                    name,
                    'Cleanup timeout reached, stopping process monitoring',
                  )
                  resolve()
                }
              }, 600)

              try {
                // Wait 100ms for SIGINT to work (usually much faster)
                await sleep(100)

                if (!resolved) {
                  // Check if process still exists
                  try {
                    process.kill(childPid, 0)
                    // Process still exists, SIGINT failed, try SIGTERM
                    logMCPDebug(
                      name,
                      'SIGINT failed, sending SIGTERM to MCP server process',
                    )
                    try {
                      process.kill(childPid, 'SIGTERM')
                    } catch (termError) {
                      logMCPDebug(name, `Error sending SIGTERM: ${termError}`)
                      resolved = true
                      clearInterval(checkInterval)
                      clearTimeout(failsafeTimeout)
                      resolve()
                      return
                    }
                  } catch {
                    // Process already exited
                    resolved = true
                    clearInterval(checkInterval)
                    clearTimeout(failsafeTimeout)
                    resolve()
                    return
                  }

                  // Wait 400ms for SIGTERM to work (slower than SIGINT, often used for cleanup)
                  await sleep(400)

                  if (!resolved) {
                    // Check if process still exists
                    try {
                      process.kill(childPid, 0)
                      // Process still exists, SIGTERM failed, force kill with SIGKILL
                      logMCPDebug(
                        name,
                        'SIGTERM failed, sending SIGKILL to MCP server process',
                      )
                      try {
                        process.kill(childPid, 'SIGKILL')
                      } catch (killError) {
                        logMCPDebug(name, `Error sending SIGKILL: ${killError}`)
                      }
                    } catch {
                      // Process already exited
                      resolved = true
                      clearInterval(checkInterval)
                      clearTimeout(failsafeTimeout)
                      resolve()
                    }
                  }
                }

                // Final timeout - always resolve after 500ms max (total cleanup time)
                if (!resolved) {
                  resolved = true
                  clearInterval(checkInterval)
                  clearTimeout(failsafeTimeout)
                  resolve()
                }
              } catch {
                // Handle any errors in the escalation sequence
                if (!resolved) {
                  resolved = true
                  clearInterval(checkInterval)
                  clearTimeout(failsafeTimeout)
                  resolve()
                }
              }
            })
          }
        } catch (processError) {
          logMCPDebug(name, `Error terminating process: ${processError}`)
        }
      }

      // Close the client connection (which also closes the transport)
      try {
        await client.close()
      } catch (error) {
        logMCPDebug(name, `Error closing client: ${error}`)
      }
    }

    // Register cleanup for all transport types - even network transports might need cleanup
    // This ensures all MCP servers get properly terminated, not just stdio ones
    const cleanupUnregister = registerCleanup(cleanup)

    // Create the wrapped cleanup that includes unregistering
    const wrappedCleanup = async () => {
      hostState.liveMcpClients.delete(client)
      cleanupUnregister?.()
      await cleanup()
    }
    hostState.liveMcpClients.add(client)

    const connectionDurationMs = Date.now() - connectStartTime
    logEvent('tengu_mcp_server_connection_succeeded', {
      connectionDurationMs,
      transportType: (serverRef.type ??
        'stdio') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      totalServers: serverStats?.totalServers,
      stdioCount: serverStats?.stdioCount,
      sseCount: serverStats?.sseCount,
      httpCount: serverStats?.httpCount,
      sseIdeCount: serverStats?.sseIdeCount,
      wsIdeCount: serverStats?.wsIdeCount,
      ...mcpBaseUrlAnalytics(serverRef),
    })

    // densable 2.1.233 #6 — hNf: subscriptions/listen re-open / park watcher.
    // densable opS uses timeout:k0() ≡ getMcpTimeoutMs() (MCP_TIMEOUT / y0).
    // No-ops on legacy era without autoOpenedSubscription (list_changed via
    // unsolicited notifications + setNotificationHandler still works).
    try {
      const { attachMcpListenReopenWatcher } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./mcpListenReopen.js') as typeof import('./mcpListenReopen.js')
      attachMcpListenReopenWatcher(
        client as import('./mcpListenReopen.js').McpListenCapableClient,
        name,
        { timeoutMs: getMcpTimeoutMs() },
      )
    } catch (err) {
      logMCPDebug(
        name,
        `subscriptions/listen re-open watcher attach failed: ${errorMessage(err)}`,
      )
    }

    const connectedClientResult: ConnectedMCPServer = {
      name,
      client,
      type: 'connected' as const,
      capabilities: capabilities ?? {},
      serverInfo: serverVersion,
      instructions,
      config: serverRef,
      cleanup: wrappedCleanup,
      transportErrorState,
      // densable M.protocolEra — i3r/Yrf era gate. Unset is not modern.
      protocolEra: readClientProtocolEra(client),
    }
    // Official 2.1.325 #2305 (`Hmi()?.(Os)`): immediately run session-level
    // connected-client wiring (e.g. headless elicitation handler) before
    // returning so a reconnect mid-tool-call never falls back to the cancel
    // placeholder.
    try {
      const wiring = hostState.connectedClientWiring
      if (wiring) {
        const wiringSession =
          hostState.connectedClientWiringSession ?? capturedSession
        runWithSession(wiringSession, () => wiring(connectedClientResult))
      }
    } catch (wiringErr) {
      logMCPError(
        name,
        `connected-client wiring failed (placeholder retained, adoption will retry): ${errorMessage(wiringErr)}`,
      )
    }
    if (serverRef.type === 'http' || serverRef.type === 'sse') {
      await clearMcpOAuthStubIfTokenless(name, serverRef)
    }
    // Official 2.1.325 #2308: notify background MCP task pollers that a fresh
    // connection for this server is live so they resume updating.
    notifyMcpServerConnected(connectedClientResult)
    return connectedClientResult
  } catch (error) {
    const connectionDurationMs = Date.now() - connectStartTime
    logEvent('tengu_mcp_server_connection_failed', {
      connectionDurationMs,
      totalServers: serverStats?.totalServers || 1,
      stdioCount:
        serverStats?.stdioCount || (serverRef.type === 'stdio' ? 1 : 0),
      sseCount: serverStats?.sseCount || (serverRef.type === 'sse' ? 1 : 0),
      httpCount: serverStats?.httpCount || (serverRef.type === 'http' ? 1 : 0),
      sseIdeCount:
        serverStats?.sseIdeCount || (serverRef.type === 'sse-ide' ? 1 : 0),
      wsIdeCount:
        serverStats?.wsIdeCount || (serverRef.type === 'ws-ide' ? 1 : 0),
      transportType: (serverRef.type ??
        'stdio') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...mcpBaseUrlAnalytics(serverRef),
    })
    logMCPDebug(
      name,
      `Connection failed after ${connectionDurationMs}ms: ${errorMessage(error)}`,
    )
    logMCPError(name, `Connection failed: ${errorMessage(error)}`)

    if (inProcessServer) {
      inProcessServer.close().catch(() => {})
    }
    // densable 2.1.219: surface errorCode (HTTP / errno / ENDPOINT_NOT_FOUND)
    // so mcp list / /mcp can show status — issue (fSp/mSp).
    let errorText = errorMessage(error)
    const issuerEchoDenied =
      error instanceof IssuerEchoCrossOriginError ||
      (error instanceof Error &&
        error.cause instanceof IssuerEchoCrossOriginError)
    let errorCode = issuerEchoDenied
      ? 'ISSUER_ECHO_DENIED'
      : extractMcpConnectionErrorCode(error, {
          transportType: serverRef.type,
          hasSessionId: false,
        })
    if (errorCode === 'CONNECT_TIMEOUT') {
      const suspendedMessage = detectConnectSuspendedMessage(
        name,
        connectClockSnapshot,
      )
      if (suspendedMessage !== undefined) {
        errorCode = 'CONNECT_SUSPENDED'
        errorText = suspendedMessage
      }
    }
    if (errorCode === 'ENDPOINT_NOT_FOUND' && 'url' in serverRef) {
      // densable 2.1.234 #13 cHr — connection-failure details show only origin
      const origin = getMcpServerUrlOrigin(serverRef) ?? '(unparseable url)'
      errorText = `MCP endpoint not found at ${origin}. Check the URL in your MCP config.`
    }
    if (
      (serverRef.type === undefined || serverRef.type === 'stdio') &&
      capturedStartupStderr &&
      !errorText.includes(capturedStartupStderr)
    ) {
      errorText = errorText
        ? `${errorText}\n${capturedStartupStderr}`
        : capturedStartupStderr
    }
    return {
      name,
      type: 'failed' as const,
      config: serverRef,
      error: errorText,
      ...(errorCode !== undefined ? { errorCode } : {}),
    }
  }
}

export type EnsureConnectedClientOpts = {
  signal?: AbortSignal
  timeoutMs?: number
  context?: string
}

/**
 * densable ensureConnectedClient → connect with `{signal, timeoutMs}`.
 * Cache key stays name+config (`getServerCacheKey`); deadline is per-call.
 */
/**
 * Official `Iei(n)` (#1564) — unset `AWS_BEARER_TOKEN_BEDROCK` when empty so
 * stdio MCP children don't inherit an empty bearer token override.
 */
export function unsetEmptyAwsBearerTokenBedrock(
  env: Record<string, string>,
): void {
  const isWin = getPlatform() === 'windows'
  const keys = Object.keys(env).filter(
    k =>
      k === 'AWS_BEARER_TOKEN_BEDROCK' ||
      (isWin && k.toUpperCase() === 'AWS_BEARER_TOKEN_BEDROCK'),
  )
  if (keys.some(k => env[k] === '')) {
    for (const k of keys) {
      delete env[k]
    }
  }
}

export const connectToServer = Object.assign(
  (
    name: string,
    serverRef: ScopedMcpServerConfig,
    serverStats?: {
      totalServers: number
      stdioCount: number
      sseCount: number
      httpCount: number
      sseIdeCount: number
      wsIdeCount: number
    },
    connectOpts?: EnsureConnectedClientOpts,
  ) => {
    ensureMcpAccountIdentityResolver()
    const work = getHostMcpClientState().connectToServerMemo(
      name,
      serverRef,
      serverStats,
    )
    if (
      connectOpts?.timeoutMs === undefined &&
      connectOpts?.signal === undefined
    ) {
      return work
    }
    // densable V(): per-call `{signal, timeoutMs}` rejects this waiter only.
    // Cache key stays name+config — do not abandon the shared handshake.
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    const deadline = new Promise<never>((_, reject) => {
      if (connectOpts.timeoutMs !== undefined) {
        timer = setTimeout(
          () => {
            reject(
              new Error('deadline reached before the request could be sent'),
            )
          },
          Math.max(1, connectOpts.timeoutMs),
        )
      }
      onAbort = () => {
        if (timer !== undefined) clearTimeout(timer)
        reject(new AbortError('aborted'))
      }
      if (connectOpts.signal?.aborted) onAbort()
      else
        connectOpts.signal?.addEventListener('abort', onAbort, { once: true })
    })
    return Promise.race([work, deadline]).finally(() => {
      if (timer !== undefined) clearTimeout(timer)
      if (onAbort) connectOpts.signal?.removeEventListener('abort', onAbort)
    })
  },
  {
    cache: createHostCacheProxy(
      () => getHostMcpClientState().connectToServerMemo.cache,
    ),
  },
)

/**
 * Clears the memoize cache for a specific server.
 * Only runs connect/cleanup when the connection is already memoized — never
 * starts a fresh connect just to tear it down (pending/failed /chrome Off,
 * config-only entries). Always drops connection + tools/resources/commands
 * cache entries so the next mount fetches clean state.
 * @param name Server name
 * @param serverRef Server configuration
 */
/**
 * #2052: Official `supersededDials` WeakSet. Tracks in-flight or previously
 * cached connect promises invalidated by removal/disconnect so a tool call
 * racing removal can never poison a subsequently re-added server with a stale
 * disconnected/failed cache entry.
 */
const supersededMcpDials = new WeakSet<Promise<MCPServerConnection>>()

export function isSupersededMcpDial(
  dial: Promise<MCPServerConnection> | undefined,
): boolean {
  return dial !== undefined && supersededMcpDials.has(dial)
}

export function markSupersededMcpDial(
  name: string,
  config: ScopedMcpServerConfig,
): void {
  const key = getServerCacheKey(name, config)
  const pending = connectToServer.cache?.get?.(key) as
    | Promise<MCPServerConnection>
    | undefined
  if (pending !== undefined) {
    supersededMcpDials.add(pending)
  }
}

function clearPostReopenHandlersForServer(name: string): void {
  // densable xVa entry lifecycle — drop post-reopen list handlers with connection
  try {
    const { clearMcpListenPostReopenHandlers } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./mcpListenReopen.js') as typeof import('./mcpListenReopen.js')
    clearMcpListenPostReopenHandlers(name)
  } catch {
    // optional
  }
}

/**
 * Official `en` — inspect a memoized connect promise without blocking on an
 * unsettled in-flight dial (0ms race). Resolves to the connection if already
 * settled, or undefined if still pending or rejected.
 */
async function peekSettledPromise(
  pending: Promise<MCPServerConnection>,
): Promise<MCPServerConnection | undefined> {
  return Promise.race([
    pending.catch(() => undefined),
    new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 0)),
  ])
}

export async function clearServerCache(
  name: string,
  serverRef: ScopedMcpServerConfig,
  keepAliveOut?: { connection?: ConnectedMCPServer },
): Promise<void> {
  const key = getServerCacheKey(name, serverRef)

  // lodash memoize Cache supports .get; avoid calling connectToServer when
  // missing so disable paths do not race a brand-new Chrome native-host dial.
  const previousPending = connectToServer.cache?.get?.(key) as
    | Promise<MCPServerConnection>
    | undefined

  if (previousPending !== undefined) {
    const settled = await peekSettledPromise(previousPending)
    if (settled === undefined) {
      // Official `cg(e, o, g)` — dial is still in flight (or rejected): mark
      // superseded, evict memo caches synchronously, and close on settlement.
      if (connectToServer.cache?.get?.(key) === previousPending) {
        supersededMcpDials.add(previousPending)
        evictMcpMemoCaches(key, name)
        void previousPending.then(
          conn => {
            if (conn.type === 'connected') {
              void detachAndCloseConnection(conn)
            }
          },
          () => {},
        )
      }
      clearPostReopenHandlersForServer(name)
      return
    }

    if (settled.type === 'connected') {
      if (
        keepAliveOut !== undefined &&
        connectToServer.cache?.get?.(key) === previousPending &&
        settled.client.transport !== undefined &&
        (settled.transportErrorState?.activeCallWatchdogs.size ?? 0) > 0
      ) {
        keepAliveOut.connection = settled
        return
      }
      // Normal (non-kept) teardown: mark superseded and evict memo caches
      // synchronously BEFORE awaiting close/cleanup so concurrent dials cannot
      // observe the dying connection in the memo cache.
      supersededMcpDials.add(previousPending)
      if (connectToServer.cache?.get?.(key) === previousPending) {
        evictMcpMemoCaches(key, name)
      }
      clearPostReopenHandlersForServer(name)
      settled.client.onclose = undefined
      try {
        await settled.cleanup()
      } catch {
        // Ignore cleanup errors
      }
      return
    }

    // Settled as non-connected ('failed', 'needs-auth', etc.):
    supersededMcpDials.add(previousPending)
    const current = connectToServer.cache?.get?.(key)
    if (current !== undefined && current !== previousPending) {
      return
    }
  }

  // Clear from cache (both connection and fetch caches so reconnect
  // fetches fresh tools/resources/commands instead of stale ones)
  evictMcpMemoCaches(key, name)
  clearPostReopenHandlersForServer(name)
}

/** Official `l1` — settle a memoized connect promise; undefined on reject. */
async function settleMemoizedConnection(
  pending: Promise<MCPServerConnection>,
): Promise<MCPServerConnection | undefined> {
  return pending.catch(() => undefined)
}

/**
 * Official `n2t` — drop the connect memo and per-server list caches for `key`.
 */
function evictMcpMemoCaches(key: string, name?: string): void {
  connectToServer.cache.delete(key)
  const serverName = name ?? key.slice(0, Math.max(0, key.lastIndexOf('-')))
  fetchToolsForClient.cache.delete(serverName)
  fetchResourcesForClient.cache.delete(serverName)
  fetchCommandsForClient.cache.delete(serverName)
  if (feature('MCP_SKILLS')) {
    fetchMcpSkillsForClient!.cache.delete(serverName)
  }
}

/**
 * Official `t2t` / `peekSettledConnection` — the memoized settled client for
 * `getServerCacheKey(name, config)`, or undefined if the memo is missing /
 * rejected.
 */
export async function peekSettledConnection(
  name: string,
  config: ScopedMcpServerConfig,
): Promise<MCPServerConnection | undefined> {
  const pending = connectToServer.cache?.get?.(getServerCacheKey(name, config))
  if (pending === undefined) return undefined
  return settleMemoizedConnection(pending as Promise<MCPServerConnection>)
}

/**
 * Official `XE` / `detachAndCloseConnection` — clear onclose, evict the memo
 * when it still holds this connection, then cleanup.
 */
export function detachAndCloseConnection(
  connection: ConnectedMCPServer,
): Promise<void> {
  connection.client.onclose = undefined
  const key = getServerCacheKey(connection.name, connection.config)
  const pending = connectToServer.cache?.get?.(key) as
    | Promise<MCPServerConnection>
    | undefined
  if (pending !== undefined) {
    void settleMemoizedConnection(pending).then(settled => {
      if (
        settled === connection &&
        connectToServer.cache?.get?.(key) === pending
      ) {
        evictMcpMemoCaches(key, connection.name)
      }
    })
  }
  return connection.cleanup().catch(() => {})
}

/**
 * Official `eke` / `dropDiscoveryEntry` — drop memoized discovery for this
 * server so the next dial is a fresh connect.
 */
export async function dropDiscoveryEntry(
  name: string,
  config: ScopedMcpServerConfig,
): Promise<void> {
  dropDiscoveryCacheEntry(name, config)
  evictMcpMemoCaches(getServerCacheKey(name, config), name)
}

/**
 * densable `En` / `evictStaleFailedConnectMemoForServe` — drop the connect
 * memo only when it settled `failed` (gold `j()` after `connect_failed`).
 */
export async function evictStaleFailedConnectMemoForServe(
  name: string,
  config: ScopedMcpServerConfig,
): Promise<void> {
  const key = getServerCacheKey(name, config)
  const pending = connectToServer.cache?.get?.(key) as
    | Promise<MCPServerConnection>
    | undefined
  if (pending === undefined) return
  const settled = await settleMemoizedConnection(pending)
  if (settled?.type !== 'failed') return
  if (connectToServer.cache?.get?.(key) !== pending) return
  evictMcpMemoCaches(key, name)
}

/** Gold Pa/Pn: detach a memo immediately and close its eventual result. */
export function disposeServerConnectionDetached(
  name: string,
  config: ScopedMcpServerConfig,
  expected?: Promise<MCPServerConnection>,
): void {
  ensureMcpAccountIdentityResolver()
  const key = getServerCacheKey(name, config)
  const pending = connectToServer.cache.get(key) as
    | Promise<MCPServerConnection>
    | undefined
  if (expected !== undefined && pending !== expected) return
  // #2052: Mark removed/detached dial as superseded before evicting cache.
  if (pending !== undefined) {
    supersededMcpDials.add(pending)
  }
  evictMcpMemoCaches(key, name)
  if (pending) {
    void pending.then(
      connection => {
        if (connection.type === 'connected') {
          void detachAndCloseConnection(connection)
        }
      },
      () => {},
    )
  }
}

function preserveMcpMemoEntries<T>(
  cache: {
    get: (key: string) => T | undefined
    set: (key: string, value: T) => void
    clear?: () => void
  },
  keep: ReadonlySet<string>,
): void {
  const preserved: [string, T][] = []
  for (const key of keep) {
    const value = cache.get(key)
    if (value !== undefined) preserved.push([key, value])
  }
  cache.clear?.()
  for (const [key, value] of preserved) cache.set(key, value)
}

/** Gold xp/sd: invalidate account-sensitive memo generations, preserving slots. */
export function evictAllMcpMemosOnIdentityChange(
  keep = new Set<string>(),
  markIdentityChanged = true,
): void {
  if (!isMcpIdentityBoundaryEnabled()) return
  if (markIdentityChanged) markMcpIdentityChanged()
  advanceMcpIdentityEpoch()
  clearAuthReconnectInFlight()
  preserveMcpMemoEntries(connectToServer.cache, keep)
  preserveMcpMemoEntries(fetchToolsForClient.cache, keep)
  preserveMcpMemoEntries(fetchResourcesForClient.cache, keep)
  preserveMcpMemoEntries(fetchCommandsForClient.cache, keep)
  if (feature('MCP_SKILLS')) {
    preserveMcpMemoEntries(fetchMcpSkillsForClient!.cache, keep)
  }
}

/** Gold Hp: discard only the same settled non-connected memo. */
export async function discardMemoizedConnectResult(
  name: string,
  config: ScopedMcpServerConfig,
): Promise<boolean> {
  const key = getServerCacheKey(name, config)
  const pending = connectToServer.cache.get(key)
  if (!isMcpIdentityBoundaryEnabled()) {
    connectToServer.cache.delete(key)
    return true
  }
  if (pending !== undefined) {
    const row = await settleMemoizedConnection(pending)
    if (row === undefined || row.type === 'connected') return false
    if (connectToServer.cache.get(key) !== pending) return false
  }
  connectToServer.cache.delete(key)
  return true
}

/**
 * Official `cleanupConnectedMcpClients` — detach every connected client at
 * print/SDK session teardown (`$d=!0` then this).
 */
export async function cleanupConnectedMcpClients(
  clients: readonly MCPServerConnection[],
): Promise<void> {
  await Promise.all(
    clients
      .filter((c): c is ConnectedMCPServer => c.type === 'connected')
      .map(c => detachAndCloseConnection(c)),
  )
}

/**
 * densable `Ld` — raw SDK tools/call. Gold is `Ls(e).callTool(r, void 0, n)`
 * (schema middle). Public client@2 is `callTool(params, options)`; putting
 * `{signal, timeout}` in the 2nd arg is what actually aborts the request.
 */
export function invokeToolRaw(
  client: {
    callTool: (
      params: {
        name: string
        arguments?: Record<string, unknown>
        _meta?: Record<string, unknown>
      },
      options?: { signal?: AbortSignal; timeout?: number },
    ) => Promise<unknown>
  },
  params: {
    name: string
    arguments?: Record<string, unknown>
    _meta?: Record<string, unknown>
  },
  options?: { signal?: AbortSignal; timeout?: number },
): Promise<unknown> {
  return client.callTool(params, options)
}

/**
 * Official 2.1.328 `Ah` / `YP` (chunk@335138039.js @146201):
 * Build `roots/list` entries from the original cwd plus any
 * `additionalWorkingDirectories`, deduplicated by file:// URI, and broadcast
 * `notifications/roots/list_changed` to all live MCP clients when roots change.
 */
export function buildMcpRootsList(
  primaryDir: string | null = getOriginalCwd(),
  additionalDirs: readonly string[] = getAdditionalDirectoriesForClaudeMd(),
): { roots: Array<{ uri: string }> } {
  const seen = new Set<string>()
  const roots: Array<{ uri: string }> = []
  const candidates = [...(primaryDir ? [primaryDir] : []), ...additionalDirs]
  for (const dir of candidates) {
    if (!dir) continue
    let uri: string
    try {
      uri = pathToFileURL(dir).href
    } catch {
      uri = `file://${dir}`
    }
    if (seen.has(uri)) continue
    seen.add(uri)
    roots.push({ uri })
  }
  return { roots }
}

export function notifyMcpRootsListChanged(
  extraConnections?: ReadonlyArray<{
    type: string
    name?: string
    client?: { sendRootsListChanged?: () => Promise<void> }
  }>,
): void {
  const notified = new Set<unknown>()
  for (const client of getHostMcpClientState().liveMcpClients) {
    notified.add(client)
    client.sendRootsListChanged().catch(err => {
      logForDebugging(
        `MCP: failed to send roots/list_changed: ${errorMessage(err)}`,
      )
    })
  }
  if (!Array.isArray(extraConnections)) return
  for (const conn of extraConnections) {
    if (
      conn.type === 'connected' &&
      conn.client &&
      !notified.has(conn.client) &&
      typeof conn.client.sendRootsListChanged === 'function'
    ) {
      notified.add(conn.client)
      conn.client.sendRootsListChanged().catch((err: unknown) => {
        logForDebugging(
          `MCP: failed to send roots/list_changed to "${conn.name ?? 'unknown'}": ${errorMessage(err)}`,
        )
      })
    }
  }
}

export function _registerLiveMcpClientForTests(client: Client): () => void {
  const state = getHostMcpClientState()
  state.liveMcpClients.add(client)
  return () => {
    state.liveMcpClients.delete(client)
  }
}

/**
 * Official 2.1.325 #2305 (`F9t` / `Hmi`): session-level connected-client wiring
 * hook (e.g., headless elicitation handler registration) invoked synchronously
 * on every newly connected MCP client before `connectToServer` returns.
 */
export function registerConnectedClientWiring(
  wiring: ConnectedClientWiringFn | undefined,
): () => void {
  const state = getHostMcpClientState()
  state.connectedClientWiring = wiring
  state.connectedClientWiringSession =
    wiring !== undefined ? getActiveSessionFromAls() : undefined
  return () => {
    if (state.connectedClientWiring === wiring) {
      state.connectedClientWiring = undefined
      state.connectedClientWiringSession = undefined
    }
  }
}

export function getConnectedClientWiring():
  | ConnectedClientWiringFn
  | undefined {
  return getHostMcpClientState().connectedClientWiring
}

/**
 * Official 2.1.325 #2306 (`Nmi` / `Brr`): live tool-pool swapper invoked after
 * a mid-call reconnect so SDK host tool calls point to the fresh connection
 * instead of answering "Not connected".
 */
export function registerMcpToolsSwapper(
  swapper: McpToolsSwapperFn | undefined,
): () => void {
  const state = getHostMcpClientState()
  state.mcpToolsSwapper = swapper
  state.mcpToolsSwapperSession =
    swapper !== undefined ? getActiveSessionFromAls() : undefined
  return () => {
    if (state.mcpToolsSwapper === swapper) {
      state.mcpToolsSwapper = undefined
      state.mcpToolsSwapperSession = undefined
    }
  }
}

export function swapMcpServerTools(
  serverName: string,
  tools: Tool[],
  config: ScopedMcpServerConfig,
  connectedClient?: ConnectedMCPServer,
): boolean {
  const state = getHostMcpClientState()
  const swapper = state.mcpToolsSwapper
  if (!swapper) return false
  const session = state.mcpToolsSwapperSession
  return session !== undefined
    ? runWithSession(session, () =>
        swapper(serverName, tools, config, connectedClient),
      )
    : swapper(serverName, tools, config, connectedClient)
}

/**
 * Official 2.1.325 #2308: per-server reconnect listener registry so background
 * MCP tasks immediately switch to the reconnected client and resume updates.
 */
export function onMcpServerConnected(
  serverName: string,
  listener: McpServerConnectedListener,
): () => void {
  const state = getHostMcpClientState()
  const capturedSession = getActiveSessionFromAls()
  const wrapped: McpServerConnectedListener =
    capturedSession !== undefined
      ? client => runWithSession(capturedSession, () => listener(client))
      : listener
  let set = state.mcpServerConnectedListeners.get(serverName)
  if (!set) {
    set = new Set()
    state.mcpServerConnectedListeners.set(serverName, set)
  }
  set.add(wrapped)
  return () => {
    const existing = state.mcpServerConnectedListeners.get(serverName)
    if (!existing) return
    existing.delete(wrapped)
    if (existing.size === 0) {
      state.mcpServerConnectedListeners.delete(serverName)
    }
  }
}

export function notifyMcpServerConnected(client: ConnectedMCPServer): void {
  const listeners = getHostMcpClientState().mcpServerConnectedListeners.get(
    client.name,
  )
  if (!listeners || listeners.size === 0) return
  for (const listener of [...listeners]) {
    try {
      listener(client)
    } catch (err) {
      logMCPDebug(
        client.name,
        `onMcpServerConnected listener failed: ${errorMessage(err)}`,
      )
    }
  }
}

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

export {
  applyCapabilityServeTimeMiss,
  discoverySourceForMiss,
  dropDiscoveryCacheEntry,
  getDiscoveryFetchError,
  isCacheOutcomeMiss,
  isMcpDiscoveryCacheEnabled,
  persistLiveListing,
  persistRawDiscoveryIfComplete,
  readDiscoveryCacheEntry,
  recordDiscoveryFetchErrorForResult,
  recordDiscoveryRefreshStrike,
  recordRawCommandsForResult,
  recordRawResourcesForResult,
  recordRawToolsForResult,
  runCachedFirstDialArms,
  subscribeCachedAdopt,
  subscribeCachedDialFailed,
  takeSettledCachedDialFailure,
  writeDiscoveryCacheEntry,
  type CachedDiscoveryListing,
  type CachedMcpPromptEntry,
  type DiscoveryCacheReadOutcome,
}

/**
 * Ensures a valid connected client for an MCP server.
 * For most server types, uses the memoization cache if available, or reconnects
 * if the cache was cleared (e.g., after onclose). This ensures tool/resource
 * calls always use a valid connection.
 *
 * SDK MCP servers run in-process and are handled separately via setupSdkMcpClients,
 * so they are returned as-is without going through connectToServer.
 *
 * @param client The connected MCP server client
 * @returns Connected MCP server client (same or reconnected)
 * @throws Error if server cannot be connected
 */
/**
 * Official 2.1.326 #80 (`mi`/`Ai`/`Jo` @335339656): Track MCP servers removed
 * from the active session (e.g. via SDK `mcp_set_servers`) so in-flight or
 * subsequent tool calls never reconnect to them or report `needs-auth`.
 */
export function markMcpServerRemovedFromSession(
  name: string,
  config?: object,
): void {
  const state = getHostMcpClientState()
  state.removedMcpServerNames.add(name)
  if (config) {
    state.removedMcpServerConfigs.add(config)
  }
}

export function unmarkMcpServerRemovedFromSession(
  name: string,
  config?: object,
): void {
  const state = getHostMcpClientState()
  if (config && state.removedMcpServerConfigs.has(config)) {
    return
  }
  state.removedMcpServerNames.delete(name)
}

export function isMcpServerRemovedFromSession(
  name: string,
  config?: object,
): boolean {
  const state = getHostMcpClientState()
  if (config && state.removedMcpServerConfigs.has(config)) {
    return true
  }
  return state.removedMcpServerNames.has(name)
}

export function clearRemovedMcpServersTracking(): void {
  const state = getHostMcpClientState()
  state.removedMcpServerNames.clear()
  state.removedMcpServerConfigs = new WeakSet<object>()
}

export function formatMcpServerRemovedError(name: string): string {
  return `MCP server "${name}" was not called: it was removed from this session. Continue without it.`
}

/**
 * Official 2.1.326 #81 (`q9a` @288151558): Explain to Claude when a server's
 * tool call failure followed a declined elicitation question.
 */
export function formatMcpElicitationDeclinedError(
  replyMessage: string,
): string {
  const trimmed = replyMessage.trim()
  return `${trimmed === '' ? 'This call failed. That' : `The server replied: "${trimmed}". That reply`} came after a question that the server asked about this call was declined, and the decline still stands. Another call for this action repeats the request that the question was about.`
}

/**
 * Official 2.1.326 #255 (`HHt` @288150814): Outcome-unknown guidance when a
 * `claudeai-proxy` MCP call is cut off after being sent.
 */
export const MCP_CALL_OUTCOME_UNKNOWN_NOTE =
  'The outcome is unknown: the call may have finished, may still be running, or may never have started. Check what it did before you repeat it.'

export function isClaudeAiProxyCutOffAfterSend(
  error: unknown,
  configType: string | undefined,
  signalAborted: boolean,
): boolean {
  if (configType !== 'claudeai-proxy' || signalAborted) {
    return false
  }
  if (!(error instanceof Error)) {
    return false
  }
  if (
    error.name === 'AbortError' ||
    error instanceof McpAuthError ||
    error instanceof
      McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS ||
    error instanceof TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  ) {
    return false
  }
  if (isMcpConnectionClosedError(error)) {
    return true
  }
  const status =
    error instanceof SdkHttpError
      ? error.status
      : typeof (error as unknown as { code?: unknown }).code === 'number'
        ? (error as unknown as { code: number }).code
        : undefined
  if (status === undefined || error.name === 'TimeoutError') {
    return !(error instanceof SdkError) || error.name === 'TimeoutError'
  }
  return status >= 500
}

export async function ensureConnectedClient(
  client: ConnectedMCPServer | CachedMCPServer,
  opts?: EnsureConnectedClientOpts,
): Promise<ConnectedMCPServer> {
  // Official 2.1.326 #80: Never reconnect or report needs-auth for a server
  // that the SDK host / session just removed.
  if (isMcpServerRemovedFromSession(client.name, client.config)) {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      formatMcpServerRemovedError(client.name),
      'MCP server removed from session',
    )
  }

  // SDK MCP servers run in-process and are handled separately via setupSdkMcpClients
  if (client.config.type === 'sdk') {
    if (client.type === 'connected') return client
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      `MCP server "${client.name}" is not connected`,
      'MCP server not connected',
    )
  }

  const key = getServerCacheKey(client.name, client.config)
  const cachedDial = connectToServer.cache?.get?.(key) as
    | Promise<MCPServerConnection>
    | undefined

  // #2052: Never reuse a superseded dial left behind by a remove + re-add.
  if (isSupersededMcpDial(cachedDial)) {
    evictMcpMemoCaches(key, client.name)
  }

  // #2002: If a claude.ai gateway bearer token was previously rejected and the
  // user has since run `/login` in another terminal, drop the stale failed memo
  // and refresh keychain credentials so the connector recovers automatically.
  if (client.config.type === 'claudeai-proxy') {
    clearKeychainCache()
    if (hasClaudeAiBearerRecoveredAfterLogin()) {
      clearRejectedClaudeAiBearerToken()
      evictMcpMemoCaches(key, client.name)
    }
  }

  const dialEpoch = getMcpIdentityEpoch()
  const dialPromise = connectToServer(
    client.name,
    client.config,
    undefined,
    opts,
  )
  let connectedClient = await dialPromise
  if (client.type === 'cached') {
    runCachedFirstDialArms(connectedClient, dialPromise, dialEpoch, {
      isSuperseded: isSupersededMcpDial,
      getCurrentDial: k =>
        connectToServer.cache?.get?.(k) as
          | Promise<MCPServerConnection>
          | undefined,
      deleteCurrentDial: k => {
        connectToServer.cache?.delete?.(k)
      },
      getIdentityEpoch: getMcpIdentityEpoch,
      detachAndClose: c => {
        void detachAndCloseConnection(c).catch(() => {})
      },
    })
  }
  // #2052: If a cached failed entry came from an earlier tool call while the
  // server was removed/disconnected, evict it once so a re-added server dials fresh.
  if (connectedClient.type !== 'connected' && cachedDial !== undefined) {
    evictMcpMemoCaches(key, client.name)
    connectedClient = await connectToServer(
      client.name,
      client.config,
      undefined,
      opts,
    )
  }
  if (connectedClient.type !== 'connected') {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      `MCP server "${client.name}" is not connected`,
      'MCP server not connected',
    )
  }
  return connectedClient
}

// Official w7e — register dial path on host.mcpProcessWiring for vx() callers.
registerEnsureConnectedClient(ensureConnectedClient)

const NON_REAUTH_OAUTH_ERROR_CODES = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
])

/**
 * #1996: Official `Wp` + `at` (`isOAuthShapedAuthError`).
 * Classifies MCP tool-call errors from OAuth sign-in servers (such as
 * `TOKEN_EXPIRED`, `invalid_token`, or other non-client-config OAuth errors on
 * HTTP 401/403) so Claude asks the user to sign in again instead of ending in
 * the raw auth-server error.
 */
export function classifyMcpToolCallAuthError(
  error: Error,
  options?: { hasHeadersHelper?: boolean; pendingStepUpScope?: string },
): 'credential_rejected' | 'step_up' | undefined {
  const numericCode =
    'code' in error && typeof (error as { code?: unknown }).code === 'number'
      ? (error as { code: number }).code
      : 'status' in error &&
          typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : undefined
  const stringOAuthCode =
    'errorCode' in error &&
    typeof (error as { errorCode?: unknown }).errorCode === 'string'
      ? (error as { errorCode: string }).errorCode
      : 'code' in error &&
          typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined
  const isOAuthShapedAuthError =
    stringOAuthCode !== undefined &&
    !NON_REAUTH_OAUTH_ERROR_CODES.has(stringOAuthCode) &&
    (/^HTTP 40[13]\b/.test(error.message) ||
      /^(?:TOKEN_EXPIRED|EXPIRED_TOKEN|INVALID_TOKEN|UNAUTHORIZED|ACCESS_TOKEN_EXPIRED)$/i.test(
        stringOAuthCode,
      ))
  const isUnauthorized =
    error instanceof UnauthorizedError ||
    /\bTOKEN_EXPIRED\b/.test(error.message)
  const hasStepUp = options?.pendingStepUpScope !== undefined
  if (
    !(
      numericCode === 401 ||
      isUnauthorized ||
      isOAuthShapedAuthError ||
      (numericCode === 403 && options?.hasHeadersHelper) ||
      (hasStepUp && numericCode === 403)
    )
  ) {
    return undefined
  }
  return hasStepUp &&
    numericCode !== 401 &&
    !(isOAuthShapedAuthError && /^HTTP 401\b/.test(error.message))
    ? 'step_up'
    : 'credential_rejected'
}

/**
 * #2151: Official `droppedToolsSeqByConnection` (`Lc(e)`). Ensures an older
 * overlapping `tools/list` call never overwrites newer `client.droppedTools`.
 */
const droppedToolsSeqByConnection = new WeakMap<
  MCPServerConnection,
  { started: number; applied: number }
>()

function nextDroppedToolsSeq(client: MCPServerConnection): {
  seq: number
  state: { started: number; applied: number }
} {
  const state = droppedToolsSeqByConnection.get(client) ?? {
    started: 0,
    applied: 0,
  }
  droppedToolsSeqByConnection.set(client, state)
  state.started += 1
  return { seq: state.started, state }
}

/**
 * Official 2.1.328 (`$mt` / `RAn` / `mhs` / `AZe` @chunk@289358491.js,
 * @chunk@283835568.js): canonical anti-spoofing keys for MCP tools so a
 * renamed or malicious server cannot inherit another server's allow/deny
 * permission rules.
 */
export type McpStandardKey = {
  key: string
  pinned: boolean
}

export type McpToolInfoWithKeys = NonNullable<Tool['mcpInfo']> & {
  accountMemoryServer?: boolean
  standardKey?: McpStandardKey
  denyKey?: string
  toolNameShared?: boolean
  legacyGrantRefused?: boolean
}

const STANDARD_KEY_MAX_LEN = 54
const STANDARD_KEY_MAX_HOST_LEN = 253
const STANDARD_KEY_TRUNC_PREFIX_LEN = 21
const STANDARD_KEY_HASH_LEN = 32
const STANDARD_KEY_DENY_MAX_LEN = 128
const STANDARD_KEY_VALID_RE = /^[A-Za-z0-9_-]+$/
const STANDARD_KEY_HOST_RE = /^([A-Za-z0-9._-]+)(?::[0-9]*)?$/
const STANDARD_KEY_IPV6_RE = /^\[([0-9A-Fa-f:.]+)\](?::[0-9]*)?$/
const STANDARD_KEY_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const STANDARD_KEY_NUMERIC_TLD_RE = /^(?:[0-9]+|0x[0-9a-f]*)$/
const STANDARD_KEY_HEX_ID_RE = /^(?:0x)?[0-9a-f_]+$/

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isValidStandardKeySegment(candidate: string): boolean {
  return (
    STANDARD_KEY_VALID_RE.test(candidate) &&
    !candidate.includes('__') &&
    !candidate.startsWith('_') &&
    !candidate.endsWith('_')
  )
}

function trimAsciiControlAndSpace(raw: string): string {
  let start = 0
  let end = raw.length
  while (start < end && raw.charCodeAt(start) <= 32) start++
  while (end > start && raw.charCodeAt(end - 1) <= 32) end--
  return raw.slice(start, end)
}

/**
 * Official 2.1.328 (`mhs` @chunk@283835568.js@7109): derive a stable,
 * URL-bound key for remote MCP servers (`https://api.example.com/mcp` →
 * `api_example_com`, non-HTTPS/IP/long hosts → `h-<sha256-32>`).
 */
export function deriveMcpUrlStandardKey(url: string): string | undefined {
  const cleaned = trimAsciiControlAndSpace(url.replace(/[\t\r\n]/g, ''))
  const sep = cleaned.indexOf('://')
  if (sep < 0) return undefined
  const scheme = cleaned.slice(0, sep).toLowerCase()
  if (scheme !== 'http' && scheme !== 'https') return undefined
  const authority = cleaned.slice(sep + 3).split(/[/?#]/, 1)[0] ?? ''
  if (authority.includes('\\')) return undefined
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1)
  const hostMatch =
    STANDARD_KEY_HOST_RE.exec(hostPort) ?? STANDARD_KEY_IPV6_RE.exec(hostPort)
  if (!hostMatch?.[1]) return undefined
  if (hostPort.startsWith('[') && !isIPv6(hostMatch[1])) return undefined
  const host = hostMatch[1].toLowerCase().replace(/\.$/, '')
  if (host === '') return undefined

  const originForHash = `${scheme}://${host.includes(':') ? `[${host}]` : host}`
  const hash32 = sha256Hex(originForHash).slice(0, STANDARD_KEY_HASH_LEN)
  const fallback = `h-${hash32}`

  let readable: string | undefined
  const labels = host.split('.')
  const tld = labels.at(-1) ?? ''
  if (
    scheme === 'https' &&
    host.length <= STANDARD_KEY_MAX_HOST_LEN &&
    labels.length >= 2 &&
    !tld.includes('-') &&
    !labels.some(l => l.startsWith('sk-ant-')) &&
    !STANDARD_KEY_NUMERIC_TLD_RE.test(tld) &&
    labels.every(l => STANDARD_KEY_LABEL_RE.test(l))
  ) {
    const joined = labels.join('_')
    const strippedHex = joined.replaceAll('-', '')
    const looksHexId =
      (strippedHex.length === 32 || strippedHex.length === 23) &&
      STANDARD_KEY_HEX_ID_RE.test(strippedHex)
    if (!looksHexId) {
      readable = joined
    }
  }

  const candidate =
    readable === undefined
      ? fallback
      : readable.length > STANDARD_KEY_MAX_LEN
        ? `${readable.slice(0, STANDARD_KEY_TRUNC_PREFIX_LEN).replace(/^[_-]+|[_-]+$/g, '')}-${hash32}`
        : readable
  const finalKey = `${candidate}-`
    .replace(/[_-]+/g, '-')
    .startsWith('org-connector-')
    ? fallback
    : candidate
  return isValidStandardKeySegment(finalKey) ? finalKey : undefined
}

function isReservedStandardKeyServerName(serverName: string): boolean {
  const norm = normalizeNameForMCP(serverName).toLowerCase()
  return (
    norm === 'ide' ||
    isClaudeInChromeMCPServer(serverName) ||
    (feature('CHICAGO_MCP') ? isComputerUseMCPServer!(serverName) : false)
  )
}

/**
 * Official 2.1.328 (`AZe` @chunk@289358491.js@1212): detect a non-claude.ai
 * server attempting to spoof a `claude_ai_*` connector server name.
 */
export function isSpoofedClaudeAiServerName(
  serverName: string,
  config: Pick<ScopedMcpServerConfig, 'scope'>,
): boolean {
  return (
    normalizeNameForMCP(serverName).startsWith('claude_ai_') &&
    config.scope !== 'claudeai'
  )
}

/**
 * Official 2.1.328 (`$mt` @chunk@289358491.js@4910): compute the canonical
 * `standardKey` identifying an MCP server independently of display aliases.
 */
export function computeMcpStandardKey(
  serverName: string,
  config: ScopedMcpServerConfig,
  isCliOwned: boolean = isCliOwnedConfig(config),
): McpStandardKey | undefined {
  if (isCliOwned || isReservedStandardKeyServerName(serverName)) {
    return { key: normalizeNameForMCP(serverName), pinned: true }
  }
  switch (config.type) {
    case 'sse-ide':
    case 'ws-ide':
      return { key: 'ide', pinned: true }
    case 'http':
    case 'sse': {
      const key = deriveMcpUrlStandardKey(config.url)
      return key !== undefined ? { key, pinned: false } : undefined
    }
    case 'claudeai-proxy': {
      const key = deriveMcpUrlStandardKey(config.url)
      return key !== undefined ? { key, pinned: false } : undefined
    }
    case 'stdio':
    case undefined:
      return { key: normalizeNameForMCP(serverName), pinned: false }
    default:
      return undefined
  }
}

/**
 * Official 2.1.328 (`RAn` @chunk@289358491.js@2809): compute the alternate
 * `denyKey` so deny/ask rules continue to match across connector IDs and
 * canonicalized URL origins (e.g. punycode/IDN or proxy origin forms).
 */
export function computeMcpDenyKey(
  config: ScopedMcpServerConfig & { connectorId?: string },
): string | undefined {
  if (config.type === 'sdk' && typeof config.connectorId === 'string') {
    const normalized = normalizeNameForMCP(config.connectorId)
    if (
      normalized.length > 0 &&
      normalized.length <= STANDARD_KEY_DENY_MAX_LEN &&
      !normalized.includes('__')
    ) {
      return normalized
    }
    return undefined
  }
  if (
    config.type !== 'http' &&
    config.type !== 'sse' &&
    config.type !== 'claudeai-proxy'
  ) {
    return undefined
  }
  if (typeof config.url !== 'string' || !URL.canParse(config.url)) {
    return undefined
  }
  const originKey = deriveMcpUrlStandardKey(new URL(config.url).origin)
  const rawUrlKey = deriveMcpUrlStandardKey(config.url)
  return originKey !== undefined && originKey !== rawUrlKey
    ? originKey
    : undefined
}

/**
 * Official 2.1.328 (`wl` / `composeMcpTool` @chunk@335138039.js@210828):
 * attach `standardKey`, `denyKey`, `toolNameShared`, and `legacyGrantRefused`
 * anti-spoofing metadata onto a composed MCP `Tool`, and refuse persistent
 * allow-rules when a server spoofs a `claude_ai_*` name or has colliding
 * normalized tool names.
 */
export function composeMcpTool(params: {
  serverName: string
  config: ScopedMcpServerConfig
  toolName: string
  fullyQualifiedName: string
  skipPrefix?: boolean
  standardKey?: McpStandardKey
  denyKey?: string
  toolNameShared?: boolean
  legacyGrantRefused?: boolean
  requiresUserInteraction: boolean
  isFirstPartyDesignServer: boolean
  baseTool: Tool
  /** Optional server-specific permission check override (e.g. Claude in Chrome URL policy). */
  customCheckPermissions?: Tool['checkPermissions']
}): Tool {
  const {
    serverName,
    config,
    toolName,
    fullyQualifiedName,
    standardKey,
    denyKey,
    toolNameShared = false,
    legacyGrantRefused = false,
    requiresUserInteraction,
    isFirstPartyDesignServer,
    baseTool,
    customCheckPermissions,
  } = params

  const spoofedClaudeAi = isSpoofedClaudeAiServerName(serverName, config)
  const allowRulesBlocked =
    spoofedClaudeAi || legacyGrantRefused || toolNameShared
  if (allowRulesBlocked) {
    logMCPDebug(
      serverName,
      spoofedClaudeAi
        ? "Allow rules do not apply: this server's name starts like a claude.ai connector's. To use allow rules, the server needs another name, and the rules must use that name."
        : legacyGrantRefused
          ? 'Allow rules do not apply: another MCP server already uses this name. Give this server a different name and write the rules for that name.'
          : `Allow rules do not apply to "${toolName}": another tool of this server gets the same name in Claude Code. To use allow rules, the server must rename one of them.`,
    )
  }

  const prevMcpInfo = baseTool.mcpInfo as McpToolInfoWithKeys | undefined
  const mcpInfo: McpToolInfoWithKeys = {
    ...(prevMcpInfo ?? { serverName, toolName }),
    ...(standardKey !== undefined ? { standardKey } : {}),
    ...(denyKey !== undefined ? { denyKey } : {}),
    ...(toolNameShared ? { toolNameShared: true } : {}),
    ...(spoofedClaudeAi || legacyGrantRefused
      ? { legacyGrantRefused: true }
      : {}),
  }

  const omitsPersistentAllow =
    allowRulesBlocked ||
    connectorDesignOmitsPersistentAllow(isFirstPartyDesignServer, toolName)

  const {
    create: _baseCreate,
    permissionCheckFailureDecision: _basePermFailure,
    deriveObservableInput: _baseDeriveObs,
    ...cleanBaseTool
  } = baseTool

  const composed: Tool = {
    ...cleanBaseTool,
    mcpInfo,
    suppressesAlwaysAllowRule: () =>
      requiresUserInteraction || omitsPersistentAllow,
    async checkPermissions(input: unknown, context) {
      const denied = connectorDesignTokenlessWriteDeny(
        isFirstPartyDesignServer,
        toolName,
        input,
      )
      if (denied) return denied
      if (customCheckPermissions !== undefined) {
        return customCheckPermissions(input as Record<string, unknown>, context)
      }
      return mcpToolCheckPermissionsResult(
        requiresUserInteraction,
        fullyQualifiedName,
        serverName,
        omitsPersistentAllow,
      )
    },
    create(deps) {
      return {
        call(args, callCtx) {
          const ctx = resolveToolUseContext(deps, callCtx)
          return composed.call(
            args,
            ctx,
            callCtx.canUseTool ?? createDefaultCanUseTool(),
            callCtx.parentMessage as Parameters<Tool['call']>[3],
            callCtx.onProgress,
            {
              userModified: callCtx.userModified,
              globLimits: callCtx.globLimits,
              fileReadingLimits: callCtx.fileReadingLimits,
              gitDiffRead: callCtx.gitDiffRead,
              smallResultAsked: callCtx.smallResultAsked,
              callerLogsSharedEvents: callCtx.callerLogsSharedEvents,
              timing: callCtx.timing,
              remoteCall: callCtx.remoteCall,
            },
          )
        },
        ...(cleanBaseTool.validateInput !== undefined
          ? {
              validateInput(input, callCtx) {
                return cleanBaseTool.validateInput!(
                  input,
                  resolveToolUseContext(deps, callCtx),
                )
              },
            }
          : {}),
        checkPermissions(input, callCtx) {
          return composed.checkPermissions(
            input,
            resolveToolUseContext(deps, callCtx),
          )
        },
      }
    },
  }
  return composed
}

/**
 * Compose Claude Code `Tool` wrappers from raw MCP wire tool entries for either
 * a live `ConnectedMCPServer` or a discovery-cache-hydrated `CachedMCPServer`.
 * Matches official 2.1.331 `Pu`.
 */
function composeMcpToolsFromRawListing(
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
                require('../designProjectGrant.js') as typeof import('../designProjectGrant.js')
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
                require('../../utils/mcpAutoBackground.js') as typeof import('../../utils/mcpAutoBackground.js')
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
                            require('./transportErrorState.js') as typeof import('./transportErrorState.js')
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

async function fetchToolsForClientImpl(
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

export const fetchToolsForClient: ReturnType<typeof createFetchToolsMemo> =
  Object.assign(
    (client: MCPServerConnection): Promise<Tool[]> =>
      getHostMcpClientState().fetchToolsMemo(client),
    {
      cache: createHostCacheProxy(
        () => getHostMcpClientState().fetchToolsMemo.cache,
      ),
    },
  )

/**
 * densable fcn / isListAuthError — 401/403 on list that is *not* a
 * CLAUDEAI_BEARER_REJECTED throw (those stay connected + /login).
 */
async function fetchResourcesForClientImpl(
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

export const fetchResourcesForClient: ReturnType<
  typeof createFetchResourcesMemo
> = Object.assign(
  (client: MCPServerConnection): Promise<ServerResource[]> =>
    getHostMcpClientState().fetchResourcesMemo(client),
  {
    cache: createHostCacheProxy(
      () => getHostMcpClientState().fetchResourcesMemo.cache,
    ),
  },
)

/**
 * Official 2.1.328 (`hR` / `completeResourceTemplate`
 * @chunk@335138039.js@243488): invoke MCP `completion/complete` for a
 * resource template argument when the connected server advertises the
 * `completions` capability.
 */
export async function completeResourceTemplate(
  client: MCPServerConnection,
  uri: string,
  argumentName: string,
  argumentValue: string,
  contextArguments: Record<string, string> = {},
): Promise<string[]> {
  if (client.type !== 'connected' || !client.capabilities?.completions) {
    return []
  }
  try {
    const result = await client.client.complete({
      ref: { type: 'ref/resource', uri },
      argument: { name: argumentName, value: argumentValue },
      ...(Object.keys(contextArguments).length > 0
        ? { context: { arguments: contextArguments } }
        : {}),
    })
    logEvent('tengu_mcp_complete_resource_template', {
      outcome:
        'success' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return result.completion.values
  } catch (error) {
    logEvent('tengu_mcp_complete_resource_template', {
      outcome:
        'failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    logMCPError(
      client.name,
      `Failed to complete resource template: ${errorMessage(error)}`,
    )
    return []
  }
}

/**
 * Compose Claude Code prompt `Command` entries from raw MCP prompts for either
 * a live `ConnectedMCPServer` or a discovery-cache-hydrated `CachedMCPServer`.
 * Matches official 2.1.331 `Au`.
 */
function composeMcpCommandsFromRawListing(
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

async function fetchCommandsForClientImpl(
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

export const fetchCommandsForClient: ReturnType<
  typeof createFetchCommandsMemo
> = Object.assign(
  (client: MCPServerConnection): Promise<Command[]> =>
    getHostMcpClientState().fetchCommandsMemo(client),
  {
    cache: createHostCacheProxy(
      () => getHostMcpClientState().fetchCommandsMemo.cache,
    ),
  },
)

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
  canUseTool?: import('../../hooks/useCanUseTool.js').CanUseToolFn
  toolUseContext?: import('../../Tool.js').ToolUseContext
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
          require('./mcpStepUpReauth.js') as typeof import('./mcpStepUpReauth.js')
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
        require('./transportErrorState.js') as typeof import('./transportErrorState.js')
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
              require('../../dialog/specs/jsuKinds.js') as typeof import('../../dialog/specs/jsuKinds.js')
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

export const MCP_QUESTION_UNANSWERED_MESSAGE =
  "The server asked the user a question, and no answer came before the time limit. Do not call this tool again in this turn. Tell the user that the server's question got no answer, and wait for their reply."

export function formatMcpToolTimeoutMessage(
  serverName: string,
  toolName: string,
  timeoutMs: number,
  hasOpenQuestions: boolean,
): string {
  const base = `MCP server "${serverName}" tool "${toolName}" timed out after ${Math.floor(timeoutMs / 1000)}s`
  return hasOpenQuestions ? `${base}. ${MCP_QUESTION_UNANSWERED_MESSAGE}` : base
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
          require('./mcpStepUpReauth.js') as typeof import('./mcpStepUpReauth.js')
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

/**
 * Official `Zqt` @278801674 (#1121):
 * Prevent `'cached'` MCP client updates from overwriting a live `'connected'`,
 * un-held `'disabled'` (`heldBy === undefined`), or `'needs-auth'` client.
 */
export function shouldApplyMcpClientUpdate(
  existing: MCPServerConnection | undefined,
  incoming: MCPServerConnection | { type: string; name: string },
): boolean {
  if (incoming.type !== 'cached' || !existing) return true
  const heldBy =
    existing.type === 'disabled' && 'heldBy' in existing
      ? existing.heldBy
      : undefined
  return !(
    existing.type === 'connected' ||
    (existing.type === 'disabled' && heldBy === undefined) ||
    existing.type === 'needs-auth'
  )
}
