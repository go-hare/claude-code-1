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
import { stripProjectScopedTracingSettings } from '../projectScopedTracingStrip.js'
import { logForDiagnosticsNoPII } from '../diagLogs.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from '../envUtils.js'
import { isHoverRestOn } from '../storageV5/hoverRestPin.js'
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
  getSettingsOwner,
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

/**
 * Official FMe @179441524 (content path; policy flag collapsed in leftover to
 * the same SettingsSchema parse as parseSettingsFile). Used by settingsPrime
 * Vjt/wn/On without reading disk again.
 */
export function parseSettingsFileContent(
  content: string,
  path: string,
): {
  settings: SettingsJson | null
  errors: ValidationError[]
} {
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
    severity: w.severity,
  }))

  // Filter invalid permission rules before schema validation so one bad
  // rule doesn't cause the entire settings file to be rejected.
  const ruleWarnings = filterInvalidPermissionRules(data, path)

  // densable 2.1.248 #37 ho() user-path — strip unrecognized
  // crossSessionInbound so the rest of the file still loads, and emit the
  // settings warning N() reads. Hold only.
  const inboundWarnings = filterInvalidCrossSessionInbound(data, path)

  const result = SettingsSchema().safeParse(data)

  if (!result.success) {
    const errors = formatZodError(result.error, path)
    return {
      settings: null,
      errors: [
        ...aliasWarnings,
        ...ruleWarnings,
        ...inboundWarnings,
        ...errors,
      ],
    }
  }

  return {
    settings: result.data,
    errors: [...aliasWarnings, ...ruleWarnings, ...inboundWarnings],
  }
}

function parseSettingsFileUncached(path: string): {
  settings: SettingsJson | null
  errors: ValidationError[]
} {
  try {
    const { resolvedPath } = safeResolvePath(getFsImplementation(), path)
    const content = readFileSync(resolvedPath)
    return parseSettingsFileContent(content, path)
  } catch (error) {
    handleFileSystemError(error, path)
    if (isENOENT(error)) {
      return { settings: null, errors: [] }
    }
    return {
      settings: null,
      errors: [
        {
          file: path,
          path: '',
          message: `${path} could not be read`,
        },
      ],
    }
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

export function getSettingsForSourceUncached(
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

  if (
    fileSettings &&
    (source === 'projectSettings' || source === 'localSettings')
  ) {
    return stripProjectScopedTracingSettings(fileSettings, source)
  }

  return fileSettings
}

/**
 * densable 2.1.251 `ui` / 2.1.247 `Hs` — admin managed (file + MDM) load
 * errors only. Cached on SettingsOwner.policy.adminLoadErrors.
 * Official also folds helper `s5(L())`; leftover has no helper loader.
 */
export function getAdminManagedPolicyLoadErrors(): ValidationError[] {
  const owner = getSettingsOwner()
  const cached = owner.policy.adminLoadErrors
  if (cached !== undefined) {
    return cached as ValidationError[]
  }
  const { errors: fileErrors } = loadManagedFileSettings()
  const errors = [...fileErrors, ...getMdmSettings().errors]
  owner.policy.adminLoadErrors = errors
  return errors
}

/**
 * densable `hM` = `toe(ui())` — drop `severity === "warning"`.
 */
export function getNonWarningAdminPolicyLoadErrors(): ValidationError[] {
  return getAdminManagedPolicyLoadErrors().filter(
    error => error.severity !== 'warning',
  )
}

/**
 * densable `c0` on an admin settings bag — present and non-empty.
 */
function adminSettingsSurvived(
  settings: SettingsJson | null | undefined,
): boolean {
  return settings != null && Object.keys(settings).length > 0
}

/**
 * densable `o5` — a surviving admin tier exists (MDM or managed file).
 * Official also treats helper `WJ(o).composes==="tier"` as survivor;
 * leftover has no helper composer.
 */
export function hasAdminPolicySurvivor(): boolean {
  const owner = getSettingsOwner()
  const cached = owner.policy.adminSurvivor
  if (cached !== undefined) {
    return cached as boolean
  }
  const survivor =
    adminSettingsSurvived(getMdmSettings().settings) ||
    adminSettingsSurvived(loadManagedFileSettings().settings)
  owner.policy.adminSurvivor = survivor
  return survivor
}

/**
 * densable iJt `hM().length===0||o5()` — refuse cascade-trust when a
 * policy source failed and nothing admin-side survived.
 */
export function canTrustAdminPolicyCascade(): boolean {
  return (
    getNonWarningAdminPolicyLoadErrors().length === 0 ||
    hasAdminPolicySurvivor()
  )
}

export function getAdminManagedPolicyUnreadableError(): ValidationError | null {
  return (
    getAdminManagedPolicyLoadErrors().find(e =>
      e.message.includes('could not be read'),
    ) ?? null
  )
}

export function formatPolicyUnreadableFailClose(error: {
  file?: string
  message: string
}): string {
  const detail = error.file ? `${error.file}: ${error.message}` : error.message
  return (
    `Unable to read managed policy settings.\n` +
    `This machine may require organization login enforcement, but the policy file failed to load.\n` +
    `Contact your administrator.\n\n` +
    `Detail: ${detail}`
  )
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
type SettingsStorageV5 = {
  write: (
    key: unknown,
    value: string,
    opts?: { publishDiscipline?: string },
  ) => Promise<{ ok: true } | { ok: false; error: unknown }>
}

/** densable leftover `q.userSettings()`. */
function userSettingsStorageV5Key(): { namespace: 'settings'; layer: 'user' } {
  return { namespace: 'settings', layer: 'user' }
}

/** densable `ke` — userSettings at the default path for this process. */
function isDefaultUserSettingsPath(
  source: EditableSettingSource,
  filePath: string,
): boolean {
  return (
    source === 'userSettings' &&
    filePath === getSettingsFilePathForSource('userSettings')
  )
}

function settingsStorageV5Write(
  storageV5: unknown,
): SettingsStorageV5['write'] | undefined {
  if (
    storageV5 !== null &&
    typeof storageV5 === 'object' &&
    'write' in storageV5 &&
    typeof storageV5.write === 'function'
  ) {
    return storageV5.write.bind(storageV5) as SettingsStorageV5['write']
  }
  return undefined
}

function mergeSettingsForSource(
  existingSettings: SettingsJson | null,
  settings: SettingsJson,
): SettingsJson {
  return mergeWith(
    existingSettings || {},
    settings,
    (
      _objValue: unknown,
      srcValue: unknown,
      key: string | number | symbol,
      object: Record<string | number | symbol, unknown>,
    ) => {
      if (srcValue === undefined && object && typeof key === 'string') {
        delete object[key]
        return undefined
      }
      if (Array.isArray(srcValue)) {
        return srcValue
      }
      return undefined
    },
  )
}

function noteLocalSettingsGitignore(): void {
  void addFileGlobRuleToGitignore(
    getRelativeSettingsFilePathForSource('localSettings'),
    getOriginalCwd(),
  ).then(result => {
    if (!result.written) return
    if (result.effective) {
      logForDebugging('gitignore_global_rule')
    } else if (result.reason === 'already_tracked') {
      logForDebugging('gitignore_global_rule already_tracked')
    } else {
      logForDebugging(
        `gitignore_global_rule ${result.reason ?? 'write_ineffective'}`,
      )
    }
  })
}

function loadExistingSettingsForWrite(
  source: EditableSettingSource,
  filePath: string,
): { error: Error } | { settings: SettingsJson | null } {
  let existingSettings = getSettingsForSourceUncached(source)
  if (!existingSettings) {
    let content: string | null = null
    try {
      content = readFileSync(filePath)
    } catch (e) {
      if (!isENOENT(e)) {
        throw e
      }
    }
    if (content !== null) {
      const rawData = safeParseJSON(content)
      if (rawData === null) {
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
  return { settings: existingSettings }
}

function writeSettingsFile(
  source: EditableSettingSource,
  filePath: string,
  updatedSettings: SettingsJson,
): void {
  markInternalWrite(filePath)
  writeFileSyncAndFlush_DEPRECATED(
    filePath,
    jsonStringify(updatedSettings, null, 2) + '\n',
  )
  resetSettingsCache()
  if (source === 'localSettings') {
    noteLocalSettingsGitignore()
  }
}

/**
 * densable `Rs` / `ay` — value-merge persist. 4th is storageV5 (`Is` 5th).
 * Official `oi.run`/`Pr()` queue is UNKNOWN — this path stays unqueued.
 */
export function updateSettingsForSource(
  source: EditableSettingSource,
  settings: SettingsJson,
  _storageV5?: unknown,
): { error: Error | null } {
  void _storageV5
  if (
    (source as unknown) === 'policySettings' ||
    (source as unknown) === 'flagSettings'
  ) {
    return { error: null }
  }

  const filePath = getSettingsFilePathForSource(source)
  if (!filePath) {
    return { error: null }
  }

  try {
    getFsImplementation().mkdirSync(dirname(filePath))
    const loaded = loadExistingSettingsForWrite(source, filePath)
    if ('error' in loaded) {
      return { error: loaded.error }
    }
    writeSettingsFile(
      source,
      filePath,
      mergeSettingsForSource(loaded.settings, settings),
    )
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
 * densable `Is` userSettings V5 arm: `A()&&i&&ke` →
 * `i.write(q.userSettings(), P, {publishDiscipline:"followAtomic"})`.
 * `legacyRevocation` / transform / `Pr()` queue are not invented.
 */
export async function persistSettingsForSource(
  source: EditableSettingSource,
  settings: SettingsJson,
  _options?: { legacyRevocation?: 'skip' },
  storageV5?: unknown,
): Promise<{ error: Error | null }> {
  void _options
  if (
    (source as unknown) === 'policySettings' ||
    (source as unknown) === 'flagSettings'
  ) {
    return { error: null }
  }

  const filePath = getSettingsFilePathForSource(source)
  if (!filePath) {
    return { error: null }
  }

  const write = settingsStorageV5Write(storageV5)
  const viaStorageV5 =
    isHoverRestOn() &&
    write !== undefined &&
    isDefaultUserSettingsPath(source, filePath)

  if (!viaStorageV5) {
    return updateSettingsForSource(source, settings, storageV5)
  }

  try {
    getFsImplementation().mkdirSync(dirname(filePath))
    const loaded = loadExistingSettingsForWrite(source, filePath)
    if ('error' in loaded) {
      return { error: loaded.error }
    }
    const updatedSettings = mergeSettingsForSource(loaded.settings, settings)
    const payload = jsonStringify(updatedSettings, null, 2) + '\n'
    const written = await write(userSettingsStorageV5Key(), payload, {
      publishDiscipline: 'followAtomic',
    })
    if (!written.ok) {
      const code =
        written.error !== null &&
        typeof written.error === 'object' &&
        'code' in written.error
          ? String(written.error.code)
          : String(written.error)
      throw new Error(`settings storageV5 write failed: ${code}`)
    }
    resetSettingsCache()
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
            const layer =
              source === 'projectSettings' || source === 'localSettings'
                ? stripProjectScopedTracingSettings(settings, source)
                : settings
            mergedSettings = mergeWith(
              mergedSettings,
              layer,
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

/** densable 2.1.248 #37 Zjt — settings-error path N() matches. */
export const CROSS_SESSION_INBOUND_SETTING_PATH = 'crossSessionInbound'

const CROSS_SESSION_INBOUND_VALUES = ['accept', 'hold', 'refuse'] as const

const CROSS_SESSION_INBOUND_RANK: Record<CrossSessionInbound, number> = {
  accept: 0,
  hold: 1,
  refuse: 2,
}

/** densable 2.1.248 #37 w().decidedBy — invalidSetting only. */
export type CrossSessionInboundDecidedBy = 'invalidSetting'

export type CrossSessionInboundDecision = {
  value: CrossSessionInbound | undefined
  decidedBy: CrossSessionInboundDecidedBy | undefined
}

type SettingsErrorWithStatus = ValidationError & { statusOnly?: boolean }

function formatReceivedCrossSessionInbound(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** densable 2.1.248 #37 Ot() */
function invalidCrossSessionInboundDetail(value: unknown): string {
  const allowed = CROSS_SESSION_INBOUND_VALUES.map(v => `"${v}"`).join(', ')
  const received = formatReceivedCrossSessionInbound(value)
  return `must be one of ${allowed}; received ${received}`
}

/** densable 2.1.248 #37 vo() user-path — hold copy, never managed refuse. */
function invalidCrossSessionInboundWarning(
  value: unknown,
  filePath: string,
): ValidationError {
  const expected = CROSS_SESSION_INBOUND_VALUES.map(v => `"${v}"`).join(', ')
  return {
    file: filePath,
    path: CROSS_SESSION_INBOUND_SETTING_PATH,
    message:
      `"crossSessionInbound" ${invalidCrossSessionInboundDetail(value)}. ` +
      'This value was ignored; while it is present, cross-session ' +
      'messages are held for your approval instead of being delivered. ' +
      'Set it to one of the values above.',
    severity: 'warning',
    expected,
  }
}

/**
 * densable 2.1.248 #37 ho() user-path.
 * User-path only: delete the invalid key and emit a warning.
 */
function filterInvalidCrossSessionInbound(
  data: unknown,
  filePath: string,
): ValidationError[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const obj = data as Record<string, unknown>
  const value = obj.crossSessionInbound
  if (
    value === undefined ||
    value === 'accept' ||
    value === 'hold' ||
    value === 'refuse'
  ) {
    return []
  }
  delete obj.crossSessionInbound
  return [invalidCrossSessionInboundWarning(value, filePath)]
}

/**
 * densable 2.1.248 #37 N() @196196105 sha=8852096933c85ace
 * function N(){return k_().errors.some((e)=>e.path===Zjt&&e.severity==="warning"&&!e.statusOnly)}
 */
export function hasInvalidCrossSessionInboundWarning(
  errors: readonly SettingsErrorWithStatus[] = getSettingsWithErrors().errors,
): boolean {
  return errors.some(
    e =>
      e.path === CROSS_SESSION_INBOUND_SETTING_PATH &&
      e.severity === 'warning' &&
      !e.statusOnly,
  )
}

/**
 * densable TPr() / 2.1.248 #37 w() — resolve crossSessionInbound across sources.
 * Trusted first (policy → flag → user): first explicit wins.
 * Project/local may only *tighten* (accept < hold < refuse) over the current value.
 * Then: if rank < hold && N() → hold / invalidSetting.
 */
export function resolveCrossSessionInboundDecision(
  getSource: typeof getSettingsForSource = getSettingsForSource,
  isEnabled: typeof isSettingSourceEnabled = isSettingSourceEnabled,
  isInvalidInboundWarning?: () => boolean,
): CrossSessionInboundDecision {
  const checkInvalid =
    isInvalidInboundWarning ??
    (getSource === getSettingsForSource
      ? hasInvalidCrossSessionInboundWarning
      : () => false)
  let resolved: CrossSessionInbound | undefined
  let decidedBy: CrossSessionInboundDecidedBy | undefined
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
      const current = CROSS_SESSION_INBOUND_RANK[resolved ?? 'accept']
      if (CROSS_SESSION_INBOUND_RANK[v] > current) {
        resolved = v
      }
    }
  }
  // densable: if(p[e??"accept"]<p.hold&&N())e="hold",o="invalidSetting"
  if (
    CROSS_SESSION_INBOUND_RANK[resolved ?? 'accept'] <
      CROSS_SESSION_INBOUND_RANK.hold &&
    checkInvalid()
  ) {
    resolved = 'hold'
    decidedBy = 'invalidSetting'
  }
  return { value: resolved, decidedBy }
}

export function resolveCrossSessionInbound(
  getSource: typeof getSettingsForSource = getSettingsForSource,
  isEnabled: typeof isSettingSourceEnabled = isSettingSourceEnabled,
  isInvalidInboundWarning?: () => boolean,
): CrossSessionInbound | undefined {
  return resolveCrossSessionInboundDecision(
    getSource,
    isEnabled,
    isInvalidInboundWarning,
  ).value
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
