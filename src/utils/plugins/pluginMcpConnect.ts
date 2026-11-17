import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import { getMcpTimeoutMs } from '../../services/mcp/mcpConnectTimeout.js'
import type {
  PluginMcpConnection,
  PluginMcpRefusal,
  PluginMcpResolution,
} from './pluginToolSessionHost.js'

type PluginMcpRow = {
  name: string
  type: string
  error?: string
  config?: ScopedMcpServerConfig
}

type PluginMcpRowsHost = {
  rows: () => readonly PluginMcpRow[]
  subscribe: (listener: () => void) => () => void
}

function pluginMcpWaitTimeoutMs(): number {
  return Math.min(getMcpTimeoutMs() * 4, 2_147_483_647)
}

function waitForPluginMcpRow(
  host: PluginMcpRowsHost,
  name: string,
  isSettled: (row: PluginMcpRow | undefined) => boolean,
): Promise<void> {
  return new Promise(resolve => {
    let unsubscribe = () => {}
    const timer = setTimeout(() => {
      unsubscribe()
      resolve()
    }, pluginMcpWaitTimeoutMs())
    timer.unref?.()
    const check = () => {
      if (isSettled(host.rows().find(entry => entry.name === name))) {
        clearTimeout(timer)
        unsubscribe()
        resolve()
      }
    }
    unsubscribe = host.subscribe(check)
    check()
  })
}

/** densable Css/zCt — retry owned failures, preserve existing usable rows. */
export async function connectPluginMcpServer(
  host: PluginMcpRowsHost & {
    holds: (name: string) => boolean
    drop: (name: string) => void
    forget: (
      name: string,
      config: ScopedMcpServerConfig | undefined,
    ) => void | Promise<void>
    add: (name: string, config: ScopedMcpServerConfig) => void
  },
  name: string,
  config: ScopedMcpServerConfig,
): Promise<PluginMcpConnection> {
  const previous = host.rows().find(row => row.name === name)
  if (previous?.type === 'failed' && host.holds(name)) {
    host.drop(name)
    await waitForPluginMcpRow(host, name, row => row !== previous)
    if (!host.rows().some(row => row.name === name)) {
      await host.forget(name, previous.config)
    }
  }
  const row = host.rows().find(entry => entry.name === name)
  const settled = row && pluginMcpConnectionFromRow(row)
  if (settled) return settled
  if (row === undefined) host.add(name, config)
  await waitForPluginMcpRow(
    host,
    name,
    current => current !== undefined && current.type !== 'pending',
  )
  const current = host.rows().find(entry => entry.name === name)
  return (
    (current && pluginMcpConnectionFromRow(current)) ?? {
      isConnected: false,
      refused: 'failed',
      message: `The MCP server "${name}" is still connecting after ${pluginMcpWaitTimeoutMs()}ms; it stays in the session.`,
    }
  )
}

/** densable iLt — a cached row is already usable by the session. */
export function pluginMcpConnectionFromRow(
  row: PluginMcpRow,
): PluginMcpConnection | undefined {
  switch (row.type) {
    case 'connected':
    case 'cached':
      return { isConnected: true }
    case 'needs-auth':
      return {
        isConnected: false,
        refused: 'auth',
        message: `The MCP server "${row.name}" needs you to sign in; run /mcp to authenticate.`,
      }
    case 'failed':
      return {
        isConnected: false,
        refused: 'failed',
        message: `The MCP server "${row.name}" did not connect: ${row.error ?? 'no reason given'}.`,
      }
    case 'disabled':
      return {
        isConnected: false,
        refused: 'failed',
        message: `The MCP server "${row.name}" is turned off in this session.`,
      }
    default:
      return undefined
  }
}

/** densable PB/CHr/sV — share the real row subscription across both hosts. */
export async function awaitPluginMcpServer(
  host: {
    rows: () => readonly PluginMcpRow[]
    subscribe: (listener: () => void) => () => void
  },
  name: string,
): Promise<PluginMcpConnection> {
  const timeoutMs = pluginMcpWaitTimeoutMs()
  await waitForPluginMcpRow(
    host,
    name,
    row => row === undefined || row.type !== 'pending',
  )
  const row = host.rows().find(entry => entry.name === name)
  return (
    (row && pluginMcpConnectionFromRow(row)) ?? {
      isConnected: false,
      refused: 'failed',
      message:
        row === undefined
          ? `The MCP server "${name}" is not in this session.`
          : `The MCP server "${name}" did not connect within ${timeoutMs}ms.`,
    }
  )
}

function refuse(
  refused: PluginMcpRefusal,
  message: string,
): PluginMcpResolution {
  return { isListed: false, refused, message }
}

/** densable 2.1.289 D9t/pr — manifest resolution before connection. */
export async function resolvePluginMcpServer(input: {
  pluginId: string
  key: string
  dynamicServers?: Record<string, ScopedMcpServerConfig>
}): Promise<PluginMcpResolution> {
  const { loadAllPluginsCacheOnly } = await import('./pluginLoader.js')
  const { enabled } = await loadAllPluginsCacheOnly()
  const plugin = enabled.find(entry => entry.source === input.pluginId)
  if (!plugin) return unlisted(input.key)
  return resolveLoadedPluginMcpServer(plugin, input)
}

function unlisted(key: string): PluginMcpResolution {
  return refuse(
    'unlisted',
    `This plugin's manifest lists no MCP server named "${key}".`,
  )
}

/** The loaded plugin is passed separately so builtin and cached loads share pr. */
export async function resolveLoadedPluginMcpServer(
  plugin: LoadedPlugin,
  input: {
    key: string
    dynamicServers?: Record<string, ScopedMcpServerConfig>
  },
): Promise<PluginMcpResolution> {
  const { externalBuiltinNamespaceName, getBuiltinPluginDefinition } =
    await import('../../plugins/builtinPlugins.js')
  const { getPluginMcpServers } = await import('./mcpPluginIntegration.js')
  const name = `plugin:${externalBuiltinNamespaceName(plugin.name, plugin.source)}:${input.key}`
  const errors: PluginError[] = []
  const builtinServers = plugin.isBuiltin
    ? getBuiltinPluginDefinition(plugin.name)?.mcpServers
    : undefined
  const servers =
    plugin.isBuiltin && builtinServers === undefined
      ? undefined
      : await getPluginMcpServers(
          plugin.isBuiltin ? { ...plugin, mcpServers: builtinServers } : plugin,
          errors,
        )
  const config = servers?.[name]
  if (!config) {
    const error = errors.find(entry => entry.source === input.key)
    return error
      ? refuse(
          'failed',
          `The MCP server "${name}" cannot be resolved: ${getPluginErrorMessage(error)}`,
        )
      : unlisted(input.key)
  }
  if ('configError' in config && config.configError !== undefined) {
    return refuse(
      'failed',
      `The MCP server "${name}" cannot be resolved: ${String(config.configError)}`,
    )
  }
  // gold VF: only a project skills-dir plugin asks the repository MCP choice.
  if (
    'scope' in plugin &&
    plugin.scope === 'project' &&
    plugin.source.endsWith('@skills-dir')
  ) {
    const { getProjectMcpServerStatus } = await import(
      '../../services/mcp/utils.js'
    )
    const status = getProjectMcpServerStatus(name)
    if (status !== 'approved') {
      return refuse(
        'unapproved',
        status === 'rejected'
          ? `The MCP server "${name}" comes with this repository and you rejected it; \`claude mcp reset-project-choices\` asks again.`
          : `The MCP server "${name}" comes with this repository and waits for your approval in /mcp.`,
      )
    }
  }
  const {
    isMcpServerDisabled,
    doesEnterpriseMcpConfigExist,
    filterMcpServersByPolicy,
    getClaudeCodeMcpConfigs,
  } = await import('../../services/mcp/config.js')
  if (isMcpServerDisabled(name)) {
    return refuse(
      'disabled',
      `The MCP server "${name}" is turned off; turn it on in /mcp.`,
    )
  }
  const { isSafeModeEnabled } = await import('../safeMode.js')
  const { isBareMode } = await import('../envUtils.js')
  const { getStrictMcpConfig, getIsRemoteMode } = await import(
    '../../bootstrap/state.js'
  )
  const modeMessage = isSafeModeEnabled()
    ? 'This session runs in safe mode, which connects no plugin servers.'
    : isBareMode()
      ? 'This session runs with --bare, which connects no plugin servers.'
      : getStrictMcpConfig()
        ? 'This session runs with --strict-mcp-config, which connects no plugin servers.'
        : getIsRemoteMode()
          ? 'This session is a remote client, which connects no plugin servers.'
          : doesEnterpriseMcpConfigExist()
            ? "Your organization's managed MCP config has exclusive control over MCP servers in this session."
            : undefined
  if (modeMessage) return refuse('policy', modeMessage)
  if (filterMcpServersByPolicy({ [name]: config }).blocked.length > 0) {
    return refuse(
      'policy',
      `Your organization's MCP policy does not allow "${name}".`,
    )
  }
  const dynamicServers = Object.fromEntries(
    Object.entries(input.dynamicServers ?? {}).filter(([key]) => key !== name),
  )
  const { errors: configErrors } = await getClaudeCodeMcpConfigs(dynamicServers)
  const duplicate = configErrors.find(
    entry =>
      entry.type === 'mcp-server-suppressed-duplicate' && entry.source === name,
  )
  if (duplicate?.type === 'mcp-server-suppressed-duplicate') {
    return { isListed: true, isTwin: true, name: duplicate.duplicateOf }
  }
  return { isListed: true, isTwin: false, name, config }
}
