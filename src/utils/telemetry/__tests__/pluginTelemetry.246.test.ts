/**
 * densable 2.1.246 #60 — hyo enabled_via=admin-install
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { LoadedPlugin } from '../../../types/plugin.js'
import {
  getEnabledVia,
  hashPluginId,
  telemetryMarketplaceForPlugin,
  telemetryServerPluginId,
} from '../pluginTelemetry.js'

function plugin(extra: Partial<LoadedPlugin> = {}): LoadedPlugin {
  return {
    name: 'demo',
    manifest: { name: 'demo' },
    path: '/opt/plugins/demo',
    source: 'demo@synced',
    repository: 'demo@synced',
    ...extra,
  }
}

describe('getEnabledVia admin-install (2.1.246 #60 hyo)', () => {
  test('builtin wins over installationPreference', () => {
    expect(
      getEnabledVia(
        plugin({ isBuiltin: true, installationPreference: 'required' }),
        null,
        [],
      ),
    ).toBe('default-enable')
  })

  test('org-policy wins over installationPreference', () => {
    expect(
      getEnabledVia(
        plugin({ installationPreference: 'auto_install' }),
        new Set(['demo']),
        [],
      ),
    ).toBe('org-policy')
  })

  test('required → admin-install', () => {
    expect(
      getEnabledVia(plugin({ installationPreference: 'required' }), null, []),
    ).toBe('admin-install')
  })

  test('auto_install → admin-install', () => {
    expect(
      getEnabledVia(
        plugin({ installationPreference: 'auto_install' }),
        null,
        [],
      ),
    ).toBe('admin-install')
  })

  test('no preference → user-install', () => {
    expect(getEnabledVia(plugin(), null, [])).toBe('user-install')
  })
})

describe('telemetry marketplace remap (2.1.246 #60 Nsn/ast)', () => {
  test('marketplaceName wins over @synced repository', () => {
    expect(
      telemetryMarketplaceForPlugin(
        plugin({ marketplaceName: 'acme-official' }),
      ),
    ).toBe('acme-official')
  })

  test('falls back to repository marketplace', () => {
    expect(telemetryMarketplaceForPlugin(plugin())).toBe('synced')
  })

  test('plugin_id_hash uses the real marketplace', () => {
    const real = telemetryMarketplaceForPlugin(
      plugin({ marketplaceName: 'acme' }),
    )
    expect(hashPluginId('demo', real)).toBe(hashPluginId('demo', 'acme'))
    expect(hashPluginId('demo', real)).not.toBe(hashPluginId('demo', 'synced'))
  })
})

describe('Vsn server_plugin_id (2.1.246)', () => {
  test('session emit spreads Vsn onto tengu_plugin_enabled_for_session', () => {
    const src = readFileSync(
      join(import.meta.dir, '../pluginTelemetry.ts'),
      'utf8',
    )
    expect(src).toContain('telemetryServerPluginId(plugin.serverPluginId)')
    expect(src).toContain('server_plugin_id: serverPluginId')
  })

  test('emits raw Nl-valid id, not a hash', () => {
    expect(telemetryServerPluginId('plugin_abc123')).toBe('plugin_abc123')
    expect(telemetryServerPluginId('plugin_abc123')).not.toBe(
      hashPluginId('plugin_abc123'),
    )
  })

  test('drops undefined and invalid ids', () => {
    expect(telemetryServerPluginId(undefined)).toBeUndefined()
    expect(telemetryServerPluginId('not-a-plugin-id')).toBeUndefined()
    expect(telemetryServerPluginId('plugin_')).toBeUndefined()
  })
})
