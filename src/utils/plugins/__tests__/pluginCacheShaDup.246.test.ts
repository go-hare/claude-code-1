/**
 * densable 2.1.246 #18 — official O8 SHA-dir / staging contract.
 *
 * Official O8 @213278204 = copyPluginToVersionedCache:
 *   zip vs dir dual path; in-use defer overwrite; remove
 *   superseded/incomplete version dir; seed cache.
 *   Stage via r_n @212732920: `${e}${odt}${hex8}` with odt=".tmp~"
 *   then kue atomic rename when NT(storageV5). Concurrent publish
 *   reuses dest ("was cached concurrently"). vue = /\.tmp~[0-9a-f]{8}$/.
 *
 * generateTemporaryCacheNameForPlugin stays cache-root
 * temp_${prefix}_${timestamp}_${random} (cachePlugin download).
 *
 * Official QU=Hl (command+link), AFe=Bl (marker), BLn=Vl
 * (`${dest}.linking-${pid}` then atomic rename). Oxd first-install
 * is not O8 relink. GG/T0o VFS main path is in pluginCacheStaging;
 * canServeSymlinkedVersionPath = versionPathIsTrustedForServe && versionDirHasPluginShapeMarkers && kq; FLn=Ut official list.
 * 09-16 promoted to HAVE.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const loader = readFileSync(join(import.meta.dir, '../pluginLoader.ts'), 'utf8')
const staging = readFileSync(
  join(import.meta.dir, '../pluginCacheStaging.ts'),
  'utf8',
)

describe('#18 plugin SHA-dir cache (2.1.246)', () => {
  test('official O8 staging / kue host is landed', () => {
    expect(loader).toContain(
      'export async function copyPluginToVersionedCache(',
    )
    expect(loader).toContain('already cached at')
    expect(loader).toContain('generateTemporaryCacheNameForPlugin')
    expect(loader).toMatch(/temp_\$\{prefix\}_\$\{timestamp\}_\$\{random\}/)
    expect(loader).toContain('was cached concurrently')
    expect(loader).toContain('superseded')
    expect(loader).toContain('deferring overwrite until it exits')
    expect(loader).toContain('plugin cache staged publish could not complete')
    expect(staging).toContain('.tmp~')
    expect(staging).toContain('plugin cache version path is occupied')
    expect(staging).toContain('/\\.tmp~[0-9a-f]{8}$/')
    expect(staging).toContain('stagePluginCachePath')
    expect(staging).toContain('publishStagedPluginCache')
    const o8 = loader.slice(
      loader.indexOf('export async function copyPluginToVersionedCache('),
    )
    expect(o8).toContain('isCommandPluginLinkMode(entry?.source)')
    expect(o8).toContain('hasCommandPluginLinkFarm(cachePath)')
    expect(o8).toContain('relinkCommandPluginLinkFarm(sourcePath, cachePath)')
    const commandSource = readFileSync(
      join(import.meta.dir, '../pluginCommandSource.ts'),
      'utf8',
    )
    expect(commandSource).toContain('.linking-')
    expect(commandSource).toContain('process.pid')
  })
})
