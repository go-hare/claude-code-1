/**
 * Background plugin autoupdate functionality
 *
 * At startup, this module:
 * 1. First updates marketplaces that have autoUpdate enabled
 * 2. Then checks all installed plugins from those marketplaces and updates them
 *
 * Updates are non-inplace (disk-only), requiring a restart to take effect.
 * Official Anthropic marketplaces have autoUpdate enabled by default,
 * but users can disable it per-marketplace.
 */

import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { updatePluginOp } from '../../services/plugins/pluginOperations.js'
import { shouldSkipPluginAutoupdate } from '../config.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { logError } from '../log.js'
import { sleep } from '../sleep.js'
import {
  getPendingUpdatesDetails,
  hasPendingUpdates,
  isInstallationRelevantToCurrentProject,
  loadInstalledPluginsFromDisk,
} from './installedPluginsManager.js'
import {
  getDeclaredMarketplaces,
  loadKnownMarketplacesConfig,
  refreshMarketplace,
} from './marketplaceManager.js'
import { parsePluginIdentifier } from './pluginIdentifier.js'
import { isMarketplaceAutoUpdate, type PluginScope } from './schemas.js'

/**
 * Callback type for notifying when plugins have been updated
 */
export type PluginAutoUpdateCallback = (updatedPlugins: string[]) => void

// Store callback for plugin update notifications
let pluginUpdateCallback: PluginAutoUpdateCallback | null = null

// Store pending updates that occurred before callback was registered
// This handles the race condition where updates complete before REPL mounts
let pendingNotification: string[] | null = null

/**
 * Register a callback to be notified when plugins are auto-updated.
 * This is used by the REPL to show restart notifications.
 *
 * If plugins were already updated before the callback was registered,
 * the callback will be invoked immediately with the pending updates.
 */
export function onPluginsAutoUpdated(
  callback: PluginAutoUpdateCallback,
): () => void {
  pluginUpdateCallback = callback

  // If there are pending updates that happened before registration, deliver them now
  if (pendingNotification !== null && pendingNotification.length > 0) {
    callback(pendingNotification)
    pendingNotification = null
  }

  return () => {
    pluginUpdateCallback = null
  }
}

/**
 * Check if pending updates came from autoupdate (for notification purposes).
 * Returns the list of plugin names that have pending updates.
 */
export function getAutoUpdatedPluginNames(): string[] {
  if (!hasPendingUpdates()) {
    return []
  }
  return getPendingUpdatesDetails().map(
    d => parsePluginIdentifier(d.pluginId).name,
  )
}

/**
 * Get the set of marketplaces that have autoUpdate enabled.
 * Returns the marketplace names that should be auto-updated.
 */
async function getAutoUpdateEnabledMarketplaces(): Promise<Set<string>> {
  const config = await loadKnownMarketplacesConfig()
  const declared = getDeclaredMarketplaces()
  const enabled = new Set<string>()

  for (const [name, entry] of Object.entries(config)) {
    // Settings-declared autoUpdate takes precedence over JSON state
    const declaredAutoUpdate = declared[name]?.autoUpdate
    const autoUpdate =
      declaredAutoUpdate !== undefined
        ? declaredAutoUpdate
        : isMarketplaceAutoUpdate(name, entry)
    if (autoUpdate) {
      enabled.add(name.toLowerCase())
    }
  }

  return enabled
}

/**
 * #1861 (2.1.321): Deduplicate plugin installations by scope while preserving
 * first-seen order so multiple worktrees or sub-folders of the same repository
 * do not trigger duplicate downloads/updates in a single auto-update pass.
 */
export function dedupeInstallationsByScope(
  installations: ReadonlyArray<{ scope: PluginScope; projectPath?: string }>,
): PluginScope[] {
  const seen = new Set<PluginScope>()
  const scopes: PluginScope[] = []
  for (const { scope } of installations) {
    if (!seen.has(scope)) {
      seen.add(scope)
      scopes.push(scope)
    }
  }
  return scopes
}

/**
 * Update a single plugin's installations.
 * Returns the plugin ID if any installation was updated, null otherwise.
 */
async function updatePlugin(
  pluginId: string,
  installations: Array<{ scope: PluginScope; projectPath?: string }>,
): Promise<string | null> {
  let wasUpdated = false

  // #1861: Deduplicate by scope so multiple worktrees of a repo update once per scope
  for (const scope of dedupeInstallationsByScope(installations)) {
    try {
      // densable: background marketplace update never re-runs command sources;
      // #1749: updatePluginOp resolves and installs any newly added plugin dependencies.
      const result = await updatePluginOp(pluginId, scope, {
        skipCommandSources: true,
      })

      if (result.success && !result.alreadyUpToDate) {
        wasUpdated = true
        const depsSuffix =
          result.installedDependencies &&
          result.installedDependencies.length > 0
            ? ` (installed dependencies: ${result.installedDependencies.join(', ')})`
            : ''
        logForDebugging(
          `Plugin autoupdate: updated ${pluginId} from ${result.oldVersion} to ${result.newVersion}${depsSuffix}`,
        )
      } else if (
        result.skipReason === 'entry_helper_deferred' ||
        result.skipReason === 'engine_range'
      ) {
        logForDebugging(
          `Plugin autoupdate: skipped ${pluginId} (${result.skipReason}): ${result.message}`,
        )
      } else if (
        result.failureCode === 'dependencies_not_installed' ||
        result.failureCode === 'dependencies_not_screened'
      ) {
        logForDebugging(
          `Plugin autoupdate: dependency step failed for ${pluginId} (${result.failureCode}): ${result.message}`,
          { level: 'warn' },
        )
      } else if (!result.alreadyUpToDate) {
        logForDebugging(
          `Plugin autoupdate: failed to update ${pluginId}: ${result.message}`,
          { level: 'warn' },
        )
      }
    } catch (error) {
      logForDebugging(
        `Plugin autoupdate: error updating ${pluginId}: ${errorMessage(error)}`,
        { level: 'warn' },
      )
    }
  }

  return wasUpdated ? pluginId : null
}

/**
 * Update all project-relevant installed plugins from the given marketplaces.
 *
 * Iterates installed_plugins.json, filters to plugins whose marketplace is in
 * the set, further filters each plugin's installations to those relevant to
 * the current project (user/managed scope, or project/local scope matching
 * cwd — see isInstallationRelevantToCurrentProject), then calls updatePluginOp
 * per installation. Already-up-to-date plugins are silently skipped.
 *
 * Called by:
 * - updatePlugins() below — background autoupdate path (autoUpdate-enabled
 *   marketplaces only; third-party marketplaces default autoUpdate: false)
 * - ManageMarketplaces.tsx applyChanges() — user-initiated /plugin marketplace
 *   update. Before #29512 this path only called refreshMarketplace() (git
 *   pull on the marketplace clone), so the loader would create the new
 *   version cache dir but installed_plugins.json stayed on the old version,
 *   and the orphan GC stamped the NEW dir with .orphaned_at on next startup.
 *
 * @param marketplaceNames - lowercase marketplace names to update plugins from
 * @returns plugin IDs that were actually updated (not already up-to-date)
 */
export async function updatePluginsForMarketplaces(
  marketplaceNames: Set<string>,
): Promise<string[]> {
  const installedPlugins = loadInstalledPluginsFromDisk()
  const pluginIds = Object.keys(installedPlugins.plugins)

  if (pluginIds.length === 0) {
    return []
  }

  const results = await Promise.allSettled(
    pluginIds.map(async pluginId => {
      const { marketplace } = parsePluginIdentifier(pluginId)
      if (!marketplace || !marketplaceNames.has(marketplace.toLowerCase())) {
        return null
      }

      const allInstallations = installedPlugins.plugins[pluginId]
      if (!allInstallations || allInstallations.length === 0) {
        return null
      }

      const relevantInstallations = allInstallations.filter(
        isInstallationRelevantToCurrentProject,
      )
      if (relevantInstallations.length === 0) {
        return null
      }

      return updatePlugin(pluginId, relevantInstallations)
    }),
  )

  return results
    .filter(
      (r): r is PromiseFulfilledResult<string> =>
        r.status === 'fulfilled' && r.value !== null,
    )
    .map(r => r.value)
}

/**
 * Update plugins from marketplaces that have autoUpdate enabled.
 * Returns the list of plugin IDs that were updated.
 */
async function updatePlugins(
  autoUpdateEnabledMarketplaces: Set<string>,
): Promise<string[]> {
  return updatePluginsForMarketplaces(autoUpdateEnabledMarketplaces)
}

/** Official 2.1.328 `pe`: max startup jitter (10 minutes) before background plugin refresh. */
export const PLUGIN_AUTOUPDATE_MAX_JITTER_MS = 600_000

/**
 * Auto-update marketplaces and plugins in the background.
 *
 * This function:
 * 1. Checks `shouldSkipPluginAutoupdate()` (honoring `CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST`)
 * 2. Checks which marketplaces have autoUpdate enabled
 * 3. Sleeps a random startup jitter (`0..PLUGIN_AUTOUPDATE_MAX_JITTER_MS`, unref'd)
 * 4. Refreshes only those marketplaces (git pull/re-download)
 * 5. Updates installed plugins from those marketplaces
 * 6. Emits `tengu_plugin_autoupdate_pass` telemetry
 * 7. If any plugins were updated, notifies via the registered callback
 *
 * Official Anthropic marketplaces have autoUpdate enabled by default,
 * but users can disable it per-marketplace in the UI.
 *
 * This function runs silently without blocking user interaction.
 * Called from main.tsx during startup as a background job.
 */
export function autoUpdateMarketplacesAndPluginsInBackground(
  maxJitterMs: number = PLUGIN_AUTOUPDATE_MAX_JITTER_MS,
): void {
  void (async () => {
    let startTime = Date.now()
    const stats = {
      marketplaces_refreshed: 0,
      marketplace_refresh_failed: 0,
      marketplace_refresh_policy_skipped: 0,
      plugins_updated: 0,
      plugin_update_failed: 0,
      plugins_blocked_by_pin: 0,
      plugins_helper_deferred: 0,
      plugins_policy_blocked: 0,
    }

    if (shouldSkipPluginAutoupdate()) {
      logForDebugging('Plugin autoupdate: skipped (auto-updater disabled)')
      return
    }

    try {
      // Get marketplaces with autoUpdate enabled
      const autoUpdateEnabledMarketplaces =
        await getAutoUpdateEnabledMarketplaces()

      if (autoUpdateEnabledMarketplaces.size === 0) {
        return
      }

      // Official 2.1.328 `V()`: spread background marketplace fetches across startup window
      if (maxJitterMs > 0) {
        const jitterMs = Math.floor(Math.random() * maxJitterMs)
        await sleep(jitterMs, undefined, { unref: true })
      }
      startTime = Date.now()

      // Refresh only marketplaces with autoUpdate enabled
      const refreshResults = await Promise.allSettled(
        Array.from(autoUpdateEnabledMarketplaces).map(async name => {
          try {
            await refreshMarketplace(name, undefined, {
              disableCredentialHelper: true,
            })
            return 'refreshed' as const
          } catch (error) {
            logForDebugging(
              `Plugin autoupdate: failed to refresh marketplace ${name}: ${errorMessage(error)}`,
              { level: 'warn' },
            )
            return 'failed' as const
          }
        }),
      )

      const failedCount = refreshResults.filter(
        r =>
          r.status === 'rejected' ||
          (r.status === 'fulfilled' && r.value === 'failed'),
      ).length
      stats.marketplace_refresh_failed = failedCount
      stats.marketplaces_refreshed =
        autoUpdateEnabledMarketplaces.size - failedCount

      if (failedCount > 0) {
        logForDebugging(
          `Plugin autoupdate: ${failedCount} marketplace refresh(es) failed`,
          { level: 'warn' },
        )
      }

      logForDebugging('Plugin autoupdate: checking installed plugins')
      const updatedPlugins = await updatePlugins(autoUpdateEnabledMarketplaces)
      stats.plugins_updated = updatedPlugins.length

      if (updatedPlugins.length > 0) {
        if (pluginUpdateCallback) {
          // Callback is already registered, invoke it immediately
          pluginUpdateCallback(updatedPlugins)
        } else {
          // Callback not yet registered (REPL not mounted), store for later delivery
          pendingNotification = updatedPlugins
        }
      }

      const outcome =
        stats.marketplace_refresh_failed > 0 || stats.plugin_update_failed > 0
          ? 'partial'
          : 'ok'
      logEvent('tengu_plugin_autoupdate_pass', {
        outcome:
          outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...stats,
        duration_ms: Date.now() - startTime,
      })
    } catch (error) {
      logError(error)
      logEvent('tengu_plugin_autoupdate_pass', {
        outcome:
          'failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...stats,
        duration_ms: Date.now() - startTime,
      })
    }
  })()
}
