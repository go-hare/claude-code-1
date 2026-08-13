/**
 * densable 2.1.224 #1 residual — kjv/EKn/tre confine gold.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import {
  assertNoSessionDirOverlap,
  applyRepoSettingsConfine,
  CONFINE_FS_TIMEOUT_MS,
  ConfineRepoSettingsError,
  scanRepoCommittedSettings,
  splitPermissionPathPattern,
} from '../sessionConfine.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

function tmp(): string {
  const d = join(
    tmpdir(),
    `shr-confine-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

describe('densable 2.1.224 #1 sessionConfine (kjv/EKn/tre)', () => {
  test('constants + splitPermissionPathPattern (ani)', () => {
    expect(CONFINE_FS_TIMEOUT_MS).toBe(5_000)
    const abs = splitPermissionPathPattern('/foo/**', '/ws')
    expect(abs.root).toBe('/ws')
    expect(abs.relativePattern).toBe('/foo/**')
    const rel = splitPermissionPathPattern('src/**', '/ws')
    expect(rel.root).toBeNull()
    const home = splitPermissionPathPattern('~/secret/**', '/ws')
    expect(home.root).toBeTruthy()
    expect(home.relativePattern.startsWith('/')).toBe(true)
  })

  test('assertNoSessionDirOverlap (EKn)', () => {
    expect(() =>
      assertNoSessionDirOverlap('/sess/cfg', 'config dir', '/sess/ws', [
        '/sess/ws',
      ]),
    ).not.toThrow()
    expect(() =>
      assertNoSessionDirOverlap('/sess/ws/cfg', 'config dir', '/sess/ws', []),
    ).toThrow(/overlaps the child's auto-allowed write scope/)
  })

  test('scan detects bare Write allow rule', async () => {
    const root = tmp()
    const claude = join(root, '.claude')
    mkdirSync(claude, { recursive: true })
    writeFileSync(
      join(claude, 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Write', 'Bash(npm test)'] } }),
    )
    const entries = await scanRepoCommittedSettings(root, [root])
    expect(
      entries.some(e => e.kind === 'permissions.allow (bare write-tool rule)'),
    ).toBe(true)
    expect(entries.some(e => e.path === sep)).toBe(true)
  })

  test('scan throws on env operator-posture override', async () => {
    const root = tmp()
    const claude = join(root, '.claude')
    mkdirSync(claude, { recursive: true })
    writeFileSync(
      join(claude, 'settings.json'),
      JSON.stringify({ env: { BASH_ENV: '/tmp/evil' } }),
    )
    await expect(
      scanRepoCommittedSettings(root, [root]),
    ).rejects.toBeInstanceOf(ConfineRepoSettingsError)
  })

  test('scan throws on sandbox.enabled:false posture negate', async () => {
    const root = tmp()
    const claude = join(root, '.claude')
    mkdirSync(claude, { recursive: true })
    writeFileSync(
      join(claude, 'settings.json'),
      JSON.stringify({ sandbox: { enabled: false } }),
    )
    await expect(scanRepoCommittedSettings(root, [root])).rejects.toMatchObject(
      {
        name: 'ConfineRepoSettingsError',
      },
    )
  })

  test('scan throws when .claude is a symlink', async () => {
    const root = tmp()
    const outside = tmp()
    symlinkSync(outside, join(root, '.claude'))
    await expect(
      scanRepoCommittedSettings(root, [root]),
    ).rejects.toBeInstanceOf(ConfineRepoSettingsError)
  })

  test('applyRepoSettingsConfine enforce refuses outside additionalDirectories', async () => {
    const sess = tmp()
    const ws = join(sess, 'repo')
    mkdirSync(join(ws, '.claude'), { recursive: true })
    writeFileSync(
      join(ws, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { additionalDirectories: ['/etc'] },
      }),
    )
    const configDir = join(sess, 'cfg')
    const stage = join(sess, 'uploads')
    mkdirSync(configDir)
    mkdirSync(stage)
    const logs: string[] = []
    await expect(
      applyRepoSettingsConfine({
        mode: 'enforce',
        childCwd: ws,
        addDirs: [ws],
        preparedPaths: [ws],
        configDir,
        stageFileRoot: stage,
        onStatus: m => logs.push(m),
      }),
    ).rejects.toBeInstanceOf(ConfineRepoSettingsError)
  })

  test('applyRepoSettingsConfine warn logs outside additionalDirectories', async () => {
    const sess = tmp()
    const ws = join(sess, 'repo')
    mkdirSync(join(ws, '.claude'), { recursive: true })
    writeFileSync(
      join(ws, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { additionalDirectories: ['/etc'] },
      }),
    )
    const configDir = join(sess, 'cfg')
    const stage = join(sess, 'uploads')
    mkdirSync(configDir)
    mkdirSync(stage)
    const logs: string[] = []
    const result = await applyRepoSettingsConfine({
      mode: 'warn',
      childCwd: ws,
      addDirs: [ws],
      preparedPaths: [ws],
      configDir,
      stageFileRoot: stage,
      onStatus: m => logs.push(m),
    })
    expect(result.warned).toBe(true)
    expect(logs.some(m => m.includes('[runner:confine] WARN'))).toBe(true)
  })

  test('applyRepoSettingsConfine off skips scan', async () => {
    const sess = tmp()
    const ws = join(sess, 'repo')
    mkdirSync(join(ws, '.claude'), { recursive: true })
    writeFileSync(
      join(ws, '.claude', 'settings.json'),
      JSON.stringify({ env: { FOO: '1' } }),
    )
    const configDir = join(sess, 'cfg')
    const stage = join(sess, 'uploads')
    mkdirSync(configDir)
    mkdirSync(stage)
    const result = await applyRepoSettingsConfine({
      mode: 'off',
      childCwd: ws,
      addDirs: [ws],
      preparedPaths: [ws],
      configDir,
      stageFileRoot: stage,
      onStatus: () => {},
    })
    expect(result.warned).toBe(false)
    expect(result.repoDisablesAllHooks).toBe(false)
  })
})
