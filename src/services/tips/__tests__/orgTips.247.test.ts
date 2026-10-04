/**
 * densable 2.1.247 org tips — product-cut. Remote managed spinnerTipsOverride
 * and orgTips.ts are gone; tipRegistry keeps an empty orgTips append.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('org tips product-cut 247', () => {
  test('orgTips.ts is gone', () => {
    expect(existsSync(join(import.meta.dir, '../orgTips.ts'))).toBe(false)
  })

  test('Pi keeps empty orgTips append and does not load org spinner tips', () => {
    const registry = readFileSync(
      join(import.meta.dir, '../tipRegistry.ts'),
      'utf8',
    )
    const pi = registry.slice(
      registry.indexOf('export async function getRelevantTips'),
    )
    expect(pi).toContain('const orgTips: Tip[] = []')
    expect(pi).toContain('return [...filtered, ...orgTips]')
    expect(pi).not.toContain('loadOrgSpinnerTips')
    expect(pi).not.toContain('shouldExcludeDefaultSpinnerTips')
    expect(pi).not.toContain('ORG_TIPS_CACHE_OWNER')
    expect(pi).toContain('getMarketplacePluginTips(context.storageV5)')
    expect(pi).toContain('context.session.host')
    expect(pi).toContain('advertisedCommandAllowed(tip.advertisedCommand)')
    expect(registry).toContain("getAPIProvider() !== 'firstParty'")
    expect(registry).toContain('isFirstPartyAnthropicBaseUrl()')
    expect(registry).toContain('class SpinnerTipHostState')
    expect(registry).toContain('return await tip.isRelevant(context)')
  })
})
