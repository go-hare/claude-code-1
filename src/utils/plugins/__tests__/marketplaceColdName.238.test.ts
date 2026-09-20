/**
 * densable 2.1.238 SEA ABa — cold/cache-miss/bulk pass marketplaceName into
 * loadAndCacheMarketplace → cacheMarketplaceFromUrl → `_5n`/`ret`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

describe('marketplace cold marketplaceName densable 2.1.238', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../marketplaceManager.ts'),
    'utf8',
  )

  test('loadAndCacheMarketplace accepts marketplaceName and forwards on url', () => {
    const fn = src.indexOf('async function loadAndCacheMarketplace(')
    expect(fn).toBeGreaterThan(0)
    const body = src.slice(fn, src.indexOf('\nasync function ', fn + 1))
    expect(body).toContain('marketplaceName?: string')
    expect(body).toContain('marketplaceName,')
    expect(body).toContain('await cacheMarketplaceFromUrl(')
  })

  test('cache-miss getMarketplace path passes known name', () => {
    expect(src).toContain(
      'await loadAndCacheMarketplace(\n        entry.source,\n        undefined,\n        storageV5,\n        name,\n      )',
    )
  })

  test('bulk refresh path passes known name', () => {
    // M5: pin the three-arg SEA ABa form inside refreshAllMarketplaces —
    // not a loose 500-char window that nearby `updates[name]` can satisfy.
    // Prefix with `const { cachePath }` so this cannot be satisfied by the
    // cache-miss destructuring call-site alone.
    const refreshFn = src.indexOf(
      'export async function refreshAllMarketplaces(',
    )
    expect(refreshFn).toBeGreaterThan(0)
    const body = src.slice(
      refreshFn,
      src.indexOf('\nexport async function ', refreshFn + 1),
    )
    expect(body).toContain(
      'const { cachePath } = await loadAndCacheMarketplace(\n        entry.source,\n        undefined,\n        storageV5,\n        name,\n      )',
    )
  })

  test('named refresh mints headers with marketplaceName then ABo/h0n', () => {
    const refreshFn = src.indexOf('export async function refreshMarketplace(')
    expect(refreshFn).toBeGreaterThan(0)
    const body = src.slice(
      refreshFn,
      src.indexOf('\nexport async function ', refreshFn + 1),
    )
    expect(body).toContain('resolveUrlMarketplaceHeaders(source, {')
    expect(body).toContain('marketplaceName: name,')
    expect(body).toContain('publishUrlMarketplaceCatalogRefresh(')
    expect(body).toContain('await cacheMarketplaceFromUrl(')
  })
})
