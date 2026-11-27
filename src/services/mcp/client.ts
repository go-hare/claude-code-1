/**
 * MCP client facade, late-bound memo registration & backwards-compatible re-export barrel.
 *
 * Implementation lives in cohesive, strictly acyclic submodules under
 * `src/services/mcp/client/*.ts`. External callers may continue importing
 * from `src/services/mcp/client.js` with 100% API compatibility.
 */

import { registerEnsureConnectedClient } from '../../bootstrap/state.js'
import { connectToServerImpl } from './client/connect.js'
import {
  ensureConnectedClient,
  registerMcpClientImpls,
} from './client/hostState.js'
import {
  fetchCommandsForClientImpl,
  fetchResourcesForClientImpl,
  fetchToolsForClientImpl,
} from './client/listing.js'

registerMcpClientImpls({
  connectToServerImpl,
  fetchToolsForClientImpl,
  fetchResourcesForClientImpl,
  fetchCommandsForClientImpl,
})

// Official w7e — register dial path on host.mcpProcessWiring for vx() callers.
registerEnsureConnectedClient(ensureConnectedClient)

export {
  LegacyDialectToleratingValidator,
  stripLegacyJsonSchemaDialect,
} from './mcpToolSchema.js'

export {
  getMcpIdentityEpoch,
  mcpConfigDependsOnAccountIdentity,
  mcpIdentityChangedSinceLastCheck,
  seedMcpIdentityCheck,
} from './mcpIdentity.js'

export {
  inertReconnectShape,
  inferCompactSchema,
  MCP_TOOL_CALL_INTERRUPTED,
  type MCPResultType,
  mcpToolInputToAutoClassifierInput,
  processMCPResult,
  throwIfMcpToolCallInterrupted,
  type TransformedMCPResult,
  transformMCPResult,
  transformResultContent,
} from './clientHelpers.js'

export {
  areMcpConfigsEqual,
  ClaudeAiProxyBearerRejectedError,
  clearMcpAuthCache,
  clearRejectedClaudeAiBearerToken,
  createClaudeAiProxyFetch,
  getMcpServerConnectionBatchSize,
  getServerCacheKey,
  hasClaudeAiBearerRecoveredAfterLogin,
  isClaudeAiBearerRejectedError,
  isMcpSessionExpiredError,
  McpAuthError,
  McpCredentialStoreUnavailableError,
  McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  wrapFetchWithTimeout,
} from './connectionHelpers.js'

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
} from './discoveryCache.js'

export {
  unsetEmptyAwsBearerTokenBedrock,
  invokeToolRaw,
  buildMcpRootsList,
  formatMcpServerRemovedError,
  formatMcpElicitationDeclinedError,
  MCP_CALL_OUTCOME_UNKNOWN_NOTE,
  isClaudeAiProxyCutOffAfterSend,
  classifyMcpToolCallAuthError,
  deriveMcpUrlStandardKey,
  isSpoofedClaudeAiServerName,
  computeMcpStandardKey,
  computeMcpDenyKey,
  composeMcpTool,
  completeResourceTemplate,
  MCP_QUESTION_UNANSWERED_MESSAGE,
  formatMcpToolTimeoutMessage,
  shouldApplyMcpClientUpdate,
} from './client/errorsAndKeys.js'
export type {
  EnsureConnectedClientOpts,
  McpStandardKey,
  McpToolInfoWithKeys,
} from './client/errorsAndKeys.js'

export {
  connectToServer,
  isSupersededMcpDial,
  markSupersededMcpDial,
  clearServerCache,
  peekSettledConnection,
  detachAndCloseConnection,
  dropDiscoveryEntry,
  evictStaleFailedConnectMemoForServe,
  disposeServerConnectionDetached,
  evictAllMcpMemosOnIdentityChange,
  discardMemoizedConnectResult,
  cleanupConnectedMcpClients,
  notifyMcpRootsListChanged,
  _registerLiveMcpClientForTests,
  registerConnectedClientWiring,
  getConnectedClientWiring,
  registerMcpToolsSwapper,
  swapMcpServerTools,
  onMcpServerConnected,
  notifyMcpServerConnected,
  markMcpServerRemovedFromSession,
  unmarkMcpServerRemovedFromSession,
  isMcpServerRemovedFromSession,
  clearRemovedMcpServersTracking,
  ensureConnectedClient,
  fetchToolsForClient,
  fetchResourcesForClient,
  fetchCommandsForClient,
} from './client/hostState.js'

export {
  callIdeRpc,
  callMCPToolWithUrlElicitationRetry,
} from './client/callTool.js'

export {
  mcpClientModule,
  reconnectMcpServerImpl,
  getMcpToolsCommandsAndResources,
  prefetchAllMcpResources,
  setupSdkMcpClients,
} from './client/lifecycle.js'
