/**
 * densable 2.1.229 #16 — plugin `.in_use` liveness markers (IId / $6_ / vTn).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _resetPluginInUseMarkersForTesting,
  getOwnInUseMarkerPathsForTesting,
  IN_USE_DIRNAME,
  IN_USE_LINKS_DIRNAME,
  markPluginVersionInUse,
  pluginVersionHasLiveUsers,
  resolveInUseLinksMarkerDir,
} from '../pluginInUseMarkers.js'

const temps: string[] = []
const prevCacheDir = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR

beforeEach(() => {
  _resetPluginInUseMarkersForTesting()
})

afterEach(async () => {
  _resetPluginInUseMarkersForTesting()
  if (prevCacheDir === undefined) {
    delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  } else {
    process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = prevCacheDir
  }
  await Promise.all(
    temps.splice(0).map(p => rm(p, { recursive: true, force: true })),
  )
})

describe('densable 2.1.229 #16 markPluginVersionInUse (IId)', () => {
  test('writes .in_use/<pid> JSON for a normal cache version dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cc-inuse-'))
    temps.push(root)
    process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = root

    const versionPath = join(root, 'cache', 'mp', 'plug', '1.0.0')
    await mkdir(versionPath, { recursive: true })

    await markPluginVersionInUse(versionPath)

    const markerPath = join(versionPath, IN_USE_DIRNAME, String(process.pid))
    const raw = await readFile(markerPath, 'utf8')
    const payload = JSON.parse(raw) as { pid: number }
    expect(payload.pid).toBe(process.pid)
    expect(getOwnInUseMarkerPathsForTesting().has(markerPath)).toBe(true)
  })

  test('symlink version writes under .in_use-links mirror (RId/STn)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cc-inuse-link-'))
    temps.push(root)
    process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = root

    const realVersion = join(root, 'real-version')
    await mkdir(realVersion, { recursive: true })
    const versionPath = join(root, 'cache', 'mp', 'plug', '1.0.0')
    await mkdir(join(root, 'cache', 'mp', 'plug'), { recursive: true })
    await symlink(realVersion, versionPath)

    await markPluginVersionInUse(versionPath)

    const linkDir = resolveInUseLinksMarkerDir(versionPath)
    expect(linkDir).toBe(
      join(root, IN_USE_LINKS_DIRNAME, 'mp', 'plug', '1.0.0'),
    )
    const markerPath = join(linkDir!, String(process.pid))
    const raw = await readFile(markerPath, 'utf8')
    expect(JSON.parse(raw).pid).toBe(process.pid)
    // must not create .in_use through the symlink into realVersion
    const realEntries = await readdir(realVersion)
    expect(realEntries).not.toContain(IN_USE_DIRNAME)
  })
})

describe('densable 2.1.229 #16 pluginVersionHasLiveUsers (vTn/wId)', () => {
  test('live self marker reports true; dead pid is swept', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cc-inuse-live-'))
    temps.push(root)
    process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = root

    const versionPath = join(root, 'cache', 'mp', 'plug', '2.0.0')
    const inUse = join(versionPath, IN_USE_DIRNAME)
    await mkdir(inUse, { recursive: true })
    await writeFile(
      join(inUse, String(process.pid)),
      JSON.stringify({ pid: process.pid }),
      'utf8',
    )
    // dead pid (unlikely to be running; identity optional → still needs isProcessRunning)
    await writeFile(
      join(inUse, '999999991'),
      JSON.stringify({ pid: 999999991 }),
      'utf8',
    )

    const live = await pluginVersionHasLiveUsers(versionPath)
    expect(live).toBe(true)

    const remaining = await readdir(inUse)
    expect(remaining).toContain(String(process.pid))
    expect(remaining).not.toContain('999999991')
  })

  test('empty marker dir → false', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cc-inuse-empty-'))
    temps.push(root)
    process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = root
    const versionPath = join(root, 'cache', 'mp', 'plug', '3.0.0')
    await mkdir(join(versionPath, IN_USE_DIRNAME), { recursive: true })
    expect(await pluginVersionHasLiveUsers(versionPath)).toBe(false)
  })
})
