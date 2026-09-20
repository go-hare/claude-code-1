/**
 * densable `_465` `Wi` / `mn` / `er`.
 * Gold: gold-forged-Wi-wide.txt / gold-forged-mn-wide.txt / gold-forged-er.txt
 */

import { createHash } from 'crypto'
import { lstat, open, readlink } from 'fs/promises'
import { join } from 'path'
import { uniq } from '../array.js'
import { getErrnoCode } from '../errors.js'
import {
  seedPathIsWindows83Alias,
  seedPathListingOk,
  type SeedPathRow,
} from './seedPathClassify.js'
import { seedAncestorHopState } from './seedPathHop.js'
import type { SeedDiffRow, SeedInspection } from './seedWipInspect.js'
import { seedPoolMap } from './seedWipPool.js'

const SYMLINK_MODE = '120000'
const FILE_MODES = ['100644', '100755'] as const
const ZERO_OID = /^0+$/
const POOL = 8
const MN_DEFAULT_MAX = 1_048_576

function blobSha1(bytes: Buffer): string {
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex')
}

/**
 * densable `mn` — working `M` with same mode, newId all-zero, oldId sha1,
 * hop clear, file nlink=1, size≤cap (hs passes Gi=64MiB).
 */
export async function seedWorkingUnchanged(
  workTree: string,
  row: SeedDiffRow,
  maxBytes: number = MN_DEFAULT_MAX,
  signal?: AbortSignal,
): Promise<boolean> {
  if (
    row.status !== 'M' ||
    row.oldMode !== row.newMode ||
    !ZERO_OID.test(row.newId) ||
    row.oldId.length !== 40 ||
    row.path.includes('\uFFFD')
  ) {
    return false
  }
  if ((await seedAncestorHopState(workTree, row.path)) !== 'clear') {
    return false
  }
  const abs = join(workTree, row.path)
  if (row.newMode === SYMLINK_MODE) {
    try {
      return blobSha1(Buffer.from(await readlink(abs))) === row.oldId
    } catch {
      return false
    }
  }
  if (!(FILE_MODES as readonly string[]).includes(row.newMode)) return false
  try {
    if (!(await lstat(abs)).isFile()) return false
    const handle = await open(abs, 'r')
    try {
      const st = await handle.stat()
      if (!st.isFile() || st.nlink !== 1 || st.size > maxBytes) return false
      const hash = createHash('sha1').update(`blob ${st.size}\0`)
      const buf = Buffer.allocUnsafe(Math.min(st.size, 1_048_576))
      let offset = 0
      while (offset < st.size) {
        if (signal?.aborted) return false
        const { bytesRead } = await handle.read(
          buf,
          0,
          Math.min(buf.length, st.size - offset),
          offset,
        )
        if (bytesRead === 0) return false
        hash.update(buf.subarray(0, bytesRead))
        offset += bytesRead
      }
      return hash.digest('hex') === row.oldId
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}

/**
 * densable `er` — resurrected if hop not clear / FFFD, or path is not a directory
 * (ENOENT/ENOTDIR → false).
 */
export async function seedPathLooksResurrected(
  workTree: string,
  rel: string,
): Promise<boolean> {
  if (
    rel.includes('\uFFFD') ||
    (await seedAncestorHopState(workTree, rel)) !== 'clear'
  ) {
    return true
  }
  try {
    return !(await lstat(join(workTree, rel))).isDirectory()
  } catch (err) {
    const code = getErrnoCode(err)
    return code !== 'ENOENT' && code !== 'ENOTDIR'
  }
}

export type SeedLeaveOutPredicate = (path: string) => boolean

/**
 * densable `Wi`.
 */
export async function classifySeedLeaveOut(
  workTree: string,
  inspection: SeedInspection,
  leaveOut: SeedLeaveOutPredicate,
  alsoLeaveOut: SeedLeaveOutPredicate = () => false,
): Promise<SeedPathRow[]> {
  const paths = uniq([
    ...inspection.staged.map(row => row.path),
    ...inspection.working.map(row => row.path),
  ])
  const forged = paths.filter(path => !seedPathListingOk(path))
  const alias = paths.filter(
    path => seedPathListingOk(path) && seedPathIsWindows83Alias(path),
  )
  const blocked = new Set([...forged, ...alias])
  const keep = (row: SeedDiffRow) =>
    !blocked.has(row.path) && leaveOut(row.path)
  const stagedKept = inspection.staged.filter(keep)
  const stagedPaths = new Set(stagedKept.map(row => row.path))
  const workingMapper = seedPoolMap(POOL, async (row: SeedDiffRow) =>
    !stagedPaths.has(row.path) &&
    !alsoLeaveOut(row.path) &&
    (await seedWorkingUnchanged(workTree, row))
      ? []
      : [row],
  )
  const workingKept = (
    await Promise.all(inspection.working.filter(keep).map(workingMapper))
  ).flat()
  const combined = [...stagedKept, ...workingKept]
  const added = uniq(
    combined.filter(row => row.status === 'A').map(row => row.path),
  )
  const addedSet = new Set(added)
  const changed = uniq(
    combined
      .filter(row => row.status !== 'D' && !addedSet.has(row.path))
      .map(row => row.path),
  )
  const covered = new Set([...added, ...changed])
  const leftover = uniq(
    combined.map(row => row.path).filter(path => !covered.has(path)),
  )
  const resurrectMapper = seedPoolMap(POOL, async (path: string) =>
    (await seedPathLooksResurrected(workTree, path)) ? [path] : [],
  )
  const resurrected = (await Promise.all(leftover.map(resurrectMapper))).flat()
  return [
    ...forged.map(path => ({ path, why: 'forged' as const })),
    ...alias.map(path => ({ path, why: 'alias' as const })),
    ...added.map(path => ({ path, why: 'added' as const })),
    ...changed.map(path => ({ path, why: 'changed' as const })),
    ...resurrected.map(path => ({ path, why: 'resurrected' as const })),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
