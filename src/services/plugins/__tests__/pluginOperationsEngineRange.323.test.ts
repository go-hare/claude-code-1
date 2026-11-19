import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as realPluginLoader from '../../../utils/plugins/pluginLoader.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

const pluginLoaderSnap = snapshotModuleExports(realPluginLoader)

let mockedCacheResult: {
  path: string
  manifest: Record<string, unknown>
} | null = null

mock.module('../../../utils/plugins/pluginLoader.js', () => ({
  ...pluginLoaderSnap,
  cachePlugin: async (...args: unknown[]) => {
    if (mockedCacheResult) {
      return mockedCacheResult
    }
    return await (
      pluginLoaderSnap.cachePlugin as (...a: unknown[]) => Promise<unknown>
    )(...args)
  },
}))

afterAll(() => {
  mock.module('../../../utils/plugins/pluginLoader.js', () => ({
    ...pluginLoaderSnap,
  }))
})

import { performPluginUpdate } from '../pluginOperations.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  mockedCacheResult = null
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('#1965 performPluginUpdate engines["claude-code"] gating', () => {
  test('skips remote update and cleans up cache when downloaded manifest.engines excludes current Claude Code', async () => {
    const cachedTempDir = makeTempDir('w323-remote-cache-')
    writeFileSync(join(cachedTempDir, 'marker.txt'), 'temp')
    const currentInstallDir = makeTempDir('w323-remote-installed-')
    mockedCacheResult = {
      path: cachedTempDir,
      manifest: {
        name: 'demo-remote',
        version: '2.0.0',
        engines: { 'claude-code': '>=99.0.0' },
      },
    }

    const res = await performPluginUpdate({
      pluginId: 'demo-remote@test-mp',
      pluginName: 'demo-remote',
      entry: {
        name: 'demo-remote',
        strict: false,
        source: {
          source: 'url',
          url: 'https://example.com/demo-remote.git',
        },
      },
      marketplaceInstallLocation: '/unused',
      installation: {
        version: '1.0.0',
        installPath: currentInstallDir,
      },
      scope: 'user',
      projectPath: undefined,
    })

    expect(res.success).toBe(false)
    expect(res.skipReason).toBe('engine_range')
    expect(res.message).toContain('needs Claude Code >=99.0.0')
    expect(existsSync(cachedTempDir)).toBe(false)
    expect(existsSync(currentInstallDir)).toBe(true)
  })

  test('skips local marketplace plugin update when plugin.json engines excludes current Claude Code', async () => {
    const mpDir = makeTempDir('w323-local-mp-')
    const pluginDir = join(mpDir, 'plugins', 'demo-local')
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'demo-local',
        version: '2.0.0',
        engines: { 'claude-code': '>=99.0.0' },
      }),
    )

    const res = await performPluginUpdate({
      pluginId: 'demo-local@local-mp',
      pluginName: 'demo-local',
      entry: {
        name: 'demo-local',
        strict: false,
        source: './plugins/demo-local',
      },
      marketplaceInstallLocation: mpDir,
      installation: {
        version: '1.0.0',
        installPath: makeTempDir('w323-local-installed-'),
      },
      scope: 'user',
      projectPath: undefined,
    })

    expect(res.success).toBe(false)
    expect(res.skipReason).toBe('engine_range')
    expect(res.message).toContain('needs Claude Code >=99.0.0')
  })
})
