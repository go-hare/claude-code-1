/**
 * densable 2.1.243 #11 — official `mS` / `ZA` / `JA` / `Hl` / `rS` / `du` /
 * `XA` / `cS`. Print/SDK (`-p`) never mounts useManageMCPConnections; remote
 * MCP onclose is wired here instead.
 */

import { logEvent } from '../analytics/index.js'
import type { Command } from '../../commands.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Tool, Tools } from '../../Tool.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { isShuttingDown } from '../../utils/gracefulShutdown.js'
import { logMCPDebug } from '../../utils/log.js'
import { createMcpAuthTools } from '@claude-code/builtin-tools/tools/McpAuthTool/McpAuthTool.js'
import { isMcpServerAllowedByPolicy, isMcpServerDisabled } from './config.js'
import {
  getServerCacheKey,
  mcpClientModule,
  registerConnectedClientWiring,
  registerMcpToolsSwapper,
} from './client.js'
import { getMcpPrefix } from './mcpStringUtils.js'
import {
  getMcpIdentityEpoch,
  mcpConfigDependsOnAccountIdentity,
} from './mcpIdentity.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
  ServerResourceTemplate,
} from './types.js'
import {
  commandBelongsToServer,
  omitMcpServerEntries,
  toolBelongsToServer,
} from './utils.js'

/** Official `Yge` — same 5 as interactive MAX_RECONNECT_ATTEMPTS. */
export const HEADLESS_MCP_MAX_RECONNECT_ATTEMPTS = 5
/** Official `YWr` — background slow reconnect attempts after fast phase. */
export const HEADLESS_MCP_SLOW_RECONNECT_ATTEMPTS = 8
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000
const SLOW_BACKOFF_BASE_MS = 30000
const SLOW_BACKOFF_CAP_MS = 300000
const YOUNG_CLOSE_THRESHOLD_MS = 10000

const POLICY_BLOCKED_ERROR = 'MCP server blocked by policy'

export type HeadlessDynamicMcpState = {
  clients: MCPServerConnection[]
  tools: Tools
  configs?: Record<string, ScopedMcpServerConfig>
}

export type McpSettlement = {
  client: MCPServerConnection
  tools: Tool[]
  commands?: Command[]
  resources?: ServerResource[]
  resourceTemplates?: ServerResourceTemplate[]
  attemptEpoch?: number
}

export type HeadlessMcpClientModule = Pick<
  ReturnType<typeof mcpClientModule>,
  | 'reconnectMcpServerImpl'
  | 'peekSettledConnection'
  | 'detachAndCloseConnection'
  | 'dropDiscoveryEntry'
  | 'seedMcpIdentityCheck'
  | 'getMcpIdentityEpoch'
  | 'mcpIdentityChangedSinceLastCheck'
  | 'cleanupConnectedMcpClients'
>

export type HeadlessMcpReconnectDeps = {
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  getDynamicMcpState: () => HeadlessDynamicMcpState
  setDynamicMcpState: (next: HeadlessDynamicMcpState) => void
  isControlReconnectInFlight: (name: string) => boolean
  isRunEnding: () => boolean
  onReconnected: (client: ConnectedMCPServer) => void
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  now?: () => number
  onHeldOff?: (connection: ConnectedMCPServer, delayMs: number) => void
  storageV5?: unknown
  credentials?: unknown
  /** Official `Fl()` — tests inject; production uses mcpClientModule(). */
  mcpClient?: HeadlessMcpClientModule
}

/** Official `JA`. */
export function isHeadlessReconnectingTransport(
  config: Pick<ScopedMcpServerConfig, 'type'>,
): boolean {
  return (
    config.type !== undefined &&
    config.type !== 'stdio' &&
    config.type !== 'sdk'
  )
}

/** Official `mzt`. */
export function headlessReconnectBackoffMs(afterAttempt: number): number {
  return Math.min(INITIAL_BACKOFF_MS * 2 ** (afterAttempt - 1), MAX_BACKOFF_MS)
}

/** Official `aN` for slow background reconnect phase (30s..300s, floor 15s). */
export function slowReconnectBackoffMs(
  slowAttemptIndex: number,
  random: () => number = Math.random,
): number {
  const raw = Math.min(
    SLOW_BACKOFF_BASE_MS * 2 ** slowAttemptIndex,
    SLOW_BACKOFF_CAP_MS,
  )
  const jittered = Math.floor(raw * (0.5 + 0.5 * random()))
  return Math.max(SLOW_BACKOFF_BASE_MS / 2, jittered)
}

function isRetryableReconnectFailure(client: MCPServerConnection): boolean {
  if (client.type === 'needs-auth' || client.type === 'disabled') return false
  if (client.type === 'failed' && client.errorCode === 'UNCONFIGURED') {
    return false
  }
  return true
}

/** Official `XA` — unref so `-p` can exit while waiting. */
export function unrefSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/** Official `kUu` / `cS` — chain so connectToServer cache-clear still runs. */
export function chainMcpClientOnclose(
  connection: ConnectedMCPServer,
  next: () => void,
): void {
  const client = connection.client
  const prev = client.onclose
  client.onclose = () => {
    prev?.()
    next()
  }
}

/** Official `gr` / `Wr` — slot signature is the connect memo key. */
export function mcpSlotSignature(
  name: string,
  config: ScopedMcpServerConfig,
): string {
  return getServerCacheKey(name, config)
}

/** Official `yi` — needs-auth give-up still exposes the authenticate tool. */
export function needsAuthReconnectTools(
  name: string,
  config: ScopedMcpServerConfig,
): Tool[] {
  return createMcpAuthTools(name, config)
}

/** Official `du`. */
export function applyHeadlessMcpPolicyOverride(
  name: string,
  client: MCPServerConnection,
): MCPServerConnection | undefined {
  if (isMcpServerDisabled(name)) {
    return { name, type: 'disabled', config: client.config }
  }
  if (
    client.type !== 'failed' &&
    !isMcpServerAllowedByPolicy(name, client.config)
  ) {
    return {
      name,
      type: 'failed',
      config: client.config,
      error: POLICY_BLOCKED_ERROR,
      errorCode: 'POLICY_BLOCKED',
    }
  }
  return undefined
}

/**
 * Official `kGr` / `rS` — merge a settlement into AppState.mcp.
 * `appendIfAbsent` is false for sdk (do not invent a missing sdk slot).
 */
export function mergeMcpSettlement(
  state: AppState,
  name: string,
  settlement: McpSettlement,
  options?: { appendIfAbsent?: boolean },
): AppState {
  const present = state.mcp.clients.some(c => c.name === name)
  if (!present && options?.appendIfAbsent === false) return state
  const prefix = getMcpPrefix(name)
  return {
    ...state,
    mcp: {
      ...state.mcp,
      clients: present
        ? state.mcp.clients.map(c => (c.name === name ? settlement.client : c))
        : [...state.mcp.clients, settlement.client],
      tools: [
        ...state.mcp.tools.filter(t => !toolBelongsToServer(t, name, prefix)),
        ...settlement.tools,
      ],
      commands: [
        ...state.mcp.commands.filter(c => !commandBelongsToServer(c, name)),
        ...(settlement.commands ?? []),
      ],
      resources: settlement.resources
        ? { ...state.mcp.resources, [name]: settlement.resources }
        : state.mcp.resources,
      resourceTemplates: settlement.resourceTemplates
        ? {
            ...state.mcp.resourceTemplates,
            [name]: settlement.resourceTemplates,
          }
        : state.mcp.resourceTemplates,
    },
  }
}

function findClient(
  deps: HeadlessMcpReconnectDeps,
  name: string,
): MCPServerConnection | undefined {
  return (
    deps.getAppState().mcp.clients.find(c => c.name === name) ??
    deps.getDynamicMcpState().clients.find(c => c.name === name)
  )
}

function mcpClient(deps: HeadlessMcpReconnectDeps): HeadlessMcpClientModule {
  return deps.mcpClient ?? mcpClientModule()
}

/** Official `Hl`. */
export function applyHeadlessMcpSettlement(
  deps: HeadlessMcpReconnectDeps,
  name: string,
  settlement: McpSettlement,
): void {
  const module = mcpClient(deps)
  const detachIfConnected = (): void => {
    if (settlement.client.type === 'connected') {
      void module.detachAndCloseConnection(settlement.client).catch(() => {})
    }
  }
  const appSlot = deps.getAppState().mcp.clients.find(c => c.name === name)
  const dynamicSlot = deps
    .getDynamicMcpState()
    .clients.find(c => c.name === name)
  if (!appSlot && !dynamicSlot) {
    detachIfConnected()
    return
  }
  const incoming = mcpSlotSignature(name, settlement.client.config)
  const slotMoved = (slot: MCPServerConnection | undefined): boolean =>
    slot !== undefined && mcpSlotSignature(name, slot.config) !== incoming
  if (slotMoved(appSlot) || slotMoved(dynamicSlot)) {
    logForDebugging(
      `[MCP] ${name}: dropping a settlement whose slot config changed mid-flight`,
    )
    detachIfConnected()
    return
  }
  if (
    settlement.attemptEpoch !== getMcpIdentityEpoch() &&
    mcpConfigDependsOnAccountIdentity(settlement.client.config)
  ) {
    logForDebugging(
      `[MCP] ${name}: settlement superseded by an account switch — closed, not installed (the identity boundary owns the row)`,
    )
    detachIfConnected()
    return
  }
  let next = settlement
  if (settlement.client.type !== 'disabled') {
    const override = applyHeadlessMcpPolicyOverride(name, settlement.client)
    if (override) {
      detachIfConnected()
      if (override.type === 'failed') {
        void module
          .dropDiscoveryEntry(name, settlement.client.config)
          .catch(() => {})
      }
      next = {
        client: override,
        tools: [],
        commands: [],
        resources: [],
        attemptEpoch: settlement.attemptEpoch,
      }
    }
  }
  deps.setAppState(prev => {
    const merged = mergeMcpSettlement(prev, name, next, {
      appendIfAbsent: next.client.config.type !== 'sdk',
    })
    const keepResources = Boolean(next.resources && next.resources.length > 0)
    const keepTemplates = Boolean(
      next.resourceTemplates && next.resourceTemplates.length > 0,
    )
    if (keepResources && keepTemplates) return merged
    return {
      ...merged,
      mcp: {
        ...merged.mcp,
        resources: keepResources
          ? merged.mcp.resources
          : omitMcpServerEntries(merged.mcp.resources, name),
        resourceTemplates: keepTemplates
          ? merged.mcp.resourceTemplates
          : omitMcpServerEntries(merged.mcp.resourceTemplates, name),
      },
    }
  })
  if (!dynamicSlot) return
  const prefix = getMcpPrefix(name)
  const dynamic = deps.getDynamicMcpState()
  deps.setDynamicMcpState({
    ...dynamic,
    clients: dynamic.clients.map(c => (c.name === name ? next.client : c)),
    tools: [
      ...dynamic.tools.filter(t => !toolBelongsToServer(t, name, prefix)),
      ...next.tools,
    ],
  })
}

/** Official `le` (`reconnectHeadlessRemoteMcpAfterClose`). */
export async function reconnectHeadlessRemoteMcpAfterClose(
  deps: HeadlessMcpReconnectDeps,
  closed: ConnectedMCPServer,
  foundClosed = false,
  youngCloses = 0,
  recordYoungCloses?: (connection: ConnectedMCPServer, count: number) => void,
): Promise<void> {
  const { name, config } = closed
  const maxFast = HEADLESS_MCP_MAX_RECONNECT_ATTEMPTS
  const maxTotal = maxFast + HEADLESS_MCP_SLOW_RECONNECT_ATTEMPTS
  const sleep = deps.sleep ?? unrefSleep
  const startEpoch = getMcpIdentityEpoch()
  const shouldAbort = (): boolean =>
    isShuttingDown() ||
    deps.isRunEnding() ||
    (getMcpIdentityEpoch() !== startEpoch &&
      mcpConfigDependsOnAccountIdentity(config))
  let expected: MCPServerConnection = closed
  const stillExpected = (): boolean => findClient(deps, name) === expected
  const apply = (settlement: McpSettlement): void =>
    applyHeadlessMcpSettlement(deps, name, settlement)
  const module = mcpClient(deps)

  for (let attempt = 1; attempt <= maxTotal; attempt++) {
    const slowAttempt = attempt - maxFast
    if (attempt > 1) {
      await sleep(
        slowAttempt > 0
          ? slowReconnectBackoffMs(slowAttempt - 1, deps.random)
          : headlessReconnectBackoffMs(attempt - 1),
      )
    }
    if (shouldAbort() || !stillExpected()) return

    const attemptEpoch = getMcpIdentityEpoch()
    const prefix = getMcpPrefix(name)
    const mcp = deps.getAppState().mcp
    if (slowAttempt <= 0) {
      const pending: MCPServerConnection = {
        name,
        type: 'pending',
        config,
        reconnectAttempt: attempt,
        maxReconnectAttempts: maxFast,
      }
      apply({
        client: pending,
        tools: mcp.tools.filter(t => toolBelongsToServer(t, name, prefix)),
        commands: mcp.commands.filter(c => commandBelongsToServer(c, name)),
        resources: mcp.resources[name],
        resourceTemplates: mcp.resourceTemplates[name],
        attemptEpoch,
      })
      expected = pending
    }
    if (!stillExpected() || deps.isControlReconnectInFlight(name)) return

    logMCPDebug(
      name,
      attempt === 1
        ? `${config.type} transport ${foundClosed ? 'had already closed when wired' : 'closed'} — reconnecting (attempt 1/${maxFast})`
        : slowAttempt > 0
          ? `Background reconnect attempt ${slowAttempt}/${HEADLESS_MCP_SLOW_RECONNECT_ATTEMPTS}`
          : `Reconnect attempt ${attempt}/${maxFast}`,
    )

    const result = await module
      .reconnectMcpServerImpl(name, config, deps.storageV5, deps.credentials, {
        keepConnectionInUse: true,
      })
      .catch(err => ({
        client: {
          name,
          type: 'failed' as const,
          config,
          error: errorMessage(err),
        },
        tools: [] as Tool[],
        commands: [] as Command[],
      }))
    const connected =
      result.client.type === 'connected' ? result.client : undefined
    const stillSettled =
      connected !== undefined &&
      (await module.peekSettledConnection(name, config)) === connected
    const discardOrphan = (): void => {
      if (!connected) return
      const current = findClient(deps, name)
      const sameLiveClient =
        current?.type === 'connected' && current.client === connected.client
      const sameSlot =
        current !== undefined &&
        current.type !== 'disabled' &&
        mcpSlotSignature(name, current.config) ===
          mcpSlotSignature(name, config)
      if (!sameLiveClient && (!stillSettled || !sameSlot)) {
        void module.detachAndCloseConnection(connected).catch(() => {})
      }
    }

    if (
      shouldAbort() ||
      !stillExpected() ||
      deps.isControlReconnectInFlight(name)
    ) {
      discardOrphan()
      return
    }

    if (connected && stillSettled) {
      recordYoungCloses?.(connected, youngCloses + attempt - 1)
      apply({ ...result, attemptEpoch })
      if (findClient(deps, name) === connected) {
        logMCPDebug(name, `Reconnected (attempt ${attempt})`)
        logEvent('tengu_feature_ok', {
          feature_name:
            slowAttempt > 0 ? 'mcp_slow_reconnect' : 'mcp_auto_reconnect',
          attempts: attempt,
          found_closed: foundClosed,
          young_closes: youngCloses,
        })
        deps.onReconnected(connected)
      }
      return
    }

    discardOrphan()
    const failed: MCPServerConnection = connected
      ? {
          name,
          type: 'failed',
          config,
          error: 'Connection closed again while reconnecting',
        }
      : result.client
    const retryable = isRetryableReconnectFailure(failed)
    if (
      attempt === maxFast ||
      (slowAttempt > 0 && (!retryable || attempt === maxTotal))
    ) {
      logMCPDebug(
        name,
        slowAttempt <= 0 && retryable
          ? `Still failing after ${attempt} attempts`
          : `Reconnect gave up after ${attempt} attempts: ${failed.type}`,
      )
      apply({
        client: failed,
        tools:
          failed.type === 'needs-auth'
            ? needsAuthReconnectTools(name, config)
            : [],
        commands: [],
        attemptEpoch,
      })
      if (findClient(deps, name) !== failed) return
      if (failed.type === 'needs-auth') {
        logEvent('tengu_feature_sad', {
          feature_name:
            slowAttempt > 0 ? 'mcp_slow_reconnect' : 'mcp_auto_reconnect',
          error_code: 'needs_auth',
          attempts: attempt,
          found_closed: foundClosed,
          young_closes: youngCloses,
        })
        return
      }
      if (slowAttempt > 0) {
        logEvent('tengu_feature_bad', {
          feature_name: 'mcp_slow_reconnect',
          error_code: retryable ? 'gave_up' : 'not_retryable',
          attempts: attempt,
          found_closed: foundClosed,
        })
        return
      }
      logEvent('tengu_feature_bad', {
        feature_name: 'mcp_auto_reconnect',
        error_code: 'exhausted',
        attempts: attempt,
        found_closed: foundClosed,
        young_closes: youngCloses,
        goes_slow: retryable,
      })
      if (!retryable) return
      expected = failed
      logMCPDebug(
        name,
        `Reconnect attempts spent; retrying in the background, up to ${HEADLESS_MCP_SLOW_RECONNECT_ATTEMPTS} more times`,
      )
      continue
    }
    logMCPDebug(
      name,
      slowAttempt > 0
        ? `Background reconnect attempt ${slowAttempt} did not connect (${failed.type})`
        : `Reconnect attempt ${attempt} did not connect (${failed.type}); next in ${headlessReconnectBackoffMs(attempt)}ms`,
    )
  }
}

export type HeadlessRemoteMcpReconnectAttach = ((
  clients: readonly MCPServerConnection[],
) => void) & {
  dispose: () => void
  cleanup: () => void
}

/**
 * Official `mS` — attach onclose once per connected remote client (WeakSet),
 * with young-close hold-off backoff up to 30s.
 */
export function attachHeadlessRemoteMcpReconnect(
  deps: HeadlessMcpReconnectDeps,
): HeadlessRemoteMcpReconnectAttach {
  const wired = new WeakSet<object>()
  const latestByClient = new WeakMap<object, ConnectedMCPServer>()
  const youngClosesByClient = new WeakMap<object, number>()
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? unrefSleep
  // Official 2.1.325 #2305: ensure mid-tool-call reconnects immediately wire
  // headless elicitation/channel handlers via `deps.onReconnected`.
  const unregisterConnectedClientWiring = registerConnectedClientWiring(
    connected => {
      deps.onReconnected(connected)
    },
  )
  // Official 2.1.325 #2306: register live tool swapper so SDK host tool calls
  // point to the reconnected client instead of answering "Not connected".
  const unregisterMcpToolsSwapper = registerMcpToolsSwapper(
    (serverName, tools, config, connectedClient) => {
      const existing = findClient(deps, serverName)
      if (!existing) return false
      if (
        mcpSlotSignature(serverName, existing.config) !==
        mcpSlotSignature(serverName, config)
      ) {
        return false
      }
      const nextClient: MCPServerConnection = connectedClient ?? existing
      applyHeadlessMcpSettlement(deps, serverName, {
        client: nextClient,
        tools,
        attemptEpoch: getMcpIdentityEpoch(),
      })
      return true
    },
  )
  const dispose = (): void => {
    unregisterConnectedClientWiring()
    unregisterMcpToolsSwapper()
  }
  const attach = ((clients: readonly MCPServerConnection[]): void => {
    for (const connection of clients) {
      if (connection.type === 'connected') {
        latestByClient.set(connection.client, connection)
      }
      if (connection.type !== 'connected') continue
      if (wired.has(connection.client)) continue
      if (!isHeadlessReconnectingTransport(connection.config)) continue
      wired.add(connection.client)
      const wiredAt = now()
      const reconnect = (foundClosed: boolean): void => {
        if (isShuttingDown() || deps.isRunEnding()) return
        const uptime = Math.max(0, now() - wiredAt)
        const youngCloses =
          uptime < YOUNG_CLOSE_THRESHOLD_MS
            ? (youngClosesByClient.get(connection.client) ?? 0) + 1
            : 0
        const holdOffMs =
          youngCloses > 0 && !deps.isControlReconnectInFlight(connection.name)
            ? headlessReconnectBackoffMs(youngCloses)
            : 0
        void (async () => {
          if (holdOffMs > 0) {
            try {
              deps.onHeldOff?.(connection, holdOffMs)
            } catch (err) {
              logForDebugging(
                `MCP reconnect hold-off observer failed for ${connection.name}: ${errorMessage(err)}`,
                { level: 'warn' },
              )
            }
            logMCPDebug(
              connection.name,
              `${connection.config.type} transport closed again soon after it connected: reconnecting in ${holdOffMs}ms`,
            )
            await sleep(holdOffMs)
          }
          const latest = latestByClient.get(connection.client) ?? connection
          await reconnectHeadlessRemoteMcpAfterClose(
            deps,
            latest,
            foundClosed,
            youngCloses,
            (conn, count) => youngClosesByClient.set(conn.client, count),
          )
        })().catch(err => {
          logForDebugging(
            `MCP reconnect after close failed for ${connection.name}: ${errorMessage(err)}`,
            { level: 'warn' },
          )
        })
      }
      chainMcpClientOnclose(connection, () => reconnect(false))
      const client = connection.client
      if ('transport' in client && client.transport === undefined) {
        setImmediate(reconnect, true)
      }
    }
  }) as HeadlessRemoteMcpReconnectAttach
  attach.dispose = dispose
  attach.cleanup = dispose
  return attach
}
