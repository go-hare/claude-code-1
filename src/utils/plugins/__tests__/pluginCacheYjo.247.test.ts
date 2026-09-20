/**
 * densable 2.1.247 #19 — Yjo dest publish/move.
 *
 * Official Yjo @214631161: BOe aside, $jo lutimes, Kjo EXDEV|RNn
 * fallback rm-in-place, restore aside on fail, rm aside on success.
 * Fjo always calls Yjo. No version==="unknown" skip-rm gate.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { RENAME_TRANSIENT_CODES } from '../../renameRetry.js'
import {
  isPluginCacheAsideRenameFallback,
  movePluginCacheDest,
} from '../pluginCacheStaging.js'

const staging = readFileSync(
  join(import.meta.dir, '../pluginCacheStaging.ts'),
  'utf8',
)
const helpers = readFileSync(
  join(import.meta.dir, '../pluginInstallationHelpers.ts'),
  'utf8',
)

const temps: string[] = []

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException
  error.code = code
  return error
}

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yjo247-'))
  temps.push(dir)
  return dir
}

describe('#19 Yjo dest publish (2.1.247)', () => {
  test('official strings and Kjo codes; no version-unknown skip', () => {
    const yjo = staging.slice(
      staging.indexOf('export function isPluginCacheAsideRenameFallback('),
    )
    expect(yjo).toContain('cannot be renamed aside')
    expect(yjo).toContain('removing it in place instead')
    expect(yjo).toContain("code === 'EXDEV'")
    expect(yjo).toContain('RENAME_TRANSIENT_CODES.has')
    expect(yjo).toContain('lutimes(')
    expect(yjo).toContain('stagePluginCachePath(')
    expect(yjo).toContain('await rm(dest, { recursive: true, force: true })')
    expect(yjo).toContain('await rm(aside, { recursive: true, force: true })')
    expect(yjo).not.toMatch(
      /if\s*\(\s*(?:opts\.)?version\s*===\s*['"]unknown['"]/,
    )

    expect([...RENAME_TRANSIENT_CODES].sort()).toEqual(
      ['EACCES', 'EBUSY', 'EPERM'].sort(),
    )
    expect(isPluginCacheAsideRenameFallback(errno('EXDEV'))).toBe(true)
    expect(isPluginCacheAsideRenameFallback(errno('EPERM'))).toBe(true)
    expect(isPluginCacheAsideRenameFallback(errno('EBUSY'))).toBe(true)
    expect(isPluginCacheAsideRenameFallback(errno('EACCES'))).toBe(true)
    expect(isPluginCacheAsideRenameFallback(errno('EEXIST'))).toBe(false)
    expect(isPluginCacheAsideRenameFallback(errno('ENOENT'))).toBe(false)

    const fjo = helpers.slice(
      helpers.indexOf('export async function cacheAndRegisterPlugin('),
    )
    expect(fjo).toContain('movePluginCacheDest(')
    expect(fjo).toContain('strictCache: isPluginCacheStorageV5(')
    expect(fjo).not.toMatch(/if\s*\(\s*version\s*===\s*['"]unknown['"]/)
    expect(fjo).not.toContain('await rm(versionedPath')
  })

  test('aside-then-rm: dest occupant is replaced; aside sibling is gone', async () => {
    const root = await scratch()
    const dest = join(root, 'm', 'p', '1.0.0')
    const src = join(root, 'staged')
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'old.txt'), 'live')
    mkdirSync(src)
    writeFileSync(join(src, 'new.txt'), 'fresh')

    await movePluginCacheDest(src, dest, {
      pluginId: 'p@m',
      version: 'unknown',
    })

    expect(readFileSync(join(dest, 'new.txt'), 'utf8')).toBe('fresh')
    expect(readdirSync(dest)).not.toContain('old.txt')
    const parent = join(root, 'm', 'p')
    expect(readdirSync(parent).some(name => name.includes('.tmp~'))).toBe(false)
  })

  test('dest absent (kg) still publishes; not a keep-cache skip', async () => {
    const root = await scratch()
    const dest = join(root, 'm', 'p', '1.0.0')
    const src = join(root, 'staged')
    mkdirSync(src)
    writeFileSync(join(src, 'new.txt'), 'fresh')

    await movePluginCacheDest(src, dest, {
      pluginId: 'p@m',
      version: 'unknown',
    })

    expect(readFileSync(join(dest, 'new.txt'), 'utf8')).toBe('fresh')
  })

  test('src→dest fail restores the aside occupant', async () => {
    const root = await scratch()
    const dest = join(root, 'm', 'p', '1.0.0')
    const src = join(root, 'missing-staged')
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'old.txt'), 'live')

    await expect(
      movePluginCacheDest(src, dest, {
        pluginId: 'p@m',
        version: '1.0.0',
      }),
    ).rejects.toBeDefined()

    expect(readFileSync(join(dest, 'old.txt'), 'utf8')).toBe('live')
    expect(
      readdirSync(join(root, 'm', 'p')).some(name => name.includes('.tmp~')),
    ).toBe(false)
  })

  test('dest under src uses official temp hop then publishes', async () => {
    const root = await scratch()
    const src = join(root, 'same')
    const dest = join(src, 'm', 'p', '1.0.0')
    mkdirSync(src)
    writeFileSync(join(src, 'new.txt'), 'fresh')

    await movePluginCacheDest(src, dest, {
      pluginId: 'p@m',
      version: '1.0.0',
    })

    expect(readFileSync(join(dest, 'new.txt'), 'utf8')).toBe('fresh')
  })
})
