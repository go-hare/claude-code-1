/**
 * densable leftover write primitives from official `_800.js` / `_788.js`.
 *
 *   `_`  = `fbd` = `Pt` @205772364
 *   `Le` = `ebd` = `Dt` @205772302
 *   `ke` = `b8c` = `lr` @207227626
 *   `te` = `open` from `fs/promises` @207282665
 *   `ee` = `Q9c` = 0 @207224641
 *   `b`  = `R9c` = 0 @207225295
 *   `re` = `U` = 438 @207233816
 *   `B`/`L` = 384 @207233806
 *   `ne`/`R` = EINVAL|ENOTSUP|EPERM|ENOSYS @205771227
 */

import { randomBytes } from 'crypto'
import { constants as fsConstants } from 'fs'
import {
  type FileHandle,
  lstat,
  open,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import { getErrnoCode } from '../errors.js'

const RENAME_FALLBACK_CODES = new Set(['EXDEV', 'EPERM', 'EEXIST', 'EBUSY'])
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_MAX_ATTEMPTS = 4
const RENAME_RETRY_DELAY_MS = 50
const OWNER_WRITE_BIT = 128
const MAX_SNAPSHOT_BYTES = 67108864
const TEMP_NAME_MAX_ATTEMPTS = 3
/** densable leftover `L`/`B` @207233806. */
export const MODE_OWNER_RW = 384
/** densable leftover `re`=`U` @207233816. */
export const MODE_ALL_RW = 438

type FileSnapshot =
  | { kind: 'unavailable' }
  | { kind: 'absent' }
  | { kind: 'snapshot'; bytes: Uint8Array; mode: number }

export type AtomicWriteOptions = {
  mode?: number
  createMode?: number
  exactMode?: number
  flush?: boolean
  followSymlinks?: boolean
  inPlaceOnTempCreateRefused?: boolean
  renameFn?: (from: string, to: string) => Promise<void>
}

export type OpenResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: 'absent' } | { kind: 'fs'; error: unknown } }

function errnoOf(error: unknown): string | undefined {
  return getErrnoCode(error)
}

/** Official `writeFile(..., {encoding:"utf8"})`; Uint8Array drops encoding for types. */
function writeToHandle(
  handle: FileHandle,
  value: string | Uint8Array,
): Promise<void> {
  if (typeof value === 'string') {
    return handle.writeFile(value, { encoding: 'utf8' })
  }
  return handle.writeFile(value)
}

/** densable leftover `tid`=`s` sleep @204994714. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/** densable leftover `V` @205768800. */
function tempPathFor(path: string): string {
  return `${path}.tmp.${randomBytes(4).toString('hex')}`
}

/** densable leftover `R`=`abd`=`ne` @205771227. */
export function isUnsupportedFsOperation(error: unknown): boolean {
  const code = errnoOf(error)
  return (
    code === 'EINVAL' ||
    code === 'ENOTSUP' ||
    code === 'EPERM' ||
    code === 'ENOSYS'
  )
}

function shouldRetryRename(error: unknown, attempt: number): boolean {
  const code = errnoOf(error)
  return (
    code !== undefined &&
    RENAME_RETRY_CODES.has(code) &&
    attempt < RENAME_MAX_ATTEMPTS - 1
  )
}

async function isReadOnlyTarget(path: string): Promise<boolean> {
  try {
    return ((await lstat(path)).mode & OWNER_WRITE_BIT) === 0
  } catch {
    return false
  }
}

async function runWithRenameRetries(
  op: () => Promise<void>,
  dest: string | undefined,
): Promise<boolean> {
  let retried = false
  for (let attempt = 0; ; attempt++) {
    try {
      await op()
      return retried
    } catch (error) {
      if (shouldRetryRename(error, attempt)) {
        if (
          attempt === 0 &&
          dest !== undefined &&
          (await isReadOnlyTarget(dest))
        ) {
          throw error
        }
        retried = true
        await sleep(RENAME_RETRY_DELAY_MS)
        continue
      }
      throw error
    }
  }
}

/** densable leftover `Et` @205768800. */
function renameWithRetries(
  from: string,
  to: string,
  renameFn: (from: string, to: string) => Promise<void> = rename,
): Promise<boolean> {
  return runWithRenameRetries(() => renameFn(from, to), to)
}

/** densable leftover `q` @205768800 — official default platform is `"win32"`. */
async function isPlainFileOrAbsent(
  path: string,
  allowAbsent: boolean,
  platform = 'win32',
): Promise<boolean | undefined> {
  if (platform !== 'win32') return true
  try {
    return (await lstat(path)).isFile()
  } catch (error) {
    return allowAbsent && errnoOf(error) === 'ENOENT'
  }
}

/** densable leftover `St` @205770125. */
async function snapshotFile(
  path: string,
  follow = false,
): Promise<FileSnapshot> {
  if (!follow && !(await isPlainFileOrAbsent(path, true))) {
    return { kind: 'unavailable' }
  }
  let handle: FileHandle
  try {
    handle = await open(path, fsConstants.O_RDONLY)
  } catch (error) {
    return errnoOf(error) === 'ENOENT'
      ? { kind: 'absent' }
      : { kind: 'unavailable' }
  }
  try {
    const st = await handle.stat()
    if (!st.isFile() || st.size > MAX_SNAPSHOT_BYTES)
      return { kind: 'unavailable' }
    return {
      kind: 'snapshot',
      bytes: new Uint8Array(await handle.readFile()),
      mode: st.mode & 4095,
    }
  } catch {
    return { kind: 'unavailable' }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** densable leftover `Tt` @205770534. */
async function restoreSnapshot(
  path: string,
  snapshot: { bytes: Uint8Array; mode: number },
  follow = false,
): Promise<boolean> {
  if (!follow && !(await isPlainFileOrAbsent(path, true))) return false
  let handle: FileHandle
  try {
    handle = await open(path, 'w', snapshot.mode)
  } catch {
    return false
  }
  try {
    if (!(await handle.stat()).isFile()) {
      await handle.close().catch(() => undefined)
      return false
    }
    await handle.writeFile(snapshot.bytes)
    await handle.chmod(snapshot.mode).catch(() => undefined)
    await handle.close()
    return true
  } catch {
    await handle.close().catch(() => undefined)
    return false
  }
}

/** densable leftover `N` @205770534. */
function annotateTornWriteError(
  error: unknown,
  tmp: string | undefined,
  outcome: 'restored' | 'removed' | 'untouched' | 'partial',
): unknown {
  try {
    if (error instanceof Error) {
      const preserved =
        tmp !== undefined ? `new contents preserved at ${tmp}; ` : ''
      const tail =
        outcome === 'restored'
          ? 'original target restored'
          : outcome === 'removed'
            ? 'partial target removed'
            : outcome === 'untouched'
              ? 'target untouched'
              : 'target left partial — treat contents as torn'
      error.message = `${error.message}; ${preserved}${tail}`
      Object.assign(error, {
        ...(tmp !== undefined && { preservedTmp: tmp }),
        targetOutcome: outcome,
      })
    }
  } catch {
    // official N swallows annotate failures
  }
  return error
}

async function tempNameTakenOnWin32(
  path: string,
  platform: string,
): Promise<boolean | { cause: unknown }> {
  if (platform !== 'win32') return false
  try {
    await lstat(path)
    return true
  } catch (error) {
    return errnoOf(error) === 'ENOENT' ? false : { cause: error }
  }
}

function exclusiveCreateConflictError(
  path: string,
  extra?: { cause?: unknown },
): Error {
  return Object.assign(
    Error(
      'EEXIST: name already taken (exclusive create)',
      typeof extra === 'object' ? { cause: extra.cause } : undefined,
    ),
    { code: 'EEXIST', syscall: 'lstat', path },
  )
}

async function withFreshTempPath<T>(
  dest: string,
  platform: string,
  writeTmp: (tmp: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const tmp = tempPathFor(dest)
    const taken = await tempNameTakenOnWin32(tmp, platform)
    if (taken !== false) {
      if (attempt < TEMP_NAME_MAX_ATTEMPTS) continue
      throw exclusiveCreateConflictError(
        tmp,
        taken === true ? undefined : taken,
      )
    }
    try {
      return await writeTmp(tmp)
    } catch (error) {
      if (errnoOf(error) === 'EEXIST' && attempt < TEMP_NAME_MAX_ATTEMPTS)
        continue
      throw error
    }
  }
}

/** densable leftover `bt` @205771227. */
async function stageViaWriteFile(
  dest: string,
  value: string | Uint8Array,
  mode: number | undefined,
  platform = 'win32',
): Promise<string> {
  return withFreshTempPath(dest, platform, async tmp => {
    try {
      await writeFile(tmp, value, {
        ...(typeof value === 'string' ? { encoding: 'utf8' as const } : {}),
        mode,
        flag: 'wx',
      })
      return tmp
    } catch (error) {
      if (errnoOf(error) !== 'EEXIST') await unlink(tmp).catch(() => undefined)
      throw error
    }
  })
}

/** densable leftover `Ct` @205771227. */
async function stageViaOpenHandle(
  dest: string,
  mode: number | undefined,
  platform = 'win32',
): Promise<{ fh: FileHandle; tmp: string }> {
  return withFreshTempPath(dest, platform, async tmp => ({
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

function refuseNonRegularOpen(
  path: string,
  st: { isSymbolicLink: () => boolean },
): OpenResult<never> {
  const code = st.isSymbolicLink() ? 'ELOOP' : 'ENXIO'
  const message =
    code === 'ELOOP'
      ? 'refusing a symlinked path'
      : 'refusing a non-regular file'
  return {
    ok: false,
    error: {
      kind: 'fs',
      error: Object.assign(Error(message), { code, path }),
    },
  }
}

/**
 * densable leftover `ke`=`lr` @207227626.
 * Official `b`=`R9c`=0 — lstat gate, then `open(flags|0)`.
 *
 * 注意官方 `ke`（本函数）与 `Ke`（`storageLock` 的进程内锁 @207295455）只差
 * 大小写，是两个不同符号；按官方名反查时别混。
 */
export async function openRegularFile(
  path: string,
  flags: number,
  mode: number = MODE_OWNER_RW,
): Promise<OpenResult<FileHandle>> {
  let st: OpenResult<Awaited<ReturnType<typeof lstat>>>
  try {
    st = { ok: true, value: await lstat(path) }
  } catch (error) {
    st =
      errnoOf(error) === 'ENOENT'
        ? { ok: false, error: { kind: 'absent' } }
        : { ok: false, error: { kind: 'fs', error } }
  }
  if (!st.ok && st.error.kind !== 'absent') return st
  if (st.ok && !st.value.isFile()) return refuseNonRegularOpen(path, st.value)
  try {
    return { ok: true, value: await open(path, flags, mode) }
  } catch (error) {
    return errnoOf(error) === 'ENOENT'
      ? { ok: false, error: { kind: 'absent' } }
      : { ok: false, error: { kind: 'fs', error } }
  }
}

/**
 * densable leftover `Le`=`Dt` @205772302.
 *
 * 注意别名 `Dt` 有歧义：`writeValidate` 的 `Gi`/`Dt` @207297291 也叫 `Dt`，
 * 两者无关。按官方名反查时以主名 `Le` 为准。
 */
export async function atomicWriteFileWithMode(
  path: string,
  value: string | Uint8Array,
  mode: number | undefined,
  renameFn?: (from: string, to: string) => Promise<void>,
): Promise<void> {
  await atomicWriteFile(path, value, { mode, renameFn })
}

/**
 * densable leftover `_`=`Pt` @205772364.
 */
export async function atomicWriteFile(
  path: string,
  value: string | Uint8Array,
  opts: AtomicWriteOptions,
): Promise<void> {
  const mode = opts.mode
  const createMode = opts.createMode
  const exactMode = opts.exactMode
  const flush = opts.flush
  const follow = opts.followSymlinks
  const inPlaceOnTempCreateRefused = opts.inPlaceOnTempCreateRefused
  const renameFn = opts.renameFn
  const writeMode = mode ?? createMode
  let tmp: string | undefined
  let preserved = false
  let staged = false
  const inPlace = async (preserveTmp: string | undefined): Promise<void> => {
    const snap = await snapshotFile(path, follow === true)
    const snapshot = snap.kind === 'snapshot' ? snap : undefined
    const handle = await open(
      path,
      fsConstants.O_WRONLY | fsConstants.O_CREAT,
      exactMode ?? writeMode,
    )
    let st: Awaited<ReturnType<FileHandle['stat']>>
    try {
      st = await handle.stat()
    } catch (error) {
      await handle.close().catch(() => undefined)
      preserved = preserveTmp !== undefined
      throw annotateTornWriteError(error, preserveTmp, 'untouched')
    }
    const isChar = st.isCharacterDevice()
    if (!st.isFile() && !isChar) {
      await handle.close().catch(() => undefined)
      throw Object.assign(
        Error('refusing the in-place arm on a non-regular target'),
        { code: 'ENXIO', path },
      )
    }
    let truncated = false
    try {
      if (!isChar) {
        await handle.truncate(0)
        truncated = true
      }
      await writeToHandle(handle, value)
      const chmodTo = isChar
        ? undefined
        : (exactMode ?? (snap.kind !== 'absent' ? mode : undefined))
      if (chmodTo !== undefined)
        await handle.chmod(chmodTo).catch(() => undefined)
      if (flush === true) {
        try {
          await handle.sync()
        } catch (error) {
          if (!isUnsupportedFsOperation(error)) throw error
        }
      }
      await handle.close()
    } catch (error) {
      await handle.close().catch(() => undefined)
      if (!truncated) {
        preserved = preserveTmp !== undefined
        throw annotateTornWriteError(error, preserveTmp, 'untouched')
      }
      preserved = preserveTmp !== undefined
      const restored =
        snapshot !== undefined &&
        (await restoreSnapshot(path, snapshot, follow === true))
          ? 'restored'
          : await unlink(path).then(
              () => 'removed' as const,
              rmErr =>
                errnoOf(rmErr) === 'ENOENT'
                  ? ('removed' as const)
                  : ('partial' as const),
            )
      throw annotateTornWriteError(error, preserveTmp, restored)
    }
    const drop = preserveTmp ?? tmp
    if (drop !== undefined) await unlink(drop).catch(() => undefined)
  }
  try {
    try {
      if (exactMode !== undefined || flush === true) {
        const created = await stageViaOpenHandle(path, exactMode ?? writeMode)
        const handle = created.fh
        tmp = created.tmp
        let failed = false
        let writeErr: unknown
        try {
          await writeToHandle(handle, value)
          if (exactMode !== undefined) {
            try {
              await handle.chmod(exactMode)
            } catch (error) {
              if (!isUnsupportedFsOperation(error)) throw error
            }
          }
          if (flush === true) {
            try {
              await handle.sync()
            } catch (error) {
              if (!isUnsupportedFsOperation(error)) throw error
            }
          }
        } catch (error) {
          failed = true
          writeErr = error
        }
        if (!failed) staged = true
        try {
          await handle.close()
        } catch (error) {
          if (!failed) {
            preserved = true
            throw annotateTornWriteError(error, tmp, 'untouched')
          }
        }
        if (failed) throw writeErr
      } else {
        tmp = await stageViaWriteFile(path, value, writeMode)
        staged = true
      }
    } catch (error) {
      if (inPlaceOnTempCreateRefused !== true) throw error
      if (staged) throw error
      if (errnoOf(error) !== 'EACCES') throw error
      try {
        await stat(path)
      } catch {
        throw error
      }
      await inPlace(undefined)
      return
    }
    if (tmp === undefined) {
      throw Error('staging block exited without a staging file')
    }
    const stagedPath = tmp
    try {
      await renameWithRetries(stagedPath, path, renameFn)
    } catch (error) {
      const code = errnoOf(error)
      if (code === undefined || !RENAME_FALLBACK_CODES.has(code)) throw error
      await inPlace(stagedPath)
    }
  } catch (error) {
    if (tmp !== undefined && !preserved)
      await unlink(tmp).catch(() => undefined)
    throw error
  }
}
