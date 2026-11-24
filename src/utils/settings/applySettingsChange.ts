import {
  getAdditionalDirectoriesForClaudeMd,
  getOriginalCwd,
} from '../../bootstrap/state.js'
import {
  getRepoScopedSettingSources,
  latchBlockReadsOutsideWorkingDirectories,
} from '../../memdir/paths.js'
import type { AppState } from '../../state/AppState.js'
import type { ToolPermissionContext } from '../../Tool.js'
import { clearMemoryFileCaches } from '../claudemd.js'
import { getGlobalConfig } from '../config.js'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { getUltracodeEffortForModel, teSettingsEffortTable } from '../effort.js'
import { isBareMode, isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { updateHooksConfigSnapshot } from '../hooks/hooksConfigSnapshot.js'
import { getMainLoopModel } from '../model/model.js'
import { expandPath } from '../path.js'
import { settingsHaveBlockWritesOutsideWorkingDirectories } from '../permissions/filesystem.js'
import { settingsHaveBlockReadsOutsideWorkingDirectories } from '../permissions/outsideReads.js'
import { applyPermissionUpdate } from '../permissions/PermissionUpdate.js'
import {
  applyBlockWritesOutsideWorkingDirectories,
  applyManagedAutoModeExit,
  createDisabledBypassPermissionsContext,
  findOverlyBroadBashPermissions,
  isBypassPermissionsModeDisabled,
  removeDangerousPermissions,
  transitionPlanAutoMode,
} from '../permissions/permissionSetup.js'
import {
  applyDenyInsteadOfPrompting,
  syncPermissionRulesFromDisk,
} from '../permissions/permissions.js'
import { loadAllPermissionRulesFromDisk } from '../permissions/permissionsLoader.js'
import { collectUngatedAdditionalDirectories } from '../permissions/projectGrantsGate.js'
import { rewriteFlagSettingsTrustedNetworkDirectories } from '../permissions/trustedNetworkDirectories.js'
import type { SettingsChangeExtra } from './changeDetector.js'
import { getEnabledSettingSources, type SettingSource } from './constants.js'
import { notifyStrictPluginOnlyPolicyIfChanged } from './pluginOnlyPolicy.js'
import { getInitialSettings, getSettingsForSource } from './settings.js'
import type { SettingsJson } from './types.js'

/**
 * densable apply `C` — session-owned add-dir sources are not reconciled on
 * project-settings churn (`cliArg` / `command` / `session`).
 */
function isSessionOwnedWorkingDirectorySource(
  source: string | undefined,
): boolean {
  return source === 'cliArg' || source === 'command' || source === 'session'
}

/**
 * densable apply `P`/`K` — resolve an additionalDirectory, or drop it.
 */
function resolveAdditionalDirectory(dir: string, cwd?: string): string[] {
  try {
    return [expandPath(dir, cwd ?? getCwd())]
  } catch {
    return []
  }
}

/**
 * Official 2.1.328 `Hdr` (chunk@288385318.js): partition declared
 * `permissions.additionalDirectories` into `repoOnly` (only declared in
 * repo-scoped setting sources, i.e. `projectSettings` or git-tracked
 * `localSettings`) vs trusted sources (`userSettings`, `policySettings`,
 * `flagSettings`, untracked `localSettings`, CLI `--add-dir`).
 */
function classifyDeclaredAdditionalDirectories(
  expand: (dir: string) => string[],
): { declared: Set<string>; repoOnly: Set<string> } {
  const repoSources = getRepoScopedSettingSources()
  const enabledSources = getEnabledSettingSources()
  const collectFrom = (sources: readonly SettingSource[]): Set<string> =>
    new Set(
      sources.flatMap(s =>
        enabledSources.includes(s)
          ? (
              getSettingsForSource(s)?.permissions?.additionalDirectories ?? []
            ).flatMap(expand)
          : [],
      ),
    )
  const repoOnly = collectFrom(repoSources)
  const nonRepo = new Set<string>([
    ...collectFrom(
      enabledSources.filter(
        s => !(repoSources as readonly string[]).includes(s),
      ),
    ),
    ...getAdditionalDirectoriesForClaudeMd().flatMap(expand),
  ])
  for (const dir of nonRepo) {
    repoOnly.delete(dir)
  }
  return {
    declared: new Set([...repoOnly, ...nonRepo]),
    repoOnly,
  }
}

/**
 * Official 2.1.328 `s6t()` (chunk@305180987.js): recompute whether session
 * away-summary recap is enabled after a settings change.
 */
export function computeAwaySummaryEnabled(settings: SettingsJson): boolean {
  const envVal = process.env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY
  if (isEnvDefinedFalsy(envVal)) return false
  if (isEnvTruthy(envVal)) return true
  if (isBareMode()) return false
  if (settings.awaySummaryEnabled === false) return false
  return true
}

/**
 * Resolve showMessageTimestamps consistently across initial state and live
 * settings reloads: explicit settings.json value wins over global config.
 */
export function computeShowMessageTimestamps(settings: SettingsJson): boolean {
  return Boolean(
    settings.showMessageTimestamps ?? getGlobalConfig().showMessageTimestamps,
  )
}

/**
 * Official 2.1.328 `cCs` (chunk@306338118.js): reconcile `additionalDirectories`
 * on settings change, `/cd` (`prevCwd`), or explicit trust flip, distinguishing
 * repo-only `'projectSettings'` vs trusted `'localSettings'` provenance so
 * repo-controlled directories cannot bypass the outside-read fence.
 */
export function reconcileAdditionalDirectories(
  context: ToolPermissionContext,
  previousAdditionalDirectories: string[] | undefined,
  currentAdditionalDirectories: string[] | undefined,
  source: SettingSource,
  trustFlip = false,
  prevCwd?: string,
): ToolPermissionContext {
  const previous = new Set(
    (previousAdditionalDirectories ?? []).flatMap(dir =>
      resolveAdditionalDirectory(dir, prevCwd),
    ),
  )
  const current = new Set(
    (currentAdditionalDirectories ?? []).flatMap(dir =>
      resolveAdditionalDirectory(dir),
    ),
  )
  const owned = context.additionalWorkingDirectories
  const toRemove = [...previous].filter(
    dir =>
      !current.has(dir) &&
      !isSessionOwnedWorkingDirectorySource(owned.get(dir)?.source),
  )
  const toAdd = [...current].filter(
    dir =>
      (!previous.has(dir) || (trustFlip && !owned.has(dir))) &&
      !isSessionOwnedWorkingDirectorySource(owned.get(dir)?.source),
  )
  const originalCwd = getOriginalCwd()
  const { declared, repoOnly } = classifyDeclaredAdditionalDirectories(dir => [
    ...(originalCwd ? resolveAdditionalDirectory(dir, originalCwd) : []),
    ...resolveAdditionalDirectory(dir),
  ])
  const destinationFor = (dir: string): 'projectSettings' | 'localSettings' =>
    repoOnly.has(dir) ? 'projectSettings' : 'localSettings'
  const toReclassify = [...owned.entries()].filter(
    ([dir, entry]) =>
      !isSessionOwnedWorkingDirectorySource(entry.source) &&
      !toRemove.includes(dir) &&
      declared.has(dir) &&
      entry.source !== destinationFor(dir),
  )
  if (
    toRemove.length === 0 &&
    toAdd.length === 0 &&
    toReclassify.length === 0 &&
    source !== 'flagSettings'
  ) {
    return context
  }
  let next = context
  if (toReclassify.length > 0) {
    const updatedDirs = new Map(owned)
    for (const [dir, entry] of toReclassify) {
      updatedDirs.set(dir, { ...entry, source: destinationFor(dir) })
    }
    next = {
      ...next,
      additionalWorkingDirectories: updatedDirs,
    }
  }
  if (source === 'flagSettings') {
    const flagDirs = new Set(
      (
        getSettingsForSource('flagSettings')?.permissions
          ?.additionalDirectories ?? []
      ).flatMap(dir => resolveAdditionalDirectory(dir)),
    )
    const rewritten = rewriteFlagSettingsTrustedNetworkDirectories(
      next,
      flagDirs,
      { toRemove, toAdd },
    )
    if (rewritten) {
      next = {
        ...next,
        trustedNetworkDirectories: rewritten.trustedNetworkDirectories,
      }
    }
  }
  if (toRemove.length > 0) {
    next = applyPermissionUpdate(next, {
      type: 'removeDirectories',
      directories: toRemove,
      destination: 'localSettings',
    })
  }
  if (toAdd.length > 0) {
    for (const dest of ['projectSettings', 'localSettings'] as const) {
      const dirsForDest = toAdd.filter(dir => destinationFor(dir) === dest)
      if (dirsForDest.length > 0) {
        next = applyPermissionUpdate(next, {
          type: 'addDirectories',
          directories: dirsForDest,
          destination: dest,
        })
      }
    }
  }
  return next
}

/**
 * densable Obe / oE — drop the previous project's additionalDirectories from
 * the live permission context after `/cd` `p()` / set_cwd `ft`.
 * Returns the same context reference when there is nothing to retire.
 */
export function retireDepartedAdditionalDirectories(
  context: ToolPermissionContext,
  directories: string[] | undefined,
): ToolPermissionContext {
  if (!directories || directories.length === 0) {
    return context
  }
  const owned = context.additionalWorkingDirectories
  const toRemove = directories.filter(
    dir =>
      owned.has(dir) &&
      !isSessionOwnedWorkingDirectorySource(owned.get(dir)?.source),
  )
  if (toRemove.length === 0) {
    return context
  }
  return applyPermissionUpdate(context, {
    type: 'removeDirectories',
    directories: toRemove,
    destination: 'localSettings',
  })
}

/**
 * Apply a settings change to app state. Re-reads settings from disk,
 * reloads permissions and hooks, and pushes the new state.
 *
 * Used by both the interactive path (AppState.tsx via useSettingsChange) and
 * the headless/SDK path (print.ts direct subscribe) so that managed-settings
 * / policy changes are fully applied in both modes.
 *
 * The settings cache is reset by the notifier (changeDetector.fanOut) before
 * listeners are iterated, so getInitialSettings() here reads fresh disk
 * state. Previously this function reset the cache itself, which — combined
 * with useSettingsChange's own reset — caused N disk reloads per notification
 * for N subscribers.
 *
 * Side-effects like clearing auth caches and applying env vars are handled by
 * `onChangeAppState` which fires when `settings` changes in state.
 */
export function applySettingsChange(
  source: SettingSource,
  setAppState: (f: (prev: AppState) => AppState) => void,
  extra?: SettingsChangeExtra,
): void {
  const newSettings = getInitialSettings()

  logForDebugging(`Settings changed from ${source}, updating app state`)

  const updatedRules = loadAllPermissionRulesFromDisk()
  updateHooksConfigSnapshot()
  notifyStrictPluginOnlyPolicyIfChanged()

  setAppState(prev => {
    let newContext = syncPermissionRulesFromDisk(
      prev.toolPermissionContext,
      updatedRules,
    )
    newContext = reconcileAdditionalDirectories(
      newContext,
      prev.settings.permissions?.additionalDirectories,
      collectUngatedAdditionalDirectories(),
      source,
      extra?.trustFlip === true,
      extra?.prevCwd,
    )

    // Ant-only: re-strip overly broad Bash allow rules after settings sync
    if (
      process.env.USER_TYPE === 'ant' &&
      process.env.CLAUDE_CODE_ENTRYPOINT !== 'local-agent'
    ) {
      const overlyBroad = findOverlyBroadBashPermissions(updatedRules, [])
      if (overlyBroad.length > 0) {
        newContext = removeDangerousPermissions(newContext, overlyBroad)
      }
    }

    if (
      newContext.isBypassPermissionsModeAvailable &&
      isBypassPermissionsModeDisabled()
    ) {
      newContext = createDisabledBypassPermissionsContext(newContext)
    }

    newContext = transitionPlanAutoMode(newContext)
    newContext = applyManagedAutoModeExit(newContext)

    // Official 2.1.328 `h2n` (chunk@306338118.js): latch outside-read block,
    // enforce outside-write block, and update denyInsteadOfPrompting live.
    if (
      newContext.blockReadsOutsideWorkingDirectories !== true &&
      settingsHaveBlockReadsOutsideWorkingDirectories()
    ) {
      newContext = {
        ...newContext,
        blockReadsOutsideWorkingDirectories: true,
      }
      latchBlockReadsOutsideWorkingDirectories()
    }
    if (settingsHaveBlockWritesOutsideWorkingDirectories()) {
      newContext = applyBlockWritesOutsideWorkingDirectories(newContext)
    }
    newContext = applyDenyInsteadOfPrompting(newContext)

    // Invalidate memory caches whenever permissions/settings change (official `kHt()`).
    clearMemoryFileCaches()

    // densable 2.1.289: settingsEffortTable refreshes per-model/legacy settings
    // while leaving sessionEffort untouched (`{ kind: 'inherit' }` resolves
    // dynamically via pdSessionEffort; explicit session overrides stay intact).
    // ultracode is orthogonal to effortLevel — never force wire effort to xhigh
    // and never clear ultracode when effortLevel changes.
    const nextSettingsEffortTable =
      teSettingsEffortTable() ?? prev.settingsEffortTable
    const prevUltra = prev.settings.ultracode === true
    const newUltra = newSettings.ultracode === true
    const ultraChanged = prevUltra !== newUltra

    let ultracodePatch: Partial<AppState> = {}
    if (ultraChanged) {
      if (newUltra) {
        const model = getMainLoopModel()
        const wire = getUltracodeEffortForModel(model)
        ultracodePatch = { ultracode: wire !== undefined }
      } else {
        ultracodePatch = { ultracode: false }
      }
    }

    const nextAwaySummaryEnabled = computeAwaySummaryEnabled(newSettings)
    const nextShowMessageTimestamps = computeShowMessageTimestamps(newSettings)

    return {
      ...prev,
      settings: newSettings,
      settingsEffortTable: nextSettingsEffortTable,
      toolPermissionContext: newContext,
      ...ultracodePatch,
      ...(prev.awaySummaryEnabled !== nextAwaySummaryEnabled
        ? { awaySummaryEnabled: nextAwaySummaryEnabled }
        : {}),
      ...(prev.showMessageTimestamps !== nextShowMessageTimestamps
        ? { showMessageTimestamps: nextShowMessageTimestamps }
        : {}),
    }
  })
}
