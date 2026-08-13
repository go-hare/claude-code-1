/**
 * densable 2.1.229 #16 — plugin cache liveness markers (`.in_use` / `.in_use-links`).
 *
 * densable symbols (SEA 2.1.229):
 * - `Ume` = `.in_use`, `STn` = `.in_use-links`, `Z9s` = `.last_inuse_sweep`, `TId` = 1 day
 * - `IId` write pid marker on load; `vId` + `$6_` process.exit cleanup
 * - `PId` daily sweep; `vTn`/`wId` drop dead PIDs, report live users
 * - orphan GC skips delete when `vTn` finds a live session
 *
 * One-shot `claude plugin …` must not leave stray liveness files: exit handler
 * unlinks this process's marker paths.
 */

import { lstatSync, readdirSync, realpathSync, unlinkSync } from 'fs'
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'path'
import { logForDebugging } from '../debug.js'
import { getErrnoCode, isENOENT } from '../errors.js'
import {
  buildProcessStartIdentityFields,
  getProcessLstartString,
  isProcessRunning,
  pickProcessStartIdentity,
  processStartIdentityEquals,
} from '../genericProcessUtils.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { getPluginsDirectory } from './pluginDirectories.js'

function getPluginCachePathLocal(): string {
  return join(getPluginsDirectory(), 'cache')
}

/** densable Ume */
export const IN_USE_DIRNAME = '.in_use'
/** densable STn */
export const IN_USE_LINKS_DIRNAME = '.in_use-links'
/** densable Z9s */
export const LAST_INUSE_SWEEP_FILENAME = '.last_inuse_sweep'
/** densable TId — skip full sweep more than once per day */
export const IN_USE_SWEEP_INTERVAL_MS = 86_400_000

export type InUseMarkerPayload = {
  pid: number
  procStart?: string
  procStartFt?: string
}

type OwnMarkerState = {
  ownInUseMarkerPaths: Set<string>
  inUseMarkerCleanup: (() => void) | undefined
}

const ownMarkerState: OwnMarkerState = {
  ownInUseMarkerPaths: new Set(),
  inUseMarkerCleanup: undefined,
}

/** Test seam */
export function _resetPluginInUseMarkersForTesting(): void {
  ownMarkerState.inUseMarkerCleanup?.()
  ownMarkerState.inUseMarkerCleanup = undefined
  ownMarkerState.ownInUseMarkerPaths.clear()
}

export function getOwnInUseMarkerPathsForTesting(): ReadonlySet<string> {
  return ownMarkerState.ownInUseMarkerPaths
}

async function isSymlinkedPluginVersion(versionPath: string): Promise<boolean> {
  try {
    return (await lstat(versionPath)).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * densable RId — map cache version path → pluginsDir/.in_use-links/<m>/<p>/<v>
 * when the version path is a three-segment relative path under cache/.
 */
export function resolveInUseLinksMarkerDir(
  versionPath: string,
): string | undefined {
  const pluginsDir = getPluginsDirectory()
  const cachePath = join(pluginsDir, 'cache')
  const rel = relative(cachePath, versionPath)
  const parts = rel.split(sep)
  if (
    parts.length !== 3 ||
    parts.some(p => p === '' || p === '.' || p === '..')
  ) {
    return undefined
  }
  return join(pluginsDir, IN_USE_LINKS_DIRNAME, ...parts)
}

/** densable kId — path lives under pluginsDir/.in_use-links/ */
function isUnderInUseLinks(path: string): boolean {
  const base = join(getPluginsDirectory(), IN_USE_LINKS_DIRNAME)
  const rel = relative(base, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * densable z6_ — mkdir each segment under pluginsDir, refusing path that
 * realpath-escapes the plugins directory (symlink redirect).
 */
async function ensurePathInsidePluginsDir(targetDir: string): Promise<boolean> {
  const pluginsDir = getPluginsDirectory()
  try {
    let realCursor = await realpath(pluginsDir)
    let logical = pluginsDir
    const rel = relative(pluginsDir, targetDir)
    if (rel === '') return true
    if (rel.startsWith('..') || isAbsolute(rel)) return false
    for (const part of rel.split(sep)) {
      if (part === '' || part === '.') continue
      logical = join(logical, part)
      realCursor = join(realCursor, part)
      try {
        await mkdir(logical)
      } catch (err) {
        const code = getErrnoCode(err)
        if (code !== 'EEXIST') throw err
      }
      if ((await realpath(logical)) !== realCursor) return false
    }
    return true
  } catch {
    return false
  }
}

async function pathResolvesInsidePluginsDir(path: string): Promise<boolean> {
  try {
    const pluginsDir = getPluginsDirectory()
    const realPath = await realpath(path)
    const expected = join(
      await realpath(pluginsDir),
      relative(pluginsDir, path),
    )
    return realPath === expected
  } catch {
    return false
  }
}

function pathResolvesInsidePluginsDirSync(path: string): boolean {
  try {
    const pluginsDir = getPluginsDirectory()
    return (
      realpathSync(path) ===
      join(realpathSync(pluginsDir), relative(pluginsDir, path))
    )
  } catch {
    return false
  }
}

function dirnameIsSafeForCleanupSync(dir: string): boolean {
  if (isUnderInUseLinks(dir)) {
    return pathResolvesInsidePluginsDirSync(dir)
  }
  try {
    return lstatSync(dir).isDirectory()
  } catch {
    return false
  }
}

/** densable s_t — atomic write siblings: `<pid>.tmp.<8 hex>` */
function isTmpSiblingName(name: string, baseName: string): boolean {
  const prefix = `${baseName}.tmp.`
  return (
    name.startsWith(prefix) && /^[0-9a-f]{8}$/.test(name.slice(prefix.length))
  )
}

/** densable AId */
function listOwnMarkerNames(entries: string[], markerPath: string): string[] {
  const base = markerPath.split(sep).pop() ?? ''
  return entries.filter(name => isTmpSiblingName(name, base))
}

/** densable $6_ — sync exit cleanup of this process's markers */
function cleanupOwnInUseMarkersSync(): void {
  for (const markerPath of ownMarkerState.ownInUseMarkerPaths) {
    const dir = dirname(markerPath)
    if (!dirnameIsSafeForCleanupSync(dir)) continue
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      // ignore
    }
    const baseName = markerPath.split(sep).pop()!
    for (const name of [...listOwnMarkerNames(entries, markerPath), baseName]) {
      try {
        unlinkSync(join(dir, name))
      } catch {
        // ignore
      }
    }
  }
  ownMarkerState.ownInUseMarkerPaths.clear()
}

/** densable vId — track marker path + install process.exit cleanup once */
function registerOwnInUseMarker(markerPath: string): void {
  ownMarkerState.ownInUseMarkerPaths.add(markerPath)
  if (ownMarkerState.inUseMarkerCleanup) return
  const onExit = (): void => {
    cleanupOwnInUseMarkersSync()
  }
  process.on('exit', onExit)
  ownMarkerState.inUseMarkerCleanup = () => {
    process.off('exit', onExit)
  }
}

async function buildMarkerPayload(): Promise<InUseMarkerPayload> {
  const identity = await getProcessLstartString(process.pid)
  return {
    pid: process.pid,
    ...buildProcessStartIdentityFields(identity),
  }
}

/**
 * densable IId — write `.in_use/<pid>` (or `.in_use-links/.../<pid>` for symlink installs).
 */
export async function markPluginVersionInUse(
  versionPath: string,
): Promise<void> {
  if (await isSymlinkedPluginVersion(versionPath)) {
    const linkDir = resolveInUseLinksMarkerDir(versionPath)
    if (linkDir === undefined) return
    const markerPath = join(linkDir, String(process.pid))
    try {
      if (!(await ensurePathInsidePluginsDir(linkDir))) {
        logForDebugging(
          `Not writing an ${IN_USE_LINKS_DIRNAME} marker: ${linkDir} does not resolve inside the plugins directory`,
        )
        return
      }
      registerOwnInUseMarker(markerPath)
      const payload = await buildMarkerPayload()
      await writeFile(markerPath, jsonStringify(payload), 'utf-8')
    } catch (err) {
      logForDebugging(
        `Failed to write ${IN_USE_LINKS_DIRNAME} marker: ${versionPath}: ${err}`,
      )
    }
    return
  }

  const inUseDir = join(versionPath, IN_USE_DIRNAME)
  const markerPath = join(inUseDir, String(process.pid))
  registerOwnInUseMarker(markerPath)
  try {
    await mkdir(inUseDir, { recursive: true })
    const payload = await buildMarkerPayload()
    await writeFile(markerPath, jsonStringify(payload), 'utf-8')
  } catch (err) {
    logForDebugging(
      `Failed to write ${IN_USE_DIRNAME} marker: ${versionPath}: ${err}`,
    )
  }
}

/**
 * densable Nq_ — mark enabled cache-resident plugin versions + daily sweep.
 * Only paths under getPluginCachePath() (not .zip, not session/builtin outside cache).
 */
export async function markEnabledPluginVersionsInUse(
  plugins: ReadonlyArray<{ path?: string | null }>,
): Promise<void> {
  const cachePath = getPluginCachePathLocal()
  const versionPaths = plugins.flatMap(p => {
    if (!p.path || p.path.endsWith('.zip')) return []
    const rel = relative(cachePath, p.path)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      return []
    }
    return [p.path]
  })
  await Promise.all(versionPaths.map(p => markPluginVersionInUse(p)))
  await sweepInUseMarkersForVersions(versionPaths)
}

/**
 * densable PId — at most once per day, sweep dead markers under each version.
 */
export async function sweepInUseMarkersForVersions(
  versionPaths: readonly string[],
): Promise<void> {
  if (versionPaths.length === 0) return
  const stampPath = join(getPluginsDirectory(), LAST_INUSE_SWEEP_FILENAME)
  try {
    const st = await stat(stampPath)
    if (Date.now() - st.mtimeMs < IN_USE_SWEEP_INTERVAL_MS) return
  } catch {
    // missing stamp → sweep
  }
  const results = await Promise.allSettled(
    versionPaths.map(p => pluginVersionHasLiveUsers(p)),
  )
  for (const [i, r] of results.entries()) {
    if (r.status === 'rejected') {
      logForDebugging(
        `Failed to sweep ${IN_USE_DIRNAME}: ${versionPaths[i]}: ${r.reason}`,
      )
    }
  }
  try {
    await writeFile(stampPath, new Date().toISOString(), 'utf-8')
  } catch (err) {
    logForDebugging(`Failed to stamp ${LAST_INUSE_SWEEP_FILENAME}: ${err}`)
  }
}

function parseMarkerPayload(raw: string): InUseMarkerPayload | null {
  try {
    const v = jsonParse(raw) as unknown
    if (!v || typeof v !== 'object') return null
    const pid = (v as { pid?: unknown }).pid
    if (typeof pid !== 'number' || !Number.isFinite(pid)) return null
    const out: InUseMarkerPayload = { pid }
    const ps = (v as { procStart?: unknown }).procStart
    const pft = (v as { procStartFt?: unknown }).procStartFt
    if (typeof ps === 'string') out.procStart = ps
    if (typeof pft === 'string') out.procStartFt = pft
    return out
  } catch {
    return null
  }
}

/**
 * densable EL + vfe — process still matches marker identity.
 * densable: if expected identity undefined → true; else match current lstart.
 */
async function markerProcessStillAlive(
  payload: InUseMarkerPayload,
): Promise<boolean> {
  const expected = pickProcessStartIdentity(payload)
  if (expected === undefined) return true
  const current = await getProcessLstartString(payload.pid)
  return processStartIdentityEquals(expected, current)
}

/**
 * densable wId — readdir marker dir, drop dead/empty/tmp, return true if any live.
 */
async function sweepMarkerDir(
  markerDir: string,
  opts?: { excludeSelf?: boolean },
): Promise<boolean> {
  let entries: string[]
  try {
    entries = await readdir(markerDir)
  } catch (err) {
    if (isENOENT(err)) return false
    throw err
  }
  let hasLive = false
  for (const name of entries) {
    if (name.includes('.tmp.')) {
      hasLive = true
      continue
    }
    const markerPath = join(markerDir, name)
    let raw: string | undefined
    try {
      raw = await readFile(markerPath, 'utf-8')
    } catch {
      // unreadable → treat as dead and try remove below
    }
    if (raw === '') {
      hasLive = true
      continue
    }
    const payload = raw === undefined ? null : parseMarkerPayload(raw)
    if (opts?.excludeSelf && payload && payload.pid === process.pid) {
      continue
    }
    if (
      payload &&
      (payload.pid === 1 || isProcessRunning(payload.pid)) &&
      (await markerProcessStillAlive(payload))
    ) {
      hasLive = true
      continue
    }
    try {
      await rm(markerPath, { force: true })
    } catch {
      // ignore
    }
  }
  return hasLive
}

/**
 * densable vTn — true when version still has live in-use markers (after sweep).
 * Symlink installs use `.in_use-links` mirror path.
 */
export async function pluginVersionHasLiveUsers(
  versionPath: string,
  opts?: { excludeSelf?: boolean },
): Promise<boolean> {
  if (await isSymlinkedPluginVersion(versionPath)) {
    const linkDir = resolveInUseLinksMarkerDir(versionPath)
    if (linkDir === undefined) return false
    const inside = await pathResolvesInsidePluginsDir(linkDir)
    if (!inside) {
      // densable xId: absent → false; redirected → log + false
      try {
        await realpath(linkDir)
        logForDebugging(
          `Not scanning ${IN_USE_LINKS_DIRNAME}: ${linkDir} does not resolve inside the plugins directory`,
        )
      } catch {
        // absent
      }
      return false
    }
    return sweepMarkerDir(linkDir, opts)
  }
  return sweepMarkerDir(join(versionPath, IN_USE_DIRNAME), opts)
}
