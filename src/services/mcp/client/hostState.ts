import { feature } from 'bun:bundle'
import { Client } from '@modelcontextprotocol/client'
import type {
  CachedMCPServer,
  ConnectedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
} from '../types.js'
import {
  dropDiscoveryCacheEntry,
  runCachedFirstDialArms,
} from '../discoveryCache.js'
import memoize from 'lodash-es/memoize.js'
import type { Command } from '../../../commands.js'
import type { Tool } from '../../../Tool.js'
import { logForDebugging } from '../../../utils/debug.js'
import {
  AbortError,
  errorMessage,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../../utils/errors.js'
import { logMCPDebug } from '../../../utils/log.js'
import { memoizeWithLRU } from '../../../utils/memoize.js'
import {
  HostSlot,
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  runWithSession,
} from '../../../utils/sessionRoot.js'
import { clearKeychainCache } from '../../../utils/secureStorage/macOsKeychainHelpers.js'
import { clearAuthReconnectInFlight } from '../authReconnect.js'
import {
  advanceMcpIdentityEpoch,
  ensureMcpAccountIdentityResolver,
  isMcpIdentityBoundaryEnabled,
  markMcpIdentityChanged,
  getMcpIdentityEpoch,
} from '../mcpIdentity.js'
import {
  clearRejectedClaudeAiBearerToken,
  hasClaudeAiBearerRecoveredAfterLogin,
  getServerCacheKey,
} from '../connectionHelpers.js'
import {
  type BoundSession,
  type ConnectedClientWiringFn,
  type EnsureConnectedClientOpts,
  MCP_FETCH_CACHE_SIZE,
  type McpServerConnectedListener,
  type McpToolsSwapperFn,
  createHostCacheProxy,
  formatMcpServerRemovedError,
} from './errorsAndKeys.js'

export type McpServerStats = {
  totalServers: number
  stdioCount: number
  sseCount: number
  httpCount: number
  sseIdeCount: number
  wsIdeCount: number
}

export type McpClientMemoImpls = {
  connectToServerImpl: (
    name: string,
    serverRef: ScopedMcpServerConfig,
    serverStats?: McpServerStats,
  ) => Promise<MCPServerConnection>
  fetchToolsForClientImpl: (client: MCPServerConnection) => Promise<Tool[]>
  fetchResourcesForClientImpl: (
    client: MCPServerConnection,
  ) => Promise<ServerResource[]>
  fetchCommandsForClientImpl: (
    client: MCPServerConnection,
  ) => Promise<Command[]>
}

let registeredMcpClientImpls: McpClientMemoImpls | undefined

export function registerMcpClientImpls(impls: McpClientMemoImpls): void {
  registeredMcpClientImpls = impls
}

function getRegisteredMcpClientImpls(): McpClientMemoImpls {
  if (!registeredMcpClientImpls) {
    throw new Error('MCP client implementations not registered')
  }
  return registeredMcpClientImpls
}

/* eslint-disable @typescript-eslint/no-require-imports */
export const fetchMcpSkillsForClient = feature('MCP_SKILLS')
  ? (
      require('../../../skills/mcpSkills.js') as typeof import('../../../skills/mcpSkills.js')
    ).fetchMcpSkillsForClient
  : null

function createConnectToServerMemo() {
  const fn = memoize(
    (
      name: string,
      serverRef: ScopedMcpServerConfig,
      serverStats?: McpServerStats,
    ) =>
      getRegisteredMcpClientImpls().connectToServerImpl(
        name,
        serverRef,
        serverStats,
      ),
    getServerCacheKey,
  )
  fn.cache = new Map() as unknown as typeof fn.cache
  return fn
}

function createFetchToolsMemo() {
  return memoizeWithLRU(
    (client: MCPServerConnection) =>
      getRegisteredMcpClientImpls().fetchToolsForClientImpl(client),
    (client: MCPServerConnection) => client.name,
    MCP_FETCH_CACHE_SIZE,
  )
}

function createFetchResourcesMemo() {
  return memoizeWithLRU(
    (client: MCPServerConnection) =>
      getRegisteredMcpClientImpls().fetchResourcesForClientImpl(client),
    (client: MCPServerConnection) => client.name,
    MCP_FETCH_CACHE_SIZE,
  )
}

function createFetchCommandsMemo() {
  return memoizeWithLRU(
    (client: MCPServerConnection) =>
      getRegisteredMcpClientImpls().fetchCommandsForClientImpl(client),
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

export function getHostMcpClientState(): HostMcpClientState {
  return hostMcpClientStateSlot.of(getBootstrapSessionHost())
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
      require('../mcpListenReopen.js') as typeof import('../mcpListenReopen.js')
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
