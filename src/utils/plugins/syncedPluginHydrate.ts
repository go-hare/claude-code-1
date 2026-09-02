/**
 * densable T0r / jXl / W1h — hydrate `qMr` from local
 * `~/.claude/plugins/synced/`.
 *
 * Official `zXl` is cloud list + download (`AZn` / `Uln` / `x1h`). This
 * module is the local-only side: T0r disk hydrate + iVE extract walk.
 * Do not invent a cloud download client.
 */

import { lstat, readdir, readFile, stat } from 'fs/promises'
import { dirname, isAbsolute, join, relative } from 'path'
import {
  getSyncedPluginDirs,
  setSyncedPluginDirs,
} from '../../bootstrap/state.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getPluginsDirectory } from './pluginDirectories.js'
import { auditSyncedRoot } from './syncedPluginSyncFs.js'
import {
  foldSyncedPathKey,
  isSyncedZipReservedSegment,
  resolveSyncedPluginDir,
  SYNCED_MANIFEST_LEAF,
  SYNCED_STAGING_DIRNAME,
  SYNCED_TRASH_DIRNAME,
} from './syncedPluginSyncNames.js'

/** densable `N1e` / `Usr` — `join("plugins", "synced")`. */
export const SYNCED_PLUGINS_DIRNAME = 'synced'

/** densable `uGe`. */
export const SYNCED_PLUGINS_MANIFEST = SYNCED_MANIFEST_LEAF

/** densable `Usr` posix label for A8e events. */
export const SYNCED_PLUGINS_ROOT_LABEL = join('plugins', SYNCED_PLUGINS_DIRNAME)

/** densable `En()` analog when the plugins dir lives under config home. */
export function getSyncedConfigHome(
  pluginsDir: string = getPluginsDirectory(),
): string {
  const home = getClaudeConfigHomeDir()
  const rel = relative(home, pluginsDir)
  if (!rel.startsWith('..') && !isAbsolute(rel)) return home
  return dirname(pluginsDir)
}

/** densable `_as` — `join(En(), "plugins", ".trash")`. */
export function getSyncedPluginsTrashRoot(
  pluginsDir: string = getPluginsDirectory(),
): string {
  return join(pluginsDir, SYNCED_TRASH_DIRNAME)
}

/** densable `Vyo`. */
export function getSyncedStagingDir(
  root: string = getSyncedPluginsRoot(),
): string {
  return join(root, SYNCED_STAGING_DIRNAME, String(process.pid))
}

export function getSyncedPluginsRoot(
  pluginsDir: string = getPluginsDirectory(),
): string {
  return join(pluginsDir, SYNCED_PLUGINS_DIRNAME)
}

export function getSyncedPluginsManifestPath(
  pluginsDir: string = getPluginsDirectory(),
): string {
  return join(getSyncedPluginsRoot(pluginsDir), SYNCED_PLUGINS_MANIFEST)
}

/**
 * densable W1h — unique `A0r(name)` dirs under `dPe()`.
 * Joins only. Does not `stat` plugin leaves — official `jXl` is `qMr(W1h(t.plugins))`.
 * Missing dirs stay in the list; `loadSyncedPlugins` / `Zpf` reports `path-not-found`.
 */
export function dirsFromSyncedManifest(
  plugins: ReadonlyArray<{ name?: unknown }>,
  root: string,
): string[] {
  const dirs: string[] = []
  const seen = new Set<string>()
  for (const plugin of plugins) {
    if (typeof plugin.name !== 'string' || plugin.name.length === 0) continue
    let dir: string
    try {
      dir = resolveSyncedPluginDir(plugin.name, root)
    } catch {
      continue
    }
    const key = foldSyncedPathKey(dir)
    if (seen.has(key)) continue
    seen.add(key)
    dirs.push(dir)
  }
  return dirs
}

type HydrateIo = {
  getDirs?: () => readonly string[]
  setDirs?: (dirs: string[]) => void
  root?: string
  readFile?: (path: string) => Promise<string>
  stat?: (path: string) => Promise<{ isDirectory(): boolean }>
}

/**
 * densable T0r: skip when `lQt()` is already set; else read cache and `qMr`.
 * `stat` is the root (`A8e` "real") only — not each W1h leaf.
 */
export async function hydrateSyncedPluginDirsFromDisk(
  io: HydrateIo = {},
): Promise<void> {
  const getDirs = io.getDirs ?? getSyncedPluginDirs
  if (getDirs().length > 0) return

  const root = io.root ?? getSyncedPluginsRoot()
  const statFn = io.stat ?? stat
  // densable T0r: A8e must be "real" (not symlink / stray file / absent).
  if (io.stat === undefined && io.root === undefined) {
    const kind = await auditSyncedRoot(root, getSyncedConfigHome(), {
      event: 'plugins_sync_root_refused',
      phase: 'read',
      rootLabel: SYNCED_PLUGINS_ROOT_LABEL,
    }).catch(() => null)
    if (kind !== 'real') return
  } else {
    try {
      const st = await statFn(root)
      if (!st.isDirectory()) return
    } catch {
      return
    }
  }

  const manifestPath = join(root, SYNCED_PLUGINS_MANIFEST)
  const read = io.readFile ?? ((p: string) => readFile(p, 'utf8'))
  let raw: string | undefined
  try {
    raw = await read(manifestPath)
  } catch {
    raw = undefined
  }

  if (raw === undefined) return

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return
  }
  if (!parsed || typeof parsed !== 'object') return
  const plugins = (parsed as { plugins?: unknown }).plugins
  if (plugins !== undefined && !Array.isArray(plugins))
    return // densable jXl: Kyo ok → qMr(W1h(t.plugins)). No readdir fallback.
  ;(io.setDirs ?? setSyncedPluginDirs)(
    dirsFromSyncedManifest(Array.isArray(plugins) ? plugins : [], root),
  )
}

/** densable eVE — 512MiB extract walk cap. */
export const SYNCED_EXTRACT_MAX_BYTES = 536870912
const IVE_STAT_BATCH = 256
const IVE_DIR_BATCH = 16

/**
 * densable iVE — walk an extracted synced plugin tree.
 * Stops on symlink / reserved leaf / oversize. No network.
 */
export async function auditSyncedExtractTree(
  root: string,
  maxBytes: number = SYNCED_EXTRACT_MAX_BYTES,
): Promise<'ok' | 'symlink' | 'reserved' | 'oversize'> {
  let bytes = 0
  let cause: 'symlink' | 'reserved' | 'oversize' | undefined

  async function statFiles(files: string[]): Promise<void> {
    for (let i = 0; i < files.length && !cause; i += IVE_STAT_BATCH) {
      const chunk = files.slice(i, i + IVE_STAT_BATCH)
      for (const st of await Promise.all(chunk.map(p => lstat(p)))) {
        bytes += st.size
        if (bytes > maxBytes) {
          cause = 'oversize'
          return
        }
      }
    }
  }

  async function walkDirs(dirs: string[]): Promise<void> {
    for (let i = 0; i < dirs.length && !cause; i += IVE_DIR_BATCH) {
      await Promise.all(dirs.slice(i, i + IVE_DIR_BATCH).map(walk))
    }
  }

  async function walk(dir: string): Promise<void> {
    if (cause) return
    const nested: string[] = []
    const files: string[] = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        cause = 'symlink'
        return
      }
      // densable iVE reserved = MHa (`.git` after jx), not `.trash` / manifest
      if (isSyncedZipReservedSegment(entry.name)) {
        cause = 'reserved'
        return
      }
      const full = join(dir, entry.name)
      if (entry.isDirectory()) nested.push(full)
      else files.push(full)
    }
    if (cause) return
    await Promise.all([statFiles(files), walkDirs(nested)])
  }

  await walk(root)
  return cause ?? 'ok'
}
