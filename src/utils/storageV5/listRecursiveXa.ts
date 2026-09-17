/**
 * densable leftover `Xa` @207425816 / `_y` @207436901 / `Ql` @207423247.
 * hb `listRecursive:(d,c)=>Xa(s,d,c)`.
 */

import type { Dirent, Stats } from 'fs'
import { lstat, readdir, stat } from 'fs/promises'
import { join, relative, sep } from 'path'
import { isENOENT } from '../errors.js'
import { isValidStoragePathSegment } from '../sessionNameJobSidecar.js'
import { logForDebugging } from '../debug.js'
import {
  mapNamespaceListEntry,
  rankListEntriesForSort,
  sliceRankedListPage,
  type StorageV5ListEntry,
} from './listEntriesZa.js'
import {
  getSymlinkPolicy,
  validateStorageKey,
  validateStorageScope,
} from './writeValidate.js'

type Roots = {
  configHome: string
  globalConfigFile: string
  bridgeSpawnRoot?: string
}

type StorageV5Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string } }

type ListingStats = {
  unrepresentable: number
  refusedLinks: number
  unresolvedLinks: number
  declinedLinks: number
  reserved: number
  vanished: number
}

type WalkFile = {
  path: string
  stats?: Stats
  viaSymlink?: true
}

type FsResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: { kind: 'absent' | 'fs' | 'classified'; error?: unknown }
    }

export type ListRecursiveOpts = {
  cursor?: unknown
  limit?: number
  skipKeyStats?: boolean
  includeValue?: boolean
  suffix?: unknown
  links?: 'enter' | 'skip' | 'follow'
  maxLeaves?: number
}

export type ListRecursiveHost = {
  closed: boolean
  roots: Roots
  resolvePath: (key: Record<string, unknown>) => string | null
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

function err(code: string): { ok: false; error: { code: string } } {
  return { ok: false, error: { code } }
}

/** densable leftover `Yl` @207419901. */
function emptyListingStatsYl(): ListingStats {
  return {
    unrepresentable: 0,
    refusedLinks: 0,
    unresolvedLinks: 0,
    declinedLinks: 0,
    reserved: 0,
    vanished: 0,
  }
}

/** densable leftover `Oa` @207420012 — ceiling via leftover `gl`. */
function listingCeilingOa(): FsResult<never> {
  return { ok: false, error: { kind: 'classified' } }
}

/** densable leftover `Ha` @207421315. */
function isAmbiguousDirentHa(e: Dirent | Stats): boolean {
  return !e.isFile() && !e.isDirectory() && !e.isSymbolicLink()
}

/** densable leftover `tt` @207422011. */
function isUnrepresentableNodeTt(e: Dirent | Stats): boolean {
  return (
    e.isFIFO() || e.isSocket() || e.isBlockDevice() || e.isCharacterDevice()
  )
}

const listingLogOnce = new Set<string>()

/** densable leftover `Sn` @207421938. */
function noteListingSkipSn(path: string, message: string): void {
  if (listingLogOnce.has(path) || listingLogOnce.size >= 64) return
  listingLogOnce.add(path)
  logForDebugging(message)
}

async function fsResultY<T>(work: Promise<T>): Promise<FsResult<T>> {
  try {
    return { ok: true, value: await work }
  } catch (error) {
    if (isENOENT(error)) return { ok: false, error: { kind: 'absent' } }
    return { ok: false, error: { kind: 'fs', error } }
  }
}

/** densable leftover `Xl` @207421393. */
async function lstatListingXl(
  path: string,
): Promise<Stats | 'vanished' | 'unreadable'> {
  const r = await fsResultY(lstat(path))
  if (r.ok) return r.value
  if (r.error.kind !== 'absent') {
    noteListingSkipSn(
      path,
      `storage listing: skipping ${path} — its type could not be read`,
    )
    return 'unreadable'
  }
  return 'vanished'
}

/** densable leftover `jy` @207439428. */
async function classifyDirJy(
  path: string,
): Promise<'directory' | 'link' | 'gone' | 'unreadable'> {
  const r = await fsResultY(lstat(path))
  if (!r.ok) return r.error.kind === 'absent' ? 'gone' : 'unreadable'
  if (r.value.isDirectory()) return 'directory'
  return r.value.isSymbolicLink() ? 'link' : 'gone'
}

/** densable leftover `Uy` @207439628. */
function countSkipUy(
  kind: 'directory' | 'link' | 'gone' | 'unreadable',
  stats: ListingStats,
  refuse: boolean,
): void {
  if (kind === 'link') {
    if (refuse) stats.refusedLinks += 1
    else stats.declinedLinks += 1
    return
  }
  if (kind === 'gone') stats.vanished += 1
  else stats.unrepresentable += 1
}

/** densable leftover `uc` @207440873. */
function noteRefusedLinkUc(path: string, policy: string): void {
  if (policy === 'refuse') {
    noteListingSkipSn(
      path,
      `storage listing: skipping ${path} — a symlink in a machine-written scope is never examined`,
    )
  }
}

/** densable leftover `ec` @207424200. */
async function resolveLinkTargetEc(
  path: string,
  policy: string,
): Promise<
  | { kind: 'file'; stats: Stats }
  | { kind: 'directory'; stats: Stats }
  | undefined
> {
  if (policy === 'refuse') return
  const n = await fsResultY(stat(path))
  if (!n.ok) return n.error.kind === 'absent' ? undefined : undefined
  if (n.value.isFile()) return { kind: 'file', stats: n.value }
  return n.value.isDirectory()
    ? { kind: 'directory', stats: n.value }
    : undefined
}

/** densable leftover `Ql` @207423247. */
async function validateMarketplaceListQl(
  roots: Roots,
  scope: Record<string, unknown>,
  path: string | null,
): Promise<StorageV5Result<void> | undefined> {
  if (
    scope.namespace !== 'marketplaceCache' ||
    scope.relPath === undefined ||
    !Array.isArray(scope.relPath) ||
    scope.relPath.length === 0 ||
    path === null
  ) {
    return
  }
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() && getSymlinkPolicy(scope) === 'refuse') {
      return err('Failed')
    }
  } catch (error) {
    if (!isENOENT(error)) return err('Failed')
  }
}

/** densable leftover `dc` @207440610. */
async function scopeHasFollowedLinkDc(
  resolvePath: ListRecursiveHost['resolvePath'],
  scope: Record<string, unknown>,
  path: string,
): Promise<boolean> {
  if (getSymlinkPolicy(scope) !== 'follow') return false
  const root = resolvePath({ ...scope, relPath: undefined })
  if (root === path || root === null) return false
  let cursor = path
  while (cursor !== root && cursor.length >= root.length) {
    try {
      if ((await lstat(cursor)).isSymbolicLink()) return true
    } catch {
      return false
    }
    const parent = cursor.slice(0, Math.max(0, cursor.lastIndexOf(sep)))
    if (parent === cursor) break
    cursor = parent
  }
  return false
}

function mapRelPathToKeyAt(
  scope: Record<string, unknown>,
  rel: string[],
): Record<string, unknown> | undefined {
  let current = scope
  for (let i = 0; i < rel.length; i++) {
    const last = i === rel.length - 1
    const mapped = mapNamespaceListEntry(current, rel[i]!, !last)
    if (mapped === undefined) return
    if (last) return mapped.kind === 'key' ? mapped.key : undefined
    if (mapped.kind !== 'scope' || mapped.scope === undefined) return
    current = mapped.scope
  }
}

function suffixMatchesKa(
  suffix: unknown,
  key: Record<string, unknown>,
): boolean {
  if (typeof suffix !== 'string' || suffix.length === 0) return true
  const rel = key.relPath ?? key.agentRelPath
  if (!Array.isArray(rel) || rel.length === 0) return true
  const last = rel[rel.length - 1]
  return typeof last === 'string' && last.endsWith(suffix)
}

/** densable leftover `_y` @207436901. */
async function walkLeavesY(
  root: string,
  policy: 'follow' | 'refuse',
  stats: ListingStats,
  allowFollow: (path: string) => boolean,
  links: string,
  maxLeaves: number,
): Promise<FsResult<WalkFile[]>> {
  const seen = new Set<string>()
  const realDirs: string[] = []
  const files: WalkFile[] = []
  const pending: string[] = []

  async function identity(path: string): Promise<FsResult<string>> {
    const st = await fsResultY(stat(path))
    if (!st.ok) return st
    const ino = st.value.ino
    return ino !== 0
      ? ok(`${st.value.dev}:${ino}`)
      : fsResultY(Promise.resolve(path))
  }

  async function onWalkError(
    viaLink: boolean,
    path: string,
    error: {
      kind: 'absent' | 'fs' | 'classified'
      error?: unknown
    },
    count = true,
  ): Promise<FsResult<WalkFile[] | undefined>> {
    if (path === root && !viaLink && error.kind === 'absent') {
      return { ok: false, error }
    }
    if (viaLink || error.kind === 'absent') {
      if (count) {
        if (error.kind === 'absent') stats.vanished += 1
        else stats.unrepresentable += 1
      }
      noteListingSkipSn(path, `storage listing skipped ${path}: ${error.kind}`)
      return ok(undefined)
    }
    return { ok: false, error }
  }

  async function walkDir(
    dir: string,
    viaLink: boolean,
  ): Promise<FsResult<string[]>> {
    if (viaLink) {
      const id = await identity(dir)
      if (!id.ok) {
        const recovered = await onWalkError(true, dir, id.error)
        return recovered.ok ? ok([]) : recovered
      }
      if (seen.has(id.value)) return ok([])
      seen.add(id.value)
    }
    if (files.length > maxLeaves) return listingCeilingOa()
    const listed = await fsResultY(readdir(dir, { withFileTypes: true }))
    if (!viaLink && (listed.ok || listed.error.kind !== 'absent')) {
      realDirs.push(dir)
    }
    if (!listed.ok) {
      const recovered = await onWalkError(viaLink, dir, listed.error)
      return recovered.ok ? ok([]) : recovered
    }
    const names = listed.value.toSorted((a, z) =>
      a.name < z.name ? -1 : a.name > z.name ? 1 : 0,
    )
    const via = viaLink ? ({ viaSymlink: true } as const) : {}
    const nested: Array<Promise<FsResult<string[]> | string>> = []
    for (const ent of names) {
      if (!isValidStoragePathSegment(ent.name)) {
        stats.reserved += 1
        continue
      }
      if (isUnrepresentableNodeTt(ent)) {
        stats.unrepresentable += 1
        continue
      }
      const child = join(dir, ent.name)
      const resolved = isAmbiguousDirentHa(ent)
        ? await lstatListingXl(child)
        : undefined
      if (resolved === 'vanished') {
        stats.vanished += 1
        continue
      }
      if (
        resolved === 'unreadable' ||
        (resolved !== undefined && isUnrepresentableNodeTt(resolved))
      ) {
        stats.unrepresentable += 1
        continue
      }
      const node = resolved ?? ent
      if (node.isDirectory()) {
        const refuse = policy === 'refuse' || !allowFollow(child)
        const skipStat =
          !viaLink && resolved === undefined && (refuse || links === 'skip')
        if (viaLink) {
          nested.push(Promise.resolve(await walkDir(child, true)))
        } else if (skipStat) {
          nested.push(
            classifyDirJy(child).then(kind => {
              if (kind !== 'directory') {
                countSkipUy(kind, stats, refuse)
                return ok([])
              }
              return walkDir(child, false)
            }),
          )
        } else {
          nested.push(walkDir(child, false))
        }
      } else if (node.isFile()) {
        files.push({
          path: child,
          ...(resolved !== undefined && { stats: resolved }),
          ...via,
        })
        if (files.length > maxLeaves) break
      } else if (node.isSymbolicLink()) {
        if (policy !== 'follow' || !allowFollow(child)) {
          stats.refusedLinks += 1
          noteRefusedLinkUc(child, policy)
        } else if (links === 'skip') {
          stats.declinedLinks += 1
        } else {
          nested.push(Promise.resolve(child))
        }
      }
    }
    if (files.length > maxLeaves) return listingCeilingOa()
    const settled = await Promise.all(nested)
    const more: string[] = []
    for (const item of settled) {
      if (typeof item === 'string') more.push(item)
      else if (!item.ok) return item
      else more.push(...item.value)
    }
    return ok(more)
  }

  const first = await walkDir(root, false)
  if (!first.ok) return first
  pending.push(...first.value)
  let primed = false
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    const target = await resolveLinkTargetEc(next, policy)
    if (target === undefined) {
      stats.unresolvedLinks += 1
      continue
    }
    if (target.kind !== 'directory') {
      files.push({
        path: next,
        ...(target.kind === 'file' && { stats: target.stats }),
        viaSymlink: true,
      })
      if (files.length > maxLeaves) return listingCeilingOa()
      continue
    }
    if (!primed) {
      for (const dir of realDirs) {
        const id = await identity(dir)
        if (id.ok) {
          seen.add(id.value)
          continue
        }
        const recovered = await onWalkError(false, dir, id.error, false)
        if (!recovered.ok) return recovered
      }
      primed = true
    }
    const walked = await walkDir(next, true)
    if (!walked.ok) return walked
    pending.push(...walked.value)
  }
  return ok(files)
}

function listingPage(
  items: StorageV5ListEntry[],
  opts: ListRecursiveOpts | undefined,
  _stats: ListingStats,
): { items: StorageV5ListEntry[]; cursor?: unknown } {
  return sliceRankedListPage(rankListEntriesForSort(items), opts)
}

/**
 * densable leftover `Xa` @207425816.
 */
export async function listRecursiveXa(
  host: ListRecursiveHost,
  scope: unknown,
  opts?: ListRecursiveOpts,
): Promise<
  StorageV5Result<{
    items: StorageV5ListEntry[]
    cursor?: unknown
    unrepresentable?: number
    refusedLinks?: number
    unresolvedLinks?: number
    declinedLinks?: number
    reserved?: number
    vanished?: number
  }>
> {
  if (host.closed) return err('Unavailable')
  if (typeof scope !== 'object' || scope === null) {
    return err('InvalidArgument')
  }
  const rec = scope as Record<string, unknown>
  if (validateStorageScope(rec) !== undefined) {
    return err('InvalidArgument')
  }
  if (rec.namespace === 'pluginCache' && rec.version === undefined) {
    return err('InvalidArgument')
  }
  const root = host.resolvePath(rec)
  if (root === null) return err('InvalidArgument')
  const policy = getSymlinkPolicy(rec)
  const links = opts?.links ?? 'enter'
  const stats = emptyListingStatsYl()
  const market = await validateMarketplaceListQl(host.roots, rec, root)
  if (market !== undefined && !market.ok) return market
  if (links === 'skip') {
    if (await scopeHasFollowedLinkDc(host.resolvePath, rec, root)) {
      stats.declinedLinks += 1
      return ok({ ...listingPage([], opts, stats), ...stats })
    }
  }
  const walked = await walkLeavesY(
    root,
    policy,
    stats,
    () => policy === 'follow',
    links,
    opts?.maxLeaves ?? Number.MAX_SAFE_INTEGER,
  )
  if (!walked.ok) {
    return walked.error.kind === 'absent'
      ? ok({ ...listingPage([], opts, stats), ...stats })
      : err('Failed')
  }
  const includeValue = opts?.includeValue === true
  const skipStats = opts?.skipKeyStats === true
  const items: StorageV5ListEntry[] = []
  for (const leaf of walked.value) {
    const rel = relative(root, leaf.path).split(sep).filter(Boolean)
    const key = mapRelPathToKeyAt(rec, rel)
    if (key === undefined) {
      stats.unrepresentable += 1
      continue
    }
    if (leaf.viaSymlink === true && getSymlinkPolicy(key) === 'refuse') {
      stats.refusedLinks += 1
      continue
    }
    if (!suffixMatchesKa(opts?.suffix, key)) {
      stats.unrepresentable += 1
      continue
    }
    if (validateStorageKey(key) !== undefined) {
      stats.unrepresentable += 1
      continue
    }
    const via = leaf.viaSymlink === true ? { viaSymlink: true as const } : {}
    if (!includeValue && leaf.stats !== undefined) {
      items.push({
        kind: 'key',
        key,
        size: leaf.stats.size,
        mtimeMs: leaf.stats.mtimeMs,
        ...via,
      })
      continue
    }
    if (skipStats && !includeValue) {
      items.push({ kind: 'key', key, ...via })
      continue
    }
    items.push({ kind: 'key', key, ...via })
  }
  return ok({ ...listingPage(items, opts, stats), ...stats })
}
