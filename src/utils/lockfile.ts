/**
 * Lazy accessor for proper-lockfile.
 *
 * proper-lockfile depends on graceful-fs, which monkey-patches every fs
 * method on first require (~8ms). Static imports of proper-lockfile pull this
 * cost into the startup path even when no locking happens (e.g. `--help`).
 *
 * Import this module instead of `proper-lockfile` directly. The underlying
 * package is only loaded the first time a lock function is actually called.
 */

import * as nodeFs from 'fs'
import type { CheckOptions, LockOptions, UnlockOptions } from 'proper-lockfile'

type Lockfile = typeof import('proper-lockfile')

let _lockfile: Lockfile | undefined

/**
 * Official 2.1.326 (#60): error codes returned when a filesystem (e.g. SMB,
 * FUSE, exFAT, corporate network drive) rejects `utimes` on lock directories.
 */
export const TIMESTAMP_REJECTION_ERRNO_CODES = new Set([
  'EPERM',
  'EACCES',
  'EINVAL',
  'ENOSYS',
  'EROFS',
  'ENOTSUP',
  'EOPNOTSUPP',
])

export function isTimestampRejectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' && TIMESTAMP_REJECTION_ERRNO_CODES.has(code)
}

/**
 * Official 2.1.326 (#60): wrap `fs.utimes` / `fs.utimesSync` for
 * `proper-lockfile` so a drive that rejects modifying folder timestamps does
 * not break lock acquisition, token refresh, or `claude auth logout`.
 */
export function createTimestampTolerantLockFs(
  baseFs: typeof nodeFs = nodeFs,
): typeof nodeFs {
  const origUtimes = baseFs.utimes.bind(baseFs)
  const origUtimesSync = baseFs.utimesSync.bind(baseFs)

  const utimes = ((
    path: nodeFs.PathLike,
    atime: nodeFs.TimeLike,
    mtime: nodeFs.TimeLike,
    callback: nodeFs.NoParamCallback,
  ) => {
    origUtimes(path, atime, mtime, err => {
      if (err && isTimestampRejectionError(err)) {
        callback(null)
        return
      }
      callback(err)
    })
  }) as typeof nodeFs.utimes

  const utimesSync = ((
    path: nodeFs.PathLike,
    atime: nodeFs.TimeLike,
    mtime: nodeFs.TimeLike,
  ) => {
    try {
      origUtimesSync(path, atime, mtime)
    } catch (err) {
      if (isTimestampRejectionError(err)) {
        return
      }
      throw err
    }
  }) as typeof nodeFs.utimesSync

  // Use a plain object clone (not `Object.create(baseFs)`): ESM namespace
  // objects like `import * as nodeFs from 'fs'` have non-writable getters, so
  // property assignment on `Object.create(nodeFs)` throws in strict mode.
  return {
    ...baseFs,
    utimes,
    utimesSync,
  }
}

let _tolerantFs: typeof nodeFs | undefined

function getTolerantFs(): typeof nodeFs {
  if (!_tolerantFs) {
    _tolerantFs = createTimestampTolerantLockFs(nodeFs)
  }
  return _tolerantFs
}

function withTolerantFs<T extends { fs?: unknown }>(options?: T): T {
  if (options && options.fs !== undefined) {
    return options
  }
  return { ...(options ?? ({} as T)), fs: getTolerantFs() }
}

function getLockfile(): Lockfile {
  if (!_lockfile) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _lockfile = require('proper-lockfile') as Lockfile
  }
  return _lockfile
}

export function lock(
  file: string,
  options?: LockOptions,
): Promise<() => Promise<void>> {
  return getLockfile().lock(file, withTolerantFs(options))
}

export function lockSync(file: string, options?: LockOptions): () => void {
  return getLockfile().lockSync(file, withTolerantFs(options))
}

export function unlock(file: string, options?: UnlockOptions): Promise<void> {
  return getLockfile().unlock(file, withTolerantFs(options))
}

export function check(file: string, options?: CheckOptions): Promise<boolean> {
  return getLockfile().check(file, withTolerantFs(options))
}
