import axios from 'axios'
import { constants as fsConstants, realpathSync } from 'fs'
import {
  access,
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import semver from 'semver'
import {
  getDynamicConfig_BLOCKS_ON_INIT,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from 'src/services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { isInBundledMode } from './bundledMode.js'
import { type ReleaseChannel, saveGlobalConfig } from './config.js'
import { logForDebugging } from './debug.js'
import { env } from './env.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { ClaudeError, getErrnoCode, isENOENT } from './errors.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import { gracefulShutdownSync } from './gracefulShutdown.js'
import { logError } from './log.js'
import { gt, gte, lt, lte } from './semver.js'
import {
  getInitialSettings,
  getSettingsForSource,
} from './settings/settings.js'
import {
  filterClaudeAliases,
  getShellConfigPaths,
  readFileLines,
  writeFileLines,
} from './shellConfig.js'
import { jsonParse } from './slowOperations.js'

const GCS_BUCKET_URL = 'https://downloads.claude.ai/claude-code-releases'

class AutoUpdaterError extends ClaudeError {}

export type InstallStatus =
  | 'success'
  | 'no_permissions'
  | 'install_failed'
  | 'in_progress'
  /** Newer version on registry; auto-install skipped (config/env). UI should prompt. */
  | 'available'

/** Official 2.1.328 failureHint values (see `KKt`). */
export type AutoUpdateFailureHint =
  | 'windows_running_exe_lock'
  | 'native_binary_missing'
  | 'registry_session_refused'

export function mapFailureHintToErrorCode(
  hint: AutoUpdateFailureHint | undefined,
): string | null {
  switch (hint) {
    case 'windows_running_exe_lock':
      return 'update_apply_exe_locked'
    case 'native_binary_missing':
      return 'update_apply_native_binary_missing'
    case 'registry_session_refused':
      return 'update_session_refused'
    case undefined:
      return null
  }
}

/** densable Vpg — damp further AutoUpdater polls after this many exe-lock fails. */
export const EXE_LOCK_FAILURE_DAMP_THRESHOLD = 2

/** densable installGlobalPackage / Zfr outcome (status + optional failureHint). */
export type InstallOutcome = {
  status: InstallStatus
  failureHint?: AutoUpdateFailureHint
  probeDurationMs?: number
}

/** Official 2.1.328 `l9n` / `d9n`: placeholder stub detection thresholds. */
export const PLACEHOLDER_STUB_MAX_BYTES = 65536
export const PLACEHOLDER_STUB_SENTINEL = 'claude native binary not installed'

export type AutoUpdaterResult = {
  version: string | null
  status: InstallStatus
  failureHint?: AutoUpdateFailureHint
  consecutiveExeLockFailures?: number
  notifications?: string[]
}

/**
 * densable AutoUpdater footer copy for failure statuses (npm path).
 * Returns null when the status is not a footer failure.
 */
export function getAutoUpdaterFailureFooterMessage(
  result: Pick<AutoUpdaterResult, 'status' | 'failureHint'> | null | undefined,
): string | null {
  if (!result) return null
  if (result.status === 'no_permissions') {
    return 'Auto-update failed: no write permission to npm prefix · Run claude doctor'
  }
  if (result.status === 'install_failed') {
    if (result.failureHint === 'windows_running_exe_lock') {
      return 'Auto-update failed: claude.exe in use (close other Claude Code sessions, including VS Code) · Run claude doctor'
    }
    return null
  }
  return null
}

/**
 * densable npm/bun install stderr classifier (windows exe lock + permissions).
 */
export function classifyNpmInstallFailure(
  combinedOutput: string,
  platform: NodeJS.Platform = process.platform,
): InstallOutcome {
  if (
    platform === 'win32' &&
    /\b(?:claude|cli)\.exe\b/i.test(combinedOutput) &&
    (/\bEBUSY\b|resource busy or locked/i.test(combinedOutput) ||
      (/\bEPERM\b|operation not permitted/i.test(combinedOutput) &&
        /\b(?:rename|copyfile|unlink)\b[^\r\n]*\b(?:claude|cli)\.exe\b/i.test(
          combinedOutput,
        )))
  ) {
    return { status: 'install_failed', failureHint: 'windows_running_exe_lock' }
  }
  if (/\b(EACCES|EPERM|permission denied)\b/i.test(combinedOutput)) {
    return { status: 'no_permissions' }
  }
  if (/postinstall\] Native package "[^"]*" not found/.test(combinedOutput)) {
    return { status: 'install_failed', failureHint: 'native_binary_missing' }
  }
  return { status: 'install_failed' }
}

/**
 * densable AppState autoUpdaterResult merge — bump consecutiveExeLockFailures
 * on windows_running_exe_lock; preserve count while in_progress; else reset.
 */
export function mergeAutoUpdaterResult(
  prev: AutoUpdaterResult | null | undefined,
  next: {
    version: string | null
    status: InstallStatus
    failureHint?: AutoUpdateFailureHint
    notifications?: string[]
  },
): AutoUpdaterResult {
  const prevCount = prev?.consecutiveExeLockFailures ?? 0
  const consecutiveExeLockFailures =
    next.status === 'in_progress'
      ? prevCount
      : next.failureHint === 'windows_running_exe_lock'
        ? prevCount + 1
        : 0
  if (
    prev &&
    prev.version === next.version &&
    prev.status === next.status &&
    prev.failureHint === next.failureHint &&
    (prev.consecutiveExeLockFailures ?? 0) === consecutiveExeLockFailures &&
    prev.notifications === next.notifications
  ) {
    return prev
  }
  return {
    version: next.version,
    status: next.status,
    failureHint: next.failureHint,
    consecutiveExeLockFailures,
    notifications: next.notifications,
  }
}

export type MaxVersionConfig = {
  external?: string
  ant?: string
  external_message?: string
  ant_message?: string
  external_force_downgrade?: boolean
}

export type UpdateRestoreFailure = {
  originalPath: string
  preservedPath?: string
}

const AUTO_UPDATE_CHECK_THROTTLE_MS = 300_000
let lastAutoUpdateCheckAt = 0
let updateRestoreFailure: UpdateRestoreFailure | null = null

/**
 * 5-minute process-wide throttle for background auto-update checks.
 * Matches official 2.1.328 `qKt` (`@300384488`).
 */
export function shouldThrottleAutoUpdateCheck(): boolean {
  const now = Date.now()
  if (now - lastAutoUpdateCheckAt < AUTO_UPDATE_CHECK_THROTTLE_MS) {
    logForDebugging(
      `auto-update check throttled (last check ${Math.round((now - lastAutoUpdateCheckAt) / 1000)}s ago)`,
    )
    return true
  }
  lastAutoUpdateCheckAt = now
  return false
}

export function resetAutoUpdateCheckThrottleForTests(): void {
  lastAutoUpdateCheckAt = 0
}

/**
 * Display label for `autoUpdatesChannel` in UI / doctor output.
 * Official 2.1.328 maps `'rc'` -> `'slow'`.
 */
export function formatAutoUpdatesChannelDisplay(
  channel: string | undefined,
): string {
  return channel === 'rc' ? 'slow' : (channel ?? 'latest')
}

/**
 * Checks GrowthBook `tengu_max_version_config.external_force_downgrade`.
 * Matches official 2.1.328 `Ldt` (`@300384580`).
 */
export function isForceDowngradeEnabled(): boolean {
  const config = getFeatureValue_CACHED_MAY_BE_STALE<MaxVersionConfig>(
    'tengu_max_version_config',
    {},
  )
  return config?.external_force_downgrade === true
}

/**
 * Async version reading `tengu_max_version_config.external_force_downgrade`
 * via `getDynamicConfig_BLOCKS_ON_INIT`, matching official 2.1.328 `Ldt`.
 */
export async function isForceDowngradeEnabledAsync(): Promise<boolean> {
  const config = await getMaxVersionConfig()
  return config.external_force_downgrade === true
}

/**
 * Official 2.1.328 `bRt`: returns true when force-downgrade is active and
 * currentVersion is strictly greater than maxVersion.
 */
export function shouldForceDowngrade(
  currentVersion: string,
  maxVersion: string,
  source: 'native_update' | 'auto_updater' = 'auto_updater',
): boolean {
  const label = source === 'native_update' ? 'Native installer' : 'AutoUpdater'
  const parsedCurrent = semver.parse(currentVersion)
  if (parsedCurrent && gt(parsedCurrent.version, maxVersion)) {
    logForDebugging(
      `${label}: force-downgrade active — moving from ${currentVersion} to ${maxVersion}`,
    )
    return true
  }
  logForDebugging(
    `${label}: force-downgrade flag set but current ${currentVersion} is not above ${maxVersion} — taking normal upgrade path`,
  )
  return false
}

/**
 * Returns details if a Windows self-rename executable restore failed after a
 * failed npm global update. Matches official 2.1.328 `kRt()`.
 */
export function getUpdateRestoreFailure(): UpdateRestoreFailure | null {
  return updateRestoreFailure
}

export function setUpdateRestoreFailureForTests(
  failure: UpdateRestoreFailure | null,
): void {
  updateRestoreFailure = failure
}

/**
 * Checks if the current version meets the minimum required version from Statsig config
 * Terminates the process with an error message if the version is too old
 *
 * NOTE ON SHA-BASED VERSIONING:
 * We use SemVer-compliant versioning with build metadata format (X.X.X+SHA) for continuous deployment.
 * According to SemVer specs, build metadata (the +SHA part) is ignored when comparing versions.
 *
 * Versioning approach:
 * 1. For version requirements/compatibility (assertMinVersion), we use semver comparison that ignores build metadata
 * 2. For updates ('claude update'), we use exact string comparison to detect any change, including SHA
 *    - This ensures users always get the latest build, even when only the SHA changes
 *    - The UI clearly shows both versions including build metadata
 *
 * This approach keeps version comparison logic simple while maintaining traceability via the SHA.
 */
export async function assertMinVersion(): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return
  }

  // Official HFI densable — skip min-version kill switch for trajectory runners.
  try {
    const { shouldSkipHfiVersionCheck } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    if (shouldSkipHfiVersionCheck()) {
      return
    }
  } catch {
    // residual helpers optional
  }

  try {
    const versionConfig = await getDynamicConfig_BLOCKS_ON_INIT<{
      minVersion: string
    }>('tengu_version_config', { minVersion: '0.0.0' })

    if (
      versionConfig.minVersion &&
      lt(MACRO.VERSION, versionConfig.minVersion)
    ) {
      console.error(`
It looks like your version of Claude Code (${MACRO.VERSION}) needs an update.
A newer version (${versionConfig.minVersion} or higher) is required to continue.

To update, please run:
    claude update

This will ensure you have access to the latest features and improvements.
`)
      gracefulShutdownSync(1)
    }
  } catch (error) {
    logError(error as Error)
  }
}

/**
 * Returns the maximum allowed version for the current user type.
 * For ants, returns the `ant` field (dev version format).
 * For external users, returns the `external` field (clean semver).
 * This is used as a server-side kill switch to pause auto-updates during incidents.
 * Returns undefined if no cap is configured.
 */
export async function getMaxVersion(): Promise<string | undefined> {
  const config = await getMaxVersionConfig()
  if (process.env.USER_TYPE === 'ant') {
    return config.ant || undefined
  }
  // Official 2.1.328 `Ldt` (@300384756): external is normalized through
  // semver.parse before use — "v2.1.300" is accepted, invalid values are
  // logged and ignored so they can never reach the download path.
  const raw = config.external || undefined
  const parsed = raw !== undefined ? semver.parse(raw)?.version : undefined
  if (raw !== undefined && parsed === undefined) {
    logForDebugging(
      `tengu_max_version_config has invalid version '${raw}' — ignoring`,
      { level: 'error' },
    )
    logEvent('tengu_max_version_config_invalid', {
      raw_value: raw.slice(0, 300),
    })
  }
  return parsed
}

/**
 * Returns the server-driven message explaining the known issue, if configured.
 * Shown in the warning banner when the current version exceeds the max allowed version.
 */
export async function getMaxVersionMessage(): Promise<string | undefined> {
  const config = await getMaxVersionConfig()
  if (process.env.USER_TYPE === 'ant') {
    return config.ant_message || undefined
  }
  return config.external_message || undefined
}

async function getMaxVersionConfig(): Promise<MaxVersionConfig> {
  try {
    return await getDynamicConfig_BLOCKS_ON_INIT<MaxVersionConfig>(
      'tengu_max_version_config',
      {},
    )
  } catch (error) {
    logError(error as Error)
    return {}
  }
}

/**
 * Returns the reason string if a target version should be skipped due to
 * `minimumVersion` or managed policy `requiredMaximumVersion`, or null if allowed.
 * Matches official 2.1.328 `y1o` (`@300386107`).
 */
export function getVersionSkipReason(targetVersion: string): string | null {
  if (!semver.parse(targetVersion)) {
    logForDebugging(
      'update target is not a valid semver version — skip checks constrain nothing',
      { level: 'error' },
    )
    return null
  }
  const settings = getInitialSettings()
  const minimumVersion = settings?.minimumVersion
  if (minimumVersion) {
    const parsedMin = semver.parse(minimumVersion)?.version
    if (!parsedMin) {
      logForDebugging(
        `minimumVersion is not a valid semver version — ignoring. Value (first 300 chars, JSON-encoded): ${JSON.stringify(minimumVersion.slice(0, 300))}`,
        { level: 'error' },
      )
    } else if (!gte(targetVersion, parsedMin)) {
      return `below your minimumVersion setting (${minimumVersion})`
    }
  }
  const requiredMax =
    getSettingsForSource('policySettings')?.requiredMaximumVersion
  if (requiredMax) {
    const parsedMax = semver.parse(requiredMax)?.version
    if (!parsedMax) {
      logForDebugging(
        `requiredMaximumVersion is not a valid semver version — ignoring. Value (first 300 chars, JSON-encoded): ${JSON.stringify(requiredMax.slice(0, 300))}`,
        { level: 'error' },
      )
    } else if (!lte(targetVersion, parsedMax)) {
      return `above your organization's requiredMaximumVersion (${requiredMax})`
    }
  }
  return null
}

/**
 * Checks if a target version should be skipped due to user's `minimumVersion`
 * or organization policy's `requiredMaximumVersion`.
 * Matches official 2.1.328 `wRt` (`@300386107`).
 */
export function shouldSkipVersion(targetVersion: string): boolean {
  const reason = getVersionSkipReason(targetVersion)
  if (reason) {
    logForDebugging(`Skipping update to ${targetVersion}: ${reason}`)
  }
  return reason !== null
}

// Lock file for auto-updater to prevent concurrent updates
const LOCK_TIMEOUT_MS = 5 * 60 * 1000 // 5 minute timeout for locks

/**
 * Get the path to the lock file
 * This is a function to ensure it's evaluated at runtime after test setup
 */
export function getLockFilePath(): string {
  return join(getClaudeConfigHomeDir(), '.update.lock')
}

/**
 * Attempts to acquire a lock for auto-updater
 * @returns true if lock was acquired, false if another process holds the lock
 */
async function acquireLock(): Promise<boolean> {
  const fs = getFsImplementation()
  const lockPath = getLockFilePath()

  // Check for existing lock: 1 stat() on the happy path (fresh lock or ENOENT),
  // 2 on stale-lock recovery (re-verify staleness immediately before unlink).
  try {
    const stats = await fs.stat(lockPath)
    const age = Date.now() - stats.mtimeMs
    if (age < LOCK_TIMEOUT_MS) {
      return false
    }
    // Lock is stale, remove it before taking over. Re-verify staleness
    // immediately before unlinking to close a TOCTOU race: if two processes
    // both observe the stale lock, A unlinks + writes a fresh lock, then B
    // would unlink A's fresh lock and both believe they hold it. A fresh
    // lock has a recent mtime, so re-checking staleness makes B back off.
    try {
      const recheck = await fs.stat(lockPath)
      if (Date.now() - recheck.mtimeMs < LOCK_TIMEOUT_MS) {
        return false
      }
      await fs.unlink(lockPath)
    } catch (err) {
      if (!isENOENT(err)) {
        logError(err as Error)
        return false
      }
    }
  } catch (err) {
    if (!isENOENT(err)) {
      logError(err as Error)
      return false
    }
    // ENOENT: no lock file, proceed to create one
  }

  // Create lock file atomically with O_EXCL (flag: 'wx'). If another process
  // wins the race and creates it first, we get EEXIST and back off.
  // Lazy-mkdir the config dir on ENOENT.
  try {
    await writeFile(lockPath, `${process.pid}`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    return true
  } catch (err) {
    const code = getErrnoCode(err)
    if (code === 'EEXIST') {
      return false
    }
    if (code === 'ENOENT') {
      try {
        // fs.mkdir from getFsImplementation() is always recursive:true and
        // swallows EEXIST internally, so a dir-creation race cannot reach the
        // catch below — only writeFile's EEXIST (true lock contention) can.
        await fs.mkdir(getClaudeConfigHomeDir())
        await writeFile(lockPath, `${process.pid}`, {
          encoding: 'utf8',
          flag: 'wx',
        })
        return true
      } catch (mkdirErr) {
        if (getErrnoCode(mkdirErr) === 'EEXIST') {
          return false
        }
        logError(mkdirErr as Error)
        return false
      }
    }
    logError(err as Error)
    return false
  }
}

/**
 * Releases the update lock if it's held by this process
 */
async function releaseLock(): Promise<void> {
  const fs = getFsImplementation()
  const lockPath = getLockFilePath()
  try {
    const lockData = await fs.readFile(lockPath, { encoding: 'utf8' })
    if (lockData === `${process.pid}`) {
      await fs.unlink(lockPath)
    }
  } catch (err) {
    if (isENOENT(err)) {
      return
    }
    logError(err as Error)
  }
}

/**
 * Checks whether a path resides inside Bun's global installation directory
 * (`/.bun/install/global/` or `${BUN_INSTALL}/install/global/`).
 */
export function isPathInBunGlobalInstall(
  candidatePath: string | undefined,
  bunInstallDir: string | undefined = process.env.BUN_INSTALL,
): boolean {
  if (!candidatePath) {
    return false
  }
  const normalizedPath = candidatePath.replace(/\\/g, '/')
  const normalizedBunInstall = (bunInstallDir ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  return (
    normalizedPath.includes('/.bun/install/global/') ||
    normalizedPath.endsWith('/.bun/install/global') ||
    (normalizedBunInstall.length > 0 &&
      (normalizedPath.startsWith(`${normalizedBunInstall}/install/global/`) ||
        normalizedPath === `${normalizedBunInstall}/install/global`))
  )
}

function tryRealpath(p: string | undefined): string | undefined {
  if (!p) return undefined
  try {
    return realpathSync(p)
  } catch {
    return undefined
  }
}

/**
 * Determines which global package manager (`bun` or `npm`) manages this install.
 * Selects `bun` when the actual binary/entrypoint path is inside Bun's global
 * install directory, or when running the script with Bun outside bundled mode —
 * never solely because the runtime is Bun for an npm-installed binary, and never
 * downgraded to npm just because the `bun` CLI is absent from PATH (official
 * `oe()` @300388719 keeps the install's ownership and lets the missing CLI fail
 * naturally at install time).
 */
export function getGlobalPackageManager(opts?: {
  execPath?: string
  argv1?: string
  bunInstallDir?: string
  /** Test seam: pretend the entrypoint is a Bun-compiled binary (`vh()`). */
  isBundledBinary?: boolean
}): 'bun' | 'npm' {
  const execPath = opts?.execPath ?? process.execPath
  const argv1 = opts?.argv1 ?? process.argv[1]
  const bunInstallDir = opts?.bunInstallDir ?? process.env.BUN_INSTALL

  const candidates = [execPath, argv1]
  // Also follow symlinks for real paths (e.g. ~/.bun/bin/claude -> ~/.bun/install/global/...)
  if (opts?.execPath === undefined) {
    const resolvedExec = tryRealpath(execPath)
    if (resolvedExec && resolvedExec !== execPath) {
      candidates.push(resolvedExec)
    }
  }
  if (opts?.argv1 === undefined) {
    const resolvedArgv1 = tryRealpath(argv1)
    if (resolvedArgv1 && resolvedArgv1 !== argv1) {
      candidates.push(resolvedArgv1)
    }
  }

  const inBunGlobal = candidates.some(p =>
    isPathInBunGlobalInstall(p, bunInstallDir),
  )
  if (inBunGlobal) {
    return 'bun'
  }

  // Official `oe`: running the JS with Bun while NOT a compiled binary (`vh`)
  // belongs to the Bun package manager; a Bun-compiled binary installed via
  // npm still belongs to npm.
  const bundled = opts?.isBundledBinary ?? isInBundledMode()
  if (env.isRunningWithBun() && !bundled) {
    return 'bun'
  }
  return 'npm'
}

export type GlobalInstalledBinaryPaths = {
  execPaths: string[]
  imagePath: string
}

export type GlobalBinaryProbeResult =
  | { outcome: 'landed'; version: string; durationMs: number }
  | { outcome: 'placeholder_stub'; durationMs: number }
  | { outcome: 'inconclusive'; durationMs: number }

async function getInstallationPrefix(
  packageManager: 'bun' | 'npm' = getGlobalPackageManager(),
): Promise<string | null> {
  // Run from home directory to avoid reading project-level .npmrc/.bunfig.toml
  const isBun = packageManager === 'bun'
  const prefixResult = isBun
    ? await execFileNoThrowWithCwd('bun', ['pm', 'bin', '-g'], {
        cwd: homedir(),
      })
    : await execFileNoThrowWithCwd('npm', ['-g', 'config', 'get', 'prefix'], {
        cwd: homedir(),
      })
  if (prefixResult.code !== 0) {
    logError(
      new Error(
        `Failed to check ${isBun ? 'bun' : 'npm'} permissions (exit ${prefixResult.code}): ${prefixResult.stderr.trim()}`,
      ),
    )
    return null
  }
  return prefixResult.stdout.trim() || null
}

/**
 * Official 2.1.328 `Rt()`: resolves candidate executable paths and image path
 * in the active global prefix for post-install `--version` probing.
 */
export async function getGlobalInstalledBinaryPaths(
  knownPrefix?: string | null,
  packageManager: 'bun' | 'npm' = getGlobalPackageManager(),
  platform: NodeJS.Platform = process.platform,
): Promise<GlobalInstalledBinaryPaths | null> {
  const prefix =
    knownPrefix !== undefined
      ? knownPrefix
      : await getInstallationPrefix(packageManager)
  if (!prefix) {
    return null
  }
  if (packageManager === 'bun') {
    const binPath = join(prefix, 'claude')
    return { execPaths: [binPath], imagePath: binPath }
  }
  if (platform === 'win32') {
    return {
      execPaths: [join(prefix, 'claude.cmd'), join(prefix, 'claude.exe')],
      imagePath: join(
        prefix,
        'node_modules',
        MACRO.PACKAGE_URL,
        'bin',
        'claude.exe',
      ),
    }
  }
  const binPath = join(prefix, 'bin', 'claude')
  return { execPaths: [binPath], imagePath: binPath }
}

/**
 * Official 2.1.328 `Fe()`: probes the globally installed `claude --version`
 * after `npm/bun install -g` to distinguish real installs, placeholder stubs,
 * and inconclusive outcomes.
 */
export async function probeInstalledGlobalBinary(
  targetVersion?: string | null,
  knownPrefix?: string | null,
  packageManager: 'bun' | 'npm' = getGlobalPackageManager(),
): Promise<GlobalBinaryProbeResult> {
  const startTime = Date.now()
  const paths = await getGlobalInstalledBinaryPaths(knownPrefix, packageManager)
  const expectedVersion = targetVersion
    ? semver.parse(targetVersion)?.version
    : undefined
  let hadNonZero = false
  let sawPlaceholderSentinel = false

  for (const execPath of paths?.execPaths ?? []) {
    const result = await execFileNoThrowWithCwd(execPath, ['--version'], {
      abortSignal: AbortSignal.timeout(45_000),
      cwd: homedir(),
    })
    const probedVersion = semver.parse(
      result.stdout.trim().split(/\s+/)[0] ?? '',
    )?.version
    if (
      result.code === 0 &&
      probedVersion != null &&
      (expectedVersion != null
        ? probedVersion === expectedVersion
        : gt(probedVersion, MACRO.VERSION))
    ) {
      return {
        outcome: 'landed',
        version: probedVersion,
        durationMs: Date.now() - startTime,
      }
    }
    if (result.code !== 0) {
      hadNonZero = true
      sawPlaceholderSentinel ||= `${result.stdout}\n${result.stderr}`.includes(
        PLACEHOLDER_STUB_SENTINEL,
      )
    }
  }

  const isSmallStub =
    hadNonZero &&
    paths !== null &&
    (await stat(paths.imagePath).then(
      st => st.isFile() && st.size < PLACEHOLDER_STUB_MAX_BYTES,
      () => false,
    ))

  return {
    outcome:
      sawPlaceholderSentinel || isSmallStub
        ? 'placeholder_stub'
        : 'inconclusive',
    durationMs: Date.now() - startTime,
  }
}

/**
 * Official 2.1.328 `Mt()`: classifies npm/bun install stderr output, including
 * identifying `warning_only` non-zero exits that may still have landed.
 */
export function classifyNpmStderrSignature(combinedOutput: string): string {
  if (/\b(EACCES|EPERM|permission denied)\b/i.test(combinedOutput)) {
    return 'eacces_eperm'
  }
  if (/postinstall\] Native package "[^"]*" not found/.test(combinedOutput)) {
    return 'native_package_missing'
  }
  if (/\bENOTEMPTY\b/i.test(combinedOutput)) {
    return 'enotempty'
  }
  if (/\bETARGET\b/i.test(combinedOutput)) {
    return 'etarget'
  }
  if (
    /\bE403\b/i.test(combinedOutput) ||
    /\b403 forbidden\b/i.test(combinedOutput)
  ) {
    return 'e403_forbidden'
  }
  if (/\bENOENT\b/i.test(combinedOutput)) {
    return 'enoent'
  }
  if (
    /\bE5\d\d\b/i.test(combinedOutput) ||
    /\b5\d\d\s+(internal server error|bad gateway|service unavailable|gateway time-?out)\b/i.test(
      combinedOutput,
    )
  ) {
    return 'registry_5xx'
  }
  if (
    /\b(ETIMEDOUT|ESOCKETTIMEDOUT)\b/i.test(combinedOutput) ||
    /\btimed[\s-]?out\b/i.test(combinedOutput) ||
    /\btimeout\b/i.test(combinedOutput)
  ) {
    return 'network_timeout'
  }
  if (/\bENOSPC\b/i.test(combinedOutput)) {
    return 'disk_full'
  }
  if (
    /\bEBUSY\b/i.test(combinedOutput) ||
    /\bresource busy or locked\b/i.test(combinedOutput)
  ) {
    return 'ebusy'
  }
  const hasWarning =
    /npm warn/i.test(combinedOutput) ||
    /unknown user config/i.test(combinedOutput) ||
    /npm notice/i.test(combinedOutput)
  const hasError =
    /npm err/i.test(combinedOutput) ||
    /\b(EACCES|EPERM|ETARGET)\b/i.test(combinedOutput) ||
    /code E/i.test(combinedOutput)
  if (hasWarning && !hasError) {
    return 'warning_only'
  }
  return 'unknown'
}

export async function checkGlobalInstallPermissions(): Promise<{
  hasPermissions: boolean
  npmPrefix: string | null
}> {
  try {
    const prefix = await getInstallationPrefix()
    if (!prefix) {
      return { hasPermissions: false, npmPrefix: null }
    }

    try {
      await access(prefix, fsConstants.W_OK)
      return { hasPermissions: true, npmPrefix: prefix }
    } catch {
      logError(
        new AutoUpdaterError(
          'Insufficient permissions for global npm install.',
        ),
      )
      return { hasPermissions: false, npmPrefix: prefix }
    }
  } catch (error) {
    logError(error as Error)
    return { hasPermissions: false, npmPrefix: null }
  }
}

export async function getLatestVersion(
  channel: ReleaseChannel,
): Promise<string | null> {
  const npmTag = channel === 'stable' ? 'stable' : 'latest'

  // Run from home directory to avoid reading project-level .npmrc
  // which could be maliciously crafted to redirect to an attacker's registry
  const result = await execFileNoThrowWithCwd(
    'npm',
    ['view', `${MACRO.PACKAGE_URL}@${npmTag}`, 'version', '--prefer-online'],
    { abortSignal: AbortSignal.timeout(5000), cwd: homedir() },
  )
  if (result.code !== 0) {
    // Official 2.1.328 `YKt`: accept non-zero exit when stdout cleanly parses as semver
    const trimmedStdout = result.stdout.trim()
    if (trimmedStdout && semver.parse(trimmedStdout)) {
      logForDebugging(
        `npm view exited ${result.code} but printed a valid version (${trimmedStdout}) — treating stderr as a warning`,
      )
      if (result.stderr) {
        logForDebugging(`npm stderr: ${result.stderr.trim()}`)
      }
      return trimmedStdout
    }
    logForDebugging(`npm view failed with code ${result.code}`)
    if (result.stderr) {
      logForDebugging(`npm stderr: ${result.stderr.trim()}`)
    } else {
      logForDebugging('npm stderr: (empty)')
    }
    if (result.stdout) {
      logForDebugging(
        `npm stdout (first 300 chars, JSON-encoded): ${JSON.stringify(result.stdout.trim().slice(0, 300))}`,
      )
    }
    return null
  }
  const trimmedStdout = result.stdout.trim()
  if (trimmedStdout && !semver.parse(trimmedStdout)) {
    logForDebugging(
      'npm view exited 0 but stdout is not a valid semver version — treating as no result',
    )
    logForDebugging(
      `npm stdout (first 300 chars, JSON-encoded): ${JSON.stringify(trimmedStdout.slice(0, 300))}`,
    )
    return null
  }
  return trimmedStdout || null
}

export type NpmDistTags = {
  latest: string | null
  stable: string | null
}

/**
 * Get npm dist-tags (latest and stable versions) from the registry.
 * This is used by the doctor command to show users what versions are available.
 */
export async function getNpmDistTags(): Promise<NpmDistTags> {
  // Run from home directory to avoid reading project-level .npmrc
  const result = await execFileNoThrowWithCwd(
    'npm',
    ['view', MACRO.PACKAGE_URL, 'dist-tags', '--json', '--prefer-online'],
    { abortSignal: AbortSignal.timeout(5000), cwd: homedir() },
  )

  if (result.code !== 0) {
    logForDebugging(`npm view dist-tags failed with code ${result.code}`)
    return { latest: null, stable: null }
  }

  try {
    const parsed = jsonParse(result.stdout.trim()) as Record<string, unknown>
    return {
      latest: typeof parsed.latest === 'string' ? parsed.latest : null,
      stable: typeof parsed.stable === 'string' ? parsed.stable : null,
    }
  } catch (error) {
    logForDebugging(`Failed to parse dist-tags: ${error}`)
    return { latest: null, stable: null }
  }
}

/**
 * Get the latest version from GCS bucket for a given release channel.
 * This is used by installations that don't have npm (e.g. package manager installs).
 */
export async function getLatestVersionFromGcs(
  channel: ReleaseChannel,
): Promise<string | null> {
  try {
    const response = await axios.get(`${GCS_BUCKET_URL}/${channel}`, {
      timeout: 5000,
      responseType: 'text',
    })
    return response.data.trim()
  } catch (error) {
    logForDebugging(`Failed to fetch ${channel} from GCS: ${error}`)
    return null
  }
}

/**
 * Get available versions from GCS bucket (for native installations).
 * Fetches both latest and stable channel pointers.
 */
export async function getGcsDistTags(): Promise<NpmDistTags> {
  const [latest, stable] = await Promise.all([
    getLatestVersionFromGcs('latest'),
    getLatestVersionFromGcs('stable'),
  ])

  return { latest, stable }
}

/**
 * Get version history from npm registry (ant-only feature)
 * Returns versions sorted newest-first, limited to the specified count
 *
 * Uses NATIVE_PACKAGE_URL when available because:
 * 1. Native installation is the primary installation method for ant users
 * 2. Not all JS package versions have corresponding native packages
 * 3. This prevents rollback from listing versions that don't have native binaries
 */
export async function getVersionHistory(limit: number): Promise<string[]> {
  if (process.env.USER_TYPE !== 'ant') {
    return []
  }

  // Use native package URL when available to ensure we only show versions
  // that have native binaries (not all JS package versions have native builds)
  const packageUrl = MACRO.NATIVE_PACKAGE_URL ?? MACRO.PACKAGE_URL

  // Run from home directory to avoid reading project-level .npmrc
  const result = await execFileNoThrowWithCwd(
    'npm',
    ['view', packageUrl, 'versions', '--json', '--prefer-online'],
    // Longer timeout for version list
    { abortSignal: AbortSignal.timeout(30000), cwd: homedir() },
  )

  if (result.code !== 0) {
    logForDebugging(`npm view versions failed with code ${result.code}`)
    if (result.stderr) {
      logForDebugging(`npm stderr: ${result.stderr.trim()}`)
    }
    return []
  }

  try {
    const versions = jsonParse(result.stdout.trim()) as string[]
    // Take last N versions, then reverse to get newest first
    return versions.slice(-limit).reverse()
  } catch (error) {
    logForDebugging(`Failed to parse version history: ${error}`)
    return []
  }
}

// ─── Windows self-rename backup tracking (official 2.1.328 `XKt`/`Ve`/`Be`/`ee`/`We`) ───

/**
 * Inodes of `.old.<ts>` backups this process minted before `npm/bun install -g`.
 * npm moves the whole package dir into a `.`-prefixed retired directory on
 * rename conflict; tracking the inode lets restore locate the moved backup.
 * Process-lifetime only, matching official `n.mintedPreservedInodes`.
 */
const mintedPreservedInodes = new Set<bigint>()

/**
 * Official `Ve`: candidate "retired dir" parent roots — the two directories
 * above the running executable's package dir (e.g. `.../node_modules` and its
 * parent scope dir).
 */
function getRetiredDirSearchRoots(): string[] {
  const packageDir = join(dirname(process.execPath), '..', '..')
  return [join(packageDir, '..'), packageDir]
}

/**
 * Official `Be`: retired directories are `.`-prefixed dirs inside each root.
 */
async function listRetiredDirs(): Promise<string[]> {
  const out: string[] = []
  for (const root of getRetiredDirSearchRoots()) {
    try {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith('.')) {
          out.push(join(root, entry.name))
        }
      }
    } catch {
      // Root unreadable — skip
    }
  }
  return out
}

async function isPreservedInode(filePath: string): Promise<boolean> {
  const ino = await stat(filePath, { bigint: true })
    .then(s => s.ino)
    .catch(() => 0n)
  return ino !== 0n && mintedPreservedInodes.has(ino)
}

/**
 * Official `We`: find where a `.old.<ts>` backup ended up — same name in the
 * original dir, else under a retired dir (or its `bin/`).
 */
export async function locatePreservedBackupForTests(
  backupPath: string,
): Promise<string | null> {
  return locatePreservedBackup(backupPath)
}

/**
 * Test seam for `mintedPreservedInodes` — production code only adds entries in
 * the Windows self-rename path of `installGlobalPackage`.
 */
export function mintPreservedInodeForTests(ino: bigint): void {
  mintedPreservedInodes.add(ino)
}

async function locatePreservedBackup(
  backupPath: string,
): Promise<string | null> {
  if (await isPreservedInode(backupPath)) return backupPath
  const name = basename(backupPath)
  const candidates = (await listRetiredDirs()).flatMap(dir => [
    join(dir, name),
    join(dir, 'bin', name),
  ])
  for (const candidate of candidates) {
    if (await isPreservedInode(candidate)) return candidate
  }
  return null
}

export async function installGlobalPackage(
  targetVersion?: string | null,
): Promise<InstallOutcome> {
  if (!(await acquireLock())) {
    logError(
      new AutoUpdaterError('Another process is currently installing an update'),
    )
    // Log the lock contention
    logEvent('tengu_auto_updater_lock_contention', {
      pid: process.pid,
      currentVersion:
        MACRO.VERSION as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return { status: 'in_progress' }
  }

  try {
    await removeClaudeAliasesFromShellConfigs()
    const packageManager = getGlobalPackageManager()
    // Check if we're using npm from Windows path in WSL
    if (packageManager === 'npm' && env.isNpmFromWindowsPath()) {
      logError(new Error('Windows NPM detected in WSL environment'))
      logEvent('tengu_auto_updater_windows_npm_in_wsl', {
        currentVersion:
          MACRO.VERSION as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      console.error(`
Error: Windows NPM detected in WSL

You're running Claude Code in WSL but using the Windows NPM installation from /mnt/c/.
This configuration is not supported for updates.

To fix this issue:
  1. Install Node.js within your Linux distribution: e.g. sudo apt install nodejs npm
  2. Make sure Linux NPM is in your PATH before the Windows version
  3. Try updating again with 'claude update'
`)
      return { status: 'install_failed' }
    }

    const { hasPermissions, npmPrefix } = await checkGlobalInstallPermissions()
    if (!hasPermissions) {
      return { status: 'no_permissions' }
    }

    // Use specific version if provided, otherwise use latest
    const packageSpec = targetVersion
      ? `${MACRO.PACKAGE_URL}@${targetVersion}`
      : MACRO.PACKAGE_URL

    // Official 2.1.328 `XKt`: on Windows bundled npm installs, rename the running
    // executable aside before `npm/bun install -g` so the new binary can land,
    // and restore it if the install fails.
    const normalizedExecPath = process.execPath.replace(/\\/g, '/')
    const packageScope = MACRO.PACKAGE_URL.startsWith('@')
      ? MACRO.PACKAGE_URL.split('/')[0]
      : null
    const shouldSelfRenameOnWindows =
      process.platform === 'win32' &&
      isInBundledMode() &&
      (normalizedExecPath.includes('/node_modules/@anthropic-ai/') ||
        (packageScope !== null &&
          normalizedExecPath.includes(`/node_modules/${packageScope}/`)))
    const renamedBackups: Array<[originalPath: string, backupPath: string]> = []
    if (shouldSelfRenameOnWindows) {
      // Official `XKt`: enumerate every claude.exe/cli.exe inside sibling
      // package dirs of the executable's scope directory that shares the running
      // executable's inode — npm postinstalls lay down hardlinks across the
      // platform package and wrapper bin (see install.cjs linkSync), so
      // renaming only process.execPath leaves locked siblings → EBUSY.
      const execIno = await stat(process.execPath, { bigint: true })
        .then(s => s.ino)
        .catch(() => 0n)
      const selfRenameTargets = [process.execPath]
      // Ve()[1]: two levels up from dirname(execPath) = the scope dir
      // (e.g. .../node_modules/@go-hare or .../node_modules for unscoped pkgs).
      const scopeDir = join(dirname(process.execPath), '..', '..')
      try {
        for (const pkgDir of await readdir(scopeDir)) {
          for (const name of ['claude.exe', 'cli.exe']) {
            const candidate = join(scopeDir, pkgDir, name)
            if (candidate === process.execPath) continue
            const ino = await stat(candidate, { bigint: true })
              .then(s => s.ino)
              .catch(() => -1n)
            if (execIno !== 0n && ino === execIno) {
              selfRenameTargets.push(candidate)
            }
          }
        }
      } catch {
        // Scope dir unreadable — rename just the running executable
      }
      const mintedAt = Date.now()
      for (const target of selfRenameTargets) {
        const backupPath = `${target}.old.${mintedAt}`
        try {
          await rename(target, backupPath)
          renamedBackups.push([target, backupPath])
          const backupIno = await stat(backupPath, { bigint: true })
            .then(s => s.ino)
            .catch(() => 0n)
          if (backupIno !== 0n) mintedPreservedInodes.add(backupIno)
        } catch {
          // Rename refused for this alias — leave it and proceed.
        }
      }
    }

    // Run from home directory to avoid reading project-level .npmrc/.bunfig.toml
    // which could be maliciously crafted to redirect to an attacker's registry
    const installResult = await execFileNoThrowWithCwd(
      packageManager,
      ['install', '-g', packageSpec],
      { cwd: homedir() },
    )
    if (renamedBackups.length > 0 && installResult.code !== 0) {
      let firstRestoreFailure: UpdateRestoreFailure | null = null
      for (const [originalPath, backupPath] of renamedBackups) {
        try {
          await rename(backupPath, originalPath)
        } catch (renameErr) {
          try {
            await copyFile(backupPath, originalPath)
            logForDebugging(
              `Restored ${originalPath} by copy after rename failed: ${renameErr}`,
            )
            await unlink(backupPath).catch(err =>
              logForDebugging(
                `Failed to remove ${backupPath} after copy-restore: ${err}`,
              ),
            )
          } catch (copyErr) {
            // Official `XKt` → `We`: npm may have already moved the package
            // dir (and our `.old.<ts>` backup with it) into a `.`-prefixed
            // retired directory. Locate it by minted inode and restore from
            // there before declaring the original launch path lost.
            const relocated = await locatePreservedBackup(backupPath)
            let preservedPath: string | undefined
            if (relocated !== null && relocated !== backupPath) {
              try {
                await copyFile(relocated, originalPath)
                logForDebugging(
                  `Restored ${originalPath} from retired-dir copy ${relocated} after rename (${renameErr}) and copy (${copyErr}) both failed`,
                )
                continue
              } catch (relocateErr) {
                logForDebugging(
                  `Failed to restore ${originalPath} from retired-dir copy ${relocated}: ${relocateErr}`,
                )
                preservedPath = relocated
              }
            } else {
              const preservedExists = await access(
                backupPath,
                fsConstants.F_OK,
              ).then(
                () => true,
                () => false,
              )
              preservedPath = preservedExists ? backupPath : undefined
            }
            const failure: UpdateRestoreFailure = {
              originalPath,
              preservedPath,
            }
            if (!firstRestoreFailure) {
              firstRestoreFailure = failure
            }
            logError(
              new AutoUpdaterError(
                `Failed to restore ${originalPath} after install failure: rename: ${renameErr}; copy: ${copyErr}; preserved copy: ${preservedPath ?? 'not found'}`,
              ),
            )
          }
        }
      }
      if (firstRestoreFailure) {
        updateRestoreFailure = firstRestoreFailure
      }
    }

    if (installResult.code !== 0) {
      const combined = `${installResult.stdout} ${installResult.stderr}`
      const stderrSig = classifyNpmStderrSignature(combined)
      // Official 2.1.328 `XKt`: when exit is non-zero with warnings only,
      // re-probe the installed binary before declaring failure.
      if (stderrSig === 'warning_only') {
        const probe = await probeInstalledGlobalBinary(
          targetVersion,
          npmPrefix,
          packageManager,
        )
        if (probe.outcome === 'landed') {
          saveGlobalConfig(current => ({
            ...current,
            installMethod: 'global',
          }))
          updateRestoreFailure = null
          logForDebugging(
            `npm/bun exited ${installResult.code} with only warnings on stderr but the install-prefix re-probe confirms the install landed (now ${probe.version}): ${combined}`,
          )
          return { status: 'success', probeDurationMs: probe.durationMs }
        }
      }

      const outcome = classifyNpmInstallFailure(combined)
      const error = new AutoUpdaterError(
        outcome.failureHint === 'windows_running_exe_lock'
          ? `Failed to install new version of claude (running executable is locked): ${combined}`
          : outcome.failureHint === 'native_binary_missing'
            ? `Failed to install new version of claude (platform-native package missing): ${combined}`
            : stderrSig === 'warning_only'
              ? `npm/bun exited ${installResult.code} with only warnings on stderr but the re-probe did not confirm an advance: ${combined}`
              : `Failed to install new version of claude: ${combined}`,
      )
      logError(error)
      return outcome
    }

    // Official 2.1.328 `XKt`: probe installed target binary `--version` even on
    // exit 0 to catch broken placeholder stubs left behind when the native
    // platform package was not installed.
    const probe = await probeInstalledGlobalBinary(
      targetVersion,
      npmPrefix,
      packageManager,
    )
    switch (probe.outcome) {
      case 'placeholder_stub': {
        const ignoreScriptsResult =
          packageManager === 'npm'
            ? await execFileNoThrowWithCwd(
                'npm',
                ['config', 'get', 'ignore-scripts'],
                { abortSignal: AbortSignal.timeout(10_000), cwd: homedir() },
              )
            : null
        if (
          ignoreScriptsResult?.code === 0 &&
          ignoreScriptsResult.stdout.trim() === 'true'
        ) {
          logForDebugging(
            `${packageManager} exited 0 and the installed claude is the placeholder stub, but npm install scripts are disabled on purpose; trusting the exit code`,
          )
          break
        }
        logError(
          new AutoUpdaterError(
            `${packageManager} exited 0 but the installed claude is still the placeholder stub: the platform-native package was not installed`,
          ),
        )
        return {
          status: 'install_failed',
          failureHint: 'native_binary_missing',
        }
      }
      case 'inconclusive':
        logForDebugging(
          `${packageManager} exited 0; the install-prefix --version probe was inconclusive, trusting the exit code`,
        )
        break
      case 'landed':
        break
    }

    // Set installMethod to 'global' to track npm global installations
    saveGlobalConfig(current => ({
      ...current,
      installMethod: 'global',
    }))
    updateRestoreFailure = null

    return { status: 'success', probeDurationMs: probe.durationMs }
  } finally {
    // Ensure we always release the lock
    await releaseLock()
  }
}

/**
 * Remove claude aliases from shell configuration files
 * This helps clean up old installation methods when switching to native or npm global
 */
async function removeClaudeAliasesFromShellConfigs(): Promise<void> {
  const configMap = getShellConfigPaths()

  // Process each shell config file
  for (const [, configFile] of Object.entries(configMap)) {
    try {
      const lines = await readFileLines(configFile)
      if (!lines) continue

      const { filtered, hadAlias } = filterClaudeAliases(lines)

      if (hadAlias) {
        await writeFileLines(configFile, filtered)
        logForDebugging(`Removed claude alias from ${configFile}`)
      }
    } catch (error) {
      // Don't fail the whole operation if one file can't be processed
      logForDebugging(`Failed to remove alias from ${configFile}: ${error}`, {
        level: 'error',
      })
    }
  }
}
