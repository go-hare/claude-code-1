/**
 * densable 2.1.221 #30 — activate plugins after /plugin install when safe.
 *
 * SEA gold (`Bnm` / `zQS` / `swn` / `hDs`):
 * - `wouldInvalidateCache` = plugin-MCP set changes AND tool-search OFF AND
 *   session already has output tokens (`XE()>0`). When true → do NOT hot-reload;
 *   set `needsRefresh` and ask for `/reload-plugins` (cache_impact).
 * - Otherwise call `refreshActivePlugins` (Layer-3). On load errors for the
 *   just-installed ids → load-failed; on throw → refresh_failed + needsRefresh.
 * - Outcomes: `activated` | `load-failed` | `reload-required`
 * - Analytics: `tengu_plugin_install_auto_activate` + `plugin_install_auto_activate`
 *
 * Changelog phrase "activate immediately when safe" has no SEA string; product
 * surface is this gate + UI suffixes ("Plugin is now active." / reload notice).
 */

import { getTotalOutputTokens } from '../../bootstrap/state.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../services/analytics/index.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import type { AppState } from '../../state/AppState.js'
import type { PluginError } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { logError } from '../log.js'
import { isToolSearchEnabledForModel } from '../searchExtraTools.js'
import { extractMcpServersFromPlugins } from './mcpPluginIntegration.js'
import { loadAllPlugins } from './pluginLoader.js'
import { refreshActivePlugins } from './refresh.js'

type SetAppState = (f: (prev: AppState) => AppState) => void

export type PluginInstallAutoActivateOutcome =
  | 'activated'
  | 'load-failed'
  | 'reload-required'

export type PluginReloadCacheImpact = {
  mcpServersAdded: string[]
  mcpServersRemoved: string[]
  toolSearchEnabled: boolean
  wouldInvalidateCache: boolean
}

export type ActivatePluginsAfterInstallContext = {
  model: string
  mcpClients: readonly MCPServerConnection[]
  /** Optional dynamic MCP overlay (same role as densable swn.dynamicMcpConfig). */
  dynamicMcpConfig?: Record<string, { pluginSource?: string } | undefined>
}

/**
 * densable `swn` — predict whether Layer-3 reload would bust prompt cache.
 * Cache impact only when plugin MCP set changes, tool search is off, and the
 * session already spent output tokens.
 */
export async function assessPluginReloadCacheImpact(
  ctx: ActivatePluginsAfterInstallContext,
): Promise<PluginReloadCacheImpact> {
  const currentPluginMcp = new Set(
    ctx.mcpClients
      .filter(c => c.config.pluginSource !== undefined)
      .map(c => c.name),
  )

  const projected = await listProjectedPluginMcpServerNames(
    ctx.dynamicMcpConfig,
  )
  // densable swn: Y4()&&Xve(model)&&!Jve(model) — tool-search absorbs MCP
  // tool-set churn so hot-activate is safe even with spent output tokens.
  const toolSearchEnabled = isToolSearchEnabledForModel(ctx.model)
  // densable XE() = sum outputTokens
  const hasConversationTokens = getTotalOutputTokens() > 0

  // Projection failure: cannot know MCP delta — refuse hot-activate when
  // tokens already spent and tool-search is not absorbing churn.
  if (projected === null) {
    const wouldInvalidateCache = !toolSearchEnabled && hasConversationTokens
    return {
      mcpServersAdded: [],
      mcpServersRemoved: [],
      toolSearchEnabled,
      wouldInvalidateCache,
    }
  }

  const mcpServersAdded = [...projected]
    .filter(name => !currentPluginMcp.has(name))
    .sort()
  const mcpServersRemoved = [...currentPluginMcp]
    .filter(name => !projected.has(name))
    .sort()
  const mcpChanged = mcpServersAdded.length > 0 || mcpServersRemoved.length > 0

  const wouldInvalidateCache =
    mcpChanged && !toolSearchEnabled && hasConversationTokens

  return {
    mcpServersAdded,
    mcpServersRemoved,
    toolSearchEnabled,
    wouldInvalidateCache,
  }
}

/**
 * densable `hDs` — projected plugin MCP server names after disk load.
 * On load/extract failure: return `null` so assess can treat as
 * conservative cache_impact (do not hot-activate on unknown projection).
 */
async function listProjectedPluginMcpServerNames(
  dynamicMcpConfig?: Record<string, { pluginSource?: string } | undefined>,
): Promise<Set<string> | null> {
  const names = new Set<string>()
  if (dynamicMcpConfig) {
    for (const [name, cfg] of Object.entries(dynamicMcpConfig)) {
      if (cfg?.pluginSource !== undefined) names.add(name)
    }
  }
  try {
    const { enabled } = await loadAllPlugins()
    const errors: PluginError[] = []
    const servers = await extractMcpServersFromPlugins(enabled, errors)
    for (const name of Object.keys(servers)) names.add(name)
  } catch (err) {
    logForDebugging(
      `listProjectedPluginMcpServerNames failed: ${errorMessage(err)}`,
      { level: 'warn' },
    )
    return null
  }
  return names
}

function pluginIdFromError(error: PluginError): string | undefined {
  if ('pluginId' in error && typeof error.pluginId === 'string') {
    return error.pluginId
  }
  if ('plugin' in error && typeof error.plugin === 'string') {
    return error.plugin
  }
  if (error.source.includes('@')) return error.source
  return undefined
}

/** densable `VQS` — does this load error concern one of the just-installed ids? */
export function errorConcernsInstalledPlugin(
  error: PluginError,
  installedPluginIds: readonly string[],
): boolean {
  // densable skips orphan-marked errors (`"orphan"in e&&e.orphan`)
  if (
    'orphan' in (error as object) &&
    Boolean((error as { orphan?: boolean }).orphan)
  ) {
    return false
  }
  const id = pluginIdFromError(error)
  if (!id) return false
  if (id.includes('@')) {
    return installedPluginIds.includes(id)
  }
  return installedPluginIds.some(installed => {
    const bare = installed.includes('@') ? installed.split('@')[0]! : installed
    return bare === id
  })
}

/**
 * densable `Bnm`/`zQS` — try Layer-3 activate after install when safe.
 */
export async function activatePluginsAfterInstall(
  getContext: () => ActivatePluginsAfterInstallContext,
  setAppState: SetAppState,
  installedPluginIds: readonly string[],
): Promise<PluginInstallAutoActivateOutcome> {
  const reason = await tryActivatePluginsAfterInstall(
    getContext,
    setAppState,
    installedPluginIds,
  )

  logEvent('tengu_plugin_install_auto_activate', {
    activated: reason === null,
    ...(reason !== null && {
      reason:
        reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
  })
  // Product counter name densable also emits (Se/Me/fe variants).
  logForDebugging(
    `plugin_install_auto_activate: ${reason === null ? 'activated' : reason}`,
  )

  if (reason === null) return 'activated'
  if (reason === 'plugin_load_error') return 'load-failed'

  setAppState(prev =>
    prev.plugins.needsRefresh
      ? prev
      : {
          ...prev,
          plugins: { ...prev.plugins, needsRefresh: true },
        },
  )
  return 'reload-required'
}

type ActivateFailReason =
  | 'cache_impact'
  | 'refresh_failed'
  | 'plugin_load_error'

async function tryActivatePluginsAfterInstall(
  getContext: () => ActivatePluginsAfterInstallContext,
  setAppState: SetAppState,
  installedPluginIds: readonly string[],
): Promise<ActivateFailReason | null> {
  try {
    // densable zQS: pre-refresh cache-impact gate
    const pre = await assessPluginReloadCacheImpact(getContext())
    if (pre.wouldInvalidateCache) return 'cache_impact'

    const result = await refreshActivePlugins(setAppState)

    // densable re-checks cache impact only after WHe installs additional
    // dependency plugins mid-activate. Without that surface, skip re-assess
    // (post-refresh MCP delta would false-positive cache_impact).

    // densable: error_count > errors.length → refresh_failed (hook load etc.)
    if (result.error_count > result.errors.length) {
      return 'refresh_failed'
    }
    if (
      result.errors.some(e =>
        errorConcernsInstalledPlugin(e, installedPluginIds),
      )
    ) {
      return 'plugin_load_error'
    }
    return null
  } catch (err) {
    logError(err)
    logForDebugging(
      `activatePluginsAfterInstall: falling back to needsRefresh: ${errorMessage(err)}`,
      { level: 'error' },
    )
    return 'refresh_failed'
  }
}

/** densable UI suffix for single-plugin install. */
export function formatSingleInstallActivateSuffix(
  outcome: PluginInstallAutoActivateOutcome,
): string {
  switch (outcome) {
    case 'activated':
      return ' Plugin is now active.'
    case 'load-failed':
      return " The plugin couldn't be loaded — see /plugin for details."
    case 'reload-required':
      return ' Run /reload-plugins to activate.'
  }
}

/** densable UI suffix for multi-plugin install (successCount active candidates). */
export function formatBatchInstallActivateSuffix(
  outcome: PluginInstallAutoActivateOutcome,
  activeCount: number,
): string {
  if (activeCount <= 0) return ''
  switch (outcome) {
    case 'activated':
      return activeCount === 1
        ? ' Plugin is now active.'
        : ' Plugins are now active.'
    case 'load-failed':
      return " Some plugins couldn't be loaded — see /plugin for details."
    case 'reload-required':
      return ' Run /reload-plugins to activate.'
  }
}

/** densable mixed batch success suffix. */
export function formatPartialBatchInstallActivateSuffix(
  outcome: PluginInstallAutoActivateOutcome,
  successCount: number,
): string {
  if (successCount <= 0) return ''
  switch (outcome) {
    case 'activated':
      return successCount === 1
        ? ' The successfully installed plugin is now active.'
        : ' Successfully installed plugins are now active.'
    case 'load-failed':
      return " Some installed plugins couldn't be loaded — see /plugin for details."
    case 'reload-required':
      return ' Run /reload-plugins to activate successfully installed plugins.'
  }
}
