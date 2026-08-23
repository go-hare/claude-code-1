/**
 * densable 2.1.238 GOLD_HARD — SEA KQe empty-string gate + Fme id split.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  entryDeclaresHeadersHelper,
  entryHasArchiveHeadersHelper,
} from '../marketplaceHeadersHelper.js'
import type { PluginMarketplaceEntry } from '../schemas.js'

describe('SEA KQe entryHasArchiveHeadersHelper', () => {
  const archive = {
    name: 'demo',
    source: {
      source: 'archive' as const,
      url: 'https://example.com/demo.zip',
    },
  } satisfies Pick<PluginMarketplaceEntry, 'name' | 'source'>

  test('undefined helper is absent', () => {
    expect(entryHasArchiveHeadersHelper(archive)).toBe(false)
    expect(entryDeclaresHeadersHelper({})).toBe(false)
  })

  test('empty string helper is absent (KQe)', () => {
    expect(
      entryHasArchiveHeadersHelper({
        ...archive,
        headersHelper: '',
      }),
    ).toBe(false)
    expect(entryDeclaresHeadersHelper({ headersHelper: '' })).toBe(false)
  })

  test('non-empty archive helper is present', () => {
    expect(
      entryHasArchiveHeadersHelper({
        ...archive,
        headersHelper: '/bin/mint',
      }),
    ).toBe(true)
  })
})

describe('SEA Fme pluginId marketplace split (source bind)', () => {
  test('cacheAndRegisterPlugin and resolveMarketplaceArchiveAuth use length===2', () => {
    const src = readFileSync(
      join(import.meta.dir, '../pluginInstallationHelpers.ts'),
      'utf8',
    )
    expect(src).toContain("pluginId.split('@')")
    expect(src).toContain('pluginIdParts.length === 2 && pluginIdParts[1]')
    expect(src).not.toMatch(/pluginId\.indexOf\('@'\)/)
    expect(src).not.toMatch(/split\('@'\)\.slice\(1\)\.join\('@'\)/)
    const authStart = src.indexOf(
      'export async function resolveMarketplaceArchiveAuth',
    )
    expect(authStart).toBeGreaterThan(0)
    const authFn = src.slice(authStart, authStart + 900)
    expect(authFn).toContain('pluginIdParts.length === 2 && pluginIdParts[1]')
    expect(authFn).not.toMatch(/slice\(1\)\.join\('@'\)/)
  })
})
