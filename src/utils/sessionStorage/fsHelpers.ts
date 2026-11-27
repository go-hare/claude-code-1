import { logForDebugging } from '../debug.js'
import { isDisklessActive, logDisklessWriteSkipped } from '../disklessGuards.js'
import { isENOENT, isFsInaccessible } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { isPersistenceSuppressed } from '../sessionPersistenceStatus.js'
import { LITE_READ_BUF_SIZE } from '../sessionStoragePortable.js'
import { jsonStringify } from '../slowOperations.js'
import {
  recordTranscriptWriteFailure,
  recordTranscriptWriteSuccess,
} from '../transcriptWriterHealth.js'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readSync,
  writeSync,
} from 'fs'
import {
  appendFile as fsAppendFile,
  copyFile as fsCopyFile,
  lutimes as fsLutimes,
  open as fsOpen,
  rename as fsRename,
  rm as fsRm,
  mkdir,
  readdir,
  stat,
  unlink,
} from 'fs/promises'
import { dirname, join } from 'path'
import type { FileTailWindow } from './types.js'
import { getErrnoCode, recordTranscriptFullDiskError } from './sessionState.js'

/** densable II — async last-N-bytes read. */
export async function readFileTailAsync(
  fullPath: string,
  maxBytes: number = LITE_READ_BUF_SIZE,
): Promise<FileTailWindow | null> {
  if (isDisklessActive()) return null
  try {
    const st = await stat(fullPath)
    if (st.size === 0) {
      return { content: '', bytesRead: 0, bytesTotal: 0 }
    }
    const offset = Math.max(0, st.size - maxBytes)
    const len = st.size - offset
    const fh = await fsOpen(fullPath, 'r')
    try {
      const buf = Buffer.allocUnsafe(len)
      let filled = 0
      while (filled < len) {
        const { bytesRead } = await fh.read(
          buf,
          filled,
          len - filled,
          offset + filled,
        )
        if (bytesRead === 0) break
        filled += bytesRead
      }
      return {
        content: buf.toString('utf8', 0, filled),
        bytesRead: filled,
        bytesTotal: st.size,
      }
    } finally {
      await fh.close()
    }
  } catch {
    return null
  }
}

/**
 * Official 2.1.323 #2064 / #2138 (`m3e`): fsync the parent directory after an
 * atomic rename so rewritten cloud/local session transcripts survive sudden
 * container stops or NFS/FUSE power loss. Best-effort on filesystems that do
 * not support directory fsync (EINVAL/EBADF/EISDIR/EPERM/ENOTSUP/ENOSYS).
 */
export async function fsyncDirBestEffort(filePath: string): Promise<void> {
  if (isDisklessActive()) return
  const dir = dirname(filePath)
  let dirHandle: Awaited<ReturnType<typeof fsOpen>> | undefined
  try {
    dirHandle = await fsOpen(dir, 'r')
    await dirHandle.sync()
  } catch {
    // Directory fsync is unsupported on some platforms/filesystems (e.g. Windows, FUSE)
  } finally {
    if (dirHandle !== undefined) {
      await dirHandle.close().catch(() => {})
    }
  }
}

/**
 * Official 2.1.323 #2064 / #2138 (`W4t` + `m3e`): atomically write a file via
 * exclusive temp file + fsync + rename + parent-dir fsync so sudden container
 * stops or NFS/FUSE errors never leave a truncated or unreadable transcript.
 */
export async function writeFileAtomicDurably(
  fullPath: string,
  content: string,
  mode = 0o600,
): Promise<void> {
  if (isDisklessActive()) {
    logDisklessWriteSkipped('sessionStorage:writeFileAtomicDurably', fullPath)
    return
  }
  const tmpPath = `${fullPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  let handle: Awaited<ReturnType<typeof fsOpen>> | undefined
  let renamed = false
  try {
    handle = await fsOpen(tmpPath, 'wx', mode)
    await handle.writeFile(content, 'utf8')
    try {
      await handle.sync()
    } catch {
      // Some FUSE/virtual filesystems reject fsync on regular files
    }
    await handle.close()
    handle = undefined
    await fsRename(tmpPath, fullPath)
    renamed = true
    await fsyncDirBestEffort(fullPath)
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => {})
    }
    if (!renamed) {
      await unlink(tmpPath).catch(() => {})
    }
  }
}

/**
 * Official 2.1.323 #2064 (`qma`): read exactly `length` bytes from `fh` at
 * `position`, looping over short reads (common on NFS/FUSE). Returns `false`
 * if EOF is hit before `length` bytes are read.
 */
export async function readExactFromHandle(
  fh: Awaited<ReturnType<typeof fsOpen>>,
  buf: Buffer,
  length: number,
  position: number,
): Promise<boolean> {
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await fh.read(
      buf,
      offset,
      length - offset,
      position + offset,
    )
    if (bytesRead <= 0) return false
    offset += bytesRead
  }
  return true
}

/**
 * Official 2.1.323 #2064 (`sGs`): write all bytes of `buf` to `fh` at
 * `position` (or current offset when `null`), looping over short writes.
 */
export async function writeExactToHandle(
  fh: Awaited<ReturnType<typeof fsOpen>>,
  buf: Buffer,
  position: number | null,
): Promise<void> {
  let offset = 0
  while (offset < buf.byteLength) {
    const { bytesWritten } = await fh.write(
      buf,
      offset,
      buf.byteLength - offset,
      position === null ? null : position + offset,
    )
    if (bytesWritten <= 0) {
      throw Object.assign(new Error('write made no progress'), { code: 'EIO' })
    }
    offset += bytesWritten
  }
}

/** densable e4e / ves — write or append payload lines as jsonl. */
export async function writeTranscriptPayloads(
  fullPath: string,
  payloads: Record<string, unknown>[],
  mode: 'w' | 'a',
): Promise<void> {
  if (isDisklessActive()) {
    logDisklessWriteSkipped('sessionStorage:writeTranscriptPayloads', fullPath)
    return
  }
  if (mode === 'w') {
    const body = payloads.map(p => jsonStringify(p) + '\n').join('')
    // Official 2.1.323 #2138: atomic temp + fsync + rename + dir fsync so a
    // cloud container stopping right after rewrite never leaves unreadable history.
    await writeFileAtomicDurably(fullPath, body, 0o600)
    return
  }
  if (payloads.length === 0) return
  const body = payloads.map(p => jsonStringify(p) + '\n').join('')
  await fsAppendFile(fullPath, body, { encoding: 'utf8', mode: 0o600 })
}

/**
 * densable xZd — rename with EXDEV/EEXIST fallbacks (file or directory tree).
 */
export async function renamePathWithCrossDeviceFallback(
  from: string,
  to: string,
): Promise<void> {
  if (isDisklessActive()) {
    logDisklessWriteSkipped(
      'sessionStorage:renamePathWithCrossDeviceFallback',
      to,
    )
    return
  }
  try {
    await fsRename(from, to)
    return
  } catch (err) {
    const code = getErrnoCode(err)
    if (
      code === 'EEXIST' ||
      code === 'EPERM' ||
      code === 'EBUSY' ||
      code === 'ENOTEMPTY'
    ) {
      await fsRm(to, { recursive: true, force: true }).catch(() => {})
      await fsRename(from, to)
      return
    }
    if (code === 'EXDEV') {
      try {
        await fsCopyFile(from, to)
      } catch (copyErr) {
        const copyCode = getErrnoCode(copyErr)
        if (
          copyCode === 'EISDIR' ||
          copyCode === 'ENOTSUP' ||
          copyCode === 'EPERM'
        ) {
          await copyDirRecursive(from, to)
        } else {
          throw copyErr
        }
      }
      await fsRm(from, { recursive: true, force: true })
      return
    }
    throw err
  }
}

async function copyDirRecursive(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true, mode: 0o700 })
  for (const ent of await readdir(from, { withFileTypes: true })) {
    const src = join(from, ent.name)
    const dst = join(to, ent.name)
    if (ent.isDirectory()) {
      await copyDirRecursive(src, dst)
    } else {
      await fsCopyFile(src, dst)
    }
  }
}

/**
 * densable tryAppend (pdn) — append a string to a file; returns false on missing.
 */
export async function tryAppendRaw(
  filePath: string,
  data: string,
): Promise<boolean> {
  if (isDisklessActive()) {
    logDisklessWriteSkipped('sessionStorage:tryAppendRaw', filePath)
    return false
  }
  try {
    await fsAppendFile(filePath, data, { mode: 0o600 })
    recordTranscriptWriteSuccess(filePath)
    return true
  } catch (firstErr) {
    if (isFsInaccessible(firstErr)) return false
    try {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
      await fsAppendFile(filePath, data, { mode: 0o600 })
      recordTranscriptWriteSuccess(filePath)
      return true
    } catch (secondErr) {
      if (isFsInaccessible(secondErr)) return false
      throw secondErr
    }
  }
}

/**
 * densable `dpe` — HA(rename) the existing same-id dest to `.superseded-<ts>`
 * before relocate. Y(ENOENT) → undefined. DVt(lutimes) refreshes mtime so
 * the set-aside does not age from its old clock. `isRetentionExemptionDisabled`
 * (Vjn) is ABSENT — lutimes is the gold default arm (`if (!r())`).
 */
export async function setAsideExistingTranscript(
  targetFile: string,
): Promise<string | undefined> {
  if (isDisklessActive()) return
  const aside = `${targetFile}.superseded-${Date.now()}`
  try {
    await fsRename(targetFile, aside)
  } catch (e) {
    if (isENOENT(e)) return
    throw e
  }
  const now = new Date()
  await fsLutimes(aside, now, now).catch(err => {
    logForDebugging(
      `relocateSessionTranscript: could not refresh the set-aside's mtime at ${aside} (it ages from its old clock): ${err}`,
      { level: 'warn' },
    )
  })
  logForDebugging(
    `relocateSessionTranscript: existing destination set aside at ${aside}`,
    { level: 'warn' },
  )
  return aside
}

/**
 * Append an entry to a session file. Creates the parent dir if missing.
 */
/* eslint-disable custom-rules/no-sync-fs -- sync callers (exit cleanup, materialize) */
export function appendEntryToFile(
  fullPath: string,
  entry: Record<string, unknown>,
): void {
  if (isDisklessActive()) {
    logDisklessWriteSkipped('sessionStorage:appendEntryToFile', fullPath)
    return
  }
  const fs = getFsImplementation()
  const line = jsonStringify(entry) + '\n'
  try {
    fs.appendFileSync(fullPath, line, { mode: 0o600 })
    recordTranscriptWriteSuccess(fullPath)
  } catch (firstErr) {
    try {
      fs.mkdirSync(dirname(fullPath), { mode: 0o700 })
      fs.appendFileSync(fullPath, line, { mode: 0o600 })
      recordTranscriptWriteSuccess(fullPath)
    } catch (secondErr) {
      // densable iNt — materialize/metadata path
      recordTranscriptFullDiskError(secondErr ?? firstErr, fullPath)
      recordTranscriptWriteFailure(
        'materialize',
        secondErr ?? firstErr,
        fullPath,
      )
      throw secondErr
    }
  }
}

/**
 * Official `I4` — sync append only into an existing, non-empty transcript file.
 * Opens with O_RDWR | O_APPEND (no O_CREAT), returning silently on ENOENT/ENOTDIR
 * or size === 0 so exit re-stamp never recreates a deleted transcript (#1635).
 */
export function appendEntryToExistingFileSync(
  fullPath: string,
  entry: Record<string, unknown>,
): void {
  if (isPersistenceSuppressed() || isDisklessActive()) return
  const line = jsonStringify(entry) + '\n'
  let fd: number
  try {
    fd = openSync(fullPath, fsConstants.O_RDWR | fsConstants.O_APPEND)
  } catch (err) {
    const code = getErrnoCode(err)
    if (code === 'ENOENT' || code === 'ENOTDIR') return
    throw err
  }
  try {
    const { size } = fstatSync(fd)
    if (size === 0) return
    const tailBuf = Buffer.alloc(1)
    const bytesRead = readSync(fd, tailBuf, 0, 1, size - 1)
    const needsNewline = bytesRead === 1 && tailBuf[0] !== 10
    const payload = Buffer.from(needsNewline ? `\n${line}` : line, 'utf8')
    let written = 0
    while (written < payload.length) {
      const n = writeSync(fd, payload, written, payload.length - written)
      if (n <= 0) {
        throw new Error('appendEntryToExistingFileSync: short write')
      }
      written += n
    }
    recordTranscriptWriteSuccess(fullPath)
  } catch (err) {
    recordTranscriptFullDiskError(err, fullPath)
    throw err
  } finally {
    closeSync(fd)
  }
}

/**
 * Sync tail read for reAppendSessionMetadata's external-writer check.
 * fstat on the already-open fd (no extra path lookup); reads the same
 * LITE_READ_BUF_SIZE window that readLiteMetadata scans. Returns empty
 * string on any error so callers fall through to unconditional behavior.
 */
export function readFileTailSync(fullPath: string): string {
  if (isDisklessActive()) return ''
  let fd: number | undefined
  try {
    fd = openSync(fullPath, 'r')
    const st = fstatSync(fd)
    const tailOffset = Math.max(0, st.size - LITE_READ_BUF_SIZE)
    const buf = Buffer.allocUnsafe(
      Math.min(LITE_READ_BUF_SIZE, st.size - tailOffset),
    )
    const bytesRead = readSync(fd, buf, 0, buf.length, tailOffset)
    return buf.toString('utf8', 0, bytesRead)
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // closeSync can throw; swallow to preserve return '' contract
      }
    }
  }
}

/**
 * densable leftover `pto` — FS line scan for `h4t`/`UXs` when `uE` misses.
 * Missing file yields empty (clean), not throw.
 */
export async function* iterateTranscriptFileLines(
  filePath: string,
): AsyncGenerator<string> {
  const { createReadStream } = await import('fs')
  const { createInterface } = await import('readline')
  try {
    const stream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      yield line
    }
  } catch (err) {
    if (isENOENT(err)) return
    throw err
  }
}

export function hasTornTailSync(filePath: string): boolean {
  if (isDisklessActive()) return false
  let fd: number | undefined
  try {
    fd = openSync(filePath, 'r')
    const { size } = fstatSync(fd)
    if (size === 0) return false
    const buf = Buffer.alloc(1)
    const bytesRead = readSync(fd, buf, 0, 1, size - 1)
    return bytesRead === 1 && buf[0] !== 0x0a
  } catch {
    return false
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // ignore close error
      }
    }
  }
}

/** densable yAr — true when empty or final byte on disk is `\n`. */
export async function fileEndsWithNewline(
  filePath: string,
  size: number,
): Promise<boolean> {
  if (size === 0 || isDisklessActive()) return true
  const handle = await fsOpen(filePath, 'r')
  try {
    const buf = Buffer.alloc(1)
    const { bytesRead } = await handle.read(buf, 0, 1, size - 1)
    return bytesRead === 1 && buf[0] === 0x0a
  } finally {
    await handle.close()
  }
}
