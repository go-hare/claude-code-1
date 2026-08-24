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

/** densable ulu */
export function isRenameRetryable(err: unknown, attempt: number): boolean {
  const code = getErrnoCode(err)
  return (
    code !== undefined &&
    RENAME_TRANSIENT_CODES.has(code) &&
    attempt < RENAME_MAX_ATTEMPTS - 1
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
): Promise<boolean> {
  let retried = false
  for (let attempt = 0; ; attempt++) {
    try {
      await renameFn(from, to)
      return retried
    } catch (err) {
      if (isRenameRetryable(err, attempt)) {
        if (attempt === 0 && (await isOwnerWriteCleared(to))) {
          throw err
        }
        retried = true
        await sleepMs(RENAME_RETRY_SLEEP_MS)
        continue
      }
      throw err
    }
  }
}
