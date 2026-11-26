import { readFileSync as readFileBufferSync } from 'fs'
import { feature } from 'bun:bundle'
import mergeWith from 'lodash-es/mergeWith.js'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'path'
import { z } from 'zod/v4'
import {
  getFlagSettingsInline,
  getFlagSettingsPath,
  getOriginalCwd,
  getParentManagedSettings,
  getUseCoworkPlugins,
} from '../../bootstrap/state.js'
import { uniq } from '../array.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { stripProjectScopeBlockedEnv } from '../managedEnvConstants.js'
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
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'
import { clone, jsonStringify } from '../slowOperations.js'
import { profileCheckpoint } from '../startupProfiler.js'
import {
  type EditableSettingSource,
  getEnabledSettingSources,
  isSettingSourceEnabled,
  type SettingSource,
} from './constants.js'
import {
  type FirstReadStatSnapshot,
  markInternalWrite,
  recordFirstReadStat,
} from './internalWrites.js'
import {
  getManagedFilePath,
  getManagedSettingsDropInDir,
} from './managedPath.js'
import {
  isRetryableMdmUnreadCause,
  type MdmUnreadCause,
} from './mdm/rawRead.js'
import {
  getHkcuSettings,
  getMdmSettings,
  refreshMdmSettings,
  setMdmSettingsCache,
} from './mdm/settings.js'
import {
  applyRemoteSettingsConsentFreeIfEligible,
  getActiveRemoteSettings,
  markRemoteSettingsLoadCycleBegun,
  markRemoteSettingsLoadCycleEnded,
  setRemoteSettingsEligibilityMemo,
  setRemoteSettingsLoadStatus,
  type RemoteSettingsConsentOutcome,
  type RemoteSettingsLoadStatus,
} from './remoteSettingsState.js'
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
  applyHostPolicyOverlay,
  buildHostModelOverlay,
  extractParentManagedOffSwitches,
} from './hostModelOverlay.js'
import { applySettingsKeyAliases } from './settingsAliases.js'
import {
  buildDeepNestingWarnings,
  filterAndWithholdSandboxRestrictions,
  filterInvalidPermissionRules,
  findJsonSyntaxErrorLocation,
  formatZodError,
  pruneDeepSettings,
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
 * densable nfc host finish: b6i + Object.assign(hostModelOverlay),
 * plus Official 2.1.323 (#2120) `Vsi` off-switches from Agent SDK
 * `managedSettings` (disableRemoteControl, disableAgentView, disableWorkflows,
 * disableArtifact, enableWorkflows=false, enableArtifact=false).
 */
function finishPolicySettingsForHost(
  policySettings: SettingsJson | null,
): SettingsJson | null {
  const { parentSettings, hostModelOverlay, hostManagedProvider } =
    loadParentManagedAndHostOverlay()
  let resolved = applyHostManagedPolicyModelPrecedence(
    policySettings,
    hostModelOverlay,
    hostManagedProvider,
  )
  const offSwitches = extractParentManagedOffSwitches(parentSettings)
  if (offSwitches) {
    resolved = resolved
      ? ({ ...resolved, ...offSwitches } as SettingsJson)
      : ({ ...offSwitches } as SettingsJson)
  }
  // Official 2.1.328 (#546): apply embedding host managed-settings overlay
  // (including policy@builtin allowManagedModsOnly) while admin settings win.
  resolved = applyHostPolicyOverlay(resolved, parentSettings)
  return resolved
}

/**
 * densable 2.1.223 #11 — server-delivered settings no longer disable the env
 * block of machine-local managed-settings.json / MDM; admin env merges per key.
 * Higher-priority sources win on the same key; lower sources fill missing keys.
 * Other fields still use first-source-wins (remote > MDM > file > hkcu).
 */
const PROTOTYPE_DANGEROUS_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

function stripPrototypePoisoningKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map(item => stripPrototypePoisoningKeysDeep(item))
  }
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (PROTOTYPE_DANGEROUS_KEYS.has(key)) continue
    Object.defineProperty(out, key, {
      value: stripPrototypePoisoningKeysDeep(
        (value as Record<string, unknown>)[key],
      ),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return out
}

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
      if (typeof v === 'string' && !PROTOTYPE_DANGEROUS_KEYS.has(k)) {
        Object.defineProperty(env, k, {
          value: v,
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
    }
  }
  if (winner?.env) {
    for (const [k, v] of Object.entries(winner.env)) {
      if (typeof v === 'string' && !PROTOTYPE_DANGEROUS_KEYS.has(k)) {
        Object.defineProperty(env, k, {
          value: v,
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
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
export function collectMachineLocalManagedSettings(): {
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
 * densable 2.1.223 #11 / #1512 — first-source-wins for policy fields
 * (remote > MDM > file > HKCU), env merges per-key.
 */
function resolvePolicySettingsWithEnvMerge(): {
  policySettings: SettingsJson | null
  policyErrors: ValidationError[]
} {
  const policyErrors: ValidationError[] = []
  let winner: SettingsJson | null = null
  let winnerKind: 'remote' | 'mdm' | 'file' | 'hkcu' | null = null

  const remote = getActiveRemoteSettings()
  const local = collectMachineLocalManagedSettings()
  if (remote && Object.keys(remote).length > 0) {
    winner = remote
    winnerKind = 'remote'
  } else if (local.mdm) {
    winner = local.mdm
    winnerKind = 'mdm'
  } else if (local.file) {
    winner = local.file
    winnerKind = 'file'
  } else if (local.hkcu) {
    winner = local.hkcu
    winnerKind = 'hkcu'
  }

  if (winnerKind === 'remote') {
    winner = mergeManagedEnvPerKey(winner, [local.hkcu, local.file, local.mdm])
  } else if (winnerKind === 'mdm') {
    winner = mergeManagedEnvPerKey(winner, [local.hkcu, local.file])
  } else if (winnerKind === 'file') {
    winner = mergeManagedEnvPerKey(winner, [local.hkcu])
  }

  return { policySettings: winner, policyErrors }
}

export type RemoteSettingsFetchResult =
  | {
      ok: true
      settings: SettingsJson | null
      isFirstPartyTrusted: boolean
      hasDangerousSettingsChanged?: boolean
    }
  | {
      ok: false
      failure: { errorKind: string; httpStatus?: number }
      staleCache?: SettingsJson | null
      transportEnvWithheld?: boolean
      restrictionsOnly?: boolean
    }

/**
 * Official #1531 & #1512: Execute a remote managed settings load cycle,
 * updating load lifecycle state/notices and applying Team/Enterprise
 * first-party payloads consent-free when eligible.
 */
export async function runRemoteSettingsLoadCycle(
  fetchRemoteSettings: () => Promise<RemoteSettingsFetchResult>,
  opts: {
    eligible: boolean
    isInteractive: boolean
    hasOpenReview?: boolean
    promptResult?: 'approved' | 'rejected' | 'deferred_no_consent_surface'
  },
): Promise<{
  applied: boolean
  outcome: RemoteSettingsConsentOutcome | null
  status: RemoteSettingsLoadStatus
}> {
  markRemoteSettingsLoadCycleBegun()
  setRemoteSettingsEligibilityMemo(opts.eligible)
  try {
    if (!opts.eligible) {
      const status: RemoteSettingsLoadStatus = { state: 'ineligible' }
      setRemoteSettingsLoadStatus(status)
      return { applied: false, outcome: null, status }
    }

    const fetched = await fetchRemoteSettings()
    if (!fetched.ok) {
      const status: RemoteSettingsLoadStatus =
        fetched.staleCache && Object.keys(fetched.staleCache).length > 0
          ? {
              state: 'stale_cache',
              failure: fetched.failure,
              transportEnvWithheld: Boolean(fetched.transportEnvWithheld),
            }
          : {
              state: 'failed',
              failure: fetched.failure,
              restrictionsOnly: fetched.restrictionsOnly,
            }
      setRemoteSettingsLoadStatus(status)
      return { applied: false, outcome: null, status }
    }

    const payload = fetched.settings
    if (!payload || Object.keys(payload).length === 0) {
      const status: RemoteSettingsLoadStatus = {
        state: 'ok',
        hasSettings: false,
      }
      setRemoteSettingsLoadStatus(status)
      return { applied: false, outcome: 'no_check_needed', status }
    }

    const applyResult = applyRemoteSettingsConsentFreeIfEligible(payload, {
      isFirstPartyTrusted: fetched.isFirstPartyTrusted,
      isInteractive: opts.isInteractive,
      hasOpenReview: opts.hasOpenReview,
      hasDangerousSettingsChanged: fetched.hasDangerousSettingsChanged,
      promptResult: opts.promptResult,
    })
    if (applyResult.applied) {
      resetSettingsCache()
    }
    const status: RemoteSettingsLoadStatus = {
      state: 'ok',
      hasSettings: applyResult.applied,
    }
    if (!applyResult.applied) {
      setRemoteSettingsLoadStatus(status)
    }
    return {
      applied: applyResult.applied,
      outcome: applyResult.outcome,
      status,
    }
  } catch {
    const status: RemoteSettingsLoadStatus = {
      state: 'failed',
      failure: { errorKind: 'fetch_error' },
    }
    setRemoteSettingsLoadStatus(status)
    return { applied: false, outcome: null, status }
  } finally {
    markRemoteSettingsLoadCycleEnded()
  }
}

export {
  applyRemoteSettingsConsentFreeIfEligible,
  buildRemoteSettingsLoadNotice,
  evaluateStoredRemoteSettingsCopy,
  extractHelperTier,
  getActiveRemoteSettings,
  getDroppedHelperTier,
  getRemoteHelperTierStatus,
  getRemoteSettingsLoadStatus,
  getStoredCopyRefusal,
  getStoredCopyTrust,
  isForceRemoteSettingsRefreshBlocking,
  markRemoteSettingsLoadCycleBegun,
  markRemoteSettingsLoadCycleEnded,
  onRemoteSettingsLoadStatusChanged,
  reconcileMdmAndRemoteSettings,
  recordStoredCopyRefusal,
  releaseRemoteSettingsLoadBackstop,
  resetRemoteSettingsSessionCache,
  resolveRemoteHelperTier,
  retainDroppedHelperBaseUrlEnv,
  setRemoteSettingsEligibilityMemo,
  setRemoteSettingsLoadStatus,
  type HelperTier,
  type RemoteHelperTierStatus,
  type RemoteSettingsConsentOutcome,
  type RemoteSettingsLoadStatus,
  type StoredCopyRefusal,
  type StoredCopyTrust,
} from './remoteSettingsState.js'

/**
 * Get the path to the managed settings file based on the current platform
 */
function getManagedSettingsFilePath(): string {
  return join(getManagedFilePath(), 'managed-settings.json')
}

export type ManagedDocumentLinkKind = 'inside' | 'outside' | 'unverified'

export type ManagedDocumentLink = {
  path: string
  folder: string
  kind: ManagedDocumentLinkKind
}

/**
 * official GVo / su — detect whether a managed-settings document (or its
 * containing folder) is reached via a symlink leading outside `managedDir`.
 */
export function inspectManagedDocumentLink(
  managedDir: string,
  segments: string[],
): ManagedDocumentLink | null {
  const fs = getFsImplementation()
  const fullPath = join(managedDir, ...segments)
  let linked = false
  try {
    if (fs.lstatSync(managedDir).isSymbolicLink()) {
      linked = true
    } else {
      let cursor = managedDir
      for (const seg of segments) {
        cursor = join(cursor, seg)
        if (fs.lstatSync(cursor).isSymbolicLink()) {
          linked = true
          break
        }
      }
    }
  } catch {
    return null
  }
  if (!linked) return null

  try {
    const realFolder = fs.realpathSync(managedDir)
    const realTarget = fs.realpathSync(fullPath)
    const inside =
      realTarget === realFolder ||
      realTarget.startsWith(
        realFolder.endsWith('/') || realFolder.endsWith('\\')
          ? realFolder
          : `${realFolder}/`,
      ) ||
      realTarget.startsWith(
        realFolder.endsWith('/') || realFolder.endsWith('\\')
          ? realFolder
          : `${realFolder}\\`,
      )
    return {
      path: fullPath,
      folder: managedDir,
      kind: inside ? 'inside' : 'outside',
    }
  } catch {
    return {
      path: fullPath,
      folder: managedDir,
      kind: 'unverified',
    }
  }
}

/**
 * official FHa — format warning lines for an outside/unverified managed-settings link.
 */
export function formatManagedDocumentLinkWarning(
  link: ManagedDocumentLink,
  readSucceeded: boolean,
): [string, string] | null {
  if (link.kind === 'inside') return null
  const name = link.path.split(/[\\/]/).pop() ?? link.path
  const base = `${link.path}: ${name} is reached through a link`
  const detail =
    link.kind === 'outside'
      ? `${base} that leads outside ${link.folder}.`
      : `${base}, and Claude Code couldn't tell whether the link leads outside ${link.folder}.`
  return [
    readSucceeded ? `${detail} Claude Code still reads it.` : detail,
    'Suggested fix: Ask your administrator to replace the link with the file or folder it points to.',
  ]
}

/**
 * Load file-based managed settings: managed-settings.json + managed-settings.d/*.json.
 */
export function loadManagedFileSettings(): {
  settings: SettingsJson | null
  errors: ValidationError[]
} {
  const errors: ValidationError[] = []
  let merged: SettingsJson = {}
  let found = false
  const managedDir = getManagedFilePath()

  const basePath = getManagedSettingsFilePath()
  // Official 2.1.326 (#18) Is(): isolate each managed document parse+merge with
  // a snapshot rollback so prototype-key or corrupt files never crash startup
  // or corrupt other drop-in files.
  const baseSnapshot = clone(merged)
  try {
    const { settings, errors: baseErrors } = parseSettingsFile(basePath)
    errors.push(...baseErrors)
    const baseLink = inspectManagedDocumentLink(managedDir, [
      'managed-settings.json',
    ])
    if (baseLink) {
      const msg = formatManagedDocumentLinkWarning(baseLink, settings !== null)
      if (msg) {
        errors.push({
          file: basePath,
          path: '',
          message: msg[0],
          suggestion: msg[1],
          severity: 'warning',
        })
      }
    }
    if (settings && Object.keys(settings).length > 0) {
      const safeBase = stripPrototypePoisoningKeysDeep(settings) as SettingsJson
      merged = mergeWith(merged, safeBase, settingsMergeCustomizer)
      found = true
    }
  } catch (err) {
    merged = baseSnapshot
    logError(err)
    errors.push({
      file: basePath,
      path: '',
      message: `${basePath} could not be merged safely: ${err instanceof Error ? err.message : String(err)}`,
      severity: 'fatal',
    })
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
      const dropPath = join(dropInDir, name)
      const dropSnapshot = clone(merged)
      try {
        const { settings: dropSettings, errors: fileErrors } =
          parseSettingsFile(dropPath)
        errors.push(...fileErrors)
        const dropLink = inspectManagedDocumentLink(managedDir, [
          'managed-settings.d',
          name,
        ])
        if (dropLink) {
          const msg = formatManagedDocumentLinkWarning(
            dropLink,
            dropSettings !== null,
          )
          if (msg) {
            errors.push({
              file: dropPath,
              path: '',
              message: msg[0],
              suggestion: msg[1],
              severity: 'warning',
            })
          }
        }
        if (dropSettings && Object.keys(dropSettings).length > 0) {
          const safeDrop = stripPrototypePoisoningKeysDeep(
            dropSettings,
          ) as SettingsJson
          merged = mergeWith(merged, safeDrop, settingsMergeCustomizer)
          // Official 2.1.325 #2354: when a higher-ranking managed source turns
          // the sandbox on without explicitly setting `autoAllowBashIfSandboxed: true`,
          // do not inherit `autoAllowBashIfSandboxed: true` from a lower-ranking managed file.
          if (
            safeDrop.sandbox?.enabled === true &&
            safeDrop.sandbox.autoAllowBashIfSandboxed !== true &&
            merged.sandbox
          ) {
            merged.sandbox = {
              ...merged.sandbox,
              autoAllowBashIfSandboxed: false,
            }
          }
          found = true
        }
      } catch (err) {
        merged = dropSnapshot
        logError(err)
        errors.push({
          file: dropPath,
          path: '',
          message: `${dropPath} could not be merged safely: ${err instanceof Error ? err.message : String(err)}`,
          severity: 'fatal',
        })
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

  const rawParsed = safeParseJSON(content, false)

  // Official 2.1.326 (#261): attach 1-based line and column when JSON syntax fails
  if (rawParsed === null) {
    const loc = findJsonSyntaxErrorLocation(content)
    const locSuffix = loc ? ` (line ${loc.line}, column ${loc.column})` : ''
    return {
      settings: null,
      errors: [
        {
          file: path,
          path: '',
          message: `Invalid or malformed JSON${locSuffix}`,
          line: loc?.line,
          column: loc?.column,
          severity: 'fatal',
        },
      ],
    }
  }

  // Official 2.1.326 (#18 & #19) c0e + Vt: iteratively prune >64-level nesting
  // and copy keys safely with Object.defineProperty (no __proto__ pollution).
  const {
    value: prunedData,
    dropped: deepDropped,
    tooManyNodes,
  } = pruneDeepSettings(rawParsed)
  if (tooManyNodes) {
    return {
      settings: null,
      errors: [
        {
          file: path,
          path: '',
          message:
            'Settings file contains too many nested objects or arrays and could not be loaded.',
          severity: 'fatal',
        },
      ],
    }
  }
  const deepWarnings = buildDeepNestingWarnings(deepDropped, path)
  const data = stripPrototypePoisoningKeysDeep(prunedData)

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

  // official qr/iy (#11): withhold allowRead/allowWrite/allowedDomains when a
  // restriction (denyRead/denyWrite/deniedDomains) in the same block is
  // unreadable or had invalid entries trimmed.
  const sandboxWarnings = filterAndWithholdSandboxRestrictions(data, path)

  // densable 2.1.248 #37 ho() user-path — strip unrecognized
  // crossSessionInbound so the rest of the file still loads, and emit the
  // settings warning N() reads. Hold only.
  const inboundWarnings = filterInvalidCrossSessionInbound(data, path)

  // Official 2.1.325 #2298 (`y_`) — strip unrecognized teammateMode so it is
  // not applied, and emit a warning shown on startup, `claude doctor`, and `-p`.
  const teammateModeWarnings = filterInvalidTeammateMode(data, path)

  const result = SettingsSchema().safeParse(data)

  if (!result.success) {
    const errors = formatZodError(result.error, path)
    return {
      settings: null,
      errors: [
        ...deepWarnings,
        ...aliasWarnings,
        ...ruleWarnings,
        ...sandboxWarnings,
        ...inboundWarnings,
        ...teammateModeWarnings,
        ...errors,
      ],
    }
  }

  return {
    settings: result.data,
    errors: [
      ...deepWarnings,
      ...aliasWarnings,
      ...ruleWarnings,
      ...sandboxWarnings,
      ...inboundWarnings,
      ...teammateModeWarnings,
    ],
  }
}

/**
 * #1846: Thrown when `--settings` file content does not match
 * `CLAUDE_CODE_BRIDGE_SETTINGS_BINDING` in a Remote Control child process.
 */
export class BridgeSettingsBindingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeSettingsBindingError'
  }
}

function parseSettingsFileUncached(path: string): {
  settings: SettingsJson | null
  errors: ValidationError[]
} {
  try {
    const fs = getFsImplementation()
    const { resolvedPath } = safeResolvePath(fs, path)
    let firstReadStat: FirstReadStatSnapshot | undefined
    try {
      const s = fs.statSync(resolvedPath)
      firstReadStat = {
        ino: s.ino,
        size: s.size,
        mtimeMs: s.mtimeMs,
        ctimeMs: s.ctimeMs,
      }
    } catch {
      // Stat may fail for ENOENT/unreadable; readFileSync below handles error classification.
    }
    const bindingEnv = process.env.CLAUDE_CODE_BRIDGE_SETTINGS_BINDING
    const flagPath = getFlagSettingsPath()
    const isBoundFlagSettings =
      bindingEnv !== undefined &&
      flagPath !== undefined &&
      (path === flagPath || resolve(path) === resolve(flagPath))
    let content: string
    if (isBoundFlagSettings) {
      // #1846: Read raw bytes once and verify against CLAUDE_CODE_BRIDGE_SETTINGS_BINDING
      // in the child process to eliminate the spawner-to-child TOCTOU window.
      const rawBuf = readFileBufferSync(resolvedPath)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { verifyBridgeSettingsBinding } =
        require('../../bridge/sessionRunner.js') as typeof import('../../bridge/sessionRunner.js')
      const check = verifyBridgeSettingsBinding(
        flagPath,
        resolvedPath,
        rawBuf,
        bindingEnv,
      )
      if (!check.ok) {
        throw new BridgeSettingsBindingError(check.error)
      }
      content = rawBuf.toString('utf8')
    } else {
      content = readFileSync(resolvedPath)
    }
    if (firstReadStat !== undefined) {
      recordFirstReadStat(normalize(path), firstReadStat)
    }
    return parseSettingsFileContent(content, path)
  } catch (error) {
    if (error instanceof BridgeSettingsBindingError) {
      throw error
    }
    handleFileSystemError(error, path)
    if (isENOENT(error)) {
      recordFirstReadStat(normalize(path), null)
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

/**
 * Official 2.1.323 (#2029): Verify that a project/local settings file (or its
 * `.claude` parent) does not follow a symlink leading to a different folder
 * outside the project root Claude Code checked.
 */
export function checkProjectSettingsSymlinkEscape(
  source: 'projectSettings' | 'localSettings',
  filePath: string,
): ValidationError | null {
  if (source === 'projectSettings' && projectSettingsAliasesUserSettings()) {
    return null
  }
  const rootPath = getSettingsRootPathForSource(source)
  const fs = getFsImplementation()
  let canonicalRoot: string
  try {
    canonicalRoot = fs.realpathSync(rootPath)
  } catch {
    canonicalRoot = resolve(rootPath)
  }

  let resolvedPath: string
  let isSymlink = false
  try {
    const resolved = safeResolvePath(fs, filePath)
    resolvedPath = resolved.resolvedPath
    isSymlink = resolved.isSymlink
  } catch {
    return null
  }

  // Also check if an intermediate parent (e.g. `.claude`) or a dangling
  // symlink at `filePath` points outside the project root.
  let canonicalTarget = resolvedPath
  try {
    canonicalTarget = fs.realpathSync(resolvedPath)
    if (canonicalTarget !== resolve(filePath)) {
      isSymlink = true
    }
  } catch {
    // ENOENT or unreadable — handle dangling symlink at filePath first, then
    // symlinked parent directory (e.g. `.claude -> /outside`).
    let handledDanglingLink = false
    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) {
        const rawLinkTarget = fs.readlinkSync(filePath)
        const resolvedLinkTarget = resolve(dirname(filePath), rawLinkTarget)
        isSymlink = true
        handledDanglingLink = true
        try {
          const targetParentReal = fs.realpathSync(dirname(resolvedLinkTarget))
          canonicalTarget = join(
            targetParentReal,
            resolvedLinkTarget.split(/[\\/]/).pop() ?? '',
          )
        } catch {
          canonicalTarget = resolvedLinkTarget
        }
      }
    } catch {
      // filePath itself does not exist; fall through to parent check
    }
    if (!handledDanglingLink) {
      try {
        const parentReal = fs.realpathSync(dirname(filePath))
        if (parentReal !== resolve(dirname(filePath))) {
          isSymlink = true
          canonicalTarget = join(
            parentReal,
            filePath.split(/[\\/]/).pop() ?? '',
          )
        }
      } catch {
        return null
      }
    }
  }

  if (!isSymlink) {
    return null
  }

  const rel = relative(canonicalRoot, canonicalTarget)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    logForDebugging(
      `Refusing to read ${source} at ${filePath}: symlink leads outside checked folder ${canonicalRoot} (resolved to ${canonicalTarget})`,
      { level: 'warn' },
    )
    return {
      file: filePath,
      path: '',
      message: `Settings file could not be verified against the route its check resolved, and was not read: ${filePath}`,
      severity: 'fatal',
    }
  }
  return null
}

function parseSettingsFileForSource(
  source: SettingSource,
  filePath: string,
): {
  settings: SettingsJson | null
  errors: ValidationError[]
} {
  if (source === 'projectSettings' || source === 'localSettings') {
    const escapeError = checkProjectSettingsSymlinkEscape(source, filePath)
    if (escapeError) {
      return { settings: null, errors: [escapeError] }
    }
  }
  return parseSettingsFile(filePath)
}

export function getSettingsForSourceUncached(
  source: SettingSource,
): SettingsJson | null {
  if (!isSettingSourceEnabled(source)) {
    return null
  }
  // For policySettings: first source wins (remote > HKLM/plist > file > HKCU)
  // densable 2.1.223 #11: env merges per-key with machine-local under remote.
  // densable nfc: under hostManagedProvider, b6i strip + Gfg hostModelOverlay.
  if (source === 'policySettings') {
    const { policySettings } = resolvePolicySettingsWithEnvMerge()
    return finishPolicySettingsForHost(policySettings)
  }

  const settingsFilePath = getSettingsFilePathForSource(source)
  const { settings: fileSettings } = settingsFilePath
    ? parseSettingsFileForSource(source, settingsFilePath)
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
    return stripProjectScopedSettings(fileSettings, source)
  }

  return fileSettings
}

/**
 * Official 2.1.323 (#2187) `jHa`: repo-scoped settings keys stripped from
 * `projectSettings` / `localSettings` in untrusted workspaces (e.g., self-hosted
 * runners with `--trust-workspace false` or VS Code in an untrusted folder,
 * indicated by `CLAUDE_CODE_IGNORE_PERSISTED_TRUST` / `--ignore-persisted-trust`).
 */
export const UNTRUSTED_WORKSPACE_STRIP_KEYS = [
  'disableAllHooks',
  'enabledPlugins',
  'extraKnownMarketplaces',
  'agent',
  'allowedHttpHookUrls',
  'httpHookAllowedEnvVars',
  'autoMemoryDirectory',
  'modelOverrides',
  'allowedMcpServers',
  'skipWebFetchPreflight',
  'autoUploadSessions',
  'xaaIdp',
  'claudeMdExcludes',
  'enableAllProjectMcpServers',
  'enabledMcpjsonServers',
] as const

/**
 * Official 2.1.326 (#324) `ksn`: credential helper keys stripped from repo
 * settings (`projectSettings` / `localSettings`) when workspace is untrusted.
 */
export const CREDENTIAL_HELPER_SETTING_KEYS = [
  'apiKeyHelper',
  'awsAuthRefresh',
  'awsCredentialExport',
  'gcpAuthRefresh',
  'otelHeadersHelper',
  'proxyAuthHelper',
] as const

/**
 * Official 2.1.326 (#324) `U8`: settings that a repo settings file in an
 * untrusted folder may only set to their stricter ("restrictive") value,
 * never a looser one.
 */
const RESTRICTIVE_REPO_SETTING_SPECS: ReadonlyArray<{
  path: readonly string[]
  restrictive: boolean | string
}> = [
  { path: ['allowManagedPermissionRulesOnly'], restrictive: true },
  { path: ['allowManagedHooksOnly'], restrictive: true },
  { path: ['allowManagedMcpServersOnly'], restrictive: true },
  { path: ['enforceAvailableModels'], restrictive: true },
  { path: ['disableAllHooks'], restrictive: true },
  { path: ['disableClaudeAiConnectors'], restrictive: true },
  { path: ['disableCommandPluginSources'], restrictive: true },
  { path: ['disableSideloadFlags'], restrictive: true },
  { path: ['disableSkillShellExecution'], restrictive: true },
  { path: ['disableWindowsBashCommandSplit'], restrictive: true },
  { path: ['disableRemoteControl'], restrictive: true },
  { path: ['disableAgentView'], restrictive: true },
  { path: ['disableWorkflows'], restrictive: true },
  { path: ['disableArtifact'], restrictive: true },
  { path: ['disableBundledSkills'], restrictive: true },
  { path: ['fastModePerSessionOptIn'], restrictive: true },
  { path: ['isolatePeerMachines'], restrictive: true },
  { path: ['strictPluginOnlyCustomization'], restrictive: true },
  { path: ['disableAutoMode'], restrictive: 'disable' },
  { path: ['disableDeepLinkRegistration'], restrictive: 'disable' },
  {
    path: ['permissions', 'disableBypassPermissionsMode'],
    restrictive: 'disable',
  },
  { path: ['permissions', 'disableAutoMode'], restrictive: 'disable' },
  {
    path: ['permissions', 'blockReadsOutsideWorkingDirectories'],
    restrictive: true,
  },
  {
    path: ['permissions', 'blockWritesOutsideWorkingDirectories'],
    restrictive: true,
  },
  { path: ['permissions', 'denyInsteadOfPrompting'], restrictive: true },
  { path: ['autoMode', 'classifyAllShell'], restrictive: true },
  { path: ['worktree', 'bgIsolation'], restrictive: 'worktree' },
  { path: ['enableArtifact'], restrictive: false },
  { path: ['enableWorkflows'], restrictive: false },
  { path: ['syncClaudeAiSkills'], restrictive: false },
  { path: ['syncClaudeAiPlugins'], restrictive: false },
  { path: ['useAutoModeDuringPlan'], restrictive: false },
  { path: ['skipDangerousModePermissionPrompt'], restrictive: false },
  { path: ['skipAutoPermissionPrompt'], restrictive: false },
  { path: ['enableAllProjectMcpServers'], restrictive: false },
]

function getPathValue(
  obj: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let cursor: unknown = obj
  for (const seg of path) {
    if (
      cursor === null ||
      typeof cursor !== 'object' ||
      Array.isArray(cursor)
    ) {
      return undefined
    }
    cursor = (cursor as Record<string, unknown>)[seg]
  }
  return cursor
}

function deletePathValue(
  obj: Record<string, unknown>,
  path: readonly string[],
): void {
  if (path.length === 1) {
    delete obj[path[0]!]
    return
  }
  const head = path[0]!
  const child = obj[head]
  if (child && typeof child === 'object' && !Array.isArray(child)) {
    const clonedChild = { ...(child as Record<string, unknown>) }
    deletePathValue(clonedChild, path.slice(1))
    obj[head] = clonedChild
  }
}

function hasTrustWorkspaceFalseArg(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--trust-workspace=false' || arg === '--trust-workspace=0') {
      return true
    }
    if (arg === '--trust-workspace') {
      const next = argv[i + 1]
      if (next === 'false' || next === '0') return true
    }
  }
  return false
}

export function isUntrustedWorkspaceRepoSettingsRestricted(
  source: 'projectSettings' | 'localSettings',
): boolean {
  const ignorePersistedTrust =
    isEnvTruthy(process.env.CLAUDE_CODE_IGNORE_PERSISTED_TRUST) ||
    process.argv.includes('--ignore-persisted-trust') ||
    hasTrustWorkspaceFalseArg(process.argv)
  if (!ignorePersistedTrust) return false
  if (source === 'projectSettings' && projectSettingsAliasesUserSettings()) {
    return false
  }
  return true
}

export function filterUntrustedRepoSettings(
  settings: SettingsJson,
  source: 'projectSettings' | 'localSettings',
): SettingsJson {
  const root = settings as Record<string, unknown>
  const strippedZvl = UNTRUSTED_WORKSPACE_STRIP_KEYS.filter(
    k => root[k] !== undefined,
  )
  const strippedHelpers = CREDENTIAL_HELPER_SETTING_KEYS.filter(
    k => root[k] !== undefined,
  )
  const strippedNonRestrictive: Array<readonly string[]> = []
  for (const spec of RESTRICTIVE_REPO_SETTING_SPECS) {
    const val = getPathValue(root, spec.path)
    if (val !== undefined && val !== spec.restrictive) {
      strippedNonRestrictive.push(spec.path)
    }
  }

  if (
    strippedZvl.length === 0 &&
    strippedHelpers.length === 0 &&
    strippedNonRestrictive.length === 0
  ) {
    return settings
  }

  const next: Record<string, unknown> = { ...root }
  for (const k of strippedZvl) delete next[k]
  for (const k of strippedHelpers) delete next[k]
  for (const path of strippedNonRestrictive) deletePathValue(next, path)

  if (strippedNonRestrictive.length > 0) {
    const fileName =
      source === 'localSettings'
        ? '.claude/settings.local.json'
        : '.claude/settings.json'
    const names = strippedNonRestrictive.map(p => p.join('.'))
    logForDebugging(
      `Ignoring ${names.join(', ')} in ${fileName}: this session's host does not trust the folder, so that file can make these settings stricter, not looser. To use such a value, set it in user or managed settings.`,
      { level: 'warn' },
    )
  }

  return next as SettingsJson
}

function stripProjectScopedSettings(
  settings: SettingsJson,
  source: 'projectSettings' | 'localSettings',
): SettingsJson {
  let current = stripProjectScopedTracingSettings(settings, source)
  if (isUntrustedWorkspaceRepoSettingsRestricted(source)) {
    current = filterUntrustedRepoSettings(current, source)
  }
  if (!current.env) return current
  const filteredEnv = stripProjectScopeBlockedEnv(current.env, source)
  if (filteredEnv === current.env) return current
  return { ...current, env: filteredEnv }
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
  const errors = [...getMdmSettings().errors, ...fileErrors]
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
  const local = collectMachineLocalManagedSettings()
  const survivor =
    adminSettingsSurvived(local.mdm) || adminSettingsSurvived(local.file)
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
  // densable YZn: helper > remote > plist/hklm > file > parent > hkcu.
  // Remote managed-settings cache is product-cut; MDM/file/hkcu remain.
  const mdmResult = getMdmSettings()
  if (Object.keys(mdmResult.settings).length > 0) {
    return getPlatform() === 'macos' ? 'plist' : 'hklm'
  }

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
  // Official 2.1.323 (#2059) `Ybn`: pass writeOutsideGitRepo=true so
  // `.claude/settings.local.json` is added to the global gitignore even before
  // `git init` or on a fresh machine.
  void addFileGlobRuleToGitignore(
    getRelativeSettingsFilePathForSource('localSettings'),
    getOriginalCwd(),
    true,
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
  _source: EditableSettingSource,
  filePath: string,
): { error: Error } | { settings: SettingsJson | null; existed: boolean } {
  // Official 2.1.323 (#1983) `Di`/`Ni`: always read FRESH from disk (never from
  // the session parsed-file cache) so hand edits made moments earlier survive,
  // and a file deleted during the session is seen as gone rather than
  // resurrected from stale cache.
  let content: string | null = null
  try {
    const fs = getFsImplementation()
    const { resolvedPath } = safeResolvePath(fs, filePath)
    content = readFileSync(resolvedPath)
  } catch (e) {
    if (!isENOENT(e)) {
      throw e
    }
    return { settings: null, existed: false }
  }

  // densable 2.1.252 `di` empty-file skip
  if (content.trim() === '') {
    return { settings: null, existed: true }
  }

  const parsed = parseSettingsFileContent(content, filePath)
  if (parsed.settings !== null) {
    return { settings: parsed.settings, existed: true }
  }

  const rawData = safeParseJSON(content, false)
  if (rawData === null) {
    const loc = findJsonSyntaxErrorLocation(content)
    const locSuffix = loc ? ` (line ${loc.line}, column ${loc.column})` : ''
    return {
      error: new Error(
        `Invalid JSON syntax in settings file at ${filePath}${locSuffix}`,
      ),
    }
  }
  if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
    logForDebugging(
      `Using raw settings from ${filePath} due to validation failure`,
    )
    return { settings: rawData as SettingsJson, existed: true }
  }
  return {
    error: new Error(`Invalid JSON syntax in settings file at ${filePath}`),
  }
}

function writeSettingsFile(
  source: EditableSettingSource,
  filePath: string,
  updatedSettings: SettingsJson,
): void {
  const serialized = jsonStringify(updatedSettings, null, 2) + '\n'
  markInternalWrite(filePath, serialized)
  writeFileSyncAndFlush_DEPRECATED(filePath, serialized)
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
  _unused?: unknown,
  _storageV5?: unknown,
): { error: Error | null } {
  void _unused
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

  // Official 2.1.323 (#2029/#1983): block project/local settings writes through
  // symlinks that escape the checked project root.
  if (source === 'projectSettings' || source === 'localSettings') {
    const escapeError = checkProjectSettingsSymlinkEscape(source, filePath)
    if (escapeError) {
      return { error: new Error(escapeError.message) }
    }
  }

  try {
    const loaded = loadExistingSettingsForWrite(source, filePath)
    if ('error' in loaded) {
      return { error: loaded.error }
    }
    const merged = mergeSettingsForSource(loaded.settings, settings)
    // Official 2.1.323 (#1983): if the settings file was deleted during the
    // session and this update leaves nothing to persist (e.g. clearing keys to
    // `undefined` or empty patch), keep the deleted file deleted instead of
    // recreating it as `{}`.
    if (!loaded.existed && jsonStringify(merged) === '{}') {
      resetSettingsCache()
      return { error: null }
    }
    getFsImplementation().mkdirSync(dirname(filePath))
    writeSettingsFile(source, filePath, merged)
  } catch (e) {
    const error = new Error(
      `Failed to read raw settings from ${filePath}: ${e}`,
    )
    logError(error)
    return { error }
  }

  return { error: null }
}

const settingsWriteQueues = new Map<string, Promise<unknown>>()

/**
 * densable `FRt` — serialize async settings writes per key (file path) so
 * overlapping writes don't race and `drainSettingsWrites()` can await them.
 */
export function runInSettingsWriteQueue<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = settingsWriteQueues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  const tracked = next.then(
    () => {
      if (settingsWriteQueues.get(key) === tracked) {
        settingsWriteQueues.delete(key)
      }
    },
    () => {
      if (settingsWriteQueues.get(key) === tracked) {
        settingsWriteQueues.delete(key)
      }
    },
  )
  settingsWriteQueues.set(key, tracked)
  return next
}

/** densable `Qlt` — wait for all queued settings writes to settle before exit. */
export async function drainSettingsWrites(): Promise<void> {
  while (settingsWriteQueues.size > 0) {
    await Promise.all([...settingsWriteQueues.values()])
  }
}

registerCleanup(drainSettingsWrites)

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

  // Official 2.1.323 (#2029/#1983): block project/local settings writes through
  // symlinks that escape the checked project root.
  if (source === 'projectSettings' || source === 'localSettings') {
    const escapeError = checkProjectSettingsSymlinkEscape(source, filePath)
    if (escapeError) {
      return { error: new Error(escapeError.message) }
    }
  }

  const write = settingsStorageV5Write(storageV5)
  const viaStorageV5 =
    isHoverRestOn() &&
    write !== undefined &&
    isDefaultUserSettingsPath(source, filePath)

  if (!viaStorageV5) {
    return updateSettingsForSource(source, settings, storageV5)
  }

  return runInSettingsWriteQueue(filePath, async () => {
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
  })
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
  // Official 2.1.326 (#18): never merge prototype-pollution keys
  if (typeof key === 'string' && PROTOTYPE_DANGEROUS_KEYS.has(key)) {
    return objValue
  }
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
      'blockReadsOutsideWorkingDirectories',
      'blockWritesOutsideWorkingDirectories',
      'blockFileToolReadsOutsideWorkingDirectories',
      'denyInsteadOfPrompting',
    ]),
    sandbox: new Set([
      'enabled',
      'failIfUnavailable',
      'allowUnsandboxedCommands',
      'network',
      'filesystem',
      'credentials',
      'windows',
      'ignoreViolations',
      'excludedCommands',
      'autoAllowBashIfSandboxed',
      'enableWeakerNestedSandbox',
      'allowNestedUserNamespaces',
      'enableWeakerNetworkIsolation',
      'allowAppleEvents',
      'ripgrep',
      'bwrapPath',
      'socatPath',
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

type HostSettingsPipelineState = {
  isLoadingSettings: boolean
  managedRereadInFlight: Promise<boolean> | undefined
  managedRereadGivenUp: boolean
  managedMdmRereadFailedAt: number
  managedMdmRereadFailedFor: object | undefined
}

const hostSettingsPipelineSlot = new HostSlot<HostSettingsPipelineState>(
  () => ({
    isLoadingSettings: false,
    managedRereadInFlight: undefined,
    managedRereadGivenUp: false,
    managedMdmRereadFailedAt: 0,
    managedMdmRereadFailedFor: undefined,
  }),
)

function getHostSettingsPipelineState(): HostSettingsPipelineState {
  return hostSettingsPipelineSlot.of(getBootstrapSessionHost())
}

/**
 * Load settings from disk without using cache
 * This is the original implementation that actually reads from files
 */
function loadSettingsFromDisk(): SettingsWithErrors {
  // Prevent recursive calls to loadSettingsFromDisk
  const pipelineState = getHostSettingsPipelineState()
  if (pipelineState.isLoadingSettings) {
    return { settings: {}, errors: [] }
  }

  const startTime = Date.now()
  profileCheckpoint('loadSettingsFromDisk_start')
  logForDiagnosticsNoPII('info', 'settings_load_started')

  pipelineState.isLoadingSettings = true
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
          // Official 2.1.325 #2354: when the highest-ranking managed source
          // enables the sandbox without explicitly setting
          // `sandbox.autoAllowBashIfSandboxed: true`, never inherit a `true`
          // value from user/project/local settings.
          if (
            policySettings.sandbox?.enabled === true &&
            policySettings.sandbox.autoAllowBashIfSandboxed !== true
          ) {
            mergedSettings.sandbox = {
              ...mergedSettings.sandbox,
              autoAllowBashIfSandboxed: false,
            }
          }
          // densable w6i: policy availableModels / enforceAvailableModels
          // re-applied as replace (not concat) after full merge.
          if (policySettings.availableModels !== undefined) {
            mergedSettings.availableModels = [...policySettings.availableModels]
          }
          if (policySettings.enforceAvailableModels !== undefined) {
            mergedSettings.enforceAvailableModels =
              policySettings.enforceAvailableModels
          }
          // densable Nzo: exact match copies when exact, or when both match+list set
          if (
            policySettings.availableModelsMatch === 'exact' ||
            (policySettings.availableModelsMatch !== undefined &&
              policySettings.availableModels !== undefined)
          ) {
            mergedSettings.availableModelsMatch =
              policySettings.availableModelsMatch
          }
          if (
            policySettings.deniedModels !== undefined &&
            policySettings.deniedModels.length > 0
          ) {
            mergedSettings.deniedModels = policySettings.deniedModels
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

          const { settings, errors } = parseSettingsFileForSource(
            source,
            filePath,
          )

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
                ? stripProjectScopedSettings(settings, source)
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
    pipelineState.isLoadingSettings = false
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
 * densable Yo — highest-priority enabled source that defines `key`, else
 * `{value: defaultValue, source: "default"}`. Gold
 * `Yo("switchModelsOnFlag", !0).source==="default"` is the first-ask gate.
 */
export function getSettingValueWithSource<K extends keyof SettingsJson>(
  key: K,
  defaultValue: NonNullable<SettingsJson[K]>,
): {
  value: NonNullable<SettingsJson[K]>
  source: SettingSource | 'default'
} {
  const sources = getEnabledSettingSources()
  for (let i = sources.length - 1; i >= 0; i--) {
    const source = sources[i]!
    const settings = getSettingsForSource(source)
    const raw = settings?.[key]
    if (raw !== undefined) {
      return {
        value: raw as NonNullable<SettingsJson[K]>,
        source,
      }
    }
  }
  return { value: defaultValue, source: 'default' }
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

const SCI_INT_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)[eE][+-]?\d+$/
const GROUPED_INT_RE = /^[+-]?\d{1,3}([_,\u00A0\u202F ])\d{3}(?:\1\d{3})*$/
const GROUP_SEP_RE = /[_,\u00A0\u202F ]/g

/**
 * SEA `H.int({ wholeValue: true })` (`ngi` + `qp`): strict whole-integer parser
 * so values with unit suffixes like `"5m"` or decimals like `"12.5"` do not
 * silently parse via `parseInt` prefix matching.
 */
function parseWholeIntEnv(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (/^[+-]?\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10)
    return Number.isFinite(n) ? n : undefined
  }
  if (trimmed.length <= 32) {
    if (SCI_INT_RE.test(trimmed)) {
      const n = Number(trimmed)
      return Number.isInteger(n) && Number.isFinite(n) ? n : undefined
    }
    if (GROUPED_INT_RE.test(trimmed)) {
      const n = parseInt(trimmed.replace(GROUP_SEP_RE, ''), 10)
      return Number.isFinite(n) ? n : undefined
    }
  }
  return undefined
}

/**
 * densable dialogExpiry → ms; null when "never".
 * CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS overrides when set (strict positive whole int).
 */
export function dialogExpiryToMs(
  value: DialogExpiry | undefined = getDialogExpiry(),
): number | null {
  const envMs = process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS
  if (envMs !== undefined && envMs !== '') {
    const parsed = parseWholeIntEnv(envMs)
    if (parsed !== undefined && parsed > 0) {
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
 * Official 2.1.325 #2298 (`y_` / `o8r`): valid `teammateMode` settings values.
 */
export const TEAMMATE_MODE_VALUES = [
  'tmux',
  'iterm2',
  'in-process',
  'auto',
] as const

export type TeammateModeSetting = (typeof TEAMMATE_MODE_VALUES)[number]

/**
 * Official 2.1.325 #2298 (`y_`): validate `teammateMode` in raw settings JSON.
 * Unrecognized values are removed (not applied) and reported as a skipped
 * warning surfaced in startup warnings, `claude doctor`, and `claude -p`.
 */
export function filterInvalidTeammateMode(
  data: unknown,
  filePath: string,
  options?: { policySource?: boolean },
): ValidationError[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const obj = data as Record<string, unknown>
  const value = obj.teammateMode
  if (
    value === undefined ||
    (typeof value === 'string' &&
      (TEAMMATE_MODE_VALUES as readonly string[]).includes(value))
  ) {
    return []
  }
  const isPolicy = options?.policySource === true
  if (!isPolicy) {
    delete obj.teammateMode
  }
  const expected = TEAMMATE_MODE_VALUES.map(v => `"${v}"`).join(', ')
  const received = formatReceivedCrossSessionInbound(value)
  const suffix = isPolicy
    ? 'In managed settings this value is ignored and teammates use the mode from other settings or the default ("in-process").'
    : 'This value is ignored and teammates use the mode from your other settings or the default ("in-process"); change it to one of the values above.'
  return [
    {
      file: filePath,
      path: 'teammateMode',
      message: `"teammateMode" must be one of ${expected}; received ${received}. ${suffix}`,
      severity: 'warning',
      expected,
    },
  ]
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

const AUTO_MODE_DEFAULTS_SENTINEL = '$defaults'

/**
 * Official 2.1.326 `lho` (#322):
 * When managed `policySettings.autoMode.environment` (or `.allow`) is configured
 * WITHOUT `"$defaults"`, strip `"$defaults"` from `flagSettings` (used by Claude
 * Desktop and Agent SDK apps) so the managed list replaces every built-in entry
 * everywhere (`getAutoModeConfig`, classifier prompts, server context, and
 * `claude auto-mode config/critique`).
 */
export function stripDefaultsFromFlagAutoModeSection(
  _section: 'allow' | 'environment',
  flagEntries: readonly string[],
  policyEntries: readonly string[] | undefined,
): string[] {
  if (
    flagEntries.includes(AUTO_MODE_DEFAULTS_SENTINEL) &&
    Boolean(policyEntries?.length) &&
    !policyEntries!.includes(AUTO_MODE_DEFAULTS_SENTINEL)
  ) {
    return flagEntries.filter(entry => entry !== AUTO_MODE_DEFAULTS_SENTINEL)
  }
  return [...flagEntries]
}

/**
 * Returns the merged autoMode config from trusted settings sources.
 * Only available when TRANSCRIPT_CLASSIFIER is active; returns undefined otherwise.
 *
 * Source policy (official Claude Code 2.1.207 + 2.1.326 `yM()`/`Ci()`/`lho()`):
 * - projectSettings excluded — malicious project could inject classifier rules
 * - localSettings (`.claude/settings.local.json`) also excluded since 2.1.207 —
 *   repo-resident autoMode is ignored; use `~/.claude/settings.json` instead
 * - userSettings / flagSettings / policySettings are honored
 * - When policySettings.autoMode.allow or .environment omits "$defaults",
 *   "$defaults" is stripped from flagSettings before merging.
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

    const sources = [
      'userSettings',
      // localSettings intentionally omitted — official 2.1.207 no longer reads
      // autoMode from `.claude/settings.local.json` (repo-resident).
      'flagSettings',
      'policySettings',
    ] as const
    type AutoModeTrustedSource = (typeof sources)[number]

    const allowBySource: Partial<Record<AutoModeTrustedSource, string[]>> = {}
    const envBySource: Partial<Record<AutoModeTrustedSource, string[]>> = {}
    const soft_deny: string[] = []
    const hard_deny: string[] = []

    for (const source of sources) {
      const settings = getSettingsForSource(source)
      if (!settings) continue
      const result = schema.safeParse(
        (settings as Record<string, unknown>).autoMode,
      )
      if (result.success) {
        if (result.data.allow) allowBySource[source] = result.data.allow
        if (result.data.soft_deny) soft_deny.push(...result.data.soft_deny)
        if (result.data.hard_deny) hard_deny.push(...result.data.hard_deny)
        if (process.env.USER_TYPE === 'ant') {
          if (result.data.deny) soft_deny.push(...result.data.deny)
        }
        if (result.data.environment)
          envBySource[source] = result.data.environment
      }
    }

    if (allowBySource.flagSettings) {
      allowBySource.flagSettings = stripDefaultsFromFlagAutoModeSection(
        'allow',
        allowBySource.flagSettings,
        allowBySource.policySettings,
      )
    }
    if (envBySource.flagSettings) {
      envBySource.flagSettings = stripDefaultsFromFlagAutoModeSection(
        'environment',
        envBySource.flagSettings,
        envBySource.policySettings,
      )
    }

    const allow = sources.flatMap(source => allowBySource[source] ?? [])
    const environment = sources.flatMap(source => envBySource[source] ?? [])

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

// #371 SEA aqe/i0 (chunk@286370035.js @152475): Coalesced async re-read of
// OS MDM (when a prior read had a transient unread failure) and managed-settings
// files (`managed-settings.json` + `managed-settings.d/*.json`).
const MANAGED_REREAD_TIMEOUT_MS = 5000
const MANAGED_REREAD_MAX_RETRIES = 2
const MANAGED_MDM_REREAD_COOLDOWN_MS = 60_000

export function managedRereadInFlight(): Promise<boolean> | undefined {
  return getHostSettingsPipelineState().managedRereadInFlight
}

export function beginManagedReread(promise: Promise<boolean>): void {
  getHostSettingsPipelineState().managedRereadInFlight = promise
}

export function releaseManagedReread(promise: Promise<boolean>): void {
  const pipelineState = getHostSettingsPipelineState()
  if (pipelineState.managedRereadInFlight === promise) {
    pipelineState.managedRereadInFlight = undefined
  }
}

export function giveUpManagedReread(): void {
  getHostSettingsPipelineState().managedRereadGivenUp = true
}

export function managedRereadGivenUp(): boolean {
  return getHostSettingsPipelineState().managedRereadGivenUp
}

export function resetManagedRereadStateForTesting(): void {
  const pipelineState = getHostSettingsPipelineState()
  pipelineState.managedRereadInFlight = undefined
  pipelineState.managedRereadGivenUp = false
  pipelineState.managedMdmRereadFailedAt = 0
  pipelineState.managedMdmRereadFailedFor = undefined
}

/**
 * Official 2.1.328 `ap()` (chunk@286370035.js @152475): returns the retryable
 * unread cause when OS MDM did not load due to a transient subprocess failure.
 */
function getRetryableMdmUnreadCause(mdm: {
  settings: SettingsJson
  errors: ValidationError[]
}): MdmUnreadCause | undefined {
  if (Object.keys(mdm.settings).length > 0) {
    return undefined
  }
  return mdm.errors.find(
    e => e.severity !== 'warning' && isRetryableMdmUnreadCause(e.unreadCause),
  )?.unreadCause
}

/**
 * Official 2.1.323 (#2058): Fresh uncached read of `managed-settings.json` and
 * `managed-settings.d/*.json` directly from disk, bypassing the parsed-file
 * cache so files rewritten concurrently at startup can be picked up on re-read.
 */
function loadManagedFileSettingsFresh(): {
  settings: SettingsJson | null
  errors: ValidationError[]
  hadReadFailure: boolean
} {
  const errors: ValidationError[] = []
  let merged: SettingsJson = {}
  let found = false
  let hadReadFailure = false

  const basePath = getManagedSettingsFilePath()
  const base = parseSettingsFileUncached(basePath)
  errors.push(...base.errors)
  if (base.errors.some(e => e.severity !== 'warning')) {
    hadReadFailure = true
  }
  if (base.settings && Object.keys(base.settings).length > 0) {
    merged = mergeWith(merged, base.settings, settingsMergeCustomizer)
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
      const dropPath = join(dropInDir, name)
      const drop = parseSettingsFileUncached(dropPath)
      errors.push(...drop.errors)
      if (drop.errors.some(e => e.severity !== 'warning')) {
        hadReadFailure = true
      }
      if (drop.settings && Object.keys(drop.settings).length > 0) {
        merged = mergeWith(merged, drop.settings, settingsMergeCustomizer)
        // Official 2.1.325 #2354: keep fresh reread merge aligned with loadManagedFileSettings.
        if (
          drop.settings.sandbox?.enabled === true &&
          drop.settings.sandbox.autoAllowBashIfSandboxed !== true &&
          merged.sandbox
        ) {
          merged.sandbox = {
            ...merged.sandbox,
            autoAllowBashIfSandboxed: false,
          }
        }
        found = true
      }
    }
  } catch (e) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      hadReadFailure = true
      logError(e)
    }
  }

  return { settings: found ? merged : null, errors, hadReadFailure }
}

export async function rereadManagedSettingsIfNeeded(
  timeoutMs: number = MANAGED_REREAD_TIMEOUT_MS,
): Promise<boolean> {
  const pipelineState = getHostSettingsPipelineState()
  if (pipelineState.managedRereadInFlight !== undefined) {
    return pipelineState.managedRereadInFlight
  }
  if (pipelineState.managedRereadGivenUp) {
    return false
  }
  const run = (async (): Promise<boolean> => {
    let changed = false

    // Official 2.1.328 `aqe` + `i0` (chunk@286370035.js @152475):
    // 1. Refresh OS MDM slice when prior MDM load had a transient unread failure,
    // comparing equivalent MDM/HKCU slices rather than merged policySettings.
    const prevMdm = getMdmSettings()
    const prevHkcu = getHkcuSettings()
    const retryableMdmCause = getRetryableMdmUnreadCause(prevMdm)
    if (
      retryableMdmCause !== undefined &&
      !(
        pipelineState.managedMdmRereadFailedFor === prevMdm &&
        Date.now() - pipelineState.managedMdmRereadFailedAt <
          MANAGED_MDM_REREAD_COOLDOWN_MS
      )
    ) {
      const startedAt = Date.now()
      try {
        const refreshed = await refreshMdmSettings()
        if (getRetryableMdmUnreadCause(refreshed.mdm) === undefined) {
          const mdmChanged =
            JSON.stringify(prevMdm.settings) !==
              JSON.stringify(refreshed.mdm.settings) ||
            JSON.stringify(prevHkcu.settings) !==
              JSON.stringify(refreshed.hkcu.settings) ||
            prevMdm.errors.length !== refreshed.mdm.errors.length
          setMdmSettingsCache(refreshed.mdm, refreshed.hkcu)
          if (mdmChanged) {
            resetSettingsCache()
            changed = true
          }
        } else {
          pipelineState.managedMdmRereadFailedFor = prevMdm
          pipelineState.managedMdmRereadFailedAt = startedAt
        }
      } catch (e) {
        logError(e)
        pipelineState.managedMdmRereadFailedFor = prevMdm
        pipelineState.managedMdmRereadFailedAt = startedAt
      }
    }

    // 2. Compare equivalent managed FILE policy slices (cached file slice vs
    // fresh disk read of managed-settings.json + managed-settings.d/*.json).
    const deadline = Date.now() + timeoutMs
    const prevFileSettings = loadManagedFileSettings().settings
    const prevFileJson = JSON.stringify(prevFileSettings ?? null)
    for (let attempt = 0; attempt <= MANAGED_REREAD_MAX_RETRIES; attempt++) {
      const remaining = Math.max(0, deadline - Date.now())
      if (remaining === 0 && attempt > 0) {
        giveUpManagedReread()
        return changed
      }
      // Official 2.1.323 (#2058): read fresh from disk (not cached) so a file
      // that was being rewritten at startup is read a second time.
      const fresh = loadManagedFileSettingsFresh()
      const nextFileJson = JSON.stringify(fresh.settings ?? null)
      if (prevFileJson !== nextFileJson) {
        resetSettingsCache()
        return true
      }
      // If a transient read failure occurred or file was mid-rewrite, yield
      // briefly and retry once more within the deadline.
      if (fresh.hadReadFailure && attempt < MANAGED_REREAD_MAX_RETRIES) {
        await new Promise(resolveDelay =>
          setTimeout(resolveDelay, Math.min(40, remaining)),
        )
        continue
      }
      return changed
    }
    return changed
  })()
  beginManagedReread(run)
  try {
    return await run
  } finally {
    // Official `aqe`: always clear in-flight promise once settled; never
    // permanently latch `Promise.resolve(false)`.
    releaseManagedReread(run)
  }
}

// ============================================================================
// Official 2.1.331 Project Settings Fail-Closed When Serving (`08b_project_settings_serve.js`)
// (`D_s`, `PH`, `DH`, `Xmr` engage-time fail-closed guard)
// ============================================================================

export {
  ORG_HELPER_DEFAULT_MAX_BUFFER,
  ORG_HELPER_DEFAULT_TIMEOUT_MS,
  ORG_HELPER_EXIT_DRAIN_MS,
  ORG_HELPER_OUTPUT_LIMIT_ERROR,
  ORG_HELPER_OUTPUT_LIMIT_LOG,
  OrganizationHelperOutputLimitError,
  type SpawnOrganizationHelperOptions,
  type SpawnOrganizationHelperResult,
  spawnOrganizationHelper,
} from './orgHelperExecutor.js'

/** Official 2.1.331 `CH` */
export const SERVED_PROJECT_SETTINGS_SLOTS = [
  'project',
  'local',
  'legacy',
] as const

export type ServedProjectSettingsSlot =
  (typeof SERVED_PROJECT_SETTINGS_SLOTS)[number]

/** Official 2.1.331 `MH` */
export const SERVED_PROJECT_SETTINGS_RETRY_COUNT = 3

/** Official 2.1.331 `OH` */
export const SERVED_PROJECT_SETTINGS_RETRY_DELAY_MS = 100

/** Official 2.1.331 `D_s` exact message */
export const SERVED_SETTINGS_UNREADABLE_MESSAGE =
  'A project settings file could not be read as serving began, so nothing is served'

/** Official 2.1.331 `DH` exact message */
export const SERVED_SETTINGS_ACCEPTED_UNREADABLE_MESSAGE =
  'What was accepted for this settings file could not be read, so it is not applied to cloud sessions. Run claude apply-project-settings in a terminal in this folder to accept it again.'

/**
 * Official 2.1.331 `D_s`: thrown when a project settings file cannot be read
 * (or its symlink containment cannot be determined) as serving begins, failing
 * closed so nothing is served.
 */
export class ProjectSettingsServeUnreadableError extends Error {
  constructor() {
    super(SERVED_SETTINGS_UNREADABLE_MESSAGE)
    this.name = 'ProjectSettingsServeUnreadableError'
  }
}

export type ServedSettingsSlotReadOutcome =
  | 'absent'
  | 'unreadable'
  | { text: string }

export type ServedSettingsLinkedAwayOutcome = boolean | 'cannot_tell'

export type ServedSettingsSlotsDescriptor = {
  project: string | null
  local: string | null
  legacy: string | null
  linkedAway: readonly ServedProjectSettingsSlot[]
  notFollowed?: readonly ServedProjectSettingsSlot[]
}

export type ServedSettingsSlotSnapshot = {
  slot: ServedProjectSettingsSlot
  path: string
  read: ServedSettingsSlotReadOutcome
  away: boolean
}

function sleepSyncMs(ms: number): void {
  if (ms <= 0) return
  if (typeof Bun !== 'undefined' && typeof Bun.sleepSync === 'function') {
    Bun.sleepSync(ms)
    return
  }
  const end = Date.now() + ms
  while (Date.now() < end) {
    // busy wait fallback only when Bun.sleepSync is unavailable
  }
}

/**
 * Official 2.1.331 `PH(readSlot, checkLinkedAway, filePath, notFollowed)`:
 * Retries up to `MH` (3) times with `OH` (100ms) delay whenever a slot's
 * symlink check returns `'cannot_tell'` or its read returns `'unreadable'`
 * while not confirmed to be linked away.
 */
export function readProjectSettingsSlotWithRetry(
  readSlot: (filePath: string) => ServedSettingsSlotReadOutcome,
  checkLinkedAway: (filePath: string) => ServedSettingsLinkedAwayOutcome,
  filePath: string,
  notFollowed: boolean,
  options?: {
    maxAttempts?: number
    retryDelayMs?: number
    sleepFn?: (ms: number) => void
  },
): {
  read: ServedSettingsSlotReadOutcome
  leadNow: ServedSettingsLinkedAwayOutcome
} {
  const maxAttempts =
    options?.maxAttempts ?? SERVED_PROJECT_SETTINGS_RETRY_COUNT
  const retryDelayMs =
    options?.retryDelayMs ?? SERVED_PROJECT_SETTINGS_RETRY_DELAY_MS
  const sleep = options?.sleepFn ?? sleepSyncMs

  for (let attempt = 1; ; attempt++) {
    const before: ServedSettingsLinkedAwayOutcome = notFollowed
      ? checkLinkedAway(filePath)
      : false
    const read = readSlot(filePath)
    const after = checkLinkedAway(filePath)
    const leadNow: ServedSettingsLinkedAwayOutcome =
      before === 'cannot_tell' || after === 'cannot_tell'
        ? 'cannot_tell'
        : before || after
    if (
      !(
        leadNow === 'cannot_tell' ||
        (read === 'unreadable' && leadNow !== true)
      ) ||
      attempt >= maxAttempts
    ) {
      return { read, leadNow }
    }
    sleep(retryDelayMs)
  }
}

/**
 * Official 2.1.331 `Xmr` engage-time fail-closed guard (`08b_project_settings_serve.js`):
 * Inspects each non-null project settings slot (`project`, `local`, `legacy`).
 * If any present slot cannot determine symlink containment (`'cannot_tell'`) or
 * is `'unreadable'` without being confirmed linked-away, throws
 * `ProjectSettingsServeUnreadableError` (`"A project settings file could not be
 * read as serving began, so nothing is served"`).
 */
export function assertProjectSettingsReadableForServing(
  slots: ServedSettingsSlotsDescriptor,
  readSlot: (filePath: string) => ServedSettingsSlotReadOutcome,
  checkLinkedAway: (filePath: string) => ServedSettingsLinkedAwayOutcome = () =>
    false,
  options?: {
    maxAttempts?: number
    retryDelayMs?: number
    sleepFn?: (ms: number) => void
  },
): ServedSettingsSlotSnapshot[] {
  const snapshots: ServedSettingsSlotSnapshot[] = []
  for (const slot of SERVED_PROJECT_SETTINGS_SLOTS) {
    const filePath = slots[slot]
    if (filePath === null) continue
    const notFollowed = slots.notFollowed?.includes(slot) === true
    const { read, leadNow } = readProjectSettingsSlotWithRetry(
      readSlot,
      checkLinkedAway,
      filePath,
      notFollowed,
      options,
    )
    const away =
      leadNow === true || (slots.linkedAway.includes(slot) && !notFollowed)
    if (
      read !== 'absent' &&
      (leadNow === 'cannot_tell' || (read === 'unreadable' && !away))
    ) {
      throw new ProjectSettingsServeUnreadableError()
    }
    snapshots.push({
      slot,
      path: filePath,
      read,
      away: away || leadNow === 'cannot_tell',
    })
  }
  return snapshots
}

/**
 * Official 2.1.331 `DH(filePath)`:
 * Fatal settings load result when the accepted settings record for a served
 * project settings file could not be read.
 */
export function createAcceptedSettingsUnreadableResult(filePath: string): {
  settings: null
  errors: Array<{
    file: string
    path: string
    message: string
    severity: 'fatal'
  }>
  loadState: 'didNotLoad'
} {
  return {
    settings: null,
    errors: [
      {
        file: filePath,
        path: '',
        message: SERVED_SETTINGS_ACCEPTED_UNREADABLE_MESSAGE,
        severity: 'fatal',
      },
    ],
    loadState: 'didNotLoad',
  }
}

/**
 * Real-filesystem convenience entry point for `assertProjectSettingsReadableForServing`:
 * reads `.claude/settings.json` (`project`) and `.claude/settings.local.json` (`local`)
 * under `cwd` and throws `ProjectSettingsServeUnreadableError` if any present file
 * is unreadable as serving begins.
 */
export function probeProjectSettingsForServing(
  cwd: string = getOriginalCwd(),
  options?: {
    maxAttempts?: number
    retryDelayMs?: number
    sleepFn?: (ms: number) => void
  },
): ServedSettingsSlotSnapshot[] {
  const fs = getFsImplementation()
  const projectPath = join(cwd, '.claude', 'settings.json')
  const localPath = join(cwd, '.claude', 'settings.local.json')
  const readSlot = (filePath: string): ServedSettingsSlotReadOutcome => {
    try {
      return { text: fs.readFileSync(filePath, { encoding: 'utf-8' }) }
    } catch (err) {
      const code = getErrnoCode(err)
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return 'absent'
      }
      return 'unreadable'
    }
  }
  const checkLinkedAway = (
    filePath: string,
  ): ServedSettingsLinkedAwayOutcome => {
    try {
      const canonicalRoot = fs.realpathSync(cwd)
      const isOutsideRoot = (target: string): boolean => {
        const rel = relative(canonicalRoot, target)
        return rel.startsWith('..') || isAbsolute(rel)
      }
      const parentDir = dirname(filePath)
      const parentResolved = safeResolvePath(fs, parentDir)
      if (
        parentResolved.isSymlink &&
        isOutsideRoot(parentResolved.resolvedPath)
      ) {
        return true
      }
      const { resolvedPath, isSymlink } = safeResolvePath(fs, filePath)
      if (!isSymlink) return false
      return isOutsideRoot(resolvedPath)
    } catch (err) {
      const code = getErrnoCode(err)
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return false
      }
      return 'cannot_tell'
    }
  }
  return assertProjectSettingsReadableForServing(
    {
      project: projectPath,
      local: localPath,
      legacy: null,
      linkedAway: [],
    },
    readSlot,
    checkLinkedAway,
    options,
  )
}
