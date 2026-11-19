/**
 * Official 2.1.326 #330 (`lza`, `zmt`, `xMr`, `BBt`):
 * Worktree sessions skip repository-level plugin settings (`extraKnownMarketplaces`
 * and repo `enabledPlugins` from `.claude/settings.json` / `.claude/settings.local.json`)
 * when running inside a linked/isolated worktree, and surface a notice naming what
 * was skipped so the user can run Claude in the main checkout once if needed.
 */

import { realpathSync } from 'fs'
import { dirname, resolve, sep } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getCwd } from '../cwd.js'
import {
  getInitialSettings,
  getSettingsFilePathForSource,
  getSettingsForSource,
} from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'

function getWorktreeHelpers(): {
  getCurrentWorktreeSession: () => { worktreePath: string } | null
  isLinkedWorktree: (path: string) => boolean
} {
  // Lazy require breaks the static ESM cycle:
  // worktree.ts -> marketplaceManager.ts -> worktreePluginSettings.ts -> worktree.ts
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../worktree.js') as {
    getCurrentWorktreeSession: () => { worktreePath: string } | null
    isLinkedWorktree: (path: string) => boolean
  }
}

export const WORKTREE_PLUGIN_SETTINGS_FLAG = 'tengu_nifty_squirrel'

const NON_REPO_SETTINGS_SOURCES = [
  'userSettings',
  'flagSettings',
  'policySettings',
] as const

const WORKTREE_NOTICE_NAME_MAX = 13

function safeRealpath(targetPath: string): string | null {
  try {
    return realpathSync(targetPath)
  } catch {
    return null
  }
}

function isPathInsideDir(targetPath: string, dirPath: string): boolean {
  const normTarget = resolve(targetPath)
  const normDir = resolve(dirPath)
  return normTarget === normDir || normTarget.startsWith(`${normDir}${sep}`)
}

function hasClaudeWorktreesSegment(targetPath: string): boolean {
  const normalized = targetPath.replaceAll('\\', '/')
  return /(?:^|\/)\.claude\/worktrees\/[^/]+(?:\/|$)/.test(normalized)
}

/**
 * Official `lza(projectSettingsPath)`: determine whether `projectSettingsPath`
 * (or the current session CWD) resides inside an isolated/linked git worktree.
 */
export function isWorktreeProjectSettingsPath(
  projectSettingsPath?: string,
): boolean {
  const targetPath =
    projectSettingsPath ??
    getSettingsFilePathForSource('projectSettings') ??
    resolve(getCwd(), '.claude', 'settings.json')
  const realTarget = safeRealpath(targetPath)

  const { getCurrentWorktreeSession, isLinkedWorktree } = getWorktreeHelpers()
  const session = getCurrentWorktreeSession()
  if (session) {
    const wtReal = safeRealpath(session.worktreePath) ?? session.worktreePath
    if (
      isPathInsideDir(targetPath, session.worktreePath) ||
      isPathInsideDir(targetPath, wtReal) ||
      (realTarget !== null &&
        (isPathInsideDir(realTarget, session.worktreePath) ||
          isPathInsideDir(realTarget, wtReal)))
    ) {
      return true
    }
  }

  if (
    hasClaudeWorktreesSegment(targetPath) ||
    (realTarget !== null && hasClaudeWorktreesSegment(realTarget))
  ) {
    return true
  }

  // Check if the settings file's project directory is a linked git worktree
  const projectDir = dirname(dirname(resolve(targetPath)))
  try {
    if (isLinkedWorktree(projectDir)) {
      return true
    }
  } catch {
    // ignore git probe errors
  }

  return false
}

/**
 * Official 2.1.326 #330: returns true when the current worktree session should
 * skip repository-level plugin settings (`projectSettings` / `localSettings`).
 */
export function shouldSkipWorktreeRepoPluginSettings(opts?: {
  projectSettingsPath?: string
  featureEnabled?: boolean
}): boolean {
  const enabled =
    opts?.featureEnabled ??
    getFeatureValue_CACHED_MAY_BE_STALE(WORKTREE_PLUGIN_SETTINGS_FLAG, true)
  if (!enabled) return false
  return isWorktreeProjectSettingsPath(opts?.projectSettingsPath)
}

/**
 * Collect `extraKnownMarketplaces` declared only in non-repo settings sources
 * (`userSettings`, `flagSettings`, `policySettings`), excluding repo
 * `projectSettings` and `localSettings`.
 */
export function getNonRepoExtraKnownMarketplaces(): NonNullable<
  SettingsJson['extraKnownMarketplaces']
> {
  const merged: NonNullable<SettingsJson['extraKnownMarketplaces']> = {}
  for (const source of NON_REPO_SETTINGS_SOURCES) {
    const entries = getSettingsForSource(source)?.extraKnownMarketplaces
    if (entries) {
      Object.assign(merged, entries)
    }
  }
  return merged
}

/**
 * Collect `enabledPlugins` declared only in non-repo settings sources
 * (`userSettings`, `flagSettings`, `policySettings`).
 */
export function getNonRepoEnabledPlugins(): NonNullable<
  SettingsJson['enabledPlugins']
> {
  const merged: NonNullable<SettingsJson['enabledPlugins']> = {}
  for (const source of NON_REPO_SETTINGS_SOURCES) {
    const entries = getSettingsForSource(source)?.enabledPlugins
    if (entries) {
      Object.assign(merged, entries)
    }
  }
  return merged
}

function truncateMarketplaceName(name: string, maxLen: number): string {
  const clean = name.replace(/[\r\n\t]+/g, ' ').trim()
  if (clean.length <= maxLen) return clean
  return `${clean.slice(0, Math.max(1, maxLen - 1))}…`
}

export type SkippedWorktreePluginSettingsSummary = {
  skippedMarketplaces: string[]
  skippedPlugins: string[]
  notice: string | null
}

/**
 * Official 2.1.326 #330 (`xMr`): compute which repo-declared marketplaces (and
 * plugins) were skipped by a worktree session and format the user-facing notice.
 */
export function buildSkippedWorktreePluginSettingsNotice(opts: {
  isSkipping: boolean
  initialExtraMarketplaces?: Record<string, unknown>
  declaredMarketplaces: Record<string, unknown>
  knownMarketplaces: Record<string, unknown>
  initialEnabledPlugins?: Record<string, unknown>
  nonRepoEnabledPlugins?: Record<string, unknown>
}): SkippedWorktreePluginSettingsSummary {
  if (!opts.isSkipping) {
    return { skippedMarketplaces: [], skippedPlugins: [], notice: null }
  }
  const initialMkts = opts.initialExtraMarketplaces ?? {}
  const skippedMarketplaces = Object.keys(initialMkts).filter(
    name =>
      !Object.hasOwn(opts.declaredMarketplaces, name) &&
      !Object.hasOwn(opts.knownMarketplaces, name),
  )

  const initialPlugins = opts.initialEnabledPlugins ?? {}
  const nonRepoPlugins = opts.nonRepoEnabledPlugins ?? {}
  const skippedPlugins = Object.entries(initialPlugins)
    .filter(
      ([pluginId, val]) =>
        val !== false && !Object.hasOwn(nonRepoPlugins, pluginId),
    )
    .map(([pluginId]) => pluginId)

  if (skippedMarketplaces.length === 1) {
    return {
      skippedMarketplaces,
      skippedPlugins,
      notice: `Skipped marketplace "${truncateMarketplaceName(skippedMarketplaces[0]!, WORKTREE_NOTICE_NAME_MAX)}". If main has it, run Claude there once.`,
    }
  }
  if (skippedMarketplaces.length > 1) {
    return {
      skippedMarketplaces,
      skippedPlugins,
      notice: `Skipped ${skippedMarketplaces.length} marketplaces. If main has them, run Claude there once.`,
    }
  }
  if (skippedPlugins.length === 1) {
    return {
      skippedMarketplaces,
      skippedPlugins,
      notice: `Skipped plugin setting "${truncateMarketplaceName(skippedPlugins[0]!, WORKTREE_NOTICE_NAME_MAX)}". If main has it, run Claude there once.`,
    }
  }
  if (skippedPlugins.length > 1) {
    return {
      skippedMarketplaces,
      skippedPlugins,
      notice: `Skipped ${skippedPlugins.length} plugin settings. If main has them, run Claude there once.`,
    }
  }
  return { skippedMarketplaces: [], skippedPlugins: [], notice: null }
}

/**
 * Convenience wrapper for production callers (`headlessPluginInstall.ts`,
 * `performStartupChecks.tsx`, and interactive notification provider `BBt`).
 */
export function getSkippedWorktreeMarketplacesNotice(opts: {
  declaredMarketplaces: Record<string, unknown>
  knownMarketplaces: Record<string, unknown>
  projectSettingsPath?: string
  featureEnabled?: boolean
}): string | null {
  const isSkipping = shouldSkipWorktreeRepoPluginSettings({
    projectSettingsPath: opts.projectSettingsPath,
    featureEnabled: opts.featureEnabled,
  })
  if (!isSkipping) return null
  const initial = getInitialSettings()
  return buildSkippedWorktreePluginSettingsNotice({
    isSkipping,
    initialExtraMarketplaces: initial.extraKnownMarketplaces,
    declaredMarketplaces: opts.declaredMarketplaces,
    knownMarketplaces: opts.knownMarketplaces,
    initialEnabledPlugins: initial.enabledPlugins,
    nonRepoEnabledPlugins: getNonRepoEnabledPlugins(),
  }).notice
}
