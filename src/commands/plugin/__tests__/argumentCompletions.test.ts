import { afterEach, describe, expect, mock, test } from 'bun:test'

// Mock plugin FS layers so unit tests don't touch real disk/settings.
const installedPlugins = {
  version: 2 as const,
  plugins: {
    'alpha@mkt': [
      {
        scope: 'user' as const,
        version: '1.0.0',
        installPath: '/tmp/alpha',
        installedAt: '2020-01-01T00:00:00.000Z',
      },
    ],
    'beta@mkt': [
      {
        scope: 'user' as const,
        version: '2.0.0',
        installPath: '/tmp/beta',
        installedAt: '2020-01-01T00:00:00.000Z',
      },
    ],
  },
}

let enabledPlugins: Record<string, boolean | string[] | undefined> = {
  'alpha@mkt': true,
}

mock.module('src/utils/plugins/installedPluginsManager.js', () => ({
  loadInstalledPluginsV2: () => installedPlugins,
  isInstallationRelevantToCurrentProject: () => true,
}))

mock.module('src/utils/settings/settings.js', () => ({
  getSettings_DEPRECATED: () => ({ enabledPlugins }),
}))

mock.module('src/utils/plugins/marketplaceManager.js', () => ({
  loadKnownMarketplacesConfigSafe: async () => ({
    mkt: {
      source: { source: 'github', repo: 'org/mkt' },
      installLocation: '/tmp/mkt',
      lastUpdated: '2020-01-01T00:00:00.000Z',
    },
  }),
  getMarketplaceCacheOnly: async () => ({
    name: 'mkt',
    plugins: [
      { name: 'alpha', description: 'Alpha plugin' },
      { name: 'gamma', description: 'Gamma plugin' },
    ],
  }),
}))

const {
  getPluginArgumentCompletions,
  _resetPluginInstallCatalogCacheForTesting,
} = await import('../argumentCompletions.js')

afterEach(() => {
  enabledPlugins = { 'alpha@mkt': true }
  _resetPluginInstallCatalogCacheForTesting()
})

describe('getPluginArgumentCompletions', () => {
  test('lists root subcommands when no args so far', async () => {
    const items = await getPluginArgumentCompletions([], '')
    const values = items.map(i => i.value)
    expect(values).toContain('list')
    expect(values).toContain('enable')
    expect(values).toContain('marketplace')
    expect(values).toContain('install')
  })

  test('filters root subcommands by partial', async () => {
    const items = await getPluginArgumentCompletions([], 'en')
    expect(items.map(i => i.value)).toEqual(['enable'])
  })

  test('marketplace actions after marketplace token', async () => {
    const items = await getPluginArgumentCompletions(['marketplace'], '')
    const values = items.map(i => i.value)
    expect(values).toEqual(['add', 'remove', 'update', 'list'])
  })

  test('list flags after list', async () => {
    const items = await getPluginArgumentCompletions(['list'], '--e')
    expect(items.map(i => i.value)).toEqual(['--enabled'])
  })

  test('disable lists only enabled installed plugins', async () => {
    const items = await getPluginArgumentCompletions(['disable'], '')
    expect(items.map(i => i.value)).toEqual(['alpha@mkt'])
  })

  test('enable lists only disabled installed plugins', async () => {
    const items = await getPluginArgumentCompletions(['enable'], '')
    expect(items.map(i => i.value)).toEqual(['beta@mkt'])
  })

  test('uninstall lists all installed plugins', async () => {
    const items = await getPluginArgumentCompletions(['uninstall'], '')
    expect(items.map(i => i.value).sort()).toEqual(['alpha@mkt', 'beta@mkt'])
  })

  test('install catalog omits already-installed and returns marketplace plugins', async () => {
    const items = await getPluginArgumentCompletions(['install'], '')
    // alpha installed → only gamma
    expect(items.map(i => i.value)).toEqual(['gamma@mkt'])
    expect(items[0]!.description).toBe('Gamma plugin')
  })

  test('install with path-like partial returns empty', async () => {
    expect(await getPluginArgumentCompletions(['install'], './local')).toEqual(
      [],
    )
  })

  test('marketplace remove lists known marketplaces', async () => {
    const items = await getPluginArgumentCompletions(
      ['marketplace', 'remove'],
      '',
    )
    expect(items.map(i => i.value)).toEqual(['mkt'])
    expect(items[0]!.description).toBe('org/mkt')
  })

  test('returns empty for unknown deeper args', async () => {
    expect(await getPluginArgumentCompletions(['help'], 'x')).toEqual([])
    expect(
      await getPluginArgumentCompletions(['marketplace', 'add'], 'x'),
    ).toEqual([])
  })
})
