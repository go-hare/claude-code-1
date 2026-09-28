/**
 * densable 2.1.283 IRn / pluginConfigSettings — /config Project instructions
 * come from enabled plugins' userConfig.title, not SettingsJson.instructionFiles.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { LoadedPlugin } from '../../../types/plugin.js'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

const persistSettingsForSource = mock(
  async (): Promise<{ error: Error | null }> => ({ error: null }),
)
const getSettingsForSource = mock(
  () => null as ReturnType<typeof realSettings.getSettingsForSource>,
)

const settingsSnap = snapshotModuleExports(realSettings)
const settingsMock = createSettingsMock(settingsSnap, {
  persistSettingsForSource:
    persistSettingsForSource as typeof realSettings.persistSettingsForSource,
  getSettingsForSource:
    getSettingsForSource as typeof realSettings.getSettingsForSource,
})
mock.module('src/utils/settings/settings.ts', settingsMock)
mock.module('src/utils/settings/settings.js', settingsMock)

const {
  pluginConfigIdAliases,
  pluginConfigSettings,
  persistPluginConfigOption,
} = await import('../Config.js')

afterEach(() => {
  persistSettingsForSource.mockClear()
  getSettingsForSource.mockClear()
  getSettingsForSource.mockImplementation(() => null)
})

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
})

function plugin(partial: {
  name: string
  source: string
  enabled?: boolean
  userConfig?: Record<string, unknown>
}): LoadedPlugin {
  return {
    name: partial.name,
    path: '/tmp/plugin',
    source: partial.source,
    repository: partial.source,
    enabled: partial.enabled,
    manifest: {
      name: partial.name,
      description: '',
      ...(partial.userConfig
        ? {
            userConfig:
              partial.userConfig as LoadedPlugin['manifest']['userConfig'],
          }
        : {}),
    },
  }
}

const configSource = readFileSync(
  join(import.meta.dir, '../Config.tsx'),
  'utf8',
)
const flowSource = readFileSync(
  join(import.meta.dir, '../../../commands/plugin/PluginOptionsFlow.tsx'),
  'utf8',
)

describe('pluginConfigIdAliases (densable tce)', () => {
  test('bare name plus @builtin id', () => {
    expect(pluginConfigIdAliases('agents-md@builtin')).toEqual([
      'agents-md',
      'agents-md@builtin',
    ])
  })

  test('non-builtin ids stay a singleton', () => {
    expect(pluginConfigIdAliases('demo@marketplace')).toEqual([
      'demo@marketplace',
    ])
  })
})

describe('pluginConfigSettings (densable IRn)', () => {
  test('skips disabled plugins, sensitive, and multiple fields', () => {
    const rows = pluginConfigSettings([
      plugin({
        name: 'off',
        source: 'off@m',
        enabled: false,
        userConfig: {
          keep: { type: 'boolean', title: 'Keep', description: '' },
        },
      }),
      plugin({
        name: 'on',
        source: 'on@m',
        userConfig: {
          secret: {
            type: 'string',
            title: 'Secret',
            description: '',
            sensitive: true,
          },
          tags: {
            type: 'string',
            title: 'Tags',
            description: '',
            multiple: true,
          },
          verbose: {
            type: 'boolean',
            title: 'Verbose',
            description: 'more logs',
          },
        },
      }),
    ])
    expect(rows.map(r => r.id)).toEqual(['on.verbose'])
    expect(rows[0]?.label).toBe('Verbose')
    expect(rows[0]?.type).toBe('boolean')
  })

  test('string+options becomes pickToCommit enum; title is Project instructions', () => {
    const rows = pluginConfigSettings([
      plugin({
        name: 'agents-md',
        source: 'agents-md@builtin',
        userConfig: {
          instructionFiles: {
            type: 'string',
            title: 'Project instructions',
            description:
              '"claude-md": CLAUDE.md only, loaded by the engine as today.',
            options: [
              'claude-md',
              'claude-md-or-agents-md',
              'claude-md-and-agents-md',
              'managed-only',
            ],
            default: 'claude-md-or-agents-md',
          },
        },
      }),
    ])
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.id).toBe('agents-md.instructionFiles')
    expect(row?.label).toBe('Project instructions')
    expect(row?.type).toBe('enum')
    if (row?.type !== 'enum') throw new Error('expected enum')
    expect(row.pickToCommit).toBe(true)
    expect(row.options).toEqual([
      'claude-md',
      'claude-md-or-agents-md',
      'claude-md-and-agents-md',
      'managed-only',
    ])
    expect(row.value).toBe('claude-md-or-agents-md')
  })

  test('name collision uses pluginId in the row id', () => {
    const rows = pluginConfigSettings([
      plugin({
        name: 'demo',
        source: 'demo@one',
        userConfig: {
          mode: { type: 'boolean', title: 'Mode', description: '' },
        },
      }),
      plugin({
        name: 'demo',
        source: 'demo@two',
        userConfig: {
          mode: { type: 'boolean', title: 'Mode', description: '' },
        },
      }),
    ])
    expect(rows.map(r => r.id).sort()).toEqual([
      'demo@one.mode',
      'demo@two.mode',
    ])
  })

  test('splices IRn after core catalog; does not invent SettingsJson.instructionFiles', () => {
    expect(configSource).not.toContain("id: 'instructionFiles'")
    expect(configSource).toContain('pluginConfigSettings(enabledPlugins')
    expect(configSource).toContain('...sortConfigCatalog([')
    expect(configSource).toContain(
      'field.sensitive === true || field.multiple === true',
    )
  })

  test('PluginOptionsFlow ci is async sst/$Hn via ve() storageV5/credentials', () => {
    expect(flowSource).toContain('getUnconfiguredOptions')
    expect(flowSource).toContain('savePluginOptions')
    expect(flowSource).toContain('useSessionServices')
    expect(flowSource).toContain('loadPluginOptionsNw')
    expect(flowSource).toContain('storageV5')
    expect(flowSource).toContain('credentials')
  })
})

describe('persistPluginConfigOption (densable Eo)', () => {
  test('writes pluginConfigs[pluginId].options[key] to userSettings', async () => {
    const target = plugin({
      name: 'agents-md',
      source: 'agents-md@builtin',
    })
    await persistPluginConfigOption(target, 'instructionFiles', 'claude-md')
    expect(persistSettingsForSource).toHaveBeenCalledTimes(1)
    const [source, patch] = persistSettingsForSource.mock
      .calls[0] as unknown as [
      string,
      { pluginConfigs: Record<string, { options: Record<string, string> }> },
    ]
    expect(source).toBe('userSettings')
    expect(
      patch.pluginConfigs['agents-md@builtin']?.options.instructionFiles,
    ).toBe('claude-md')
  })
})
