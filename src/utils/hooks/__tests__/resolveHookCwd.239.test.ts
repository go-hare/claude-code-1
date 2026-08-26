/**
 * densable 2.1.239 #37 — official ies(e, t):
 * exists(e) → e; else first existing of
 * [t.originalCwd, t.projectRoot, homedir()] (≠ e); else tmpdir().
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir as osTmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resetHookCwdFallbackWarningsForTests,
  resolveHookCwd,
} from '../resolveHookCwd.js'

const scratch: string[] = []

async function makeDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(osTmpdir(), `hook-cwd-${label}-`))
  scratch.push(dir)
  return dir
}

afterEach(async () => {
  resetHookCwdFallbackWarningsForTests()
  await Promise.all(
    scratch.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

describe('densable 2.1.239 #37 ies hook cwd fallback', () => {
  test('keeps current cwd when it exists', async () => {
    const cwd = await makeDir('cwd')
    const original = await makeDir('orig')
    expect(
      await resolveHookCwd(cwd, {
        originalCwd: original,
        projectRoot: original,
      }),
    ).toBe(cwd)
  })

  test('falls back to originalCwd before projectRoot', async () => {
    const cwd = join(osTmpdir(), `hook-cwd-missing-${Date.now()}-a`)
    const original = await makeDir('orig')
    const project = await makeDir('proj')
    expect(
      await resolveHookCwd(cwd, {
        originalCwd: original,
        projectRoot: project,
      }),
    ).toBe(original)
  })

  test('falls back to projectRoot when originalCwd is gone', async () => {
    const cwd = join(osTmpdir(), `hook-cwd-missing-${Date.now()}-b`)
    const original = join(osTmpdir(), `hook-cwd-missing-${Date.now()}-orig`)
    const project = await makeDir('proj')
    expect(
      await resolveHookCwd(cwd, {
        originalCwd: original,
        projectRoot: project,
      }),
    ).toBe(project)
  })

  test('skips a fallback that equals the missing cwd', async () => {
    const gone = join(osTmpdir(), `hook-cwd-missing-${Date.now()}-same`)
    const project = await makeDir('proj')
    expect(
      await resolveHookCwd(gone, {
        originalCwd: gone,
        projectRoot: project,
      }),
    ).toBe(project)
  })

  test('falls back to homedir when originalCwd and projectRoot are gone', async () => {
    const { homedir } = await import('node:os')
    const cwd = join(osTmpdir(), `hook-cwd-missing-${Date.now()}-c`)
    const home = homedir()
    expect(
      await resolveHookCwd(cwd, {
        originalCwd: join(osTmpdir(), `hook-cwd-missing-${Date.now()}-o`),
        projectRoot: join(osTmpdir(), `hook-cwd-missing-${Date.now()}-p`),
      }),
    ).toBe(home)
  })

  test('execCommandHook spawn site calls ies', async () => {
    const src = await Bun.file(join(import.meta.dir, '../../hooks.ts')).text()
    expect(src).toContain('await resolveHookCwd(hookCwd, {')
    expect(src).toContain('originalCwd: getOriginalCwd()')
    expect(src).toContain('projectRoot: getProjectRoot()')
    expect(src).not.toContain('falling back to original cwd')
  })
})
