/**
 * densable 2.1.234 #51 — rename-with-retry that fails fast on read-only targets.
 *
 * Official helpers:
 *   - ulu / LTr / gVy=4 / clu=50ms — retry only EPERM|EBUSY|EACCES, max 4 attempts
 *   - SVy / bVy / dlu=128 (S_IWUSR) — if target lacks owner-write, throw on first hit
 *   - fIs (sync) / cw+vVy (async) — used by atomic write rename paths
 *
 * Without the RO early-exit, Windows RO `~/.claude.json` stalls startup on
 * repeated rename retries during saveGlobalConfig.
 */

import { lstatSync, renameSync } from 'fs'
import { lstat, rename } from 'fs/promises'
import { getErrnoCode } from './errors.js'
import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'

/** densable LTr — codes eligible for rename retry */
export const RENAME_TRANSIENT_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * densable CQ — codes that may fall back to in-place write after rename fails.
 * Kept here for callers that share the atomic-write contract.
 */
export const RENAME_INPLACE_FALLBACK_CODES = new Set([
  'EXDEV',
  'EPERM',
  'EEXIST',
  'EBUSY',
])

/** densable gVy — attempt count (ulu: attempt < gVy - 1) */
export const RENAME_MAX_ATTEMPTS = 4

/** densable clu — sleep between retries (ms) */
export const RENAME_RETRY_SLEEP_MS = 50

/** Official 2.1.319 #1792 (`ie`): extended backoff [100, 200, 400] ms */
export const RENAME_EXTENDED_RETRY_DELAYS_MS: readonly number[] = [
  100, 200, 400,
]

/** Official 2.1.319 #1792 (`S3o`): long backoff [100, 500, 2000] ms */
export const RENAME_LONG_RETRY_DELAYS_MS: readonly number[] = [100, 500, 2000]

/** Short fallback backoff (`Re`) when target already timed out previously */
const RENAME_FALLBACK_RETRY_DELAYS_MS: readonly number[] = [50, 50]

/** Official `V`: paths where extended rename retry previously timed out */
const fallbackRenameRetryHost: object = {}
const timedOutRenameTargetsByHost = new HostSlot<Set<string>>(() => new Set())

function getTimedOutRenameTargets(): Set<string> {
  try {
    const host = getBootstrapSessionHost()
    if (host) return timedOutRenameTargetsByHost.of(host)
  } catch {
    // Fall back when sessionHost is mocked
  }
  return timedOutRenameTargetsByHost.of(fallbackRenameRetryHost)
}

export function clearTimedOutRenameTargetsForTesting(): void {
  getTimedOutRenameTargets().clear()
}

export function hasTimedOutRenameTarget(targetPath: string): boolean {
  return getTimedOutRenameTargets().has(targetPath)
}

function recordTimedOutRenameTarget(err: unknown, targetPath: string): void {
  const code = getErrnoCode(err)
  if (code !== undefined && RENAME_TRANSIENT_CODES.has(code)) {
    getTimedOutRenameTargets().add(targetPath)
  }
}

/** densable dlu — S_IWUSR owner-write bit */
export const OWNER_WRITE_BIT = 0o200 // 128

const sleepWaitBuf = new Int32Array(new SharedArrayBuffer(4))

/** densable _Vy — sync sleep via Atomics.wait */
function sleepSyncMs(ms: number): void {
  try {
    Atomics.wait(sleepWaitBuf, 0, 0, ms)
  } catch {
    const end = Date.now() + ms
    while (Date.now() < end) {
      /* spin */
    }
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/** densable ulu / W(err, attempt, maxRetries) */
export function isRenameRetryable(
  err: unknown,
  attempt: number,
  maxRetries = RENAME_MAX_ATTEMPTS - 1,
): boolean {
  const code = getErrnoCode(err)
  return (
    code !== undefined &&
    RENAME_TRANSIENT_CODES.has(code) &&
    attempt < maxRetries
  )
}

/** densable SVy — true when target exists and owner-write bit is clear (read-only) */
export function isOwnerWriteClearedSync(path: string): boolean {
  try {
    return (lstatSync(path).mode & OWNER_WRITE_BIT) === 0
  } catch {
    return false
  }
}

/** densable bVy */
export async function isOwnerWriteCleared(path: string): Promise<boolean> {
  try {
    return ((await lstat(path)).mode & OWNER_WRITE_BIT) === 0
  } catch {
    return false
  }
}

export type RenameFn = (from: string, to: string) => void
export type RenameAsyncFn = (from: string, to: string) => Promise<void>

/**
 * densable fIs — sync rename with transient retry + RO fail-fast.
 * Returns true if any retry sleep happened (densable `n` flag); callers ignore it.
 */
export function renameSyncWithRetry(
  from: string,
  to: string,
  renameFn: RenameFn = renameSync,
): boolean {
  let retried = false
  for (let attempt = 0; ; attempt++) {
    try {
      renameFn(from, to)
      return retried
    } catch (err) {
      if (isRenameRetryable(err, attempt)) {
        // densable: first retryable hit on a read-only target → throw immediately
        if (attempt === 0 && isOwnerWriteClearedSync(to)) {
          throw err
        }
        retried = true
        sleepSyncMs(RENAME_RETRY_SLEEP_MS)
        continue
      }
      throw err
    }
  }
}

/**
 * densable vVy/cw — async rename with the same RO fail-fast contract.
 * Returns true if any retry sleep happened.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  renameFn: RenameAsyncFn = rename,
  delays: readonly number[] = [
    RENAME_RETRY_SLEEP_MS,
    RENAME_RETRY_SLEEP_MS,
    RENAME_RETRY_SLEEP_MS,
  ],
): Promise<boolean> {
  let retried = false
  for (let attempt = 0; ; attempt++) {
    try {
      await renameFn(from, to)
      return retried
    } catch (err) {
      if (isRenameRetryable(err, attempt, delays.length)) {
        if (attempt === 0 && (await isOwnerWriteCleared(to))) {
          throw err
        }
        retried = true
        await sleepMs(delays[attempt] ?? RENAME_RETRY_SLEEP_MS)
        continue
      }
      throw err
    }
  }
}

/** Official 2.1.319 #1792 (`dfe`): async rename with [100, 500, 2000] ms backoff. */
export async function renameWithLongRetry(
  from: string,
  to: string,
  renameFn: RenameAsyncFn = rename,
): Promise<boolean> {
  return renameWithRetry(from, to, renameFn, RENAME_LONG_RETRY_DELAYS_MS)
}

/**
 * Official 2.1.319 #1792 (`_li`): async rename with adaptive extended backoff
 * (50ms initial, then [100, 200, 400] ms unless target previously timed out,
 * in which case falls back to [50, 50] ms).
 */
export async function renameWithAdaptiveRetry(
  from: string,
  to: string,
  renameFn: RenameAsyncFn = rename,
  skipExtended = false,
  sleepFn: (ms: number) => Promise<void> = sleepMs,
): Promise<void> {
  let useExtended = !skipExtended && !getTimedOutRenameTargets().has(to)
  try {
    await renameFn(from, to)
    return
  } catch (err) {
    if (!isRenameRetryable(err, 0, 1)) throw err
    try {
      if (((await lstat(to)).mode & OWNER_WRITE_BIT) === 0) throw err
    } catch (statErr) {
      if (statErr === err) throw err
      useExtended = useExtended && getErrnoCode(statErr) !== 'ENOENT'
    }
  }
  await sleepFn(RENAME_RETRY_SLEEP_MS)
  const delays = useExtended
    ? RENAME_EXTENDED_RETRY_DELAYS_MS
    : RENAME_FALLBACK_RETRY_DELAYS_MS
  for (let i = 0; ; i++) {
    try {
      await renameFn(from, to)
      return
    } catch (err) {
      if (!isRenameRetryable(err, i, delays.length)) {
        if (useExtended) recordTimedOutRenameTarget(err, to)
        throw err
      }
      await sleepFn(delays[i]!)
    }
  }
}

/**
 * Official 2.1.319 #1792 (`yli`): sync rename with adaptive extended backoff
 * (50ms initial, then [100, 200, 400] ms unless target previously timed out).
 */
export function renameSyncWithAdaptiveRetry(
  from: string,
  to: string,
  renameFn: RenameFn = renameSync,
  sleepFn: (ms: number) => void = sleepSyncMs,
): void {
  let useExtended = !getTimedOutRenameTargets().has(to)
  try {
    renameFn(from, to)
    return
  } catch (err) {
    if (!isRenameRetryable(err, 0, 1)) throw err
    try {
      if ((lstatSync(to).mode & OWNER_WRITE_BIT) === 0) throw err
    } catch (statErr) {
      if (statErr === err) throw err
      useExtended = useExtended && getErrnoCode(statErr) !== 'ENOENT'
    }
  }
  sleepFn(RENAME_RETRY_SLEEP_MS)
  const delays = useExtended
    ? RENAME_EXTENDED_RETRY_DELAYS_MS
    : RENAME_FALLBACK_RETRY_DELAYS_MS
  for (let i = 0; ; i++) {
    try {
      renameFn(from, to)
      return
    } catch (err) {
      if (!isRenameRetryable(err, i, delays.length)) {
        if (useExtended) recordTimedOutRenameTarget(err, to)
        throw err
      }
      sleepFn(delays[i]!)
    }
  }
}
