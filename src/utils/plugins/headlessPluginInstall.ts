/**
 * Plugin installation for headless/CCR mode.
 *
 * This module provides plugin installation without AppState updates,
 * suitable for non-interactive environments like CCR.
 *
 * When CLAUDE_CODE_PLUGIN_USE_ZIP_CACHE is enabled, plugins are stored as
 * ZIPs on a mounted volume. The storage layer (pluginLoader.ts) handles
 * ZIP creation on install and extraction on load transparently.
 */

import { logEvent } from '../../services/analytics/index.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { withDiagnosticsTiming } from '../diagLogs.js'
import { getFsImplementation } from '../fsOperations.js'
import { logError } from '../log.js'
import {
  getInFlightManagedExternalPluginFetch,
  migrateFromEnabledPlugins,
} from './installedPluginsManager.js'
import {
  clearMarketplacesCache,
  getDeclaredMarketplaces,
  loadKnownMarketplacesConfig,
  registerSeedMarketplaces,
} from './marketplaceManager.js'
import { getSkippedWorktreeMarketplacesNotice } from './worktreePluginSettings.js'
import { detectAndUninstallDelistedPlugins } from './pluginBlocklist.js'
import { clearPluginCache } from './pluginLoader.js'
import { reconcileMarketplaces } from './reconciler.js'
import {
  cleanupSessionPluginCache,
  getZipCacheMarketplacesDir,
  getZipCachePluginsDir,
  isMarketplaceSourceSupportedByZipCache,
  isPluginZipCacheEnabled,
} from './zipCache.js'
import { syncMarketplacesToZipCache } from './zipCacheAdapters.js'

/** Official 2.1.328 `b`/`D` (#644) — max 30s drain so short runs finish recording fresh git-marketplace plugins. */
export const HEADLESS_PLUGIN_RECORD_DRAIN_MS = 30_000

let headlessInstallPass: Promise<void> | undefined
let activeHeadlessRecordPromise: Promise<void> | undefined

/**
 * Official 2.1.328 (#644): wait up to `timeoutMs` (default 30s) for any
 * in-flight headless enabled-plugin record/fetch pass to complete before
 * exiting a short `claude -p`, SDK, or Claude Desktop session.
 */
export async function waitForHeadlessPluginInstallDrain(
  timeoutMs: number = HEADLESS_PLUGIN_RECORD_DRAIN_MS,
): Promise<boolean> {
  const pending: Promise<unknown>[] = []
  if (headlessInstallPass) pending.push(headlessInstallPass)
  if (activeHeadlessRecordPromise) pending.push(activeHeadlessRecordPromise)
  const bgFetch = getInFlightManagedExternalPluginFetch()
  if (bgFetch) pending.push(bgFetch)
  if (pending.length === 0) return true

  let timer: ReturnType<typeof setTimeout> | undefined
  let completedInTime = false
  try {
    await Promise.race([
      Promise.allSettled(pending).then(() => {
        completedInTime = true
      }),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  return completedInTime
}

/**
 * Official 2.1.328 `L` (#644): record enabled plugins immediately after fresh
 * git marketplaces reconcile in headless/SDK/Desktop sessions, holding a
 * bounded 30s drain so a short run does not exit before recording finishes.
 */
async function recordEnabledPluginsForHeadless(
  fetchMissing: boolean,
): Promise<void> {
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) {
    logForDebugging(
      'installPluginsForHeadless: not recording enabled plugins: CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set; the next start records them',
      { level: 'warn' },
    )
    return
  }
  if (process.env.CLAUDE_CODE_SYNC_PLUGIN_INSTALL) {
    logForDebugging(
      'installPluginsForHeadless: not recording enabled plugins: CLAUDE_CODE_SYNC_PLUGIN_INSTALL is set, so a full load follows',
    )
    return
  }
  logForDebugging('installPluginsForHeadless: recording enabled plugins')
  const recordPromise = withDiagnosticsTiming(
    'headless_enabled_plugins_record',
    () => migrateFromEnabledPlugins({ fetchMissing }),
  ).catch(err => {
    logForDebugging(
      `installPluginsForHeadless: failed to record enabled plugins: ${err instanceof Error ? err.message : String(err)}`,
      { level: 'error' },
    )
  })
  activeHeadlessRecordPromise = recordPromise
  const unregisterDrain = registerCleanup(() =>
    waitForHeadlessPluginInstallDrain(HEADLESS_PLUGIN_RECORD_DRAIN_MS).then(
      () => undefined,
    ),
  )
  try {
    await recordPromise
  } finally {
    if (activeHeadlessRecordPromise === recordPromise) {
      activeHeadlessRecordPromise = undefined
    }
    unregisterDrain()
  }
}

/**
 * Install plugins for headless/CCR mode.
 *
 * This is the headless equivalent of performBackgroundPluginInstallations(),
 * but without AppState updates (no UI to update in headless mode).
 *
 * @returns true if any plugins were installed (caller should refresh MCP)
 */
export function installPluginsForHeadless(opts?: {
  /** Official 2.1.328 (#643/#644): fetch missing managed external git plugins in background. Default true. */
  fetchMissing?: boolean
}): Promise<boolean> {
  const run = (headlessInstallPass ?? Promise.resolve()).then(() =>
    runInstallPluginsForHeadless(opts),
  )
  headlessInstallPass = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function runInstallPluginsForHeadless(opts?: {
  fetchMissing?: boolean
}): Promise<boolean> {
  const zipCacheMode = isPluginZipCacheEnabled()
  logForDebugging(
    `installPluginsForHeadless: starting${zipCacheMode ? ' (zip cache mode)' : ''}`,
  )

  // Register seed marketplaces (CLAUDE_CODE_PLUGIN_SEED_DIR) before diffing.
  // Idempotent; no-op if seed not configured. Without this, findMissingMarketplaces
  // would see seed entries as missing → clone → defeats seed's purpose.
  //
  // If registration changed state, clear caches so the early plugin-load pass
  // (which runs during CLI startup before this function) doesn't keep stale
  // "marketplace not found" results. Without this clear, a first-boot headless
  // run with a seed-cached plugin would show 0 plugin commands/agents/skills
  // in the init message even though the seed has everything.
  const seedChanged = await registerSeedMarketplaces()
  if (seedChanged) {
    clearMarketplacesCache()
    clearPluginCache('headlessPluginInstall: seed marketplaces registered')
  }

  // Ensure zip cache directory structure exists
  if (zipCacheMode) {
    await getFsImplementation().mkdir(getZipCacheMarketplacesDir())
    await getFsImplementation().mkdir(getZipCachePluginsDir())
  }

  // Declared now includes an implicit claude-plugins-official entry when any
  // enabled plugin references it (see getDeclaredMarketplaces). This routes
  // the official marketplace through the same reconciler path as any other —
  // which composes correctly with CLAUDE_CODE_PLUGIN_SEED_DIR: seed registers
  // it in known_marketplaces.json, reconciler diff sees it as upToDate, no clone.
  const declared = getDeclaredMarketplaces()
  const declaredCount = Object.keys(declared).length

  // Official 2.1.326 #330 (`xMr`): notify when a worktree session skipped
  // repo-declared plugin settings / marketplaces.
  try {
    const known = await loadKnownMarketplacesConfig()
    const skippedNotice = getSkippedWorktreeMarketplacesNotice({
      declaredMarketplaces: declared,
      knownMarketplaces: known,
    })
    if (skippedNotice !== null) {
      logForDebugging(`installPluginsForHeadless: ${skippedNotice}`, {
        level: 'warn',
      })
      process.stderr.write(`${skippedNotice}\n`)
    }
  } catch {
    // Non-fatal notice probe
  }

  const metrics = {
    marketplaces_installed: 0,
    delisted_count: 0,
  }

  // Initialize from seedChanged so the caller (print.ts) calls
  // refreshPluginState() → clearCommandsCache/clearAgentDefinitionsCache
  // when seed registration added marketplaces. Without this, the caller
  // only refreshes when an actual plugin install happened.
  let pluginsChanged = seedChanged

  try {
    if (declaredCount === 0) {
      logForDebugging('installPluginsForHeadless: no marketplaces declared')
    } else {
      // Reconcile declared marketplaces (settings intent + implicit official)
      // with materialized state. Zip cache: skip unsupported source types.
      const reconcileResult = await withDiagnosticsTiming(
        'headless_marketplace_reconcile',
        () =>
          reconcileMarketplaces({
            skip: zipCacheMode
              ? (_name, source) =>
                  !isMarketplaceSourceSupportedByZipCache(source)
              : undefined,
            onProgress: event => {
              if (event.type === 'installed') {
                logForDebugging(
                  `installPluginsForHeadless: installed marketplace ${event.name}`,
                )
              } else if (event.type === 'failed') {
                logForDebugging(
                  `installPluginsForHeadless: failed to install marketplace ${event.name}: ${event.error}`,
                )
              }
            },
          }),
        r => ({
          installed_count: r.installed.length,
          updated_count: r.updated.length,
          failed_count: r.failed.length,
          skipped_count: r.skipped.length,
        }),
      )

      if (reconcileResult.skipped.length > 0) {
        logForDebugging(
          `installPluginsForHeadless: skipped ${reconcileResult.skipped.length} marketplace(s) unsupported by zip cache: ${reconcileResult.skipped.join(', ')}`,
        )
      }

      const marketplacesChanged =
        reconcileResult.installed.length + reconcileResult.updated.length

      // Clear caches so newly-installed marketplace plugins are discoverable.
      // Plugin caching is the loader's job — after caches clear, the caller's
      // refreshPluginState() → loadAllPlugins() will cache any missing plugins
      // from the newly-materialized marketplaces.
      if (marketplacesChanged > 0) {
        clearMarketplacesCache()
        // Official 2.1.328 (#644): record enabled plugins right after fresh git
        // marketplaces reconcile (and kick off background git fetches for #643)
        // so managed-settings plugins load on the next/current session quickly.
        await recordEnabledPluginsForHeadless(opts?.fetchMissing !== false)
        clearPluginCache('headlessPluginInstall: marketplaces reconciled')
        pluginsChanged = true
      }

      metrics.marketplaces_installed = marketplacesChanged
    }

    // Zip cache: save marketplace JSONs for offline access on ephemeral containers.
    // Runs unconditionally so that steady-state containers (all plugins installed)
    // still sync marketplace data that may have been cloned in a previous run.
    if (zipCacheMode) {
      await syncMarketplacesToZipCache()
    }

    // Delisting enforcement
    const newlyDelisted = await detectAndUninstallDelistedPlugins()
    metrics.delisted_count = newlyDelisted.length
    if (newlyDelisted.length > 0) {
      pluginsChanged = true
    }

    if (pluginsChanged) {
      clearPluginCache('headlessPluginInstall: plugins changed')
    }

    // Zip cache: register session cleanup for extracted plugin temp dirs
    if (zipCacheMode) {
      registerCleanup(cleanupSessionPluginCache)
    }

    return pluginsChanged
  } catch (error) {
    logError(error)
    return false
  } finally {
    logEvent('tengu_headless_plugin_install', metrics)
  }
}
