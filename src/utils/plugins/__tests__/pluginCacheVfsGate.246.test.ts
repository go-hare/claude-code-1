/**
 * densable 2.1.246 #18 — GG/T0o tri-state gate.
 *
 * Official bodies peeled from the 246 SEA, same module as NT/O8:
 *   YC @212701831   Sue @212733897   uS @212734131   Qw @212702166
 *   pSt @213262640  sLn @213262912   GG @213263440   zG @213262395
 *   vFe @213263129  TFe @213264030   T0o @213264986
 *
 * O8 @213278204 calls them directly:
 *   m = u ? await GG(d) : "real"
 *   h = () => g ??= m === "absent" ? "absent" : T0o(d, t, n, a)
 *
 * T0o symlink: canServeSymlinkedVersionPath = versionPathIsTrustedForServe && versionDirHasPluginShapeMarkers && kq.
 * FLn=Ut official marker list. `_ue` official path-safety helpers.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  assertPluginCacheVersionParentReal,
  classifyPluginCachePath,
  clearPluginCacheOccupant,
  decidePluginCacheServe,
  isPluginCacheVersionParentContained,
  versionPathIsTrustedForServe,
  getPluginCacheRoot,
  probePluginCacheVersionParent,
} from '../pluginCacheStaging.js'

const PREV = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR

let home: string
let root: string
/** `<root>/m/p` — the version parent O8 probes. */
let parent: string

/** Windows without developer mode refuses symlinks; skip those assertions. */
function trySymlink(target: string, path: string): boolean {
  try {
    symlinkSync(target, path, 'dir')
    return true
  } catch {
    return false
  }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'vfs246-'))
  process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = home
  root = getPluginCacheRoot()
  parent = join(root, 'm', 'p')
  mkdirSync(parent, { recursive: true })
})

afterEach(async () => {
  if (PREV === undefined) delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  else process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = PREV
  await rm(home, { recursive: true, force: true })
})

describe('uS @212734131 — classifyPluginCachePath', () => {
  test('absent / other for a missing path, a directory and a file', async () => {
    expect(await classifyPluginCachePath(join(parent, 'nope'))).toBe('absent')

    const dir = join(parent, '1.0.0')
    mkdirSync(dir)
    expect(await classifyPluginCachePath(dir)).toBe('other')

    const file = join(parent, '2.0.0')
    writeFileSync(file, 'not a dir')
    expect(await classifyPluginCachePath(file)).toBe('other')
  })

  test('symlink — Sue catches a link wearing the version name', async () => {
    const real = join(home, 'elsewhere')
    mkdirSync(real)
    const link = join(parent, '3.0.0')
    if (!trySymlink(real, link)) return
    expect(await classifyPluginCachePath(link)).toBe('symlink')
  })
})

describe('pSt @213262640 / GG @213263440 — version parent gate', () => {
  test('real when the parent is exactly two real segments under the root', async () => {
    expect(await isPluginCacheVersionParentContained(parent)).toBe(true)
    expect(await probePluginCacheVersionParent(join(parent, '1.0.0'))).toBe(
      'real',
    )
  })

  test('refused at the wrong depth and outside the cache root', async () => {
    // one segment
    expect(await isPluginCacheVersionParentContained(join(root, 'm'))).toBe(
      false,
    )
    // three segments
    const deep = join(root, 'm', 'p', 'extra')
    mkdirSync(deep, { recursive: true })
    expect(await isPluginCacheVersionParentContained(deep)).toBe(false)
    // escapes the root entirely
    expect(await isPluginCacheVersionParentContained(home)).toBe(false)
    expect(await probePluginCacheVersionParent(join(home, '1.0.0'))).toBe(
      'refused',
    )
  })

  test('refused when a segment is a link rather than a real directory', async () => {
    const realPlugin = join(home, 'real-plugin')
    mkdirSync(realPlugin)
    const linked = join(root, 'm', 'linked')
    if (!trySymlink(realPlugin, linked)) return
    expect(await isPluginCacheVersionParentContained(linked)).toBe(false)
  })

  test('absent when a parent segment is missing entirely', async () => {
    expect(
      await probePluginCacheVersionParent(join(root, 'm', 'gone', '1.0.0')),
    ).toBe('absent')
  })
})

describe('T0o @213264986 — decidePluginCacheServe', () => {
  test('source-locks canServeSymlinkedVersionPath official formula', () => {
    const src = readFileSync(
      join(import.meta.dir, '../pluginCacheStaging.ts'),
      'utf8',
    )
    expect(src).toContain('export async function canServeSymlinkedVersionPath')
    expect(src).toContain('export async function isPathContainedInTrustedRoot')
    expect(src).toContain('export async function walkSegmentsWithinTrustedRoot')
    expect(src).toContain('export async function versionPathIsTrustedForServe')
    expect(src).toContain('const MAX_TRUSTED_ROOT_WALK_HOPS = 40')
    expect(src).toContain('await versionPathIsTrustedForServe(versionPath)')
    expect(src).toContain('await versionDirHasPluginShapeMarkers(versionPath)')
    expect(src).toContain("'.claude-plugin'")
    expect(src).toContain("'SKILL.md'")
    expect(src).toContain("'.mcp.json'")
    expect(src).toContain('const PLUGIN_SHAPE_MARKER_NAMES')
    expect(src).toContain('function createLinkSafetyChecker')
    expect(src).toContain('function resolveAutofsNetMountPath')
    expect(src).toContain('function isUntrustedNetworkOrDevicePath')
    expect(src).toContain('whenUnreadable: false')
    expect(src).toContain('densable leftover `k0o` @213347520')
    expect(src).toContain(
      'plugin cache version parent not contained before reuse',
    )
    expect(src).toContain('PLUGIN_CACHE_VERSION_PARENT_K0O[stage]')
    // 语义化后这行超过 80 列被 biome 折行，故按去空白后比对
    expect(src.replace(/\s+/g, ' ')).toContain(
      "(await canServeSymlinkedVersionPath(versionPath)) ? 'serve' : 'republish'",
    )
  })

  test('absent, serve on payload, republish on an empty directory', async () => {
    const version = join(parent, '1.0.0')
    expect(await decidePluginCacheServe(version, 'p', '1.0.0', false)).toBe(
      'absent',
    )

    mkdirSync(version)
    expect(await decidePluginCacheServe(version, 'p', '1.0.0', false)).toBe(
      'republish',
    )

    writeFileSync(join(version, 'plugin.md'), 'payload')
    expect(await decidePluginCacheServe(version, 'p', '1.0.0', false)).toBe(
      'serve',
    )
  })

  test('reserved-only entries do not count as payload', async () => {
    const version = join(parent, '2.0.0')
    mkdirSync(join(version, 'node_modules'), { recursive: true })
    writeFileSync(join(version, '.in_use'), '')
    expect(await decidePluginCacheServe(version, 'p', '2.0.0', false)).toBe(
      'republish',
    )
  })

  test('a link occupant republishes — canServeSymlinkedVersionPath official formula', async () => {
    const real = join(home, 'link-target')
    mkdirSync(real)
    writeFileSync(join(real, 'plugin.md'), 'payload')
    const version = join(parent, '3.0.0')
    if (!trySymlink(real, version)) return
    // plugin.md is not in official FLn=Ut; a0n stays false → republish.
    expect(await versionPathIsTrustedForServe(version)).toBe(true)
    expect(await decidePluginCacheServe(version, 'p', '3.0.0', false)).toBe(
      'republish',
    )
  })

  test('link + FLn marker + payload serves — versionDirHasPluginShapeMarkers official Ut', async () => {
    const real = join(home, 'fln-target')
    mkdirSync(real)
    writeFileSync(join(real, 'plugin.md'), 'payload')
    mkdirSync(join(real, '.claude-plugin'))
    const version = join(parent, '4.0.0')
    if (!trySymlink(real, version)) return
    expect(await versionPathIsTrustedForServe(version)).toBe(true)
    expect(await decidePluginCacheServe(version, 'p', '4.0.0', false)).toBe(
      'serve',
    )
  })
})

describe('TFe @213264030 / vFe @213263129', () => {
  test('clearPluginCacheOccupant — done when absent, recurse on a directory', async () => {
    const version = join(parent, '1.0.0')
    expect(await clearPluginCacheOccupant(version, 'p', '1.0.0')).toBe('done')
    mkdirSync(version)
    expect(await clearPluginCacheOccupant(version, 'p', '1.0.0')).toBe(
      'recurse',
    )
  })

  test('clearPluginCacheOccupant removes a stray link and reports done', async () => {
    const real = join(home, 'stray-target')
    mkdirSync(real)
    const version = join(parent, '4.0.0')
    if (!trySymlink(real, version)) return
    expect(await clearPluginCacheOccupant(version, 'p', '4.0.0')).toBe('done')
    expect(await classifyPluginCachePath(version)).toBe('absent')
  })

  test('assertPluginCacheVersionParentReal carries the locked telemetry code', async () => {
    const outside = join(home, '1.0.0')
    await expect(
      assertPluginCacheVersionParentReal(
        outside,
        'p',
        '1.0.0',
        'cache',
        'before reuse',
        'refused',
      ),
    ).rejects.toMatchObject({
      telemetryMessage:
        'plugin cache version parent not contained before reuse',
    })
  })

  test('assertPluginCacheVersionParentReal re-probes and passes when real', async () => {
    await assertPluginCacheVersionParentReal(
      join(parent, '1.0.0'),
      'p',
      '1.0.0',
      'cache',
      'before overwrite',
    )
  })

  test('assertPluginCacheVersionParentReal honors caller-supplied real probe', async () => {
    // Outside the cache root — a re-probe would refuse. Caller already
    // knows the parent is real and skips; must not throw.
    await assertPluginCacheVersionParentReal(
      join(home, '1.0.0'),
      'p',
      '1.0.0',
      'cache',
      'before reuse',
      'real',
    )
  })
})
