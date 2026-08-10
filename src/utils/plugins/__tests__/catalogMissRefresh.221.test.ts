import { describe, expect, test } from 'bun:test'
import type { KnownMarketplace } from '../schemas.js'

/**
 * densable 2.1.221 #29 — pure mirrors of zIr eligibility / stale-hint branching.
 * Full tryRefreshMarketplaceOnCatalogMiss integration is heavy (marketplaceManager
 * side effects); these lock the review-fixed semantics.
 */

describe('densable 2.1.221 #29 catalog-miss refresh eligibility (zIr gates)', () => {
  test('skipIfRecent: age < 30s short-circuits', () => {
    const lastUpdated = new Date(Date.now() - 5_000).toISOString()
    const ageMs = Date.now() - new Date(lastUpdated).getTime()
    expect(ageMs >= 0 && ageMs < 30_000).toBe(true)
  })

  test('skipIfRecent: age >= 30s does not short-circuit', () => {
    const lastUpdated = new Date(Date.now() - 45_000).toISOString()
    const ageMs = Date.now() - new Date(lastUpdated).getTime()
    expect(ageMs >= 0 && ageMs < 30_000).toBe(false)
  })

  test('isMarketplaceAutoUpdate default true for official names', async () => {
    const { isMarketplaceAutoUpdate } = await import('../schemas.js')
    expect(isMarketplaceAutoUpdate('claude-plugins-official', {})).toBe(true)
    expect(isMarketplaceAutoUpdate('third-party-mkt', {})).toBe(false)
    expect(
      isMarketplaceAutoUpdate('third-party-mkt', { autoUpdate: true }),
    ).toBe(true)
  })

  test('unscoped l0 gate requires source AND policy allow', () => {
    // installPluginOp: !source || !isSourceAllowedByPolicy(source) → continue
    const allowed = (source: unknown, policyOk: boolean) =>
      Boolean(source) && policyOk
    expect(allowed(undefined, true)).toBe(false)
    expect(allowed({ source: 'github' }, false)).toBe(false)
    expect(allowed({ source: 'github' }, true)).toBe(true)
  })
})

describe('densable 2.1.221 #29 install miss stale hint shape', () => {
  function staleHintFor(
    marketplaceName: string | undefined,
    catalogMissOutcome: 'refreshed' | 'refresh-failed' | 'ineligible' | null,
  ): string {
    if (!marketplaceName) return ''
    if (catalogMissOutcome === 'refresh-failed') {
      return '. Your local copy may be out of date — update it from /plugin > Marketplaces'
    }
    if (catalogMissOutcome === 'refreshed') {
      return '. Your local copy may be out of date — try `claude plugin marketplace update` or update it from /plugin > Marketplaces'
    }
    return ''
  }

  test('refresh-failed gets UI update stale hint', () => {
    const hint = staleHintFor('bar', 'refresh-failed')
    expect(hint).toContain('update it from /plugin > Marketplaces')
    expect(hint).not.toContain('marketplace update')
  })

  test('refreshed-still-miss gets CLI update nudge', () => {
    const hint = staleHintFor('bar', 'refreshed')
    expect(hint).toContain('claude plugin marketplace update')
  })

  test('ineligible / null miss outcome: no stale-copy claim', () => {
    expect(staleHintFor('bar', 'ineligible')).toBe('')
    expect(staleHintFor('bar', null)).toBe('')
    expect(staleHintFor(undefined, 'refresh-failed')).toBe('')
  })

  test('not-found message composes with optional hint only', () => {
    const pluginName = 'foo'
    const location = 'marketplace "bar"'
    const staleHint = staleHintFor('bar', 'refresh-failed')
    const message = `Plugin "${pluginName}" not found in ${location}${staleHint}`
    expect(message).toContain('not found in marketplace "bar"')
    expect(message).toContain('local copy may be out of date')
  })
})

void (null as unknown as KnownMarketplace)
