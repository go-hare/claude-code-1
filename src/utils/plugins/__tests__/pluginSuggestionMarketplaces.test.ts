/**
 * Official 2.1.x: pluginSuggestionMarketplaces managed allowlist semantics.
 */
import { describe, expect, test } from 'bun:test'
import {
  clearMarketplaceDeclaredPluginTipsCache,
  loadMarketplaceDeclaredPluginTips,
} from '../../../services/tips/marketplacePluginTips.js'

/**
 * Pure mirror of isPluginSuggestionMarketplaceAllowed without settings I/O.
 */
function isAllowed(
  allowlist: string[] | undefined,
  marketplace: string,
): boolean {
  const list = allowlist ?? []
  if (list.length === 0) return false
  return list.includes(marketplace)
}

describe('pluginSuggestionMarketplaces gate', () => {
  test('empty/undefined allowlist blocks marketplace-declared tips', () => {
    expect(isAllowed(undefined, 'acme-tools')).toBe(false)
    expect(isAllowed([], 'acme-tools')).toBe(false)
  })

  test('allowlisted marketplace is allowed', () => {
    expect(isAllowed(['acme-tools', 'other'], 'acme-tools')).toBe(true)
  })

  test('non-allowlisted marketplace is blocked', () => {
    expect(isAllowed(['acme-tools'], 'other')).toBe(false)
  })
})

describe('loadMarketplaceDeclaredPluginTips (fHa)', () => {
  test('returns empty when policy allowlist is empty (default)', async () => {
    clearMarketplaceDeclaredPluginTipsCache()
    // Without managed pluginSuggestionMarketplaces, official returns [].
    const tips = await loadMarketplaceDeclaredPluginTips()
    expect(tips).toEqual([])
  })
})
