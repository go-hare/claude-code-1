/**
 * densable 2.1.239 od / KGo — exclusive staging write + rename, with the
 * official fallback arms (exactMode/flush, in-place truncate, snapshot restore).
 *
 * xWd publishes messaging keys via `od(path, json, 384)`.
 */

import { randomBytes } from 'crypto'
import { constants as fsConstants } from 'fs'
import { lstat, open, rename, stat, unlink, writeFile } from 'fs/promises'
import { getErrnoCode } from './errors.js'
import {
  RENAME_INPLACE_FALLBACK_CODES,
  renameWithRetry,
  type RenameAsyncFn,
} from './renameRetry.js'

/** densable VGo */
const STAGING_NAME_RETRIES = 3
/** densable o5u — TY_ refuses to snapshot larger targets */
export const ATOMIC_WRITE_SNAPSHOT_MAX_BYTES = 67_108_864
/** densable 4095 — mode bits kept on a snapshot */
const SNAPSHOT_MODE_MASK = 0o7777

export type AtomicWriteTargetOutcome =
  | 'untouched'
  | 'restored'
  | 'removed'
  | 'partial'

export type AtomicWriteSnapshot =
  | { kind: 'unavailable' }
  | { kind: 'absent' }
  | { kind: 'snapshot'; bytes: Uint8Array; mode: number }

export type KGoOptions = {
  mode?: number
  createMode?: number
  exactMode?: number
  flush?: boolean
  followSymlinks?: boolean
  inPlaceOnTempCreateRefused?: boolean
  renameFn?: RenameAsyncFn
}

/** densable j4e */
function stagingPathFor(target: string): string {
  return `${target}.tmp.${randomBytes(4).toString('hex')}`
}

/** densable B4e */
function isUnsupportedFsOp(error: unknown): boolean {
  const code = getErrnoCode(error)
  return (
    code === 'EINVAL' ||
    code === 'ENOTSUP' ||
    code === 'EPERM' ||
    code === 'ENOSYS'
  )
}

/**
 * densable Jer — annotate a torn/failed in-place write.
 * Em-dash in the partial clause is official (`\u2014`).
 */
export function annotateAtomicWriteError(
  error: unknown,
  preservedTmp: string | undefined,
  outcome: AtomicWriteTargetOutcome,
): unknown {
  try {
    if (error instanceof Error) {
      const preserved =
        preservedTmp !== undefined
          ? `new contents preserved at ${preservedTmp}; `
          : ''
      const outcomeText =
        outcome === 'restored'
          ? 'original target restored'
          : outcome === 'removed'
            ? 'partial target removed'
            : outcome === 'untouched'
              ? 'target untouched'
              : 'target left partial — treat contents as torn'
      error.message = `${error.message}; ${preserved}${outcomeText}`
      Object.assign(error, {
        ...(preservedTmp !== undefined ? { preservedTmp } : {}),
        targetOutcome: outcome,
      })
    }
  } catch {
    // official Jer swallows annotate failures
  }
  return error
}

/** densable a5u — win32 exclusive-create name is taken. */
async function isWin32StagingNameTaken(
  path: string,
  platform: string = process.platform,
): Promise<boolean | { cause: unknown }> {
  if (platform !== 'win32') return false
  try {
    await lstat(path)
    return true
  } catch (error) {
    return getErrnoCode(error) === 'ENOENT' ? false : { cause: error }
  }
}

/** densable VZs */
function exclusiveCreateNameTaken(
  path: string,
  taken: boolean | { cause: unknown },
): Error {
  return Object.assign(
    new Error(
      'EEXIST: name already taken (exclusive create)',
      typeof taken === 'object' ? { cause: taken.cause } : undefined,
    ),
    { code: 'EEXIST', syscall: 'lstat', path },
  )
}

/**
 * densable i5u — on win32, snapshot/restore only if the target is a regular
 * file (or missing when `allowMissing`). Other platforms skip the check.
 */
async function isWin32RegularOrMissing(
  path: string,
  allowMissing: boolean,
  platform: string = process.platform,
): Promise<boolean> {
  if (platform !== 'win32') return true
  try {
    return (await lstat(path)).isFile()
  } catch (error) {
    return allowMissing && getErrnoCode(error) === 'ENOENT'
  }
}

/** densable l5u */
async function withExclusiveStagingName<T>(
  target: string,
  platform: string,
  write: (tmp: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const tmp = stagingPathFor(target)
    const taken = await isWin32StagingNameTaken(tmp, platform)
    if (taken !== false) {
      if (attempt < STAGING_NAME_RETRIES) continue
      throw exclusiveCreateNameTaken(tmp, taken)
    }
    try {
      return await write(tmp)
    } catch (error) {
      if (getErrnoCode(error) === 'EEXIST' && attempt < STAGING_NAME_RETRIES) {
        continue
      }
      throw error
    }
  }
}

/** densable FDn */
async function writeStagingWx(
  target: string,
  data: string,
  mode: number | undefined,
  platform: string = process.platform,
): Promise<string> {
  return withExclusiveStagingName(target, platform, async tmp => {
    try {
      await writeFile(tmp, data, {
        encoding: 'utf8',
        mode,
        flag: 'wx',
      })
      return tmp
    } catch (error) {
      if (getErrnoCode(error) !== 'EEXIST') {
        await unlink(tmp).catch(() => {})
      }
      throw error
    }
  })
}

/** densable CY_ — exclusive staging handle for exactMode / flush. */
async function openStagingExclusive(
  target: string,
  mode: number | undefined,
  platform: string = process.platform,
): Promise<{ fh: Awaited<ReturnType<typeof open>>; tmp: string }> {
  return withExclusiveStagingName(target, platform, async tmp => ({
    fh: await open(
      tmp,
      platform === 'win32'
        ? 'wx'
        : fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      mode,
    ),
    tmp,
  }))
}

/** densable TY_ */
export async function snapshotAtomicWriteTarget(
  path: string,
  followSymlinks = false,
): Promise<AtomicWriteSnapshot> {
  if (!followSymlinks && !(await isWin32RegularOrMissing(path, true))) {
    return { kind: 'unavailable' }
  }
  let fh
  try {
    fh = await open(path, fsConstants.O_RDONLY)
  } catch (error) {
    return getErrnoCode(error) === 'ENOENT'
      ? { kind: 'absent' }
      : { kind: 'unavailable' }
  }
  try {
    const st = await fh.stat()
    if (!st.isFile() || st.size > ATOMIC_WRITE_SNAPSHOT_MAX_BYTES) {
      return { kind: 'unavailable' }
    }
    return {
      kind: 'snapshot',
      bytes: new Uint8Array(await fh.readFile()),
      mode: st.mode & SNAPSHOT_MODE_MASK,
    }
  } catch {
    return { kind: 'unavailable' }
  } finally {
    await fh.close().catch(() => {})
  }
}

/** densable kY_ */
export async function restoreAtomicWriteSnapshot(
  path: string,
  snapshot: Extract<AtomicWriteSnapshot, { kind: 'snapshot' }>,
  followSymlinks = false,
): Promise<boolean> {
  if (!followSymlinks && !(await isWin32RegularOrMissing(path, true))) {
    return false
  }
  let fh
  try {
    fh = await open(path, 'w', snapshot.mode)
  } catch {
    return false
  }
  try {
    if (!(await fh.stat()).isFile()) {
      await fh.close().catch(() => {})
      return false
    }
    await fh.writeFile(snapshot.bytes)
    await fh.chmod(snapshot.mode).catch(() => {})
    await fh.close()
    return true
  } catch {
    await fh.close().catch(() => {})
    return false
  }
}

async function targetExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

/**
 * densable KGo — wx (or exactMode/flush handle) staging, kw rename, then
 * in-place truncate + snapshot restore when rename hits AZ.
 */
export async function KGo(
  target: string,
  data: string,
  options: KGoOptions = {},
): Promise<void> {
  const {
    mode,
    createMode,
    exactMode,
    flush,
    followSymlinks,
    inPlaceOnTempCreateRefused,
    renameFn,
  } = options
  const createOrMode = mode ?? createMode
  let stagingPath: string | undefined
  let keepStaging = false
  let stagingComplete = false

  const writeInPlace = async (preserveFrom?: string): Promise<void> => {
    const snap = await snapshotAtomicWriteTarget(
      target,
      followSymlinks === true,
    )
    const snapshot = snap.kind === 'snapshot' ? snap : undefined
    const fh = await open(
      target,
      fsConstants.O_WRONLY | fsConstants.O_CREAT,
      exactMode ?? createOrMode,
    )
    let st
    try {
      st = await fh.stat()
    } catch (error) {
      await fh.close().catch(() => {})
      keepStaging = preserveFrom !== undefined
      throw annotateAtomicWriteError(error, preserveFrom, 'untouched')
    }
    const isChar = st.isCharacterDevice()
    if (!st.isFile() && !isChar) {
      await fh.close().catch(() => {})
      throw Object.assign(
        new Error('refusing the in-place arm on a non-regular target'),
        { code: 'ENXIO', path: target },
      )
    }
    let truncated = false
    try {
      if (!isChar) {
        await fh.truncate(0)
        truncated = true
      }
      await fh.writeFile(data, { encoding: 'utf8' })
      const chmodMode = isChar
        ? undefined
        : (exactMode ?? (snap.kind !== 'absent' ? mode : undefined))
      if (chmodMode !== undefined) {
        await fh.chmod(chmodMode).catch(() => {})
      }
      if (flush === true) {
        try {
          await fh.sync()
        } catch (error) {
          if (!isUnsupportedFsOp(error)) throw error
        }
      }
      await fh.close()
    } catch (error) {
      await fh.close().catch(() => {})
      if (!truncated) {
        keepStaging = preserveFrom !== undefined
        throw annotateAtomicWriteError(error, preserveFrom, 'untouched')
      }
      keepStaging = preserveFrom !== undefined
      const restored =
        snapshot !== undefined &&
        (await restoreAtomicWriteSnapshot(
          target,
          snapshot,
          followSymlinks === true,
        ))
      const outcome: AtomicWriteTargetOutcome = restored
        ? 'restored'
        : (await unlink(target).then(
              () => true,
              err => getErrnoCode(err) === 'ENOENT',
            ))
          ? 'removed'
          : 'partial'
      throw annotateAtomicWriteError(error, preserveFrom, outcome)
    }
    const leftover = preserveFrom ?? stagingPath
    if (leftover !== undefined) {
      await unlink(leftover).catch(() => {})
    }
  }

  try {
    try {
      if (exactMode !== undefined || flush === true) {
        const opened = await openStagingExclusive(
          target,
          exactMode ?? createOrMode,
        )
        const fh = opened.fh
        stagingPath = opened.tmp
        let writeFailed = false
        let writeError: unknown
        try {
          await fh.writeFile(data, { encoding: 'utf8' })
          if (exactMode !== undefined) {
            try {
              await fh.chmod(exactMode)
            } catch (error) {
              if (!isUnsupportedFsOp(error)) throw error
            }
          }
          if (flush === true) {
            try {
              await fh.sync()
            } catch (error) {
              if (!isUnsupportedFsOp(error)) throw error
            }
          }
        } catch (error) {
          writeFailed = true
          writeError = error
        }
        if (!writeFailed) stagingComplete = true
        try {
          await fh.close()
        } catch (error) {
          if (!writeFailed) {
            keepStaging = true
            throw annotateAtomicWriteError(error, stagingPath, 'untouched')
          }
        }
        if (writeFailed) throw writeError
      } else {
        stagingPath = await writeStagingWx(target, data, createOrMode)
        stagingComplete = true
      }
    } catch (error) {
      if (inPlaceOnTempCreateRefused !== true) throw error
      if (stagingComplete) throw error
      if (getErrnoCode(error) !== 'EACCES') throw error
      if (!(await targetExists(target))) throw error
      await writeInPlace(undefined)
      return
    }
    if (stagingPath === undefined) {
      throw new Error('staging block exited without a staging file')
    }
    const staged = stagingPath
    try {
      await renameWithRetry(staged, target, renameFn ?? rename)
    } catch (error) {
      const code = getErrnoCode(error)
      if (code === undefined || !RENAME_INPLACE_FALLBACK_CODES.has(code)) {
        throw error
      }
      await writeInPlace(staged)
    }
  } catch (error) {
    if (stagingPath !== undefined && !keepStaging) {
      await unlink(stagingPath).catch(() => {})
    }
    throw error
  }
}

/** densable od(path, data, mode, renameFn) → KGo({mode, renameFn}) */
export async function od(
  path: string,
  data: string,
  mode?: number,
  renameFn?: RenameAsyncFn,
): Promise<void> {
  return KGo(path, data, { mode, renameFn })
}
