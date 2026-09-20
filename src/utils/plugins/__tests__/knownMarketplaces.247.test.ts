import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import {
  knownMarketplacesRegistryKey,
  loadKnownMarketplacesConfig,
  loadKnownMarketplacesConfigSafe,
  reservedMarketplaceLoadRefusal,
  settingsSourceFromMarketplaceScope,
  throwIfReservedMarketplaceUntrusted,
} from '../marketplaceManager.js'
import {
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  withTelemetryMessage,
} from '../../errors.js'
import {
  pinHoverRest,
  resetHoverRestPinForTests,
} from '../../storageV5/hoverRestPin.js'

afterEach(() => {
  resetHoverRestPinForTests()
})

function withDefaultPluginsDir<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  return fn().finally(() => {
    if (prev === undefined) {
      delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
    } else {
      process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = prev
    }
  })
}

function fakeRead(items: Array<{ found: boolean; value?: Uint8Array }>): {
  read: () => Promise<{ ok: true; value: { items: typeof items } }>
} {
  return {
    read: async () => ({ ok: true as const, value: { items } }),
  }
}

describe('densable 2.1.247 et/U$ storageV5', () => {
  test('XFe/lh is pluginRegistry marketplaces only for {configHome}/plugins', () => {
    expect(
      knownMarketplacesRegistryKey(join(getClaudeConfigHomeDir(), 'plugins')),
    ).toEqual({ namespace: 'pluginRegistry', file: 'marketplaces' })
    expect(
      knownMarketplacesRegistryKey(
        join(getClaudeConfigHomeDir(), 'cowork_plugins'),
      ),
    ).toBeNull()
    expect(knownMarketplacesRegistryKey('/tmp/other-plugins')).toBeNull()
  })

  test('U$ V5 !found is empty config', async () => {
    pinHoverRest(true)
    await withDefaultPluginsDir(async () => {
      if (knownMarketplacesRegistryKey() === null) return
      expect(
        await loadKnownMarketplacesConfig(fakeRead([{ found: false }])),
      ).toEqual({})
    })
  })

  test('tZ swallows V5 read failure', async () => {
    pinHoverRest(true)
    await withDefaultPluginsDir(async () => {
      if (knownMarketplacesRegistryKey() === null) return
      expect(
        await loadKnownMarketplacesConfigSafe({
          read: async () => ({ ok: false as const, error: { code: 'Failed' } }),
        }),
      ).toEqual({})
    })
  })

  test('U$ V5 parses registry JSON', async () => {
    pinHoverRest(true)
    await withDefaultPluginsDir(async () => {
      if (knownMarketplacesRegistryKey() === null) return
      const body = {
        demo: {
          source: { source: 'github' as const, repo: 'acme/tools' },
          installLocation: '/tmp/m',
          lastUpdated: '2024-01-15T10:30:00.000Z',
        },
      }
      const data = await loadKnownMarketplacesConfig(
        fakeRead([{ found: true, value: Buffer.from(JSON.stringify(body)) }]),
      )
      expect(data.demo?.installLocation).toBe('/tmp/m')
    })
  })
})

describe('densable 2.1.247 eZ rme / Do', () => {
  test('rme skips non-reserved names', () => {
    expect(
      reservedMarketplaceLoadRefusal('acme-tools', {
        source: { source: 'github', repo: 'acme/tools' },
        installLocation: '/tmp/m',
      }),
    ).toBeNull()
  })

  test('rme refuses reserved name from unofficial github org', () => {
    expect(
      reservedMarketplaceLoadRefusal('claude-plugins-official', {
        source: { source: 'github', repo: 'not-anthropics/plugins' },
        installLocation: '/tmp/m',
      }),
    ).toContain('reserved for official Anthropic marketplaces')
  })

  test('rme allows reserved name from anthropics github', () => {
    expect(
      reservedMarketplaceLoadRefusal('claude-plugins-official', {
        source: {
          source: 'github',
          repo: 'anthropics/claude-plugins-official',
        },
        installLocation: '/tmp/m',
      }),
    ).toBeNull()
  })

  test('rme seed-managed reserved name is not refused', () => {
    const prev = process.env.CLAUDE_CODE_PLUGIN_SEED_DIR
    process.env.CLAUDE_CODE_PLUGIN_SEED_DIR = '/seed-plugins'
    try {
      expect(
        reservedMarketplaceLoadRefusal('claude-plugins-official', {
          source: { source: 'github', repo: 'evil/clone' },
          installLocation: '/seed-plugins/marketplaces/claude-plugins-official',
        }),
      ).toBeNull()
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_PLUGIN_SEED_DIR
      } else {
        process.env.CLAUDE_CODE_PLUGIN_SEED_DIR = prev
      }
    }
  })

  test('eZ cache-only goes through rme then Zfe/DSt', () => {
    const src = readFileSync(
      join(import.meta.dir, '../marketplaceManager.ts'),
      'utf8',
    )
    const eZ = src.slice(
      src.indexOf('export async function getMarketplaceCacheOnly'),
    )
    expect(eZ).toContain('readMarketplaceCacheEntry')
    expect(eZ).toContain('options?.registryEntry')
    expect(src).toContain("Refusing to load marketplace '${name}': ${reason}")
    expect(src).toContain('marketplaceCatalogHint')
    expect(src).toContain("kind: 'hostFolder'")
    expect(src).toContain("namespace: 'marketplaceCache'")
    expect(src).toContain('readCachedMarketplaceZfe')
  })

  test('rme malformed source object', () => {
    expect(
      reservedMarketplaceLoadRefusal('claude-plugins-official', {
        source: null,
        installLocation: '/tmp/m',
      }),
    ).toBe(
      "The name 'claude-plugins-official' is reserved for official Anthropic marketplaces and its registered source is malformed.",
    )
  })

  test('y0n throws reserved unofficial source', () => {
    expect(() =>
      throwIfReservedMarketplaceUntrusted('claude-plugins-official', {
        source: { source: 'github', repo: 'not-anthropics/plugins' },
        installLocation: '/tmp/m',
      }),
    ).toThrow(TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
    try {
      throwIfReservedMarketplaceUntrusted('claude-plugins-official', {
        source: { source: 'github', repo: 'not-anthropics/plugins' },
        installLocation: '/tmp/m',
      })
    } catch (error) {
      expect(error).toBeInstanceOf(
        TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      )
      expect((error as Error).message).toContain(
        'registered from an untrusted source',
      )
      expect(
        (error as TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
          .telemetryMessage,
      ).toBe('Reserved marketplace name registered from untrusted source')
    }
  })

  test('y0n allows official github reserved name', () => {
    expect(() =>
      throwIfReservedMarketplaceUntrusted('claude-plugins-official', {
        source: {
          source: 'github',
          repo: 'anthropics/claude-plugins-official',
        },
        installLocation: '/tmp/m',
      }),
    ).not.toThrow()
  })

  test('LSt is four-arg and URL/settings V5 go through RBo/write', () => {
    const src = readFileSync(
      join(import.meta.dir, '../marketplaceManager.ts'),
      'utf8',
    )
    const start = src.indexOf('async function loadAndCacheMarketplace(')
    const lSt = src.slice(
      start,
      src.indexOf('export async function addMarketplaceSource', start),
    )
    expect(lSt).toContain('storageV5?: unknown')
    expect(lSt).toContain('marketplaceName?: string')
    expect(lSt).toContain('fetchMarketplaceFromUrl(')
    expect(lSt).toContain('publishUrlMarketplaceCatalog(')
    expect(lSt).toContain("publishDiscipline: 'inPlace'")
    expect(lSt).toContain("marketplaceCacheFormKey(source.name, 'manifest')")
    expect(src).toContain("publishDiscipline: 'atomic'")
    expect(src).toContain(
      'failed to write marketplace catalog (v5 backend error)',
    )
    expect(src).toContain(
      'failed to write marketplace manifest (v5 backend error)',
    )
  })

  test('bSt cache hit is y0n then Zfe, not readCachedMarketplace+pluginRoot', () => {
    const src = readFileSync(
      join(import.meta.dir, '../marketplaceManager.ts'),
      'utf8',
    )
    const start = src.indexOf('export const getMarketplace = memoize')
    const bSt = src.slice(
      start,
      src.indexOf('export async function getPluginByIdCacheOnly', start),
    )
    expect(bSt).toContain('throwIfReservedMarketplaceUntrusted(name, entry)')
    expect(bSt).toContain('readCachedMarketplaceZfe')
    expect(bSt).toContain('marketplaceCatalogHint')
    expect(bSt).toContain('loadKnownMarketplacesConfig(storageV5)')
    expect(bSt).not.toContain('return await readCachedMarketplace(')
    expect(bSt).toContain('Marketplace has relative source path (legacy state)')
    expect(src).toContain(
      'Reserved marketplace name registered from untrusted source',
    )
  })

  test('CBo sanitizes every slash and non-segment chars', () => {
    const src = readFileSync(
      join(import.meta.dir, '../marketplaceManager.ts'),
      'utf8',
    )
    const start = src.indexOf('function getCachePathForSource(')
    const cBo = src.slice(
      start,
      src.indexOf('async function parseFileWithSchema', start),
    )
    expect(cBo).toContain("source.repo.replaceAll('/', '-')")
    expect(cBo).toContain(
      "source.package.replace('@', '').replaceAll('/', '-')",
    )
    expect(cBo).toContain('[^a-zA-Z0-9\\-_]')
    expect(cBo).toContain("tempName === '' ? 'temp_' + Date.now()")
  })

  test('Qx re-clone is bak dance, skipLfs, m0n, inode skip', () => {
    const src = readFileSync(
      join(import.meta.dir, '../marketplaceManager.ts'),
      'utf8',
    )
    expect(src).toContain('const backupPath = `${cachePath}.bak`')
    expect(src).toContain('moving aside to allow re-clone')
    expect(src).toContain('GIT_LFS_SKIP_SMUDGE')
    expect(src).toContain('{ skipLfs: source.skipLfs }')
    expect(src).toContain('setMarketplaceGitOriginUrl')
    expect(src).toContain(
      "['--git-dir=.git', 'remote', 'set-url', 'origin', url]",
    )
    expect(src).toContain("source.path || '.claude-plugin/marketplace.json'")
    expect(src).toContain('tempStat.dev === finalStat.dev &&')
    expect(src).toContain('tempStat.ino === finalStat.ino &&')
    expect(src).toContain('tempStat.ino !== 0')
    expect(src).toContain('`${cachePath}.bak`')
    expect(src).toContain('marketplaceUrlOrSettingsCacheKey')
    expect(src).toContain(
      "Failed to delete the previous entry's cached marketplace",
    )
  })

  test('kB is ELOOP/ENXIO/EISDIR and xSt/RBo retry on that errno', () => {
    const src = readFileSync(
      join(import.meta.dir, '../marketplaceManager.ts'),
      'utf8',
    )
    expect(src).toContain(
      "return code === 'ELOOP' || code === 'ENXIO' || code === 'EISDIR'",
    )
    expect(src).toContain(
      'return isMarketplaceStorageErrno(storageTelemetryCode(meta.error))',
    )
    expect(src).toContain(
      'writeCode && isMarketplaceStorageErrno(storageTelemetryCode(writeError))',
    )
  })

  test('QLn $St extends plugins as unknown; jS is Mo then ho', () => {
    const src = readFileSync(
      join(import.meta.dir, '../marketplaceManager.ts'),
      'utf8',
    )
    const fetch = src.slice(
      src.indexOf('async function fetchMarketplaceFromUrl('),
      src.indexOf('async function cacheMarketplaceFromUrl('),
    )
    expect(fetch).toContain('.extend({ plugins: z.array(z.unknown()) })')
    expect(fetch).toContain('return response.data')
    expect(src).toContain('function hoistMarketplacePlugins(')
    expect(src).toContain("source: { source: 'unsupported' as const }")
    expect(src).toContain("source: 'unsupported' as const")
    expect(src).toContain('isBareMarketplacePluginSource(sourceValue)')
    expect(src).toContain('Bare source names resolve under metadata.pluginRoot')
    expect(src).toContain('data = applyMarketplacePluginRoot(data)')
    expect(src).toContain('plugins: hoistMarketplacePlugins(rec.plugins)')
  })

  test('NSt/B$/hza/yza pin storageV5; B$ is getPluginById', () => {
    const src = readFileSync(
      join(import.meta.dir, '../marketplaceManager.ts'),
      'utf8',
    )
    expect(src).toContain(
      'export async function getPluginByIdCacheOnly(\n  pluginId: string,\n  storageV5?: unknown,',
    )
    expect(src).toContain(
      'export async function getPluginById(\n  pluginId: string,\n  storageV5?: unknown,',
    )
    expect(src).toContain(
      'const cached = await getPluginByIdCacheOnly(pluginId, storageV5)',
    )
    expect(src).toContain(
      'if (isCommandSourceRefused(error)) {\n      throw error',
    )
    expect(src).toContain(
      'export async function refreshAllMarketplaces(storageV5?: unknown)',
    )
    expect(src).toContain('}, storageV5)')
    const refresh = src.slice(
      src.indexOf('export async function refreshMarketplace('),
      src.indexOf('export async function setMarketplaceAutoUpdate('),
    )
    expect(refresh).toContain('storageV5?: unknown')
    expect(refresh).toContain('loadKnownMarketplacesConfig(storageV5)')
    expect(refresh).toContain(
      'throwIfReservedMarketplaceUntrusted(name, entry)',
    )
    expect(refresh).toContain('isSourceAllowedByPolicy(entry.source)')
    expect(refresh).toContain('publishUrlMarketplaceCatalogRefresh(')
    expect(refresh).toContain('readCachedMarketplaceZfe(')
  })

  test('gza is 4-arg; U maps CLI --scope; CLI wires pin', () => {
    expect(settingsSourceFromMarketplaceScope('user')).toBe('userSettings')
    expect(settingsSourceFromMarketplaceScope('project')).toBe(
      'projectSettings',
    )
    expect(settingsSourceFromMarketplaceScope('local')).toBe('localSettings')
    expect(settingsSourceFromMarketplaceScope(undefined)).toBeUndefined()
    const src = readFileSync(
      join(import.meta.dir, '../marketplaceManager.ts'),
      'utf8',
    )
    const gza = src.slice(
      src.indexOf('export async function removeMarketplaceSource('),
      src.indexOf('function wipePluginUsage('),
    )
    expect(gza).toContain('storageV5?: unknown')
    expect(gza).toContain('_credentials?: unknown')
    expect(gza).toContain('`${cachePath}.bak`')
    expect(gza).toContain('marketplaceUrlOrSettingsCacheKey(')
    expect(gza).toContain('wipePluginUsage(removedPluginIds, storageV5)')
    expect(gza).toContain(
      'await removeAllPluginsForMarketplace(name, storageV5)',
    )
    expect(gza).toContain(
      'await markPluginVersionOrphaned(installPath, storageV5)',
    )
    expect(gza).toContain(
      'await deletePluginOptions(pluginId, storageV5, _credentials)',
    )
    const handler = readFileSync(
      join(import.meta.dir, '../../../cli/handlers/plugins.ts'),
      'utf8',
    )
    expect(handler).toContain('settingsSourceFromMarketplaceScope(raw)')
    expect(handler).toContain('getPinnedStorageV5()')
    expect(handler).toContain('(from ${options.scope} settings)')
    const main = readFileSync(
      join(import.meta.dir, '../../../main.tsx'),
      'utf8',
    )
    expect(main).toContain(
      'Remove the marketplace declaration from a specific settings scope: user, project, or local. Omit to remove it from every scope.',
    )
  })

  test('Ar stamps telemetryMessage; JT is identifier-shaped CLI hint', () => {
    const err = new Error('full')
    const stamped = withTelemetryMessage(err, 'telem')
    expect(stamped).toBe(err)
    expect((stamped as { telemetryMessage?: string }).telemetryMessage).toBe(
      'telem',
    )
    const src = readFileSync(
      join(import.meta.dir, '../marketplaceManager.ts'),
      'utf8',
    )
    expect(src).toContain('return /^\\w[\\w.@-]*$/.test(arg)')
    expect(src).toContain(
      "return `claude ${command} ${arg}${extra ? ` ${extra}` : ''}`",
    )
    const bSt = src.slice(
      src.indexOf('export const getMarketplace = memoize'),
      src.indexOf('export async function getPluginByIdCacheOnly'),
    )
    expect(bSt).toContain('throw withTelemetryMessage(')
    expect(bSt).not.toContain(
      'throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(',
    )
  })

  test('vSt 3rd is storageV5 .gcs-sha read; zip write stays FS', () => {
    const manager = readFileSync(
      join(import.meta.dir, '../marketplaceManager.ts'),
      'utf8',
    )
    expect(manager).toContain('getMarketplacesCacheDir(),\n        storageV5,')
    const gcs = readFileSync(
      join(import.meta.dir, '../officialMarketplaceGcs.ts'),
      'utf8',
    )
    expect(gcs).toContain('storageV5?: unknown')
    expect(gcs).toContain('marketplaceTreeKeyForGcsSha(sentinelPath')
    expect(gcs).toContain('.readText([treeKey])')
    expect(gcs).toContain('join(staging, GCS_SHA_FILENAME), sha')
  })

  test('UI We() passes Provider credentials as gza 4th', () => {
    const manage = readFileSync(
      join(import.meta.dir, '../../../commands/plugin/ManageMarketplaces.tsx'),
      'utf8',
    )
    const settings = readFileSync(
      join(import.meta.dir, '../../../commands/plugin/PluginSettings.tsx'),
      'utf8',
    )
    expect(manage).toContain('useSessionServices()')
    expect(manage).toContain(
      'removeMarketplaceSource(state.name, undefined, storageV5, credentials)',
    )
    expect(settings).toContain('useSessionServices()')
    expect(settings).toContain(
      'removeMarketplaceSource(action.name, undefined, storageV5, credentials)',
    )
    expect(manage).not.toContain('getPinnedCredentials()')
    expect(settings).not.toContain('getPinnedCredentials()')
  })
})
