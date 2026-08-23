/**
 * densable 2.1.238 GOLD_HARD — SEA Y_e / vBu / PN_ extraKnownMarketplaces
 * headersHelper disclosure in managed-settings projection.
 */
import { describe, expect, test } from 'bun:test'
import type { SettingsJson } from '../../../utils/settings/types.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import {
  extractDangerousSettings,
  formatDangerousSettingsList,
  formatExtraKnownHeadersHelperValue,
  hasDangerousSettings,
  resolveExtraKnownMarketplacesProjection,
} from '../utils.js'

describe('SEA Y_e extraKnownMarketplaces disclosure', () => {
  test('vBu projects [command, source, url]', () => {
    expect(
      formatExtraKnownHeadersHelperValue(
        '/bin/mint',
        'url',
        'https://example.com/m.json',
      ),
    ).toBe(jsonStringify(['/bin/mint', 'url', 'https://example.com/m.json']))
  })

  test('PN_ falls back to additionalMarketplaces alias', () => {
    const aliased = {
      additionalMarketplaces: {
        demo: { source: { source: 'url', url: 'https://example.com/m.json' } },
      },
    } as SettingsJson
    expect(resolveExtraKnownMarketplacesProjection(aliased)).toEqual(
      aliased.additionalMarketplaces as Record<string, unknown>,
    )
  })

  test('url source headersHelper enters shellSettings', () => {
    const settings = {
      extraKnownMarketplaces: {
        demo: {
          source: {
            source: 'url',
            url: 'https://example.com/m.json',
            headersHelper: '/usr/bin/mint-headers',
          },
        },
      },
    } as SettingsJson
    const d = extractDangerousSettings(settings)
    const key = `extraKnownMarketplaces[${jsonStringify('demo')}].source.headersHelper`
    expect(d.shellSettings[key]).toBe(
      jsonStringify([
        '/usr/bin/mint-headers',
        'url',
        'https://example.com/m.json',
      ]),
    )
    expect(hasDangerousSettings(d)).toBe(true)
    const list = formatDangerousSettingsList(d)
    expect(list.some(item => item.includes('/usr/bin/mint-headers'))).toBe(true)
    expect(
      list.some(item => item.includes('→ https://example.com/m.json')),
    ).toBe(true)
  })

  test('settings-source plugin headersHelper enters shellSettings', () => {
    const settings = {
      extraKnownMarketplaces: {
        org: {
          source: {
            source: 'settings',
            name: 'org',
            plugins: [
              {
                name: 'demo-plugin',
                headersHelper: '/opt/mint',
                source: {
                  source: 'archive',
                  url: 'https://example.com/demo.zip',
                },
              },
            ],
          },
        },
      },
    } as SettingsJson
    const d = extractDangerousSettings(settings)
    const key = `extraKnownMarketplaces[${jsonStringify('org')}].plugins[${jsonStringify('demo-plugin')}][0].headersHelper`
    expect(d.shellSettings[key]).toBe(
      jsonStringify(['/opt/mint', 'archive', 'https://example.com/demo.zip']),
    )
  })

  test('empty-string headersHelper is not projected', () => {
    const settings = {
      extraKnownMarketplaces: {
        demo: {
          source: {
            source: 'url',
            url: 'https://example.com/m.json',
            headersHelper: '',
          },
        },
      },
    } as SettingsJson
    const d = extractDangerousSettings(settings)
    expect(
      Object.keys(d.shellSettings).some(k =>
        k.startsWith('extraKnownMarketplaces['),
      ),
    ).toBe(false)
  })
})
