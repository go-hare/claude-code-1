import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  cleanupWorktreeReftableAdminDir,
  getOrCreateWorktree,
} from '../worktree.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('worktree reftable & bare repo fallback (#677, #787)', () => {
  test('#677: cleanupWorktreeReftableAdminDir removes leftover reftable files and empty entry folder', async () => {
    const commonGitDir = makeTempDir('wt-common-')
    mkdirSync(join(commonGitDir, 'reftable'), { recursive: true })
    const entryDir = join(commonGitDir, 'worktrees', 'wt-1')
    mkdirSync(join(entryDir, 'reftable'), { recursive: true })
    mkdirSync(join(entryDir, 'refs'), { recursive: true })

    writeFileSync(
      join(entryDir, 'reftable', 'tables.list'),
      '0x000000000001-0x000000000002-abcd1234.ref\n',
    )
    writeFileSync(
      join(entryDir, 'reftable', '0x000000000001-0x000000000002-abcd1234.ref'),
      'dummy',
    )
    writeFileSync(join(entryDir, 'refs', 'heads'), '')

    const cleaned = await cleanupWorktreeReftableAdminDir(
      entryDir,
      commonGitDir,
    )
    expect(cleaned).toBe(true)
    expect(existsSync(entryDir)).toBe(false)
  })

  test('#787: getOrCreateWorktree falls back to fromCwd HEAD in a worktree of a bare repo when origin fetch fails', async () => {
    const seed = makeTempDir('bare-seed-')
    execFileSync('git', ['init', '-b', 'main'], { cwd: seed, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: seed,
      stdio: 'ignore',
    })
    execFileSync('git', ['config', 'user.name', 'Test'], {
      cwd: seed,
      stdio: 'ignore',
    })
    writeFileSync(join(seed, 'README.md'), 'hello\n')
    execFileSync('git', ['add', 'README.md'], { cwd: seed, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'c1'], { cwd: seed, stdio: 'ignore' })

    const bare = makeTempDir('bare-repo-')
    execFileSync('git', ['clone', '--bare', seed, bare], { stdio: 'ignore' })
    // Point origin to a nonexistent path so `git fetch origin ...` fails, and
    // delete origin tracking refs so resolveRef(origin/main) misses too.
    execFileSync(
      'git',
      ['remote', 'set-url', 'origin', join(bare, 'missing-remote')],
      {
        cwd: bare,
        stdio: 'ignore',
      },
    )
    // Point bare HEAD to an unborn branch so `git rev-parse HEAD` in `bare` would fail!
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/unborn-branch'], {
      cwd: bare,
      stdio: 'ignore',
    })

    const checkout = makeTempDir('bare-wt-checkout-')
    execFileSync('git', ['worktree', 'add', checkout, 'main'], {
      cwd: bare,
      stdio: 'ignore',
    })
    const expectedHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: checkout,
      encoding: 'utf-8',
    }).trim()

    const result = await getOrCreateWorktree(bare, 'feat-bare-fallback', {
      fromCwd: checkout,
    })
    expect(result.headCommit).toBe(expectedHead)
    expect(existsSync(result.worktreePath)).toBe(true)
  })
})
