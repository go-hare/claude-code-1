/**
 * densable 2.1.243 #11 — official `mS` / `ZA` / `JA` / `Hl` / `rS` / `du` /
 * `XA` / `cS`. Print/SDK (`-p`) never mounts useManageMCPConnections; remote
 * MCP onclose is wired here instead.
 */

import type { Command } from '../../commands.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Tool } from '../../Tool.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { isShuttingDown } from '../../utils/gracefulShutdown.js'
import { logMCPDebug } from '../../utils/log.js'
import { createMcpAuthTool } from '@claude-code/builtin-tools/tools/McpAuthTool/McpAuthTool.js'
import { isMcpServerAllowedByPolicy, isMcpServerDisabled } from './config.js'
import { getServerCacheKey, mcpClientModule } from './client.js'
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

/** Official `ko` — same 5 as interactive MAX_RECONNECT_ATTEMPTS. */
export const HEADLESS_MCP_MAX_RECONNECT_ATTEMPTS = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000

const POLICY_BLOCKED_ERROR = 'MCP server blocked by policy'

export type HeadlessDynamicMcpState = {
  clients: MCPServerConnection[]
  tools: Tool[]
  configs?: Record<string, ScopedMcpServerConfig>
}

export type McpSettlement = {
  client: MCPServerConnection
  tools: Tool[]
  commands?: Command[]
  resources?: ServerResource[]
  resourceTemplates?: ServerResourceTemplate[]
}

export type HeadlessMcpClientModule = ReturnType<typeof mcpClientModule>

export type HeadlessMcpReconnectDeps = {
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  getDynamicMcpState: () => HeadlessDynamicMcpState
  setDynamicMcpState: (next: HeadlessDynamicMcpState) => void
  isControlReconnectInFlight: (name: string) => boolean
  isRunEnding: () => boolean
  onReconnected: (client: ConnectedMCPServer) => void
  sleep?: (ms: number) => Promise<void>
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

/** Official `iu`. */
export function headlessReconnectBackoffMs(afterAttempt: number): number {
  return Math.min(INITIAL_BACKOFF_MS * 2 ** (afterAttempt - 1), MAX_BACKOFF_MS)
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
  return [createMcpAuthTool(name, config)]
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
      next = { client: override, tools: [], commands: [], resources: [] }
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

/** Official `ZA`. */
export async function reconnectHeadlessRemoteMcpAfterClose(
  deps: HeadlessMcpReconnectDeps,
  closed: ConnectedMCPServer,
): Promise<void> {
  const { name, config } = closed
  const max = HEADLESS_MCP_MAX_RECONNECT_ATTEMPTS
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

  for (let attempt = 1; attempt <= max; attempt++) {
    if (attempt > 1) {
      await sleep(headlessReconnectBackoffMs(attempt - 1))
    }
    if (shouldAbort() || !stillExpected()) return

    const prefix = getMcpPrefix(name)
    const mcp = deps.getAppState().mcp
    const pending: MCPServerConnection = {
      name,
      type: 'pending',
      config,
      reconnectAttempt: attempt,
      maxReconnectAttempts: max,
    }
    apply({
      client: pending,
      tools: mcp.tools.filter(t => toolBelongsToServer(t, name, prefix)),
      commands: mcp.commands.filter(c => commandBelongsToServer(c, name)),
      resources: mcp.resources[name],
      resourceTemplates: mcp.resourceTemplates[name],
    })
    expected = pending
    if (!stillExpected() || deps.isControlReconnectInFlight(name)) return

    logMCPDebug(
      name,
      attempt === 1
        ? `${config.type} transport closed — reconnecting (attempt 1/${max})`
        : `Reconnect attempt ${attempt}/${max}`,
    )

    const result = await module
      .reconnectMcpServerImpl(name, config, deps.storageV5, deps.credentials)
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
      apply(result)
      if (findClient(deps, name) === connected) {
        logMCPDebug(name, `Reconnected (attempt ${attempt})`)
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
    if (attempt === max) {
      logMCPDebug(
        name,
        `Reconnect gave up after ${attempt} attempts: ${failed.type}`,
      )
      apply({
        client: failed,
        tools:
          failed.type === 'needs-auth'
            ? needsAuthReconnectTools(name, config)
            : [],
        commands: [],
      })
      return
    }
    logMCPDebug(
      name,
      `Reconnect attempt ${attempt} did not connect (${failed.type}); next in ${headlessReconnectBackoffMs(attempt)}ms`,
    )
  }
}

/**
 * Official `mS` — attach onclose once per connected remote client (WeakSet).
 */
export function attachHeadlessRemoteMcpReconnect(
  deps: HeadlessMcpReconnectDeps,
): (clients: readonly MCPServerConnection[]) => void {
  const wired = new WeakSet<object>()
  return clients => {
    for (const connection of clients) {
      if (connection.type !== 'connected') continue
      if (wired.has(connection.client)) continue
      if (!isHeadlessReconnectingTransport(connection.config)) continue
      wired.add(connection.client)
      chainMcpClientOnclose(connection, () => {
        if (isShuttingDown() || deps.isRunEnding()) return
        void reconnectHeadlessRemoteMcpAfterClose(deps, connection).catch(
          err => {
            logForDebugging(
              `MCP reconnect after close failed for ${connection.name}: ${errorMessage(err)}`,
              { level: 'warn' },
            )
          },
        )
      })
    }
  }
}
