import { feature } from 'bun:bundle'
import { isIP } from 'net'
import { hostname as osHostname } from 'os'
import { basename } from 'path'
import { useCallback, useContext, useEffect, useRef } from 'react'
import {
  getIsNonInteractiveSession,
  getOriginalCwd,
  getSessionId,
} from '../../bootstrap/state.js'
import { getCwd } from '../../utils/cwd.js'
import type { Command } from '../../commands.js'
import type { Tool } from '../../Tool.js'
import {
  clearServerCache,
  detachAndCloseConnection,
  fetchCommandsForClient,
  fetchResourcesForClient,
  fetchToolsForClient,
  getMcpToolsCommandsAndResources,
  markMcpServerRemovedFromSession,
  reconnectMcpServerImpl,
  registerMcpToolsSwapper,
  shouldApplyMcpClientUpdate,
  unmarkMcpServerRemovedFromSession,
} from './client.js'
import { subscribeMcpAuthRecovered } from './auth.js'
import {
  getMcpIdentityEpoch,
  mcpConfigDependsOnAccountIdentity,
} from './mcpIdentity.js'
import {
  beginMcpToolRefreshSequence,
  commitMcpToolRefreshSequence,
  formatListChangedRefreshFailed,
  resolvePromptsListChangedRefresh,
  resolveResourcesListChangedRefresh,
} from './mcpListChangedRefresh.js'
import { registerMcpListenPostReopenHandler } from './mcpListenReopen.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
} from './types.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const fetchMcpSkillsForClient = feature('MCP_SKILLS')
  ? (
      require('../../skills/mcpSkills.js') as typeof import('../../skills/mcpSkills.js')
    ).fetchMcpSkillsForClient
  : null
const clearSkillIndexCache = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? (
      require('../skillSearch/localSearch.js') as typeof import('../skillSearch/localSearch.js')
    ).clearSkillIndexCache
  : null

// densable: setNotificationHandler("notifications/.../list_changed", ...)
import omit from 'lodash-es/omit.js'
import reject from 'lodash-es/reject.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  consumeManagedMcpArrivalNotice,
  dedupClaudeAiMcpServers,
  doesEnterpriseMcpConfigExist,
  filterMcpServersByPolicy,
  getClaudeCodeMcpConfigs,
  getDisabledMcpServers,
  getMcpServerPolicyBlockReason,
  isMcpServerDisabled,
  mergeFolderOwnedMcpConfigs,
  saveDisabledMcpServers,
  setMcpServerEnabled,
  subscribeToManagedMcpArrival,
} from 'src/services/mcp/config.js'
import { notifyInternalMetadataChanged } from '../../utils/sessionState.js'
import {
  getActiveMcpSwitchedOffRecord,
  isMcpSwitchedOffRecordKept,
  McpSwitchedOffRecord,
  type RestoredWorkerMcpState,
  setActiveMcpSwitchedOffRecord,
} from './mcpSwitchedOffRecord.js'
import type { AppState } from 'src/state/AppState.js'
import type { PluginError } from 'src/types/plugin.js'
import { logForDebugging } from 'src/utils/debug.js'
import { getAllowedChannels } from '../../bootstrap/state.js'
import { useNotifications } from '../../context/notifications.js'
import {
  useAppState,
  useAppStateStore,
  useMcpConnections,
  useSetAppState,
} from '../../state/AppState.js'
import { getClaudeAIOAuthTokens } from '../../utils/auth.js'
import { errorMessage } from '../../utils/errors.js'
import { getAPIProvider } from '../../utils/model/providers.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import { logMCPDebug, logMCPError } from '../../utils/log.js'
import { enqueue } from '../../utils/messageQueueManager.js'
import {
  formatMcpNeedsReauthNotification,
  mcpNeedsReauthNotificationKey,
  shouldSkipMcpNeedsReauthNotification,
  subscribeMcpNeedsReauth,
} from './mcpReauthSignal.js'
import { isXaaEnabled } from './xaaIdpLogin.js'
import {
  CHANNEL_MESSAGE_METHOD,
  CHANNEL_PERMISSION_METHOD,
  ChannelMessageParamsSchema,
  ChannelPermissionParamsSchema,
  findChannelEntry,
  gateChannelServer,
  isChannelGateHardRevocation,
  wrapChannelMessage,
} from './channelNotification.js'
import {
  type ChannelPermissionCallbacks,
  createChannelPermissionCallbacks,
  hasExperimentalCapability,
  isChannelPermissionRelayEnabled,
} from './channelPermissions.js'
import {
  clearClaudeAIMcpConfigsCache,
  fetchClaudeAIMcpConfigsIfEligible,
} from './claudeai.js'
import {
  DialogStoreContext,
  RequestDialogContext,
} from '../../dialog/DialogStoreContext.js'
import { registerElicitationHandler } from './elicitationHandler.js'
import { getMcpPrefix } from './mcpStringUtils.js'
import { commandBelongsToServer, excludeStalePluginClients } from './utils.js'

// Constants for reconnection with exponential backoff
const MAX_RECONNECT_ATTEMPTS = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000

// Official 2.1.327 `COn` / `Cso` / `MWt` / `i` (#412): slow background retry
// (~1 day across 69 attempts, 15s -> 15m cap + proportional jitter) for remote
// HTTPS hostname MCP servers after prolonged outages (e.g. VPN drop).
export const SLOW_RECONNECT_MAX_ATTEMPTS = 69
export const SLOW_RECONNECT_BASE_MS = 15_000
export const SLOW_RECONNECT_CAP_MS = 900_000

export function computeSlowReconnectDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(
    SLOW_RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1),
    SLOW_RECONNECT_CAP_MS,
  )
  // Proportional jitter (ratio 1): [base, 2 * base]
  return Math.round(base * (1 + random()))
}

export function isRemoteHttpsHostnameUrl(
  url: unknown,
  localHost: string = osHostname(),
): boolean {
  if (typeof url !== 'string') return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.replace(/\.+$/, '').toLowerCase()
  if (!host) return false
  // Must be a hostname, not an IP literal (IPv4 or IPv6)
  if (isIP(host.replace(/^\[|\]$/, '')) !== 0) return false
  // Exclude localhost, single-label/mDNS/local-machine hostnames
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.')
  ) {
    return false
  }
  const localNormalized = localHost.replace(/\.+$/, '').toLowerCase()
  if (localNormalized && host === localNormalized) return false
  return true
}

export function isEligibleForSlowBackgroundReconnect(
  config: ScopedMcpServerConfig,
  opts?: { localHostname?: string },
): boolean {
  if (config.type === 'claudeai-proxy') {
    const proxyUrl =
      'url' in config && typeof config.url === 'string'
        ? config.url
        : 'id' in config && typeof config.id === 'string' && config.id
          ? `https://mcp-proxy.anthropic.com/v1/mcp/${config.id}`
          : undefined
    return isRemoteHttpsHostnameUrl(proxyUrl, opts?.localHostname)
  }
  if (config.type !== 'http' && config.type !== 'sse') {
    return false
  }
  if (config.oauth?.xaa || config.oauth?.authServerMetadataUrl) {
    return false
  }
  return isRemoteHttpsHostnameUrl(config.url, opts?.localHostname)
}

export type SlowBackgroundReconnectDeps = {
  timers: Map<string, NodeJS.Timeout>
  getLiveRow: (name: string) => MCPServerConnection | undefined
  onConnectionAttempt: (result: {
    client: MCPServerConnection
    tools: Tool[]
    commands: Command[]
    resources?: ServerResource[]
    attemptEpoch?: number
  }) => void
  reconnect?: typeof reconnectMcpServerImpl
  detachAndClose?: typeof detachAndCloseConnection
  getIdentityEpoch?: () => number
  isDisabled?: (name: string) => boolean
  getPolicyBlockReason?: typeof getMcpServerPolicyBlockReason
  computeDelayMs?: (attempt: number) => number
  maxAttempts?: number
}

/**
 * Official 2.1.327-328 `dsn` / `Mz` (#412): schedule slow background reconnect
 * attempts for an eligible remote HTTPS hostname MCP server.
 *
 * - Captures `attemptEpoch = getIdentityEpoch()` and forwards it to `onConnectionAttempt`.
 * - Re-checks timer ownership, disabled state, identity epoch, managed policy block,
 *   and live `'failed'` row before applying any settlement.
 * - Always calls `detachAndClose(result.client)` if a superseded/cancelled/stale
 *   attempt settles as `'connected'` so open transports never leak.
 */
export function startSlowBackgroundReconnectForServer(
  serverName: string,
  serverConfig: ScopedMcpServerConfig,
  deps: SlowBackgroundReconnectDeps,
): boolean {
  if (!isEligibleForSlowBackgroundReconnect(serverConfig)) {
    return false
  }
  const isDisabled = deps.isDisabled ?? isMcpServerDisabled
  const getPolicyBlockReason =
    deps.getPolicyBlockReason ?? getMcpServerPolicyBlockReason
  const getIdentityEpoch = deps.getIdentityEpoch ?? getMcpIdentityEpoch
  const reconnect = deps.reconnect ?? reconnectMcpServerImpl
  const detachAndClose = deps.detachAndClose ?? detachAndCloseConnection
  const computeDelayMs = deps.computeDelayMs ?? computeSlowReconnectDelayMs
  const maxAttempts = deps.maxAttempts ?? SLOW_RECONNECT_MAX_ATTEMPTS

  if (deps.timers.has(serverName)) {
    return false
  }
  if (isDisabled(serverName)) {
    return false
  }
  if (getPolicyBlockReason(serverName, serverConfig) === 'managed-policy') {
    return false
  }

  const attemptEpoch = getIdentityEpoch()
  let slowAttempt = 0

  const isStillValid = (timer: NodeJS.Timeout): boolean => {
    if (deps.timers.get(serverName) !== timer) return false
    if (isDisabled(serverName)) return false
    if (
      getIdentityEpoch() !== attemptEpoch &&
      mcpConfigDependsOnAccountIdentity(serverConfig)
    ) {
      return false
    }
    if (getPolicyBlockReason(serverName, serverConfig) === 'managed-policy') {
      return false
    }
    const liveRow = deps.getLiveRow(serverName)
    if (liveRow?.type !== 'failed') {
      return false
    }
    return true
  }

  const disposeIfStaleConnected = (
    settledClient: MCPServerConnection,
  ): void => {
    if (settledClient.type !== 'connected') return
    const liveRow = deps.getLiveRow(serverName)
    if (
      !(
        liveRow?.type === 'connected' && liveRow.client === settledClient.client
      )
    ) {
      void detachAndClose(settledClient).catch(() => {})
    }
  }

  const scheduleNextSlowAttempt = () => {
    if (slowAttempt >= maxAttempts) {
      deps.timers.delete(serverName)
      return
    }
    if (isDisabled(serverName)) {
      deps.timers.delete(serverName)
      return
    }
    if (getPolicyBlockReason(serverName, serverConfig) === 'managed-policy') {
      deps.timers.delete(serverName)
      return
    }
    const delayMs = computeDelayMs(slowAttempt + 1)
    logMCPDebug(
      serverName,
      `Scheduling slow background reconnect attempt ${slowAttempt + 1}/${maxAttempts} in ${delayMs}ms`,
    )
    // eslint-disable-next-line no-restricted-syntax -- timer stored in ref for cancellation
    const timer = setTimeout(async () => {
      if (!isStillValid(timer)) {
        if (deps.timers.get(serverName) === timer) {
          deps.timers.delete(serverName)
        }
        return
      }
      slowAttempt += 1
      logMCPDebug(serverName, `Background reconnect attempt ${slowAttempt}`)
      try {
        const result = await reconnect(
          serverName,
          serverConfig,
          undefined,
          undefined,
          { keepConnectionInUse: true },
        )
        if (!isStillValid(timer)) {
          disposeIfStaleConnected(result.client)
          if (deps.timers.get(serverName) === timer) {
            deps.timers.delete(serverName)
          }
          return
        }
        const keptToolsListFailed =
          result.keptConnectionInUse === true &&
          result.client.type === 'connected' &&
          result.client.toolsListError !== undefined
        if (
          !keptToolsListFailed &&
          (result.client.type === 'connected' ||
            result.client.type === 'needs-auth')
        ) {
          deps.timers.delete(serverName)
          deps.onConnectionAttempt({ ...result, attemptEpoch })
          return
        }
      } catch (err) {
        if (deps.timers.get(serverName) !== timer) {
          return
        }
        logMCPError(
          serverName,
          `Background reconnect attempt ${slowAttempt} threw: ${err}`,
        )
      }
      if (!isStillValid(timer)) {
        if (deps.timers.get(serverName) === timer) {
          deps.timers.delete(serverName)
        }
        return
      }
      scheduleNextSlowAttempt()
    }, delayMs)
    timer.unref?.()
    deps.timers.set(serverName, timer)
  }

  scheduleNextSlowAttempt()
  return true
}

export type FastReconnectBackoffDeps = {
  timers: Map<string, NodeJS.Timeout>
  generations: Map<string, number>
  getLiveRow: (name: string) => MCPServerConnection | undefined
  updateServer: (update: MCPServerConnection) => void
  onConnectionAttempt: (result: {
    client: MCPServerConnection
    tools: Tool[]
    commands: Command[]
    resources?: ServerResource[]
    attemptEpoch?: number
  }) => void
  onExhaustedFailed?: () => void
  reconnect?: typeof reconnectMcpServerImpl
  detachAndClose?: typeof detachAndCloseConnection
  getIdentityEpoch?: () => number
  isDisabled?: (name: string) => boolean
  getPolicyBlockReason?: typeof getMcpServerPolicyBlockReason
  maxAttempts?: number
  initialBackoffMs?: number
  maxBackoffMs?: number
  closedClientRef?: unknown
}

export function bumpReconnectGeneration(
  generations: Map<string, number>,
  serverName: string,
): number {
  const next = (generations.get(serverName) ?? 0) + 1
  generations.set(serverName, next)
  return next
}

/**
 * Automatic fast-backoff reconnection for remote MCP transports after `onclose`.
 *
 * - Claims a per-server generation counter so manual reconnects, disables,
 *   removals, unmounts, or newer connections supersede any in-flight attempt.
 * - Re-checks supersession before and after `await reconnect(...)` and disposes
 *   any late connected transport via `detachAndClose` to avoid leaks.
 * - Emits clean `PendingMCPServer` / `FailedMCPServer` rows without spreading a
 *   stale `client.client` handle from the closed `ConnectedMCPServer`.
 */
export async function runReconnectWithBackoffForServer(
  serverName: string,
  serverConfig: ScopedMcpServerConfig,
  deps: FastReconnectBackoffDeps,
): Promise<void> {
  const isDisabled = deps.isDisabled ?? isMcpServerDisabled
  const getPolicyBlockReason =
    deps.getPolicyBlockReason ?? getMcpServerPolicyBlockReason
  const getIdentityEpoch = deps.getIdentityEpoch ?? getMcpIdentityEpoch
  const reconnect = deps.reconnect ?? reconnectMcpServerImpl
  const detachAndClose = deps.detachAndClose ?? detachAndCloseConnection
  const maxAttempts = deps.maxAttempts ?? MAX_RECONNECT_ATTEMPTS
  const initialBackoffMs = deps.initialBackoffMs ?? INITIAL_BACKOFF_MS
  const maxBackoffMs = deps.maxBackoffMs ?? MAX_BACKOFF_MS
  const transportType = getTransportDisplayName(serverConfig.type ?? 'stdio')

  const existingTimer = deps.timers.get(serverName)
  if (existingTimer) {
    clearTimeout(existingTimer)
    deps.timers.delete(serverName)
  }

  const generation = bumpReconnectGeneration(deps.generations, serverName)
  const attemptEpoch = getIdentityEpoch()
  let activeTimer: NodeJS.Timeout | undefined

  const clearOwnedTimer = () => {
    if (
      activeTimer !== undefined &&
      deps.timers.get(serverName) === activeTimer
    ) {
      clearTimeout(activeTimer)
      deps.timers.delete(serverName)
    }
    activeTimer = undefined
  }

  type SupersessionReason =
    | 'generation'
    | 'disabled'
    | 'identity-epoch'
    | 'managed-policy'
    | 'live-row'
    | null

  const getSupersessionReason = (): SupersessionReason => {
    if (deps.generations.get(serverName) !== generation) return 'generation'
    if (isDisabled(serverName)) return 'disabled'
    if (
      getIdentityEpoch() !== attemptEpoch &&
      mcpConfigDependsOnAccountIdentity(serverConfig)
    ) {
      return 'identity-epoch'
    }
    if (getPolicyBlockReason(serverName, serverConfig) === 'managed-policy') {
      return 'managed-policy'
    }
    const liveRow = deps.getLiveRow(serverName)
    if (liveRow === undefined || liveRow.type === 'disabled') {
      return 'live-row'
    }
    if (
      liveRow.type === 'connected' &&
      (deps.closedClientRef === undefined ||
        liveRow.client !== deps.closedClientRef)
    ) {
      return 'live-row'
    }
    return null
  }

  const settleIfPendingOnSupersession = (reason: SupersessionReason): void => {
    if (
      reason !== 'disabled' &&
      reason !== 'managed-policy' &&
      reason !== 'identity-epoch'
    ) {
      return
    }
    const liveRow = deps.getLiveRow(serverName)
    if (liveRow?.type !== 'pending') {
      return
    }
    deps.updateServer({
      name: serverName,
      config: serverConfig,
      type: reason === 'disabled' ? 'disabled' : 'failed',
    })
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const preAttemptSupersession = getSupersessionReason()
    if (preAttemptSupersession !== null) {
      logMCPDebug(
        serverName,
        `Automatic reconnection superseded before attempt ${attempt} (${preAttemptSupersession}), stopping retry`,
      )
      settleIfPendingOnSupersession(preAttemptSupersession)
      clearOwnedTimer()
      return
    }

    deps.updateServer({
      name: serverName,
      config: serverConfig,
      type: 'pending',
      reconnectAttempt: attempt,
      maxReconnectAttempts: maxAttempts,
    })

    const reconnectStartTime = Date.now()
    try {
      const result = await reconnect(
        serverName,
        serverConfig,
        undefined,
        undefined,
        { keepConnectionInUse: true },
      )
      const elapsed = Date.now() - reconnectStartTime

      const inFlightSupersession = getSupersessionReason()
      if (inFlightSupersession !== null) {
        logMCPDebug(
          serverName,
          `Automatic reconnection attempt ${attempt} superseded while in flight (${inFlightSupersession}); discarding result`,
        )
        if (result.client.type === 'connected') {
          const liveRow = deps.getLiveRow(serverName)
          if (
            !(
              liveRow?.type === 'connected' &&
              liveRow.client === result.client.client
            )
          ) {
            void detachAndClose(result.client).catch(() => {})
          }
        }
        settleIfPendingOnSupersession(inFlightSupersession)
        clearOwnedTimer()
        return
      }

      const keptToolsListFailed =
        result.keptConnectionInUse === true &&
        result.client.type === 'connected' &&
        result.client.toolsListError !== undefined

      if (result.client.type === 'connected' && !keptToolsListFailed) {
        logMCPDebug(
          serverName,
          `${transportType} reconnection successful after ${elapsed}ms (attempt ${attempt})`,
        )
        clearOwnedTimer()
        deps.onConnectionAttempt({ ...result, attemptEpoch })
        return
      }

      if (result.client.type === 'needs-auth') {
        logMCPDebug(
          serverName,
          `${transportType} reconnection attempt ${attempt} requires authentication; stopping backoff`,
        )
        clearOwnedTimer()
        deps.onConnectionAttempt({ ...result, attemptEpoch })
        return
      }

      logMCPDebug(
        serverName,
        `${transportType} reconnection attempt ${attempt} completed with status: ${result.client.type}`,
      )

      if (attempt === maxAttempts) {
        logMCPDebug(
          serverName,
          `Max reconnection attempts (${maxAttempts}) reached, giving up`,
        )
        clearOwnedTimer()
        const cleanClient: MCPServerConnection =
          result.client.type === 'failed'
            ? {
                name: result.client.name,
                config: result.client.config,
                type: 'failed',
                ...(result.client.error !== undefined
                  ? { error: result.client.error }
                  : {}),
                ...(result.client.errorCode !== undefined
                  ? { errorCode: result.client.errorCode }
                  : {}),
                ...(result.client.displayDetail !== undefined
                  ? { displayDetail: result.client.displayDetail }
                  : {}),
              }
            : result.client
        deps.onConnectionAttempt({
          ...result,
          client: cleanClient,
          attemptEpoch,
        })
        if (cleanClient.type === 'failed' && getSupersessionReason() === null) {
          deps.onExhaustedFailed?.()
        }
        return
      }
    } catch (error) {
      const elapsed = Date.now() - reconnectStartTime
      const catchSupersession = getSupersessionReason()
      if (catchSupersession !== null) {
        logMCPDebug(
          serverName,
          `Automatic reconnection attempt ${attempt} failed after supersession (${catchSupersession}); ignoring`,
        )
        settleIfPendingOnSupersession(catchSupersession)
        clearOwnedTimer()
        return
      }
      logMCPError(
        serverName,
        `${transportType} reconnection attempt ${attempt} failed after ${elapsed}ms: ${error}`,
      )

      if (attempt === maxAttempts) {
        logMCPDebug(
          serverName,
          `Max reconnection attempts (${maxAttempts}) reached, giving up`,
        )
        clearOwnedTimer()
        deps.updateServer({
          name: serverName,
          config: serverConfig,
          type: 'failed',
        })
        if (getSupersessionReason() === null) {
          deps.onExhaustedFailed?.()
        }
        return
      }
    }

    const postAttemptSupersession = getSupersessionReason()
    if (postAttemptSupersession !== null) {
      settleIfPendingOnSupersession(postAttemptSupersession)
      clearOwnedTimer()
      return
    }

    const backoffMs = Math.min(
      initialBackoffMs * 2 ** (attempt - 1),
      maxBackoffMs,
    )
    logMCPDebug(
      serverName,
      `Scheduling reconnection attempt ${attempt + 1} in ${backoffMs}ms`,
    )

    await new Promise<void>(resolve => {
      // eslint-disable-next-line no-restricted-syntax -- timer stored in ref for cancellation; sleep() doesn't expose the handle
      const timer = setTimeout(() => {
        if (deps.timers.get(serverName) === timer) {
          deps.timers.delete(serverName)
        }
        if (activeTimer === timer) {
          activeTimer = undefined
        }
        resolve()
      }, backoffMs)
      timer.unref?.()
      activeTimer = timer
      deps.timers.set(serverName, timer)
    })
  }
}

/**
 * Create a unique key for a plugin error to enable deduplication
 */
function getErrorKey(error: PluginError): string {
  const plugin = 'plugin' in error ? error.plugin : 'no-plugin'
  return `${error.type}:${error.source}:${plugin}`
}

/**
 * Add errors to AppState, deduplicating to avoid showing the same error multiple times
 */
function addErrorsToAppState(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  newErrors: PluginError[],
): void {
  if (newErrors.length === 0) return

  setAppState(prevState => {
    // Build set of existing error keys
    const existingKeys = new Set(
      prevState.plugins.errors.map(e => getErrorKey(e)),
    )

    // Only add errors that don't already exist
    const uniqueNewErrors = newErrors.filter(
      error => !existingKeys.has(getErrorKey(error)),
    )

    if (uniqueNewErrors.length === 0) {
      return prevState
    }

    return {
      ...prevState,
      plugins: {
        ...prevState.plugins,
        errors: [...prevState.plugins.errors, ...uniqueNewErrors],
      },
    }
  })
}

/**
 * Official #1600 — create a `McpSwitchedOffRecord` wired to project config
 * (`getDisabledMcpServers`) and worker `internal_metadata.disabled_mcp_servers`
 * (`notifyInternalMetadataChanged`).
 */
export function createManagedMcpSwitchedOffRecord(opts?: {
  restoredWorkerState?: Promise<RestoredWorkerMcpState>
  rereadWorkerState?: () => Promise<RestoredWorkerMcpState>
  isKept?: boolean
}): McpSwitchedOffRecord {
  return new McpSwitchedOffRecord(
    {
      restoredWorkerState: opts?.restoredWorkerState ?? Promise.resolve(null),
      rereadWorkerState: opts?.rereadWorkerState ?? (async () => null),
      sessionState: {
        notifyInternalMetadataChanged: patch =>
          notifyInternalMetadataChanged(patch),
      },
    },
    {
      isKept: opts?.isKept ?? isMcpSwitchedOffRecordKept(),
      getDisabledServers: getDisabledMcpServers,
    },
  )
}

/**
 * Official #1600 — restore worker-persisted switched-off MCP servers into
 * project config and close/disable any already-active connections.
 */
export async function restoreManagedMcpSwitchedOffRecord(
  record: McpSwitchedOffRecord,
  deps: {
    getClients: () => readonly MCPServerConnection[]
    closeConnection: (
      name: string,
      config: ScopedMcpServerConfig,
    ) => Promise<void>
    markDisabled: (name: string, config: ScopedMcpServerConfig) => void
    closeTimeoutMs?: number
  },
): Promise<void> {
  await record.restore({
    saveDisabledServers: saveDisabledMcpServers,
    getDisabledServers: getDisabledMcpServers,
    getClients: deps.getClients,
    closeClient: async (name, config, isStillSwitchedOff) => {
      await deps.closeConnection(name, config as ScopedMcpServerConfig)
      if (isStillSwitchedOff()) {
        deps.markDisabled(name, config as ScopedMcpServerConfig)
      }
    },
    dropClientTools: name => {
      const current = deps.getClients().find(c => c.name === name)
      if (current) {
        deps.markDisabled(name, current.config)
      }
    },
    closeTimeoutMs: deps.closeTimeoutMs,
  })
}

/**
 * Hook to manage MCP (Model Context Protocol) server connections and updates
 *
 * This hook:
 * 1. Initializes MCP client connections based on config
 * 2. Sets up handlers for connection lifecycle events and sync with app state
 * 3. Manages automatic reconnection for SSE connections
 * 4. Returns a reconnect function
 */
export function useManageMCPConnections(
  dynamicMcpConfig: Record<string, ScopedMcpServerConfig> | undefined,
  isStrictMcpConfig = false,
) {
  const store = useAppStateStore()
  const mcpConnections = useMcpConnections()
  const _authVersion = useAppState(s => s.authVersion)
  // Incremented by /reload-plugins (refreshActivePlugins) to pick up newly
  // enabled plugin MCP servers. getClaudeCodeMcpConfigs() reads loadAllPlugins()
  // which has been cleared by refreshActivePlugins, so the effects below see
  // fresh plugin data on re-run.
  const _pluginReconnectKey = useAppState(s => s.mcp.pluginReconnectKey)
  const setAppState = useSetAppState()
  const dialogStore = useContext(DialogStoreContext)
  const requestDialog = useContext(RequestDialogContext)

  // Track active reconnection attempts to allow cancellation
  const reconnectTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  // Per-server reconnect generation counter so manual reconnects, disables,
  // removals, and newer connections supersede any in-flight backoff attempt.
  const reconnectGenerationsRef = useRef<Map<string, number>>(new Map())
  // Official 2.1.325 #2303: track plugin MCP servers removed while connecting
  // so their late in-flight settlements are disposed instead of relisted in /mcp.
  const removedStalePluginServersRef = useRef<Set<string>>(new Set())

  // Dedup the --channels blocked warning per skip kind so that a user who
  // sees "run /login" (auth skip), logs in, then hits the policy gate
  // gets a second toast.
  const channelWarnedKindsRef = useRef<Set<string>>(new Set())
  // densable `g.current` — servers whose inbound handler is actually
  // registered. Yrf's third predicate (`isServerRegistered`) reads this.
  const channelRegisteredServersRef = useRef<Set<string>>(new Set())
  // Channel permission callbacks — constructed once, stable ref. Stored in
  // AppState so interactiveHandler can subscribe. The pending Map lives inside
  // the closure (not module-level, not AppState — functions-in-state is brittle).
  const channelPermCallbacksRef = useRef<ChannelPermissionCallbacks | null>(
    null,
  )
  if (
    (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
    channelPermCallbacksRef.current === null
  ) {
    channelPermCallbacksRef.current = createChannelPermissionCallbacks(name =>
      channelRegisteredServersRef.current.has(name),
    )
  }
  // Store callbacks in AppState so interactiveHandler.ts can reach them via
  // ctx.toolUseContext.getAppState(). One-time set — the ref is stable.
  useEffect(() => {
    if (feature('KAIROS') || feature('KAIROS_CHANNELS')) {
      const callbacks = channelPermCallbacksRef.current
      if (!callbacks) return
      // GrowthBook runtime gate — separate from channels so channels can
      // ship without this. Checked at mount; mid-session flips need restart.
      // If off, callbacks never go into AppState → interactiveHandler sees
      // undefined → never sends → intercept has nothing pending → "yes tbxkq"
      // flows to Claude as normal chat. One gate, full disable.
      if (!isChannelPermissionRelayEnabled()) return
      setAppState(prev => {
        if (prev.channelPermissionCallbacks === callbacks) return prev
        return { ...prev, channelPermissionCallbacks: callbacks }
      })
      return () => {
        setAppState(prev => {
          if (prev.channelPermissionCallbacks === undefined) return prev
          return { ...prev, channelPermissionCallbacks: undefined }
        })
      }
    }
  }, [setAppState])
  const { addNotification } = useNotifications()

  // densable 2.1.216 #19 t7r.subscribe — per-server reauth toast when OAuth
  // refresh permanently invalidates credentials. Silent only for densable
  // oKn || XAA: Authorization (n5e), DYt WeakSet mark, design MCP+Claude auth,
  // or XAA. Not truthy headersHelper string (that is nKn, not oKn).
  const reauthNotifiedRef = useRef(new Set<string>())
  useEffect(() => {
    return subscribeMcpNeedsReauth(serverName => {
      if (reauthNotifiedRef.current.has(serverName)) return
      const client = store
        .getState()
        .mcp.clients.find(c => c.name === serverName)
      if (client?.type !== 'connected') return
      const cfg = client.config
      const headers =
        cfg && typeof cfg === 'object' && 'headers' in cfg
          ? (cfg.headers as Record<string, string> | undefined)
          : undefined
      const url =
        cfg && typeof cfg === 'object' && 'url' in cfg
          ? (cfg.url as string | undefined)
          : undefined
      const oauthXaa =
        cfg &&
        typeof cfg === 'object' &&
        'oauth' in cfg &&
        cfg.oauth &&
        typeof cfg.oauth === 'object' &&
        'xaa' in cfg.oauth
          ? Boolean((cfg.oauth as { xaa?: unknown }).xaa)
          : false
      if (
        shouldSkipMcpNeedsReauthNotification({
          configType: cfg?.type,
          headers,
          configObject: cfg,
          url,
          oauthXaa,
          xaaEnabled: isXaaEnabled(),
          isFirstPartyProvider: getAPIProvider() === 'firstParty',
          hasClaudeAiAccessToken: Boolean(
            getClaudeAIOAuthTokens()?.accessToken,
          ),
        })
      ) {
        return
      }
      reauthNotifiedRef.current.add(serverName)
      addNotification({
        key: mcpNeedsReauthNotificationKey(serverName),
        priority: 'high',
        text: formatMcpNeedsReauthNotification(serverName),
        color: 'warning',
        timeoutMs: 12000,
      })
    })
  }, [store, addNotification])

  // Official 2.1.326 #3 & #292: Surface an explanation when an administrator
  // deploys `managed-mcp.json` mid-session.
  useEffect(() => {
    const showNotice = (message: string) => {
      addNotification({
        key: 'managed-mcp-arrived',
        priority: 'high',
        text: message,
        color: 'warning',
        timeoutMs: 15000,
      })
    }
    const existing = consumeManagedMcpArrivalNotice()
    if (existing) {
      showNotice(existing)
    }
    return subscribeToManagedMcpArrival(showNotice)
  }, [addNotification])

  // Batched MCP state updates: queue individual server updates and flush them
  // in a single setAppState call via setTimeout. Using a time-based window
  // (instead of queueMicrotask) ensures updates are batched even when
  // connection callbacks arrive at different times due to network I/O.
  const MCP_BATCH_FLUSH_MS = 16
  type PendingUpdate = MCPServerConnection & {
    tools?: Tool[]
    commands?: Command[]
    resources?: ServerResource[]
  }
  const pendingUpdatesRef = useRef<PendingUpdate[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushPendingUpdates = useCallback(() => {
    flushTimerRef.current = null
    const updates = pendingUpdatesRef.current
    if (updates.length === 0) return
    pendingUpdatesRef.current = []

    setAppState(prevState => {
      let mcp = prevState.mcp

      for (const update of updates) {
        const {
          tools: rawTools,
          commands: rawCmds,
          resources: rawRes,
          ...client
        } = update
        const tools =
          client.type === 'disabled' || client.type === 'failed'
            ? (rawTools ?? [])
            : rawTools
        const commands =
          client.type === 'disabled' || client.type === 'failed'
            ? (rawCmds ?? [])
            : rawCmds
        const resources =
          client.type === 'disabled' || client.type === 'failed'
            ? (rawRes ?? [])
            : rawRes

        const prefix = getMcpPrefix(client.name)
        const existingClient = mcp.clients.find(c => c.name === client.name)
        if (
          existingClient &&
          !shouldApplyMcpClientUpdate(existingClient, client)
        ) {
          continue
        }

        const updatedClients =
          existingClient === undefined
            ? [...mcp.clients, client]
            : mcp.clients.map(c => (c.name === client.name ? client : c))

        const updatedTools =
          tools === undefined
            ? mcp.tools
            : [...reject(mcp.tools, t => t.name?.startsWith(prefix)), ...tools]

        const updatedCommands =
          commands === undefined
            ? mcp.commands
            : [
                ...reject(mcp.commands, c =>
                  commandBelongsToServer(c, client.name),
                ),
                ...commands,
              ]

        const updatedResources =
          resources === undefined
            ? mcp.resources
            : {
                ...mcp.resources,
                ...(resources.length > 0
                  ? { [client.name]: resources }
                  : omit(mcp.resources, client.name)),
              }

        mcp = {
          ...mcp,
          clients: updatedClients,
          tools: updatedTools,
          commands: updatedCommands,
          resources: updatedResources,
        }
      }

      return { ...prevState, mcp }
    })
  }, [setAppState])

  // Update server state, tools, commands, and resources.
  // When tools, commands, or resources are undefined, the existing values are preserved.
  // When type is 'disabled' or 'failed', tools/commands/resources are automatically cleared.
  // Updates are batched via setTimeout to coalesce updates arriving within MCP_BATCH_FLUSH_MS.
  const updateServer = useCallback(
    (update: PendingUpdate) => {
      pendingUpdatesRef.current.push(update)
      if (flushTimerRef.current === null) {
        flushTimerRef.current = setTimeout(
          flushPendingUpdates,
          MCP_BATCH_FLUSH_MS,
        )
      }
    },
    [flushPendingUpdates],
  )

  // Official #1600 — bind/restore McpSwitchedOffRecord so switched-off MCP
  // servers are restored on mount and kept synced on every toggle via
  // setMcpServerEnabled → notifyMcpSwitchedOffSaved.
  useEffect(() => {
    const existing = getActiveMcpSwitchedOffRecord()
    const owned = existing === null
    const record = existing ?? createManagedMcpSwitchedOffRecord()
    if (owned) {
      setActiveMcpSwitchedOffRecord(record)
    }
    void restoreManagedMcpSwitchedOffRecord(record, {
      getClients: () => store.getState().mcp.clients,
      closeConnection: async (name, config) => {
        await clearServerCache(name, config)
      },
      markDisabled: (name, config) => {
        updateServer({ name, type: 'disabled', config })
      },
    })
    return () => {
      if (owned && getActiveMcpSwitchedOffRecord() === record) {
        setActiveMcpSwitchedOffRecord(null)
      }
    }
  }, [store, updateServer])

  const onConnectionAttempt = useCallback(
    ({
      client,
      tools,
      commands,
      resources,
      attemptEpoch,
    }: {
      client: MCPServerConnection
      tools: Tool[]
      commands: Command[]
      resources?: ServerResource[]
      attemptEpoch?: number
    }) => {
      // Official $Qr: drop late connection settlements superseded by an account
      // switch (sign-in / org change) so org-managed / previous-account servers
      // are never relisted under the new session.
      if (
        attemptEpoch !== undefined &&
        attemptEpoch !== getMcpIdentityEpoch() &&
        mcpConfigDependsOnAccountIdentity(client.config)
      ) {
        logMCPDebug(
          client.name,
          'applyConnectionResult: settlement superseded by an account switch — closed, not installed',
        )
        if (client.type === 'connected') {
          void detachAndCloseConnection(client).catch(() => {})
        }
        return
      }
      // Official $Qr / ju / Oio: refuse late settlements whose scope is blocked
      // by enterprise/managed policy.
      if (client.type !== 'failed' && client.type !== 'disabled') {
        const blockReason = getMcpServerPolicyBlockReason(
          client.name,
          client.config,
        )
        if (blockReason === 'managed-policy') {
          logMCPDebug(
            client.name,
            `applyConnectionResult: disposing connect that settled after a ${blockReason} deny`,
          )
          if (client.type === 'connected') {
            void detachAndCloseConnection(client).catch(() => {})
          }
          return
        }
      }
      // Official 2.1.325 #2303: drop late connection settlements for plugin
      // MCP servers removed by a plugin reload while the connect was in flight.
      if (
        removedStalePluginServersRef.current.has(client.name) &&
        (client.config.scope === 'dynamic' ||
          client.config.pluginSource !== undefined)
      ) {
        logMCPDebug(
          client.name,
          'applyConnectionResult: plugin MCP server was removed during reload while connecting — disposing',
        )
        if (client.type === 'connected') {
          void detachAndCloseConnection(client).catch(() => {})
        }
        return
      }
      unmarkMcpServerRemovedFromSession(client.name, client.config)
      updateServer({ ...client, tools, commands, resources })

      // Handle side effects based on client state
      switch (client.type) {
        case 'connected': {
          bumpReconnectGeneration(reconnectGenerationsRef.current, client.name)
          const pendingTimer = reconnectTimersRef.current.get(client.name)
          if (pendingTimer) {
            clearTimeout(pendingTimer)
            reconnectTimersRef.current.delete(client.name)
          }
          // Overwrite the default elicitation handler registered in connectToServer.
          // Gold pct: requestDialog(W7) Host; Be.queue only when mailbox is absent.
          registerElicitationHandler(
            client.client,
            client.name,
            setAppState,
            dialogStore,
            requestDialog as Parameters<typeof registerElicitationHandler>[4],
            client.transportErrorState,
          )

          client.client.onclose = () => {
            client.client.onclose = undefined
            const liveRow = store
              .getState()
              .mcp.clients.find(c => c.name === client.name)
            if (
              liveRow?.type === 'connected' &&
              liveRow.client !== client.client
            ) {
              logMCPDebug(
                client.name,
                'Ignoring onclose from superseded MCP client connection',
              )
              return
            }

            const configType = client.config.type ?? 'stdio'

            clearServerCache(client.name, client.config).catch(() => {
              logForDebugging(
                `Failed to invalidate the server cache: ${client.name}`,
              )
            })

            // TODO: This really isn't great: ideally we'd check appstate as the source of truth
            // as to whether it was disconnected due to a disable, but appstate is stale at this
            // point. Getting a live reference to appstate feels a little hacky, so we'll just
            // check the disk state. We may want to refactor some of this.
            if (isMcpServerDisabled(client.name)) {
              logMCPDebug(
                client.name,
                `Server is disabled, skipping automatic reconnection`,
              )
              return
            }

            // Handle automatic reconnection for remote transports
            // Skip stdio (local process) and sdk (internal) - they don't support reconnection
            if (configType !== 'stdio' && configType !== 'sdk') {
              const transportType = getTransportDisplayName(configType)
              logMCPDebug(
                client.name,
                `${transportType} transport closed/disconnected, attempting automatic reconnection`,
              )

              // Official 2.1.327 (#412): after fast retries exhaust on an eligible
              // remote HTTPS hostname server, continue slow background retries (~1 day)
              // so prolonged VPN/network outages self-heal.
              const startSlowBackgroundReconnect = () => {
                startSlowBackgroundReconnectForServer(
                  client.name,
                  client.config,
                  {
                    timers: reconnectTimersRef.current,
                    getLiveRow: name =>
                      store.getState().mcp.clients.find(c => c.name === name),
                    onConnectionAttempt,
                  },
                )
              }

              void runReconnectWithBackoffForServer(
                client.name,
                client.config,
                {
                  timers: reconnectTimersRef.current,
                  generations: reconnectGenerationsRef.current,
                  getLiveRow: name =>
                    store.getState().mcp.clients.find(c => c.name === name),
                  updateServer,
                  onConnectionAttempt,
                  onExhaustedFailed: startSlowBackgroundReconnect,
                  closedClientRef: client.client,
                },
              )
            } else {
              bumpReconnectGeneration(
                reconnectGenerationsRef.current,
                client.name,
              )
              channelRegisteredServersRef.current.delete(client.name)
              updateServer({
                name: client.name,
                config: client.config,
                type: 'failed',
              })
            }
          }

          // Channel push: notifications/claude/channel → enqueue().
          // Gate decides whether to register the handler; connection stays
          // up either way (allowedMcpServers controls that).
          const gate = gateChannelServer(
            client.name,
            client.capabilities,
            client.config.pluginSource,
            client.protocolEra,
          )
          const entry = findChannelEntry(client.name, getAllowedChannels())
          // Plugin identifier for telemetry — log name@marketplace for any
          // plugin-kind entry (same tier as tengu_plugin_installed, which
          // logs arbitrary plugin_id+marketplace_name ungated). server-kind
          // names are MCP-server-name tier; those are opt-in-only elsewhere
          // (see isAnalyticsToolDetailsLoggingEnabled in metadata.ts) and
          // stay unlogged here. is_dev/entry_kind segment the rest.
          const pluginId =
            entry?.kind === 'plugin'
              ? (`${entry.name}@${entry.marketplace}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
              : undefined
          let inboundRegistered = false
          const registerInboundHandlers = () => {
            // densable N(): add to g.current then bind handlers.
            channelRegisteredServersRef.current.add(client.name)
            client.client.setNotificationHandler(
              CHANNEL_MESSAGE_METHOD,
              { params: ChannelMessageParamsSchema() },
              async params => {
                const { content, meta } = params
                logMCPDebug(
                  client.name,
                  `notifications/claude/channel: ${content.slice(0, 80)}`,
                )
                logEvent('tengu_mcp_channel_message', {
                  content_length: content.length,
                  meta_key_count: Object.keys(meta ?? {}).length,
                  entry_kind:
                    entry?.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  is_dev: entry?.dev ?? false,
                  plugin: pluginId,
                })
                enqueue({
                  mode: 'prompt',
                  value: wrapChannelMessage(client.name, content, meta),
                  priority: 'next',
                  isMeta: true,
                  origin: { kind: 'channel', server: client.name },
                  skipSlashCommands: true,
                  skipAttachments: true,
                })
              },
            )
            // Permission-reply handler — separate event, separate
            // capability. densable s3r (truthy). Server parses the
            // user's reply and emits {request_id, behavior}.
            if (
              hasExperimentalCapability(
                client.capabilities,
                'claude/channel/permission',
              )
            ) {
              client.client.setNotificationHandler(
                CHANNEL_PERMISSION_METHOD,
                { params: ChannelPermissionParamsSchema() },
                async params => {
                  const { request_id, behavior } = params
                  const resolved =
                    channelPermCallbacksRef.current?.resolve(
                      request_id,
                      behavior,
                      client.name,
                    ) ?? false
                  logMCPDebug(
                    client.name,
                    `notifications/claude/channel/permission: ${request_id} → ${behavior} (${resolved ? 'matched pending' : 'no pending entry — stale or unknown ID'})`,
                  )
                },
              )
            }
          }
          switch (gate.action) {
            case 'register':
              logMCPDebug(client.name, 'Channel notifications registered')
              registerInboundHandlers()
              inboundRegistered = true
              break
            case 'skip': {
              // densable t2a: only provider/disabled/capability/era tear
              // down. Soft skips preserve a previously registered handler.
              const hard = isChannelGateHardRevocation(gate.kind)
              const wasRegistered = channelRegisteredServersRef.current.has(
                client.name,
              )
              if (hard) {
                channelRegisteredServersRef.current.delete(client.name)
                client.client.removeNotificationHandler(
                  'notifications/claude/channel',
                )
                client.client.removeNotificationHandler(
                  CHANNEL_PERMISSION_METHOD,
                )
              } else if (wasRegistered) {
                logMCPDebug(
                  client.name,
                  `Channel gate says skip:${gate.kind} but was previously registered — preserving handler`,
                )
                registerInboundHandlers()
                inboundRegistered = true
                break
              }
              logMCPDebug(
                client.name,
                `Channel notifications skipped: ${gate.reason}`,
              )
              // Surface a once-per-kind toast. Capability/session stay
              // debug-only. Era is per-server (`era:${name}`).
              const warnKey =
                gate.kind === 'capability' || gate.kind === 'session'
                  ? null
                  : gate.kind === 'era'
                    ? `era:${client.name}`
                    : gate.kind
              if (
                warnKey !== null &&
                !channelWarnedKindsRef.current.has(warnKey) &&
                (gate.kind === 'marketplace' ||
                  gate.kind === 'allowlist' ||
                  entry !== undefined)
              ) {
                channelWarnedKindsRef.current.add(warnKey)
                const text =
                  gate.kind === 'disabled'
                    ? 'Channels are not currently available'
                    : gate.kind === 'provider'
                      ? 'Channels are not available on Bedrock, Vertex, or Foundry'
                      : gate.kind === 'auth'
                        ? 'Channels require claude.ai authentication · run /login'
                        : gate.kind === 'policy'
                          ? 'Channels are not enabled for your org · have an administrator set channelsEnabled: true in managed settings'
                          : gate.kind === 'era'
                            ? `Channel messages from "${client.name}" are unavailable: this connection's protocol version has no channel delivery path`
                            : gate.reason
                addNotification({
                  key:
                    gate.kind === 'era'
                      ? `channels-blocked-era-${client.name}`
                      : `channels-blocked-${gate.kind}`,
                  priority: 'high',
                  text,
                  color: 'warning',
                  timeoutMs: 12000,
                })
              }
              break
            }
          }
          if (
            inboundRegistered ||
            (gate.action === 'skip' && gate.kind !== 'capability')
          ) {
            logEvent('tengu_mcp_channel_gate', {
              registered: inboundRegistered,
              skip_kind:
                gate.action === 'skip'
                  ? (gate.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
                  : undefined,
              entry_kind:
                entry?.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              is_dev: entry?.dev ?? false,
              plugin: pluginId,
            })
          }

          // Register notification handlers for list_changed notifications
          // These allow the server to notify us when tools, prompts, or resources change
          if (client.capabilities?.tools?.listChanged) {
            const refreshToolsList = async () => {
              logMCPDebug(
                client.name,
                `Received tools/list_changed notification, refreshing tools`,
              )
              const refreshSeq = beginMcpToolRefreshSequence(client)
              try {
                // Grab cached promise before invalidating to log previous count
                const previousToolsPromise = fetchToolsForClient.cache.get(
                  client.name,
                )
                fetchToolsForClient.cache.delete(client.name)
                const newTools = await fetchToolsForClient(client)
                // Official 325 #1893: discard stale/failed refreshes so tools are never wiped.
                if (client.toolsListError) {
                  logMCPDebug(
                    client.name,
                    `Keeping previous tools after refresh error: ${client.toolsListError}`,
                  )
                  return
                }
                if (client.discoveryAuthFailure && newTools.length === 0) {
                  logMCPDebug(
                    client.name,
                    `Keeping previous tools: server rejected tool discovery as unauthorized`,
                  )
                  return
                }
                if (!commitMcpToolRefreshSequence(client, refreshSeq)) {
                  logMCPDebug(
                    client.name,
                    `Discarding superseded tools/list refresh (seq ${refreshSeq})`,
                  )
                  return
                }
                const newCount = newTools.length
                if (previousToolsPromise) {
                  previousToolsPromise.then(
                    (previousTools: Tool[]) => {
                      logEvent('tengu_mcp_list_changed', {
                        type: 'tools' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                        previousCount: previousTools.length,
                        newCount,
                      })
                    },
                    () => {
                      logEvent('tengu_mcp_list_changed', {
                        type: 'tools' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                        newCount,
                      })
                    },
                  )
                } else {
                  logEvent('tengu_mcp_list_changed', {
                    type: 'tools' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    newCount,
                  })
                }
                updateServer({ ...client, tools: newTools })
              } catch (error) {
                logMCPError(
                  client.name,
                  `Failed to refresh tools after list_changed notification: ${errorMessage(error)}`,
                )
              }
            }
            client.client.setNotificationHandler(
              'notifications/tools/list_changed',
              refreshToolsList,
            )
            // densable LVa — same handler after listen re-open (rpS)
            registerMcpListenPostReopenHandler(
              client.name,
              'tools',
              refreshToolsList,
            )
          }

          if (client.capabilities?.prompts?.listChanged) {
            const refreshPromptsList = async () => {
              logMCPDebug(
                client.name,
                `Received prompts/list_changed notification, refreshing prompts`,
              )
              logEvent('tengu_mcp_list_changed', {
                type: 'prompts' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
              // densable #42: snapshot previous AppState commands; on failure keep.
              const previousCommands = store
                .getState()
                .mcp.commands.filter(c =>
                  commandBelongsToServer(c, client.name),
                )
              try {
                // Skills come from resources, not prompts — don't invalidate their
                // cache here. fetchMcpSkillsForClient returns the cached result.
                fetchCommandsForClient.cache.delete(client.name)
                const [mcpPrompts, mcpSkills] = await Promise.all([
                  fetchCommandsForClient(client),
                  feature('MCP_SKILLS')
                    ? fetchMcpSkillsForClient!(client)
                    : Promise.resolve([]),
                ])
                const resolved = resolvePromptsListChangedRefresh(
                  previousCommands,
                  { ok: true, value: [...mcpPrompts, ...mcpSkills] },
                )
                updateServer({
                  ...client,
                  commands: resolved.next,
                })
                // MCP skills changed — invalidate skill-search index so
                // next discovery rebuilds with the new set.
                clearSkillIndexCache?.()
              } catch (error) {
                const err = errorMessage(error)
                logMCPDebug(
                  client.name,
                  formatListChangedRefreshFailed(
                    client.name,
                    'prompts',
                    err,
                    'full',
                  ),
                )
                logMCPError(
                  client.name,
                  `Failed to refresh prompts after list_changed notification: ${err}`,
                )
                // densable: keeping previous commands — do not updateServer
              }
            }
            client.client.setNotificationHandler(
              'notifications/prompts/list_changed',
              refreshPromptsList,
            )
            registerMcpListenPostReopenHandler(
              client.name,
              'prompts',
              refreshPromptsList,
            )
          }

          if (client.capabilities?.resources?.listChanged) {
            const refreshResourcesList = async () => {
              logMCPDebug(
                client.name,
                `Received resources/list_changed notification, refreshing resources`,
              )
              logEvent('tengu_mcp_list_changed', {
                type: 'resources' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
              // densable #42: partial failure keeps previous for failed fields
              const previousResources =
                store.getState().mcp.resources[client.name] ?? []
              const previousCommands = store
                .getState()
                .mcp.commands.filter(c =>
                  commandBelongsToServer(c, client.name),
                )
              try {
                fetchResourcesForClient.cache.delete(client.name)
                if (feature('MCP_SKILLS')) {
                  // Skills are discovered from resources, so refresh them too.
                  // Invalidate prompts cache as well: we write commands here,
                  // and a concurrent prompts/list_changed could otherwise have
                  // us stomp its fresh result with our cached stale one.
                  fetchMcpSkillsForClient!.cache.delete(client.name)
                  fetchCommandsForClient.cache.delete(client.name)
                  const settled = await Promise.allSettled([
                    fetchResourcesForClient(client),
                    fetchCommandsForClient(client),
                    fetchMcpSkillsForClient!(client),
                  ])
                  const resourcesField =
                    settled[0].status === 'fulfilled'
                      ? {
                          ok: true as const,
                          value: settled[0].value,
                        }
                      : {
                          ok: false as const,
                          error:
                            settled[0].reason instanceof Error
                              ? settled[0].reason.message
                              : String(settled[0].reason),
                        }
                  let commandsField:
                    | { ok: true; value: Command[] }
                    | { ok: false; error: string }
                  if (
                    settled[1].status === 'fulfilled' &&
                    settled[2].status === 'fulfilled'
                  ) {
                    commandsField = {
                      ok: true,
                      value: [...settled[1].value, ...settled[2].value],
                    }
                  } else {
                    const errParts: string[] = []
                    if (settled[1].status === 'rejected') {
                      errParts.push(
                        settled[1].reason instanceof Error
                          ? settled[1].reason.message
                          : String(settled[1].reason),
                      )
                    }
                    if (settled[2].status === 'rejected') {
                      errParts.push(
                        settled[2].reason instanceof Error
                          ? settled[2].reason.message
                          : String(settled[2].reason),
                      )
                    }
                    commandsField = {
                      ok: false,
                      error: errParts.join('; ') || 'commands refresh failed',
                    }
                  }
                  const merged = resolveResourcesListChangedRefresh(
                    {
                      resources: previousResources,
                      commands: previousCommands,
                    },
                    {
                      resources: resourcesField,
                      commands: commandsField,
                    },
                  )
                  if (merged.failedFields.length > 0) {
                    logMCPDebug(
                      client.name,
                      formatListChangedRefreshFailed(
                        client.name,
                        'resources',
                        merged.failedFields.join(','),
                        'partial',
                      ),
                    )
                  }
                  updateServer({
                    ...client,
                    resources: merged.resources,
                    commands: merged.commands,
                  })
                  // MCP skills changed — invalidate skill-search index so
                  // next discovery rebuilds with the new set.
                  if (commandsField.ok) {
                    clearSkillIndexCache?.()
                  }
                } else {
                  const newResources = await fetchResourcesForClient(client)
                  updateServer({ ...client, resources: newResources })
                }
              } catch (error) {
                const err = errorMessage(error)
                logMCPDebug(
                  client.name,
                  formatListChangedRefreshFailed(
                    client.name,
                    'resources',
                    err,
                    'partial',
                  ),
                )
                logMCPError(
                  client.name,
                  `Failed to refresh resources after list_changed notification: ${err}`,
                )
                // densable: keep previous resources/commands — do not updateServer
              }
            }
            client.client.setNotificationHandler(
              'notifications/resources/list_changed',
              refreshResourcesList,
            )
            registerMcpListenPostReopenHandler(
              client.name,
              'resources',
              refreshResourcesList,
            )
          }
          break
        }

        case 'failed': {
          // Official 2.1.327 (#412): trigger slow background reconnect for
          // eligible remote HTTPS servers that fail at startup/reconnect so
          // prolonged outages self-heal automatically.
          startSlowBackgroundReconnectForServer(client.name, client.config, {
            timers: reconnectTimersRef.current,
            getLiveRow: name =>
              store.getState().mcp.clients.find(c => c.name === name),
            onConnectionAttempt,
          })
          break
        }
        case 'needs-auth':
        case 'disabled': {
          bumpReconnectGeneration(reconnectGenerationsRef.current, client.name)
          const pendingTimer = reconnectTimersRef.current.get(client.name)
          if (pendingTimer) {
            clearTimeout(pendingTimer)
            reconnectTimersRef.current.delete(client.name)
          }
          break
        }
        case 'pending':
          break
      }
    },
    [updateServer, dialogStore, requestDialog, setAppState],
  )

  // Initialize all servers to pending state if they don't exist in appState.
  // Re-runs on session change (/clear) and on /reload-plugins (pluginReconnectKey).
  // On plugin reload, also disconnects stale plugin MCP servers (scope 'dynamic')
  // that no longer appear in configs — prevents ghost tools from disabled plugins.
  // Skip claude.ai dedup here to avoid blocking on the network fetch; the connect
  // useEffect below runs immediately after and dedups before connecting.
  const sessionId = getSessionId()
  useEffect(() => {
    async function initializeServersAsPending() {
      const { servers: existingConfigs, errors: mcpErrors } = isStrictMcpConfig
        ? { servers: {}, errors: [] }
        : await getClaudeCodeMcpConfigs(dynamicMcpConfig)
      // Official 2.1.325 #2302: preserve folder-owned (.mcp.json / local)
      // server scopes after folder move / pre-warmed start.
      const configs = mergeFolderOwnedMcpConfigs(
        existingConfigs,
        dynamicMcpConfig,
      )
      for (const name of Object.keys(configs)) {
        removedStalePluginServersRef.current.delete(name)
      }

      // Add MCP errors to plugin errors for UI visibility (deduplicated)
      addErrorsToAppState(setAppState, mcpErrors)

      mcpConnections.reconcileConfiguredServers(
        prevMcp => {
          const { stale, ...mcpWithoutStale } = excludeStalePluginClients(
            prevMcp,
            configs,
            getCwd(),
            getOriginalCwd(),
          )
          const existingServerNames = new Set(
            mcpWithoutStale.clients.map(c => c.name),
          )
          const newClients: MCPServerConnection[] = Object.entries(configs)
            .filter(([name]) => !existingServerNames.has(name))
            .map(([name, config]) => ({
              name,
              type: isMcpServerDisabled(name)
                ? ('disabled' as const)
                : ('pending' as const),
              config,
            }))
          return {
            stale,
            mcpWithoutStale,
            newClients,
          }
        },
        stale => {
          const staleNames = new Set(stale.map(s => s.name))
          // Official 2.1.325 #2303: purge queued pending updates for removed
          // servers so flushPendingUpdates cannot re-add them after removal.
          if (staleNames.size > 0) {
            pendingUpdatesRef.current = pendingUpdatesRef.current.filter(
              u => !staleNames.has(u.name),
            )
          }
          for (const s of stale) {
            if (
              s.config.scope === 'dynamic' ||
              s.config.pluginSource !== undefined
            ) {
              removedStalePluginServersRef.current.add(s.name)
            }
            bumpReconnectGeneration(reconnectGenerationsRef.current, s.name)
            const timer = reconnectTimersRef.current.get(s.name)
            if (timer) {
              clearTimeout(timer)
              reconnectTimersRef.current.delete(s.name)
            }
            if (s.type === 'connected') {
              s.client.onclose = undefined
            }
            // Official 2.1.326 #80: Mark removed server so any concurrent or
            // stale tool call never reconnects to it or reports needs-auth.
            markMcpServerRemovedFromSession(s.name, s.config)
            // Official 2.1.325 #2303: also evict in-flight ('pending') connects
            // from the memo cache so removed plugin servers don't stay listed.
            if (s.type === 'connected' || s.type === 'pending') {
              void clearServerCache(s.name, s.config).catch(() => {})
            }
          }
        },
      )
    }

    void initializeServersAsPending().catch(error => {
      logMCPError(
        'useManageMCPConnections',
        `Failed to initialize servers as pending: ${errorMessage(error)}`,
      )
    })
  }, [
    isStrictMcpConfig,
    dynamicMcpConfig,
    setAppState,
    sessionId,
    _pluginReconnectKey,
  ])

  // Load MCP configs and connect to servers
  // Two-phase loading: Claude Code configs first (fast), then claude.ai configs (may be slow)
  useEffect(() => {
    let cancelled = false

    async function loadAndConnectMcpConfigs() {
      // Clear claude.ai MCP cache so we fetch fresh configs with current auth
      // state. This is important when authVersion changes (e.g., after login/
      // logout). Kick off the fetch now so it overlaps with loadAllPlugins()
      // inside getClaudeCodeMcpConfigs; it's awaited only at the dedup step.
      // Phase 2 below awaits the same promise — no second network call.
      let claudeaiPromise: Promise<Record<string, ScopedMcpServerConfig>>
      if (isStrictMcpConfig || doesEnterpriseMcpConfigExist()) {
        claudeaiPromise = Promise.resolve({})
      } else {
        clearClaudeAIMcpConfigsCache()
        claudeaiPromise = fetchClaudeAIMcpConfigsIfEligible()
      }

      // Phase 1: Load Claude Code configs. Plugin MCP servers that duplicate a
      // --mcp-config entry or a claude.ai connector are suppressed here so they
      // don't connect alongside the connector in Phase 2.
      const { servers: claudeCodeConfigs, errors: mcpErrors } =
        isStrictMcpConfig
          ? { servers: {}, errors: [] }
          : await getClaudeCodeMcpConfigs(dynamicMcpConfig, claudeaiPromise)
      if (cancelled) return

      // Add MCP errors to plugin errors for UI visibility (deduplicated)
      addErrorsToAppState(setAppState, mcpErrors)

      // Official 2.1.325 #2302: preserve folder-owned (.mcp.json / local)
      // server scopes and allow WebSocket (`ws`) configs to connect.
      const configs = mergeFolderOwnedMcpConfigs(
        claudeCodeConfigs,
        dynamicMcpConfig,
      )

      // Official #1040: protect already-registered dynamic/SDK MCP servers
      // from being overwritten later in the session by same-named settings servers.
      const protectedDynamicNames = new Set(
        store
          .getState()
          .mcp.clients.filter(
            c => c.config.scope === 'dynamic' || c.config.type === 'sdk',
          )
          .map(c => c.name),
      )

      // Start connecting to Claude Code servers (don't wait - runs concurrently with Phase 2)
      // Filter out disabled servers to avoid unnecessary connection attempts
      const enabledConfigs = Object.fromEntries(
        Object.entries(configs).filter(
          ([name]) =>
            !isMcpServerDisabled(name) &&
            (!protectedDynamicNames.has(name) ||
              (dynamicMcpConfig !== undefined &&
                Object.hasOwn(dynamicMcpConfig, name))),
        ),
      )
      getMcpToolsCommandsAndResources(
        onConnectionAttempt,
        enabledConfigs,
        getIsNonInteractiveSession(),
      ).catch(error => {
        logMCPError(
          'useManageMcpConnections',
          `Failed to get MCP resources: ${errorMessage(error)}`,
        )
      })

      // Phase 2: Await claude.ai configs (started above; memoized — no second fetch)
      let claudeaiConfigs: Record<string, ScopedMcpServerConfig> = {}
      if (!isStrictMcpConfig) {
        claudeaiConfigs = filterMcpServersByPolicy(
          await claudeaiPromise,
        ).allowed
        if (cancelled) return

        // Suppress claude.ai connectors that duplicate an enabled manual server.
        // Keys never collide (`slack` vs `claude.ai Slack`) so the merge below
        // won't catch this — need content-based dedup by URL signature.
        if (Object.keys(claudeaiConfigs).length > 0) {
          const { servers: dedupedClaudeAi } = dedupClaudeAiMcpServers(
            claudeaiConfigs,
            configs,
          )
          claudeaiConfigs = dedupedClaudeAi
        }

        if (Object.keys(claudeaiConfigs).length > 0) {
          // Add claude.ai servers as pending immediately so they show up in UI
          setAppState(prevState => {
            const existingServerNames = new Set(
              prevState.mcp.clients.map(c => c.name),
            )
            const newClients = Object.entries(claudeaiConfigs)
              .filter(([name]) => !existingServerNames.has(name))
              .map(([name, config]) => ({
                name,
                type: isMcpServerDisabled(name)
                  ? ('disabled' as const)
                  : ('pending' as const),
                config,
              }))
            // Official: this branch only merges claude.ai clients. Do NOT stamp
            // clientsInitialized here — initializeServersAsPending owns that
            // flag. Stamping early lets deferred adopt-resume settle before
            // local/project MCP servers are registered as pending.
            if (newClients.length === 0) {
              return prevState
            }
            return {
              ...prevState,
              mcp: {
                ...prevState.mcp,
                clients: [...prevState.mcp.clients, ...newClients],
              },
            }
          })

          // Now start connecting (only enabled servers)
          const enabledClaudeaiConfigs = Object.fromEntries(
            Object.entries(claudeaiConfigs).filter(
              ([name]) => !isMcpServerDisabled(name),
            ),
          )
          getMcpToolsCommandsAndResources(
            onConnectionAttempt,
            enabledClaudeaiConfigs,
            getIsNonInteractiveSession(),
          ).catch(error => {
            logMCPError(
              'useManageMcpConnections',
              `Failed to get claude.ai MCP resources: ${errorMessage(error)}`,
            )
          })
        }
      }

      // Log server counts after both phases complete
      const allConfigs = { ...configs, ...claudeaiConfigs }
      const counts = {
        enterprise: 0,
        global: 0,
        project: 0,
        user: 0,
        plugin: 0,
        claudeai: 0,
      }
      // Ant-only: collect stdio command basenames to correlate with RSS/FPS
      // metrics. Stdio servers like rust-analyzer can be heavy and we want to
      // know which ones correlate with poor session performance.
      const stdioCommands: string[] = []
      for (const [name, serverConfig] of Object.entries(allConfigs)) {
        if (serverConfig.scope === 'enterprise') counts.enterprise++
        else if (serverConfig.scope === 'user') counts.global++
        else if (serverConfig.scope === 'project') counts.project++
        else if (serverConfig.scope === 'local') counts.user++
        else if (serverConfig.scope === 'dynamic') counts.plugin++
        else if (serverConfig.scope === 'claudeai') counts.claudeai++

        if (
          process.env.USER_TYPE === 'ant' &&
          !isMcpServerDisabled(name) &&
          (serverConfig.type === undefined || serverConfig.type === 'stdio') &&
          'command' in serverConfig
        ) {
          stdioCommands.push(basename(serverConfig.command))
        }
      }
      logEvent('tengu_mcp_servers', {
        ...counts,
        ...(process.env.USER_TYPE === 'ant' && stdioCommands.length > 0
          ? {
              stdio_commands: stdioCommands
                .sort()
                .join(
                  ',',
                ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }
          : {}),
      })
    }

    void loadAndConnectMcpConfigs()

    return () => {
      cancelled = true
    }
  }, [
    isStrictMcpConfig,
    dynamicMcpConfig,
    onConnectionAttempt,
    setAppState,
    _authVersion,
    sessionId,
    _pluginReconnectKey,
  ])

  // Official 2.1.325 #2306 & #2304: register live tool swapper for mid-call
  // reconnects and subscribe to transient OAuth refresh recovery so recovered
  // servers leave needs-auth / failed and restore their tools & mcp_tool hooks.
  useEffect(() => {
    const unregisterSwapper = registerMcpToolsSwapper(
      (serverName, tools, _config, connectedClient) => {
        const current = store
          .getState()
          .mcp.clients.find(c => c.name === serverName)
        if (!current) return false
        updateServer({
          ...(connectedClient ?? current),
          tools,
        })
        return true
      },
    )
    const unregisterAuthRecovered = subscribeMcpAuthRecovered(
      (serverName, _serverConfig) => {
        const current = store
          .getState()
          .mcp.clients.find(c => c.name === serverName)
        if (
          !current ||
          (current.type !== 'needs-auth' && current.type !== 'failed')
        ) {
          return
        }
        void reconnectMcpServerImpl(
          serverName,
          current.config,
          undefined,
          undefined,
          { keepConnectionInUse: true },
        )
          .then(res => {
            if (res.client.type === 'connected') {
              onConnectionAttempt(res)
            }
          })
          .catch(() => {})
      },
    )
    return () => {
      unregisterSwapper()
      unregisterAuthRecovered()
    }
  }, [store, updateServer, onConnectionAttempt])

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = reconnectTimersRef.current
    const generations = reconnectGenerationsRef.current
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
      for (const serverName of generations.keys()) {
        bumpReconnectGeneration(generations, serverName)
      }
      // Flush any pending batched MCP updates before unmount
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
        flushPendingUpdates()
      }
    }
  }, [flushPendingUpdates])

  // Expose reconnectMcpServer function for components to use.
  // Reads mcp.clients via store.getState() so this callback stays stable
  // across client state transitions (no need to re-create on every connect).
  const reconnectMcpServer = useCallback(
    async (serverName: string) => {
      const client = store
        .getState()
        .mcp.clients.find(c => c.name === serverName)
      if (!client) {
        throw new Error(`MCP server ${serverName} not found`)
      }

      // Cancel any pending or in-flight automatic reconnection attempt
      bumpReconnectGeneration(reconnectGenerationsRef.current, serverName)
      const existingTimer = reconnectTimersRef.current.get(serverName)
      if (existingTimer) {
        clearTimeout(existingTimer)
        reconnectTimersRef.current.delete(serverName)
      }

      const result = await reconnectMcpServerImpl(serverName, client.config)

      onConnectionAttempt(result)

      // Don't throw, just let UI handle the client type in case the reconnect failed
      // (Detailed logs are within the reconnectMcpServerImpl via --debug)
      return result
    },
    [store, onConnectionAttempt],
  )

  // Expose function to toggle server enabled/disabled state
  const toggleMcpServer = useCallback(
    async (serverName: string): Promise<void> => {
      const client = store
        .getState()
        .mcp.clients.find(c => c.name === serverName)
      if (!client) {
        throw new Error(`MCP server ${serverName} not found`)
      }

      const isCurrentlyDisabled = client.type === 'disabled'

      // Supersede any pending or in-flight automatic reconnection attempt
      bumpReconnectGeneration(reconnectGenerationsRef.current, serverName)
      const existingTimer = reconnectTimersRef.current.get(serverName)
      if (existingTimer) {
        clearTimeout(existingTimer)
        reconnectTimersRef.current.delete(serverName)
      }

      if (!isCurrentlyDisabled) {
        // Persist disabled state to disk FIRST before clearing cache
        // This is important because the onclose handler checks disk state
        setMcpServerEnabled(serverName, false)

        // Disabling: disconnect and clean up if currently connected
        if (client.type === 'connected') {
          await clearServerCache(serverName, client.config)
        }

        // Update to disabled state (tools/commands/resources auto-cleared)
        updateServer({
          name: serverName,
          type: 'disabled',
          config: client.config,
        })
      } else {
        // Enabling: persist enabled state to disk first
        setMcpServerEnabled(serverName, true)

        // Mark as pending and reconnect
        updateServer({
          name: serverName,
          type: 'pending',
          config: client.config,
        })

        // Reconnect the server
        const result = await reconnectMcpServerImpl(serverName, client.config)

        onConnectionAttempt(result)
      }
    },
    [store, updateServer, onConnectionAttempt],
  )

  return { reconnectMcpServer, toggleMcpServer }
}

function getTransportDisplayName(type: string): string {
  switch (type) {
    case 'http':
      return 'HTTP'
    case 'ws':
    case 'ws-ide':
      return 'WebSocket'
    default:
      return 'SSE'
  }
}
