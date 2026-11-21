/**
 * Official 2.1.323 #1965 (`Twe` / `Ubs` / `Jpe` / `rY` / `uke` / `pxe` / `U8e` / `$bo` / `Bbo`):
 * `engines["claude-code"]` semver range parsing, validation, load gating,
 * install/update version fallback, and user-facing diagnostics.
 */
import * as semver from 'semver'
import type {
  LoadedPlugin,
  PluginEngineRangeMiss,
  PluginError,
  PluginWarning,
} from '../../types/plugin.js'
import { NAME_CONTROL_OR_BIDI_RE } from './schemas.js'

const MAX_ENGINE_RANGE_LENGTH = 256
const MAX_STATED_TEXT_LENGTH = 120
export const MAX_OLDER_VERSION_CANDIDATES = 5

export function sanitizeRangeDisplay(text: string, maxLen = 200): string {
  const clean = text.replace(
    /[\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu,
    '',
  )
  return clean.length <= maxLen ? clean : `${clean.slice(0, maxLen - 1)}…`
}

/** Official `Jpe` — extract `engines["claude-code"]` via own-property check. */
export function extractClaudeCodeEngineRange(engines: unknown): unknown {
  if (
    engines === null ||
    typeof engines !== 'object' ||
    Array.isArray(engines)
  ) {
    return undefined
  }
  const rec = engines as Record<string, unknown>
  return Object.hasOwn(rec, 'claude-code') ? rec['claude-code'] : undefined
}

/** Official `Ubs` — true when value is a valid, bounded semver range string. */
export function isValidClaudeCodeEngineRange(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ENGINE_RANGE_LENGTH &&
    !NAME_CONTROL_OR_BIDI_RE.test(value) &&
    semver.validRange(value) !== null
  )
}

export type EngineRangeCheckResult =
  | { kind: 'fits' }
  | { kind: 'unreadable'; statedText?: string }
  | { kind: 'outside'; miss: PluginEngineRangeMiss }

export function getCurrentClaudeCodeVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof MACRO !== 'undefined' && typeof MACRO.VERSION === 'string') {
      return MACRO.VERSION
    }
  } catch {
    /* ignore */
  }
  return '2.1.323'
}

/**
 * Official `Twe` — check a plugin's `engines["claude-code"]` value against the
 * running Claude Code version.
 */
export function checkClaudeCodeEngineRange(
  stated: unknown,
  currentVersion: string = getCurrentClaudeCodeVersion(),
): EngineRangeCheckResult {
  if (stated === undefined) {
    return { kind: 'fits' }
  }
  if (!isValidClaudeCodeEngineRange(stated)) {
    return {
      kind: 'unreadable',
      ...(typeof stated === 'string'
        ? { statedText: sanitizeRangeDisplay(stated, MAX_STATED_TEXT_LENGTH) }
        : {}),
    }
  }
  const coerced = semver.coerce(currentVersion)?.version ?? currentVersion
  if (!semver.valid(coerced)) {
    return { kind: 'fits' }
  }
  if (semver.satisfies(coerced, stated, { includePrerelease: true })) {
    return { kind: 'fits' }
  }
  const branches = stated.split('||')
  const newerClaudeCodeMayFit = !branches.every(branch => {
    const trimmed = branch.trim()
    if (!trimmed) return true
    try {
      return semver.minVersion(trimmed) === null || semver.gtr(coerced, trimmed)
    } catch {
      return true
    }
  })
  return {
    kind: 'outside',
    miss: {
      range: stated,
      claudeCodeVersion: currentVersion,
      newerClaudeCodeMayFit,
    },
  }
}

/** Official `rY` — `"needs Claude Code <range>, this is <current>"`. */
export function formatEngineRangeMiss(miss: PluginEngineRangeMiss): string {
  return `needs Claude Code ${sanitizeRangeDisplay(miss.range)}, this is ${sanitizeRangeDisplay(miss.claudeCodeVersion)}`
}

/** Official `uke` — update guidance when outside range. */
export function formatEngineRangeGuidance(miss: PluginEngineRangeMiss): string {
  return miss.newerClaudeCodeMayFit
    ? 'Run `claude update`'
    : 'A newer version of the plugin may fit'
}

/** Official `Bbo` — summary note when install picked an older compatible version. */
export function formatOlderCompatibleInstallNote(
  info: {
    version: string
    rejectedVersion?: string
    miss: PluginEngineRangeMiss
  },
  pluginName?: string,
): string {
  const installedLabel =
    pluginName === undefined
      ? info.version
      : `"${sanitizeRangeDisplay(pluginName, 120)}" ${info.version}`
  const rejectedLabel =
    info.rejectedVersion === undefined
      ? "The marketplace's version"
      : sanitizeRangeDisplay(info.rejectedVersion, 100)
  return `Installed ${installedLabel}, the newest that works on your version. ${rejectedLabel} needs Claude Code ${sanitizeRangeDisplay(info.miss.range)}`
}

/** Official `pxe` — error thrown when installing a plugin whose range doesn't fit. */
export class PluginEngineRangeError extends Error {
  readonly miss: PluginEngineRangeMiss
  readonly pluginName: string

  constructor(pluginName: string, miss: PluginEngineRangeMiss) {
    super(
      `Plugin "${sanitizeRangeDisplay(pluginName, 120)}" ${formatEngineRangeMiss(miss)}. ${formatEngineRangeGuidance(miss)}`,
    )
    this.name = 'PluginEngineRangeError'
    this.pluginName = pluginName
    this.miss = miss
  }
}

/**
 * Official `U8e` — filter enabled loaded plugins against `engines["claude-code"]`.
 * Plugins read in place from a local folder (`readInPlace` or `@inline`) still
 * load with an `engine-range-exempt` warning; installed marketplace plugins
 * outside range are disabled and emit `engine-range-unsatisfied`.
 */
export function filterPluginsByEngineRange(
  plugins: LoadedPlugin[],
  errors: PluginError[],
  warnings: PluginWarning[],
  currentVersion: string = getCurrentClaudeCodeVersion(),
): void {
  for (const plugin of plugins) {
    if (!plugin.enabled) continue
    const stated = extractClaudeCodeEngineRange(plugin.manifest.engines)
    const check = checkClaudeCodeEngineRange(stated, currentVersion)
    if (check.kind === 'fits') continue
    if (check.kind === 'unreadable') {
      warnings.push({
        type: 'engine-range-invalid',
        source: plugin.source,
        plugin: plugin.name,
        statedText: check.statedText,
      })
      continue
    }
    const isLocalFolder =
      plugin.readInPlace === true || plugin.source.endsWith('@inline')
    if (isLocalFolder) {
      warnings.push({
        type: 'engine-range-exempt',
        source: plugin.source,
        plugin: plugin.name,
        miss: check.miss,
      })
      continue
    }
    plugin.enabled = false
    errors.push({
      type: 'engine-range-unsatisfied',
      source: plugin.source,
      plugin: plugin.name,
      miss: check.miss,
    })
  }
}

/**
 * Official `$bo` core selection — given available version strings (from npm or
 * git tags), filter to stable semver candidates matching optional bounds and
 * return up to `MAX_OLDER_VERSION_CANDIDATES` sorted newest-first.
 */
export function selectOlderCompatibleVersionCandidates(
  versions: readonly string[],
  bounds?: {
    below?: string
    above?: string
    within?: string
    sourceRange?: string
  },
): string[] {
  return versions
    .filter(
      v =>
        semver.valid(v) === v &&
        semver.prerelease(v) === null &&
        (bounds?.below === undefined || semver.lt(v, bounds.below)) &&
        (bounds?.above === undefined || semver.gt(v, bounds.above)) &&
        (bounds?.within === undefined || semver.satisfies(v, bounds.within)) &&
        (bounds?.sourceRange === undefined ||
          semver.satisfies(v, bounds.sourceRange)),
    )
    .sort((a, b) => semver.rcompare(a, b))
    .slice(0, MAX_OLDER_VERSION_CANDIDATES)
}

/**
 * Official 2.1.328 `j2o` (`chunk@294254613.js @5367460`) — verify that an
 * older candidate tag's `plugin.json` matches the candidate version.
 */
export function verifyOlderCandidateManifestVersion(
  candidate: { version: string; tag?: unknown },
  manifest: { version?: string } | undefined,
): string | undefined {
  if (manifest === undefined && candidate.tag !== undefined) {
    return 'its tag has no plugin.json'
  }
  if (
    manifest?.version !== undefined &&
    semver.valid(manifest.version) !== candidate.version
  ) {
    return `its plugin.json says version ${sanitizeRangeDisplay(manifest.version, 100)}`
  }
  return undefined
}

/**
 * Official 2.1.328 `Gt` (`chunk@306660664.js @125000`) — format the update
 * summary message when an older compatible version was installed because the
 * marketplace's newest version requires a different Claude Code range.
 */
export function formatOlderCompatibleUpdateMessage(info: {
  baseMessage: string
  rejectedVersion?: string
  miss: PluginEngineRangeMiss
  refreshWarning?: string
}): string {
  const rejectedLabel = info.rejectedVersion
    ? sanitizeRangeDisplay(info.rejectedVersion, 100)
    : "the marketplace's version"
  const warningSuffix =
    info.refreshWarning === undefined ? '' : ` Warning: ${info.refreshWarning}.`
  return `${info.baseMessage} It's the newest that works on your version: ${rejectedLabel} ${formatEngineRangeMiss(info.miss)}.${warningSuffix}`
}
