/**
 * PID-Based Version Locking
 *
 * This module provides PID-based locking for running Claude Code versions.
 * Unlike mtime-based locking (which can hold locks for 30 days after a crash),
 * PID-based locking can immediately detect when a process is no longer running.
 *
 * Lock files contain JSON with the PID and metadata, and staleness is determined
 * by checking if the process is still alive.
 */

import { lstat, readdir } from 'fs/promises'
import { basename, join } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { logForDebugging } from '../debug.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { getErrnoCode, isENOENT, toError } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { getProcessCommand } from '../genericProcessUtils.js'
import { logError } from '../log.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../slowOperations.js'

/**
 * Check if PID-based version locking is enabled.
 * When disabled, falls back to mtime-based locking (30-day timeout).
 *
 * Controlled by GrowthBook gate with local override:
 * - Set ENABLE_PID_BASED_VERSION_LOCKING=true to force-enable
 * - Set ENABLE_PID_BASED_VERSION_LOCKING=false to force-disable
 * - If unset, GrowthBook gate (tengu_pid_based_version_locking) controls rollout
 */
export function isPidBasedLockingEnabled(): boolean {
  const envVar = process.env.ENABLE_PID_BASED_VERSION_LOCKING
  // If env var is explicitly set, respect it
  if (isEnvTruthy(envVar)) {
    return true
  }
  if (isEnvDefinedFalsy(envVar)) {
    return false
  }
  // GrowthBook controls gradual rollout (returns false for external users)
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_pid_based_version_locking',
    false,
  )
}

/**
 * Content stored in a version lock file
 */
export type VersionLockContent = {
  pid: number
  version: string
  execPath: string
  acquiredAt: number // timestamp when lock was acquired
}

/**
 * Information about a lock for diagnostic purposes
 */
export type LockInfo = {
  version: string
  pid: number
  isProcessRunning: boolean
  execPath: string
  acquiredAt: Date
  lockFilePath: string
}

// Fallback stale timeout (2 hours) - used when PID check is inconclusive
// This is much shorter than the previous 30-day timeout but still allows
// for edge cases like network filesystems where PID check might fail
const FALLBACK_STALE_MS = 2 * 60 * 60 * 1000

/**
 * Check if a process with the given PID is currently running
 * Uses signal 0 which doesn't actually send a signal but checks if we can
 */
export function isProcessRunning(pid: number): boolean {
  // PID 0 is special - it refers to the current process group, not a real process
  // PID 1 is init/systemd and is always running but shouldn't be considered for locks
  if (pid <= 1) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Validate that a running process is actually a Claude process
 * This helps mitigate PID reuse issues
 */
function isClaudeProcess(pid: number, expectedExecPath: string): boolean {
  if (!isProcessRunning(pid)) {
    return false
  }

  // If the PID matches our current process, we know it's valid
  // This handles test environments where the command might not contain 'claude'
  if (pid === process.pid) {
    return true
  }

  try {
    const command = getProcessCommand(pid)
    if (!command) {
      // If we can't get the command, trust the PID check
      // This is conservative - we'd rather not delete a running version
      return true
    }

    // Check if the command contains 'claude' or the expected exec path
    const normalizedCommand = command.toLowerCase()
    const normalizedExecPath = expectedExecPath.toLowerCase()

    return (
      normalizedCommand.includes('claude') ||
      normalizedCommand.includes(normalizedExecPath)
    )
  } catch {
    // If command check fails, trust the PID check
    return true
  }
}

export function parseLockContent(raw: string): VersionLockContent | null {
  try {
    if (!raw || raw.trim() === '') {
      return null
    }
    const parsed = jsonParse(raw) as VersionLockContent
    if (typeof parsed.pid !== 'number' || !parsed.version || !parsed.execPath) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * Read and parse a lock file's content
 */
export function readLockContent(
  lockFilePath: string,
): VersionLockContent | null {
  const fs = getFsImplementation()

  try {
    const content = fs.readFileSync(lockFilePath, { encoding: 'utf8' })
    return parseLockContent(content)
  } catch {
    return null
  }
}

/**
 * Check if a lock file represents an active lock (process still running)
 */
export function isLockActive(
  lockFilePath: string,
  preReadContent?: VersionLockContent | null,
): boolean {
  const content =
    preReadContent !== undefined
      ? preReadContent
      : readLockContent(lockFilePath)

  if (!content) {
    return false
  }

  const { pid, execPath } = content

  // Primary check: is the process running?
  if (!isProcessRunning(pid)) {
    return false
  }

  // Secondary validation: is it actually a Claude process?
  // This helps with PID reuse scenarios
  if (!isClaudeProcess(pid, execPath)) {
    logForDebugging(
      `Lock PID ${pid} is running but does not appear to be Claude - treating as stale`,
    )
    return false
  }

  // Fallback: if the lock is very old (> 2 hours) and we can't validate
  // the command, be conservative and consider it potentially stale
  // This handles edge cases like network filesystems
  const fs = getFsImplementation()
  try {
    const stats = fs.statSync(lockFilePath)
    const age = Date.now() - stats.mtimeMs
    if (age > FALLBACK_STALE_MS) {
      // Double-check that we can still see the process
      if (!isProcessRunning(pid)) {
        return false
      }
    }
  } catch {
    // If we can't stat the file, trust the PID check
  }

  return true
}

/**
 * Write lock content to a file atomically
 */
function writeLockFile(
  lockFilePath: string,
  content: VersionLockContent,
): void {
  const fs = getFsImplementation()
  const tempPath = `${lockFilePath}.tmp.${process.pid}.${Date.now()}`

  try {
    writeFileSync_DEPRECATED(tempPath, jsonStringify(content, null, 2), {
      encoding: 'utf8',
      flush: true,
    })
    fs.renameSync(tempPath, lockFilePath)
  } catch (error) {
    // Clean up temp file on failure (best-effort)
    try {
      fs.unlinkSync(tempPath)
    } catch {
      // Ignore cleanup errors (ENOENT expected if write failed before file creation)
    }
    throw error
  }
}

/**
 * Try to acquire a lock on a version file
 * Returns a release function if successful, null if the lock is already held
 */
export async function tryAcquireLock(
  versionPath: string,
  lockFilePath: string,
): Promise<(() => void) | null> {
  const fs = getFsImplementation()
  const versionName = basename(versionPath)

  // Check if there's an existing active lock (including by our own process)
  // Use isLockActive for consistency with cleanup - it checks both PID running AND
  // validates it's actually a Claude process (to handle PID reuse scenarios)
  if (isLockActive(lockFilePath)) {
    const existingContent = readLockContent(lockFilePath)
    logForDebugging(
      `Cannot acquire lock for ${versionName} - held by PID ${existingContent?.pid}`,
    )
    return null
  }

  // Try to acquire the lock
  const lockContent: VersionLockContent = {
    pid: process.pid,
    version: versionName,
    execPath: process.execPath,
    acquiredAt: Date.now(),
  }

  try {
    writeLockFile(lockFilePath, lockContent)

    // Verify we actually got the lock (race condition check)
    const verifyContent = readLockContent(lockFilePath)
    if (verifyContent?.pid !== process.pid) {
      // Another process won the race
      return null
    }

    logForDebugging(`Acquired PID lock for ${versionName} (PID ${process.pid})`)

    // Return release function
    return () => {
      try {
        // Only release if we still own the lock
        const currentContent = readLockContent(lockFilePath)
        if (currentContent?.pid === process.pid) {
          fs.unlinkSync(lockFilePath)
          logForDebugging(`Released PID lock for ${versionName}`)
        }
      } catch (error) {
        logForDebugging(`Failed to release lock for ${versionName}: ${error}`)
      }
    }
  } catch (error) {
    logForDebugging(`Failed to acquire lock for ${versionName}: ${error}`)
    return null
  }
}

/**
 * Acquire a lock and hold it for the lifetime of the process
 * This is used for locking the currently running version
 */
export async function acquireProcessLifetimeLock(
  versionPath: string,
  lockFilePath: string,
): Promise<boolean> {
  const release = await tryAcquireLock(versionPath, lockFilePath)

  if (!release) {
    return false
  }

  // Register cleanup on process exit
  const cleanup = () => {
    try {
      release()
    } catch {
      // Ignore errors during process exit
    }
  }

  process.on('exit', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  // Don't call release() - we want to hold the lock until process exits
  return true
}

/**
 * Execute a callback while holding a lock
 * Returns true if the callback executed, false if lock couldn't be acquired
 */
export async function withLock(
  versionPath: string,
  lockFilePath: string,
  callback: () => void | Promise<void>,
): Promise<boolean> {
  const release = await tryAcquireLock(versionPath, lockFilePath)

  if (!release) {
    return false
  }

  try {
    await callback()
    return true
  } finally {
    release()
  }
}

/**
 * Get information about all version locks for diagnostics
 */
export function getAllLockInfo(locksDir: string): LockInfo[] {
  const fs = getFsImplementation()
  const lockInfos: LockInfo[] = []

  try {
    const lockFiles = fs
      .readdirStringSync(locksDir)
      .filter((f: string) => f.endsWith('.lock'))

    for (const lockFile of lockFiles) {
      const lockFilePath = join(locksDir, lockFile)
      const content = readLockContent(lockFilePath)

      if (content) {
        lockInfos.push({
          version: content.version,
          pid: content.pid,
          isProcessRunning: isProcessRunning(content.pid),
          execPath: content.execPath,
          acquiredAt: new Date(content.acquiredAt),
          lockFilePath,
        })
      }
    }
  } catch (error) {
    if (isENOENT(error)) {
      return lockInfos
    }
    logError(toError(error))
  }

  return lockInfos
}

/**
 * Clean up stale locks (locks where the process is no longer running)
 * Returns the number of locks cleaned up
 *
 * Handles both:
 * - PID-based locks (shared `${version}.lock` and per-PID `${version}#${pid}.lock`)
 * - Legacy proper-lockfile locks (directories created by mtime-based locking)
 */
export function cleanupStaleLocks(locksDir: string): number {
  const fs = getFsImplementation()
  let cleanedCount = 0

  try {
    const lockEntries = fs
      .readdirStringSync(locksDir)
      .filter((f: string) => f.endsWith('.lock'))

    for (const lockEntry of lockEntries) {
      const lockFilePath = join(locksDir, lockEntry)

      try {
        const stats = fs.lstatSync(lockFilePath)

        if (stats.isDirectory()) {
          // Legacy proper-lockfile directory lock - always remove when PID-based
          // locking is enabled since these are from a different locking mechanism
          fs.rmSync(lockFilePath, { recursive: true, force: true })
          cleanedCount++
          logForDebugging(`Cleaned up legacy directory lock: ${lockEntry}`)
        } else {
          // Official `tn`: skip unreadable lock files rather than treating them
          // as stale and unlinking a live process's lock.
          let raw: string | null = null
          let unreadable = false
          try {
            raw = fs.readFileSync(lockFilePath, { encoding: 'utf8' })
          } catch (readErr) {
            if (isENOENT(readErr)) continue
            unreadable = true
            logForDebugging(
              `Skipping stale-lock sweep of unreadable lock ${lockEntry}: ${toError(readErr).message}`,
            )
          }
          if (
            !unreadable &&
            !isLockActive(lockFilePath, parseLockContent(raw ?? ''))
          ) {
            fs.unlinkSync(lockFilePath)
            cleanedCount++
            logForDebugging(`Cleaned up stale lock: ${lockEntry}`)
          }
        }
      } catch {
        // Ignore individual cleanup errors
      }
    }
  } catch (error) {
    if (isENOENT(error)) {
      return 0
    }
    logError(toError(error))
  }

  return cleanedCount
}

/** Async stale-lock sweep yielding between entries (official 2.1.328 `tn`). */
export async function cleanupStaleLocksAsync(
  locksDir: string,
): Promise<number> {
  const fs = getFsImplementation()
  let cleanedCount = 0
  let lockEntries: string[]
  try {
    lockEntries = (await readdir(locksDir)).filter(f => f.endsWith('.lock'))
  } catch (error) {
    if (isENOENT(error)) return 0
    logForDebugging(
      `Failed to readdir locks directory: ${toError(error).message}`,
      { level: 'error' },
    )
    return 0
  }

  for (const lockEntry of lockEntries) {
    const lockFilePath = join(locksDir, lockEntry)
    try {
      const stats = await lstat(lockFilePath)
      if (stats.isDirectory()) {
        fs.rmSync(lockFilePath, { recursive: true, force: true })
        cleanedCount++
        logForDebugging(`Cleaned up legacy directory lock: ${lockEntry}`)
      } else {
        let raw: string | null = null
        let unreadable = false
        try {
          raw = fs.readFileSync(lockFilePath, { encoding: 'utf8' })
        } catch (readErr) {
          if (isENOENT(readErr)) continue
          unreadable = true
          logForDebugging(
            `Skipping stale-lock sweep of unreadable lock ${lockEntry}: ${toError(readErr).message}`,
          )
        }
        if (
          !unreadable &&
          !isLockActive(lockFilePath, parseLockContent(raw ?? ''))
        ) {
          fs.unlinkSync(lockFilePath)
          cleanedCount++
          logForDebugging(`Cleaned up stale lock: ${lockEntry}`)
        }
      }
    } catch {
      // Ignore individual cleanup errors
    }
    await new Promise(resolve => setImmediate(resolve))
  }

  return cleanedCount
}

const TRANSIENT_LOCK_ERRNOS = new Set([
  'EMFILE',
  'ENFILE',
  'EAGAIN',
  'EINTR',
  'EBUSY',
])

function classifyLockReadError(
  err: unknown,
): 'transient' | 'directory' | 'permanent' {
  const code = getErrnoCode(err)
  if (code && TRANSIENT_LOCK_ERRNOS.has(code)) return 'transient'
  if (code === 'EISDIR' || code === 'ENOTDIR') return 'directory'
  return 'permanent'
}

/** Official 2.1.328 `nn` / `gt` / `Ir`: per-PID lock filename `${version}#${pid}.lock`. */
export const PER_PID_LOCK_SEPARATOR = '#'

export function getPerPidLockPath(
  locksDir: string,
  version: string,
  pid: number = process.pid,
): string {
  return join(locksDir, `${version}${PER_PID_LOCK_SEPARATOR}${pid}.lock`)
}

export function matchesVersionLockFile(
  filename: string,
  version: string,
): boolean {
  return (
    filename === `${version}.lock` ||
    (filename.startsWith(`${version}${PER_PID_LOCK_SEPARATOR}`) &&
      filename.endsWith('.lock'))
  )
}

let activePerPidLockPath: string | null = null
let perPidExitHandlerRegistered = false

/**
 * Official 2.1.328 `_t()`: write a non-contending per-PID lock file
 * `${locksDir}/${version}#${process.pid}.lock` and unlink it on exit.
 */
export function writePerPidLock(
  versionPath: string,
  locksDir: string,
): boolean {
  const fs = getFsImplementation()
  const versionName = basename(versionPath)
  const lockPath = getPerPidLockPath(locksDir, versionName, process.pid)
  try {
    writeLockFile(lockPath, {
      pid: process.pid,
      version: versionName,
      execPath: process.execPath,
      acquiredAt: Date.now(),
    })
  } catch (err) {
    logForDebugging(
      `NON-FATAL: Failed to write per-PID lock for ${versionName}: ${err}`,
    )
    return false
  }
  activePerPidLockPath = lockPath
  if (!perPidExitHandlerRegistered) {
    perPidExitHandlerRegistered = true
    process.on('exit', () => {
      try {
        if (activePerPidLockPath) {
          fs.unlinkSync(activePerPidLockPath)
          activePerPidLockPath = null
        }
      } catch {
        // ignore exit cleanup failures
      }
    })
  }
  logForDebugging(`Wrote per-PID lock for ${versionName} (PID ${process.pid})`)
  return true
}

let sharedMaintenanceRelease: (() => void) | null = null
let sharedExitHandlerRegistered = false

/**
 * Official 2.1.328 `rn()`: acquire or refresh the shared `${version}.lock`
 * without leaking additional `process.on('exit')` listeners across maintenance ticks.
 */
export async function acquireOrRefreshSharedLock(
  versionPath: string,
  lockFilePath: string,
): Promise<boolean> {
  const release = await tryAcquireLock(versionPath, lockFilePath)
  if (!release) return false
  sharedMaintenanceRelease = release
  if (!sharedExitHandlerRegistered) {
    sharedExitHandlerRegistered = true
    process.on('exit', () => {
      try {
        sharedMaintenanceRelease?.()
      } catch {
        // ignore exit cleanup failures
      }
    })
  }
  return true
}

/**
 * Official 2.1.328 `an()`: scan all `*.lock` files in `locksDir` (both shared
 * `${version}.lock` and per-PID `${version}#${pid}.lock`) and return the set of
 * versions locked by live Claude processes. Returns `null` if lock scanning
 * failed (fail-safe so cleanup skips deletion rather than deleting live versions).
 */
export async function scanActiveLockedVersions(
  locksDir: string,
): Promise<Set<string> | null> {
  const locked = new Set<string>()
  let entries: string[]
  try {
    entries = (await readdir(locksDir)).filter(f => f.endsWith('.lock'))
  } catch (err) {
    if (isENOENT(err)) return locked
    const transient = classifyLockReadError(err) === 'transient'
    logForDebugging(
      `Failed to readdir locks directory (${transient ? 'transient' : 'permanent'}): ${toError(err).message}`,
      { level: 'error' },
    )
    if (!transient) {
      logError(toError(err))
    }
    return null
  }

  const fs = getFsImplementation()
  for (const entry of entries) {
    const filePath = join(locksDir, entry)
    let raw: string
    try {
      raw = fs.readFileSync(filePath, { encoding: 'utf8' })
    } catch (err) {
      if (isENOENT(err)) continue
      const kind = classifyLockReadError(err)
      if (kind === 'transient') return null
      if (kind === 'permanent') logError(toError(err))
      continue
    }
    const content = parseLockContent(raw)
    if (content && !locked.has(content.version)) {
      try {
        if (isLockActive(filePath, content)) {
          locked.add(content.version)
        }
      } catch {
        // ignore per-entry errors
      }
    }
    await new Promise(resolve => setImmediate(resolve))
  }
  return locked
}

/**
 * Official 2.1.328 `on()`: synchronously check under the deletion lock whether
 * any OTHER live process holds either `${version}.lock` or `${version}#<pid>.lock`.
 * Fail-safe: returns `true` on transient read errors or unreadable directory.
 */
export function hasOtherLiveProcessLockForVersion(
  locksDir: string,
  version: string,
): boolean {
  const fs = getFsImplementation()
  let matchingFiles: string[]
  try {
    matchingFiles = fs
      .readdirStringSync(locksDir)
      .filter((f: string) => matchesVersionLockFile(f, version))
  } catch (err) {
    return !isENOENT(err)
  }

  for (const file of matchingFiles) {
    const filePath = join(locksDir, file)
    let raw: string
    try {
      raw = fs.readFileSync(filePath, { encoding: 'utf8' })
    } catch (err) {
      if (isENOENT(err)) continue
      if (classifyLockReadError(err) === 'transient') return true
      continue
    }
    const content = parseLockContent(raw)
    if (
      content &&
      content.version === version &&
      content.pid !== process.pid &&
      isLockActive(filePath, content)
    ) {
      return true
    }
  }
  return false
}
