/**
 * densable 2.1.246 #18 — r_n / kue / vue runtime.
 * 09-16 promoted to HAVE.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { recordHoverRestDecision } from '../../storageV5/index.js'
import { resetHoverRestPinForTests } from '../../storageV5/hoverRestPin.js'
import { listPluginCacheSubdirs } from '../cacheUtils.js'
import {
  classifyPluginCacheStagingName,
  isPluginCacheStagingName,
  isPluginCacheStorageV5,
  splitPluginCacheRelativeParts,
  getPluginCacheRoot,
  isPluginCacheVersionDirPath,
  pluginCacheHasPayload,
  publishStagedPluginCache,
  stagePluginCachePath,
} from '../pluginCacheStaging.js'

const temps: string[] = []

afterEach(async () => {
  resetHoverRestPinForTests()
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('#18 plugin cache staging runtime (2.1.246)', () => {
  test('r_n sibling is dest + .tmp~ + hex8', () => {
    const dest = join('/tmp', 'cache', 'm', 'p', '1.0.0')
    const staged = stagePluginCachePath(dest)
    expect(staged.startsWith(`${dest}.tmp~`)).toBe(true)
    expect(isPluginCacheStagingName(staged.slice(dest.length))).toBe(true)
    expect(
      classifyPluginCacheStagingName(`${'1.0.0'}.tmp~abcd0123`, '1.0.0'),
    ).toBe('current')
    expect(classifyPluginCacheStagingName('1.0.0', '1.0.0')).toBeNull()
    expect(classifyPluginCacheStagingName('1.0.0.tmp.abcd0123', '1.0.0')).toBe(
      'scratch',
    )
    expect(classifyPluginCacheStagingName('2.0.0', '1.0.0')).toBeNull()
  })

  test('kue publishes then refuses an occupied dest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'o8-'))
    temps.push(root)
    const dest = join(root, '1.0.0')
    const staging = stagePluginCachePath(dest)
    mkdirSync(staging)
    writeFileSync(join(staging, 'plugin.md'), 'ok')
    await publishStagedPluginCache(staging, dest)
    expect(await pluginCacheHasPayload(dest)).toBe(true)

    const again = stagePluginCachePath(dest)
    mkdirSync(again)
    writeFileSync(join(again, 'plugin.md'), 'race')
    await expect(publishStagedPluginCache(again, dest)).rejects.toMatchObject({
      message: 'plugin cache version path is occupied',
      code: 'EEXIST',
    })
  })

  test('NT is Be() + handle + Yn dummy — no invent qF', () => {
    expect(isPluginCacheStorageV5({})).toBe(false)
    recordHoverRestDecision(true)
    expect(isPluginCacheStorageV5(undefined)).toBe(false)
    expect(isPluginCacheStorageV5({})).toBe(true)
    const root = getPluginCacheRoot()
    expect(
      isPluginCacheVersionDirPath(join(root, '_', '_', '_'), root),
    ).toEqual({
      marketplace: '_',
      plugin: '_',
      version: '_',
    })
    expect(
      isPluginCacheVersionDirPath(join(root, 'm', 'p', '1.0.0.zip'), root),
    ).toBeNull()
    expect(
      splitPluginCacheRelativeParts(join(root, 'm', 'p'), '/not-cache'),
    ).toBeNull()
  })

  test('listPluginCacheSubdirs skips vue staging siblings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'o8-list-'))
    temps.push(root)
    mkdirSync(join(root, '1.0.0'))
    mkdirSync(join(root, '1.0.0.tmp~abcd0123'))
    const names = await listPluginCacheSubdirs(root)
    expect(names).toContain('1.0.0')
    expect(names).not.toContain('1.0.0.tmp~abcd0123')
  })
})
