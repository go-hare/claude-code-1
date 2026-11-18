import { isAbsolute, join, relative, sep } from 'path'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { pathExists } from '../file.js'
import { isValidStoragePathSegment } from '../sessionNameJobSidecar.js'
import { isHoverRestOn } from '../storageV5/hoverRestPin.js'

export type StorageV5ScopeKindHost = {
  scopeKind: (
    scope: {
      namespace: 'pluginCache'
      marketplace: string
      plugin: string
      version: string
    },
    opts: { resolveLink: boolean },
  ) => Promise<{
    ok: boolean
    value?: { kind?: string; linkResolves?: boolean }
  }>
}

export function isStorageV5ScopeKindHost(
  value: unknown,
): value is StorageV5ScopeKindHost {
  return (
    typeof value === 'object' &&
    value !== null &&
    'scopeKind' in value &&
    typeof (value as { scopeKind?: unknown }).scopeKind === 'function'
  )
}

export function getPluginCacheDir(): string {
  return join(getClaudeConfigHomeDir(), 'plugins', 'cache')
}

/**
 * Gold `rse` + `g`: anchor `pluginRoot` to `getPluginCacheDir()` with exact
 * 3-segment `<marketplace>/<plugin>/<version>` (non-`.zip`, valid segments).
 */
export function parsePluginCacheIdentity(
  pluginRoot: string,
  cacheDir: string = getPluginCacheDir(),
): { marketplace: string; plugin: string; version: string } | null {
  if (cacheDir !== getPluginCacheDir()) {
    return null
  }
  const rel = relative(cacheDir, pluginRoot)
  if (
    rel === '' ||
    rel === '..' ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  ) {
    return null
  }
  const parts = rel.split(sep)
  if (join(cacheDir, ...parts) !== pluginRoot) {
    return null
  }
  if (
    parts.length !== 3 ||
    !parts.every(isValidStoragePathSegment) ||
    parts[2]!.endsWith('.zip')
  ) {
    return null
  }
  const [marketplace, plugin, version] = parts
  return { marketplace: marketplace!, plugin: plugin!, version: version! }
}

/**
 * densable jIs(storageV5, pluginRoot) @216801547 / gold `nhs`.
 * Official: Q() && e !== void 0 → rse(n, _ge()) → scopeKind(pluginCache); else pathExists.
 * Host is createLocalFsBackend when hover-rest pinned.
 */
export async function pluginDirectoryExists(
  storageV5: unknown,
  pluginRoot: string,
): Promise<boolean> {
  if (isHoverRestOn() && isStorageV5ScopeKindHost(storageV5)) {
    const parsed = parsePluginCacheIdentity(pluginRoot, getPluginCacheDir())
    if (parsed) {
      const result = await storageV5.scopeKind(
        { namespace: 'pluginCache', ...parsed },
        { resolveLink: true },
      )
      if (result.ok) {
        switch (result.value?.kind) {
          case 'absent':
            return false
          case 'directory':
          case 'other':
            return true
          case 'link':
            return result.value.linkResolves === true
          default:
            return Boolean(result.value)
        }
      }
    }
  }
  return pathExists(pluginRoot)
}
