/**
 * densable `_465` `Kt` / `Ei` / `Si` / `qt`.
 * Gold: gold-forged-Kt.txt
 */

import { lstat, mkdir, open, readlink, unlink } from 'fs/promises'
import { dirname, join } from 'path'
import { uniq } from '../array.js'
import { getErrnoCode } from '../errors.js'
import { seedPathSegmentsOk } from './seedPathClassify.js'
import { seedAncestorHopState } from './seedPathHop.js'
import { seedPoolMap } from './seedWipPool.js'

const POOL = 8
const COPY_BUF = 1_048_576

export type SeedStageCopy = {
  ino: number
  dev: number
  ctimeMs: number
  size: number
}

export type SeedStageEntry =
  | { kind: 'absent'; path: string }
  | { kind: 'hardlinked'; path: string }
  | { kind: 'changed'; path: string }
  | { kind: 'symlink'; path: string; target: Buffer }
  | { kind: 'file'; path: string; bytes: number; copy: SeedStageCopy }

export type SeedStageResult =
  | { refused: string; tooLarge: boolean }
  | { entries: SeedStageEntry[]; copies: SeedStageEntry[] }

type OpenedFile = {
  kind: 'file'
  handle: Awaited<ReturnType<typeof open>>
  size: number
  ino: number
  dev: number
  executable: boolean
  atime: Date
  mtime: Date
}

/** densable `Si` — ancestor `.gitattributes` not already in the path list. */
function ancestorGitAttributes(paths: string[]): string[] {
  const listed = new Set(paths)
  return uniq(
    paths.flatMap(path => {
      const parts = path.split('/')
      return parts.map((_, i) =>
        [...parts.slice(0, i), '.gitattributes'].join('/'),
      )
    }),
  ).filter(path => !listed.has(path))
}

/** densable `Ei` */
async function openSeedStageSource(
  workTree: string,
  rel: string,
): Promise<
  | { kind: 'absent' }
  | { kind: 'refused'; why: string }
  | { kind: 'hardlinked' }
  | { kind: 'moved' }
  | { kind: 'symlink'; target: Buffer }
  | OpenedFile
> {
  const abs = join(workTree, rel)
  let handle: Awaited<ReturnType<typeof open>>
  try {
    {
      const st = await lstat(abs)
      if (st.isSymbolicLink()) {
        throw Object.assign(new Error('symbolic link'), { code: 'ELOOP' })
      }
      if (!st.isFile()) return { kind: 'refused', why: 'not a regular file' }
    }
    handle = await open(abs, 'r')
  } catch (err) {
    const code = getErrnoCode(err)
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'absent' }
    if (code === 'ELOOP' || code === 'EMLINK' || code === 'EFTYPE') {
      try {
        const target = await readlink(abs, { encoding: 'buffer' })
        const hop = await seedAncestorHopState(workTree, rel)
        if (hop === 'clear') return { kind: 'symlink', target }
        if (hop === 'symlink') return { kind: 'absent' }
        return {
          kind: 'refused',
          why: 'a directory above it could not be inspected',
        }
      } catch {
        return { kind: 'refused', why: 'changed while being read' }
      }
    }
    return {
      kind: 'refused',
      why: `could not be opened (${code ?? 'unknown'})`,
    }
  }
  try {
    const st = await handle.stat()
    if (!st.isFile()) {
      await handle.close()
      return { kind: 'refused', why: 'not a regular file' }
    }
    if (st.nlink > 1) {
      await handle.close()
      return { kind: 'hardlinked' }
    }
    return {
      kind: 'file',
      handle,
      size: st.size,
      ino: st.ino,
      dev: st.dev,
      executable: (st.mode & 73) !== 0,
      atime: st.atime,
      mtime: st.mtime,
    }
  } catch (err) {
    await handle.close().catch(() => {})
    return { kind: 'refused', why: String(err) }
  }
}

/** densable `Kt` */
export async function stageSeedWipCopies(
  workTree: string,
  stageRoot: string,
  paths: string[],
  maxStagedBytes: number,
): Promise<SeedStageResult> {
  const bad = paths.find(path => !seedPathSegmentsOk(path))
  if (bad !== undefined) {
    return { refused: `${bad}: not a path git writes`, tooLarge: false }
  }
  let total = 0
  let largest: { path: string; size: number } | null = null
  const extraAttrs = ancestorGitAttributes(paths)
  const listed = new Set(paths)
  const recopy = true
  const mapper = seedPoolMap(
    POOL,
    async (rel: string): Promise<SeedStageEntry | SeedStageResult> => {
      const hop = await seedAncestorHopState(workTree, rel)
      if (hop === 'symlink') return { kind: 'absent', path: rel }
      if (hop === 'unreadable') {
        return {
          refused: `${rel}: a directory above it could not be inspected`,
          tooLarge: false,
        }
      }
      const src = await openSeedStageSource(workTree, rel)
      switch (src.kind) {
        case 'absent':
          return { kind: 'absent', path: rel }
        case 'refused':
          return listed.has(rel)
            ? { refused: `${rel}: ${src.why}`, tooLarge: false }
            : { kind: 'absent', path: rel }
        case 'hardlinked':
          return { kind: 'hardlinked', path: rel }
        case 'moved':
          return { kind: 'changed', path: rel }
        case 'symlink':
          return { kind: 'symlink', path: rel, target: src.target }
        case 'file':
          try {
            total += src.size
            if (largest === null || src.size > largest.size) {
              largest = { path: rel, size: src.size }
            }
            if (total > maxStagedBytes) {
              return {
                refused: `${largest.path} (largest, ${largest.size} bytes): ${total} bytes of changed files exceed the ${maxStagedBytes}-byte cap`,
                tooLarge: true,
              }
            }
            const dest = join(stageRoot, rel)
            await mkdir(dirname(dest), { recursive: true })
            let out: Awaited<ReturnType<typeof open>>
            try {
              out = await open(dest, 'wx', src.executable ? 0o755 : 0o644)
            } catch (err) {
              if (getErrnoCode(err) === 'EEXIST') {
                return {
                  refused: `${rel}: collides with another changed path that differs only in case or normalization`,
                  tooLarge: false,
                }
              }
              throw err
            }
            try {
              const buf = Buffer.allocUnsafe(Math.min(src.size, COPY_BUF))
              let copied = 0
              while (copied < src.size) {
                const { bytesRead } = await src.handle.read(
                  buf,
                  0,
                  Math.min(buf.length, src.size - copied),
                  copied,
                )
                if (bytesRead === 0) break
                let written = 0
                while (written < bytesRead) {
                  const { bytesWritten } = await out.write(
                    buf,
                    written,
                    bytesRead - written,
                  )
                  written += bytesWritten
                }
                copied += bytesRead
              }
              if (copied !== src.size) {
                return {
                  refused: `${rel}: changed while being read`,
                  tooLarge: false,
                }
              }
              const after = await lstat(join(workTree, rel)).catch(() => null)
              if (after !== null && after.isFile() && after.nlink > 1) {
                await out.close()
                await unlink(dest).catch(() => {})
                return { kind: 'hardlinked', path: rel }
              }
              if (
                after === null ||
                !after.isFile() ||
                after.ino !== src.ino ||
                after.dev !== src.dev ||
                (recopy &&
                  (await seedAncestorHopState(workTree, rel)) !== 'clear')
              ) {
                await out.close()
                await unlink(dest).catch(() => {})
                return { kind: 'changed', path: rel }
              }
              await out.utimes(src.atime, src.mtime)
              const st = await out.stat()
              return {
                kind: 'file',
                path: rel,
                bytes: copied,
                copy: {
                  ino: st.ino,
                  dev: st.dev,
                  ctimeMs: st.ctimeMs,
                  size: st.size,
                },
              }
            } finally {
              await out.close().catch(() => {})
            }
          } catch (err) {
            return {
              refused: `${rel}: could not be staged (${getErrnoCode(err) ?? String(err)})`,
              tooLarge: false,
            }
          } finally {
            await src.handle.close()
          }
      }
    },
  )
  const rows = await Promise.all([...paths, ...extraAttrs].map(mapper))
  const refused = rows.find(row => 'refused' in row)
  if (refused !== undefined) return refused
  const ok = rows.filter(row => !('refused' in row)) as SeedStageEntry[]
  return {
    entries: ok.filter(
      row =>
        listed.has(row.path) ||
        row.kind === 'hardlinked' ||
        row.kind === 'changed',
    ),
    copies: ok.filter(
      row =>
        row.kind === 'file' || (row.kind === 'absent' && !listed.has(row.path)),
    ),
  }
}

/** densable `qt` — staged copies still match. */
export async function seedStageCopiesUnchanged(
  stageRoot: string,
  copies: SeedStageEntry[],
): Promise<boolean> {
  return (
    await Promise.all(
      copies.map(async row => {
        if (row.kind === 'absent') {
          return (
            (await lstat(join(stageRoot, row.path)).catch(() => null)) === null
          )
        }
        if (row.kind !== 'file') return true
        try {
          const st = await lstat(join(stageRoot, row.path))
          return (
            st.isFile() &&
            st.nlink === 1 &&
            st.ino === row.copy.ino &&
            st.dev === row.copy.dev &&
            st.ctimeMs === row.copy.ctimeMs &&
            st.size === row.copy.size
          )
        } catch {
          return false
        }
      }),
    )
  ).every(Boolean)
}
