import type { ArgumentCompletion } from '../../types/command.js'
import {
  getMarketplaceCacheOnly,
  loadKnownMarketplacesConfigSafe,
} from '../../utils/plugins/marketplaceManager.js'
import {
  isInstallationRelevantToCurrentProject,
  loadInstalledPluginsV2,
} from '../../utils/plugins/installedPluginsManager.js'
import { buildPluginId } from '../../utils/plugins/pluginIdentifier.js'
import type { MarketplaceSource } from '../../utils/plugins/schemas.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'

/**
 * densable dOy / getPluginArgumentCompletions (2.1.211) — root subcommands +
 * dynamic enable/disable/uninstall ids, install catalog (cache-only), list flags,
 * marketplace actions + marketplace names for remove/update.
 */

const ROOT_SUBCOMMANDS: ArgumentCompletion[] = [
  { value: 'list', description: 'List installed plugins', isFinal: true },
  { value: 'enable', description: 'Enable an installed plugin' },
  { value: 'disable', description: 'Disable an installed plugin' },
  {
    value: 'install',
    description: 'Install a plugin from a marketplace',
  },
  { value: 'uninstall', description: 'Remove an installed plugin' },
  { value: 'marketplace', description: 'Manage plugin marketplaces' },
  { value: 'manage', description: 'Open plugin manager UI', isFinal: true },
  { value: 'validate', description: 'Validate a plugin path' },
  { value: 'help', description: 'Show plugin help', isFinal: true },
]

const LIST_FLAGS: ArgumentCompletion[] = [
  {
    value: '--enabled',
    description: 'Only show enabled plugins',
    isFinal: true,
  },
  {
    value: '--disabled',
    description: 'Only show disabled plugins',
    isFinal: true,
  },
]

const MARKETPLACE_ACTIONS: ArgumentCompletion[] = [
  { value: 'add', description: 'Add a marketplace from a URL or path' },
  { value: 'remove', description: 'Remove a known marketplace' },
  { value: 'update', description: 'Refresh a marketplace from its source' },
  { value: 'list', description: 'List known marketplaces', isFinal: true },
]

type InstallCandidate = {
  pluginId: string
  description?: string
}

/** densable LSs — install catalog cache keyed by marketplace config fingerprint. */
let installCatalogCache: {
  key: string
  candidates: InstallCandidate[]
} | null = null

function filterCompletions(
  items: ArgumentCompletion[],
  partial: string,
): ArgumentCompletion[] {
  if (!partial) return items
  const q = partial.toLowerCase()
  const prefix: ArgumentCompletion[] = []
  const contains: ArgumentCompletion[] = []
  for (const item of items) {
    const v = item.value.toLowerCase()
    if (v.startsWith(q)) prefix.push(item)
    else if (v.includes(q)) contains.push(item)
  }
  return prefix.concat(contains)
}

function formatVersionDesc(version: string | undefined): string | undefined {
  return version ? `v${version}` : undefined
}

function formatMarketplaceSource(source: MarketplaceSource): string {
  if ('repo' in source && typeof source.repo === 'string') return source.repo
  if ('url' in source && typeof source.url === 'string') return source.url
  if ('path' in source && typeof source.path === 'string') return source.path
  if ('package' in source && typeof source.package === 'string') {
    return `npm:${source.package}`
  }
  return source.source
}

/** densable Gce — enabled plugin ids from merged settings. */
function getEnabledPluginIds(): Set<string> {
  const enabled = getSettings_DEPRECATED()?.enabledPlugins ?? {}
  const out = new Set<string>()
  for (const [id, val] of Object.entries(enabled)) {
    if (val === true || (Array.isArray(val) && val.length > 0)) {
      out.add(id)
    }
  }
  return out
}

/**
 * densable enable/disable/uninstall: installed entries relevant to this project,
 * filtered by enabled state for enable vs disable.
 */
function listInstalledPluginCompletions(
  mode: 'enable' | 'disable' | 'uninstall',
): ArgumentCompletion[] {
  const installed = loadInstalledPluginsV2()
  const enabled = getEnabledPluginIds()
  const items: ArgumentCompletion[] = []

  for (const [pluginId, entries] of Object.entries(installed.plugins)) {
    const relevant = entries.filter(isInstallationRelevantToCurrentProject)
    if (relevant.length === 0) continue
    if (mode === 'enable' && enabled.has(pluginId)) continue
    if (mode === 'disable' && !enabled.has(pluginId)) continue
    const version =
      relevant.find(e => e.version)?.version ?? relevant[0]?.version
    items.push({
      value: pluginId,
      description: formatVersionDesc(version),
      isFinal: true,
    })
  }

  items.sort((a, b) => a.value.localeCompare(b.value))
  return items
}

/** densable pOy — install candidates from marketplace caches (no network). */
async function listInstallCandidates(): Promise<ArgumentCompletion[]> {
  const config = await loadKnownMarketplacesConfigSafe()
  const names = Object.keys(config).sort()
  const key = names
    .map(n => {
      const e = config[n]
      return `${n}|${e?.installLocation ?? ''}|${e?.lastUpdated ?? ''}`
    })
    .join(';')

  if (installCatalogCache?.key !== key) {
    const candidates: InstallCandidate[] = []
    for (const marketplaceName of names) {
      const marketplace = await getMarketplaceCacheOnly(marketplaceName)
      if (!marketplace) continue
      for (const plugin of marketplace.plugins) {
        candidates.push({
          pluginId: buildPluginId(plugin.name, marketplaceName),
          description: plugin.description,
        })
      }
    }
    candidates.sort((a, b) => a.pluginId.localeCompare(b.pluginId))
    installCatalogCache = { key, candidates }
  }

  const installed = loadInstalledPluginsV2()
  return installCatalogCache.candidates
    .filter(
      c =>
        !installed.plugins[c.pluginId]?.some(
          isInstallationRelevantToCurrentProject,
        ),
    )
    .map(c => ({
      value: c.pluginId,
      description: c.description,
      isFinal: true as const,
    }))
}

async function listMarketplaceNames(): Promise<ArgumentCompletion[]> {
  const config = await loadKnownMarketplacesConfigSafe()
  return Object.entries(config)
    .map(([name, entry]) => ({
      value: name,
      description: formatMarketplaceSource(entry.source),
      isFinal: true as const,
    }))
    .sort((a, b) => a.value.localeCompare(b.value))
}

export async function getPluginArgumentCompletions(
  argsSoFar: string[],
  partial: string,
): Promise<ArgumentCompletion[]> {
  if (argsSoFar.length === 0) {
    return filterCompletions(ROOT_SUBCOMMANDS, partial)
  }

  const head = argsSoFar[0]?.toLowerCase() ?? ''
  if (argsSoFar.length === 1) {
    switch (head) {
      case 'list':
      case 'ls':
        return filterCompletions(LIST_FLAGS, partial)
      case 'marketplace':
      case 'market':
        return filterCompletions(MARKETPLACE_ACTIONS, partial)
      case 'enable':
      case 'disable':
      case 'uninstall':
        return filterCompletions(
          listInstalledPluginCompletions(
            head as 'enable' | 'disable' | 'uninstall',
          ),
          partial,
        )
      case 'install':
      case 'i':
        // densable: skip catalog when path-like (user typing marketplace URL/path)
        if (partial.includes('/') || partial.includes('\\')) return []
        return filterCompletions(await listInstallCandidates(), partial)
      default:
        return []
    }
  }

  if (argsSoFar.length === 2 && (head === 'marketplace' || head === 'market')) {
    const action = argsSoFar[1]?.toLowerCase() ?? ''
    if (action === 'remove' || action === 'rm' || action === 'update') {
      return filterCompletions(await listMarketplaceNames(), partial)
    }
  }

  return []
}

/** densable LSs reset — tests can wipe install catalog memo. */
export function _resetPluginInstallCatalogCacheForTesting(): void {
  installCatalogCache = null
}
