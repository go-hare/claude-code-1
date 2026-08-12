/**
 * densable 2.1.228 #9 — never mark/delete a symlinked plugin version
 * (dev/link installs). SEA: YEt/Mst/o5b/s5b.
 * Also: listPluginCacheSubdirs must see symlink versions so removeIfEmpty
 * does not delete sole-link marketplace/plugin parents.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdtemp,
  mkdir,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listPluginCacheSubdirs,
  markPluginVersionOrphaned,
} from '../cacheUtils.js'

const temps: string[] = []

afterEach(async () => {
  await Promise.all(
    temps.splice(0).map(p => rm(p, { recursive: true, force: true })),
  )
})

describe('densable 2.1.228 #9 plugin symlink orphan skip', () => {
  test('markPluginVersionOrphaned does not write .orphaned_at on symlink path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cc-plugin-symlink-'))
    temps.push(root)

    const realVersion = join(root, 'real-version')
    const linkVersion = join(root, 'link-version')
    await mkdir(realVersion)
    await writeFile(join(realVersion, 'plugin.json'), '{}', 'utf8')
    await symlink(realVersion, linkVersion)

    expect(await readlink(linkVersion)).toBe(realVersion)

    await markPluginVersionOrphaned(linkVersion)

    // densable: YEt true → return before writeFile(.orphaned_at)
    // symlink points at realVersion; marker must not appear on either side
    // of the link as a result of mark (writeFile on symlink would write
    // through to realVersion — densable short-circuits before any write).
    const linkEntries = await readdir(linkVersion)
    const realEntries = await readdir(realVersion)
    expect(linkEntries).not.toContain('.orphaned_at')
    expect(realEntries).not.toContain('.orphaned_at')
  })

  test('markPluginVersionOrphaned writes .orphaned_at for normal directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cc-plugin-dir-'))
    temps.push(root)
    const versionPath = join(root, '1.0.0')
    await mkdir(versionPath)

    await markPluginVersionOrphaned(versionPath)

    const entries = await readdir(versionPath)
    expect(entries).toContain('.orphaned_at')
  })

  test('listPluginCacheSubdirs includes symlink version entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cc-plugin-list-'))
    temps.push(root)
    const realVersion = join(root, 'real-1.0.0')
    const linkVersion = join(root, '1.0.0')
    await mkdir(realVersion)
    await symlink(realVersion, linkVersion)

    const names = await listPluginCacheSubdirs(root)
    expect(names).toContain('1.0.0')
    // pure-dir filter would miss the symlink and make parent look empty
    expect(names.length).toBeGreaterThanOrEqual(1)
  })
})
