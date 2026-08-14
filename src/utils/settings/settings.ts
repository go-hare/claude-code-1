import { feature } from 'bun:bundle'
import mergeWith from 'lodash-es/mergeWith.js'
import { dirname, join, resolve } from 'path'
import { z } from 'zod/v4'
import {
  getFlagSettingsInline,
  getFlagSettingsPath,
  getOriginalCwd,
  getParentManagedSettings,
  getUseCoworkPlugins,
} from '../../bootstrap/state.js'
import { getRemoteManagedSettingsSyncFromCache } from '../../services/remoteManagedSettings/syncCacheState.js'
import { uniq } from '../array.js'
import { logForDebugging } from '../debug.js'
import { logForDiagnosticsNoPII } from '../diagLogs.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from '../envUtils.js'
import { getErrnoCode, isENOENT } from '../errors.js'
import { writeFileSyncAndFlush_DEPRECATED } from '../file.js'
import { readFileSync } from '../fileRead.js'
import { getFsImplementation, safeResolvePath } from '../fsOperations.js'
import { addFileGlobRuleToGitignore } from '../git/gitignore.js'
import { safeParseJSON } from '../json.js'
import { logError } from '../log.js'
import { getPlatform } from '../platform.js'
import { clone, jsonStringify } from '../slowOperations.js'
import { profileCheckpoint } from '../startupProfiler.js'
import {
  type EditableSettingSource,
  getEnabledSettingSources,
  isSettingSourceEnabled,
  type SettingSource,
} from './constants.js'
import { markInternalWrite } from './internalWrites.js'
import {
  getManagedFilePath,
  getManagedSettingsDropInDir,
} from './managedPath.js'
import { getHkcuSettings, getMdmSettings } from './mdm/settings.js'
import {
  getCachedParsedFile,
  getCachedSettingsForSource,
  getPluginSettingsBase,
  getSessionSettingsCache,
  resetSettingsCache,
  setCachedParsedFile,
  setCachedSettingsForSource,
  setSessionSettingsCache,
} from './settingsCache.js'
import { type SettingsJson, SettingsSchema } from './types.js'
import {
  applyHostManagedPolicyModelPrecedence,
  buildHostModelOverlay,
} from './hostModelOverlay.js'
import { applySettingsKeyAliases } from './settingsAliases.js'
import {
  filterInvalidPermissionRules,
  formatZodError,
  type SettingsWithErrors,
  type ValidationError,
} from './validation.js'

/**
 * densable hostManagedProvider / P4 hostManagedProvider:te.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
 * — truthy gate via residualFinalEnvGates (falls back to isEnvTruthy).
 */
function isHostManagedProviderFlag(): boolean {
  let hostManaged = isEnvTruthy(
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST,
  )
  try {
    const { isProviderManagedByHostEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../residualFinalEnvGates.js') as typeof import('../residualFinalEnvGates.js')
    hostManaged = isProviderManagedByHostEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  return hostManaged
}

/**
 * densable KZn + Gfg — parse parent managed settings and build host model overlay.
 */
function loadParentManagedAndHostOverlay(): {
  parentSettings: SettingsJson | null
  hostModelOverlay: ReturnType<typeof buildHostModelOverlay>
  hostManagedProvider: boolean
} {
  const hostManagedProvider = isHostManagedProviderFlag()
  const raw = getParentManagedSettings()
  let parentSettings: SettingsJson | null = null
  if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
    const parsed = SettingsSchema().safeParse(raw)
    if (parsed.success) {
      parentSettings = parsed.data
    } else {
      logForDebugging(
        `parent managed settings invalid: ${parsed.error.message}`,
        { level: 'warn' },
      )
    }
  }
  const hostModelOverlay = buildHostModelOverlay(
    parentSettings,
    hostManagedProvider,
  )
  return { parentSettings, hostModelOverlay, hostManagedProvider }
}

/**
 * densable nfc host finish: b6i + Object.assign(hostModelOverlay).
 */
function finishPolicySettingsForHost(
  policySettings: SettingsJson | null,
): SettingsJson | null {
  const { hostModelOverlay, hostManagedProvider } =
    loadParentManagedAndHostOverlay()
  return applyHostManagedPolicyModelPrecedence(
    policySettings,
    hostModelOverlay,
    hostManagedProvider,
  )
}

/**
 * densable 2.1.223 #11 — server-delivered settings no longer disable the env
 * block of machine-local managed-settings.json / MDM; admin env merges per key.
 * Higher-priority sources win on the same key; lower sources fill missing keys.
 * Other fields still use first-source-wins (remote > MDM > file > hkcu).
 */
export function mergeManagedEnvPerKey(
  winner: SettingsJson | null,
  lowerSources: Array<SettingsJson | null | undefined>,
): SettingsJson | null {
  if (!winner && lowerSources.every(s => !s?.env)) {
    return winner
  }
  const env: Record<string, string> = {}
  // Lower priority first, then winner last so winner keys override.
  for (const src of lowerSources) {
    if (!src?.env) continue
    for (const [k, v] of Object.entries(src.env)) {
      if (typeof v === 'string') env[k] = v
    }
  }
  if (winner?.env) {
    for (const [k, v] of Object.entries(winner.env)) {
      if (typeof v === 'string') env[k] = v
    }
  }
  if (!winner) {
    return Object.keys(env).length > 0 ? ({ env } as SettingsJson) : null
  }
  if (Object.keys(env).length === 0) {
    return winner
  }
  return { ...winner, env }
}

/**
 * densable 2.1.223 #11 — collect machine-local managed env sources under remote.
 * Order: hkcu (lowest) → file → MDM (higher among local), then remote wins keys.
 */
function collectMachineLocalManagedSettings(): {
  mdm: SettingsJson | null
  file: SettingsJson | null
  hkcu: SettingsJson | null
} {
  const mdmResult = getMdmSettings()
  const mdm =
    Object.keys(mdmResult.settings).length > 0 ? mdmResult.settings : null
  const { settings: fileSettings } = loadManagedFileSettings()
  const hkcuResult = getHkcuSettings()
  const hkcu =
    Object.keys(hkcuResult.settings).length > 0 ? hkcuResult.settings : null
  return { mdm, file: fileSettings, hkcu }
}

/**
 * densable 2.1.223 #11 — first-source-wins for policy fields, but env always
 * merges per-key across remote + machine-local admin sources.
 */
function resolvePolicySettingsWithEnvMerge(): {
  policySettings: SettingsJson | null
  policyErrors: ValidationError[]
} {
  const policyErrors: ValidationError[] = []
  let winner: SettingsJson | null = null
  let winnerKind: 'remote' | 'mdm' | 'file' | 'hkcu' | null = null

  const remoteSettings = getRemoteManagedSettingsSyncFromCache()
  if (remoteSettings && Object.keys(remoteSettings).length > 0) {
    const result = SettingsSchema().safeParse(remoteSettings)
    if (result.success) {
      winner = result.data
      winnerKind = 'remote'
    } else {
      policyErrors.push(
        ...formatZodError(result.error, 'remote managed settings'),
      )
    }
  }

  const local = collectMachineLocalManagedSettings()
  if (!winner && local.mdm) {
    winner = local.mdm
    winnerKind = 'mdm'
  } else if (local.mdm) {
    // MDM errors only matter when we fall through; still surface parse path later
  }

  if (!winner && local.file) {
    winner = local.file
    winnerKind = 'file'
  }

  if (!winner && local.hkcu) {
    winner = local.hkcu
    winnerKind = 'hkcu'
  }

  // Always merge env from machine-local under remote (or among locals).
  // densable: server-delivered must not wipe local managed env.
  if (winnerKind === 'remote') {
    winner = mergeManagedEnvPerKey(winner, [local.hkcu, local.file, local.mdm])
  } else if (winnerKind === 'mdm') {
    winner = mergeManagedEnvPerKey(winner, [local.hkcu, local.file])
  } else if (winnerKind === 'file') {
    winner = mergeManagedEnvPerKey(winner, [local.hkcu])
  }

  return { policySettings: winner, policyErrors }
}

/**
 * Get the path to the managed settings file based on the current platform
 */
function getManagedSettingsFilePath(): string {
  return join(getManagedFilePath(), 'managed-settings.json')
}

/**
 * Load file-based managed settings: managed-settings.json + managed-settings.d/*.json.
 *
 * managed-settings.json is merged first (lowest precedence / base), then drop-in
 * files are sorted alphabetically and merged on top (higher precedence, later
 * files win). This matches the systemd/sudoers drop-in convention: the base
 * file provides defaults, drop-ins customize. Separate teams can ship
 * independent policy fragments (e.g. 10-otel.json, 20-security.json) without
 * coordinating edits to a single admin-owned file.
 *
 * Exported for testing.
 */
export function loadManagedFileSettings(): {
  settings: SettingsJson | null
  errors: ValidationError[]
} {
  const errors: ValidationError[] = []
  let merged: SettingsJson = {}
  let found = false

  const { settings, errors: baseErrors } = parseSettingsFile(
    getManagedSettingsFilePath(),
  )
  errors.push(...baseErrors)
  if (settings && Object.keys(settings).length > 0) {
    merged = mergeWith(merged, settings, settingsMergeCustomizer)
    found = true
  }

  const dropInDir = getManagedSettingsDropInDir()
  try {
    const entries = getFsImplementation()
      .readdirSync(dropInDir)
      .filter(
        d =>
          (d.isFile() || d.isSymbolicLink()) &&
          d.name.endsWith('.json') &&
          !d.name.startsWith('.'),
      )
      .map(d => d.name)
      .sort()
    for (const name of entries) {
      const { settings, errors: fileErrors } = parseSettingsFile(
        join(dropInDir, name),
      )
      errors.push(...fileErrors)
      if (settings && Object.keys(settings).length > 0) {
        merged = mergeWith(merged, settings, settingsMergeCustomizer)
        found = true
      }
    }
  } catch (e) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      logError(e)
    }
  }

  return { settings: found ? merged : null, errors }
}

/**
 * Check which file-based managed settings sources are present.
 * Used by /status to show "(file)", "(drop-ins)", or "(file + drop-ins)".
 */
export function getManagedFileSettingsPresence(): {
  hasBase: boolean
  hasDropIns: boolean
} {
  const { settings: base } = parseSettingsFile(getManagedSettingsFilePath())
  const hasBase = !!base && Object.keys(base).length > 0

  let hasDropIns = false
  const dropInDir = getManagedSettingsDropInDir()
  try {
    hasDropIns = getFsImplementation()
      .readdirSync(dropInDir)
      .some(
        d =>
          (d.isFile() || d.isSymbolicLink()) &&
          d.name.endsWith('.json') &&
          !d.name.startsWith('.'),
      )
  } catch {
    // dir doesn't exist
  }

  return { hasBase, hasDropIns }
}

/**
 * Handles file system errors appropriately
 * @param error The error to handle
 * @param path The file path that caused the error
 */
function handleFileSystemError(error: unknown, path: string): void {
  if (
    typeof error === 'object' &&
    error &&
    'code' in error &&
    error.code === 'ENOENT'
  ) {
    logForDebugging(
      `Broken symlink or missing file encountered for settings.json at path: ${path}`,
    )
  } else {
    logError(error)
  }
}

/**
 * Parses a settings file into a structured format
 * @param path The path to the permissions file
 * @param source The source of the settings (optional, for error reporting)
 * @returns Parsed settings data and validation errors
 */
export function parseSettingsFile(path: string): {
  settings: SettingsJson | null
  errors: ValidationError[]
} {
  const cached = getCachedParsedFile(path)
  if (cached) {
    // Clone so callers (e.g. mergeWith in getSettingsForSourceUncached,
    // updateSettingsForSource) can't mutate the cached entry.
    return {
      settings: cached.settings ? clone(cached.settings) : null,
      errors: cached.errors,
    }
  }
  const result = parseSettingsFileUncached(path)
  setCachedParsedFile(path, result)
  // Clone the first return too — the caller may mutate before
  // another caller reads the same cache entry.
  return {
    settings: result.settings ? clone(result.settings) : null,
    errors: result.errors,
  }
}

function parseSettingsFileUncached(path: string): {
  settings: SettingsJson | null
  errors: ValidationError[]
} {
  try {
    const { resolvedPath } = safeResolvePath(getFsImplementation(), path)
    const content = readFileSync(resolvedPath)

    if (content.trim() === '') {
      return { settings: {}, errors: [] }
    }

    const data = safeParseJSON(content, false)

    // densable 2.1.232 #8 sRe — alias keys → canonical before schema parse
    const aliasWarnings: ValidationError[] = applySettingsKeyAliases(
      data,
      path,
    ).map(w => ({
      file: w.file,
      path: w.path,
      message: w.message,
    }))

    // Filter invalid permission rules before schema validation so one bad
    // rule doesn't cause the entire settings file to be rejected.
    const ruleWarnings = filterInvalidPermissionRules(data, path)

    const result = SettingsSchema().safeParse(data)

    if (!result.success) {
      const errors = formatZodError(result.error, path)
      return {
        settings: null,
        errors: [...aliasWarnings, ...ruleWarnings, ...errors],
      }
    }

    return {
      settings: result.data,
      errors: [...aliasWarnings, ...ruleWarnings],
    }
  } catch (error) {
    handleFileSystemError(error, path)
    return { settings: null, errors: [] }
  }
}

/**
 * Get the absolute path to the associated file root for a given settings source
 * (e.g. for $PROJ_DIR/.claude/settings.json, returns $PROJ_DIR)
 * @param source The source of the settings
 * @returns The root path of the settings file
 */
export function getSettingsRootPathForSource(source: SettingSource): string {
  switch (source) {
    case 'userSettings':
      return resolve(getClaudeConfigHomeDir())
    case 'policySettings':
    case 'projectSettings':
    case 'localSettings': {
      return resolve(getOriginalCwd())
    }
    case 'flagSettings': {
      const path = getFlagSettingsPath()
      return path ? dirname(resolve(path)) : resolve(getOriginalCwd())
    }
  }
}

/**
 * Get the user settings filename based on cowork mode.
 * Returns 'cowork_settings.json' when in cowork mode, 'settings.json' otherwise.
 *
 * Priority:
 * 1. Session state (set by CLI flag --cowork)
 * 2. Environment variable CLAUDE_CODE_USE_COWORK_PLUGINS
 * 3. Default: 'settings.json'
 */
function getUserSettingsFilePath(): string {
  // Official USE_COWORK_PLUGINS densable.
  let coworkPluginsEnv = isEnvTruthy(process.env.CLAUDE_CODE_USE_COWORK_PLUGINS)
  try {
    const { isCoworkPluginsEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../residualFinalEnvGates.js') as typeof import('../residualFinalEnvGates.js')
    coworkPluginsEnv = isCoworkPluginsEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (getUseCoworkPlugins() || coworkPluginsEnv) {
    return 'cowork_settings.json'
  }
  return 'settings.json'
}

export function getSettingsFilePathForSource(
  source: SettingSource,
): string | undefined {
  switch (source) {
    case 'userSettings':
      return join(
        getSettingsRootPathForSource(source),
        getUserSettingsFilePath(),
      )
    case 'projectSettings':
    case 'localSettings': {
      return join(
        getSettingsRootPathForSource(source),
        getRelativeSettingsFilePathForSource(source),
      )
    }
    case 'policySettings':
      return getManagedSettingsFilePath()
    case 'flagSettings': {
      return getFlagSettingsPath()
    }
  }
}

/**
 * densable `set` / `projectSettingsAliasesUserSettings`.
 * True when project + user settings resolve to the same absolute path
 * (e.g. cwd is the user config home). Callers then must not treat
 * projectSettings as a separate repo-scoped layer.
 */
export function projectSettingsAliasesUserSettings(): boolean {
  const projectPath = getSettingsFilePathForSource('projectSettings')
  const userPath = getSettingsFilePathForSource('userSettings')
  return (
    !!projectPath && !!userPath && resolve(projectPath) === resolve(userPath)
  )
}

/**
 * densable security-sensitive sources only (not project/local):
 * policySettings → flagSettings → userSettings.
 * Returns defined values in that priority order (first element wins).
 */
export function getSecuritySensitiveSetting<K extends keyof SettingsJson>(
  key: K,
): Array<NonNullable<SettingsJson[K]>> {
  const sources = [
    'policySettings',
    'flagSettings',
    'userSettings',
  ] as const satisfies readonly SettingSource[]
  const out: Array<NonNullable<SettingsJson[K]>> = []
  for (const source of sources) {
    const value = getSettingsForSource(source)?.[key]
    if (value !== undefined && value !== null) {
      out.push(value as NonNullable<SettingsJson[K]>)
    }
  }
  return out
}

export function getRelativeSettingsFilePathForSource(
  source: 'projectSettings' | 'localSettings',
): string {
  switch (source) {
    case 'projectSettings':
      return join('.claude', 'settings.json')
    case 'localSettings':
      return join('.claude', 'settings.local.json')
  }
}

export function getSettingsForSource(
  source: SettingSource,
): SettingsJson | null {
  const cached = getCachedSettingsForSource(source)
  if (cached !== undefined) return cached
  const result = getSettingsForSourceUncached(source)
  setCachedSettingsForSource(source, result)
  return result
}

function getSettingsForSourceUncached(
  source: SettingSource,
): SettingsJson | null {
  // For policySettings: first source wins (remote > HKLM/plist > file > HKCU)
  // densable 2.1.223 #11: env merges per-key with machine-local under remote.
  // densable nfc: under hostManagedProvider, b6i strip + Gfg hostModelOverlay.
  if (source === 'policySettings') {
    const { policySettings } = resolvePolicySettingsWithEnvMerge()
    return finishPolicySettingsForHost(policySettings)
  }

  const settingsFilePath = getSettingsFilePathForSource(source)
  const { settings: fileSettings } = settingsFilePath
    ? parseSettingsFile(settingsFilePath)
    : { settings: null }

  // For flagSettings, merge in any inline settings set via the SDK
  if (source === 'flagSettings') {
    const inlineSettings = getFlagSettingsInline()
    if (inlineSettings) {
      const parsed = SettingsSchema().safeParse(inlineSettings)
      if (parsed.success) {
        return mergeWith(
          fileSettings || {},
          parsed.data,
          settingsMergeCustomizer,
        ) as SettingsJson
      }
    }
  }

  return fileSettings
}

/**
 * Get the origin of the highest-priority active policy settings source.
 * Uses "first source wins" — returns the first source that has content.
 * Priority: remote > plist/hklm > file (managed-settings.json) > hkcu
 */
export function getPolicySettingsOrigin():
  | 'remote'
  | 'plist'
  | 'hklm'
  | 'file'
  | 'hkcu'
  | 'parent'
  | null {
  // densable YZn: helper > remote > plist/hklm > file > parent (slice/overlay) > hkcu
  // 1. Remote (highest)
  const remoteSettings = getRemoteManagedSettingsSyncFromCache()
  if (remoteSettings && Object.keys(remoteSettings).length > 0) {
    return 'remote'
  }

  // 2. Admin-only MDM (HKLM / macOS plist)
  const mdmResult = getMdmSettings()
  if (Object.keys(mdmResult.settings).length > 0) {
    return getPlatform() === 'macos' ? 'plist' : 'hklm'
  }

  // 3. managed-settings.json + managed-settings.d/ (file-based, requires admin)
  const { settings: fileSettings } = loadManagedFileSettings()
  if (fileSettings) {
    return 'file'
  }

  // densable: parentSlice || hostModelOverlay → "parent" (before hkcu)
  const { parentSettings, hostModelOverlay } = loadParentManagedAndHostOverlay()
  if (
    (parentSettings && Object.keys(parentSettings).length > 0) ||
    hostModelOverlay
  ) {
    return 'parent'
  }

  // 4. HKCU (lowest — user-writable)
  const hkcu = getHkcuSettings()
  if (Object.keys(hkcu.settings).length > 0) {
    return 'hkcu'
  }

  return null
}

/**
 * Merges `settings` into the existing settings for `source` using lodash mergeWith.
 *
 * To delete a key from a record field (e.g. enabledPlugins, extraKnownMarketplaces),
 * set it to `undefined` — do NOT use `delete`. mergeWith only detects deletion when
 * the key is present with an explicit `undefined` value.
 */
export function updateSettingsForSource(
  source: EditableSettingSource,
  settings: SettingsJson,
): { error: Error | null } {
  if (
    (source as unknown) === 'policySettings' ||
    (source as unknown) === 'flagSettings'
  ) {
    return { error: null }
  }

  // Create the folder if needed
  const filePath = getSettingsFilePathForSource(source)
  if (!filePath) {
    return { error: null }
  }

  try {
    getFsImplementation().mkdirSync(dirname(filePath))

    // Try to get existing settings with validation. Bypass the per-source
    // cache — mergeWith below mutates its target (including nested refs),
    // and mutating the cached object would leak unpersisted state if the
    // write fails before resetSettingsCache().
    let existingSettings = getSettingsForSourceUncached(source)

    // If validation failed, check if file exists with a JSON syntax error
    if (!existingSettings) {
      let content: string | null = null
      try {
        content = readFileSync(filePath)
      } catch (e) {
        if (!isENOENT(e)) {
          throw e
        }
        // File doesn't exist — fall through to merge with empty settings
      }
      if (content !== null) {
        const rawData = safeParseJSON(content)
        if (rawData === null) {
          // JSON syntax error - return validation error instead of overwriting
          // safeParseJSON will already log the error, so we'll just return the error here
          return {
            error: new Error(
              `Invalid JSON syntax in settings file at ${filePath}`,
            ),
          }
        }
        if (rawData && typeof rawData === 'object') {
          existingSettings = rawData as SettingsJson
          logForDebugging(
            `Using raw settings from ${filePath} due to validation failure`,
          )
        }
      }
    }

    const updatedSettings = mergeWith(
      existingSettings || {},
      settings,
      (
        _objValue: unknown,
        srcValue: unknown,
        key: string | number | symbol,
        object: Record<string | number | symbol, unknown>,
      ) => {
        // Handle undefined as deletion
        if (srcValue === undefined && object && typeof key === 'string') {
          delete object[key]
          return undefined
        }
        // For arrays, always replace with the provided array
        // This puts the responsibility on the caller to compute the desired final state
        if (Array.isArray(srcValue)) {
          return srcValue
        }
        // For non-arrays, let lodash handle the default merge behavior
        return undefined
      },
    )

    // Mark this as an internal write before writing the file
    markInternalWrite(filePath)

    writeFileSyncAndFlush_DEPRECATED(
      filePath,
      jsonStringify(updatedSettings, null, 2) + '\n',
    )

    // Invalidate the session cache since settings have been updated
    resetSettingsCache()

    if (source === 'localSettings') {
      // Okay to add to gitignore async without awaiting
      void addFileGlobRuleToGitignore(
        getRelativeSettingsFilePathForSource('localSettings'),
        getOriginalCwd(),
      )
    }
  } catch (e) {
    const error = new Error(
      `Failed to read raw settings from ${filePath}: ${e}`,
    )
    logError(error)
    return { error }
  }

  return { error: null }
}

/**
 * Custom merge function for arrays - concatenate and deduplicate
 */
function mergeArrays<T>(targetArray: T[], sourceArray: T[]): T[] {
  return uniq([...targetArray, ...sourceArray])
}

/**
 * densable `ssn` — whole-entry shallow merge for record maps.
 * Higher-tier keys fully replace lower-tier entries (no deep-merge of nested
 * fields like marketplace `headers`).
 */
function shallowMergeRecordEntries(
  lower: Record<string, unknown>,
  higher: Record<string, unknown>,
): Record<string, unknown> {
  return { ...lower, ...higher }
}

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  )
}

/**
 * Custom merge function for lodash mergeWith when merging settings.
 * Arrays are concatenated and deduplicated; other values use default lodash merge behavior.
 * densable `tRe` / `_ae`:
 * - key `fallbackModel`: later array **replaces** (not concat)
 * - key `extraKnownMarketplaces`: whole-entry shallow merge (`ssn`) so higher
 *   tier marketplace entries fully replace lower (headers not inherited)
 * Exported for testing.
 */
export function settingsMergeCustomizer(
  objValue: unknown,
  srcValue: unknown,
  key?: string | number | symbol,
): unknown {
  if (Array.isArray(objValue) && Array.isArray(srcValue)) {
    // densable tRe: if(r==="fallbackModel")return t
    if (key === 'fallbackModel') {
      return srcValue
    }
    return mergeArrays(objValue, srcValue)
  }
  // densable 2.1.228 #10 tRe: extraKnownMarketplaces → ssn(e,t) whole-entry
  if (
    key === 'extraKnownMarketplaces' &&
    isPlainObjectRecord(objValue) &&
    isPlainObjectRecord(srcValue)
  ) {
    return shallowMergeRecordEntries(objValue, srcValue)
  }
  // Return undefined to let lodash handle default merge behavior
  return undefined
}

/**
 * Get a list of setting keys from managed settings for logging purposes.
 * For certain nested settings (permissions, sandbox, hooks), expands to show
 * one level of nesting (e.g., "permissions.allow"). For other settings,
 * returns only the top-level key.
 *
 * @param settings The settings object to extract keys from
 * @returns Sorted array of key paths
 */
export function getManagedSettingsKeysForLogging(
  settings: SettingsJson,
): string[] {
  // Use .strip() to get only valid schema keys
  const validSettings = SettingsSchema().strip().parse(settings) as Record<
    string,
    unknown
  >
  const keysToExpand = ['permissions', 'sandbox', 'hooks']
  const allKeys: string[] = []

  // Define valid nested keys for each nested setting we expand
  const validNestedKeys: Record<string, Set<string>> = {
    permissions: new Set([
      'allow',
      'deny',
      'ask',
      'defaultMode',
      'disableBypassPermissionsMode',
      ...(feature('TRANSCRIPT_CLASSIFIER') ? ['disableAutoMode'] : []),
      'additionalDirectories',
    ]),
    sandbox: new Set([
      'enabled',
      'failIfUnavailable',
      'allowUnsandboxedCommands',
      'network',
      'filesystem',
      'ignoreViolations',
      'excludedCommands',
      'autoAllowBashIfSandboxed',
      'enableWeakerNestedSandbox',
      'enableWeakerNetworkIsolation',
      'ripgrep',
    ]),
    // For hooks, we use z.record with enum keys, so we validate separately
    hooks: new Set([
      'PreToolUse',
      'PostToolUse',
      'Notification',
      'UserPromptSubmit',
      'SessionStart',
      'SessionEnd',
      'Stop',
      'SubagentStop',
      'PreCompact',
      'PostCompact',
      'TeammateIdle',
      'TaskCreated',
      'TaskCompleted',
    ]),
  }

  for (const key of Object.keys(validSettings)) {
    if (
      keysToExpand.includes(key) &&
      validSettings[key] &&
      typeof validSettings[key] === 'object'
    ) {
      // Expand nested keys for these special settings (one level deep only)
      const nestedObj = validSettings[key] as Record<string, unknown>
      const validKeys = validNestedKeys[key]

      if (validKeys) {
        for (const nestedKey of Object.keys(nestedObj)) {
          // Only include known valid nested keys
          if (validKeys.has(nestedKey)) {
            allKeys.push(`${key}.${nestedKey}`)
          }
        }
      }
    } else {
      // For other settings, just use the top-level key
      allKeys.push(key)
    }
  }

  return allKeys.sort()
}

// Flag to prevent infinite recursion when loading settings
let isLoadingSettings = false

/**
 * Load settings from disk without using cache
 * This is the original implementation that actually reads from files
 */
function loadSettingsFromDisk(): SettingsWithErrors {
  // Prevent recursive calls to loadSettingsFromDisk
  if (isLoadingSettings) {
    return { settings: {}, errors: [] }
  }

  const startTime = Date.now()
  profileCheckpoint('loadSettingsFromDisk_start')
  logForDiagnosticsNoPII('info', 'settings_load_started')

  isLoadingSettings = true
  try {
    // Start with plugin settings as the lowest priority base.
    // All file-based sources (user, project, local, flag, policy) override these.
    // Plugin settings only contain allowlisted keys (e.g., agent) that are valid SettingsJson fields.
    const pluginSettings = getPluginSettingsBase()
    let mergedSettings: SettingsJson = {}
    if (pluginSettings) {
      mergedSettings = mergeWith(
        mergedSettings,
        pluginSettings,
        settingsMergeCustomizer,
      )
    }
    const allErrors: ValidationError[] = []
    const seenErrors = new Set<string>()
    const seenFiles = new Set<string>()

    // Merge settings from each source in priority order with deep merging
    for (const source of getEnabledSettingSources()) {
      // policySettings: "first source wins" for fields; densable 2.1.223 #11
      // env merges per-key so server-delivered does not wipe machine-local env.
      // Priority: remote > HKLM/plist > managed-settings.json > HKCU
      if (source === 'policySettings') {
        const { policySettings: resolved, policyErrors } =
          resolvePolicySettingsWithEnvMerge()
        // Surface MDM / file / hkcu validation errors even when remote wins fields.
        const mdmResult = getMdmSettings()
        policyErrors.push(...mdmResult.errors)
        const { errors: fileErrors } = loadManagedFileSettings()
        policyErrors.push(...fileErrors)
        policyErrors.push(...getHkcuSettings().errors)

        // densable nfc hostManagedProvider: b6i + hostModelOverlay (Gfg)
        // even when only overlay exists (no admin/hkcu).
        let policySettings = finishPolicySettingsForHost(resolved)

        // Merge the winning policy source into the settings chain
        if (policySettings) {
          mergedSettings = mergeWith(
            mergedSettings,
            policySettings,
            settingsMergeCustomizer,
          )
          // densable w6i: policy availableModels / enforceAvailableModels
          // re-applied as replace (not concat) after full merge.
          if (policySettings.availableModels !== undefined) {
            mergedSettings.availableModels = [...policySettings.availableModels]
          }
          if (policySettings.enforceAvailableModels !== undefined) {
            mergedSettings.enforceAvailableModels =
              policySettings.enforceAvailableModels
          }
        }
        for (const error of policyErrors) {
          const errorKey = `${error.file}:${error.path}:${error.message}`
          if (!seenErrors.has(errorKey)) {
            seenErrors.add(errorKey)
            allErrors.push(error)
          }
        }

        continue
      }

      const filePath = getSettingsFilePathForSource(source)
      if (filePath) {
        const resolvedPath = resolve(filePath)

        // Skip if we've already loaded this file from another source
        if (!seenFiles.has(resolvedPath)) {
          seenFiles.add(resolvedPath)

          const { settings, errors } = parseSettingsFile(filePath)

          // Add unique errors (deduplication)
          for (const error of errors) {
            const errorKey = `${error.file}:${error.path}:${error.message}`
            if (!seenErrors.has(errorKey)) {
              seenErrors.add(errorKey)
              allErrors.push(error)
            }
          }

          if (settings) {
            mergedSettings = mergeWith(
              mergedSettings,
              settings,
              settingsMergeCustomizer,
            )
          }
        }
      }

      // For flagSettings, also merge any inline settings set via the SDK
      if (source === 'flagSettings') {
        const inlineSettings = getFlagSettingsInline()
        if (inlineSettings) {
          const parsed = SettingsSchema().safeParse(inlineSettings)
          if (parsed.success) {
            mergedSettings = mergeWith(
              mergedSettings,
              parsed.data,
              settingsMergeCustomizer,
            )
          }
        }
      }
    }

    logForDiagnosticsNoPII('info', 'settings_load_completed', {
      duration_ms: Date.now() - startTime,
      source_count: seenFiles.size,
      error_count: allErrors.length,
    })

    return { settings: mergedSettings, errors: allErrors }
  } finally {
    isLoadingSettings = false
  }
}

/**
 * Get merged settings from all sources in priority order
 * Settings are merged from lowest to highest priority:
 * userSettings -> projectSettings -> localSettings -> policySettings
 *
 * This function returns a snapshot of settings at the time of call.
 * For React components, prefer using useSettings() hook for reactive updates
 * when settings change on disk.
 *
 * Uses session-level caching to avoid repeated file I/O.
 * Cache is invalidated when settings files change via resetSettingsCache().
 *
 * @returns Merged settings from all available sources (always returns at least empty object)
 */
export function getInitialSettings(): SettingsJson {
  const { settings } = getSettingsWithErrors()
  return settings || {}
}

/**
 * @deprecated Use getInitialSettings() instead. This alias exists for backwards compatibility.
 */
export const getSettings_DEPRECATED = getInitialSettings

export type SettingsWithSources = {
  effective: SettingsJson
  /** Ordered low-to-high priority — later entries override earlier ones. */
  sources: Array<{ source: SettingSource; settings: SettingsJson }>
}

/**
 * Get the effective merged settings alongside the raw per-source settings,
 * in merge-priority order. Only includes sources that are enabled and have
 * non-empty content.
 *
 * Always reads fresh from disk — resets the session cache so that `effective`
 * and `sources` are consistent even if the change detector hasn't fired yet.
 */
export function getSettingsWithSources(): SettingsWithSources {
  // Reset both caches so getSettingsForSource (per-source cache) and
  // getInitialSettings (session cache) agree on the current disk state.
  resetSettingsCache()
  const sources: SettingsWithSources['sources'] = []
  for (const source of getEnabledSettingSources()) {
    const settings = getSettingsForSource(source)
    if (settings && Object.keys(settings).length > 0) {
      sources.push({ source, settings })
    }
  }
  return { effective: getInitialSettings(), sources }
}

/**
 * Get merged settings and validation errors from all sources
 * This function now uses session-level caching to avoid repeated file I/O.
 * Settings changes require Claude Code restart, so cache is valid for entire session.
 * @returns Merged settings and all validation errors encountered
 */
export function getSettingsWithErrors(): SettingsWithErrors {
  // Use cached result if available
  const cached = getSessionSettingsCache()
  if (cached !== null) {
    return cached
  }

  // Load from disk and cache the result
  const result = loadSettingsFromDisk()
  profileCheckpoint('loadSettingsFromDisk_end')
  setSessionSettingsCache(result)
  return result
}

/**
 * Check if any raw settings file contains a specific key, regardless of validation.
 * This is useful for detecting user intent even when settings validation fails.
 * For example, if a user set cleanupPeriodDays but has validation errors elsewhere,
 * we can detect they explicitly configured cleanup and skip cleanup rather than
 * falling back to defaults.
 */
/**
 * Returns true if any trusted settings source has accepted the bypass
 * permissions mode dialog. projectSettings is intentionally excluded —
 * a malicious project could otherwise auto-bypass the dialog (RCE risk).
 */
export function hasSkipDangerousModePermissionPrompt(): boolean {
  return !!(
    getSettingsForSource('userSettings')?.skipDangerousModePermissionPrompt ||
    getSettingsForSource('localSettings')?.skipDangerousModePermissionPrompt ||
    getSettingsForSource('flagSettings')?.skipDangerousModePermissionPrompt ||
    getSettingsForSource('policySettings')?.skipDangerousModePermissionPrompt
  )
}

/**
 * Returns true if any trusted settings source has accepted the auto
 * mode opt-in dialog. projectSettings is intentionally excluded —
 * a malicious project could otherwise auto-bypass the dialog (RCE risk).
 */
export function hasAutoModeOptIn(): boolean {
  // Auto mode is available to all users — no opt-in needed
  return true
}

/**
 * Returns whether plan mode should use auto mode semantics. Default true
 * (opt-out). Returns false if any trusted source explicitly sets false.
 * projectSettings is excluded so a malicious project can't control this.
 */
export function getUseAutoModeDuringPlan(): boolean {
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    return (
      getSettingsForSource('policySettings')?.useAutoModeDuringPlan !== false &&
      getSettingsForSource('flagSettings')?.useAutoModeDuringPlan !== false &&
      getSettingsForSource('userSettings')?.useAutoModeDuringPlan !== false &&
      getSettingsForSource('localSettings')?.useAutoModeDuringPlan !== false
    )
  }
  return true
}

export type AskUserQuestionTimeout = '60s' | '5m' | '10m' | 'never'

/**
 * Official 2.1.200: idle timeout for AskUserQuestion auto-continue.
 * Defaults to `never` (no auto-continue unless explicitly configured).
 * Override with CLAUDE_AFK_TIMEOUT_MS for absolute ms (testing/managed).
 */
export function getAskUserQuestionTimeout(): AskUserQuestionTimeout {
  const value = getInitialSettings().askUserQuestionTimeout
  if (
    value === '60s' ||
    value === '5m' ||
    value === '10m' ||
    value === 'never'
  ) {
    return value
  }
  return 'never'
}

/** Convert setting enum to milliseconds, or null when auto-continue is off. */
export function askUserQuestionTimeoutToMs(
  value: AskUserQuestionTimeout | undefined = getAskUserQuestionTimeout(),
): number | null {
  const envMs = process.env.CLAUDE_AFK_TIMEOUT_MS
  if (envMs !== undefined && envMs !== '') {
    const parsed = parseInt(envMs, 10)
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  switch (value) {
    case '60s':
      return 60_000
    case '5m':
      return 300_000
    case '10m':
      return 600_000
    case 'never':
    case undefined:
      return null
  }
}

/** densable 2.1.224 #5 — same enum as askUserQuestionTimeout. */
export type DialogExpiry = '60s' | '5m' | '10m' | 'never'

/**
 * densable IZi / H7e("dialogExpiry")[0] — default `5m` when unset.
 * Trusted sources only for the deadline (see resolveDialogExpiryFromSources).
 */
export function getDialogExpiry(): DialogExpiry {
  return resolveDialogExpiryFromSources() ?? '5m'
}

/**
 * densable: dialogExpiry is not taken from a checked-in project settings file.
 * Prefer policy → flag → user; project/local only if stricter/present after
 * trusted sources left it unset (we simply ignore project/local entirely to
 * match "never a checked-in repo settings file").
 */
export function resolveDialogExpiryFromSources(
  getSource: typeof getSettingsForSource = getSettingsForSource,
  isEnabled: typeof isSettingSourceEnabled = isSettingSourceEnabled,
): DialogExpiry | undefined {
  for (const source of [
    'policySettings',
    'flagSettings',
    'userSettings',
  ] as const) {
    if (!isEnabled(source)) continue
    const v = getSource(source)?.dialogExpiry
    if (v === '60s' || v === '5m' || v === '10m' || v === 'never') {
      return v
    }
  }
  return undefined
}

/**
 * densable dialogExpiry → ms; null when "never".
 * CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS overrides when set (positive int).
 */
export function dialogExpiryToMs(
  value: DialogExpiry | undefined = getDialogExpiry(),
): number | null {
  const envMs = process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS
  if (envMs !== undefined && envMs !== '') {
    const parsed = parseInt(envMs, 10)
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  switch (value) {
    case '60s':
      return 60_000
    case '5m':
      return 300_000
    case '10m':
      return 600_000
    case 'never':
    case undefined:
      return null
  }
}

/** densable 2.1.224 #5 — inbound cross-session policy. */
export type CrossSessionInbound = 'accept' | 'hold' | 'refuse'

/**
 * densable TPr() — resolve crossSessionInbound across settings sources.
 * Trusted first (policy → flag → user): first explicit wins.
 * Project/local may only *tighten* (accept < hold < refuse) over the current value.
 */
export function resolveCrossSessionInbound(
  getSource: typeof getSettingsForSource = getSettingsForSource,
  isEnabled: typeof isSettingSourceEnabled = isSettingSourceEnabled,
): CrossSessionInbound | undefined {
  const rank: Record<CrossSessionInbound, number> = {
    accept: 0,
    hold: 1,
    refuse: 2,
  }
  let resolved: CrossSessionInbound | undefined
  for (const source of [
    'policySettings',
    'flagSettings',
    'userSettings',
  ] as const) {
    if (!isEnabled(source)) continue
    const v = getSource(source)?.crossSessionInbound
    if (v === 'accept' || v === 'hold' || v === 'refuse') {
      resolved = v
      break
    }
  }
  for (const source of ['localSettings', 'projectSettings'] as const) {
    if (!isEnabled(source)) continue
    const v = getSource(source)?.crossSessionInbound
    if (v === 'accept' || v === 'hold' || v === 'refuse') {
      if (rank[v] > rank[resolved ?? 'accept']) {
        resolved = v
      }
    }
  }
  return resolved
}

export function getCrossSessionInbound(): CrossSessionInbound | undefined {
  return resolveCrossSessionInbound()
}

/**
 * Returns the merged autoMode config from trusted settings sources.
 * Only available when TRANSCRIPT_CLASSIFIER is active; returns undefined otherwise.
 *
 * Source policy (official Claude Code 2.1.207):
 * - projectSettings excluded — malicious project could inject classifier rules
 * - localSettings (`.claude/settings.local.json`) also excluded since 2.1.207 —
 *   repo-resident autoMode is ignored; use `~/.claude/settings.json` instead
 * - userSettings / flagSettings / policySettings are honored
 */
export function getAutoModeConfig():
  | {
      allow?: string[]
      soft_deny?: string[]
      hard_deny?: string[]
      environment?: string[]
    }
  | undefined {
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    const schema = z.object({
      allow: z.array(z.string()).optional(),
      soft_deny: z.array(z.string()).optional(),
      hard_deny: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
      environment: z.array(z.string()).optional(),
    })

    const allow: string[] = []
    const soft_deny: string[] = []
    const hard_deny: string[] = []
    const environment: string[] = []

    for (const source of [
      'userSettings',
      // localSettings intentionally omitted — official 2.1.207 no longer reads
      // autoMode from `.claude/settings.local.json` (repo-resident).
      'flagSettings',
      'policySettings',
    ] as const) {
      const settings = getSettingsForSource(source)
      if (!settings) continue
      const result = schema.safeParse(
        (settings as Record<string, unknown>).autoMode,
      )
      if (result.success) {
        if (result.data.allow) allow.push(...result.data.allow)
        if (result.data.soft_deny) soft_deny.push(...result.data.soft_deny)
        if (result.data.hard_deny) hard_deny.push(...result.data.hard_deny)
        if (process.env.USER_TYPE === 'ant') {
          if (result.data.deny) soft_deny.push(...result.data.deny)
        }
        if (result.data.environment)
          environment.push(...result.data.environment)
      }
    }

    if (
      allow.length > 0 ||
      soft_deny.length > 0 ||
      hard_deny.length > 0 ||
      environment.length > 0
    ) {
      return {
        ...(allow.length > 0 && { allow }),
        ...(soft_deny.length > 0 && { soft_deny }),
        ...(hard_deny.length > 0 && { hard_deny }),
        ...(environment.length > 0 && { environment }),
      }
    }
  }
  return undefined
}

export function rawSettingsContainsKey(key: string): boolean {
  for (const source of getEnabledSettingSources()) {
    // Skip policySettings - we only care about user-configured settings
    if (source === 'policySettings') {
      continue
    }

    const filePath = getSettingsFilePathForSource(source)
    if (!filePath) {
      continue
    }

    try {
      const { resolvedPath } = safeResolvePath(getFsImplementation(), filePath)
      const content = readFileSync(resolvedPath)
      if (!content.trim()) {
        continue
      }

      const rawData = safeParseJSON(content, false)
      if (rawData && typeof rawData === 'object' && key in rawData) {
        return true
      }
    } catch (error) {
      // File not found is expected - not all settings files exist
      // Other errors (permissions, I/O) should be tracked
      handleFileSystemError(error, filePath)
    }
  }

  return false
}
