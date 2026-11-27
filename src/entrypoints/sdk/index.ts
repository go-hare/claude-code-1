/**
 * Public Multi-Tenant Embedded Claude Code SDK Barrel.
 *
 * Exposes:
 * - Multi-tenant `EmbeddedHost` / `EmbeddedSession` lifecycle & ALS isolation
 * - In-process SDK MCP server helper (`createSdkMcpServer`, `tool`)
 * - Core SDK wire/schema types (`HOOK_EVENTS`, `EXIT_REASONS`, `coreTypes`)
 * - Cross-process `Tool.create(deps)` & remote native-tool runner primitives
 * - Built-in HTTP JSON-RPC 2.0 remote native-tool bridge & child worker spawner
 * - Pluggable `StorageV5` in-memory backend & host pinning APIs
 * - Loopback Streamable HTTP MCP tool server (`startMCPServerHttp`)
 * - Multi-tenant worker `turn_handoff` admission, capability & state machine
 */

// Turn handoff state machine & capability helpers
export {
  buildTurnHandoffCapability,
  evaluateTurnHandoffAdmission,
  getTurnHandoffManager,
  type TurnHandoffAdmission,
  type TurnHandoffAdmissionInput,
  type TurnHandoffAdvertisedCapability,
  type TurnHandoffCarriedWrite,
  type TurnHandoffControlRequest,
  type TurnHandoffControlResponse,
  type TurnHandoffHomeFile,
  type TurnHandoffHydrateResult,
  TurnHandoffManager,
  type TurnHandoffSnapshot,
  type TurnHandoffStagedFile,
} from '../../cli/turnHandoffStateMachine.js'

// Built-in HTTP remote native-tool bridge & worker spawner
export {
  attachRemoteNativeToolBridge,
  createHttpRemoteNativeToolBridge,
  type HttpRemoteNativeToolBridgeOptions,
  type RemoteNativeToolBridgeCallOptions,
  type RemoteNativeToolBridgeCheckOptions,
  type RemoteNativeToolBridgeHandle,
  type SpawnedRemoteNativeToolWorker,
  type SpawnRemoteNativeToolWorkerOptions,
  spawnRemoteNativeToolWorker,
} from '../../services/tools/remoteNativeToolBridge.js'

// Pluggable StorageV5 APIs
export {
  type CreateMemoryStorageV5BackendOptions,
  createMemoryStorageV5Backend,
  getPinnedStorageV5,
  type MemoryStorageV5,
  pinInjectedStorageV5,
  type StorageV5,
  type StorageV5Result,
  type StorageV5ScopeKind,
} from '../../utils/storageV5/index.js'

// Cross-process Tool.create(deps) & remote native-tool runner APIs
export {
  createExplicitToolDeps,
  createToolCallContext,
  getRemoteNativeToolRunner,
  LOCAL_ONLY_NATIVE_TOOL_NAMES,
  NativeToolElsewhereError,
  type NativeToolElsewhereErrorCode,
  NeverRunsInThisProcessError,
  REMOTE_CHECK_DOES_NOT_DECIDE,
  type RemoteNativeToolCheck,
  type RemoteNativeToolCheckParams,
  type RemoteNativeToolResult,
  type RemoteNativeToolRunner,
  type RemoteNativeToolSession,
  registerRemoteNativeToolRunner,
  type ToolCallContext,
  type ToolCallExecutionOptions,
  type ToolDeps,
  type ToolInstance,
  unregisterRemoteNativeToolRunner,
} from '../../utils/toolCreateRuntime.js'

// Loopback HTTP MCP tool server
export {
  type McpHttpServerHandle,
  type StartMCPServerHttpOptions,
  startMCPServerHttp,
} from '../mcpHttpServer.js'

// Core SDK types & runtime constants
export * from './coreTypes.js'

// In-process SDK MCP server
export {
  type CreateSdkMcpServerOptions,
  createSdkMcpServer,
  tool,
} from './createSdkMcpServer.js'

// Multi-tenant embedded host runtime
export {
  createEmbeddedHost,
  type EmbeddedExecutableTool,
  type EmbeddedExecuteToolOptions,
  type EmbeddedHost,
  type EmbeddedHostOptions,
  type EmbeddedRemoteNativeToolConfig,
  type EmbeddedSession,
  type EmbeddedSessionOptions,
} from './embeddedHost.js'
