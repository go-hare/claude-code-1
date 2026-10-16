/**
 * densable 2.1.289 p5 / Qge — plugin-directory marketplace listing.
 *
 * Gold p5: host is `ignoreToggle && My()===null ? eW : Vb()`. Missing host
 * or disabled toggle → null. `onlyMissedListings` is forwarded to
 * `loadPluginDirectoryMarketplace("cache-only", {onlyMissedListings})`.
 *
 * No local Vb()/eW host — first branch returns null (gold structure).
 */

export type PluginDirectoryMarketplaceHost = {
  isPluginDirectoryMarketplaceEnabled: () => Promise<boolean>
  loadPluginDirectoryMarketplace: (
    mode: 'cache-only' | 'refresh',
    opts: {
      forInstalledPlugin?: boolean
      onlyMissedListings?: boolean
      installRecords?: unknown
      purpose?: string
      trigger?: string
      signal?: AbortSignal
    },
  ) => Promise<{ marketplace: unknown; message?: string }>
  pluginDirectoryRegistryEntry: () => Promise<{
    installLocation: unknown
  }>
}

export type PluginDirectoryMarketplaceListing = {
  marketplace: unknown
  installLocation: unknown
}

function getPluginDirectoryMarketplaceHost(
  _ignoreToggle: boolean,
): PluginDirectoryMarketplaceHost | null {
  // densable Vb() / eW — Team/Enterprise plugin-directory host. Absent here.
  return null
}

/**
 * densable p5({ignoreToggle, storageV5, onlyMissedListings})
 */
export async function loadPluginDirectoryMarketplaceListing({
  ignoreToggle = false,
  storageV5: _storageV5,
  onlyMissedListings = false,
}: {
  ignoreToggle?: boolean
  storageV5?: unknown
  onlyMissedListings?: boolean
} = {}): Promise<PluginDirectoryMarketplaceListing | null> {
  const host = getPluginDirectoryMarketplaceHost(ignoreToggle)
  if (
    !host ||
    (!ignoreToggle && !(await host.isPluginDirectoryMarketplaceEnabled()))
  ) {
    return null
  }
  const { marketplace } = await host.loadPluginDirectoryMarketplace(
    'cache-only',
    {
      forInstalledPlugin: ignoreToggle,
      onlyMissedListings,
    },
  )
  if (marketplace === null) return null
  const { installLocation } = await host.pluginDirectoryRegistryEntry()
  return { marketplace, installLocation }
}

function hasInstalledPluginDirectoryRecord(_name: string): boolean {
  // densable Jl().plugins[`${e}@${hn}`]?.some(np) — no install-record host.
  return false
}

/**
 * densable Qge(e, n, r, s=!1) — listing wrapper around p5.
 * Gold ignoreToggle: purpose!=="install" && installed-plugin record.
 * Invent-ban `export function Qge` (SEA also names the Ask dialog Qge).
 */
export function loadPluginDirectoryMarketplaceByPurpose(
  name: string,
  storageV5: unknown,
  purpose: string,
  onlyMissedListings = false,
): Promise<PluginDirectoryMarketplaceListing | null> {
  return loadPluginDirectoryMarketplaceListing({
    onlyMissedListings,
    ignoreToggle:
      purpose !== 'install' && hasInstalledPluginDirectoryRecord(name),
    storageV5,
  })
}
