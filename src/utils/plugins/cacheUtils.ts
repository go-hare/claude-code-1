import { lstat, readdir, rm, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { clearCommandsCache } from '../../commands.js'
import { clearAllOutputStylesCache } from '../../constants/outputStyles.js'
import { clearAgentDefinitionsCache } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { clearPromptCache } from '@claude-code/builtin-tools/tools/SkillTool/prompt.js'
import { resetSentSkillNames } from '../attachments.js'
import { logForDebugging } from '../debug.js'
import { getErrnoCode } from '../errors.js'
import { logError } from '../log.js'
import { loadInstalledPluginsFromDisk } from './installedPluginsManager.js'
import { clearPluginAgentCache } from './loadPluginAgents.js'
import { clearPluginCommandCache } from './loadPluginCommands.js'
import {
  clearPluginHookCache,
  pruneRemovedPluginHooks,
} from './loadPluginHooks.js'
import { clearPluginOutputStyleCache } from './loadPluginOutputStyles.js'
import { clearPluginCache, getPluginCachePath } from './pluginLoader.js'
import { clearPluginOptionsCache } from './pluginOptionsStorage.js'
import { isPluginZipCacheEnabled } from './zipCache.js'

const ORPHANED_AT_FILENAME = '.orphaned_at'
const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export function clearAllPluginCaches(): void {
  clearPluginCache()
  clearPluginCommandCache()
  clearPluginAgentCache()
  clearPluginHookCache()
  // Prune hooks from plugins no longer in the enabled set so uninstalled/
  // disabled plugins stop firing immediately (gh-36995). Prune-only: hooks
  // from newly-enabled plugins are NOT added here — they wait for
  // /reload-plugins like commands/agents/MCP do. Fire-and-forget: old hooks
  // stay valid until the prune completes (preserves gh-29767). No-op when
  // STATE.registeredHooks is empty (test/preload.ts beforeEach clears it via
  // resetStateForTests before reaching here).
  pruneRemovedPluginHooks().catch(e => logError(e))
  clearPluginOptionsCache()
  clearPluginOutputStyleCache()
  clearAllOutputStylesCache()
}

export function clearAllCaches(): void {
  clearAllPluginCaches()
  clearCommandsCache()
  clearAgentDefinitionsCache()
  clearPromptCache()
  resetSentSkillNames()
}

/**
 * densable YEt — true when path is a symlink (or lstat fails → not treated as
 * symlink only on success; failures return false so normal mark path runs).
 */
async function isSymlinkedPluginVersion(versionPath: string): Promise<boolean> {
  try {
    return (await lstat(versionPath)).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Mark a plugin version as orphaned.
 * Called when a plugin is uninstalled or updated to a new version.
 * densable Mst: never mark a symlinked plugin version (dev/link installs).
 */
export async function markPluginVersionOrphaned(
  versionPath: string,
): Promise<void> {
  // densable: if (await YEt(e)) { w(`Not marking a symlinked plugin version: ${e}`); return }
  if (await isSymlinkedPluginVersion(versionPath)) {
    logForDebugging(`Not marking a symlinked plugin version: ${versionPath}`)
    return
  }
  try {
    await writeFile(getOrphanedAtPath(versionPath), `${Date.now()}`, 'utf-8')
  } catch (error) {
    logForDebugging(`Failed to write .orphaned_at: ${versionPath}: ${error}`)
  }
}

/**
 * Clean up orphaned plugin versions that have been orphaned for more than 7 days.
 *
 * Pass 1: Remove .orphaned_at from installed versions (clears stale markers)
 * Pass 2: For each cached version not in installed_plugins.json:
 *   - If no .orphaned_at exists: create it (handles old CC versions, manual edits)
 *   - If .orphaned_at exists and > 7 days old: delete the version
 */
export async function cleanupOrphanedPluginVersionsInBackground(): Promise<void> {
  // Zip cache mode stores plugins as .zip files, not directories. readSubdirs
  // filters to directories only, so removeIfEmpty would see plugin dirs as empty
  // and delete them (including the ZIPs). Skip cleanup entirely in zip mode.
  if (isPluginZipCacheEnabled()) {
    return
  }
  try {
    const installedVersions = getInstalledVersionPaths()
    if (!installedVersions) return

    const cachePath = getPluginCachePath()

    const now = Date.now()

    // Pass 1: Remove .orphaned_at from installed versions
    // This handles cases where a plugin was reinstalled after being orphaned
    await Promise.all(
      [...installedVersions].map(p => removeOrphanedAtMarker(p)),
    )

    // Pass 2: Process orphaned versions
    for (const marketplace of await readSubdirs(cachePath)) {
      const marketplacePath = join(cachePath, marketplace)

      for (const plugin of await readSubdirs(marketplacePath)) {
        const pluginPath = join(marketplacePath, plugin)

        for (const version of await readSubdirs(pluginPath)) {
          const versionPath = join(pluginPath, version)
          if (installedVersions.has(versionPath)) continue
          await processOrphanedPluginVersion(versionPath, now)
        }

        await removeIfEmpty(pluginPath)
      }

      await removeIfEmpty(marketplacePath)
    }
  } catch (error) {
    logForDebugging(`Plugin cache cleanup failed: ${error}`)
  }
}

function getOrphanedAtPath(versionPath: string): string {
  return join(versionPath, ORPHANED_AT_FILENAME)
}

async function removeOrphanedAtMarker(versionPath: string): Promise<void> {
  // densable o5b: if (await YEt(e)) return
  if (await isSymlinkedPluginVersion(versionPath)) return
  const orphanedAtPath = getOrphanedAtPath(versionPath)
  try {
    await unlink(orphanedAtPath)
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') return
    logForDebugging(`Failed to remove .orphaned_at: ${versionPath}: ${error}`)
  }
}

function getInstalledVersionPaths(): Set<string> | null {
  try {
    const paths = new Set<string>()
    const diskData = loadInstalledPluginsFromDisk()
    for (const installations of Object.values(diskData.plugins)) {
      for (const entry of installations) {
        paths.add(entry.installPath)
      }
    }
    return paths
  } catch (error) {
    logForDebugging(`Failed to load installed plugins: ${error}`)
    return null
  }
}

async function processOrphanedPluginVersion(
  versionPath: string,
  now: number,
): Promise<void> {
  // densable s5b: if (await YEt(e)) return — never orphan/delete symlink installs
  if (await isSymlinkedPluginVersion(versionPath)) return

  const orphanedAtPath = getOrphanedAtPath(versionPath)

  let orphanedAt: number
  try {
    orphanedAt = (await stat(orphanedAtPath)).mtimeMs
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {
      await markPluginVersionOrphaned(versionPath)
      return
    }
    logForDebugging(`Failed to stat orphaned marker: ${versionPath}: ${error}`)
    return
  }

  if (now - orphanedAt > CLEANUP_AGE_MS) {
    try {
      await rm(versionPath, { recursive: true, force: true })
    } catch (error) {
      logForDebugging(
        `Failed to delete orphaned version: ${versionPath}: ${error}`,
      )
    }
  }
}

async function removeIfEmpty(dirPath: string): Promise<void> {
  if ((await listPluginCacheSubdirs(dirPath)).length === 0) {
    try {
      await rm(dirPath, { recursive: true, force: true })
    } catch (error) {
      logForDebugging(`Failed to remove empty dir: ${dirPath}: ${error}`)
    }
  }
}

/**
 * Enumerate plugin-cache children that count as installs.
 * Include directory entries AND symlinks (dev/link installs are often
 * symlink-to-dir). `Dirent.isDirectory()` is false for the symlink entry
 * itself — filtering directories-only made sole-symlink installs look empty
 * so `removeIfEmpty` deleted the parent marketplace/plugin folder.
 * Exported for regression tests.
 */
export async function listPluginCacheSubdirs(
  dirPath: string,
): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries
      .filter(d => d.isDirectory() || d.isSymbolicLink())
      .map(d => d.name)
  } catch {
    return []
  }
}

/** @deprecated internal alias — prefer listPluginCacheSubdirs */
async function readSubdirs(dirPath: string): Promise<string[]> {
  return listPluginCacheSubdirs(dirPath)
}
