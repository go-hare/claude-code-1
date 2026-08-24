/**
 * densable 2.1.216 — Symlink-safe durable writes (YNn / M6 / Fle).
 *
 * Used by scheduled-task writes (nWr) and dynamic workflow saves (L1a) so
 * project `.claude` (or intermediate path segments) cannot redirect writes
 * outside the repo via symlink.
 */

import { randomBytes } from 'crypto'
import {
  closeSync,
  constants as fsConstants,
  openSync,
  type PathLike,
} from 'fs'
import {
  lstat,
  mkdir,
  open,
  readlink,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'path'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { isENOENT } from './errors.js'
import {
  RENAME_INPLACE_FALLBACK_CODES,
  renameWithRetry as renameWithRetryShared,
} from './renameRetry.js'

/** densable Fle */
export class SymlinkWriteRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SymlinkWriteRefusedError'
  }
}

/** densable ukl — sandbox staging identity tamper (not used without sandbox map). */
export class StagingDirTamperedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StagingDirTamperedError'
  }
}

/** densable Bhe */
export const CLAUDE_ATOMIC_STAGING_LEAF = '.cc-writes'

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
const O_DIRECTORY = fsConstants.O_DIRECTORY ?? 0
const O_RDONLY = fsConstants.O_RDONLY
const O_WRONLY = fsConstants.O_WRONLY
const O_CREAT = fsConstants.O_CREAT
const O_EXCL = fsConstants.O_EXCL
const O_TRUNC = fsConstants.O_TRUNC

/** densable CQ — in-place fallback after rename fails (not the retry loop set) */
const RENAME_RETRY_CODES = RENAME_INPLACE_FALLBACK_CODES
const UNSUPPORTED_FS_CODES = new Set(['EINVAL', 'ENOTSUP', 'EPERM', 'ENOSYS'])

function errnoCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code
    return typeof c === 'string' ? c : undefined
  }
  return undefined
}

function isUnsupportedFsOp(err: unknown): boolean {
  const c = errnoCode(err)
  return c !== undefined && UNSUPPORTED_FS_CODES.has(c)
}

/**
 * densable VEt / Rfl — path is the Claude config home (user-scope), not a
 * project `.claude`. Config-dir writes skip chain guard + allow symlink.
 */
export function isClaudeConfigDirPath(p: string): boolean {
  const config = getClaudeConfigHomeDir()
  if (resolve(p) === resolve(config)) return true
  // densable Rfl: NFC-normalize via resolve + basename rejoin
  const nfc = (x: string): string => {
    const t = resolve(x)
    const parent = dirname(t)
    return join(parent, basename(t)).normalize('NFC')
  }
  return nfc(p) === nfc(config)
}

/**
 * densable YNn — open each path segment under `base` with
 * O_RDONLY|O_DIRECTORY|O_NOFOLLOW. ENOENT ends early (caller mkdir).
 * ELOOP/ENOTDIR → SymlinkWriteRefusedError.
 */
export async function assertDirChainReal(
  base: string,
  dir: string,
): Promise<void> {
  const rel = relative(base, dir)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `assertDirChainReal: dir must be strictly inside base (rel: ${rel})`,
    )
  }
  let cur = base
  const segments = rel.split(sep).filter(s => s.length > 0)
  for (const seg of segments) {
    cur = join(cur, seg)
    try {
      const fh = await open(cur, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
      await fh.close()
    } catch (err) {
      const code = errnoCode(err)
      if (code === 'ELOOP' || code === 'ENOTDIR') {
        throw new SymlinkWriteRefusedError(
          `Refusing to write under symlinked or non-directory path: ${cur}`,
        )
      }
      if (code === 'ENOENT' || isENOENT(err)) return
      throw err
    }
  }
}

/**
 * densable project `.claude` chain guard (YNn(root, root/.claude)).
 * Prefer this over realpath-escape-only checks.
 */
export async function assertProjectClaudeDirWritable(
  projectRoot: string,
): Promise<void> {
  await assertDirChainReal(projectRoot, join(projectRoot, '.claude'))
}

/** densable ckl — stage temp next to target or under stagingDir. */
function resolveAtomicTempPath(
  stagingDir: string | undefined,
  targetPath: string,
  tempSuffix: string,
  allowSymlink: boolean,
): string {
  const sibling = `${targetPath}${tempSuffix}`
  if (!stagingDir) return sibling

  // densable: allowSymlink + target parent ≠ staging parent → sibling fallback
  if (allowSymlink && dirname(targetPath) !== dirname(stagingDir)) {
    return sibling
  }

  const dirFlags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW
  try {
    const pd = openSync(dirname(stagingDir) as PathLike, dirFlags)
    closeSync(pd)
  } catch (err) {
    const code = errnoCode(err)
    if (code === 'ELOOP' || code === 'ENOTDIR') {
      if (allowSymlink) return sibling
      throw new SymlinkWriteRefusedError(
        `Refusing to stage atomic write under non-directory parent: ${dirname(stagingDir)}`,
      )
    }
    if (!isENOENT(err) && code !== 'ENOENT') throw err
    // parent of staging missing → sibling (mkdir later may create staging)
    return sibling
  }

  try {
    const sd = openSync(stagingDir as PathLike, dirFlags)
    closeSync(sd)
  } catch (err) {
    const code = errnoCode(err)
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') {
      return sibling
    }
    throw err
  }

  return join(stagingDir, `${basename(targetPath)}${tempSuffix}`)
}

/** densable cw/vVy via shared renameRetry (#51 RO fail-fast) */
async function renameWithRetry(from: string, to: string): Promise<void> {
  await renameWithRetryShared(from, to, rename)
}

export type WriteFileAndFlushOpts = {
  encoding?: BufferEncoding
  mode?: number
  /** densable allowSymlink — follow target symlink (config dir). Default false. */
  allowSymlink?: boolean
  /** densable checkParentDir — O_NOFOLLOW open of dirname. */
  checkParentDir?: boolean
  /** densable stagingDir — prefer atomic temp under this dir (e.g. .claude/.cc-writes). */
  stagingDir?: string
}

/**
 * densable M6 — atomic write with optional O_NOFOLLOW + parent check.
 */
export async function writeFileAndFlush(
  filePath: string,
  data: string | Buffer,
  opts: WriteFileAndFlushOpts = {},
): Promise<void> {
  const encoding = opts.encoding ?? 'utf-8'
  const allowSymlink = opts.allowSymlink ?? false
  const noFollow = allowSymlink ? 0 : O_NOFOLLOW
  let target = filePath
  let existingMode: number | undefined
  let hadExisting = false

  if (allowSymlink) {
    try {
      const link = await readlink(filePath)
      target = isAbsolute(link)
        ? link
        : resolve(await realpath(dirname(filePath)), link)
      logForDebugging(`Writing through symlink: ${filePath} -> ${target}`)
    } catch {
      // not a symlink or unreadable — write at filePath
    }
  } else {
    if (opts.checkParentDir) {
      try {
        const fh = await open(
          dirname(filePath),
          O_RDONLY | O_DIRECTORY | O_NOFOLLOW,
        )
        await fh.close()
      } catch (err) {
        const code = errnoCode(err)
        if (code === 'ELOOP' || code === 'ENOTDIR') {
          throw new SymlinkWriteRefusedError(
            `Refusing to write into symlinked directory: ${dirname(filePath)}`,
          )
        }
        // ENOENT parent: mkdir is caller's job for cron; rethrow others
        if (code !== 'ENOENT' && !isENOENT(err)) throw err
      }
    }
    try {
      const st = await lstat(filePath)
      if (st.isSymbolicLink()) {
        throw new SymlinkWriteRefusedError(
          `Refusing to write through symlink: ${filePath}. Resolve the symlink and pass the real target path explicitly.`,
        )
      }
      existingMode = st.mode
      hadExisting = true
    } catch (err) {
      if (!isENOENT(err) && errnoCode(err) !== 'ENOENT') throw err
    }
  }

  const tempSuffix = `.tmp.${process.pid}.${randomBytes(6).toString('hex')}`
  let tempPath = resolveAtomicTempPath(
    opts.stagingDir,
    target,
    tempSuffix,
    allowSymlink,
  )

  if (allowSymlink && !hadExisting) {
    try {
      const st = await stat(target)
      existingMode = st.mode
      hadExisting = true
    } catch (err) {
      if (!isENOENT(err) && errnoCode(err) !== 'ENOENT') throw err
    }
  }

  if (hadExisting && existingMode !== undefined) {
    logForDebugging(`Preserving file permissions: ${existingMode.toString(8)}`)
  } else if (opts.mode !== undefined) {
    existingMode = opts.mode
    logForDebugging(
      `Setting permissions for new file: ${existingMode.toString(8)}`,
    )
  }

  // Ensure staging dir exists when we plan to use it
  if (opts.stagingDir && dirname(tempPath) === resolve(opts.stagingDir)) {
    await mkdir(opts.stagingDir, { recursive: true, mode: 0o700 }).catch(
      () => {},
    )
    // re-resolve after mkdir
    tempPath = resolveAtomicTempPath(
      opts.stagingDir,
      target,
      tempSuffix,
      allowSymlink,
    )
  }

  let tempWritten = false
  try {
    logForDebugging(`Writing to temp file: ${tempPath}`)
    const openMode =
      !hadExisting && opts.mode !== undefined ? opts.mode : undefined
    const fh = await open(
      tempPath,
      O_WRONLY | O_CREAT | O_EXCL | noFollow,
      openMode,
    )
    let writeFailed = false
    let writeErr: unknown
    try {
      await fh.writeFile(data, { encoding })
      if (hadExisting && existingMode !== undefined) {
        try {
          await fh.chmod(existingMode)
          logForDebugging('Applied original permissions to temp file')
        } catch (err) {
          if (!isUnsupportedFsOp(err)) throw err
          logForDebugging(
            `fchmod unsupported on this filesystem: ${String(err)}`,
          )
        }
      }
      try {
        await fh.sync()
      } catch (err) {
        if (!isUnsupportedFsOp(err)) throw err
        logForDebugging(`fsync unsupported on this filesystem: ${String(err)}`)
      }
      tempWritten = true
    } catch (err) {
      writeFailed = true
      writeErr = err
    }
    try {
      await fh.close()
    } catch (err) {
      if (!writeFailed) throw err
      logForDebugging(
        `close also failed after temp write error: ${String(err)}`,
        { level: 'error' },
      )
    }
    if (writeFailed) throw writeErr

    logForDebugging(
      `Temp file written successfully, size: ${typeof data === 'string' ? data.length : data.length} bytes`,
    )
    logForDebugging(`Renaming ${tempPath} to ${target}`)
    await renameWithRetry(tempPath, target)
    logForDebugging(`File ${target} written atomically`)
  } catch (err) {
    logForDebugging(`Failed to write file atomically: ${String(err)}`, {
      level: 'error',
    })
    const code = errnoCode(err)
    const tryInPlace =
      (tempWritten && code !== undefined && RENAME_RETRY_CODES.has(code)) ||
      (!tempWritten && hadExisting && code === 'EACCES')

    if (tryInPlace) {
      let g: Awaited<ReturnType<typeof open>> | undefined
      try {
        g = await open(
          target,
          O_WRONLY | O_CREAT | O_TRUNC | noFollow,
          !hadExisting && opts.mode !== undefined ? opts.mode : undefined,
        )
      } catch (openErr) {
        try {
          await unlink(tempPath)
        } catch (cleanErr) {
          logForDebugging(`Failed to clean up temp file: ${String(cleanErr)}`)
        }
        if (errnoCode(openErr) === 'ELOOP') {
          throw new SymlinkWriteRefusedError(
            `Refusing to write through symlink: ${target} (O_NOFOLLOW)`,
          )
        }
        throw err
      }
      try {
        await g.writeFile(data, { encoding })
        try {
          await g.sync()
        } catch (syncErr) {
          if (!isUnsupportedFsOp(syncErr)) throw syncErr
          logForDebugging(
            `fsync unsupported on this filesystem: ${String(syncErr)}`,
          )
        }
        await g.close()
        try {
          await unlink(tempPath)
        } catch (cleanErr) {
          logForDebugging(`Failed to clean up temp file: ${String(cleanErr)}`)
        }
        logForDebugging(`File ${target} written via in-place fallback`)
        return
      } catch (writeErr) {
        try {
          await g.close()
        } catch {
          // ignore
        }
        try {
          await unlink(target)
        } catch {
          // ignore
        }
        if (tempWritten) {
          throw new Error(
            `Write to ${target} failed (${errnoCode(writeErr) ?? writeErr}) after the target was truncated. The new content was preserved at ${tempPath}.`,
          )
        }
        throw writeErr
      }
    }

    try {
      await unlink(tempPath)
    } catch (cleanErr) {
      logForDebugging(`Failed to clean up temp file: ${String(cleanErr)}`)
    }
    throw err
  }
}
