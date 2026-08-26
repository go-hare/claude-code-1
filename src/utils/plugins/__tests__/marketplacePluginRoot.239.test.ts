/**
 * densable 2.1.239 #25 — Lta / MVo / $ta pluginRoot rewrite.
 * Official tQ_ unsupported-stub path is not ported.
 */
import { describe, expect, test } from 'bun:test'
import {
  applyMarketplacePluginRoot,
  isBareMarketplacePluginSource,
  sanitizeMarketplacePluginRoot,
} from '../marketplacePluginRoot.js'
import { PluginMarketplaceSchema } from '../schemas.js'

const owner = { name: 'Acme' }

function marketplace(plugins: unknown[], pluginRoot?: string) {
  return {
    name: 'team-plugins',
    owner,
    plugins,
    ...(pluginRoot !== undefined ? { metadata: { pluginRoot } } : {}),
  }
}

describe('densable 2.1.239 #25 marketplace pluginRoot', () => {
  test('Lta sanitizes pluginRoot', () => {
    expect(sanitizeMarketplacePluginRoot('./plugins/')).toBe('plugins')
    expect(sanitizeMarketplacePluginRoot('.')).toBe('.')
    expect(sanitizeMarketplacePluginRoot('./')).toBe('.')
    expect(sanitizeMarketplacePluginRoot('/abs')).toBeUndefined()
    expect(sanitizeMarketplacePluginRoot('foo\\bar')).toBeUndefined()
    expect(sanitizeMarketplacePluginRoot('C:plugins')).toBeUndefined()
    expect(sanitizeMarketplacePluginRoot('a/../b')).toBeUndefined()
    expect(sanitizeMarketplacePluginRoot('')).toBeUndefined()
  })

  test('MVo accepts bare source names only', () => {
    expect(isBareMarketplacePluginSource('formatter')).toBe(true)
    expect(isBareMarketplacePluginSource('my-plugin.v1')).toBe(true)
    expect(isBareMarketplacePluginSource('./formatter')).toBe(false)
    expect(isBareMarketplacePluginSource('foo..bar')).toBe(false)
  })

  test('$ta rewrites bare source under pluginRoot; ./ sources stay', () => {
    const raw = marketplace(
      [
        { name: 'fmt', source: 'formatter' },
        { name: 'rel', source: './already/here' },
      ],
      './plugins',
    )
    const out = applyMarketplacePluginRoot(raw) as {
      plugins: Array<{ source: string }>
    }
    expect(out.plugins[0]?.source).toBe('./plugins/formatter')
    expect(out.plugins[1]?.source).toBe('./already/here')
  })

  test('$ta pluginRoot="." prefixes ./ only', () => {
    const out = applyMarketplacePluginRoot(
      marketplace([{ name: 'fmt', source: 'formatter' }], '.'),
    ) as { plugins: Array<{ source: string }> }
    expect(out.plugins[0]?.source).toBe('./formatter')
  })

  test('schema parse after $ta accepts bare name + pluginRoot', () => {
    const result = PluginMarketplaceSchema().safeParse(
      applyMarketplacePluginRoot(
        marketplace([{ name: 'fmt', source: 'formatter' }], 'plugins'),
      ),
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugins[0]?.source).toBe('./plugins/formatter')
    }
  })

  test('bare name without pluginRoot still fails RelativePath', () => {
    const result = PluginMarketplaceSchema().safeParse(
      applyMarketplacePluginRoot(
        marketplace([{ name: 'fmt', source: 'formatter' }]),
      ),
    )
    expect(result.success).toBe(false)
  })
})
