/**
 * densable 2.1.246 #60 sun — map installation_preference from claude.ai list.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  mapCloudListedPlugin,
  parseInstallationPreference,
} from '../syncedPluginCloudSync.js'
import {
  applySyncedPluginAttribution,
  readSyncedPluginAttributionMap,
} from '../syncedPluginHydrate.js'

describe('synced plugin installationPreference (2.1.246 #60 sun)', () => {
  test('oun accepts required and auto_install', () => {
    expect(parseInstallationPreference('required')).toBe('required')
    expect(parseInstallationPreference('auto_install')).toBe('auto_install')
    expect(parseInstallationPreference('user')).toBeUndefined()
    expect(parseInstallationPreference(undefined)).toBeUndefined()
  })

  test('sun copies installation_preference onto the listed row', () => {
    expect(
      mapCloudListedPlugin({
        id: 'abc',
        name: 'demo',
        installation_preference: 'required',
      }),
    ).toMatchObject({
      pluginId: 'abc',
      name: 'demo',
      installationPreference: 'required',
    })
  })

  test('sun copies marketplace_name onto the listed row', () => {
    expect(
      mapCloudListedPlugin({
        id: 'abc',
        name: 'demo',
        marketplace_name: 'acme',
      }),
    ).toMatchObject({
      pluginId: 'abc',
      name: 'demo',
      marketplaceName: 'acme',
    })
  })
})

describe('synced plugin attribution writeback (2.1.246 #60 hyo)', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('load copy writes preference and marketplace onto the plugin', () => {
    const plugin: {
      name: string
      installationPreference?: 'required' | 'auto_install'
      marketplaceName?: string
      serverPluginId?: string
    } = { name: 'demo' }
    applySyncedPluginAttribution(plugin, {
      installationPreference: 'required',
      marketplaceName: 'acme',
      serverPluginId: 'plugin_abc123',
    })
    expect(plugin).toMatchObject({
      name: 'demo',
      installationPreference: 'required',
      marketplaceName: 'acme',
      serverPluginId: 'plugin_abc123',
    })
  })

  test('reads Gbn camelCase rows from the synced manifest', async () => {
    const pluginsDir = mkdtempSync(join(tmpdir(), 'synced-attr-246-'))
    dirs.push(pluginsDir)
    const synced = join(pluginsDir, 'synced')
    mkdirSync(synced, { recursive: true })
    writeFileSync(
      join(synced, 'manifest.json'),
      JSON.stringify({
        lastUpdated: 1,
        plugins: [
          {
            pluginId: 'abc',
            name: 'demo',
            description: '',
            version: null,
            updatedAt: null,
            installationPreference: 'auto_install',
            marketplaceName: 'acme',
            server_plugin_id: 'plugin_abc123',
          },
        ],
      }),
    )
    const map = await readSyncedPluginAttributionMap(pluginsDir)
    expect(map.get('demo')).toEqual({
      installationPreference: 'auto_install',
      marketplaceName: 'acme',
      serverPluginId: 'plugin_abc123',
    })
  })
})
