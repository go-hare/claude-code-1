/**
 * densable MBp / NQ_ section membership for ManagePlugins list.
 * Order: attention → favorites → disused → rest.
 */
import type { UnifiedInstalledItem } from './unifiedTypes.js'

/** densable NQ_ */
export function isNeedsAttentionItem(item: UnifiedInstalledItem): boolean {
  switch (item.type) {
    case 'plugin':
      return item.isEnabled && item.errorCount > 0
    case 'failed-plugin':
    case 'flagged-plugin':
      return true
    case 'mcp':
      return item.status === 'needs-auth' || item.status === 'failed'
    default:
      return false
  }
}

/**
 * densable MBp (search path returns input order; no-search applies sections).
 * Disused only for enabled plugins present in disusedDays (not favorites/attention).
 */
export function orderUnifiedInstalledItems(
  items: UnifiedInstalledItem[],
  opts: {
    searchQuery: string
    favoriteIds: Set<string>
    disusedDays: Map<string, number>
  },
): UnifiedInstalledItem[] {
  if (opts.searchQuery) return items

  const attention: UnifiedInstalledItem[] = []
  const fav: UnifiedInstalledItem[] = []
  const disused: UnifiedInstalledItem[] = []
  const rest: UnifiedInstalledItem[] = []
  const claimed = new Set<string>()

  for (const item of items) {
    if (isNeedsAttentionItem(item)) {
      attention.push(item)
      claimed.add(item.id)
    }
  }
  for (const item of items) {
    if (claimed.has(item.id)) continue
    if (opts.favoriteIds.has(item.id)) {
      fav.push(item)
      claimed.add(item.id)
    }
  }
  if (opts.disusedDays.size > 0) {
    for (const item of items) {
      if (claimed.has(item.id)) continue
      if (
        item.type === 'plugin' &&
        item.isEnabled &&
        opts.disusedDays.has(item.id)
      ) {
        disused.push(item)
        claimed.add(item.id)
      }
    }
  }
  for (const item of items) {
    if (!claimed.has(item.id)) rest.push(item)
  }

  if (attention.length === 0 && fav.length === 0 && disused.length === 0) {
    return items
  }
  return [...attention, ...fav, ...disused, ...rest]
}
