import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { mkdir, mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import {
  cloudPluginDownloadPath,
  expandOrgApiPath,
  formatSyncedRootRefusedError,
  isCloudListedPluginEnabled,
  LIST_PLUGINS_PAGE_CAP,
  LIST_PLUGINS_PAGE_SIZE,
  LIST_PLUGINS_PATH,
  listCoworkPluginEntries,
  mapCloudListedPlugin,
  mapCoworkListedPlugin,
  mergeCoworkAndCloudPlugins,
  mergeSyncedManifestAfterSync,
  omitSyncedManifestKeys,
  parseSyncedDownloadErrorBody,
  planSyncedPluginSync,
  retrySyncedDownloadOnce,
  SYNCED_MANIFEST_MAX_BYTES,
} from '../syncedPluginCloudSync.js'
import {
  createSyncedLiveDirClassifier,
  extractedTreeIsBareRepo,
} from '../syncedPluginSyncFs.js'
import {
  isReservedDottedSyncedName,
  isSyncedZipReservedSegment,
  LegacyReservedSpellingError,
  resolveSyncedItemLeaf,
  resolveSyncedPluginDir,
} from '../syncedPluginSyncNames.js'

describe('leftover 239 AZn / jal / Fzf / Uzf', () => {
  test('IVS list-plugins path + page size/cap', () => {
    expect(LIST_PLUGINS_PATH).toBe(
      '/api/oauth/organizations/:orgUUID/plugins/list-plugins?enabled_only=true&compact=true',
    )
    expect(LIST_PLUGINS_PAGE_SIZE).toBe(100)
    expect(LIST_PLUGINS_PAGE_CAP).toBe(20)
    expect(
      `${expandOrgApiPath(LIST_PLUGINS_PATH, 'org-1')}&limit=${LIST_PLUGINS_PAGE_SIZE}&offset=0`,
    ).toBe(
      '/api/oauth/organizations/org-1/plugins/list-plugins?enabled_only=true&compact=true&limit=100&offset=0',
    )
  })

  test('jal download path encodes id + optional version', () => {
    expect(cloudPluginDownloadPath('plug/a')).toBe(
      '/api/oauth/organizations/:orgUUID/plugins/plug%2Fa/download',
    )
    expect(cloudPluginDownloadPath('p1', '1.2.3')).toBe(
      '/api/oauth/organizations/:orgUUID/plugins/p1/download?version=1.2.3',
    )
  })

  test('qzf/jal uses requestedVersion only — Fzf version is not a pin', () => {
    const cloud = mapCloudListedPlugin({
      id: 'abc',
      name: 'demo',
      version: '1.2.3',
      updated_at: 't1',
    })
    expect(cloud.version).toBe('1.2.3')
    expect(cloud.requestedVersion).toBeUndefined()
    expect(
      cloudPluginDownloadPath(cloud.pluginId, cloud.requestedVersion),
    ).toBe('/api/oauth/organizations/:orgUUID/plugins/abc/download')
    const src = readFileSync(
      join(import.meta.dir, '../syncedPluginCloudSync.ts'),
      'utf8',
    )
    expect(src).toContain('plugin.requestedVersion')
    expect(src).not.toContain('plugin.requestedVersion ?? plugin.version')
  })

  test('Fzf / Uzf row map', () => {
    expect(
      mapCloudListedPlugin({
        id: 'abc',
        name: 'demo',
        description: undefined,
        version: undefined,
        updated_at: 't1',
      }),
    ).toEqual({
      pluginId: 'abc',
      name: 'demo',
      description: '',
      version: null,
      updatedAt: 't1',
    })
    expect(isCloudListedPluginEnabled({ enabled: false })).toBe(false)
    expect(isCloudListedPluginEnabled({ enabled: true })).toBe(true)
    expect(isCloudListedPluginEnabled({})).toBe(true)
  })

  test('zXl B = T + I + M keeps previous on fail', () => {
    const listed = [
      {
        pluginId: 'keep',
        name: 'keep',
        description: '',
        version: '1',
        updatedAt: null,
      },
      {
        pluginId: 'upd',
        name: 'upd',
        description: '',
        version: '2',
        updatedAt: null,
      },
      {
        pluginId: 'fresh',
        name: 'fresh',
        description: '',
        version: '1',
        updatedAt: null,
      },
    ]
    const kept = mergeSyncedManifestAfterSync(
      listed,
      new Set(['upd', 'fresh']),
      [],
      [
        { pluginId: 'keep', name: 'keep', version: '1' },
        { pluginId: 'upd', name: 'upd', version: '1' },
      ],
    )
    expect(kept.map(p => p.pluginId).sort()).toEqual(['keep', 'upd'])
    expect(kept.find(p => p.pluginId === 'upd')?.version).toBe('1')
  })

  test('Uln list fail is fail-closed so zXl jXl instead of wiping', async () => {
    const { resetSessionRefsStoreForTests, setSkillManifestGsGetForTests } =
      await import('../sessionRefsManifest.js')
    resetSessionRefsStoreForTests()
    setSkillManifestGsGetForTests(async () => ({
      ok: false,
      reason: 'no-auth',
    }))
    const listed = await listCoworkPluginEntries()
    expect(listed.success).toBe(false)
    if (!listed.success) expect(listed.error).toBe('manifest no_auth')
    const src = readFileSync(
      join(import.meta.dir, '../syncedPluginCloudSync.ts'),
      'utf8',
    )
    expect(src).toContain("listEntries('plugins')")
    expect(src).not.toContain('success: true, entries: []')
    resetSessionRefsStoreForTests()
  })

  test('C1h / xos cowork merge', () => {
    expect(
      mapCoworkListedPlugin({
        id: 'cw',
        directory: 'from-dir',
        name: 'ignored',
        version: '3',
      }),
    ).toEqual({
      pluginId: 'cw',
      name: 'from-dir',
      description: '',
      version: '3',
      updatedAt: null,
      requestedVersion: '3',
    })
    const merged = mergeCoworkAndCloudPlugins(
      [
        {
          pluginId: 'a',
          name: 'cowork-a',
          description: '',
          version: '1',
          updatedAt: null,
        },
      ],
      [
        {
          pluginId: 'a',
          name: 'cloud-a',
          description: '',
          version: '2',
          updatedAt: null,
        },
        {
          pluginId: 'b',
          name: 'cloud-b',
          description: '',
          version: '1',
          updatedAt: null,
        },
      ],
    )
    expect(merged.find(p => p.pluginId === 'a')?.name).toBe('cloud-a')
    expect(merged.map(p => p.pluginId).sort()).toEqual(['a', 'b'])
  })

  test('x1h extract path: unzip+iVE then e2t skipEntry MHa then W9n/Los', () => {
    const src = readFileSync(
      join(import.meta.dir, '../syncedPluginCloudSync.ts'),
      'utf8',
    )
    const unzipAt = src.indexOf("'unzip'")
    const iveAt = src.indexOf('auditSyncedExtractTree(staging)')
    const e2tAt = src.indexOf('extractZipToDirectory(zipPath, staging')
    const w9nAt = src.indexOf('unwrapZpfZipRoot(staging)')
    const losAt = src.indexOf('extractedTreeIsBareRepo(pluginRoot)')
    expect(unzipAt).toBeGreaterThan(-1)
    expect(iveAt).toBeGreaterThan(unzipAt)
    expect(e2tAt).toBeGreaterThan(iveAt)
    expect(w9nAt).toBeGreaterThan(e2tAt)
    expect(losAt).toBeGreaterThan(w9nAt)
    expect(src).toContain('skipEntry: skipZipEntryIfReserved')
    expect(src).toContain('extracted tree carries a bare-repo layout')
    expect(src).toContain('plugins_sync_unzip_fallback')
  })

  test('N1h always kicks zXl; env only gates AZn under Fhr', () => {
    const src = readFileSync(
      join(import.meta.dir, '../syncedPluginCloudSync.ts'),
      'utf8',
    )
    const n1h = src.slice(
      src.indexOf('export function awaitFirstSyncedPluginSync'),
    )
    expect(n1h).toContain('kickFirstSyncedPluginSync()')
    expect(n1h).not.toContain('isSyncPluginsEnabled()')
    expect(src).toContain(
      'isSyncPluginsEnabled() ? listOrgSyncedPlugins() : null',
    )
  })

  test('S0e fail-closed copy + tengu_plugins_sync_root_refused', () => {
    expect(
      formatSyncedRootRefusedError(
        'unverified',
        'EACCES',
        '/home/.claude/plugins',
      ),
    ).toBe(
      'claude.ai plugin sync disabled this session: /home/.claude/plugins could not be verified (EACCES)',
    )
    expect(
      formatSyncedRootRefusedError(
        'landing_absent',
        undefined,
        '/home/.claude/plugins',
      ),
    ).toBe(
      'claude.ai plugin sync disabled this session: /home/.claude/plugins was removed while a sync round was running',
    )
    expect(
      formatSyncedRootRefusedError(
        'parent_symlink',
        undefined,
        '/home/.claude/plugins',
      ),
    ).toBe(
      'claude.ai plugin sync disabled this session: /home/.claude/plugins is not a plain directory tree (a symlink or stray file is in the way)',
    )
    const src = readFileSync(
      join(import.meta.dir, '../syncedPluginCloudSync.ts'),
      'utf8',
    )
    expect(src).toContain('tengu_plugins_sync_root_refused')
    expect(src).toContain("phase: 'head'")
    expect(src).toContain("phase: 'post_registration'")
    expect(src).toContain('SYNCED_MARKETPLACE_NAME')
    expect(src).toContain('[root]')
  })

  test('N1h is wired at load; enable/disable are T0r; L1h at init', () => {
    const loader = readFileSync(
      join(import.meta.dir, '../pluginLoader.ts'),
      'utf8',
    )
    expect(loader).toContain('ensureSyncedPluginDirsHydrated')
    expect(loader).toContain('getSyncedPluginSyncErrors')
    const ops = readFileSync(
      join(import.meta.dir, '../../../services/plugins/pluginOperations.ts'),
      'utf8',
    )
    const cli = readFileSync(
      join(import.meta.dir, '../../../services/plugins/pluginCliCommands.ts'),
      'utf8',
    )
    expect(ops).toContain('hydrateSyncedPluginDirsFromDisk')
    expect(ops).not.toContain('ensureSyncedPluginDirsHydrated')
    expect(cli).toContain('hydrateSyncedPluginDirsFromDisk')
    expect(cli).not.toContain('ensureSyncedPluginDirsHydrated')
    const init = readFileSync(
      join(import.meta.dir, '../../../entrypoints/init.ts'),
      'utf8',
    )
    expect(init).toContain('kickFirstSyncedPluginSync')
  })
})

describe('leftover 239 rVE / Qui / Los / MHa', () => {
  const plugin = (
    id: string,
    name: string,
    extra: Partial<{
      updatedAt: string | null
      requestedVersion: string
      version: string | null
    }> = {},
  ) => ({
    pluginId: id,
    name,
    description: '',
    version: extra.version ?? null,
    updatedAt: extra.updatedAt ?? null,
    requestedVersion: extra.requestedVersion,
  })

  test('rVE downloads on updatedAt/name/requestedVersion, not version', () => {
    const listed = [plugin('a', 'demo', { version: '2', updatedAt: 't1' })]
    const local = [plugin('a', 'demo', { version: '1', updatedAt: 't1' })]
    const plan = planSyncedPluginSync(listed, local, '/tmp/synced')
    expect(plan.toDownload).toEqual([])
    expect(plan.carryover.map(p => p.pluginId)).toEqual(['a'])

    const renamed = planSyncedPluginSync(
      [plugin('a', 'demo-2', { updatedAt: 't1' })],
      [plugin('a', 'demo', { updatedAt: 't1' })],
      '/tmp/synced',
    )
    expect(renamed.toDownload.map(row => row.item.name)).toEqual(['demo-2'])
  })

  test('rVE toRemove is local ids not in the list', () => {
    const plan = planSyncedPluginSync(
      [plugin('keep', 'keep')],
      [plugin('keep', 'keep'), plugin('gone', 'gone')],
      '/tmp/synced',
    )
    expect(plan.toRemove.map(p => p.pluginId)).toEqual(['gone'])
  })

  test('Qui rejects dotted / reserved names', () => {
    expect(() => resolveSyncedPluginDir('.staging', '/tmp/synced')).toThrow(
      /reserved path/,
    )
    expect(() =>
      resolveSyncedPluginDir('manifest.json', '/tmp/synced'),
    ).toThrow(/reserved path/)
    expect(isReservedDottedSyncedName('.trash')).toBe(true)
    expect(isSyncedZipReservedSegment('.git')).toBe(true)
    expect(isSyncedZipReservedSegment('.trash')).toBe(false)
    expect(resolveSyncedPluginDir('demo', '/tmp/synced')).toBe(
      join('/tmp/synced', 'demo'),
    )
  })

  test('Los walks for head+(commondir|refs)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'los-'))
    expect(await extractedTreeIsBareRepo(root)).toBe(false)
    const nested = join(root, 'wrap')
    await mkdir(join(nested, 'refs'), { recursive: true })
    await writeFile(join(nested, 'HEAD'), 'ref: refs/heads/main')
    expect(await extractedTreeIsBareRepo(root)).toBe(true)
  })

  test('Oos live / not-live / indeterminate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oos-'))
    const live = join(root, 'demo')
    await mkdir(live)
    const classify = createSyncedLiveDirClassifier([live])
    expect(await classify(live)).toBe('live')
    expect(await classify(join(root, 'other'))).toBe('not-live')
    const alias = join(root, 'demo\u200c')
    expect(await classify(alias)).toBe('not-live')
    const { rm } = await import('fs/promises')
    await rm(live, { recursive: true, force: true })
    expect(await classify(alias)).toBe('indeterminate')
  })

  test('C resolves stale names with RNt, not Qui', () => {
    const src = readFileSync(
      join(import.meta.dir, '../syncedPluginCloudSync.ts'),
      'utf8',
    )
    const block = src.slice(
      src.indexOf('const trashIfNotLive'),
      src.indexOf('for (const name of stale)'),
    )
    expect(block).toContain('resolveSyncedItemLeaf')
    expect(block).not.toContain('resolveSyncedPluginDir')
    expect(block).toContain("kind === 'indeterminate'")
    expect(() =>
      resolveSyncedItemLeaf('manifest.json\u200c', '/tmp/synced'),
    ).toThrow(LegacyReservedSpellingError)
  })

  test('HVS retries once after failure', async () => {
    let calls = 0
    const second = await retrySyncedDownloadOnce(async () => {
      calls++
      return calls === 1 ? { ok: false as const } : { ok: true as const }
    })
    expect(calls).toBe(2)
    expect(second).toEqual({ ok: true })
    calls = 0
    const first = await retrySyncedDownloadOnce(async () => {
      calls++
      return { ok: true as const }
    })
    expect(calls).toBe(1)
    expect(first).toEqual({ ok: true })
  })

  test('wZn reads error.type or non_json_body', () => {
    expect(
      parseSyncedDownloadErrorBody(
        Buffer.from(JSON.stringify({ error: { type: 'over_quota' } })),
      ),
    ).toBe('over_quota')
    expect(
      parseSyncedDownloadErrorBody(Buffer.from(JSON.stringify({ error: {} }))),
    ).toBe('error_envelope_no_type')
    expect(parseSyncedDownloadErrorBody(Buffer.from('PK'))).toBe(
      'non_json_body',
    )
  })

  test('Hos keeps leftover keys; Kyo cap is 4MB', () => {
    expect(
      omitSyncedManifestKeys(
        { lastUpdated: 1, plugins: [], staleDirs: [], extra: 7 },
        ['lastUpdated', 'plugins', 'staleDirs'],
      ),
    ).toEqual({ extra: 7 })
    expect(SYNCED_MANIFEST_MAX_BYTES).toBe(4_194_304)
    const src = readFileSync(
      join(import.meta.dir, '../syncedPluginCloudSync.ts'),
      'utf8',
    )
    expect(src).toContain('omitSyncedManifestKeys')
    expect(src).toContain('retrySyncedDownloadOnce')
    expect(src).toContain('downloadOrgSyncedPluginZipStreamed')
    expect(src).toContain('isSyncPluginsBufferedDownloadEnabled')
  })

  test('no_changes does not fire tengu_plugins_sync_success', () => {
    const src = readFileSync(
      join(import.meta.dir, '../syncedPluginCloudSync.ts'),
      'utf8',
    )
    const start = src.indexOf(
      'if (plan.toDownload.length === 0 && plan.toRemove.length === 0)',
    )
    const end = src.indexOf('const downloaded', start)
    const block = src.slice(start, end)
    expect(block).toContain('plugins_sync_no_changes')
    expect(block).not.toContain('tengu_plugins_sync_success')
    expect(src).toContain('monitorEventLoopDelay')
  })

  test('$1h discardInflight then remints zXl; reload_plugins is the gold caller', () => {
    const src = readFileSync(
      join(import.meta.dir, '../syncedPluginCloudSync.ts'),
      'utf8',
    )
    const remint = src.slice(
      src.indexOf('export function remintFirstSyncedPluginSync'),
    )
    expect(remint).toContain('discardInflight()')
    expect(remint).toContain(
      'firstSyncPromise = (firstSyncPromise ?? Promise.resolve())',
    )
    expect(remint).toContain('.then(() => syncCloudSyncedPlugins())')
    const discardAt = remint.indexOf('discardInflight()')
    const remintAt = remint.indexOf(
      'firstSyncPromise = (firstSyncPromise ?? Promise.resolve())',
    )
    expect(discardAt).toBeGreaterThan(-1)
    expect(remintAt).toBeGreaterThan(discardAt)
    const print = readFileSync(
      join(import.meta.dir, '../../../cli/print.ts'),
      'utf8',
    )
    const reload = print.slice(print.indexOf("subtype === 'reload_plugins'"))
    expect(reload).toContain('remintFirstSyncedPluginSync')
    expect(reload).toContain('isSyncedPluginSyncKickEnabled')
    expect(reload).toContain('resolveSyncPluginsInstallTimeoutMs')
    const defines = readFileSync(
      join(import.meta.dir, '../../../../scripts/defines.ts'),
      'utf8',
    )
    expect(defines).toContain("// 'TREE_SITTER_BASH'")
    expect(defines).not.toMatch(/^\s*'TREE_SITTER_BASH'/m)
  })
})
