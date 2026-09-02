/**
 * densable Cos / A8e / $ln / wos / Los / Aos — synced-root landing guards.
 *
 * Official walks from config home; first-hop symlink-to-dir is allowed,
 * nested symlink / stray file refuses the round.
 */

import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rmdir,
  stat,
} from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'path'
import { logForDebugging } from '../debug.js'
import { getErrnoCode, isENOENT } from '../errors.js'
import {
  foldSyncedLeafName,
  foldSyncedPathKey,
  isSyncedZipReservedSegment,
  SYNCED_STAGING_DIRNAME,
} from './syncedPluginSyncNames.js'

export type SyncedRootKind =
  | 'real'
  | 'absent'
  | 'redirected'
  | 'not_a_directory'
export type SyncedLeafKind =
  | 'directory'
  | 'absent'
  | 'redirected'
  | 'not_a_directory'

export type SyncedExtractCause =
  | 'download'
  | 'extract'
  | 'local'
  | 'root_refused'
  | 'deferred'

export type SyncedExtractResult =
  | { ok: true }
  | { ok: false; cause: SyncedExtractCause; reason: string }

/** densable `ego`. */
export const SYNCED_EXTRACT_OK: SyncedExtractResult = { ok: true }

/** densable `BEr`. */
export const SYNCED_ROOT_REFUSED: SyncedExtractResult = {
  ok: false,
  cause: 'root_refused',
  reason: 'sync root no longer verifies (changed mid-round)',
}

/** densable `rgo`. */
export const SYNCED_OCCUPANT_STUCK: SyncedExtractResult = {
  ok: false,
  cause: 'local',
  reason: 'an existing directory at the target could not be displaced',
}

/** densable `tgo`. */
export function extractFailed(reason: string): SyncedExtractResult {
  return { ok: false, cause: 'extract', reason }
}

/** densable `Tos`. */
export function downloadFailed(reason: string): SyncedExtractResult {
  return { ok: false, cause: 'download', reason }
}

/** densable `Fln`. */
export function promotionFailed(code: string | undefined): SyncedExtractResult {
  return {
    ok: false,
    cause: 'local',
    reason: `the downloaded copy could not be moved into place (${code ?? 'unknown error'})`,
  }
}

/** densable `kos`. */
export function isOccupantRenameErrno(code: string | undefined): boolean {
  return (
    code === 'ENOTEMPTY' ||
    code === 'EEXIST' ||
    code === 'ENOTDIR' ||
    code === 'EPERM' ||
    code === 'EACCES'
  )
}

/** densable `S0e`. */
export class SyncOwnedRootRefusedError extends Error {
  reason: string
  code?: string
  constructor(reason: string, opts?: { cause?: unknown; code?: string }) {
    super('sync-owned root refused', { cause: opts?.cause })
    this.name = 'SyncOwnedRootRefusedError'
    this.reason = reason
    this.code = opts?.code
  }
}

/** densable `UEr`. */
export function posixSyncRootLabel(label: string): string {
  return label.split(sep).join('/').replaceAll('\\', '/')
}

/** densable `Sos`. */
export async function probeSyncedRootTree(
  root: string,
  configHome: string,
): Promise<SyncedRootKind> {
  const rel = relative(configHome, root)
  if (rel.startsWith('..') || isAbsolute(rel)) return 'redirected'
  let cur = configHome
  for (const [index, hop] of rel.split(sep).filter(Boolean).entries()) {
    cur = join(cur, hop)
    let st
    try {
      st = await lstat(cur)
    } catch (err) {
      if (isENOENT(err)) return 'absent'
      throw err
    }
    if (st.isSymbolicLink()) {
      if (index > 0) return 'redirected'
      let target
      try {
        target = await stat(cur)
      } catch (err) {
        if (isENOENT(err)) return 'redirected'
        throw err
      }
      if (!target.isDirectory()) return 'not_a_directory'
      continue
    }
    if (!st.isDirectory()) return 'not_a_directory'
  }
  return 'real'
}

/** densable `sCh`. */
export function stagingLeaves(root: string): Array<[string, string]> {
  const staging = join(root, SYNCED_STAGING_DIRNAME)
  return [
    [staging, 'staging'],
    [join(staging, String(process.pid)), 'staging_pid'],
  ]
}

/** densable `vos`. */
export async function probeSyncedLeaf(path: string): Promise<SyncedLeafKind> {
  let st
  try {
    st = await lstat(path)
  } catch (err) {
    if (isENOENT(err)) return 'absent'
    throw err
  }
  if (st.isSymbolicLink()) return 'redirected'
  return st.isDirectory() ? 'directory' : 'not_a_directory'
}

export type SyncedRootProbeEvent = {
  event: string
  phase: string
  rootLabel: string
}

/** densable `A8e`. */
export async function auditSyncedRoot(
  root: string,
  configHome: string,
  ev: SyncedRootProbeEvent,
  opts: { checkStagingLeaf?: boolean } = {},
): Promise<SyncedRootKind | { refused: string }> {
  const checkStagingLeaf = opts.checkStagingLeaf === true
  let kind: SyncedRootKind
  try {
    kind = await probeSyncedRootTree(root, configHome)
    if (kind === 'real' && checkStagingLeaf) {
      for (const [path, component] of stagingLeaves(root)) {
        const leaf = await probeSyncedLeaf(path)
        if (leaf === 'absent') break
        if (leaf !== 'directory') {
          logForDebugging(ev.event, { level: 'warn' })
          return { refused: leaf }
        }
      }
    }
  } catch (err) {
    logForDebugging(ev.event, { level: 'warn' })
    return { refused: 'unverified' }
    void getErrnoCode(err)
  }
  switch (kind) {
    case 'real':
    case 'absent':
      return kind
    case 'redirected':
    case 'not_a_directory':
      logForDebugging(ev.event, { level: 'warn' })
      return { refused: kind }
  }
}

/** densable `$ln`. */
export async function moveSyncedDirToTrash(opts: {
  dir: string
  trashRoot: string
  configHome: string
  failureEvent: string
}): Promise<boolean> {
  let batch: string | undefined
  try {
    const sourceRoot = await probeSyncedRootTree(
      dirname(opts.dir),
      opts.configHome,
    )
    if (sourceRoot === 'redirected' || sourceRoot === 'not_a_directory') {
      logForDebugging(opts.failureEvent, { level: 'warn' })
      return false
    }
    const trash = await probeSyncedRootTree(opts.trashRoot, opts.configHome)
    switch (trash) {
      case 'redirected':
      case 'not_a_directory':
        logForDebugging(opts.failureEvent, { level: 'warn' })
        return false
      case 'absent':
        await mkdir(opts.trashRoot, { recursive: true })
        break
      case 'real':
        break
    }
    batch = await mkdtemp(join(opts.trashRoot, `${Date.now()}-${process.pid}-`))
    await rename(opts.dir, join(batch, basename(opts.dir)))
    return true
  } catch (err) {
    if (batch !== undefined) await rmdir(batch).catch(() => {})
    if (batch !== undefined && isENOENT(err)) {
      try {
        await lstat(opts.dir)
      } catch (inner) {
        if (isENOENT(inner)) return true
      }
      logForDebugging(opts.failureEvent, { level: 'warn' })
      return false
    }
    logForDebugging(opts.failureEvent, { level: 'warn' })
    return false
  }
}

/** densable `wos` / `B1h`. */
export async function ensureSyncedRootRound(opts: {
  root: string
  trashRoot: string
  configHome: string
  event: string
}): Promise<void> {
  const ev = { refused: opts.event }
  try {
    for (const parent of new Set([
      dirname(opts.trashRoot),
      dirname(opts.root),
    ])) {
      const kind = await probeSyncedRootTree(parent, opts.configHome)
      if (kind === 'redirected' || kind === 'not_a_directory') {
        logForDebugging(ev.refused, { level: 'warn' })
        throw new SyncOwnedRootRefusedError(
          kind === 'redirected' ? 'parent_symlink' : 'parent_not_a_directory',
        )
      }
    }
    const rootKind = await probeSyncedLeaf(opts.root)
    const checks: Array<[string, string, SyncedLeafKind]> = [
      [opts.root, 'root', rootKind],
      [opts.trashRoot, 'trash_root', await probeSyncedLeaf(opts.trashRoot)],
    ]
    if (rootKind === 'directory') {
      for (const [path, component] of stagingLeaves(opts.root)) {
        const leaf = await probeSyncedLeaf(path)
        checks.push([path, component, leaf])
        if (leaf !== 'directory') break
      }
    }
    for (const [, component, kind] of checks) {
      if (kind === 'absent') continue
      if (kind !== 'directory') {
        const label = component === 'staging_pid' ? 'staging' : component
        logForDebugging(ev.refused, { level: 'warn' })
        throw new SyncOwnedRootRefusedError(
          kind === 'redirected'
            ? `${label}_symlink`
            : `${label}_not_a_directory`,
        )
      }
    }
    if (rootKind !== 'directory') {
      await mkdir(opts.root, { recursive: true })
    }
  } catch (err) {
    if (err instanceof SyncOwnedRootRefusedError) throw err
    logForDebugging(ev.refused, { level: 'warn' })
    throw new SyncOwnedRootRefusedError('unverified', {
      cause: err,
      code: getErrnoCode(err) ?? 'unknown',
    })
  }
}

type SyncRootGuard = {
  refused(): boolean
  refusedReason(): string | null
  verify(): Promise<boolean>
}

/** densable `EFE`. */
export function createSyncedRootGuard(opts: {
  root: () => string
  configHome: () => string
  rootLabel: string
  event: string
}): SyncRootGuard {
  let reason: string | null = null
  return {
    refused() {
      return reason !== null
    },
    refusedReason() {
      return reason
    },
    async verify() {
      if (reason !== null) return false
      const result = await auditSyncedRoot(
        opts.root(),
        opts.configHome(),
        { event: opts.event, phase: 'landing', rootLabel: opts.rootLabel },
        { checkStagingLeaf: true },
      )
      if (result === 'real') return true
      if (result === 'absent') {
        logForDebugging(opts.event, { level: 'warn' })
        reason = 'absent'
      } else if (typeof result === 'string') {
        reason = result
      } else {
        reason = result.refused
      }
      return false
    },
  }
}

/** densable `Aos` / `z1h`. */
export function createSyncedManifestCtx(opts: {
  root: () => string
  configHome: () => string
  rootLabel: string
  event: string
}): { manifestRead: boolean; guard: SyncRootGuard } {
  return {
    manifestRead: false,
    guard: createSyncedRootGuard(opts),
  }
}

/** densable `Eos`. */
export function landingRefused(reason: string): SyncOwnedRootRefusedError {
  return new SyncOwnedRootRefusedError(`landing_${reason}`)
}

/** densable `Los` — any dir with `head` + (`commondir` or `refs`). */
export async function extractedTreeIsBareRepo(root: string): Promise<boolean> {
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (dir === undefined) continue
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    const names = new Set(entries.map(e => foldSyncedLeafName(e.name)))
    if (names.has('head') && (names.has('commondir') || names.has('refs'))) {
      return true
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(join(dir, entry.name))
    }
  }
  return false
}

/** densable `WEr`. */
export async function sameSyncedOccupant(
  a: string,
  b: string,
): Promise<boolean> {
  if (a === b) return true
  try {
    const [sa, sb, parent] = await Promise.all([
      lstat(a),
      lstat(b),
      lstat(dirname(a)),
    ])
    if (
      sa.ino === 0 ||
      sb.ino === 0 ||
      (sa.dev === parent.dev && sa.ino === parent.ino)
    ) {
      return foldSyncedPathKey(a) === foldSyncedPathKey(b)
    }
    return sa.dev === sb.dev && sa.ino === sb.ino
  } catch {
    return false
  }
}

/** leftover 239 `Oos` — live / not-live / indeterminate vs the write-set. */
export type SyncedLiveKind = 'live' | 'not-live' | 'indeterminate'

export function createSyncedLiveDirClassifier(
  liveDirs: Iterable<string>,
): (path: string) => Promise<SyncedLiveKind> {
  const byKey = new Map(
    Array.from(liveDirs, dir => [foldSyncedPathKey(dir), dir]),
  )
  return async path => {
    const canonical = byKey.get(foldSyncedPathKey(path))
    if (canonical === undefined) return 'not-live'
    if (await sameSyncedOccupant(path, canonical)) return 'live'
    try {
      await lstat(canonical)
      return 'not-live'
    } catch {
      return 'indeterminate'
    }
  }
}

export function skipZipEntryIfReserved(relPath: string): boolean {
  return relPath.split(/[\\/]/).some(isSyncedZipReservedSegment)
}
