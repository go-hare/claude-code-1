import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wipeHomeGitConfigForProxy } from '../gitConfigure.js'

const tempDirs: string[] = []
async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('Round 3 Fix 4: BH3-P1-11 & BH3-P1-12 Runner Fixes', () => {
  test('BH3-P1-11: wipeHomeGitConfigForProxy returns wiped (not kept) when GIT_CONFIG_GLOBAL equals xdgGitDirs or runnerDir', async () => {
    const root = await makeTempDir('bh3-p1-11-')
    const homeDir = join(root, 'home')
    const xdgGit = join(homeDir, '.config', 'git')
    const runnerDir = join(root, 'ws', '.runner')

    await mkdir(xdgGit, { recursive: true })
    await writeFile(join(xdgGit, 'config'), '[user]\nname=stale\n')
    await mkdir(runnerDir, { recursive: true })
    await writeFile(join(homeDir, '.gitconfig'), '[user]\nname=a\n')

    // Case 1: GIT_CONFIG_GLOBAL === xdgGitDirs[0] -> deleted by reset -> must report 'wiped'
    const outcomeXdg = await wipeHomeGitConfigForProxy({
      globalCfgPath: xdgGit,
      homeGitconfigPath: join(homeDir, '.gitconfig'),
      xdgGitDirs: [xdgGit],
      runnerDir,
    })
    expect(outcomeXdg).toBe('wiped')
    await expect(lstat(xdgGit)).rejects.toThrow()

    // Case 2: GIT_CONFIG_GLOBAL lies inside xdgGitDirs -> deleted by reset -> must report 'wiped'
    const nestedDir = join(xdgGit, 'nested')
    await mkdir(nestedDir, { recursive: true })
    await writeFile(join(nestedDir, 'file'), 'data')
    const outcomeNested = await wipeHomeGitConfigForProxy({
      globalCfgPath: nestedDir,
      homeGitconfigPath: join(homeDir, '.gitconfig'),
      xdgGitDirs: [xdgGit],
      runnerDir,
    })
    expect(outcomeNested).toBe('wiped')

    // Case 3: GIT_CONFIG_GLOBAL === runnerDir -> deleted by reset -> must report 'wiped'
    await mkdir(runnerDir, { recursive: true })
    await writeFile(join(runnerDir, 'file'), 'data')
    const outcomeRunner = await wipeHomeGitConfigForProxy({
      globalCfgPath: runnerDir,
      homeGitconfigPath: join(homeDir, '.gitconfig'),
      xdgGitDirs: [xdgGit],
      runnerDir,
    })
    expect(outcomeRunner).toBe('wiped')

    // Case 4: Strict ancestor (~/.config holding xdgGit) -> NOT deleted -> must report 'kept'
    const xdgParent = join(homeDir, '.config')
    await mkdir(xdgGit, { recursive: true })
    const outcomeAncestor = await wipeHomeGitConfigForProxy({
      globalCfgPath: xdgParent,
      homeGitconfigPath: join(homeDir, '.gitconfig'),
      xdgGitDirs: [xdgGit],
      runnerDir,
    })
    expect(outcomeAncestor).toBe('kept')
    expect((await lstat(xdgParent)).isDirectory()).toBe(true)
  })

  test('BH3-P1-12: sessionHandler.ts does not mutate parent-process ownTaskListId singleton', () => {
    const src = readFileSync(
      join(import.meta.dir, '../sessionHandler.ts'),
      'utf8',
    )
    const nonCommentLines = src
      .split('\n')
      .filter(line => !line.trimStart().startsWith('//'))
      .join('\n')
    expect(nonCommentLines).not.toContain('setOwnTaskListId')
  })
})
