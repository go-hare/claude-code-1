/**
 * Core plugin operations (install, uninstall, enable, disable, update)
 *
 * This module provides pure library functions that can be used by both:
 * - CLI commands (`claude plugin install/uninstall/enable/disable/update`)
 * - Interactive UI (ManagePlugins.tsx)
 *
 * Functions in this module:
 * - Do NOT call process.exit()
 * - Do NOT write to console
 * - Return result objects indicating success/failure with messages
 * - Can throw errors for unexpected failures
 */
import { dirname, join } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { isBuiltinPluginId } from '../../plugins/builtinPlugins.js'
import type { LoadedPlugin, PluginManifest } from '../../types/plugin.js'
import { isENOENT, toError } from '../../utils/errors.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { logError } from '../../utils/log.js'
import {
  clearAllCaches,
  markPluginVersionOrphaned,
} from '../../utils/plugins/cacheUtils.js'
import {
  findReverseDependents,
  formatReverseDependentsSuffix,
} from '../../utils/plugins/dependencyResolver.js'
import { denyCommandProducerDir } from '../../utils/plugins/commandProducerDirs.js'
import {
  loadInstalledPluginsFromDisk,
  loadInstalledPluginsV2,
  removePluginInstallation,
  updateInstallationPathOnDisk,
} from '../../utils/plugins/installedPluginsManager.js'
import { isSourceAllowedByPolicy } from '../../utils/plugins/marketplaceHelpers.js'
import { logEvent } from '../analytics/index.js'
import {
  getMarketplace,
  getPluginById,
  loadKnownMarketplacesConfig,
  loadKnownMarketplacesConfigSafe,
  logScopedInstallRefreshOutcome,
  tryRefreshMarketplaceBeforeScopedInstall,
} from '../../utils/plugins/marketplaceManager.js'
import { deletePluginDataDir } from '../../utils/plugins/pluginDirectories.js'
import type { CommandSourceConsent } from '../../utils/plugins/pluginCommandSource.js'
import {
  commandPluginConsentKey,
  isCommandPluginSource,
  isCommandSourceConsentWorkspaceScoped,
  mergePreviousProducerPaths,
} from '../../utils/plugins/pluginCommandSource.js'
import {
  findPluginKeyCaseInsensitive,
  parsePluginIdentifier,
  pluginIdEquals,
  scopeToSettingSource,
} from '../../utils/plugins/pluginIdentifier.js'
import {
  compareConsentedEntryHelper,
  ENTRY_HELPER_UPDATE_ABORT_MESSAGE,
  formatEntryHelperCliUnconfirmedMessage,
  formatEntryHelperDisclosure,
  formatHeadersHelperPaneMismatch,
  getShownArchiveHeadersHelperFromOverlay,
  lookupTrustedSettingsEntryAuth,
  marketplaceSourceFromKnown,
  overlayTrustedSettingsEntryAuth,
  planArchiveEntryHelperUpdate,
  resolveCliUnconfirmedArchiveHelper,
  type HeadersHelperPaneShown,
} from '../../utils/plugins/marketplaceHeadersHelper.js'
import {
  EntryHelperPolicyError,
  PluginCommandRefusedError,
  classifyPluginCommandRefusal,
  entryHelperPaneMismatchFailureCode,
} from '../../utils/plugins/pluginCommandRefusal.js'
import {
  formatResolutionError,
  installResolvedPlugin,
  resolveMarketplaceArchiveAuth,
} from '../../utils/plugins/pluginInstallationHelpers.js'
import {
  cachePlugin,
  copyPluginToVersionedCache,
  getVersionedCachePath,
  getVersionedZipCachePath,
  loadAllPlugins,
  loadPluginManifest,
} from '../../utils/plugins/pluginLoader.js'
import { deletePluginOptions } from '../../utils/plugins/pluginOptionsStorage.js'
import { isPluginBlockedByPolicy } from '../../utils/plugins/pluginPolicy.js'
import { getPluginEditableScopes } from '../../utils/plugins/pluginStartupCheck.js'
import {
  readSyncedPluginName,
  syncedIdsMissingFromSettings,
} from '../../utils/plugins/zpfLoad.js'
import { hydrateSyncedPluginDirsFromDisk } from '../../utils/plugins/syncedPluginHydrate.js'
import { getSyncedPluginDirs } from '../../bootstrap/state.js'
import { getEnabledSettingSources } from '../../utils/settings/constants.js'
import { calculatePluginVersion } from '../../utils/plugins/pluginVersioning.js'
import type {
  PluginMarketplaceEntry,
  PluginScope,
} from '../../utils/plugins/schemas.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import { plural } from '../../utils/stringUtils.js'

/** Valid installable scopes (excludes 'managed' which can only be installed from managed-settings.json) */
export const VALID_INSTALLABLE_SCOPES = ['user', 'project', 'local'] as const

/** Installation scope type derived from VALID_INSTALLABLE_SCOPES */
export type InstallableScope = (typeof VALID_INSTALLABLE_SCOPES)[number]

/** Valid scopes for update operations (includes 'managed' since managed plugins can be updated) */
export const VALID_UPDATE_SCOPES: readonly PluginScope[] = [
  'user',
  'project',
  'local',
  'managed',
] as const

/**
 * Assert that a scope is a valid installable scope at runtime
 * @param scope The scope to validate
 * @throws Error if scope is not a valid installable scope
 */
export function assertInstallableScope(
  scope: string,
): asserts scope is InstallableScope {
  if (!VALID_INSTALLABLE_SCOPES.includes(scope as InstallableScope)) {
    throw new Error(
      `Invalid scope "${scope}". Must be one of: ${VALID_INSTALLABLE_SCOPES.join(', ')}`,
    )
  }
}

/**
 * Type guard to check if a scope is an installable scope (not 'managed').
 * Use this for type narrowing in conditional blocks.
 */
export function isInstallableScope(
  scope: PluginScope,
): scope is InstallableScope {
  return VALID_INSTALLABLE_SCOPES.includes(scope as InstallableScope)
}

/**
 * Get the project path for scopes that are project-specific.
 * Returns the original cwd for 'project' and 'local' scopes, undefined otherwise.
 */
export function getProjectPathForScope(scope: PluginScope): string | undefined {
  return scope === 'project' || scope === 'local' ? getOriginalCwd() : undefined
}

/**
 * Is this plugin enabled (value === true) in .claude/settings.json?
 *
 * Distinct from V2 installed_plugins.json scope: that file tracks where a
 * plugin was *installed from*, but the same plugin can also be enabled at
 * project scope via settings. The uninstall UI needs to check THIS, because
 * a user-scope install with a project-scope enablement means "uninstall"
 * would succeed at removing the user install while leaving the project
 * enablement active — the plugin keeps running.
 */
export function isPluginEnabledAtProjectScope(pluginId: string): boolean {
  return (
    getSettingsForSource('projectSettings')?.enabledPlugins?.[pluginId] === true
  )
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result of a plugin operation
 */
export type PluginOperationResult = {
  success: boolean
  message: string
  pluginId?: string
  pluginName?: string
  scope?: PluginScope
  /** Plugins that declare this plugin as a dependency (warning on uninstall/disable) */
  reverseDependents?: string[]
  /** densable vun / w0i — typed i0/cwe classification when present. */
  failureCode?: string
}

/**
 * Result of a plugin update operation
 */
export type PluginUpdateResult = {
  success: boolean
  message: string
  pluginId?: string
  newVersion?: string
  oldVersion?: string
  alreadyUpToDate?: boolean
  scope?: PluginScope
  /** SEA `ggw` — autoupdate treats this as skip, not fail. */
  skipReason?: 'entry_helper_deferred'
  /** densable vun — cwe.failureCode or command_source_refused. */
  failureCode?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Search all editable settings scopes for a plugin ID matching the given input.
 *
 * If `plugin` contains `@`, it's treated as a full pluginId and returned if
 * found in any scope. If `plugin` is a bare name, searches for any key
 * starting with `{plugin}@` in any scope.
 *
 * Returns the most specific scope where the plugin is mentioned (regardless
 * of enabled/disabled state) plus the resolved full pluginId.
 *
 * Precedence: local > project > user (most specific wins).
 */
function findPluginInSettings(plugin: string): {
  pluginId: string
  scope: InstallableScope
} | null {
  const hasMarketplace = plugin.includes('@')
  // Most specific first — first match wins
  const searchOrder: InstallableScope[] = ['local', 'project', 'user']

  for (const scope of searchOrder) {
    const enabledPlugins = getSettingsForSource(
      scopeToSettingSource(scope),
    )?.enabledPlugins
    if (!enabledPlugins) continue

    for (const key of Object.keys(enabledPlugins)) {
      if (hasMarketplace ? key === plugin : key.startsWith(`${plugin}@`)) {
        return { pluginId: key, scope }
      }
    }
  }
  return null
}

/**
 * densable N9d — find loaded plugin by identifier (case-insensitive Lwe).
 * When marketplace is specified, also require source to include @marketplace
 * (case-insensitive); bare name still matches first via densable N9d order.
 */
function findPluginByIdentifier(
  plugin: string,
  plugins: LoadedPlugin[],
): LoadedPlugin | undefined {
  const { name, marketplace } = parsePluginIdentifier(plugin)

  return plugins.find(p => {
    // densable: Lwe(o.name, e) || Lwe(o.name, r)
    if (pluginIdEquals(p.name, plugin) || pluginIdEquals(p.name, name)) {
      return true
    }
    // densable: n && o.source → Lwe(name) && source includes @marketplace (lower)
    if (marketplace && p.source) {
      return (
        pluginIdEquals(p.name, name) &&
        p.source.toLowerCase().includes(`@${marketplace.toLowerCase()}`)
      )
    }
    return false
  })
}

/**
 * densable wu_ — resolve delisted plugin id from V2 installed_plugins.
 * When input includes `@`, only bare (no-marketplace) keys match the name
 * fallback after exact/case-insensitive key resolve (densable `!a||!p`).
 */
function resolveDelistedPluginId(
  plugin: string,
  scope?: InstallableScope,
  projectPath?: string | undefined,
): { pluginId: string; pluginName: string } | null {
  const { name } = parsePluginIdentifier(plugin)
  const installedData = loadInstalledPluginsV2()
  const keys = Object.keys(installedData.plugins)

  // densable: are(i,e) exact/Lwe key with installations
  const exactKey = findPluginKeyCaseInsensitive(keys, plugin)
  if (exactKey && (installedData.plugins[exactKey]?.length ?? 0) > 0) {
    return { pluginId: exactKey, pluginName: name }
  }

  const inputHasMarketplace = plugin.includes('@')
  const matchingKeys = keys.filter(key => {
    const { name: keyName, marketplace: keyMkt } = parsePluginIdentifier(key)
    return (
      pluginIdEquals(keyName, name) &&
      // densable: (!a || !p) — with @ in input, only bare keys; without, any
      (!inputHasMarketplace || !keyMkt) &&
      (installedData.plugins[key]?.length ?? 0) > 0
    )
  })

  // Prefer installation matching requested scope/project when provided
  const preferred =
    scope !== undefined
      ? (matchingKeys.find(u =>
          installedData.plugins[u]?.some(
            d => d.scope === scope && d.projectPath === projectPath,
          ),
        ) ?? matchingKeys[0])
      : matchingKeys[0]

  if (preferred) {
    return { pluginId: preferred, pluginName: name }
  }

  return null
}

/**
 * Get the most relevant installation for a plugin from V2 data.
 * For project/local scoped plugins, prioritizes installations matching the current project.
 * Priority order: local (matching project) > project (matching project) > user > first available
 */
export function getPluginInstallationFromV2(pluginId: string): {
  scope: PluginScope
  projectPath?: string
} {
  const installedData = loadInstalledPluginsV2()
  const installations = installedData.plugins[pluginId]

  if (!installations || installations.length === 0) {
    return { scope: 'user' }
  }

  const currentProjectPath = getOriginalCwd()

  // Find installations by priority: local > project > user > managed
  const localInstall = installations.find(
    inst => inst.scope === 'local' && inst.projectPath === currentProjectPath,
  )
  if (localInstall) {
    return { scope: localInstall.scope, projectPath: localInstall.projectPath }
  }

  const projectInstall = installations.find(
    inst => inst.scope === 'project' && inst.projectPath === currentProjectPath,
  )
  if (projectInstall) {
    return {
      scope: projectInstall.scope,
      projectPath: projectInstall.projectPath,
    }
  }

  const userInstall = installations.find(inst => inst.scope === 'user')
  if (userInstall) {
    return { scope: userInstall.scope }
  }

  // Fall back to first installation (could be managed)
  return {
    scope: installations[0]!.scope,
    projectPath: installations[0]!.projectPath,
  }
}

// ============================================================================
// Core Operations
// ============================================================================

/**
 * Install a plugin (settings-first).
 *
 * Order of operations:
 *   1. densable 2.1.232 #36 / `gvm`+`zqr`: **scoped** install refreshes the
 *      marketplace first (before catalog lookup), not only on miss
 *   2. Search materialized marketplaces for the plugin
 *   3. Write settings (THE ACTION — declares intent)
 *   4. Cache plugin + record version hint (materialization)
 *
 * Marketplace reconciliation is NOT this function's responsibility — startup
 * reconcile handles declared-but-not-materialized marketplaces. If the
 * marketplace isn't found after refresh, "not found" is the correct error.
 *
 * @param plugin Plugin identifier (name or plugin@marketplace)
 * @param scope Installation scope: user, project, or local (defaults to 'user')
 * @returns Result indicating success/failure
 */
export async function installPluginOp(
  plugin: string,
  scope: InstallableScope = 'user',
  options?: {
    /**
     * densable ctm `shownSourceCommand` — HK grant key from CLI ptm/-y.
     * When set, becomes commandSourceConsent kind "shown".
     * When unset, falls back to densable x0v recorded consent from
     * installed_plugins.
     */
    shownSourceCommand?: string
    /**
     * SEA zgh `shownEntryHelper` — snapshot from Vgh/CLI announce. After
     * refresh, missing shown + present helper throws CLI unconfirmed copy.
     */
    shownEntryHelper?: HeadersHelperPaneShown
  },
): Promise<PluginOperationResult> {
  assertInstallableScope(scope)

  const { name: pluginName, marketplace: marketplaceName } =
    parsePluginIdentifier(plugin)

  // ── Search materialized marketplaces for the plugin ──
  let foundPlugin: PluginMarketplaceEntry | undefined
  let foundMarketplace: string | undefined
  let marketplaceInstallLocation: string | undefined
  // densable gvm: pre-install refresh flags for scoped path
  let preInstallRefreshed = false
  let preInstallRefreshFailed = false
  let preInstallRefreshWarning: string | undefined
  let marketplacePolicyBlocked = false

  if (marketplaceName) {
    // densable gvm/zqr: always attempt refresh before lookup (not miss-only)
    const marketplaces = await loadKnownMarketplacesConfig()
    const mktEntry = marketplaces[marketplaceName]
    marketplacePolicyBlocked =
      mktEntry !== undefined && !isSourceAllowedByPolicy(mktEntry.source)
    const refresh = await tryRefreshMarketplaceBeforeScopedInstall(
      marketplaceName,
      mktEntry,
    )
    logScopedInstallRefreshOutcome(refresh.outcome)
    if (refresh.outcome === 'refreshed') {
      preInstallRefreshed = true
    } else if (refresh.outcome === 'refresh-failed') {
      preInstallRefreshFailed = true
      preInstallRefreshWarning = `marketplace not refreshed (${refresh.errorMessage})`
    }

    const pluginInfo = await getPluginById(plugin)
    if (pluginInfo) {
      foundPlugin = pluginInfo.entry
      foundMarketplace = marketplaceName
      marketplaceInstallLocation = pluginInfo.marketplaceInstallLocation
    }
  } else {
    // Unscoped: densable still walks known marketplaces without zqr-first
    // (UI discovery path uses pvm on miss). Keep cache walk + policy filter.
    const marketplaces = await loadKnownMarketplacesConfig()
    for (const [mktName, mktConfig] of Object.entries(marketplaces)) {
      // densable l0: require source + policy allowlist
      if (!mktConfig.source || !isSourceAllowedByPolicy(mktConfig.source)) {
        continue
      }
      try {
        const marketplace = await getMarketplace(mktName)
        const pluginEntry = marketplace.plugins.find(p => p.name === pluginName)
        if (pluginEntry) {
          foundPlugin = pluginEntry
          foundMarketplace = mktName
          marketplaceInstallLocation = mktConfig.installLocation
          break
        }
      } catch (error) {
        logError(toError(error))
      }
    }
  }

  if (!foundPlugin || !foundMarketplace) {
    const location = marketplaceName
      ? `marketplace "${marketplaceName}"`
      : 'any configured marketplace'
    // densable gvm: scoped miss stale hint when refresh did NOT succeed.
    // Successful refresh that still misses → no "out of date" claim.
    let staleHint = ''
    if (marketplaceName && !preInstallRefreshed) {
      const cliUpdate = `claude plugin marketplace update ${marketplaceName}`
      staleHint = `. Your local copy may be out of date — try \`${cliUpdate}\`.`
    }
    // densable gvm resolve telemetry (reason tag only — no paths)
    logEvent('plugin_marketplace_resolve', {
      scoped: marketplaceName !== undefined,
      marketplace_policy_blocked: marketplacePolicyBlocked,
      refresh_failed_stale_lookup: preInstallRefreshFailed,
      not_found: !marketplacePolicyBlocked && !preInstallRefreshFailed,
    })
    return {
      success: false,
      message: `Plugin "${pluginName}" not found in ${location}${staleHint}`,
    }
  }

  const entry = foundPlugin
  const pluginId = `${entry.name}@${foundMarketplace}`

  // densable ctm: shownSourceCommand → {kind:"shown"} else x0v recorded
  let commandSourceConsent: CommandSourceConsent | undefined
  if (options?.shownSourceCommand !== undefined) {
    commandSourceConsent = {
      kind: 'shown',
      command: options.shownSourceCommand,
      pluginId,
    }
  } else {
    const { getRecordedCommandSourceConsent } = await import(
      '../../utils/plugins/pluginCommandSource.js'
    )
    commandSourceConsent = getRecordedCommandSourceConsent(
      pluginId,
      entry.source,
      loadInstalledPluginsV2().plugins[pluginId],
    )
  }

  // SEA zgh/bin: if(n!==void 0) y=n; else g5n(DNt); overlay sve/YLa → null.
  let consentedEntryHelper: HeadersHelperPaneShown | undefined
  if (options?.shownEntryHelper !== undefined) {
    consentedEntryHelper = options.shownEntryHelper
  } else {
    const known = await loadKnownMarketplacesConfigSafe()
    const helper = resolveCliUnconfirmedArchiveHelper({
      entry,
      marketplaceName: foundMarketplace,
      marketplaceSource: known[foundMarketplace]?.source,
    })
    if (helper) {
      // densable zgh: throw new cwe(Sas + confirm-in-terminal, "entry_helper_unconfirmed")
      throw new EntryHelperPolicyError(
        formatEntryHelperCliUnconfirmedMessage(helper),
        'entry_helper_unconfirmed',
      )
    }
  }

  // densable zgh: U9n is not wrapped — i0/cwe from ayi propagate.
  const result = await installResolvedPlugin({
    pluginId,
    entry,
    scope,
    marketplaceInstallLocation,
    commandSourceConsent,
    runEntryHelper: true,
    consentedEntryHelper,
  })

  if (!result.ok) {
    const failResult = result as Extract<typeof result, { ok: false }>
    switch (failResult.reason) {
      case 'local-source-no-location':
        return {
          success: false,
          message: `Cannot install local plugin "${failResult.pluginName}" without marketplace install location`,
        }
      case 'settings-write-failed':
        return {
          success: false,
          message: `Failed to update settings: ${failResult.message}`,
        }
      case 'resolution-failed':
        return {
          success: false,
          message: formatResolutionError(failResult.resolution),
        }
      case 'blocked-by-policy':
        return {
          success: false,
          message: `Plugin "${failResult.pluginName}" is blocked by your organization's policy and cannot be installed`,
        }
      case 'dependency-blocked-by-policy':
        return {
          success: false,
          message: `Plugin "${failResult.pluginName}" depends on "${failResult.blockedDependency}", which is blocked by your organization's policy`,
        }
    }
  }

  // densable gvm: warn when install used cached catalog after failed pre-refresh
  const staleInstallWarning = preInstallRefreshWarning
    ? `. Warning: ${preInstallRefreshWarning} — installed from the cached catalog, so the version may be stale`
    : ''

  return {
    success: true,
    message: `Successfully installed plugin: ${pluginId} (scope: ${scope})${(result as Extract<typeof result, { ok: true }>).depNote}${staleInstallWarning}`,
    pluginId,
    pluginName: entry.name,
    scope,
  }
}

/**
 * Uninstall a plugin
 *
 * @param plugin Plugin name or plugin@marketplace identifier
 * @param scope Uninstall from scope: user, project, or local (defaults to 'user')
 * @returns Result indicating success/failure
 */
export async function uninstallPluginOp(
  plugin: string,
  scope: InstallableScope = 'user',
  deleteDataDir = true,
): Promise<PluginOperationResult> {
  // Validate scope at runtime for early error detection
  assertInstallableScope(scope)

  const { enabled, disabled } = await loadAllPlugins()
  const allPlugins = [...enabled, ...disabled]

  // densable _Fe: N9d find + settings key priority with marketplace-aware list
  const foundPlugin = findPluginByIdentifier(plugin, allPlugins)

  const settingSource = scopeToSettingSource(scope)
  const settings = getSettingsForSource(settingSource)

  const projectPath = getProjectPathForScope(scope)
  const installedData = loadInstalledPluginsV2()
  const installedKeys = Object.keys(installedData.plugins)

  let pluginId: string
  let pluginName: string

  if (foundPlugin) {
    // densable P candidate order for settings keys:
    // exact e, Lwe(e), then (if no @ in e) name / name@* / case variants, then fallback
    const enabledKeys = Object.keys(settings?.enabledPlugins ?? {})
    const nameLower = foundPlugin.name.toLowerCase()
    const inputHasMarketplace = plugin.includes('@')
    const candidates: string[] = [
      ...enabledKeys.filter(L => L === plugin),
      ...enabledKeys.filter(L => pluginIdEquals(L, plugin)),
      ...(inputHasMarketplace
        ? []
        : [
            ...enabledKeys.filter(L => L === foundPlugin.name),
            ...enabledKeys.filter(L => L.startsWith(`${foundPlugin.name}@`)),
            ...enabledKeys.filter(L => L.toLowerCase() === nameLower),
            ...enabledKeys.filter(L =>
              L.toLowerCase().startsWith(`${nameLower}@`),
            ),
          ]),
      inputHasMarketplace ? plugin : foundPlugin.name,
    ]
    // densable: pick first candidate whose V2 install matches scope+projectPath
    pluginId =
      candidates.find(L => {
        const N = findPluginKeyCaseInsensitive(installedKeys, L) ?? L
        return (installedData.plugins[N] ?? []).some(
          $ => $.scope === scope && $.projectPath === projectPath,
        )
      }) ?? candidates[0]!
    pluginName = foundPlugin.name
  } else {
    // densable wu_ delisted fallback (scope+project aware)
    const resolved = resolveDelistedPluginId(plugin, scope, projectPath)
    if (!resolved) {
      return {
        success: false,
        message: `Plugin "${plugin}" not found in installed plugins`,
      }
    }
    pluginId = resolved.pluginId
    pluginName = resolved.pluginName
  }

  // densable: u = are(f, u) ?? u  — normalize to installed key casing
  pluginId = findPluginKeyCaseInsensitive(installedKeys, pluginId) ?? pluginId

  // Check if the plugin is installed in this scope (in V2 file)
  const installations = installedData.plugins[pluginId]
  const scopeInstallation = installations?.find(
    i => i.scope === scope && i.projectPath === projectPath,
  )

  if (!scopeInstallation) {
    // Try to find where the plugin is actually installed to provide a helpful error
    const { scope: actualScope } = getPluginInstallationFromV2(pluginId)
    if (actualScope !== scope && installations && installations.length > 0) {
      // Project scope is special: .claude/settings.json is shared with the team.
      // Point users at the local-override escape hatch instead of --scope project.
      if (actualScope === 'project') {
        return {
          success: false,
          message: `Plugin "${plugin}" is enabled at project scope (.claude/settings.json, shared with your team). To disable just for you: claude plugin disable ${plugin} --scope local`,
        }
      }
      return {
        success: false,
        message: `Plugin "${plugin}" is installed in ${actualScope} scope, not ${scope}. Use --scope ${actualScope} to uninstall.`,
      }
    }
    return {
      success: false,
      message: `Plugin "${plugin}" is not installed in ${scope} scope. Use --scope to specify the correct scope.`,
    }
  }

  const installPath = scopeInstallation.installPath

  // Remove the plugin from the appropriate settings file (delete key entirely)
  // Use undefined to signal deletion via mergeWith in updateSettingsForSource
  const newEnabledPlugins: Record<string, boolean | string[] | undefined> = {
    ...settings?.enabledPlugins,
  }
  newEnabledPlugins[pluginId] = undefined
  updateSettingsForSource(settingSource, {
    enabledPlugins: newEnabledPlugins,
  })

  clearAllCaches()

  // Remove from installed_plugins_v2.json for this scope
  removePluginInstallation(pluginId, scope, projectPath)

  const updatedData = loadInstalledPluginsV2()
  const remainingInstallations = updatedData.plugins[pluginId]
  const isLastScope =
    !remainingInstallations || remainingInstallations.length === 0
  if (isLastScope && installPath) {
    await markPluginVersionOrphaned(installPath)
  }
  // Separate from the `&& installPath` guard above — deletePluginOptions only
  // needs pluginId, not installPath. Last scope removed → wipe stored options
  // and secrets. Before this, uninstalling left orphaned entries in
  // settings.pluginConfigs (including the legacy ungated mcpServers sub-key
  // from the MCPB Configure flow) and keychain pluginSecrets forever. No
  // feature gate: deletePluginOptions no-ops when nothing is stored, and
  // pluginConfigs.mcpServers is written ungated so its cleanup must run
  // ungated too.
  if (isLastScope) {
    deletePluginOptions(pluginId)
    if (deleteDataDir) {
      await deletePluginDataDir(pluginId)
    }
  }

  // Warn (don't block) if other enabled plugins depend on this one.
  // Blocking creates tombstones — can't tear down a graph with a delisted
  // plugin. Load-time verifyAndDemote catches the fallout.
  const reverseDependents = findReverseDependents(pluginId, allPlugins)
  const depWarn = formatReverseDependentsSuffix(reverseDependents)

  return {
    success: true,
    message: `Successfully uninstalled plugin: ${pluginName} (scope: ${scope})${depWarn}`,
    pluginId,
    pluginName,
    scope,
    reverseDependents:
      reverseDependents.length > 0 ? reverseDependents : undefined,
  }
}

/**
 * Set plugin enabled/disabled status (settings-first).
 *
 * Resolves the plugin ID and scope from settings — does NOT pre-gate on
 * installed_plugins.json. Settings declares intent; if the plugin isn't
 * cached yet, the next load will cache it.
 *
 * @param plugin Plugin name or plugin@marketplace identifier
 * @param enabled true to enable, false to disable
 * @param scope Optional scope. If not provided, auto-detects the most specific
 *   scope where the plugin is mentioned in settings.
 * @returns Result indicating success/failure
 */
export async function setPluginEnabledOp(
  plugin: string,
  enabled: boolean,
  scope?: InstallableScope,
  options?: { bypassDependentsBlock?: boolean },
): Promise<PluginOperationResult> {
  const operation = enabled ? 'enable' : 'disable'

  // Built-in plugins: always use user-scope settings, bypass the normal
  // scope-resolution + installed_plugins lookup (they're not installed).
  if (isBuiltinPluginId(plugin)) {
    const { error } = updateSettingsForSource('userSettings', {
      enabledPlugins: {
        ...getSettingsForSource('userSettings')?.enabledPlugins,
        [plugin]: enabled,
      },
    })
    if (error) {
      return {
        success: false,
        message: `Failed to ${operation} built-in plugin: ${error.message}`,
      }
    }
    clearAllCaches()
    const { name: pluginName } = parsePluginIdentifier(plugin)
    return {
      success: true,
      message: `Successfully ${operation}d built-in plugin: ${pluginName}`,
      pluginId: plugin,
      pluginName,
      scope: 'user',
    }
  }

  if (scope) {
    assertInstallableScope(scope)
  }

  // ── Resolve pluginId and scope from settings ──
  // Search across editable scopes for any mention (enabled or disabled) of
  // this plugin. Does NOT pre-gate on installed_plugins.json.
  let pluginId: string
  let resolvedScope: InstallableScope

  const found = findPluginInSettings(plugin)

  if (scope) {
    // Explicit scope: use it. Resolve pluginId from settings if possible,
    // otherwise require a full plugin@marketplace identifier.
    resolvedScope = scope
    if (found) {
      pluginId = found.pluginId
    } else if (plugin.includes('@')) {
      pluginId = plugin
    } else {
      return {
        success: false,
        message: `Plugin "${plugin}" not found in settings. Use plugin@marketplace format.`,
      }
    }
  } else if (found) {
    // Auto-detect scope: use the most specific scope where the plugin is
    // mentioned in settings.
    pluginId = found.pluginId
    resolvedScope = found.scope
  } else if (plugin.includes('@')) {
    // Not in any settings scope, but full pluginId given — default to user
    // scope (matches install default). This allows enabling a plugin that
    // was cached but never declared.
    pluginId = plugin
    resolvedScope = 'user'
  } else {
    return {
      success: false,
      message: `Plugin "${plugin}" not found in any editable settings scope. Use plugin@marketplace format.`,
    }
  }

  // ── Policy guard ──
  // Org-blocked plugins cannot be enabled at any scope. Check after pluginId
  // is resolved so we catch both full identifiers and bare-name lookups.
  if (enabled && isPluginBlockedByPolicy(pluginId)) {
    return {
      success: false,
      message: `Plugin "${pluginId}" is blocked by your organization's policy and cannot be enabled`,
    }
  }

  const settingSource = scopeToSettingSource(resolvedScope)
  const scopeSettingsValue =
    getSettingsForSource(settingSource)?.enabledPlugins?.[pluginId]

  // ── Cross-scope hint: explicit scope given but plugin is elsewhere ──
  // If the plugin is absent from the requested scope but present at a
  // different scope, guide the user to the right --scope — UNLESS they're
  // writing to a higher-precedence scope to override a lower one
  // (e.g. `disable --scope local` to override a project-enabled plugin
  // without touching the shared .claude/settings.json).
  const SCOPE_PRECEDENCE: Record<InstallableScope, number> = {
    user: 0,
    project: 1,
    local: 2,
  }
  const isOverride =
    scope && found && SCOPE_PRECEDENCE[scope] > SCOPE_PRECEDENCE[found.scope]
  if (
    scope &&
    scopeSettingsValue === undefined &&
    found &&
    found.scope !== scope &&
    !isOverride
  ) {
    return {
      success: false,
      message: `Plugin "${plugin}" is installed at ${found.scope} scope, not ${scope}. Use --scope ${found.scope} or omit --scope to auto-detect.`,
    }
  }

  // ── Check current state (for idempotency messaging) ──
  // When explicit scope given: check that scope's settings value directly
  // (merged state can be wrong if plugin is enabled elsewhere but disabled here).
  // When auto-detected: use merged effective state.
  // When overriding a lower scope: check merged state — scopeSettingsValue is
  // undefined (plugin not in this scope yet), which would read as "already
  // disabled", but the whole point of the override is to write an explicit
  // `false` that masks the lower scope's `true`.
  const isCurrentlyEnabled =
    scope && !isOverride
      ? scopeSettingsValue === true
      : getPluginEditableScopes().has(pluginId)
  if (enabled === isCurrentlyEnabled) {
    return {
      success: false,
      message: `Plugin "${plugin}" is already ${enabled ? 'enabled' : 'disabled'}${scope ? ` at ${scope} scope` : ''}`,
    }
  }

  // On disable: capture reverse dependents from the PRE-disable snapshot,
  // before we write settings and clear the memoized plugin cache.
  let reverseDependents: string[] | undefined
  if (!enabled) {
    const { enabled: loadedEnabled, disabled } = await loadAllPlugins()
    const rdeps = findReverseDependents(pluginId, [
      ...loadedEnabled,
      ...disabled,
    ])
    if (rdeps.length > 0) {
      reverseDependents = rdeps
      // Block disable when other enabled plugins depend on this one
      const enabledRdeps = rdeps.filter(dep =>
        loadedEnabled.some(p => p.name === dep || p.source === dep),
      )
      if (enabledRdeps.length > 0 && !options?.bypassDependentsBlock) {
        const chain = enabledRdeps.join(', ')
        return {
          success: false,
          message: `Cannot disable ${pluginId}: ${chain} depend${enabledRdeps.length === 1 ? 's' : ''} on it. Disable ${chain} first, or run: claude plugin disable ${enabledRdeps.join(' ')} ${pluginId}`,
        }
      }
    }
  }

  // When enabling, also force-enable transitive dependencies
  const enabledDeps: string[] = []
  if (enabled) {
    const { enabled: loadedEnabled, disabled } = await loadAllPlugins()
    const targetPlugin = [...loadedEnabled, ...disabled].find(
      p => p.name === pluginId || p.source === pluginId,
    )
    const deps = (targetPlugin?.manifest as Record<string, unknown>)
      ?.dependencies as Array<string | { name?: string }> | undefined
    if (deps) {
      for (const dep of deps) {
        const depName = typeof dep === 'string' ? dep : (dep?.name ?? '')
        if (!depName) continue
        const isDisabled = disabled.some(
          p => p.name === depName || p.source === depName,
        )
        if (isDisabled) {
          updateSettingsForSource(settingSource, {
            enabledPlugins: {
              ...getSettingsForSource(settingSource)?.enabledPlugins,
              [depName]: true,
            },
          })
          enabledDeps.push(depName)
        }
      }
    }
  }

  // ── ACTION: write settings ──
  const { error } = updateSettingsForSource(settingSource, {
    enabledPlugins: {
      ...getSettingsForSource(settingSource)?.enabledPlugins,
      [pluginId]: enabled,
    },
  })
  if (error) {
    return {
      success: false,
      message: `Failed to ${operation} plugin: ${error.message}`,
    }
  }

  clearAllCaches()

  const { name: pluginName } = parsePluginIdentifier(pluginId)
  const depWarn = formatReverseDependentsSuffix(reverseDependents)
  const depsNote =
    enabledDeps.length > 0
      ? ` (also enabled dependencies: ${enabledDeps.join(', ')})`
      : ''
  return {
    success: true,
    message: `Successfully ${operation}d plugin: ${pluginName} (scope: ${resolvedScope})${depWarn}${depsNote}`,
    pluginId,
    pluginName,
    scope: resolvedScope,
    reverseDependents,
  }
}

/**
 * Enable a plugin
 *
 * @param plugin Plugin name or plugin@marketplace identifier
 * @param scope Optional scope. If not provided, finds the most specific scope for the current project.
 * @returns Result indicating success/failure
 */
export async function enablePluginOp(
  plugin: string,
  scope?: InstallableScope,
): Promise<PluginOperationResult> {
  return setPluginEnabledOp(plugin, true, scope)
}

/**
 * Disable a plugin
 *
 * @param plugin Plugin name or plugin@marketplace identifier
 * @param scope Optional scope. If not provided, finds the most specific scope for the current project.
 * @returns Result indicating success/failure
 */
export async function disablePluginOp(
  plugin: string,
  scope?: InstallableScope,
): Promise<PluginOperationResult> {
  return setPluginEnabledOp(plugin, false, scope)
}

/**
 * Disable all enabled plugins
 *
 * @returns Result indicating success/failure with count of disabled plugins
 */
export async function disableAllPluginsOp(): Promise<PluginOperationResult> {
  // leftover 239 J1h: T0r only (L1h kicked at init; N1h at load)
  await hydrateSyncedPluginDirsFromDisk()
  const enabledPlugins = getPluginEditableScopes()

  const syncedNames = await Promise.all(
    getSyncedPluginDirs().map(dir => readSyncedPluginName(dir)),
  )
  const settingKeys = getEnabledSettingSources().flatMap(source =>
    Object.keys(getSettingsForSource(source)?.enabledPlugins ?? {}),
  )
  const defaultOnSynced = syncedIdsMissingFromSettings(syncedNames, settingKeys)

  if (enabledPlugins.size === 0 && defaultOnSynced.length === 0) {
    return { success: true, message: 'No enabled plugins to disable' }
  }

  const disabled: string[] = []
  const errors: string[] = []

  for (const [pluginId] of enabledPlugins) {
    const result = await setPluginEnabledOp(pluginId, false, undefined, {
      bypassDependentsBlock: true,
    })
    if (result.success) {
      disabled.push(pluginId)
    } else {
      errors.push(`${pluginId}: ${result.message}`)
    }
  }

  for (const id of defaultOnSynced) {
    const { error } = updateSettingsForSource('userSettings', {
      enabledPlugins: {
        ...getSettingsForSource('userSettings')?.enabledPlugins,
        [id]: false,
      },
    })
    if (error) {
      errors.push(`${id}: ${error.message}`)
    } else {
      disabled.push(id)
    }
  }
  if (defaultOnSynced.length > 0) {
    clearAllCaches()
  }

  if (errors.length > 0) {
    return {
      success: false,
      message: `Disabled ${disabled.length} ${plural(disabled.length, 'plugin')}, ${errors.length} failed:\n${errors.join('\n')}`,
    }
  }

  return {
    success: true,
    message: `Disabled ${disabled.length} ${plural(disabled.length, 'plugin')}`,
  }
}

/**
 * densable R0v options for command-source consent during update.
 * - shownSourceCommand: HK grant key from CLI ptm/-y (kind "shown")
 * - announceCommandSource: densable o hook — CLI wires ptm; returns grantKey
 * - skipCommandSources: background paths that never re-run command sources
 */
export type PluginUpdateCommandSourceOptions = {
  shownSourceCommand?: string
  announceCommandSource?: (
    pluginId: string,
    entry: PluginMarketplaceEntry,
    acceptedCommand: string | undefined,
  ) => Promise<string | undefined>
  skipCommandSources?: boolean
  /**
   * SEA `ggw` `explicit` — CLI / `/plugin` pane set true; autoupdate leaves
   * false so archive headersHelper defers (`entry_helper_deferred`).
   */
  explicit?: boolean
  /**
   * SEA `onEntryHelperDisclosure` — CLI wires BXi + f3l. Pane already gated.
   */
  onEntryHelperDisclosure?: (
    disclosure: string,
  ) => Promise<'accepted' | 'declined' | 'unconfirmed'>
  /**
   * SEA pane `_in(..., {consentedEntryHelper: pinned()})`. CLI update uses
   * onEntryHelperDisclosure instead.
   */
  consentedEntryHelper?: HeadersHelperPaneShown | null
}

/**
 * Update a plugin to the latest version.
 *
 * This function performs a NON-INPLACE update:
 * 1. Gets the plugin info from the marketplace
 * 2. For remote plugins: downloads to temp dir and calculates version
 * 3. For local plugins: calculates version from marketplace source
 * 4. If version differs from currently installed, copies to new versioned cache directory
 * 5. Updates installation in V2 file (memory stays unchanged until restart)
 * 6. Cleans up old version if no longer referenced by any installation
 *
 * densable R0v: command sources get announce/ptm → shown consent, else recorded.
 *
 * @param plugin Plugin name or plugin@marketplace identifier
 * @param scope Scope to update. Unlike install/uninstall/enable/disable, managed scope IS allowed.
 * @returns Result indicating success/failure with version info
 */
export async function updatePluginOp(
  plugin: string,
  scope: PluginScope,
  options?: PluginUpdateCommandSourceOptions,
): Promise<PluginUpdateResult> {
  // Parse the plugin identifier to get the full plugin ID
  const { name: pluginName, marketplace: marketplaceName } =
    parsePluginIdentifier(plugin)
  const pluginId = marketplaceName ? `${pluginName}@${marketplaceName}` : plugin

  // Get plugin info from marketplace
  const pluginInfo = await getPluginById(plugin)
  if (!pluginInfo) {
    return {
      success: false,
      message: `Plugin "${pluginName}" not found`,
      pluginId,
      scope,
    }
  }

  const { entry, marketplaceInstallLocation } = pluginInfo

  // Get installations from disk
  const diskData = loadInstalledPluginsFromDisk()
  const installations = diskData.plugins[pluginId]

  if (!installations || installations.length === 0) {
    return {
      success: false,
      message: `Plugin "${pluginName}" is not installed`,
      pluginId,
      scope,
    }
  }

  // Determine projectPath based on scope
  const projectPath = getProjectPathForScope(scope)

  // Find the installation for this scope
  const installation = installations.find(
    inst => inst.scope === scope && inst.projectPath === projectPath,
  )
  if (!installation) {
    const scopeDesc = projectPath ? `${scope} (${projectPath})` : scope
    return {
      success: false,
      message: `Plugin "${pluginName}" is not installed at scope ${scopeDesc}`,
      pluginId,
      scope,
    }
  }

  try {
    return await performPluginUpdate({
      pluginId,
      pluginName,
      entry,
      marketplaceInstallLocation,
      installation,
      scope,
      projectPath,
      options,
    })
  } catch (error) {
    // densable vun: i0 → failed + failureCode (cwe.failureCode else
    // command_source_refused). Other throws stay exceptions.
    if (error instanceof PluginCommandRefusedError) {
      return {
        success: false,
        message: error.message,
        pluginId,
        scope,
        failureCode: classifyPluginCommandRefusal(error).code,
      }
    }
    throw error
  }
}

/**
 * Perform the actual plugin update: fetch source, calculate version, copy to cache, update disk.
 * This is the core update execution extracted from updatePluginOp.
 * densable R0v: command sources get announce/ptm → shown consent, else recorded sourceCommand.
 */
async function performPluginUpdate({
  pluginId,
  pluginName,
  entry,
  marketplaceInstallLocation,
  installation,
  scope,
  projectPath,
  options,
}: {
  pluginId: string
  pluginName: string
  entry: PluginMarketplaceEntry
  marketplaceInstallLocation: string
  installation: {
    version?: string
    installPath: string
    sourceCommand?: string
    sourceProducerPath?: string
    previousProducerPaths?: string[]
  }
  scope: PluginScope
  projectPath: string | undefined
  options?: PluginUpdateCommandSourceOptions
}): Promise<PluginUpdateResult> {
  const fs = getFsImplementation()
  const oldVersion = installation.version

  let sourcePath: string
  let newVersion: string
  let shouldCleanupSource = false
  let gitCommitSha: string | undefined
  let producerPath: string | undefined
  let commandSourceConsent: CommandSourceConsent | undefined

  // densable R0v: resolve command-source consent before materialize
  if (isCommandPluginSource(entry.source)) {
    const skip = options?.skipCommandSources === true
    let grantKey: string | undefined
    if (options?.shownSourceCommand !== undefined) {
      grantKey = options.shownSourceCommand
    } else if (!skip && options?.announceCommandSource) {
      grantKey = await options.announceCommandSource(
        pluginId,
        entry,
        installation.sourceCommand,
      )
    }

    const priorMatches =
      options?.announceCommandSource !== undefined &&
      !isCommandSourceConsentWorkspaceScoped() &&
      installation.sourceCommand === commandPluginConsentKey(entry.source)

    // densable: when announce hook is wired and user declined / display-only,
    // refuse re-run (unless prior HK still matches without workspace scope).
    if (
      options?.announceCommandSource !== undefined &&
      grantKey === undefined &&
      !priorMatches
    ) {
      return {
        success: false,
        message: `${pluginName} is installed by running a command that was not accepted, so it was not re-run. Review and accept it with \`claude plugin update ${pluginId}\`.`,
        pluginId,
        scope,
      }
    }

    if (skip) {
      return {
        success: false,
        message: `${pluginName} is installed by running a command, which the background marketplace update never runs; it is re-resolved separately once per session.`,
        pluginId,
        scope,
      }
    }

    if (grantKey !== undefined) {
      commandSourceConsent = {
        kind: 'shown',
        command: grantKey,
        pluginId,
      }
    } else {
      // densable: recorded from install record (x0v shape) when no new grant
      commandSourceConsent = {
        kind: 'recorded',
        command: isCommandSourceConsentWorkspaceScoped()
          ? undefined
          : installation.sourceCommand,
        pluginId,
      }
    }
  }

  // Handle remote vs local plugins
  if (typeof entry.source !== 'string') {
    // Remote plugin: download to temp directory first.
    // densable archive auth: same-origin url-source headers as install path
    // (cacheAndRegisterPlugin / loadPluginFromMarketplaceEntry).
    // densable R0v: pass commandSourceConsent into Pkr/cachePlugin.
    // densable 2.1.238 ggw: full entry + runEntryHelper:explicit + marketplaceSource.
    const known = await loadKnownMarketplacesConfigSafe()
    const { marketplaceName, marketplaceSource } = marketplaceSourceFromKnown(
      pluginId,
      known,
    )
    const explicit = options?.explicit === true
    const trustedSettingsEntryAuth = lookupTrustedSettingsEntryAuth(
      marketplaceName,
      entry.name,
    )
    const plan = planArchiveEntryHelperUpdate({
      pluginId,
      pluginName,
      entry,
      installedVersion: oldVersion,
      explicit,
      marketplaceSource,
      marketplaceName,
      trustedSettingsEntryAuth,
    })
    if (plan.kind === 'fail') {
      return {
        success: false,
        message: plan.message,
        pluginId,
        scope,
        failureCode: plan.failureCode,
      }
    }
    if (plan.kind === 'up_to_date') {
      return {
        success: true,
        message: `${pluginName} is already at the latest version (${plan.version}).`,
        pluginId,
        newVersion: plan.version,
        oldVersion,
        alreadyUpToDate: true,
        scope,
      }
    }
    if (plan.kind === 'skip') {
      return {
        success: false,
        message: plan.message,
        pluginId,
        oldVersion,
        scope,
        skipReason: plan.skipReason,
      }
    }

    if (
      explicit &&
      typeof entry.source === 'object' &&
      entry.source.source === 'archive'
    ) {
      const helper = getShownArchiveHeadersHelperFromOverlay(
        overlayTrustedSettingsEntryAuth({
          entry,
          archiveUrl: entry.source.url,
          marketplaceSource,
          trustedSettingsEntryAuth,
        }),
        entry.source.url,
      )
      if (helper) {
        if (options?.onEntryHelperDisclosure) {
          const verdict = await options.onEntryHelperDisclosure(
            formatEntryHelperDisclosure(helper),
          )
          if (verdict !== 'accepted') {
            return {
              success: false,
              message: ENTRY_HELPER_UPDATE_ABORT_MESSAGE,
              pluginId,
              scope,
            }
          }
        } else {
          // SEA pane qhi(consented, helper) — always compare, even if
          // getMarketplace threw in the caller (pinned() may be null).
          const qhi = compareConsentedEntryHelper({
            consented: options?.consentedEntryHelper,
            helper,
            pluginName,
            kind: 'update',
          })
          if (!qhi.ok) {
            // densable ggw: {outcome:"failed", message:E0i(...), failureCode:v0i[we]}
            return {
              success: false,
              message: formatHeadersHelperPaneMismatch(qhi),
              pluginId,
              scope,
              failureCode: entryHelperPaneMismatchFailureCode(qhi.code),
            }
          }
        }
      }
    }

    const { marketplaceHeaders, marketplaceUrl } =
      await resolveMarketplaceArchiveAuth(pluginId)
    const cacheResult = await cachePlugin(entry.source, {
      manifest: entry,
      marketplaceHeaders,
      marketplaceUrl,
      commandSourceConsent,
      runEntryHelper: explicit,
      pluginName: entry.name,
      marketplaceName,
      marketplaceSource,
      operatorAuthored: trustedSettingsEntryAuth?.origin === 'settings',
      trustedSettingsEntryAuth,
    })
    sourcePath = cacheResult.path
    shouldCleanupSource = true
    gitCommitSha = cacheResult.gitCommitSha
    producerPath = cacheResult.producerPath

    // Calculate version from downloaded plugin. For git-subdir sources,
    // cachePlugin captured the commit SHA before discarding the ephemeral
    // clone (the extracted subdir has no .git, so the installPath-based
    // fallback in calculatePluginVersion can't recover it).
    newVersion = await calculatePluginVersion(
      pluginId,
      entry.source,
      cacheResult.manifest,
      cacheResult.path,
      entry.version,
      cacheResult.gitCommitSha,
    )
  } else {
    // Local plugin: use path from marketplace
    // Stat directly — handle ENOENT inline rather than pre-checking existence
    let marketplaceStats
    try {
      marketplaceStats = await fs.stat(marketplaceInstallLocation)
    } catch (e: unknown) {
      if (isENOENT(e)) {
        return {
          success: false,
          message: `Marketplace directory not found at ${marketplaceInstallLocation}`,
          pluginId,
          scope,
        }
      }
      throw e
    }
    const marketplaceDir = marketplaceStats.isDirectory()
      ? marketplaceInstallLocation
      : dirname(marketplaceInstallLocation)
    sourcePath = join(marketplaceDir, entry.source)

    // Verify sourcePath exists. This stat is required — neither downstream
    // op reliably surfaces ENOENT:
    //   1. calculatePluginVersion → findGitRoot walks UP past a missing dir
    //      to the marketplace .git, returning the same SHA as install-time →
    //      silent false-positive {success: true, alreadyUpToDate: true}.
    //   2. copyPluginToVersionedCache (when versions differ) throws a raw
    //      ENOENT with no friendly message.
    // TOCTOU is negligible for a user-managed local dir.
    try {
      await fs.stat(sourcePath)
    } catch (e: unknown) {
      if (isENOENT(e)) {
        return {
          success: false,
          message: `Plugin source not found at ${sourcePath}`,
          pluginId,
          scope,
        }
      }
      throw e
    }

    // Try to load manifest from plugin directory (for version info)
    let pluginManifest: PluginManifest | undefined
    const manifestPath = join(sourcePath, '.claude-plugin', 'plugin.json')
    try {
      pluginManifest = await loadPluginManifest(
        manifestPath,
        entry.name,
        entry.source,
      )
    } catch {
      // Failed to load - will use other version sources
    }

    // Calculate version from plugin source path
    newVersion = await calculatePluginVersion(
      pluginId,
      entry.source,
      pluginManifest,
      sourcePath,
      entry.version,
    )
  }

  // Use try/finally to ensure temp directory cleanup on any error
  try {
    // Check if this version already exists in cache
    let versionedPath = getVersionedCachePath(pluginId, newVersion)

    // Check if installation is already at the new version
    const zipPath = getVersionedZipCachePath(pluginId, newVersion)
    const isUpToDate =
      installation.version === newVersion ||
      installation.installPath === versionedPath ||
      installation.installPath === zipPath
    if (isUpToDate) {
      return {
        success: true,
        message: `${pluginName} is already at the latest version (${newVersion}).`,
        pluginId,
        newVersion,
        oldVersion,
        alreadyUpToDate: true,
        scope,
      }
    }

    // Copy to versioned cache (returns actual path, which may be .zip)
    versionedPath = await copyPluginToVersionedCache(
      sourcePath,
      pluginId,
      newVersion,
      entry,
    )

    // Store old version path for potential cleanup
    const oldVersionPath = installation.installPath

    // densable $Tn/R0v: persist HK + producer on update; zvt deny bag
    let commandSourceMeta:
      | {
          sourceCommand?: string
          sourceProducerPath?: string
          previousProducerPaths?: string[]
        }
      | undefined
    if (isCommandPluginSource(entry.source) && commandSourceConsent) {
      const sourceCommand =
        commandSourceConsent.kind === 'shown' ||
        commandSourceConsent.kind === 'accepted'
          ? commandSourceConsent.command
          : commandSourceConsent.kind === 'recorded' &&
              commandSourceConsent.command !== undefined
            ? commandSourceConsent.command
            : commandPluginConsentKey(entry.source)
      const previousProducerPaths =
        producerPath !== undefined
          ? mergePreviousProducerPaths(installation, producerPath)
          : installation.previousProducerPaths
      commandSourceMeta = {
        sourceCommand,
        ...(producerPath !== undefined && { sourceProducerPath: producerPath }),
        ...(previousProducerPaths !== undefined && { previousProducerPaths }),
      }
      if (producerPath !== undefined) {
        denyCommandProducerDir(producerPath)
      }
    }

    // Update disk JSON file for this installation
    // (memory stays unchanged until restart)
    updateInstallationPathOnDisk(
      pluginId,
      scope,
      projectPath,
      versionedPath,
      newVersion,
      gitCommitSha,
      commandSourceMeta,
    )

    if (oldVersionPath && oldVersionPath !== versionedPath) {
      const updatedDiskData = loadInstalledPluginsFromDisk()
      const isOldVersionStillReferenced = Object.values(
        updatedDiskData.plugins,
      ).some(pluginInstallations =>
        pluginInstallations.some(inst => inst.installPath === oldVersionPath),
      )

      if (!isOldVersionStillReferenced) {
        await markPluginVersionOrphaned(oldVersionPath)
      }
    }

    const scopeDesc = projectPath ? `${scope} (${projectPath})` : scope
    const message = `Plugin "${pluginName}" updated from ${oldVersion || 'unknown'} to ${newVersion} for scope ${scopeDesc}. Restart to apply changes.`

    return {
      success: true,
      message,
      pluginId,
      newVersion,
      oldVersion,
      scope,
    }
  } finally {
    // Clean up temp source if it was a remote download
    if (
      shouldCleanupSource &&
      sourcePath !== getVersionedCachePath(pluginId, newVersion)
    ) {
      await fs.rm(sourcePath, { recursive: true, force: true })
    }
  }
}
