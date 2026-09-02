/**
 * densable 2.1.239 #4 — cloud-synced plugins as `name@synced`.
 *
 * Official: `iN="synced"` / `R9a` / `I9a` / `kff` `e.synced`.
 * Local same-name wins. Do not invent the cloud dir downloader.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import type { LoadedPlugin } from '../../../types/plugin.js'
import { formatSyncedPluginShadowedMessage } from '../../../types/plugin.js'
import {
  foldPluginName,
  isSyncedPluginEnabled,
  isSyncedPluginId,
  localCopyShadowingSynced,
  marketplaceSuffixFromSource,
  parsePluginIdentifier,
  SYNCED_MARKETPLACE_NAME,
} from '../pluginIdentifier.js'
import { loadSyncedPlugins, mergePluginSources } from '../pluginLoader.js'
import { PluginMarketplaceSchema } from '../schemas.js'
import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import {
  auditSyncedExtractTree,
  dirsFromSyncedManifest,
  getSyncedPluginsManifestPath,
  getSyncedPluginsRoot,
  hydrateSyncedPluginDirsFromDisk,
  SYNCED_PLUGINS_DIRNAME,
  SYNCED_PLUGINS_MANIFEST,
} from '../syncedPluginHydrate.js'

function plugin(
  name: string,
  source: string,
  extra: Partial<LoadedPlugin> = {},
): LoadedPlugin {
  return {
    name,
    manifest: { name },
    path: extra.path ?? `/tmp/${name}`,
    source,
    repository: source,
    enabled: true,
    ...extra,
  }
}

describe('densable 2.1.239 #4 name@synced', () => {
  test('iN sentinel and parsePluginIdentifier', () => {
    expect(SYNCED_MARKETPLACE_NAME).toBe('synced')
    expect(parsePluginIdentifier('foo@synced')).toEqual({
      name: 'foo',
      marketplace: 'synced',
    })
    expect(isSyncedPluginId('foo@synced')).toBe(true)
    expect(isSyncedPluginId('foo@inline')).toBe(false)
    expect(isSyncedPluginId('synced')).toBe(false)
  })

  test('G$ uses the last @', () => {
    expect(marketplaceSuffixFromSource('foo@synced')).toBe('synced')
    expect(marketplaceSuffixFromSource('foo@bar@synced')).toBe('synced')
    expect(marketplaceSuffixFromSource('foo')).toBeUndefined()
    expect(marketplaceSuffixFromSource('foo@')).toBeUndefined()
  })

  test('zD NFC-folds names', () => {
    expect(foldPluginName('Foo')).toBe('foo')
    expect(foldPluginName('e\u0301')).toBe('\u00e9')
  })

  test('I9a ignores @synced and disabled locals', () => {
    const locals = [
      plugin('Foo', 'Foo@synced'),
      plugin('foo', 'foo@mkt', { enabled: false }),
      plugin('foo', 'foo@inline'),
    ]
    expect(localCopyShadowingSynced('FOO', locals)?.source).toBe('foo@inline')
    expect(
      localCopyShadowingSynced('foo', [plugin('foo', 'foo@synced')]),
    ).toBeUndefined()
  })

  test('f3a/AKp: absent row defaults on; false disables; true enables', () => {
    // loadOneZpfPathPlugin passes manifest.defaultEnabled (official f3a)
    expect(isSyncedPluginEnabled('a@synced', undefined, undefined)).toBe(true)
    expect(isSyncedPluginEnabled('a@synced', false, undefined)).toBe(false)
    expect(
      isSyncedPluginEnabled('a@synced', undefined, { 'a@synced': false }),
    ).toBe(false)
    expect(
      isSyncedPluginEnabled('a@synced', undefined, { 'a@synced': true }),
    ).toBe(true)
  })

  test('D9u reserved marketplace name', () => {
    const result = PluginMarketplaceSchema().safeParse({
      name: 'synced',
      owner: { name: 'Acme' },
      plugins: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('synced'))).toBe(
        true,
      )
    }
  })

  test('Dhe shadowed guidance uses plugin enable', () => {
    expect(
      formatSyncedPluginShadowedMessage('demo@synced', 'demo@inline'),
    ).toBe(
      'To use the claude.ai copy instead, run `claude plugin enable demo@synced`, then disable or remove "demo@inline"',
    )
  })

  test('kff: enabled local shadows synced', () => {
    const { plugins, errors } = mergePluginSources({
      session: [plugin('demo', 'demo@inline')],
      marketplace: [],
      builtin: [],
      synced: [plugin('demo', 'demo@synced', { path: '/tmp/synced-demo' })],
    })
    expect(plugins.map(p => p.source)).toEqual(['demo@inline'])
    expect(errors).toEqual([
      {
        type: 'synced-plugin-shadowed',
        orphan: true,
        source: 'demo@synced',
        shadowedBy: 'demo@inline',
      },
    ])
  })

  test('kff: disabled local does not shadow', () => {
    const { plugins, errors } = mergePluginSources({
      session: [plugin('demo', 'demo@inline', { enabled: false })],
      marketplace: [],
      builtin: [],
      synced: [plugin('demo', 'demo@synced')],
    })
    expect(plugins.map(p => p.source)).toEqual(['demo@inline', 'demo@synced'])
    expect(errors).toEqual([])
  })

  test('kff: marketplace and builtin also shadow', () => {
    const market = mergePluginSources({
      session: [],
      marketplace: [plugin('demo', 'demo@shop')],
      builtin: [],
      synced: [plugin('demo', 'demo@synced')],
    })
    expect(market.plugins.map(p => p.source)).toEqual(['demo@shop'])
    expect(market.errors[0]?.type).toBe('synced-plugin-shadowed')

    const builtin = mergePluginSources({
      session: [],
      marketplace: [],
      builtin: [plugin('demo', 'demo@builtin', { isBuiltin: true })],
      synced: [plugin('demo', 'demo@synced')],
    })
    expect(builtin.plugins.map(p => p.source)).toEqual(['demo@builtin'])
    expect(builtin.errors[0]).toMatchObject({
      type: 'synced-plugin-shadowed',
      shadowedBy: 'demo@builtin',
    })
  })

  test('kff: NFC-folded name match', () => {
    const { plugins, errors } = mergePluginSources({
      session: [plugin('Demo', 'Demo@inline')],
      marketplace: [],
      builtin: [],
      synced: [plugin('demo', 'demo@synced')],
    })
    expect(plugins.map(p => p.source)).toEqual(['Demo@inline'])
    expect(errors[0]).toMatchObject({
      type: 'synced-plugin-shadowed',
      shadowedBy: 'Demo@inline',
    })
  })

  test('kff: first synced copy wins; later is orphan generic-error', () => {
    const { plugins, errors } = mergePluginSources({
      session: [],
      marketplace: [],
      builtin: [],
      synced: [
        plugin('demo', 'demo@synced', { path: '/tmp/first' }),
        plugin('demo', 'demo@synced', { path: '/tmp/second' }),
      ],
    })
    expect(plugins.map(p => p.path)).toEqual(['/tmp/first'])
    expect(errors).toEqual([
      {
        type: 'generic-error',
        orphan: true,
        source: 'second@synced',
        error:
          'Not loaded \u2014 the claude.ai-synced copy in second/ declares the same plugin name "demo" as first/, which is used instead',
      },
    ])
  })

  test('kff: later copy when first is disabled', () => {
    const { errors } = mergePluginSources({
      session: [],
      marketplace: [],
      builtin: [],
      synced: [
        plugin('demo', 'demo@synced', {
          path: '/tmp/first',
          enabled: false,
        }),
        plugin('demo', 'demo@synced', { path: '/tmp/second' }),
      ],
    })
    expect(errors[0]).toMatchObject({
      error:
        'Not loaded \u2014 the claude.ai-synced copy in second/ declares the same plugin name "demo" as first/, which is kept as a disabled row',
    })
  })

  test('kff: managed names drop the synced copy', () => {
    const { plugins, errors } = mergePluginSources({
      session: [],
      marketplace: [],
      builtin: [],
      synced: [plugin('Demo', 'Demo@synced')],
      managedNames: new Set(['demo']),
    })
    expect(plugins).toEqual([])
    expect(errors).toEqual([
      {
        type: 'generic-error',
        orphan: true,
        source: 'Demo@synced',
        error:
          'claude.ai-synced copy of "Demo" ignored: plugin is locked by managed settings',
      },
    ])
  })

  test('kff: disabled synced is kept (not dropped as shadow)', () => {
    const { plugins, errors } = mergePluginSources({
      session: [plugin('other', 'other@inline')],
      marketplace: [],
      builtin: [],
      synced: [plugin('demo', 'demo@synced', { enabled: false })],
    })
    expect(plugins.map(p => p.source)).toEqual(['other@inline', 'demo@synced'])
    expect(errors).toEqual([])
  })

  test('kff order is session, marketplace, synced, builtin', () => {
    const { plugins } = mergePluginSources({
      session: [plugin('s', 's@inline')],
      marketplace: [plugin('m', 'm@shop')],
      builtin: [plugin('b', 'b@builtin')],
      synced: [plugin('y', 'y@synced')],
    })
    expect(plugins.map(p => p.source)).toEqual([
      's@inline',
      'm@shop',
      'y@synced',
      'b@builtin',
    ])
  })

  test('session/marketplace matching stays exact (not zD)', () => {
    const { plugins } = mergePluginSources({
      session: [plugin('Demo', 'Demo@inline')],
      marketplace: [plugin('demo', 'demo@shop')],
      builtin: [],
    })
    expect(plugins.map(p => p.source)).toEqual(['Demo@inline', 'demo@shop'])
  })
})

describe('densable T0r / W1h disk hydrate', () => {
  test('Usr / uGe paths', () => {
    expect(SYNCED_PLUGINS_DIRNAME).toBe('synced')
    expect(SYNCED_PLUGINS_MANIFEST).toBe('manifest.json')
    expect(getSyncedPluginsRoot('/home/.claude/plugins')).toBe(
      join('/home/.claude/plugins', 'synced'),
    )
    expect(getSyncedPluginsManifestPath('/home/.claude/plugins')).toBe(
      join('/home/.claude/plugins', 'synced', 'manifest.json'),
    )
  })

  test('W1h: unique dirs from manifest names; skip reserved', () => {
    const root = join('/home/.claude/plugins', 'synced')
    expect(
      dirsFromSyncedManifest(
        [{ name: 'demo' }, { name: 'demo' }, { name: 'other' }],
        root,
      ),
    ).toEqual([join(root, 'demo'), join(root, 'other')])
    expect(
      dirsFromSyncedManifest(
        [{ name: 'manifest.json' }, { name: '.staging' }, { name: '' }],
        root,
      ),
    ).toEqual([])
  })

  test('W1h uniqueness is p9, not toLowerCase', () => {
    const root = join('/home/.claude/plugins', 'synced')
    expect(
      dirsFromSyncedManifest([{ name: 'café' }, { name: 'CAFÉ' }], root),
    ).toEqual([join(root, 'café')])
  })

  test('T0r: skip when lQt already set; hydrate from manifest', async () => {
    let dirs: string[] = ['already']
    await hydrateSyncedPluginDirsFromDisk({
      getDirs: () => dirs,
      setDirs: next => {
        dirs = next
      },
      root: '/tmp/synced',
      stat: async () => ({ isDirectory: () => true }),
      readFile: async () =>
        JSON.stringify({ plugins: [{ name: 'demo', pluginId: 'demo' }] }),
    })
    expect(dirs).toEqual(['already'])

    dirs = []
    await hydrateSyncedPluginDirsFromDisk({
      getDirs: () => dirs,
      setDirs: next => {
        dirs = next
      },
      root: '/tmp/synced',
      stat: async () => ({ isDirectory: () => true }),
      readFile: async () =>
        JSON.stringify({ plugins: [{ name: 'demo', pluginId: 'demo' }] }),
    })
    expect(dirs).toEqual([join('/tmp/synced', 'demo')])

    dirs = []
    await hydrateSyncedPluginDirsFromDisk({
      getDirs: () => dirs,
      setDirs: next => {
        dirs = next
      },
      root: '/tmp/missing',
      stat: async () => {
        throw new Error('ENOENT')
      },
    })
    expect(dirs).toEqual([])
  })

  test('W1h/T0r qMr missing leaves; Zpf reports path-not-found', async () => {
    const root = join('/tmp', 'synced-ghost')
    expect(dirsFromSyncedManifest([{ name: 'ghost' }], root)).toEqual([
      join(root, 'ghost'),
    ])

    let dirs: string[] = []
    await hydrateSyncedPluginDirsFromDisk({
      getDirs: () => dirs,
      setDirs: next => {
        dirs = next
      },
      root,
      stat: async () => ({ isDirectory: () => true }),
      readFile: async () => JSON.stringify({ plugins: [{ name: 'ghost' }] }),
    })
    expect(dirs).toEqual([join(root, 'ghost')])

    const missing = join(root, 'ghost')
    const { plugins, errors } = await loadSyncedPlugins([missing])
    expect(plugins).toEqual([])
    expect(errors).toEqual([
      {
        type: 'path-not-found',
        source: 'synced[0]',
        path: resolve(missing),
        component: 'commands',
      },
    ])
  })

  test('Zpf Promise.all flatMap keeps input order', async () => {
    const { plugins, errors } = await loadSyncedPlugins([
      join('/tmp', 'zpf-a-missing'),
      join('/tmp', 'zpf-b-missing'),
    ])
    expect(plugins).toEqual([])
    expect(errors.map(e => e.source)).toEqual(['synced[0]', 'synced[1]'])
  })

  test('T0r source does not invent zXl cloud download', () => {
    const src = readFileSync(
      join(import.meta.dir, '../syncedPluginHydrate.ts'),
      'utf8',
    )
    expect(src).not.toContain('listEntries("plugins")')
    expect(src).not.toMatch(/\bfetch\s*\(/)
    expect(src).toContain('auditSyncedExtractTree')
    expect(src).toContain('hydrateSyncedPluginDirsFromDisk')
  })

  test('jXl/T0r does not scan dirs when manifest is missing', async () => {
    let dirs: string[] = []
    await hydrateSyncedPluginDirsFromDisk({
      getDirs: () => dirs,
      setDirs: next => {
        dirs = next
      },
      root: '/tmp/synced-no-manifest',
      stat: async () => ({ isDirectory: () => true }),
      readFile: async () => {
        throw new Error('ENOENT')
      },
    })
    expect(dirs).toEqual([])

    dirs = []
    await hydrateSyncedPluginDirsFromDisk({
      getDirs: () => dirs,
      setDirs: next => {
        dirs = next
      },
      root: '/tmp/synced-empty-plugins',
      stat: async () => ({ isDirectory: () => true }),
      readFile: async () => JSON.stringify({ plugins: [] }),
    })
    expect(dirs).toEqual([])

    const src = readFileSync(
      join(import.meta.dir, '../syncedPluginHydrate.ts'),
      'utf8',
    )
    expect(src).not.toContain('Local zXl analog')
    expect(src).toContain('No readdir fallback')
  })

  test('iVE walk: ok / reserved / oversize', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ive-'))
    await writeFile(join(root, 'ok.txt'), 'hi')
    expect(await auditSyncedExtractTree(root)).toBe('ok')

    await mkdir(join(root, '.git'))
    expect(await auditSyncedExtractTree(root)).toBe('reserved')

    const fat = await mkdtemp(join(tmpdir(), 'ive-fat-'))
    await writeFile(join(fat, 'big.bin'), 'xxxx')
    expect(await auditSyncedExtractTree(fat, 2)).toBe('oversize')
  })
})
