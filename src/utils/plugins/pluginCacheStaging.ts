/**
 * densable 2.1.246 #18 — official O8 staging/publish helpers.
 *
 *   odt=".tmp~"                 PLUGIN_CACHE_STAGING_SUFFIX
 *   r_n @212732920              stagePluginCachePath
 *   HCo                         classifyPluginCacheStagingName
 *   kue @212733098              publishStagedPluginCache
 *   vue                         isPluginCacheStagingName
 *   Tue                         sweepStalePluginCacheStaging
 *   idt                         removePluginCacheStaging
 *   NT @213262344               isPluginCacheStorageV5
 *   YC @212701831              entryIsNotSymlink
 *   Sue @212733897             isSymlinkOccupant
 *   uS @212734131              classifyPluginCachePath
 *   sLn @213262912             isRealDirectoryEntry
 *   pSt @213262640             isPluginCacheVersionParentContained
 *   GG @213263440              probePluginCacheVersionParent
 *   zG @213262395              pluginCacheVersionParentIsReal
 *   vFe @213263129             assertPluginCacheVersionParentReal
 *   k0o @213347520             PLUGIN_CACHE_VERSION_PARENT_K0O
 *   T0o @213264986             decidePluginCacheServe
 *   Qw @212702166              removePathEntry
 *   GLn @213263690             removeStrayPluginCacheLink
 *   TFe @213264030             clearPluginCacheOccupant
 *   BOe @214105871             stagePluginCachePath (`${dest}${Upt}${hex8}`)
 *   kg @214105809              ENOENT|ENOTDIR
 *   Kjo @214631090             EXDEV || RNn (EPERM|EBUSY|EACCES)
 *   $jo                        lutimes
 *   cl                         renameWithRetry (Et/Zed)
 *   Yjo @214631161             dest aside-rename + src publish
 *
 * Official NT = Be() && handle && np(dummy). np = Yn @210112490.
 * Official QU=Hl, AFe=Bl, BLn=Vl (`${dest}.linking-${pid}`).
 * O8 leftover calls AFe/BLn. Oxd first-install is still in-place.
 */

import { randomBytes } from 'crypto'
import type { Stats } from 'fs'
import {
  lstat,
  lutimes,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
} from 'fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
  win32,
} from 'path'
import { isValidStoragePathSegment } from '../sessionNameJobSidecar.js'
import {
  errorMessage,
  getErrnoCode,
  isENOENT,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../errors.js'
import { logForDebugging } from '../debug.js'
import { getFsImplementation } from '../fsOperations.js'
import { RENAME_TRANSIENT_CODES, renameWithRetry } from '../renameRetry.js'
import { getPluginsDirectory } from './pluginDirectories.js'
import { hasCommandPluginLinkFarm } from './pluginCommandSource.js'
import { isHoverRestOn } from '../storageV5/hoverRestPin.js'

/** densable odt */
export const PLUGIN_CACHE_STAGING_SUFFIX = '.tmp~'

/** densable zCo */
const STAGING_HEX8 = /^[0-9a-f]{8}$/

/** densable leftover `Mt` as `Xad` as `B_` — `{base}.tmp.` + hex8. */
const TMP_DOT_PREFIX = '.tmp.'

/** densable s_n — Tue stale window */
export const PLUGIN_CACHE_STAGING_STALE_MS = 86_400_000

/**
 * densable LMe names used by AX/kq (payload vs reserved).
 * Official block also has ur/lr/Nu: .orphaned_at / .in_use / .gcs-sha.
 * Qi=.in_use; leftover ag=.orphaned_at (kue/vfe delete a file, not a dir).
 */
export const PLUGIN_CACHE_RESERVED_ENTRY_NAMES = new Set([
  'node_modules',
  '.in_use',
  '.orphaned_at',
  '.gcs-sha',
])

/** densable ag — file kue removes from the staged tree before rename */
const PLUGIN_CACHE_STAGING_STAMP = '.orphaned_at'

function caseFold(name: string): string {
  return name.toUpperCase().toLowerCase()
}

/**
 * densable leftover `AX` @212733650.
 * edt(name) || B_(H_(name), am|node_modules|ag). sdt not inlined.
 */
export function isReservedPluginCacheEntryName(name: string): boolean {
  const t = caseFold(name)
  if (PLUGIN_CACHE_RESERVED_ENTRY_NAMES.has(t)) return true
  return (
    isPluginCacheTmpDotName(t, '.gcs-sha') ||
    isPluginCacheTmpDotName(t, 'node_modules') ||
    isPluginCacheTmpDotName(t, '.orphaned_at')
  )
}

function isAbsentPathError(error: unknown): boolean {
  const code = getErrnoCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** densable leftover `Mt` — `join(ee(),"plugins","cache")`. */
export function getPluginCacheRoot(): string {
  return join(getPluginsDirectory(), 'cache')
}

/** densable leftover `ce` — every isValidStoragePathSegment / C. */
function everyPluginPathSegmentIsSafe(parts: string[]): boolean {
  return parts.length > 0 && parts.every(isValidStoragePathSegment)
}

/**
 * densable leftover `Ot`. `a!==Mt()` → null. Containment + join identity.
 */
export function splitPluginCacheRelativeParts(
  absPath: string,
  cacheRoot: string,
): string[] | null {
  const root = getPluginCacheRoot()
  if (cacheRoot !== root) return null
  const rel = relative(root, absPath)
  if (
    rel === '' ||
    rel === '..' ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  ) {
    return null
  }
  const parts = rel.split(sep)
  return join(root, ...parts) === absPath ? parts : null
}

/**
 * densable leftover `Yn` / NT `np`.
 * 3 segments, ce, version not `.zip`.
 */
export function isPluginCacheVersionDirPath(
  absPath: string,
  cacheRoot: string,
): { marketplace: string; plugin: string; version: string } | null {
  const parts = splitPluginCacheRelativeParts(absPath, cacheRoot)
  if (
    parts === null ||
    parts.length !== 3 ||
    !everyPluginPathSegmentIsSafe(parts) ||
    parts[2]!.endsWith('.zip')
  ) {
    return null
  }
  const [marketplace, plugin, version] = parts
  return { marketplace, plugin, version }
}

/**
 * densable NT @213262344.
 * `Be()&&e&&np(join(ea(),"_","_","_"),ea())!==null`
 */
export function isPluginCacheStorageV5(storageV5: unknown): boolean {
  const root = getPluginCacheRoot()
  return (
    isHoverRestOn() &&
    storageV5 !== undefined &&
    isPluginCacheVersionDirPath(join(root, '_', '_', '_'), root) !== null
  )
}

/**
 * densable r_n — version-path sibling `${dest}.tmp~${hex8}`.
 */
export function stagePluginCachePath(dest: string): string {
  return `${dest}${PLUGIN_CACHE_STAGING_SUFFIX}${randomBytes(4).toString('hex')}`
}

/**
 * densable vue.
 */
export function isPluginCacheStagingName(name: string): boolean {
  return /\.tmp~[0-9a-f]{8}$/.test(name)
}

export type PluginCacheStagingKind = 'current' | 'scratch'

/**
 * densable leftover `B_` = `Mt` @205775xxx (`Mt as Xad`, `Xad as B_`).
 * `let e=\`${n}.tmp.\`; return t.startsWith(e)&&/^[0-9a-f]{8}$/.test(t.slice(e.length))`
 */
export function isPluginCacheTmpDotName(name: string, base: string): boolean {
  const e = `${base}${TMP_DOT_PREFIX}`
  return name.startsWith(e) && STAGING_HEX8.test(name.slice(e.length))
}

/**
 * densable HCo.
 * current = `${base}.tmp~` + hex8. scratch = official B_(name, base) =
 * `${base}.tmp.` + hex8 (atomic-write leftover), not the exact version name.
 */
export function classifyPluginCacheStagingName(
  name: string,
  versionBase: string,
): PluginCacheStagingKind | null {
  const prefix = versionBase + PLUGIN_CACHE_STAGING_SUFFIX
  if (name.startsWith(prefix) && STAGING_HEX8.test(name.slice(prefix.length))) {
    return 'current'
  }
  return isPluginCacheTmpDotName(name, versionBase) ? 'scratch' : null
}

/**
 * densable kq — true when the version dir has a non-reserved payload entry.
 */
export async function pluginCacheHasPayload(
  dir: string,
  opts?: { whenUnreadable?: boolean },
): Promise<boolean> {
  const whenUnreadable = opts?.whenUnreadable ?? true
  try {
    const names = await readdir(dir)
    return names.some(name => !isReservedPluginCacheEntryName(name))
  } catch (error) {
    if (isENOENT(error) || getErrnoCode(error) === 'ENOTDIR') {
      return false
    }
    if (whenUnreadable) return true
    throw error
  }
}

/**
 * densable kue — drop leftover orphan stamp, refuse if dest exists, rename.
 */
export async function publishStagedPluginCache(
  stagingPath: string,
  destPath: string,
): Promise<void> {
  await rm(join(stagingPath, PLUGIN_CACHE_STAGING_STAMP), { force: true })
  const destMissing = await lstat(destPath).then(
    () => false,
    (error: unknown) => {
      if (isAbsentPathError(error)) return true
      throw error
    },
  )
  if (!destMissing) {
    throw Object.assign(new Error('plugin cache version path is occupied'), {
      code: 'EEXIST',
    })
  }
  await rename(stagingPath, destPath)
}

/**
 * densable idt.
 */
export async function removePluginCacheStaging(
  stagingPath: string,
): Promise<void> {
  await rm(stagingPath, { recursive: true, force: true }).catch(() => {})
}

/**
 * densable Tue — drop stale `.tmp~` siblings next to a version path.
 */
export async function sweepStalePluginCacheStaging(
  versionPath: string,
): Promise<void> {
  const parent = dirname(versionPath)
  const versionBase = basename(versionPath)
  const names = await readdir(parent).catch(() => [])
  const cutoff = Date.now() - PLUGIN_CACHE_STAGING_STALE_MS
  await Promise.all(
    names.map(async name => {
      const kind = classifyPluginCacheStagingName(name, versionBase)
      if (kind === null) return
      const sibling = join(parent, name)
      const st = await lstat(sibling).catch(() => null)
      if (st === null || st.mtimeMs >= cutoff) return
      if (st.isSymbolicLink()) {
        await unlink(sibling).catch(() =>
          rm(sibling, { recursive: true, force: true }).catch(() => {}),
        )
        return
      }
      if (kind === 'scratch') {
        // Exact-base is the live version path (dir cache or .zip). Never
        // treat that artifact as leftover staging.
        return
      }
      await rm(sibling, { recursive: true, force: true }).catch(() => {})
    }),
  )
}

/** densable `uS` result. */
export type PluginCachePathKind =
  | 'absent'
  | 'other'
  | 'symlink'
  | 'unexaminable'

/** densable `GG` result. */
export type PluginCacheVersionParentProbe = 'real' | 'refused' | 'absent'

/** densable `T0o` result. */
export type PluginCacheServeDecision = 'absent' | 'serve' | 'republish'

/** densable F8 @213263549 — via jMe. */
export function pluginCacheOccupantUnexaminable(
  cachePath: string,
  pluginId: string,
  version: string,
  action = 'cache',
): Error {
  return new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
    `Could not ${action} ${pluginId} ${version}: what occupies its cache path ${cachePath} could not be examined; retry the load or the install.`,
    'plugin cache version path occupant could not be examined',
  )
}

/** densable w0o @213262470. */
function versionParentUnexaminable(versionPath: string, cause: unknown): Error {
  return new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
    `Could not examine the plugin directory of ${versionPath} (${errorMessage(cause)}); retry the install.`,
    'plugin cache version parent could not be examined',
  )
}

/**
 * densable `YC` @212701831 — the entry `name` under `dir` is not a symlink.
 * A resolving readlink means it is one; EINVAL means it is not.
 */
async function entryIsNotSymlink(dir: string, name: string): Promise<boolean> {
  const entry = join(dir, name)
  try {
    await readlink(entry)
    return false
  } catch (error) {
    if (getErrnoCode(error) === 'EINVAL') {
      return !(await lstat(entry)).isSymbolicLink()
    }
    throw error
  }
}

/**
 * densable `Sue` @212733897 — the occupant at `path` is link-like. Catches
 * the junction case where lstat still reports a directory.
 */
async function isSymlinkOccupant(path: string, st: Stats): Promise<boolean> {
  if (st.isSymbolicLink()) return true
  if (!st.isDirectory()) return false
  try {
    return !(await entryIsNotSymlink(dirname(path), basename(path)))
  } catch (error) {
    return !isENOENT(error)
  }
}

/** densable `uS` @212734131. */
export async function classifyPluginCachePath(
  path: string,
): Promise<PluginCachePathKind> {
  try {
    const st = await lstat(path)
    return (await isSymlinkOccupant(path, st)) ? 'symlink' : 'other'
  } catch (error) {
    return isENOENT(error) ? 'absent' : 'unexaminable'
  }
}

/**
 * densable `sLn` @213262912 — a real directory reached without a symlink at
 * its final component.
 */
async function isRealDirectoryEntry(path: string): Promise<boolean> {
  if (
    (await stat(path)).isDirectory() &&
    (await entryIsNotSymlink(dirname(path), basename(path)))
  ) {
    return true
  }
  const st = await lstat(path).catch((error: unknown) => {
    if (isENOENT(error) || getErrnoCode(error) === 'ELOOP') return null
    throw error
  })
  return st !== null && st.isDirectory()
}

/**
 * densable `pSt` @213262640 — the version parent is exactly two real
 * directory segments (marketplace/plugin) under the realpath'd cache root.
 */
export async function isPluginCacheVersionParentContained(
  parentPath: string,
): Promise<boolean> {
  const root = getPluginCacheRoot()
  const rel = relative(root, parentPath)
  const parts = rel.split(sep)
  if (
    !rel ||
    isAbsolute(rel) ||
    parts.length !== 2 ||
    parts.some(part => part === '' || part === '.' || part === '..')
  ) {
    return false
  }
  const [marketplace, plugin] = parts
  if (marketplace === undefined || plugin === undefined) return false
  const realRoot = await realpath(root)
  return (
    (await isRealDirectoryEntry(join(realRoot, marketplace))) &&
    (await isRealDirectoryEntry(join(realRoot, marketplace, plugin)))
  )
}

/**
 * densable `GG` @213263440 — tri-state probe of a version path's parent.
 * `real` contained; `refused` present but escaping the cache root; `absent`
 * no parent at all.
 */
export async function probePluginCacheVersionParent(
  versionPath: string,
): Promise<PluginCacheVersionParentProbe> {
  try {
    return (await isPluginCacheVersionParentContained(dirname(versionPath)))
      ? 'real'
      : 'refused'
  } catch (error) {
    if (isENOENT(error)) return 'absent'
    throw versionParentUnexaminable(versionPath, error)
  }
}

/** densable `zG` @213262395. */
export async function pluginCacheVersionParentIsReal(
  versionPath: string,
): Promise<boolean> {
  return (await probePluginCacheVersionParent(versionPath)) === 'real'
}

/**
 * densable leftover `k0o` @213347520 — vFe telemetry code by stage.
 * Fallback is the locked generic when the stage is not in the table.
 */
const PLUGIN_CACHE_VERSION_PARENT_K0O: Record<string, string> = {
  'before relink': 'plugin cache version parent not contained before relink',
  'during relink': 'plugin cache version parent not contained during relink',
  'before reuse': 'plugin cache version parent not contained before reuse',
  'before move': 'plugin cache version parent not contained before move',
  'during move': 'plugin cache version parent not contained during move',
  'before staging': 'plugin cache version parent not contained before staging',
  'before overwrite':
    'plugin cache version parent not contained before overwrite',
  'during publish': 'plugin cache version parent not contained during publish',
  'after a failed archive':
    'plugin cache version parent not contained after a failed archive',
}

/**
 * densable `vFe` @213263129 — refuse to touch a version path whose parent is
 * not a contained directory. `probe` skips the re-probe when the caller
 * already has one.
 *
 * Official keys the telemetry code off `k0o[stage]`.
 */
export async function assertPluginCacheVersionParentReal(
  versionPath: string,
  pluginId: string,
  version: string,
  action: string,
  stage: string,
  probe?: PluginCacheVersionParentProbe,
): Promise<void> {
  // densable vFe: caller-supplied probe skips re-probe. Only 'real' is ok.
  const result = probe ?? (await probePluginCacheVersionParent(versionPath))
  if (result === 'real') {
    return
  }
  logForDebugging(
    `Plugin ${pluginId} version ${version}: version parent refused ${action} (${stage})`,
    { level: 'warn' },
  )
  throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
    `Could not ${action} ${pluginId} ${version}: its plugin directory is not a directory (a dangling link, or a file wearing the marketplace or plugin folder name); make it a directory, or retry the install if it was being moved.`,
    PLUGIN_CACHE_VERSION_PARENT_K0O[stage] ??
      'plugin cache version parent not contained',
  )
}

/**
 * densable `T0o` @213264986 — serve the cached version path as-is, or
 * republish it.
 *
 * Official symlink branch: `v0o(e) ? "serve" : "republish"`.
 * `v0o` = `lSt && a0n && kq`. `lSt`→`yue`/`Zyn` @212712647.
 * `_ue` @212712253 uses `$Me`/`nx`/`Vyn`/`Gyn`/`rp` from the path-safety
 * module @204973621. `a0n`→`FLn`=`fdb`=`Ut` @210117461.
 */
const MAX_TRUSTED_ROOT_WALK_HOPS = 40
const DRIVE_RELATIVE_PATH_RE = /^[a-zA-Z]:(?![\\/])/

function currentPathPlatform(): 'windows' | 'posix' {
  return process.platform === 'win32' ? 'windows' : 'posix'
}

/** densable leftover `z_` @212711873. */
function isPathUnderRoot(path: string, root: string): boolean {
  if (path === root) return true
  const prefix = root.endsWith(sep) ? root : root + sep
  return path.startsWith(prefix)
}

/** densable leftover `PMe` @212731932. */
function splitPathSegmentsBelowRoot(path: string): string[] {
  return path
    .slice(parse(path).root.length)
    .split(sep === '\\' ? /[\\/]+/ : /\/+/)
    .filter(Boolean)
}

/** densable leftover `ge` @204979533. */
const NT_OBJECT_PREFIX_RE = /^[\\/]\?\?[\\/]/

/** densable leftover `Ce` @204979045. */
function normalizeWin32Path(path: string): string {
  return win32.normalize(path)
}

/** densable leftover `v`=`jRe` @204979045. */
function isNtObjectPath(path: string): boolean {
  return (
    NT_OBJECT_PREFIX_RE.test(path) ||
    (path.includes('??') && NT_OBJECT_PREFIX_RE.test(normalizeWin32Path(path)))
  )
}

/** densable leftover `P` @204973621. */
function isUncOrNtPath(path: string): boolean {
  return /^[\\/]{2}/.test(path) || isNtObjectPath(path)
}

/** densable leftover `ie`=`nx` @204973768. */
function stripDeviceNamespacePrefix(path: string): string | null {
  if (/^[\\/]{2}[?.][\\/](?!unc[\\/])/i.test(path)) return null
  return (
    path
      .match(/^[\\/]{2}(?:[?.][\\/]unc[\\/])?([^\\/]+)/i)?.[1]
      ?.replace(/[A-Z]/g, letter => letter.toLowerCase()) ?? null
  )
}

/** densable leftover `_e`=`Jf` @204973951. */
function hasDotOrDotDotSegment(path: string): boolean {
  return /(^|[\\/])\.{1,2}([\\/]|$)/.test(path)
}

/** densable leftover `be`=`u1` @204974008. */
function isDeviceNamespacePath(path: string): boolean {
  return /^[\\/]{2}[?.][\\/]/.test(path)
}

/** densable leftover `Hr`=`qyn` @204974058. */
function isNtGlobalDevicePath(path: string): boolean {
  return /^[\\/](GLOBAL\?\?|GLOBALROOT|DosDevices|Device)[\\/]/i.test(path)
}

/** densable leftover `Ir`=`$Me` @204975061. */
function resolveAutofsNetMountPath(path: string): string | null {
  if (!path.startsWith('/')) return null
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      parts.pop()
      continue
    }
    parts.push(seg)
    if (parts.length === 2 && parts[0]!.toLowerCase() === 'net') {
      return '/' + parts.join('/')
    }
  }
  return null
}

/** densable leftover `L`=`Qf` @204975027. */
function isAutofsNetMountPath(path: string): boolean {
  return resolveAutofsNetMountPath(path) !== null
}

/** densable leftover `Jo`=`Vyn` @204975398. */
function collectAutofsNetMountPaths(path: string): string[] {
  if (!path.startsWith('/')) return []
  const found: string[] = []
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      parts.pop()
      continue
    }
    parts.push(seg)
    if (parts.length === 2 && parts[0]!.toLowerCase() === 'net') {
      found.push(
        ('/' + parts.join('/')).replace(/[A-Z]/g, letter =>
          letter.toLowerCase(),
        ),
      )
    }
  }
  return found
}

/** densable leftover `ve`=`rp` @204975671. */
function isWslSharePath(path: string): boolean {
  return /^[\\/]{2}wsl(\$|\.localhost)[\\/]/i.test(path)
}

/** densable leftover `zr`=`Ai` @204975737. */
function isNonWslUncPath(path: string): boolean {
  return isUncOrNtPath(path) && !isWslSharePath(path)
}

/** densable leftover `Bo`=`Gyn` @204975344. */
function isUntrustedNetworkOrDevicePath(path: string): boolean {
  return (
    isNonWslUncPath(path) ||
    isAutofsNetMountPath(path) ||
    isDeviceNamespacePath(path) ||
    isNtObjectPath(path) ||
    isNtGlobalDevicePath(path)
  )
}

/**
 * densable leftover `_ue` @212712253.
 */
function createLinkSafetyChecker(trustedRoot: string): {
  spelling: (path: string) => boolean
  target: (link: string, from: string) => boolean
} {
  const fold = (path: string): string =>
    path.replace(/[A-Z]/g, letter => letter.toLowerCase())
  const netShare = (path: string): string | null => {
    const share = resolveAutofsNetMountPath(path)
    return share === null ? null : fold(share)
  }
  const trustedShare = netShare(trustedRoot)
  const trustedServer = stripDeviceNamespacePrefix(trustedRoot)
  const foreignNet = (path: string): boolean =>
    collectAutofsNetMountPaths(path).some(share => share !== trustedShare)
  const spelling = (path: string): boolean => {
    if (!isUntrustedNetworkOrDevicePath(path) && !isWslSharePath(path))
      return false
    if (
      isDeviceNamespacePath(path) ||
      isNtObjectPath(path) ||
      isNtGlobalDevicePath(path)
    )
      return true
    if (isNonWslUncPath(path) || isWslSharePath(path)) {
      const server = stripDeviceNamespacePrefix(path)
      return server === null || server !== trustedServer
    }
    if (isAutofsNetMountPath(path)) {
      return hasDotOrDotDotSegment(path) || netShare(path) !== trustedShare
    }
    return true
  }
  return {
    spelling,
    target: (link, from) =>
      spelling(link) ||
      spelling(resolve(from, link)) ||
      foreignNet(from + sep + link),
  }
}

type TrustedRootWalkOptions = {
  trustedRoot?: string
  platform?: 'win32' | 'posix'
}

/**
 * densable leftover `Zyn` @212712720.
 */
export async function walkSegmentsWithinTrustedRoot(
  start: string,
  segs: string[],
  checker: {
    spelling: (path: string) => boolean
    target: (link: string, from: string) => boolean
  },
  opts: TrustedRootWalkOptions,
  firstTarget?: string,
): Promise<'clean' | 'network' | 'unsupported' | 'dangling' | 'loop'> {
  const win =
    (opts.platform ??
      (currentPathPlatform() === 'windows' ? 'win32' : 'posix')) === 'win32'
  let cur = start
  const rest = segs.slice()
  let hops = firstTarget === undefined ? 0 : 1
  const take = (
    target: string,
    from: string,
  ): 'network' | 'unsupported' | null => {
    if (checker.target(target, from)) return 'network'
    if (win) {
      if (DRIVE_RELATIVE_PATH_RE.test(target)) return 'unsupported'
      const resolved = resolve(from, target, ...rest)
      if (checker.spelling(resolved)) return 'network'
      rest.length = 0
      const trusted = opts.trustedRoot
      if (
        trusted !== undefined &&
        (resolved === trusted || isPathUnderRoot(resolved, trusted))
      ) {
        cur = trusted
        rest.push(...splitPathSegmentsBelowRoot(relative(trusted, resolved)))
      } else {
        cur = parse(resolved).root
        if (
          trusted !== undefined &&
          cur.toLowerCase() !== parse(trusted).root.toLowerCase()
        ) {
          return 'unsupported'
        }
        rest.push(...splitPathSegmentsBelowRoot(resolved))
      }
      return null
    }
    if (isAbsolute(target)) cur = parse(target).root
    else cur = from
    rest.unshift(...splitPathSegmentsBelowRoot(target))
    return null
  }
  if (firstTarget !== undefined) {
    const first = take(firstTarget, start)
    if (first !== null) return first
  }
  while (rest.length > 0) {
    const name = rest.shift()
    if (name === undefined || name === '.') continue
    if (name === '..') {
      cur = dirname(cur)
      continue
    }
    const next = join(cur, name)
    if (checker.spelling(next)) return 'network'
    let st
    try {
      st = await lstat(next)
    } catch (error) {
      const code = getErrnoCode(error)
      if (code === 'ENOENT' || code === 'ENOTDIR') return 'dangling'
      throw error
    }
    if (st.isSymbolicLink()) {
      if (++hops > MAX_TRUSTED_ROOT_WALK_HOPS) return 'loop'
      const hop = take(await readlink(next), cur)
      if (hop !== null) return hop
      continue
    }
    if (rest.length > 0 && !st.isDirectory()) return 'dangling'
    if (win && st.isDirectory()) {
      let junction: string | null
      try {
        junction = await readlink(next)
      } catch (error) {
        const code = getErrnoCode(error)
        if (code === 'ENOENT' || code === 'ENOTDIR') return 'dangling'
        if (code !== 'EINVAL') throw error
        junction = null
      }
      if (junction !== null) {
        if (++hops > MAX_TRUSTED_ROOT_WALK_HOPS) return 'loop'
        const hop = take(junction, cur)
        if (hop !== null) return hop
        continue
      }
    }
    cur = next
  }
  return 'clean'
}

/** densable leftover `yue` @212712647. */
export async function isPathContainedInTrustedRoot(
  path: string,
  checker: {
    spelling: (path: string) => boolean
    target: (link: string, from: string) => boolean
  },
  firstTarget?: string,
  opts: TrustedRootWalkOptions = {},
): Promise<'clean' | 'network' | 'unsupported' | 'dangling' | 'loop'> {
  return walkSegmentsWithinTrustedRoot(
    dirname(path),
    [],
    checker,
    opts,
    firstTarget ?? (await readlink(path)),
  )
}

/** densable leftover `lSt` @213266040. */
export async function versionPathIsTrustedForServe(
  versionPath: string,
): Promise<boolean> {
  try {
    const [trusted, parent] = await Promise.all([
      realpath(getPluginCacheRoot()),
      realpath(dirname(versionPath)),
    ])
    return (
      (await isPathContainedInTrustedRoot(
        join(parent, basename(versionPath)),
        createLinkSafetyChecker(trusted),
        undefined,
        { trustedRoot: trusted },
      )) === 'clean'
    )
  } catch {
    return false
  }
}

export async function canServeSymlinkedVersionPath(
  versionPath: string,
): Promise<boolean> {
  return (
    (await versionPathIsTrustedForServe(versionPath)) &&
    (await versionDirHasPluginShapeMarkers(versionPath)) &&
    (await pluginCacheHasPayload(versionPath, { whenUnreadable: false }))
  )
}

/**
 * densable leftover `FLn`=`fdb`=`Ut` @210117461.
 * `pa=".claude-plugin"`, `da` dirs, `fa` files, `Ut=[pa,...da,...fa]`.
 */
const PLUGIN_SHAPE_MARKER_NAMES = [
  '.claude-plugin',
  'commands',
  'skills',
  'agents',
  'hooks',
  'themes',
  'output-styles',
  'monitors',
  'workflows',
  'SKILL.md',
  '.mcp.json',
  '.lsp.json',
] as const

/** densable leftover `eh` @212733280. */
function isMissingPathError(error: unknown): boolean {
  const code = getErrnoCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** densable leftover `o_n` @212733319 — `RX`=readdir. */
async function directoryContainsAnyMarker(
  path: string,
  markers: readonly string[],
): Promise<boolean> {
  try {
    const names = new Set(await readdir(path))
    return markers.some(name => names.has(name))
  } catch (error) {
    return !isMissingPathError(error)
  }
}

/** densable leftover `a0n` @213328435 — `o_n(e, FLn)`. */
async function versionDirHasPluginShapeMarkers(
  versionPath: string,
): Promise<boolean> {
  return directoryContainsAnyMarker(versionPath, PLUGIN_SHAPE_MARKER_NAMES)
}

export async function decidePluginCacheServe(
  versionPath: string,
  pluginId: string,
  version: string,
  linkFarm: boolean,
): Promise<PluginCacheServeDecision> {
  const kind = await classifyPluginCachePath(versionPath)
  if (kind === 'absent') return 'absent'
  if (kind === 'unexaminable') {
    throw pluginCacheOccupantUnexaminable(versionPath, pluginId, version)
  }
  if (kind === 'symlink') {
    return (await canServeSymlinkedVersionPath(versionPath))
      ? 'serve'
      : 'republish'
  }
  const serves = linkFarm
    ? await hasCommandPluginLinkFarm(versionPath)
    : await pluginCacheHasPayload(versionPath, { whenUnreadable: false })
  return serves ? 'serve' : 'republish'
}

/** densable `Qw` @212702166 — unlink, else rmdir, classifying what is left. */
async function removePathEntry(
  path: string,
): Promise<'removed' | 'absent' | 'directory'> {
  try {
    await unlink(path)
    return 'removed'
  } catch (unlinkError) {
    if (getErrnoCode(unlinkError) === 'ENOENT') return 'absent'
    try {
      await rmdir(path)
      return 'removed'
    } catch (rmdirError) {
      const code = getErrnoCode(rmdirError)
      if (code === 'ENOTEMPTY' || code === 'EEXIST') return 'directory'
      if (code === 'ENOENT') {
        const gone = await lstat(path).then(
          () => false,
          (error: unknown) => getErrnoCode(error) === 'ENOENT',
        )
        if (gone) return 'absent'
        throw unlinkError
      }
      throw code === 'ENOTDIR' ? unlinkError : rmdirError
    }
  }
}

/** densable `GLn` @213263690 — a stray link that refuses removal is fatal. */
async function removeStrayPluginCacheLink(
  path: string,
  pluginId: string,
  version: string,
  action: string,
  slot: 'cache' | 'archive',
): Promise<void> {
  if ((await removePathEntry(path).catch(() => 'directory')) !== 'directory') {
    return
  }
  throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
    slot === 'archive'
      ? `Could not ${action} ${pluginId} ${version}: a link sits at its archive path and could not be removed; remove that link from the plugin cache, then retry the install.`
      : `Could not ${action} ${pluginId} ${version}: a link sits at its cache path and could not be removed; remove that link from the plugin cache, then retry the install.`,
    slot === 'archive'
      ? 'plugin cache stray link at the archive path not removable'
      : 'plugin cache stray link not removable before replace',
  )
}

/**
 * densable `TFe` @213264030 — clear whatever occupies a version path before
 * replacing it. `recurse` means a real directory is still there to remove.
 */
export async function clearPluginCacheOccupant(
  versionPath: string,
  pluginId: string,
  version: string,
  action = 'cache',
): Promise<'done' | 'recurse'> {
  switch (await classifyPluginCachePath(versionPath)) {
    case 'absent':
      return 'done'
    case 'other':
      return 'recurse'
    case 'symlink':
      await removeStrayPluginCacheLink(
        versionPath,
        pluginId,
        version,
        action,
        'cache',
      )
      logForDebugging(
        `Plugin ${pluginId} version ${version}: removed a link at its cache path ${versionPath} as an entry before replacing it`,
      )
      return 'done'
    default:
      throw pluginCacheOccupantUnexaminable(
        versionPath,
        pluginId,
        version,
        action,
      )
  }
}

/**
 * densable Kjo @214631090.
 * `t==="EXDEV"||t!==void 0&&RNn.has(t)`
 * RNn = Ved = mt = EPERM|EBUSY|EACCES (not CQ EEXIST).
 */
export function isPluginCacheAsideRenameFallback(error: unknown): boolean {
  const code = getErrnoCode(error)
  return (
    code === 'EXDEV' || (code !== undefined && RENAME_TRANSIENT_CODES.has(code))
  )
}

export type PluginCacheDestMoveOpts = {
  pluginId: string
  version: string
  strictCache?: boolean
}

/**
 * densable Yjo @214631161 file-calls path (after the V5 `Ne&&r&&o` prefix).
 *
 * Occupant: BOe aside rename + $jo lutimes; Kjo → official log + rm in
 * place; kg (ENOENT|ENOTDIR) swallows. Then src→dest (temp hop if dest
 * is under src); restore aside on fail; rm aside on success.
 *
 * V5 prefix (`Rx`/`moveScope`/`Wjo`/`qjo`) is official `r!==void 0&&
 * o!==void 0`. This helper is the dest publish Fjo always calls. No
 * `version==="unknown"` skip-rm gate.
 */
export async function movePluginCacheDest(
  src: string,
  dest: string,
  opts: PluginCacheDestMoveOpts,
): Promise<void> {
  const strictCache = opts.strictCache === true
  const assertParent = (
    stage = 'before move',
    probe?: PluginCacheVersionParentProbe,
  ) =>
    assertPluginCacheVersionParentReal(
      dest,
      opts.pluginId,
      opts.version,
      'cache',
      stage,
      probe,
    )
  if (strictCache) {
    const probe = await probePluginCacheVersionParent(dest)
    if (probe === 'refused') await assertParent('before move', probe)
  }
  await getFsImplementation().mkdir(dirname(dest))
  if (strictCache) await assertParent()
  let aside: string | undefined
  if (
    !strictCache ||
    (await clearPluginCacheOccupant(dest, opts.pluginId, opts.version)) ===
      'recurse'
  ) {
    const asidePath = stagePluginCachePath(dest)
    try {
      await renameWithRetry(dest, asidePath)
      aside = asidePath
      const stamped = new Date()
      await lutimes(asidePath, stamped, stamped).catch(() => {})
    } catch (error) {
      if (isPluginCacheAsideRenameFallback(error)) {
        logForDebugging(
          `The occupant of ${dest} cannot be renamed aside (${getErrnoCode(error)}); removing it in place instead`,
          { level: 'debug' },
        )
        await rm(dest, { recursive: true, force: true })
      } else if (!isAbsentPathError(error)) {
        throw error
      }
    }
  }
  const srcPrefix = src.endsWith(sep) ? src : src + sep
  const destUnderSrc = dest.startsWith(srcPrefix)
  let from = src
  try {
    if (destUnderSrc) {
      const hop = join(
        dirname(src),
        `.claude-plugin-temp-${Date.now()}-${randomBytes(4).toString('hex')}`,
      )
      await renameWithRetry(src, hop)
      await getFsImplementation().mkdir(dirname(dest))
      from = hop
    }
    if (strictCache) await assertParent('during move')
    await renameWithRetry(from, dest)
  } catch (error) {
    if (aside !== undefined) {
      await renameWithRetry(aside, dest).catch(() => {})
    }
    throw error
  }
  if (aside !== undefined) {
    await rm(aside, { recursive: true, force: true }).catch(() => {})
  }
}
