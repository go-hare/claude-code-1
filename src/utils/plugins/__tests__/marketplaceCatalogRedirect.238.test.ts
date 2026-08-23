/**
 * densable 2.1.238 GOLD_HARD — SEA Y8p/K8p marketplace catalog beforeRedirect.
 */
import { describe, expect, test } from 'bun:test'
import {
  createMarketplaceCatalogBeforeRedirect,
  inheritedMarketplaceHeaderNames,
  MARKETPLACE_CATALOG_MAX_BYTES,
} from '../pluginArchive.js'

describe('SEA Y8p marketplace catalog beforeRedirect', () => {
  test('jhi max content length is 5 MiB', () => {
    expect(MARKETPLACE_CATALOG_MAX_BYTES).toBe(5_242_880)
  })

  test('k$a excludes User-Agent from inherited names', () => {
    expect(
      inheritedMarketplaceHeaderNames({
        Authorization: 'Bearer x',
        'User-Agent': 'Claude-Code-Plugin-Manager',
        'X-Custom': '1',
      }),
    ).toEqual(['Authorization', 'X-Custom'])
  })

  test('same-origin hop keeps Authorization', () => {
    const before = createMarketplaceCatalogBeforeRedirect(
      'https://example.com/m.json',
      ['Authorization'],
    )
    const headers = { Authorization: 'Bearer keep', 'User-Agent': 'ua' }
    before({
      href: 'https://example.com/other.json',
      headers,
    })
    expect(headers.Authorization).toBe('Bearer keep')
  })

  test('cross-origin https hop drops inherited Authorization', () => {
    const before = createMarketplaceCatalogBeforeRedirect(
      'https://example.com/m.json',
      ['Authorization', 'X-Custom'],
    )
    const headers = {
      Authorization: 'Bearer drop',
      'X-Custom': '1',
      'User-Agent': 'ua',
    }
    before({
      href: 'https://cdn.example.org/m.json',
      headers,
    })
    expect(headers.Authorization).toBeUndefined()
    expect(headers['X-Custom']).toBeUndefined()
    expect(headers['User-Agent']).toBe('ua')
  })

  test('cross-origin loopback hop is refused', () => {
    const before = createMarketplaceCatalogBeforeRedirect(
      'https://example.com/m.json',
      ['Authorization'],
    )
    expect(() =>
      before({
        href: 'https://127.0.0.1/m.json',
        headers: { Authorization: 'Bearer x' },
      }),
    ).toThrow(/Marketplace catalog redirected to a disallowed URL/)
  })

  test('http cross-origin hop is refused', () => {
    const before = createMarketplaceCatalogBeforeRedirect(
      'https://example.com/m.json',
      [],
    )
    expect(() =>
      before({
        href: 'http://cdn.example.org/m.json',
        headers: {},
      }),
    ).toThrow(/Marketplace catalog redirected to a disallowed URL/)
  })
})
