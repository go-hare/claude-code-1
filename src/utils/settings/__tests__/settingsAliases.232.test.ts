/**
 * densable 2.1.232 #8 — BIy / sRe settings key aliases.
 */
import { describe, expect, test } from 'bun:test'
import {
  applySettingsKeyAliases,
  formatSettingsAliasBothSetMessage,
  SETTINGS_KEY_ALIASES,
} from '../settingsAliases.js'
import { SettingsSchema } from '../types.js'

describe('densable 2.1.232 BIy SETTINGS_KEY_ALIASES', () => {
  test('maps additional→extra and allowed→strict', () => {
    expect(SETTINGS_KEY_ALIASES).toEqual([
      {
        alias: 'additionalMarketplaces',
        canonical: 'extraKnownMarketplaces',
      },
      {
        alias: 'allowedMarketplaces',
        canonical: 'strictKnownMarketplaces',
      },
    ])
  })
})

describe('densable sRe applySettingsKeyAliases', () => {
  test('rewrites alias-only file to canonical before schema', () => {
    const data: Record<string, unknown> = {
      additionalMarketplaces: {
        team: {
          source: { source: 'github' as const, repo: 'org/plugins' },
        },
      },
    }
    const warnings = applySettingsKeyAliases(data, '/tmp/settings.json')
    expect(warnings).toEqual([])
    expect(data.additionalMarketplaces).toBeUndefined()
    expect(data.extraKnownMarketplaces).toEqual({
      team: {
        source: { source: 'github', repo: 'org/plugins' },
      },
    })
    const parsed = SettingsSchema().safeParse(data)
    expect(parsed.success).toBe(true)
  })

  test('both keys set → warning, keep canonical, drop alias', () => {
    const data: Record<string, unknown> = {
      extraKnownMarketplaces: {
        keep: {
          source: { source: 'github' as const, repo: 'a/b' },
        },
      },
      additionalMarketplaces: {
        drop: {
          source: { source: 'github' as const, repo: 'c/d' },
        },
      },
    }
    const warnings = applySettingsKeyAliases(data, 'project')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.path).toBe('additionalMarketplaces')
    expect(warnings[0]?.message).toContain('alias for "extraKnownMarketplaces"')
    expect(data.additionalMarketplaces).toBeUndefined()
    expect(data.extraKnownMarketplaces).toEqual({
      keep: {
        source: { source: 'github', repo: 'a/b' },
      },
    })
  })

  test('allowedMarketplaces rewrites to strictKnownMarketplaces', () => {
    const data: Record<string, unknown> = {
      allowedMarketplaces: [{ source: 'github' as const, repo: 'owner/*' }],
    }
    applySettingsKeyAliases(data)
    expect(data.allowedMarketplaces).toBeUndefined()
    expect(data.strictKnownMarketplaces).toEqual([
      { source: 'github', repo: 'owner/*' },
    ])
  })

  test('rAs short message', () => {
    expect(
      formatSettingsAliasBothSetMessage(
        'additionalMarketplaces',
        'extraKnownMarketplaces',
      ),
    ).toBe(
      '"additionalMarketplaces" and "extraKnownMarketplaces" are the same setting; keep only "extraKnownMarketplaces"',
    )
  })

  test('non-object is no-op', () => {
    expect(applySettingsKeyAliases(null)).toEqual([])
    expect(applySettingsKeyAliases('x')).toEqual([])
  })
})
