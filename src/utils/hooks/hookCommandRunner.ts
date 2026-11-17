import { pathExists } from '../file.js'

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

export function parsePluginCacheIdentity(
  pluginRoot: string,
): { marketplace: string; plugin: string; version: string } | null {
  const parts = pluginRoot.split(/[/\\]/).filter(Boolean)
  const cacheIndex = parts.findIndex(
    (part, i) => part === 'cache' && parts[i - 1] === 'plugins',
  )
  if (cacheIndex === -1) {
    return null
  }
  const marketplace = parts[cacheIndex + 1]
  const plugin = parts[cacheIndex + 2]
  const version = parts[cacheIndex + 3]
  if (!marketplace || !plugin || !version) {
    return null
  }
  return { marketplace, plugin, version }
}

/**
 * densable jIs(storageV5, pluginRoot) @216801547.
 * Official: Be() && host → scopeKind(pluginCache); else el(t)=pathExists.
 * Host is createLocalFsBackend when hover-rest pinned.
 */
export async function pluginDirectoryExists(
  storageV5: unknown,
  pluginRoot: string,
): Promise<boolean> {
  if (isStorageV5ScopeKindHost(storageV5)) {
    const parsed = parsePluginCacheIdentity(pluginRoot)
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
