import { getStrictMcpConfig } from '../../bootstrap/state.js'
import { logEvent } from '../analytics/index.js'
import { logForDebugging } from '../../utils/debug.js'
import { isBareMode } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { clearMcpAuthCache, mcpClientModule } from './client.js'
import {
  clearClaudeAIMcpConfigsCache,
  fetchClaudeAIMcpConfigsIfEligible,
} from './claudeai.js'
import {
  dedupClaudeAiMcpServers,
  getClaudeCodeMcpConfigs,
  getMcpConfigByName,
  getMcpServerSignature,
  isMcpServerAllowedByPolicy,
  shouldSuppressClaudeAiMcps,
} from './config.js'
import {
  applyHeadlessMcpSettlement,
  mcpSlotSignature,
  unrefSleep,
  type HeadlessMcpReconnectDeps,
  type McpSettlement,
} from './headlessMcpReconnect.js'
import {
  ensureMcpAccountIdentityResolver,
  getMcpIdentityEpoch,
  isMcpIdentityBoundaryEnabled,
  mcpConfigDependsOnAccountIdentity,
  mcpIdentityChangedSinceLastCheck,
  resolveMcpAccountIdentity,
} from './mcpIdentity.js'
import { getMcpPrefix } from './mcpStringUtils.js'
import type { MCPServerConnection, ScopedMcpServerConfig } from './types.js'
import {
  commandBelongsToServer,
  omitMcpServerEntries,
  toolBelongsToServer,
} from './utils.js'

const CONFIG_FILE_SCOPES = new Set([
  'enterprise',
  'managed',
  'local',
  'user',
  'project',
])
const RETRYABLE_REMOTE_TYPES = new Set(['http', 'sse', 'claudeai-proxy'])
const RETRYABLE_CODES = new Set([
  '500',
  '502',
  '503',
  '504',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTFOUND',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ConnectionRefused',
  'ConnectionClosed',
  'FailedToOpenSocket',
  'ERR_SOCKET_CLOSED',
  'ERR_PROXY_TUNNEL',
  '23',
  'CLI_OWNED_BEARER_REJECTED',
  'HEADERS_HELPER_AUTH_REJECTED',
  'CONNECT_TIMEOUT',
])
export const MCP_IDENTITY_RETRY_DELAYS_MS = [500, 1500, 4000] as const

export function isRetryableRemoteMcpFailure(row: MCPServerConnection): boolean {
  if (
    row.type !== 'failed' ||
    !RETRYABLE_REMOTE_TYPES.has(row.config.type ?? '')
  )
    return false
  return row.errorCode !== undefined
    ? RETRYABLE_CODES.has(row.errorCode)
    : row.config.type === 'sse'
}

/** Gold Ypr: an explicit host entry wins, including explicit removal. */
export function resolveIdentityBoundaryMcpConfig(
  name: string,
  hostConfigs: Record<string, ScopedMcpServerConfig | null>,
  previous: ScopedMcpServerConfig | undefined,
  readConfig: (
    name: string,
  ) => ScopedMcpServerConfig | null = getMcpConfigByName,
): ScopedMcpServerConfig | null {
  if (Object.hasOwn(hostConfigs, name)) return hostConfigs[name] ?? null
  if (previous && !CONFIG_FILE_SCOPES.has(previous.scope)) return previous
  return readConfig(name)
}

export type HeadlessMcpIdentityBoundaryDeps = HeadlessMcpReconnectDeps & {
  getHostOwnedConfigs?: () => Record<string, ScopedMcpServerConfig | null>
  clientModule?: Pick<
    ReturnType<typeof mcpClientModule>,
    | 'disposeServerConnectionDetached'
    | 'evictAllMcpMemosOnIdentityChange'
    | 'discardMemoizedConnectResult'
    | 'getMcpToolsCommandsAndResources'
  >
  clearNeedsAuth?: () => void
  clearConnectorConfigs?: () => void
  fetchConnectorConfigs?: () => Promise<Record<string, ScopedMcpServerConfig>>
  readConfig?: (name: string) => ScopedMcpServerConfig | null
  readInstalledConfigs?: () => Promise<Record<string, ScopedMcpServerConfig>>
}

/** Gold W8t: own the identity transition once per headless session. */
export function createHeadlessMcpIdentityBoundary(
  deps: HeadlessMcpIdentityBoundaryDeps,
): {
  refresh: (options?: {
    force?: boolean
    spareUnchangedFrom?: ReadonlySet<MCPServerConnection>
  }) => Promise<void> | undefined
  dispose: () => void
} {
  let connectorMountInFlight: Promise<void> | undefined
  let disposed = false
  const module = () => deps.clientModule ?? mcpClientModule()
  const rows = () => [
    ...deps.getAppState().mcp.clients,
    ...deps.getDynamicMcpState().clients,
  ]
  const install = (settlement: McpSettlement): void => {
    if (disposed || deps.isRunEnding()) {
      if (settlement.client.type === 'connected') {
        void (deps.mcpClient ?? mcpClientModule())
          .detachAndCloseConnection(settlement.client)
          .catch(() => {})
      }
      return
    }
    applyHeadlessMcpSettlement(deps, settlement.client.name, settlement)
    if (
      settlement.client.type === 'connected' &&
      rows().includes(settlement.client)
    ) {
      deps.onReconnected(settlement.client)
    }
  }
  const retry = async (
    configs: Record<string, ScopedMcpServerConfig>,
  ): Promise<void> => {
    const epoch = getMcpIdentityEpoch()
    const started = performance.now()
    const candidates = () =>
      Object.entries(configs).filter(([name, config]) => {
        const row = rows().find(entry => entry.name === name)
        return (
          row !== undefined &&
          isRetryableRemoteMcpFailure(row) &&
          mcpSlotSignature(name, row.config) === mcpSlotSignature(name, config)
        )
      })
    if (candidates().length === 0) return
    for (const [index, delay] of MCP_IDENTITY_RETRY_DELAYS_MS.entries()) {
      await (deps.sleep ?? unrefSleep)(delay)
      if (disposed || deps.isRunEnding() || getMcpIdentityEpoch() !== epoch)
        return
      const pending = candidates()
      if (pending.length === 0) return
      const dial: Record<string, ScopedMcpServerConfig> = {}
      for (const [name, config] of pending) {
        if (!(await module().discardMemoizedConnectResult(name, config)))
          continue
        if (!isMcpServerAllowedByPolicy(name, config)) {
          install({
            client: {
              name,
              type: 'failed',
              config,
              error: 'MCP server blocked by policy',
              errorCode: 'POLICY_BLOCKED',
            },
            tools: [],
            commands: [],
            attemptEpoch: epoch,
          })
          continue
        }
        dial[name] = config
      }
      if (Object.keys(dial).length === 0) continue
      let recovered = 0
      let stillRetryable = 0
      const sincePassStartMs = Math.round(performance.now() - started)
      await module().getMcpToolsCommandsAndResources(settlement => {
        install(settlement)
        if (settlement.client.type === 'connected') recovered++
        else if (isRetryableRemoteMcpFailure(settlement.client))
          stillRetryable++
      }, dial)
      if (!disposed && !deps.isRunEnding()) {
        logEvent('tengu_mcp_connect_retry_attempt', {
          attempt: index + 1,
          delayMs: delay,
          sincePassStartMs,
          retryable: pending.length,
          dialed: Object.keys(dial).length,
          recovered,
          stillRetryable,
        })
      }
      if (candidates().length === 0) return
    }
  }
  const refresh = (
    options: {
      force?: boolean
      spareUnchangedFrom?: ReadonlySet<MCPServerConnection>
    } = {},
  ): Promise<void> | undefined => {
    if (disposed || !isMcpIdentityBoundaryEnabled()) return
    ensureMcpAccountIdentityResolver()
    ;(deps.clearNeedsAuth ?? clearMcpAuthCache)()
    if (!mcpIdentityChangedSinceLastCheck() && !options.force)
      return connectorMountInFlight
    const mayRedial =
      !options.force || resolveMcpAccountIdentity().kind === 'resolved'
    const dynamic = deps.getDynamicMcpState()
    const currentRows = rows()
    const spareNames = new Set<string>()
    if (options.spareUnchangedFrom) {
      for (const row of currentRows) spareNames.add(row.name)
      for (const row of currentRows) {
        if (!options.spareUnchangedFrom.has(row) || row.type === 'pending')
          spareNames.delete(row.name)
      }
    }
    const regularNames = new Set<string>()
    const connectorNames = new Set<string>()
    const keep = new Set<string>()
    for (const row of currentRows) {
      if (
        !mcpConfigDependsOnAccountIdentity(row.config) ||
        spareNames.has(row.name)
      ) {
        keep.add(mcpSlotSignature(row.name, row.config))
        // Local discovery caches use the semantic server name as their memo key.
        keep.add(row.name)
        continue
      }
      module().disposeServerConnectionDetached(row.name, row.config)
      if (row.config.scope === 'claudeai') connectorNames.add(row.name)
      else if (row.type !== 'disabled') regularNames.add(row.name)
    }
    module().evictAllMcpMemosOnIdentityChange(
      keep,
      currentRows.some(row => mcpConfigDependsOnAccountIdentity(row.config)),
    )
    const hostConfigs = deps.getHostOwnedConfigs?.() ?? dynamic.configs ?? {}
    const configs: Record<string, ScopedMcpServerConfig> = Object.create(null)
    for (const row of currentRows) {
      if (!regularNames.has(row.name) || !mayRedial) continue
      const config =
        configs[row.name] ??
        resolveIdentityBoundaryMcpConfig(
          row.name,
          hostConfigs,
          row.config,
          deps.readConfig,
        )
      if (config) configs[row.name] ??= config
    }
    const refused = new Map<string, MCPServerConnection>()
    for (const [name, config] of Object.entries(configs)) {
      if (!isMcpServerAllowedByPolicy(name, config)) {
        refused.set(name, {
          name,
          type: 'failed',
          config,
          error: 'MCP server blocked by policy',
          errorCode: 'POLICY_BLOCKED',
        })
        delete configs[name]
      }
    }
    const removedNames = [...regularNames, ...connectorNames]
    const replaceRows = (
      clients: MCPServerConnection[],
    ): MCPServerConnection[] =>
      clients.flatMap(row => {
        if (connectorNames.has(row.name)) return []
        if (!regularNames.has(row.name)) return [row]
        if (
          !mayRedial ||
          (!Object.hasOwn(configs, row.name) && !refused.has(row.name))
        ) {
          return [
            {
              name: row.name,
              type: 'failed',
              config: row.config,
              error: 'Account changed while connecting - reconnect to use it',
              errorCode: 'IDENTITY_CHANGED',
            },
          ]
        }
        return [
          refused.get(row.name) ?? {
            name: row.name,
            type: 'pending',
            config: configs[row.name]!,
          },
        ]
      })
    const affectedTool = (tool: Parameters<typeof toolBelongsToServer>[0]) =>
      removedNames.some(name =>
        toolBelongsToServer(tool, name, getMcpPrefix(name)),
      )
    if (removedNames.length > 0) {
      deps.setAppState(prev => ({
        ...prev,
        mcp: {
          ...prev.mcp,
          clients: replaceRows(prev.mcp.clients),
          tools: prev.mcp.tools.filter(tool => !affectedTool(tool)),
          commands: prev.mcp.commands.filter(
            command =>
              !removedNames.some(name => commandBelongsToServer(command, name)),
          ),
          resources: omitMcpServerEntries(prev.mcp.resources, removedNames),
          resourceTemplates: omitMcpServerEntries(
            prev.mcp.resourceTemplates,
            removedNames,
          ),
        },
      }))
      deps.setDynamicMcpState({
        ...dynamic,
        clients: replaceRows(dynamic.clients),
        tools: dynamic.tools.filter(tool => !affectedTool(tool)),
      })
    }
    const syncsClaudeAiConnectors =
      !getStrictMcpConfig() && !shouldSuppressClaudeAiMcps() && !isBareMode()
    if (syncsClaudeAiConnectors && mayRedial) {
      ;(deps.clearConnectorConfigs ?? clearClaudeAIMcpConfigsCache)()
      const epoch = getMcpIdentityEpoch()
      const mounted = (
        deps.fetchConnectorConfigs ?? fetchClaudeAIMcpConfigsIfEligible
      )()
        .then(async connectors => {
          if (disposed || epoch !== getMcpIdentityEpoch()) return
          const allowed = Object.fromEntries(
            Object.entries(connectors).filter(([name, config]) =>
              isMcpServerAllowedByPolicy(name, config),
            ),
          )
          const suppressedBefore =
            deps.getAppState().mcp.suppressedPluginMcpServers ?? []
          const restorable: Record<string, ScopedMcpServerConfig> = {}
          if (suppressedBefore.length > 0) {
            const installed = deps.readInstalledConfigs
              ? await deps.readInstalledConfigs()
              : (await getClaudeCodeMcpConfigs({})).servers
            for (const { name } of suppressedBefore) {
              const config = installed[name]
              if (config?.pluginSource !== undefined) restorable[name] = config
            }
          }
          if (disposed || epoch !== getMcpIdentityEpoch()) return
          const regular = {
            ...restorable,
            ...Object.fromEntries(
              rows()
                .filter(row => row.config.scope !== 'claudeai')
                .map(row => [row.name, row.config]),
            ),
          }
          const connectorSignatures = new Set(
            Object.values(allowed)
              .map(config => getMcpServerSignature(config))
              .filter(signature => signature !== null),
          )
          const suppressedPlugins = new Set(
            Object.entries(regular)
              .filter(
                ([name, config]) =>
                  name.startsWith('plugin:') &&
                  connectorSignatures.has(getMcpServerSignature(config) ?? ''),
              )
              .map(([name]) => name),
          )
          for (const row of rows()) {
            if (
              suppressedPlugins.has(row.name) &&
              (row.type === 'connected' || row.type === 'pending')
            ) {
              module().disposeServerConnectionDetached(row.name, row.config)
            }
          }
          const deduped = dedupClaudeAiMcpServers(
            allowed,
            Object.fromEntries(
              Object.entries(regular).filter(
                ([name]) => !name.startsWith('plugin:'),
              ),
            ),
          )
          const restore = Object.fromEntries(
            Object.entries(restorable).filter(
              ([name]) =>
                !suppressedPlugins.has(name) &&
                !rows().some(row => row.name === name),
            ),
          )
          const mount = { ...restore, ...deduped.servers }
          const suppressedNames = [...suppressedPlugins]
          const filterTools = <
            T extends Parameters<typeof toolBelongsToServer>[0],
          >(
            tools: readonly T[],
          ): T[] =>
            tools.filter(
              tool =>
                !suppressedNames.some(name =>
                  toolBelongsToServer(tool, name, getMcpPrefix(name)),
                ),
            )
          deps.setAppState(prev => ({
            ...prev,
            mcp: {
              ...prev.mcp,
              clients: [
                ...prev.mcp.clients.filter(
                  row => !suppressedPlugins.has(row.name),
                ),
                ...Object.entries(mount)
                  .filter(
                    ([name]) =>
                      !prev.mcp.clients.some(row => row.name === name),
                  )
                  .map(([name, config]) => ({
                    name,
                    config,
                    type: 'pending' as const,
                  })),
              ],
              tools: filterTools(prev.mcp.tools),
              commands: prev.mcp.commands.filter(
                command =>
                  !suppressedNames.some(name =>
                    commandBelongsToServer(command, name),
                  ),
              ),
              resources: omitMcpServerEntries(
                prev.mcp.resources,
                suppressedNames,
              ),
              resourceTemplates: omitMcpServerEntries(
                prev.mcp.resourceTemplates,
                suppressedNames,
              ),
              suppressedPluginMcpServers: suppressedNames.map(name => {
                const signature = getMcpServerSignature(regular[name]!)
                const duplicateOf = Object.entries(allowed).find(
                  ([, config]) => getMcpServerSignature(config) === signature,
                )?.[0]
                return { name, duplicateOf: duplicateOf! }
              }),
              suppressedClaudeAiConnectors: deduped.suppressed,
            },
          }))
          const dynamic = deps.getDynamicMcpState()
          deps.setDynamicMcpState({
            ...dynamic,
            clients: dynamic.clients.filter(
              row => !suppressedPlugins.has(row.name),
            ),
            tools: filterTools(dynamic.tools),
          })
          void module()
            .getMcpToolsCommandsAndResources(install, mount)
            .catch(error =>
              logForDebugging(
                `MCP connector reconnect failed: ${errorMessage(error)}`,
                { level: 'warn' },
              ),
            )
        })
        .catch(error =>
          logForDebugging(
            `MCP connector refetch after account switch failed: ${errorMessage(error)}`,
            { level: 'warn' },
          ),
        )
        .finally(() => {
          if (connectorMountInFlight === mounted)
            connectorMountInFlight = undefined
        })
      connectorMountInFlight = mounted
    }
    if (regularNames.size > 0 && mayRedial) {
      void module()
        .getMcpToolsCommandsAndResources(install, configs)
        .catch(error => {
          logForDebugging(
            `MCP re-dial after account switch failed: ${errorMessage(error)}`,
            { level: 'warn' },
          )
        })
        .finally(() => {
          void retry(configs).catch(error =>
            logForDebugging(
              `MCP re-dial retry after account switch failed: ${errorMessage(error)}`,
              { level: 'warn' },
            ),
          )
        })
    }
    return connectorMountInFlight
  }
  return {
    refresh,
    dispose: () => {
      disposed = true
      connectorMountInFlight = undefined
    },
  }
}
