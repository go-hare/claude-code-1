/**
 * Native Installer Implementation
 *
 * This module implements the file-based native installer system described in
 * docs/native-installer.md. It provides:
 * - Directory structure management with symlinks
 * - Version installation and activation
 * - Multi-process safety with locking
 * - Simple fallback mechanism using modification time
 * - Support for both JS and native builds
 */

import { feature } from 'bun:bundle'
import { randomBytes } from 'crypto'
import { constants as fsConstants, type Stats } from 'fs'
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'fs/promises'
import { homedir } from 'os'
import { basename, delimiter, dirname, join, resolve, sep } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  getMaxVersion,
  isForceDowngradeEnabled,
  isForceDowngradeEnabledAsync,
  shouldForceDowngrade,
  shouldSkipVersion,
} from '../autoUpdater.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { getCurrentInstallationType } from '../doctorDiagnostic.js'
import { env } from '../env.js'
import { envDynamic } from '../envDynamic.js'
import { isEnvTruthy } from '../envUtils.js'
import {
  ClaudeError,
  errorMessage,
  getErrnoCode,
  isENOENT,
  toError,
} from '../errors.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { getShellType } from '../localInstaller.js'
import * as lockfile from '../lockfile.js'
import { logError } from '../log.js'
import { gt, gte } from '../semver.js'
import {
  filterClaudeAliases,
  getShellConfigPaths,
  readFileLines,
  writeFileLines,
} from '../shellConfig.js'
import { sleep } from '../sleep.js'
import {
  getUserBinDir,
  getXDGCacheHome,
  getXDGDataHome,
  getXDGStateHome,
} from '../xdg.js'
import {
  downloadVersion,
  getLatestVersion,
  hashFileSha256,
  isOfflineNetworkError,
  isRegistrySessionRefusedError,
  isValidVersion,
  ManifestSignatureError,
  RegistrySessionRefusedError,
  reverifyRetainedVersion,
  verifyFileSha256,
} from './download.js'

export {
  isRegistrySessionRefusedError,
  ManifestSignatureError,
  RegistrySessionRefusedError,
}
import {
  acquireOrRefreshSharedLock,
  acquireProcessLifetimeLock,
  cleanupStaleLocksAsync,
  getPerPidLockPath,
  hasOtherLiveProcessLockForVersion,
  isLockActive,
  isPidBasedLockingEnabled,
  isProcessRunning,
  readLockContent,
  scanActiveLockedVersions,
  withLock,
  writePerPidLock,
} from './pidLock.js'

export const VERSION_RETENTION_COUNT = 2

/**
 * Official 2.1.207: path segment that marks a native-installer-owned version
 * binary (`…/claude/versions/…`). Used to decide whether `~/.local/bin/claude`
 * is ours to overwrite/clean up.
 */
export const NATIVE_VERSIONS_PATH_MARKER = `${sep}${join('claude', 'versions')}${sep}`

// 7 days in milliseconds - used for mtime-based lock stale timeout.
// This is long enough to survive laptop sleep durations while still
// allowing cleanup of abandoned locks from crashed processes within a reasonable time.
const LOCK_STALE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Pure: does a resolved symlink target point into the native versions dir?
 * Official `der` target check (non-Windows).
 */
export function isNativeInstallerSymlinkTarget(
  resolvedTarget: string,
): boolean {
  return resolvedTarget.includes(NATIVE_VERSIONS_PATH_MARKER)
}

/**
 * Pure: is this realpath an npm shim (`.js` entry or under `node_modules`)?
 * Official `per`.
 */
export function isNpmShimResolvedPath(resolvedPath: string): boolean {
  return resolvedPath.endsWith('.js') || resolvedPath.includes('node_modules')
}

/**
 * Official `der`: launcher is owned by the native installer when it is a
 * symlink into `claude/versions/`. On Windows the "symlink" path is a copied
 * executable, so ownership is treated as true (copy path has its own guards).
 */
export async function isNativeInstallerLauncher(
  launcherPath: string,
): Promise<boolean> {
  if (process.platform === 'win32') {
    return true
  }
  try {
    const stats = await lstat(launcherPath)
    if (!stats.isSymbolicLink()) {
      return false
    }
    const target = await readlink(launcherPath)
    const absoluteTarget = resolve(dirname(launcherPath), target)
    return isNativeInstallerSymlinkTarget(absoluteTarget)
  } catch (error) {
    // Official: ENOENT → falsey path treated as "not native" for the
    // `!der && !per` refuse check; other errors also fail closed.
    return isENOENT(error) ? false : false
  }
}

/**
 * Official `per`: npm global shim (JS entry or node_modules path).
 */
export async function isNpmShimLauncher(
  launcherPath: string,
): Promise<boolean> {
  try {
    const resolved = await realpath(launcherPath)
    return isNpmShimResolvedPath(resolved)
  } catch {
    return false
  }
}

/**
 * Official gate: may the native installer replace / clean based on this
 * launcher path? Custom scripts/symlinks that are neither native nor npm
 * must be left alone (2.1.207).
 */
export async function isInstallerOwnedLauncher(
  launcherPath: string,
): Promise<boolean> {
  if (await isNativeInstallerLauncher(launcherPath)) {
    return true
  }
  try {
    return await isNpmShimLauncher(launcherPath)
  } catch {
    return false
  }
}

export type SetupMessage = {
  message: string
  userActionRequired: boolean
  type: 'path' | 'alias' | 'info' | 'error'
}

export function getPlatform(): string {
  // Use env.platform which already handles platform detection and defaults to 'linux'
  const os = env.platform

  const arch =
    process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : null

  if (!arch) {
    const error = new Error(`Unsupported architecture: ${process.arch}`)
    logForDebugging(
      `Native installer does not support architecture: ${process.arch}`,
      { level: 'error' },
    )
    throw error
  }

  // Check for musl on Linux and adjust platform accordingly
  if (os === 'linux' && envDynamic.isMuslEnvironment()) {
    return `linux-${arch}-musl`
  }

  return `${os}-${arch}`
}

export function getBinaryName(platform: string): string {
  return platform.startsWith('win32') ? 'claude.exe' : 'claude'
}

function getBaseDirectories() {
  const platform = getPlatform()
  const executableName = getBinaryName(platform)

  return {
    // Data directories (permanent storage)
    versions: join(getXDGDataHome(), 'claude', 'versions'),

    // Cache directories (can be deleted)
    staging: join(getXDGCacheHome(), 'claude', 'staging'),

    // State directories
    locks: join(getXDGStateHome(), 'claude', 'locks'),

    // User bin
    executable: join(getUserBinDir(), executableName),
  }
}

async function isPossibleClaudeBinary(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath)
    // before download, the version lock file (located at the same filePath) will be size 0
    // also, we allow small sizes because we want to treat small wrapper scripts as valid
    if (!stats.isFile() || stats.size === 0) {
      return false
    }

    // Check if file is executable. Note: On Windows, this relies on file extensions
    // (.exe, .bat, .cmd) and ACL permissions rather than Unix permission bits,
    // so it may not work perfectly for all executable files on Windows.
    await access(filePath, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function getVersionPaths(version: string) {
  const dirs = getBaseDirectories()

  // Official 2.1.321 (#1923): create all required directories in one parallel batch.
  const dirsToCreate = [
    dirs.versions,
    dirs.staging,
    dirs.locks,
    dirname(dirs.executable),
  ]
  await Promise.all(dirsToCreate.map(dir => mkdir(dir, { recursive: true })))

  // Official 2.1.328 `vt`: reject path traversal and path-unsafe version strings.
  if (
    !/^[a-zA-Z0-9._+-]+$/.test(version) ||
    version.includes('..') ||
    version === '.'
  ) {
    throw new Error(
      `Invalid version string "${version}": contains path-unsafe characters`,
    )
  }

  const installPath = join(dirs.versions, version)

  // Official 2.1.328 `vt`: create empty placeholder atomically with `flag: 'wx'`,
  // and freshen mtime on an existing 0-byte placeholder so concurrent cleanup
  // recognizes an active install.
  try {
    await writeFile(installPath, '', { encoding: 'utf8', flag: 'wx' })
  } catch (err) {
    if (getErrnoCode(err) !== 'EEXIST') {
      throw err
    }
    try {
      if ((await stat(installPath)).size === 0) {
        const now = new Date()
        await utimes(installPath, now, now)
      }
    } catch {
      // Ignore freshening errors
    }
  }

  return {
    stagingPath: join(dirs.staging, version),
    installPath,
  }
}

// Execute a callback while holding a lock on a version file
// Returns false if the file is already locked, true if callback executed
async function tryWithVersionLock(
  versionFilePath: string,
  callback: () => void | Promise<void>,
  retries = 0,
): Promise<boolean> {
  const dirs = getBaseDirectories()

  const lockfilePath = getLockFilePathFromVersionPath(dirs, versionFilePath)

  // Ensure the locks directory exists
  await mkdir(dirs.locks, { recursive: true })

  if (isPidBasedLockingEnabled()) {
    // Use PID-based locking with optional retries
    let attempts = 0
    const maxAttempts = retries + 1
    const minTimeout = retries > 0 ? 1000 : 100
    const maxTimeout = retries > 0 ? 5000 : 500

    while (attempts < maxAttempts) {
      const success = await withLock(
        versionFilePath,
        lockfilePath,
        async () => {
          try {
            await callback()
          } catch (error) {
            logError(error)
            throw error
          }
        },
      )

      if (success) {
        logEvent('tengu_version_lock_acquired', {
          is_pid_based: true,
          is_lifetime_lock: false,
          attempts: attempts + 1,
        })
        return true
      }

      attempts++
      if (attempts < maxAttempts) {
        // Wait before retrying with exponential backoff
        const timeout = Math.min(minTimeout * 2 ** (attempts - 1), maxTimeout)
        await sleep(timeout)
      }
    }

    logEvent('tengu_version_lock_failed', {
      is_pid_based: true,
      is_lifetime_lock: false,
      attempts: maxAttempts,
    })
    logLockAcquisitionError(
      versionFilePath,
      new Error('Lock held by another process'),
    )
    return false
  }

  // Use mtime-based locking (proper-lockfile) with 30-day stale timeout
  let release: (() => Promise<void>) | null = null
  try {
    // Lock acquisition phase - catch lock errors and return false
    // Use 30 days for stale to match lockCurrentVersion() - this ensures we never
    // consider a running process's lock as stale during normal usage (including
    // laptop sleep). 30 days allows eventual cleanup of abandoned locks from
    // crashed processes while being long enough for any realistic session.
    try {
      release = await lockfile.lock(versionFilePath, {
        stale: LOCK_STALE_MS,
        retries: {
          retries,
          minTimeout: retries > 0 ? 1000 : 100,
          maxTimeout: retries > 0 ? 5000 : 500,
        },
        lockfilePath,
        // Handle lock compromise gracefully to prevent unhandled rejections
        // This can happen if another process deletes the lock directory while we hold it
        onCompromised: (err: Error) => {
          logForDebugging(
            `NON-FATAL: Version lock was compromised during operation: ${err.message}`,
            { level: 'info' },
          )
        },
      })
    } catch (lockError) {
      logEvent('tengu_version_lock_failed', {
        is_pid_based: false,
        is_lifetime_lock: false,
      })
      logLockAcquisitionError(versionFilePath, lockError)
      return false
    }

    // Operation phase - log errors but let them propagate
    try {
      await callback()
      logEvent('tengu_version_lock_acquired', {
        is_pid_based: false,
        is_lifetime_lock: false,
      })
      return true
    } catch (error) {
      logError(error)
      throw error
    }
  } finally {
    if (release) {
      await release()
    }
  }
}

/** Official 2.1.328 `r9n`: raised when a staged binary fails SHA-256 check at install time. */
export class StagedBinaryChecksumMismatchError extends ClaudeError {
  constructor() {
    super(
      'Staged binary no longer matches the verified checksum; refusing to install',
    )
    this.name = 'StagedBinaryChecksumMismatchError'
  }
}

async function atomicMoveToInstallPath(
  stagedBinaryPath: string,
  installPath: string,
  expectedChecksum?: string,
) {
  // Create installation directory if it doesn't exist
  await mkdir(dirname(installPath), { recursive: true })

  // Move from staging to final location atomically
  const tempInstallPath = `${installPath}.tmp.${process.pid}.${Date.now()}`

  try {
    // Copy to temp next to install path, then rename. A direct rename from staging
    // would fail with EXDEV if staging and install are on different filesystems.
    await copyFile(stagedBinaryPath, tempInstallPath)
    await chmod(tempInstallPath, 0o755)
    // Official 2.1.328 `kn`: re-verify staged binary hash before atomic rename
    if (
      expectedChecksum !== undefined &&
      (await hashFileSha256(tempInstallPath)) !== expectedChecksum
    ) {
      throw new StagedBinaryChecksumMismatchError()
    }
    await rename(tempInstallPath, installPath)
    logForDebugging(`Atomically installed binary to ${installPath}`)
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await unlink(tempInstallPath)
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}

async function installVersionFromPackage(
  stagingPath: string,
  installPath: string,
  expectedChecksum?: string,
) {
  try {
    // Extract binary from npm package structure in staging
    const nodeModulesDir = join(stagingPath, 'node_modules', '@anthropic-ai')
    const entries = await readdir(nodeModulesDir)
    const nativePackage = entries.find((entry: string) =>
      entry.startsWith('claude-cli-native-'),
    )

    if (!nativePackage) {
      logEvent('tengu_native_install_package_failure', {
        stage_find_package: true,
        error_package_not_found: true,
      })
      const error = new Error('Could not find platform-specific native package')
      throw error
    }

    const stagedBinaryPath = join(nodeModulesDir, nativePackage, 'cli')

    try {
      await stat(stagedBinaryPath)
    } catch {
      logEvent('tengu_native_install_package_failure', {
        stage_binary_exists: true,
        error_binary_not_found: true,
      })
      const error = new Error('Native binary not found in staged package')
      throw error
    }

    await atomicMoveToInstallPath(
      stagedBinaryPath,
      installPath,
      expectedChecksum,
    )

    // Clean up staging directory
    await rm(stagingPath, { recursive: true, force: true })

    logEvent('tengu_native_install_package_success', {})
  } catch (error) {
    // Log if not already logged above
    const msg = errorMessage(error)
    if (
      !msg.includes('Could not find platform-specific') &&
      !msg.includes('Native binary not found')
    ) {
      logEvent('tengu_native_install_package_failure', {
        stage_atomic_move: true,
        error_move_failed: true,
      })
    }
    logError(toError(error))
    throw error
  }
}

async function installVersionFromBinary(
  stagingPath: string,
  installPath: string,
  expectedChecksum?: string,
) {
  try {
    // For direct binary downloads (GCS, generic bucket), the binary is directly in staging
    const platform = getPlatform()
    const binaryName = getBinaryName(platform)
    const stagedBinaryPath = join(stagingPath, binaryName)

    try {
      await stat(stagedBinaryPath)
    } catch {
      logEvent('tengu_native_install_binary_failure', {
        stage_binary_exists: true,
        error_binary_not_found: true,
      })
      const error = new Error('Staged binary not found')
      throw error
    }

    await atomicMoveToInstallPath(
      stagedBinaryPath,
      installPath,
      expectedChecksum,
    )

    // Clean up staging directory
    await rm(stagingPath, { recursive: true, force: true })

    logEvent('tengu_native_install_binary_success', {})
  } catch (error) {
    if (error instanceof StagedBinaryChecksumMismatchError) {
      logEvent('tengu_native_install_binary_failure', {
        stage_atomic_move: true,
        error_checksum_mismatch: true,
      })
    } else if (!errorMessage(error).includes('Staged binary not found')) {
      logEvent('tengu_native_install_binary_failure', {
        stage_atomic_move: true,
        error_move_failed: true,
      })
    }
    logError(toError(error))
    throw error
  }
}

async function installVersion(
  stagingPath: string,
  installPath: string,
  downloadType: 'npm' | 'binary',
  expectedChecksum?: string,
) {
  // Use the explicit download type instead of guessing
  if (downloadType === 'npm') {
    await installVersionFromPackage(stagingPath, installPath, expectedChecksum)
  } else {
    await installVersionFromBinary(stagingPath, installPath, expectedChecksum)
  }
}

/**
 * Official 2.1.328 `Xr`: in-process cache of manifest-signature-verified
 * versions and their certified SHA-256 checksums.
 */
const retainedSignatureVerificationCache = new Map<
  string,
  { enforcingRelease: boolean; checksum?: string }
>()

/**
 * Performs the core update operation: download (if needed), install, and update symlink.
 * Official 2.1.328 `dn`: also enforces manifest signature re-verification for
 * retained versions and returns `skippedUnverifiedRelease: true` when a channel
 * update resolves to a version that predates manifest-signature enforcement.
 */
async function performVersionUpdate(
  version: string,
  opts: {
    forceReinstall: boolean
    explicitVersionRequested: boolean
    requireEnforcingRelease: boolean
  },
): Promise<{
  wasNewInstall: boolean
  skippedUnverifiedRelease: boolean
}> {
  const { forceReinstall, explicitVersionRequested, requireEnforcingRelease } =
    opts
  const { stagingPath: baseStagingPath, installPath } =
    await getVersionPaths(version)
  const { executable: executablePath } = getBaseDirectories()

  // For lockless updates, use a unique staging path to avoid conflicts between concurrent downloads
  const lockless = isEnvTruthy(process.env.ENABLE_LOCKLESS_UPDATES)
  const stagingPath = lockless
    ? `${baseStagingPath}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
    : baseStagingPath

  const isTestFixtureVersion = feature('ALLOW_TEST_VERSIONS')
    ? /^99\.99\./.test(version)
    : false
  const isOfficialGcsPath =
    process.env.USER_TYPE !== 'ant' && !isTestFixtureVersion

  const cachedSig = retainedSignatureVerificationCache.get(version)
  const needsSignatureReverify = !(
    cachedSig &&
    (cachedSig.enforcingRelease || !requireEnforcingRelease)
  )
  let expectedChecksum: string | undefined = needsSignatureReverify
    ? undefined
    : cachedSig?.checksum

  // Only download if not already installed (or if force reinstall)
  let needsInstall = !(await versionIsAvailable(version)) || forceReinstall

  if (!needsInstall && isOfficialGcsPath) {
    if (needsSignatureReverify) {
      try {
        const reverified = await reverifyRetainedVersion(version, installPath, {
          explicitVersionRequested,
          requireEnforcingRelease,
        })
        expectedChecksum = reverified.expectedChecksum
        if (!reverified.binaryMatches) {
          needsInstall = true
        } else if (reverified.signatureVerified) {
          retainedSignatureVerificationCache.set(version, {
            enforcingRelease: requireEnforcingRelease,
            checksum: expectedChecksum,
          })
        }
      } catch (err) {
        if (err instanceof ManifestSignatureError) {
          if (
            requireEnforcingRelease &&
            err.reason === 'release_predates_enforcement'
          ) {
            return { wasNewInstall: false, skippedUnverifiedRelease: true }
          }
          throw err
        }
        if (
          !explicitVersionRequested ||
          requireEnforcingRelease ||
          !isOfflineNetworkError(err)
        ) {
          throw err
        }
        logForDebugging(
          `Could not re-verify retained ${version} (${toError(err).name}); offline, activating as requested`,
          { level: 'warn' },
        )
      }
    } else if (cachedSig?.checksum !== undefined) {
      if (!(await verifyFileSha256(installPath, cachedSig.checksum))) {
        logForDebugging(
          `Retained ${version} no longer matches the checksum verified earlier in this process; re-downloading`,
          { level: 'warn' },
        )
        retainedSignatureVerificationCache.delete(version)
        needsInstall = true
      }
    }
  }

  if (needsInstall) {
    logForDebugging(
      forceReinstall
        ? `Force reinstalling native installer version ${version}`
        : `Downloading native installer version ${version}`,
    )
    try {
      const downloadResult = await downloadVersion(version, stagingPath, {
        explicitVersionRequested,
        requireEnforcingRelease,
      })
      expectedChecksum = downloadResult.expectedChecksum
      await installVersion(
        stagingPath,
        installPath,
        downloadResult.downloadType,
        expectedChecksum,
      )
      if (downloadResult.signatureVerified) {
        retainedSignatureVerificationCache.set(version, {
          enforcingRelease: requireEnforcingRelease,
          checksum: expectedChecksum,
        })
      }
    } catch (err) {
      if (
        requireEnforcingRelease &&
        err instanceof ManifestSignatureError &&
        err.reason === 'release_predates_enforcement'
      ) {
        return { wasNewInstall: false, skippedUnverifiedRelease: true }
      }
      throw err
    } finally {
      if (lockless) {
        await rm(stagingPath, { recursive: true, force: true }).catch(() => {})
      }
    }
  } else {
    logForDebugging(`Version ${version} already installed, updating symlink`)
  }

  // Create direct symlink (or verified copy on Windows) from ~/.local/bin/claude to the version binary
  await removeDirectoryIfEmpty(executablePath)
  await updateSymlink(executablePath, installPath, { expectedChecksum })

  // Verify the executable was actually created/updated
  if (!(await isPossibleClaudeBinary(executablePath))) {
    let installPathExists = false
    try {
      await stat(installPath)
      installPathExists = true
    } catch {
      // installPath doesn't exist
    }
    throw new Error(
      `Failed to create executable at ${executablePath}. ` +
        `Source file exists: ${installPathExists}. ` +
        `Check write permissions to ${executablePath}.`,
    )
  }
  return { wasNewInstall: needsInstall, skippedUnverifiedRelease: false }
}

/**
 * Official 2.1.321 (#1923, `Yr` @16697040):
 * In-process cache of verified version binary paths & sizes so repeated install
 * / update checks within a single process skip redundant verification work.
 */
const verifiedVersionsCache = new Map<
  string,
  { installPath: string; size: number; mtimeMs: number }
>()

export function clearVerifiedVersionsCacheForTesting(): void {
  verifiedVersionsCache.clear()
  retainedSignatureVerificationCache.clear()
}

export async function isVersionBinaryVerifiedCached(
  version: string,
  installPath: string,
): Promise<boolean> {
  const cached = verifiedVersionsCache.get(version)
  if (cached && cached.installPath === installPath) {
    try {
      const st = await stat(installPath)
      if (
        st.isFile() &&
        st.size === cached.size &&
        st.mtimeMs === cached.mtimeMs
      ) {
        return true
      }
    } catch {
      // Fall through and clear stale entry
    }
    verifiedVersionsCache.delete(version)
  }
  if (!(await isPossibleClaudeBinary(installPath))) {
    return false
  }
  try {
    const st = await stat(installPath)
    verifiedVersionsCache.set(version, {
      installPath,
      size: st.size,
      mtimeMs: st.mtimeMs,
    })
  } catch {
    // Non-fatal
  }
  return true
}

async function versionIsAvailable(version: string): Promise<boolean> {
  // Official 2.1.321 (#1923): check directly without mkdir/writeFile side effects.
  const installPath = join(getBaseDirectories().versions, version)
  return isVersionBinaryVerifiedCached(version, installPath)
}

/** Official 2.1.328 `Jr`: checks whether `execPath` is inside the native install dirs. */
function isExecPathInNativeInstall(
  execPath: string,
  dirs: { versions: string; executable: string; isWindows: boolean },
): boolean {
  const norm = (p: string) =>
    dirs.isWindows ? p.replaceAll('\\', '/').toLowerCase() : p
  const normalizedExec = norm(execPath)
  const normalizedVersions = `${norm(dirs.versions).replace(/\/+$/, '')}/`
  return (
    normalizedExec.startsWith(normalizedVersions) ||
    normalizedExec === norm(dirs.executable)
  )
}

/** Official 2.1.328 `c1o`: whether the current process is executing from the native install. */
async function isRunningFromNativeInstall(): Promise<boolean> {
  const { versions, executable } = getBaseDirectories()
  const isWindows = getPlatform().startsWith('win32')
  const candidates = [{ versions, executable }]
  const [realVersions, realExecDir] = await Promise.all([
    realpath(versions).catch(() => versions),
    realpath(dirname(executable)).catch(() => dirname(executable)),
  ])
  const realExecutable = join(realExecDir, basename(executable))
  if (realVersions !== versions || realExecutable !== executable) {
    candidates.push({ versions: realVersions, executable: realExecutable })
  }
  return candidates.some(c =>
    isExecPathInNativeInstall(process.execPath, { ...c, isWindows }),
  )
}

/**
 * Official 2.1.328 `Zr`: channel updates on an existing native install require
 * an enforcing signed release (refusing downgrades to pre-signing releases).
 */
async function shouldRequireEnforcingRelease(): Promise<boolean> {
  if (await isRunningFromNativeInstall()) {
    return true
  }
  const { executable } = getBaseDirectories()
  return (
    (await isPossibleClaudeBinary(executable)) &&
    !(await isNpmShimLauncher(executable).catch(() => false))
  )
}

async function updateLatest(
  channelOrVersion: string,
  forceReinstall: boolean = false,
): Promise<{
  success: boolean
  latestVersion: string
  wasSkipped?: boolean
  lockFailed?: boolean
  lockHolderPid?: number
  skippedUnverifiedRelease?: boolean
}> {
  const startTime = Date.now()
  const { executable: executablePath } = getBaseDirectories()
  const isChannel = !/^v?\d+\.\d+\.\d+(-\S+)?$/.test(channelOrVersion)

  // Official 2.1.328 `ti`: fetch maxVersion + external_force_downgrade BEFORE
  // resolving the channel pointer so forced downgrades directly target maxVersion.
  const maxVersion = await getMaxVersion()
  const forceDowngradeEnabled =
    maxVersion !== undefined &&
    (isForceDowngradeEnabled() || (await isForceDowngradeEnabledAsync()))
  const isForcedDowngrade =
    forceDowngradeEnabled &&
    !forceReinstall &&
    isChannel &&
    Boolean(maxVersion) &&
    shouldForceDowngrade(MACRO.VERSION, maxVersion!, 'native_update')

  let version = isForcedDowngrade
    ? maxVersion!
    : await getLatestVersion(channelOrVersion)

  // Official 2.1.328 `ti`: enforce strict semver format before touching paths/downloads.
  if (!isValidVersion(version)) {
    throw new ClaudeError(
      `Invalid version string from ${isChannel ? 'version pointer' : 'argument'}: not a well-formed version (${version.length} characters)`,
    )
  }

  logForDebugging(`Checking for native installer update to version ${version}`)

  const requireEnforcingRelease =
    isChannel && (await shouldRequireEnforcingRelease())

  // Check if max version is set (server-side kill switch for auto-updates)
  if (
    !isForcedDowngrade &&
    !forceReinstall &&
    maxVersion &&
    gt(version, maxVersion)
  ) {
    logForDebugging(
      `Native installer: maxVersion ${maxVersion} is set, capping update from ${version} to ${maxVersion}`,
    )
    // If we're already at or above maxVersion, skip the update entirely
    if (gte(MACRO.VERSION, maxVersion)) {
      logForDebugging(
        `Native installer: current version ${MACRO.VERSION} is already at or above maxVersion ${maxVersion}, skipping update`,
      )
      logEvent('tengu_native_update_skipped_max_version', {
        latency_ms: Date.now() - startTime,
        max_version:
          maxVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        available_version:
          version as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return { success: true, wasSkipped: true, latestVersion: version }
    }
    version = maxVersion
  }

  // Early exit: if we're already running this exact version AND both the version binary
  // and executable exist and are valid. We need to proceed if the executable doesn't exist,
  // is invalid (e.g., empty/corrupted from a failed install), or we're running via npx.
  if (
    !forceReinstall &&
    version === MACRO.VERSION &&
    (await versionIsAvailable(version)) &&
    (await isPossibleClaudeBinary(executablePath))
  ) {
    logForDebugging(`Found ${version} at ${executablePath}, skipping install`)
    logEvent('tengu_native_update_complete', {
      latency_ms: Date.now() - startTime,
      was_new_install: false,
      was_force_reinstall: false,
      was_already_running: true,
    })
    return { success: true, wasSkipped: true, latestVersion: version }
  }

  // Check if this version should be skipped due to minimumVersion setting
  if (!forceReinstall && shouldSkipVersion(version)) {
    logEvent('tengu_native_update_skipped_minimum_version', {
      latency_ms: Date.now() - startTime,
      target_version:
        version as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return { success: true, wasSkipped: true, latestVersion: version }
  }

  if (isForcedDowngrade) {
    logEvent('tengu_native_update_forced_downgrade', {
      from_version:
        MACRO.VERSION as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      to_version:
        version as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  // Track if we're actually installing or just symlinking
  let wasNewInstall = false
  let skippedUnverifiedRelease = false
  let latencyMs: number

  const updateOpts = {
    forceReinstall,
    explicitVersionRequested: !isChannel,
    requireEnforcingRelease,
  }

  if (isEnvTruthy(process.env.ENABLE_LOCKLESS_UPDATES)) {
    // Lockless: rely on atomic operations, errors propagate
    const result = await performVersionUpdate(version, updateOpts)
    wasNewInstall = result.wasNewInstall
    skippedUnverifiedRelease = result.skippedUnverifiedRelease
    latencyMs = Date.now() - startTime
  } else {
    // Lock-based updates
    const { installPath } = await getVersionPaths(version)
    // If force reinstall, remove any existing lock to bypass stale locks
    if (forceReinstall) {
      await forceRemoveLock(installPath)
    }

    const lockAcquired = await tryWithVersionLock(
      installPath,
      async () => {
        const result = await performVersionUpdate(version, updateOpts)
        wasNewInstall = result.wasNewInstall
        skippedUnverifiedRelease = result.skippedUnverifiedRelease
      },
      3, // retries
    )

    latencyMs = Date.now() - startTime

    // Lock acquisition failed - get lock holder PID for error message
    if (!lockAcquired) {
      const dirs = getBaseDirectories()
      let lockHolderPid: number | undefined
      if (isPidBasedLockingEnabled()) {
        const lockfilePath = getLockFilePathFromVersionPath(dirs, installPath)
        if (isLockActive(lockfilePath)) {
          lockHolderPid = readLockContent(lockfilePath)?.pid
        }
      }
      logEvent('tengu_native_update_lock_failed', {
        latency_ms: latencyMs,
        lock_holder_pid: lockHolderPid,
      })
      return {
        success: false,
        latestVersion: version,
        lockFailed: true,
        lockHolderPid,
      }
    }
  }

  if (skippedUnverifiedRelease) {
    logEvent('tengu_native_update_skipped_unverified_release', {
      latency_ms: latencyMs,
      target_version:
        version as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    logForDebugging(
      `Native installer: resolved ${version} predates manifest signature enforcement; staying on ${MACRO.VERSION}`,
      { level: 'warn' },
    )
    return {
      success: true,
      wasSkipped: true,
      skippedUnverifiedRelease: true,
      latestVersion: version,
    }
  }

  logEvent('tengu_native_update_complete', {
    latency_ms: latencyMs,
    was_new_install: wasNewInstall,
    was_force_reinstall: forceReinstall,
  })
  logForDebugging(`Successfully updated to version ${version}`)
  return { success: true, latestVersion: version }
}

// Exported for testing
export async function removeDirectoryIfEmpty(path: string): Promise<void> {
  // rmdir alone handles all cases: ENOTDIR if path is a file, ENOTEMPTY if
  // directory is non-empty, ENOENT if missing. No need to stat+readdir first.
  try {
    await rmdir(path)
    logForDebugging(`Removed empty directory at ${path}`)
  } catch (error) {
    const code = getErrnoCode(error)
    // Expected cases (not-a-dir, missing, not-empty) — silently skip.
    // ENOTDIR is the normal path: executablePath is typically a symlink.
    if (code !== 'ENOTDIR' && code !== 'ENOENT' && code !== 'ENOTEMPTY') {
      logForDebugging(`Could not remove directory at ${path}: ${error}`)
    }
  }
}

export async function updateSymlink(
  symlinkPath: string,
  targetPath: string,
  options?: { expectedChecksum?: string },
): Promise<boolean> {
  const expectedChecksum = options?.expectedChecksum
  const platform = getPlatform()
  const isWindows = platform.startsWith('win32')

  // On Windows, stage the copy into a temporary sibling file FIRST, verify its
  // SHA-256 against the certified version checksum, then swap via fast metadata
  // renames so interrupting `claude update` never leaves `claude` removed or
  // corrupted (official 2.1.328 `ri`).
  if (isWindows) {
    try {
      // Ensure parent directory exists
      const parentDir = dirname(symlinkPath)
      await mkdir(parentDir, { recursive: true })

      // Check if file already exists and has same content (verified by SHA-256)
      let existingStats: Stats | undefined
      try {
        existingStats = await stat(symlinkPath)
      } catch {
        // symlinkPath doesn't exist
      }

      if (existingStats) {
        try {
          const targetStats = await stat(targetPath)
          if (
            existingStats.size === targetStats.size &&
            (expectedChecksum === undefined ||
              (await verifyFileSha256(symlinkPath, expectedChecksum)))
          ) {
            return false
          }
        } catch {
          // Continue with copy if we can't compare
        }
      }

      // Copy into a unique sibling temp file while the live executable stays intact.
      const stagedNewPath = `${symlinkPath}.new.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
      try {
        await copyFile(targetPath, stagedNewPath)
      } catch (e) {
        await unlink(stagedNewPath).catch(() => {})
        if (isENOENT(e)) {
          throw new Error(`Source file does not exist: ${targetPath}`)
        }
        throw e
      }

      // Official 2.1.328 `ri`: verify staged copy SHA-256 before atomic swap.
      let checksumOk: boolean
      try {
        checksumOk =
          expectedChecksum === undefined ||
          (await hashFileSha256(stagedNewPath)) === expectedChecksum
      } catch (hashErr) {
        await unlink(stagedNewPath).catch(() => {})
        throw hashErr
      }
      if (!checksumOk) {
        await unlink(stagedNewPath).catch(() => {})
        logError(
          new Error(
            `Refusing to install a launcher copy of ${targetPath} that does not match its signed checksum`,
          ),
        )
        return false
      }

      try {
        let needsSwap = existingStats !== undefined
        if (!needsSwap) {
          try {
            await rename(stagedNewPath, symlinkPath)
          } catch (renameErr) {
            const code = getErrnoCode(renameErr)
            if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EBUSY') {
              throw renameErr
            }
            needsSwap = true
          }
        }

        if (needsSwap) {
          // Rename strategy handles file locking on Windows; both steps are fast
          // metadata renames instead of a multi-second copy while claude is absent.
          const oldFileName = `${symlinkPath}.old.${Date.now()}`
          await rename(symlinkPath, oldFileName)
          try {
            await rename(stagedNewPath, symlinkPath)
          } catch (swapErr) {
            try {
              await rename(oldFileName, symlinkPath)
            } catch (restoreError) {
              const errorWithCause = new Error(
                `Failed to restore old executable: ${restoreError}`,
                { cause: swapErr },
              )
              logError(errorWithCause)
              throw errorWithCause
            }
            throw swapErr
          }
          // Best-effort cleanup of old file (may still be locked if running)
          await unlink(oldFileName).catch(() => {})
        }
      } catch (installErr) {
        await unlink(stagedNewPath).catch(() => {})
        throw installErr
      }

      // chmod is not needed on Windows - executability is determined by .exe extension
      return true
    } catch (error) {
      logError(
        new Error(
          `Failed to copy executable from ${targetPath} to ${symlinkPath}: ${error}`,
        ),
      )
      return false
    }
  }

  // For non-Windows platforms, use symlinks as before.
  // Ensure parent directory exists (same as Windows path above).
  const parentDir = dirname(symlinkPath)
  try {
    await mkdir(parentDir, { recursive: true })
    logForDebugging(`Created directory ${parentDir} for symlink`)
  } catch (mkdirError) {
    logError(
      new Error(`Failed to create directory ${parentDir}: ${mkdirError}`),
    )
    return false
  }

  // Official 2.1.321 (#1923, `ni` @16708500): fast-path direct symlink creation
  // first on Unix so fresh installs avoid stat + temp symlink + rename.
  try {
    await symlink(targetPath, symlinkPath)
    logForDebugging(`Created symlink ${symlinkPath} -> ${targetPath}`)
    return true
  } catch (directError) {
    if (getErrnoCode(directError) !== 'EEXIST') {
      logError(
        new Error(
          `Failed to create symlink from ${symlinkPath} to ${targetPath}: ${directError}`,
        ),
      )
      return false
    }
  }

  // EEXIST: check if symlink already points to the desired target (fast noop)
  try {
    const currentTarget = await readlink(symlinkPath)
    const resolvedCurrentTarget = resolve(dirname(symlinkPath), currentTarget)
    const resolvedTargetPath = resolve(targetPath)
    if (resolvedCurrentTarget === resolvedTargetPath) {
      return false
    }
  } catch {
    // Path exists but is not a symlink - may be a custom launcher
  }

  // Official 2.1.207: do not overwrite a custom launcher script/symlink
  // that was not created by the native installer and is not an npm shim.
  // New versions still install under versions/; user must remove the path
  // and re-run update to let the installer manage the launcher again.
  if (!(await isInstallerOwnedLauncher(symlinkPath))) {
    logForDebugging(
      `Not replacing ${symlinkPath}: it was not created by the native installer (not a symlink into a claude/versions/ directory) and is not an npm shim, so this update will not overwrite it. New versions still install under the versions/ directory; remove ${symlinkPath} and re-run the update to let the installer manage the launcher again.`,
      { level: 'warn' },
    )
    return false
  }

  // Use atomic rename to avoid race conditions (without unlinking first so
  // concurrent invocations always see a valid launcher).
  const tempSymlink = `${symlinkPath}.tmp.${process.pid}.${Date.now()}`
  try {
    await symlink(targetPath, tempSymlink)

    // Atomically rename to final name (replaces existing)
    await rename(tempSymlink, symlinkPath)
    logForDebugging(
      `Atomically updated symlink ${symlinkPath} -> ${targetPath}`,
    )
    return true
  } catch (error) {
    // Clean up temp symlink if it exists
    try {
      await unlink(tempSymlink)
    } catch {
      // Ignore cleanup errors
    }
    logError(
      new Error(
        `Failed to create symlink from ${symlinkPath} to ${targetPath}: ${error}`,
      ),
    )
    return false
  }
}

export async function checkInstall(
  force: boolean = false,
): Promise<SetupMessage[]> {
  // Skip all installation checks if disabled via environment variable
  if (isEnvTruthy(process.env.DISABLE_INSTALLATION_CHECKS)) {
    return []
  }

  // Get the actual installation type and config
  const installationType = await getCurrentInstallationType()

  // Skip checks for development builds - config.installMethod from a previous
  // native installation shouldn't trigger warnings when running dev builds
  if (installationType === 'development') {
    return []
  }

  const config = getGlobalConfig()

  // Only show warnings if:
  // 1. User is actually running from native installation, OR
  // 2. User has explicitly set installMethod to 'native' in config (they're trying to use native)
  // 3. force is true (used during installation process)
  const shouldCheckNative =
    force || installationType === 'native' || config.installMethod === 'native'

  if (!shouldCheckNative) {
    return []
  }

  const dirs = getBaseDirectories()
  const messages: SetupMessage[] = []
  const localBinDir = dirname(dirs.executable)
  const resolvedLocalBinPath = resolve(localBinDir)
  const platform = getPlatform()
  const isWindows = platform.startsWith('win32')

  // Official 2.1.207: report externally managed launcher in /doctor when the
  // user is actually on a native install. Custom wrappers are intentional —
  // auto-update leaves them untouched and version cleanup is disabled.
  if (
    installationType === 'native' &&
    !(await isInstallerOwnedLauncher(dirs.executable))
  ) {
    messages.push({
      message: `${dirs.executable} was not created by the native installer (it is not a symlink into the versions/ directory), so auto-update leaves it untouched. If you put a launcher wrapper there on purpose, this is expected — new versions still install under the versions/ directory, your launcher decides what runs, and automatic version cleanup is disabled on this machine (the installer cannot tell which version your launcher needs, so it keeps them all). To let Claude Code manage the launcher again, remove ${dirs.executable} and run \`claude update\`.`,
      userActionRequired: true,
      type: 'info',
    })
  }

  // Check if bin directory exists
  try {
    await access(localBinDir)
  } catch {
    messages.push({
      message: `installMethod is native, but directory ${localBinDir} does not exist`,
      userActionRequired: true,
      type: 'error',
    })
  }

  // Check if claude executable exists and is valid.
  // On non-Windows, call readlink directly and route errno — ENOENT means
  // the executable is missing, EINVAL means it exists but isn't a symlink.
  // This avoids an access()→readlink() TOCTOU where deletion between the
  // two calls produces a misleading "Not a symlink" diagnostic.
  // isPossibleClaudeBinary stats the path internally, so we don't pre-check
  // with access() — that would be a TOCTOU between access and the stat.
  if (isWindows) {
    // On Windows it's a copied executable, not a symlink
    if (!(await isPossibleClaudeBinary(dirs.executable))) {
      messages.push({
        message: `installMethod is native, but claude command is missing or invalid at ${dirs.executable}`,
        userActionRequired: true,
        type: 'error',
      })
    }
  } else {
    try {
      const target = await readlink(dirs.executable)
      const absoluteTarget = resolve(dirname(dirs.executable), target)
      if (!(await isPossibleClaudeBinary(absoluteTarget))) {
        messages.push({
          message: `Claude symlink points to missing or invalid binary: ${target}`,
          userActionRequired: true,
          type: 'error',
        })
      }
    } catch (e) {
      if (isENOENT(e)) {
        messages.push({
          message: `installMethod is native, but claude command not found at ${dirs.executable}`,
          userActionRequired: true,
          type: 'error',
        })
      } else {
        // EINVAL (not a symlink) or other — check as regular binary
        if (!(await isPossibleClaudeBinary(dirs.executable))) {
          messages.push({
            message: `${dirs.executable} exists but is not a valid Claude binary`,
            userActionRequired: true,
            type: 'error',
          })
        }
      }
    }
  }

  // Check if bin directory is in PATH
  const isInCurrentPath = (process.env.PATH || '')
    .split(delimiter)
    .some(entry => {
      try {
        const resolvedEntry = resolve(entry)
        // On Windows, perform case-insensitive comparison for paths
        if (isWindows) {
          return (
            resolvedEntry.toLowerCase() === resolvedLocalBinPath.toLowerCase()
          )
        }
        return resolvedEntry === resolvedLocalBinPath
      } catch {
        return false
      }
    })

  if (!isInCurrentPath) {
    if (isWindows) {
      // Windows-specific PATH instructions
      const windowsBinPath = localBinDir.replace(/\//g, '\\')
      messages.push({
        message: `Native installation exists but ${windowsBinPath} is not in your PATH. Add it by opening: System Properties → Environment Variables → Edit User PATH → New → Add the path above. Then restart your terminal.`,
        userActionRequired: true,
        type: 'path',
      })
    } else {
      // Unix-style PATH instructions
      const shellType = getShellType()
      const configPaths = getShellConfigPaths()
      const configFile = configPaths[shellType as keyof typeof configPaths]
      const displayPath = configFile
        ? configFile.replace(homedir(), '~')
        : 'your shell config file'

      messages.push({
        message: `Native installation exists but ~/.local/bin is not in your PATH. Run:\n\necho 'export PATH="$HOME/.local/bin:$PATH"' >> ${displayPath} && source ${displayPath}`,
        userActionRequired: true,
        type: 'path',
      })
    }
  }

  return messages
}

export type InstallLatestResult = {
  latestVersion: string | null
  wasUpdated: boolean
  wasSkipped?: boolean
  lockFailed?: boolean
  lockHolderPid?: number
  skippedUnverifiedRelease?: boolean
}

// In-process singleflight guard. NativeAutoUpdater remounts whenever the
// prompt suggestions overlay toggles (PromptInput.tsx:2916), and the
// isUpdating guard does not survive the remount. Each remount kicked off a
// fresh 271MB binary download while previous ones were still in flight.
// Telemetry: session 42fed33f saw arrayBuffers climb to 91GB at ~650MB/s.
let inFlightInstall: Promise<InstallLatestResult> | null = null

export function installLatest(
  channelOrVersion: string,
  forceReinstall: boolean = false,
): Promise<InstallLatestResult> {
  if (forceReinstall) {
    return installLatestImpl(channelOrVersion, forceReinstall)
  }
  if (inFlightInstall) {
    logForDebugging('installLatest: joining in-flight call')
    return inFlightInstall
  }
  const promise = installLatestImpl(channelOrVersion, forceReinstall)
  inFlightInstall = promise
  const clear = (): void => {
    inFlightInstall = null
  }
  void promise.then(clear, clear)
  return promise
}

async function installLatestImpl(
  channelOrVersion: string,
  forceReinstall: boolean = false,
): Promise<InstallLatestResult> {
  const updateResult = await updateLatest(channelOrVersion, forceReinstall)

  if (!updateResult.success) {
    return {
      latestVersion: null,
      wasUpdated: false,
      lockFailed: updateResult.lockFailed,
      lockHolderPid: updateResult.lockHolderPid,
    }
  }

  if (updateResult.skippedUnverifiedRelease) {
    return {
      latestVersion: updateResult.latestVersion,
      wasUpdated: false,
      wasSkipped: true,
      skippedUnverifiedRelease: true,
      lockFailed: false,
    }
  }

  // Installation succeeded (early return above covers failure). Mark as native
  // and disable legacy auto-updater to protect symlinks.
  const config = getGlobalConfig()
  if (config.installMethod !== 'native') {
    saveGlobalConfig(current => ({
      ...current,
      installMethod: 'native',
      // Disable legacy auto-updater to prevent npm sessions from deleting native symlinks.
      // Native installations use NativeAutoUpdater instead, which respects native installation.
      autoUpdates: false,
      // Mark this as protection-based, not user preference
      autoUpdatesProtectedForNative: true,
    }))
    logForDebugging(
      'Native installer: Set installMethod to "native" and disabled legacy auto-updater for protection',
    )
  }

  void cleanupOldVersions()

  return {
    latestVersion: updateResult.latestVersion,
    wasUpdated: updateResult.success && !updateResult.wasSkipped,
    wasSkipped: updateResult.wasSkipped,
    skippedUnverifiedRelease: updateResult.skippedUnverifiedRelease,
    lockFailed: false,
  }
}

async function getVersionFromSymlink(
  symlinkPath: string,
): Promise<string | null> {
  try {
    const target = await readlink(symlinkPath)
    const absoluteTarget = resolve(dirname(symlinkPath), target)
    if (await isPossibleClaudeBinary(absoluteTarget)) {
      return absoluteTarget
    }
  } catch {
    // Not a symlink / doesn't exist / target doesn't exist
  }
  return null
}

function getLockFilePathFromVersionPath(
  dirs: ReturnType<typeof getBaseDirectories>,
  versionPath: string,
) {
  const versionName = basename(versionPath)
  return join(dirs.locks, `${versionName}.lock`)
}

const LOCK_MAINTENANCE_INTERVAL_MS = 300_000
let versionLockMaintenanceTimer: ReturnType<typeof setInterval> | null = null

/** Official 2.1.328 `si()`: periodic unref'd lock maintenance timer. */
function startVersionLockMaintenance(): void {
  if (versionLockMaintenanceTimer) return
  const timer = setInterval(() => {
    void maintainVersionLocksOnce()
  }, LOCK_MAINTENANCE_INTERVAL_MS)
  timer.unref?.()
  versionLockMaintenanceTimer = timer
}

export function stopVersionLockMaintenanceForTesting(): void {
  if (versionLockMaintenanceTimer) {
    clearInterval(versionLockMaintenanceTimer)
    versionLockMaintenanceTimer = null
  }
}

/**
 * Official 2.1.328 `ci()`: ensure this process's per-PID lock file still exists
 * and re-acquire the legacy shared lock if its previous holder exited.
 */
export async function maintainVersionLocksOnce(): Promise<void> {
  try {
    if (!isPidBasedLockingEnabled()) return
    const dirs = getBaseDirectories()
    if (!process.execPath.includes(dirs.versions)) return
    const versionPath = resolve(process.execPath)
    await mkdir(dirs.locks, { recursive: true })
    const perPidPath = getPerPidLockPath(
      dirs.locks,
      basename(versionPath),
      process.pid,
    )
    if (readLockContent(perPidPath)?.pid !== process.pid) {
      writePerPidLock(versionPath, dirs.locks)
    }
    const sharedLockPath = getLockFilePathFromVersionPath(dirs, versionPath)
    const shared = readLockContent(sharedLockPath)
    if (shared?.pid === process.pid) return
    if (shared && isProcessRunning(shared.pid)) return
    await acquireOrRefreshSharedLock(versionPath, sharedLockPath)
  } catch (err) {
    logForDebugging(
      `NON-FATAL: version lock maintenance failed: ${errorMessage(err)}`,
    )
  }
}

/**
 * Acquire a lock on the current running version to prevent it from being deleted
 * This lock is held for the entire lifetime of the process
 *
 * Official 2.1.328 `oGe`: writes a non-contending per-PID `${version}#${pid}.lock`,
 * starts periodic maintenance, and also attempts the shared `${version}.lock`
 * for backward compatibility with older running versions.
 */
export async function lockCurrentVersion(): Promise<void> {
  const dirs = getBaseDirectories()

  // Only lock if we're running from the versions directory
  if (!process.execPath.includes(dirs.versions)) {
    return
  }

  const versionPath = resolve(process.execPath)
  try {
    const lockfilePath = getLockFilePathFromVersionPath(dirs, versionPath)

    // Ensure locks directory exists
    await mkdir(dirs.locks, { recursive: true })

    if (isPidBasedLockingEnabled()) {
      const perPidWritten = writePerPidLock(versionPath, dirs.locks)
      startVersionLockMaintenance()

      // Also attempt legacy shared lock so older processes see us
      const acquired = await acquireProcessLifetimeLock(
        versionPath,
        lockfilePath,
      )

      if (!acquired) {
        logEvent('tengu_version_lock_failed', {
          is_pid_based: true,
          is_lifetime_lock: true,
          per_pid_lock_written: perPidWritten,
        })
        logLockAcquisitionError(
          versionPath,
          new Error('Lock already held by another process'),
        )
        return
      }

      logEvent('tengu_version_lock_acquired', {
        is_pid_based: true,
        is_lifetime_lock: true,
        per_pid_lock_written: perPidWritten,
      })
      logForDebugging(`Acquired PID lock on running version: ${versionPath}`)
    } else {
      // Acquire mtime-based lock and never release it (until process exits)
      // Use 30 days for stale to prevent the lock from being considered stale during
      // normal usage. This is critical because laptop sleep suspends the process,
      // stopping the mtime heartbeat. 30 days is long enough for any realistic session
      // while still allowing eventual cleanup of abandoned locks.
      let release: (() => Promise<void>) | undefined
      try {
        release = await lockfile.lock(versionPath, {
          stale: LOCK_STALE_MS,
          retries: 0, // Don't retry - if we can't lock, that's fine
          lockfilePath,
          // Handle lock compromise gracefully (e.g., if another process deletes the lock directory)
          onCompromised: (err: Error) => {
            logForDebugging(
              `NON-FATAL: Lock on running version was compromised: ${err.message}`,
              { level: 'info' },
            )
          },
        })
        logEvent('tengu_version_lock_acquired', {
          is_pid_based: false,
          is_lifetime_lock: true,
        })
        logForDebugging(
          `Acquired mtime-based lock on running version: ${versionPath}`,
        )

        // Release lock explicitly; proper-lockfile's cleanup is unreliable with signal-exit v3+v4
        registerCleanup(async () => {
          try {
            await release?.()
          } catch {
            // Lock may already be released
          }
        })
      } catch (lockError) {
        if (isENOENT(lockError)) {
          logForDebugging(
            `Cannot lock current version - file does not exist: ${versionPath}`,
            { level: 'info' },
          )
          return
        }
        logEvent('tengu_version_lock_failed', {
          is_pid_based: false,
          is_lifetime_lock: true,
        })
        logLockAcquisitionError(versionPath, lockError)
        return
      }
    }
  } catch (error) {
    if (isENOENT(error)) {
      logForDebugging(
        `Cannot lock current version - file does not exist: ${versionPath}`,
        { level: 'info' },
      )
      return
    }
    // We fallback to previous behavior where we don't acquire a lock on a running version
    // This ~mostly works but using native binaries like ripgrep will fail
    logForDebugging(
      `NON-FATAL: Failed to lock current version during execution ${errorMessage(error)}`,
      { level: 'info' },
    )
  }
}

function logLockAcquisitionError(versionPath: string, lockError: unknown) {
  logError(
    new Error(
      `NON-FATAL: Lock acquisition failed for ${versionPath} (expected in multi-process scenarios)`,
      { cause: lockError },
    ),
  )
}

/**
 * Force-remove a lock file for a given version path.
 * Used when --force is specified to bypass stale locks.
 */
async function forceRemoveLock(versionFilePath: string): Promise<void> {
  const dirs = getBaseDirectories()
  const lockfilePath = getLockFilePathFromVersionPath(dirs, versionFilePath)

  try {
    await unlink(lockfilePath)
    logForDebugging(`Force-removed lock file at ${lockfilePath}`)
  } catch (error) {
    // Log but don't throw - we'll try to acquire the lock anyway
    logForDebugging(`Failed to force-remove lock file: ${errorMessage(error)}`)
  }
}

export async function cleanupOldVersions(): Promise<void> {
  // Yield to ensure we don't block startup
  await Promise.resolve()

  const dirs = getBaseDirectories()
  const oneHourAgo = Date.now() - 3600000

  // Clean up old renamed executables on Windows (no longer running at startup)
  if (getPlatform().startsWith('win32')) {
    const executableDir = dirname(dirs.executable)
    try {
      const files = await readdir(executableDir)
      let cleanedCount = 0
      for (const file of files) {
        if (!/^claude\.exe\.old\.\d+$/.test(file)) continue
        try {
          await unlink(join(executableDir, file))
          cleanedCount++
        } catch {
          // File might still be in use by another process
        }
      }
      if (cleanedCount > 0) {
        logForDebugging(
          `Cleaned up ${cleanedCount} old Windows executables on startup`,
        )
      }
    } catch (error) {
      if (!isENOENT(error)) {
        logForDebugging(`Failed to clean up old Windows executables: ${error}`)
      }
    }
  }

  // Clean up orphaned staging directories older than 1 hour
  try {
    const stagingEntries = await readdir(dirs.staging)
    let stagingCleanedCount = 0
    for (const entry of stagingEntries) {
      const stagingPath = join(dirs.staging, entry)
      try {
        // stat() is load-bearing here (we need mtime). There is a theoretical
        // TOCTOU where a concurrent installer could freshen a stale staging
        // dir between stat and rm — but the 1-hour threshold makes this
        // vanishingly unlikely, and rm({force:true}) tolerates concurrent
        // deletion.
        const stats = await stat(stagingPath)
        if (stats.mtime.getTime() < oneHourAgo) {
          await rm(stagingPath, { recursive: true, force: true })
          stagingCleanedCount++
          logForDebugging(`Cleaned up old staging directory: ${entry}`)
        }
      } catch {
        // Ignore individual errors
      }
    }
    if (stagingCleanedCount > 0) {
      logForDebugging(
        `Cleaned up ${stagingCleanedCount} orphaned staging directories`,
      )
      logEvent('tengu_native_staging_cleanup', {
        cleaned_count: stagingCleanedCount,
      })
    }
  } catch (error) {
    if (!isENOENT(error)) {
      logForDebugging(`Failed to clean up staging directories: ${error}`)
    }
  }

  // Clean up stale PID locks (crashed processes) — handles both shared and per-PID locks
  if (isPidBasedLockingEnabled()) {
    const staleLocksCleaned = await cleanupStaleLocksAsync(dirs.locks)
    if (staleLocksCleaned > 0) {
      logForDebugging(`Cleaned up ${staleLocksCleaned} stale version locks`)
      logEvent('tengu_native_stale_locks_cleanup', {
        cleaned_count: staleLocksCleaned,
      })
    }
  }

  // Single readdir of versions dir. Partition into temp files vs candidate binaries,
  // stat'ing each entry at most once.
  let versionEntries: string[]
  try {
    versionEntries = await readdir(dirs.versions)
  } catch (error) {
    if (!isENOENT(error)) {
      logForDebugging(`Failed to readdir versions directory: ${error}`)
    }
    return
  }

  type VersionInfo = {
    name: string
    path: string
    resolvedPath: string
    mtime: Date
    size: number
  }
  const versionFiles: VersionInfo[] = []
  let tempFilesCleanedCount = 0

  for (const entry of versionEntries) {
    const entryPath = join(dirs.versions, entry)
    if (/\.tmp\.\d+\.\d+(\.\d+)?$/.test(entry)) {
      // Orphaned temp install file — pattern: {version}.tmp.{pid}.{timestamp}
      try {
        const stats = await stat(entryPath)
        if (stats.mtime.getTime() < oneHourAgo) {
          await unlink(entryPath)
          tempFilesCleanedCount++
          logForDebugging(`Cleaned up orphaned temp install file: ${entry}`)
        }
      } catch {
        // Ignore individual errors
      }
      continue
    }
    // Candidate version binary — stat once, reuse for isFile/size/mtime/mode
    try {
      const stats = await stat(entryPath)
      if (!stats.isFile()) continue
      if (
        process.platform !== 'win32' &&
        stats.size > 0 &&
        (stats.mode & 0o111) === 0
      ) {
        // Check executability via mode bits from the existing stat result —
        // avoids a second syscall (access(X_OK)) and the TOCTOU window between
        // stat and access. Skip on Windows: libuv only sets execute bits for
        // .exe/.com/.bat/.cmd, but version files are extensionless semver
        // strings (e.g. "1.2.3"), so this check would reject all of them.
        // The previous access(X_OK) passed any readable file on Windows anyway.
        continue
      }
      versionFiles.push({
        name: entry,
        path: entryPath,
        resolvedPath: resolve(entryPath),
        mtime: stats.mtime,
        size: stats.size,
      })
    } catch {
      // Skip files we can't stat
    }
  }

  if (tempFilesCleanedCount > 0) {
    logForDebugging(
      `Cleaned up ${tempFilesCleanedCount} orphaned temp install files`,
    )
    logEvent('tengu_native_temp_files_cleanup', {
      cleaned_count: tempFilesCleanedCount,
    })
  }

  if (versionFiles.length === 0) {
    return
  }

  // Official 2.1.207: if the launcher is a custom script/symlink (not native
  // versions/ and not an npm shim), we cannot determine which version(s) it
  // needs — skip cleanup entirely so we do not delete a still-used binary.
  if (!(await isInstallerOwnedLauncher(dirs.executable))) {
    logForDebugging(
      `Skipping native version cleanup: the launcher at ${dirs.executable} is externally managed, so the version(s) it needs cannot be determined`,
    )
    logEvent('tengu_native_version_cleanup', {
      total_count: versionFiles.length,
      deleted_count: 0,
      protected_count: 0,
      retained_count: VERSION_RETENTION_COUNT,
      lock_failed_count: 0,
      error_count: 0,
      skipped_external_launcher: 1,
    })
    return
  }

  try {
    // Identify protected versions
    const currentBinaryPath = process.execPath
    const protectedVersions = new Set<string>()
    if (currentBinaryPath && currentBinaryPath.includes(dirs.versions)) {
      protectedVersions.add(resolve(currentBinaryPath))
    }

    const currentSymlinkVersion = await getVersionFromSymlink(dirs.executable)
    if (currentSymlinkVersion) {
      protectedVersions.add(currentSymlinkVersion)
    }

    // Protect versions with active locks (running in other processes)
    if (isPidBasedLockingEnabled()) {
      const lockedVersions = await scanActiveLockedVersions(dirs.locks)
      if (lockedVersions === null) {
        logForDebugging(
          'Skipping version cleanup: could not read the locks, so lock protection is unavailable',
          { level: 'error' },
        )
        return
      }
      for (const v of versionFiles) {
        if (protectedVersions.has(v.resolvedPath)) continue
        if (lockedVersions.has(v.name)) {
          protectedVersions.add(v.resolvedPath)
          logForDebugging(`Protecting locked version from cleanup: ${v.name}`)
        }
      }
    } else {
      for (const v of versionFiles) {
        if (protectedVersions.has(v.resolvedPath)) continue

        const lockFilePath = getLockFilePathFromVersionPath(
          dirs,
          v.resolvedPath,
        )
        let hasActiveLock = false
        try {
          hasActiveLock = await lockfile.check(v.resolvedPath, {
            stale: LOCK_STALE_MS,
            lockfilePath: lockFilePath,
          })
        } catch {
          hasActiveLock = false
        }
        if (hasActiveLock) {
          protectedVersions.add(v.resolvedPath)
          logForDebugging(`Protecting locked version from cleanup: ${v.name}`)
        }
      }
    }

    // Eligible versions: not protected, sorted newest first (reuse cached mtime).
    // Official 2.1.328 `u1o`: separate 0-byte placeholders from real binary
    // retention slots so concurrent install placeholders never evict real
    // retained binaries; only delete 0-byte placeholders older than 1 hour.
    const eligibleVersions = versionFiles
      .filter(v => !protectedVersions.has(v.resolvedPath))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

    const versionsToDelete = [
      ...eligibleVersions
        .filter(v => v.size > 0)
        .slice(VERSION_RETENTION_COUNT),
      ...eligibleVersions.filter(
        v => v.size === 0 && v.mtime.getTime() < oneHourAgo,
      ),
    ]

    if (versionsToDelete.length === 0) {
      logEvent('tengu_native_version_cleanup', {
        total_count: versionFiles.length,
        deleted_count: 0,
        protected_count: protectedVersions.size,
        retained_count: VERSION_RETENTION_COUNT,
        lock_failed_count: 0,
        error_count: 0,
      })
      return
    }

    let deletedCount = 0
    let lockFailedCount = 0
    let errorCount = 0

    await Promise.all(
      versionsToDelete.map(async version => {
        try {
          let didDelete = true
          let heldByLivePid = false
          const lockAcquired = await tryWithVersionLock(
            version.path,
            async () => {
              if (version.size === 0) {
                const freshStats = await stat(version.path)
                if (
                  freshStats.size > 0 ||
                  freshStats.mtime.getTime() >= oneHourAgo
                ) {
                  didDelete = false
                  return
                }
              }
              if (
                isPidBasedLockingEnabled() &&
                hasOtherLiveProcessLockForVersion(dirs.locks, version.name)
              ) {
                heldByLivePid = true
                return
              }
              await unlink(version.path)
            },
          )
          if (lockAcquired && heldByLivePid) {
            lockFailedCount++
            logForDebugging(
              `Skipping deletion of ${version.name} - a live process may be using it`,
            )
          } else if (lockAcquired && didDelete) {
            deletedCount++
          } else if (!lockAcquired) {
            lockFailedCount++
            logForDebugging(
              `Skipping deletion of ${version.name} - locked by another process`,
            )
          }
        } catch (error) {
          errorCount++
          logError(
            new Error(`Failed to delete version ${version.name}: ${error}`),
          )
        }
      }),
    )

    logEvent('tengu_native_version_cleanup', {
      total_count: versionFiles.length,
      deleted_count: deletedCount,
      protected_count: protectedVersions.size,
      retained_count: VERSION_RETENTION_COUNT,
      lock_failed_count: lockFailedCount,
      error_count: errorCount,
    })
  } catch (error) {
    if (!isENOENT(error)) {
      logError(new Error(`Version cleanup failed: ${error}`))
    }
  }
}

/**
 * Check if a given path is managed by npm
 * @param executablePath - The path to check (can be a symlink)
 * @returns true if the path is npm-managed, false otherwise
 */
async function isNpmSymlink(executablePath: string): Promise<boolean> {
  // Resolve symlink to its target if applicable
  let targetPath = executablePath
  const stats = await lstat(executablePath)
  if (stats.isSymbolicLink()) {
    targetPath = await realpath(executablePath)
  }

  // checking npm prefix isn't guaranteed to work, as prefix can change
  // and users may set --prefix manually when installing
  // thus we use this heuristic:
  return targetPath.endsWith('.js') || targetPath.includes('node_modules')
}

/**
 * Remove the claude symlink from the executable directory
 * This is used when switching away from native installation
 * Will only remove if it's a native binary symlink, not npm-managed JS files
 */
export async function removeInstalledSymlink(): Promise<void> {
  const dirs = getBaseDirectories()

  try {
    // Check if this is an npm-managed installation
    if (await isNpmSymlink(dirs.executable)) {
      logForDebugging(
        `Skipping removal of ${dirs.executable} - appears to be npm-managed`,
      )
      return
    }

    // It's a native binary symlink, safe to remove
    await unlink(dirs.executable)
    logForDebugging(`Removed claude symlink at ${dirs.executable}`)
  } catch (error) {
    if (isENOENT(error)) {
      return
    }
    logError(new Error(`Failed to remove claude symlink: ${error}`))
  }
}

/**
 * Clean up old claude aliases from shell configuration files
 * Only handles alias removal, not PATH setup
 */
export async function cleanupShellAliases(): Promise<SetupMessage[]> {
  const messages: SetupMessage[] = []
  const configMap = getShellConfigPaths()

  for (const [shellType, configFile] of Object.entries(configMap)) {
    try {
      const lines = await readFileLines(configFile)
      if (!lines) continue

      const { filtered, hadAlias } = filterClaudeAliases(lines)

      if (hadAlias) {
        await writeFileLines(configFile, filtered)
        messages.push({
          message: `Removed claude alias from ${configFile}. Run: unalias claude`,
          userActionRequired: true,
          type: 'alias',
        })
        logForDebugging(`Cleaned up claude alias from ${shellType} config`)
      }
    } catch (error) {
      logError(error)
      messages.push({
        message: `Failed to clean up ${configFile}: ${error}`,
        userActionRequired: false,
        type: 'error',
      })
    }
  }

  return messages
}

async function manualRemoveNpmPackage(
  packageName: string,
): Promise<{ success: boolean; error?: string; warning?: string }> {
  try {
    // Get npm global prefix
    const prefixResult = await execFileNoThrowWithCwd('npm', [
      'config',
      'get',
      'prefix',
    ])
    if (prefixResult.code !== 0 || !prefixResult.stdout) {
      return {
        success: false,
        error: 'Failed to get npm global prefix',
      }
    }

    const globalPrefix = prefixResult.stdout.trim()
    let manuallyRemoved = false

    // Helper to try removing a file. unlink alone is sufficient — it throws
    // ENOENT if the file is missing, which the catch handles identically.
    // A stat() pre-check would add a syscall and a TOCTOU window where
    // concurrent cleanup causes a false-negative return.
    async function tryRemove(filePath: string, description: string) {
      try {
        await unlink(filePath)
        logForDebugging(`Manually removed ${description}: ${filePath}`)
        return true
      } catch {
        return false
      }
    }

    if (getPlatform().startsWith('win32')) {
      // Windows - only remove executables, not the package directory
      const binCmd = join(globalPrefix, 'claude.cmd')
      const binPs1 = join(globalPrefix, 'claude.ps1')
      const binExe = join(globalPrefix, 'claude')

      if (await tryRemove(binCmd, 'bin script')) {
        manuallyRemoved = true
      }

      if (await tryRemove(binPs1, 'PowerShell script')) {
        manuallyRemoved = true
      }

      if (await tryRemove(binExe, 'bin executable')) {
        manuallyRemoved = true
      }
    } else {
      // Unix/Mac - only remove symlink, not the package directory
      const binSymlink = join(globalPrefix, 'bin', 'claude')

      if (await tryRemove(binSymlink, 'bin symlink')) {
        manuallyRemoved = true
      }
    }

    if (manuallyRemoved) {
      logForDebugging(`Successfully removed ${packageName} manually`)
      const nodeModulesPath = getPlatform().startsWith('win32')
        ? join(globalPrefix, 'node_modules', packageName)
        : join(globalPrefix, 'lib', 'node_modules', packageName)

      return {
        success: true,
        warning: `${packageName} executables removed, but node_modules directory was left intact for safety. You may manually delete it later at: ${nodeModulesPath}`,
      }
    } else {
      return { success: false }
    }
  } catch (manualError) {
    logForDebugging(`Manual removal failed: ${manualError}`, {
      level: 'error',
    })
    return {
      success: false,
      error: `Manual removal failed: ${manualError}`,
    }
  }
}

async function attemptNpmUninstall(
  packageName: string,
): Promise<{ success: boolean; error?: string; warning?: string }> {
  const { code, stderr } = await execFileNoThrowWithCwd(
    'npm',
    ['uninstall', '-g', packageName],
    // eslint-disable-next-line custom-rules/no-process-cwd -- matches original behavior
    { cwd: process.cwd() },
  )

  if (code === 0) {
    logForDebugging(`Removed global npm installation of ${packageName}`)
    return { success: true }
  } else if (stderr && !stderr.includes('npm ERR! code E404')) {
    // Check for ENOTEMPTY error and try manual removal
    if (stderr.includes('npm error code ENOTEMPTY')) {
      logForDebugging(
        `Failed to uninstall global npm package ${packageName}: ${stderr}`,
        { level: 'error' },
      )
      logForDebugging(`Attempting manual removal due to ENOTEMPTY error`)

      const manualResult = await manualRemoveNpmPackage(packageName)
      if (manualResult.success) {
        return { success: true, warning: manualResult.warning }
      } else if (manualResult.error) {
        return {
          success: false,
          error: `Failed to remove global npm installation of ${packageName}: ${stderr}. Manual removal also failed: ${manualResult.error}`,
        }
      }
    }

    // Only report as error if it's not a "package not found" error
    logForDebugging(
      `Failed to uninstall global npm package ${packageName}: ${stderr}`,
      { level: 'error' },
    )
    return {
      success: false,
      error: `Failed to remove global npm installation of ${packageName}: ${stderr}`,
    }
  }

  return { success: false } // Package not found, not an error
}

export async function cleanupNpmInstallations(): Promise<{
  removed: number
  errors: string[]
  warnings: string[]
}> {
  const errors: string[] = []
  const warnings: string[] = []
  let removed = 0

  // Always attempt to remove @anthropic-ai/claude-code
  const codePackageResult = await attemptNpmUninstall(
    '@anthropic-ai/claude-code',
  )
  if (codePackageResult.success) {
    removed++
    if (codePackageResult.warning) {
      warnings.push(codePackageResult.warning)
    }
  } else if (codePackageResult.error) {
    errors.push(codePackageResult.error)
  }

  // Also attempt to remove MACRO.PACKAGE_URL if it's defined and different
  if (MACRO.PACKAGE_URL && MACRO.PACKAGE_URL !== '@anthropic-ai/claude-code') {
    const macroPackageResult = await attemptNpmUninstall(MACRO.PACKAGE_URL)
    if (macroPackageResult.success) {
      removed++
      if (macroPackageResult.warning) {
        warnings.push(macroPackageResult.warning)
      }
    } else if (macroPackageResult.error) {
      errors.push(macroPackageResult.error)
    }
  }

  // Check for local installation at ~/.claude/local
  const localInstallDir = join(homedir(), '.claude', 'local')

  try {
    await rm(localInstallDir, { recursive: true })
    removed++
    logForDebugging(`Removed local installation at ${localInstallDir}`)
  } catch (error) {
    if (!isENOENT(error)) {
      errors.push(`Failed to remove ${localInstallDir}: ${error}`)
      logForDebugging(`Failed to remove local installation: ${error}`, {
        level: 'error',
      })
    }
  }

  return { removed, errors, warnings }
}
