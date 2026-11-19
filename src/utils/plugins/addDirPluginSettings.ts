/**
 * Reads plugin-related settings (enabledPlugins, extraKnownMarketplaces)
 * from --add-dir directories.
 *
 * These have the LOWEST priority — callers must spread standard settings
 * on top so that user/project/local/flag/policy sources all override.
 *
 * #1811 (2.1.319): Gated by `tengu_tawny_thrush`, `--add-dir` directories only
 * contribute `extraKnownMarketplaces` (and interactive `enabledPlugins`) once
 * that directory's own trust dialog has been accepted (`hasTrustDialogAccepted`
 * on the directory's own config key, not an ancestor's).
 * #1781 (2.1.319): When `CLAUDE_CODE_IGNORE_PERSISTED_TRUST` is truthy, no
 * persisted trust record counts, so `--add-dir` plugin settings are ignored.
 */

import { realpathSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import type { z } from 'zod/v4'
import {
  getAdditionalDirectoriesForClaudeMd,
  getIsNonInteractiveSession,
} from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { logEvent } from '../../services/analytics/index.js'
import { getGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { findCanonicalGitRootUncached } from '../git.js'
import { normalizePathForConfigKey } from '../path.js'
import { parseSettingsFile } from '../settings/settings.js'
import type {
  ExtraKnownMarketplaceSchema,
  SettingsJson,
} from '../settings/types.js'

type ExtraKnownMarketplace = z.infer<
  ReturnType<typeof ExtraKnownMarketplaceSchema>
>

const SETTINGS_FILES = ['settings.json', 'settings.local.json'] as const
const TAWNY_THRUSH_FLAG = 'tengu_tawny_thrush'

const warnedUntrustedDirs = new Set<string>()

/** Reset warning dedup cache for tests. */
export function resetAddDirTrustWarningsForTesting(): void {
  warnedUntrustedDirs.clear()
}

/**
 * #1781: Returns true when persisted workspace trust records must be ignored
 * (e.g. self-hosted runner started with `--trust-workspace false`).
 */
export function isPersistedTrustIgnored(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_IGNORE_PERSISTED_TRUST)
}

/**
 * Resolve the canonical trust-record key for an `--add-dir` directory.
 * Returns `null` if the directory cannot be resolved to a real folder
 * (missing, broken/looping symlink, etc.).
 */
export function resolveAddDirTrustKey(dir: string): string | null {
  const abs = resolve(dir)
  let canonical: string
  try {
    canonical = realpathSync(abs)
  } catch {
    return null
  }
  const gitRoot = findCanonicalGitRootUncached(canonical)
  return normalizePathForConfigKey(gitRoot ?? canonical)
}

/**
 * #1811: Check whether `dir` has its OWN persisted trust dialog acceptance
 * (`config.projects[trustKey].hasTrustDialogAccepted === true`), never
 * inheriting from a parent directory and never trusting the home directory's
 * persisted record.
 */
export function hasOwnTrustDialogAcceptedForAddDir(dir: string): boolean {
  if (isPersistedTrustIgnored()) {
    return false
  }
  const trustKey = resolveAddDirTrustKey(dir)
  if (trustKey === null) {
    return false
  }
  const homeKey = normalizePathForConfigKey(resolve(homedir()))
  if (trustKey === homeKey) {
    return false
  }
  const config = getGlobalConfig()
  return config.projects?.[trustKey]?.hasTrustDialogAccepted === true
}

function filterTrustedAddDirs(
  kind: 'extraKnownMarketplaces' | 'enabledPlugins',
): string[] {
  const dirs = getAdditionalDirectoriesForClaudeMd()
  if (!getFeatureValue_CACHED_MAY_BE_STALE(TAWNY_THRUSH_FLAG, true)) {
    return dirs
  }
  const interactive = !getIsNonInteractiveSession()
  if (kind === 'enabledPlugins' && !interactive) {
    return dirs
  }

  const trusted: string[] = []
  for (const dir of dirs) {
    if (hasOwnTrustDialogAcceptedForAddDir(dir)) {
      trusted.push(dir)
      continue
    }

    const abs = resolve(dir)
    if (warnedUntrustedDirs.has(abs)) {
      continue
    }
    warnedUntrustedDirs.add(abs)

    let extraMarketplacesCount = 0
    let enabledPluginsCount = 0
    const sourcesWithEntries: string[] = []
    for (const file of SETTINGS_FILES) {
      const filePath = join(dir, '.claude', file)
      const { settings } = parseSettingsFile(filePath)
      const mkts = Object.keys(settings?.extraKnownMarketplaces ?? {}).length
      const plugins = interactive
        ? Object.values(settings?.enabledPlugins ?? {}).filter(v => v !== false)
            .length
        : 0
      if (mkts + plugins > 0) {
        sourcesWithEntries.push(filePath)
      }
      extraMarketplacesCount += mkts
      enabledPluginsCount += plugins
    }

    if (extraMarketplacesCount + enabledPluginsCount > 0) {
      const trustKey = resolveAddDirTrustKey(dir)
      const reason =
        trustKey === null
          ? ", because the directory's own path could not be resolved to a real folder, so no trust record can match it."
          : isPersistedTrustIgnored()
            ? ': no workspace trust record counts in this process because CLAUDE_CODE_IGNORE_PERSISTED_TRUST is set.'
            : `, because ${trustKey}, where that directory's trust is recorded, has not been trusted. Run Claude Code interactively in ${trustKey} once and accept its trust dialog.`
      const parts = [
        extraMarketplacesCount > 0
          ? `${extraMarketplacesCount} extraKnownMarketplaces ${extraMarketplacesCount === 1 ? 'entry' : 'entries'}`
          : null,
        enabledPluginsCount > 0
          ? `${enabledPluginsCount} enabledPlugins ${enabledPluginsCount === 1 ? 'entry' : 'entries'}`
          : null,
      ].filter((p): p is string => p !== null)
      logForDebugging(
        `Ignoring ${parts.join(' and ')} in ${sourcesWithEntries.join(' and ')}, the settings of a directory added to this session (as --add-dir does)${reason}`,
        { level: 'warn' },
      )
      logEvent('tengu_add_dir_plugin_settings_untrusted', {
        extra_known_marketplaces: extraMarketplacesCount,
        enabled_plugins: enabledPluginsCount,
      })
    }
  }
  return trusted
}

/**
 * Returns a merged record of enabledPlugins from all --add-dir directories.
 *
 * Within each directory, settings.local.json is processed after settings.json
 * (local wins within that dir). Across directories, later CLI-order wins on
 * conflict.
 *
 * This has the lowest priority — callers must spread their standard settings
 * on top to let user/project/local/flag/policy override.
 */
export function getAddDirEnabledPlugins(): NonNullable<
  SettingsJson['enabledPlugins']
> {
  const result: NonNullable<SettingsJson['enabledPlugins']> = {}
  for (const dir of filterTrustedAddDirs('enabledPlugins')) {
    for (const file of SETTINGS_FILES) {
      const { settings } = parseSettingsFile(join(dir, '.claude', file))
      if (!settings?.enabledPlugins) {
        continue
      }
      Object.assign(result, settings.enabledPlugins)
    }
  }
  return result
}

/**
 * Returns a merged record of extraKnownMarketplaces from all trusted --add-dir
 * directories (#1811: gated on `tengu_tawny_thrush`).
 *
 * Same priority rules as getAddDirEnabledPlugins: settings.local.json wins
 * within each dir, and callers spread standard settings on top.
 */
export function getAddDirExtraMarketplaces(): Record<
  string,
  ExtraKnownMarketplace
> {
  const result: Record<string, ExtraKnownMarketplace> = {}
  for (const dir of filterTrustedAddDirs('extraKnownMarketplaces')) {
    for (const file of SETTINGS_FILES) {
      const { settings } = parseSettingsFile(join(dir, '.claude', file))
      if (!settings?.extraKnownMarketplaces) {
        continue
      }
      Object.assign(result, settings.extraKnownMarketplaces)
    }
  }
  return result
}
