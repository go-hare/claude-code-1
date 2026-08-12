/**
 * densable 2.1.228 #10 — extraKnownMarketplaces whole-entry shallow merge (ssn/tRe).
 */
import { describe, expect, test } from 'bun:test'
import mergeWith from 'lodash-es/mergeWith.js'
import { settingsMergeCustomizer } from '../settings.js'

describe('densable 2.1.228 #10 settingsMergeCustomizer extraKnownMarketplaces (ssn/tRe)', () => {
  test('higher-tier marketplace entry fully replaces lower (headers not inherited)', () => {
    const lower = {
      extraKnownMarketplaces: {
        corp: {
          source: { source: 'github' as const, repo: 'acme/plugins' },
          headers: { Authorization: 'Bearer LOWER' },
        },
      },
    }
    const higher = {
      extraKnownMarketplaces: {
        corp: {
          source: { source: 'github' as const, repo: 'acme/plugins' },
          // no headers — densable must NOT deep-merge LOWER headers in
        },
      },
    }

    const merged = mergeWith({}, lower, higher, settingsMergeCustomizer) as {
      extraKnownMarketplaces: {
        corp: { headers?: Record<string, string> }
      }
    }

    expect(merged.extraKnownMarketplaces.corp.headers).toBeUndefined()
  })

  test('higher-tier headers win when both set', () => {
    const lower = {
      extraKnownMarketplaces: {
        corp: {
          source: { source: 'url' as const, url: 'https://a.example' },
          headers: { Authorization: 'Bearer LOWER', 'X-Keep': '1' },
        },
      },
    }
    const higher = {
      extraKnownMarketplaces: {
        corp: {
          source: { source: 'url' as const, url: 'https://a.example' },
          headers: { Authorization: 'Bearer HIGHER' },
        },
      },
    }

    const merged = mergeWith({}, lower, higher, settingsMergeCustomizer) as {
      extraKnownMarketplaces: {
        corp: { headers?: Record<string, string> }
      }
    }

    expect(merged.extraKnownMarketplaces.corp.headers).toEqual({
      Authorization: 'Bearer HIGHER',
    })
    // whole-entry replace: X-Keep from lower is gone
    expect(
      merged.extraKnownMarketplaces.corp.headers?.['X-Keep'],
    ).toBeUndefined()
  })

  test('unrelated marketplace names are preserved across tiers', () => {
    const lower = {
      extraKnownMarketplaces: {
        a: { source: { source: 'github' as const, repo: 'o/a' } },
      },
    }
    const higher = {
      extraKnownMarketplaces: {
        b: { source: { source: 'github' as const, repo: 'o/b' } },
      },
    }
    const merged = mergeWith({}, lower, higher, settingsMergeCustomizer) as {
      extraKnownMarketplaces: Record<string, unknown>
    }
    expect(Object.keys(merged.extraKnownMarketplaces).sort()).toEqual([
      'a',
      'b',
    ])
  })

  test('fallbackModel still replaces (not concat) per densable tRe', () => {
    const merged = mergeWith(
      {},
      { fallbackModel: ['a', 'b'] },
      { fallbackModel: ['c'] },
      settingsMergeCustomizer,
    ) as { fallbackModel: string[] }
    expect(merged.fallbackModel).toEqual(['c'])
  })
})
