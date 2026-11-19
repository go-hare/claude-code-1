import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  assertGitRefTargetPlain,
  cleanupWorktreeReftableAdminDir,
  getOrCreateWorktree,
  resolveCommonGitDirForRefCheck,
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

  test('#1780 resolveCommonGitDirForRefCheck works in linked worktrees without --path-format=absolute', async () => {
    const repo = makeTempDir('wt-common-resolve-')
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repo,
      stdio: 'ignore',
    })
    execFileSync('git', ['config', 'user.name', 'Test'], {
      cwd: repo,
      stdio: 'ignore',
    })
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    execFileSync('git', ['add', 'a.txt'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'init'], {
      cwd: repo,
      stdio: 'ignore',
    })

    const linked = makeTempDir('wt-linked-')
    rmSync(linked, { recursive: true, force: true })
    execFileSync('git', ['worktree', 'add', '-b', 'feat', linked, 'HEAD'], {
      cwd: repo,
      stdio: 'ignore',
    })
    tempDirs.push(linked)

    const commonFromMain = await resolveCommonGitDirForRefCheck(repo)
    const commonFromLinked = await resolveCommonGitDirForRefCheck(linked)
    expect(commonFromMain).not.toBeNull()
    expect(commonFromLinked).not.toBeNull()
    expect(realpathSync(commonFromLinked!)).toBe(
      realpathSync(join(repo, '.git')),
    )
    expect(realpathSync(commonFromMain!)).toBe(realpathSync(join(repo, '.git')))
  })

  test('#1780 assertGitRefTargetPlain accepts reftable .git/refs/heads placeholder and refuses symlinked reftable', async () => {
    const gitDir = makeTempDir('wt-reftable-refcheck-')
    mkdirSync(join(gitDir, 'reftable'), { recursive: true })
    mkdirSync(join(gitDir, 'refs'), { recursive: true })
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/.invalid\n')
    writeFileSync(
      join(gitDir, 'refs', 'heads'),
      'this repository uses the reftable format\n',
    )
    writeFileSync(join(gitDir, 'reftable', 'tables.list'), '')

    // In a reftable repo `.git/refs/heads` is a regular placeholder file — must be ok
    const okRes = await assertGitRefTargetPlain(gitDir, 'worktree-foo')
    expect(okRes).toEqual({ ok: true })

    // Replacing reftable/tables.list with a symlink must be refused
    const outside = makeTempDir('wt-outside-')
    const target = join(outside, 'tables.list')
    writeFileSync(target, '')
    rmSync(join(gitDir, 'reftable', 'tables.list'))
    symlinkSync(target, join(gitDir, 'reftable', 'tables.list'))
    const badRes = await assertGitRefTargetPlain(gitDir, 'worktree-foo')
    expect(badRes.ok).toBe(false)
    if (!badRes.ok) {
      expect(badRes.reason).toBe('ref_target_not_plain')
    }
  })
})
