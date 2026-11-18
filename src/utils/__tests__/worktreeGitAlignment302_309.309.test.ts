import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  formatNoLazyFetchObjectMissingHint,
  formatWorktreeCommitDescription,
  getWorktreeNoLazyFetchEnv,
  healOrphanedWorktreeDir,
} from '../worktree.js'
import { skipWrapperPrefixes } from '../worktreeGitIsolation.js'
import { gitFastConfigArgs, gitSubprocessEnv } from '../git.js'

describe('2.1.302-309 Worktree & Git alignment (#916, #987, #1125, #1127, #1161, #1173)', () => {
  test('#916 healOrphanedWorktreeDir removes orphaned worktree pointing to missing admin dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-916-'))
    try {
      const repoRoot = join(dir, 'repo')
      const wtDir = join(repoRoot, '.claude', 'worktrees', 'orphaned')
      mkdirSync(join(repoRoot, '.git'), { recursive: true })
      mkdirSync(wtDir, { recursive: true })
      writeFileSync(
        join(wtDir, '.git'),
        `gitdir: ${join(repoRoot, '.git', 'worktrees', 'orphaned')}\n`,
        'utf8',
      )
      // Run git init in repoRoot so `git remote` and `git rev-parse` work cleanly
      const { spawnSync } = await import('child_process')
      spawnSync('git', ['init'], { cwd: repoRoot })

      const healed = await healOrphanedWorktreeDir(
        repoRoot,
        wtDir,
        'worktree-orphaned',
      )
      expect(healed).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#987 formatWorktreeCommitDescription distinguishes detached and another_branch', () => {
    expect(
      formatWorktreeCommitDescription(
        { head: 'detached', commits: 2 },
        'wt-branch',
        'HEAD',
      ),
    ).toBe('on wt-branch or at the detached HEAD')
    expect(
      formatWorktreeCommitDescription(
        { head: 'another_branch', branch: 'other', commits: 1 },
        'wt-branch',
        'HEAD',
      ),
    ).toBe("on wt-branch that HEAD doesn't have")
  })

  test('#1125 skipWrapperPrefixes skips locale-prefixed env assignments and wrappers before cd', () => {
    expect(
      skipWrapperPrefixes(['LC_ALL=C', 'cd', '/shared/repo'], c => c === 'cd'),
    ).toBe(1)
    expect(
      skipWrapperPrefixes(
        ['LANG=en_US.UTF-8', 'time', '-p', 'LC_ALL=C', 'pushd', '/shared'],
        c => c === 'cd' || c === 'pushd',
      ),
    ).toBe(4)
    expect(
      skipWrapperPrefixes(['LC_ALL=C', 'ls', '-la'], c => c === 'cd'),
    ).toBe(-1)
  })

  test('#1127 & #1161 gitSubprocessEnv sets LC_ALL=C, LANGUAGE=C, GIT_NO_REPLACE_OBJECTS=1; gitFastConfigArgs sets Windows flags', () => {
    const env = gitSubprocessEnv()
    expect(env.LC_ALL).toBe('C')
    expect(env.LANGUAGE).toBe('C')
    expect(env.GIT_NO_REPLACE_OBJECTS).toBe('1')

    expect(gitFastConfigArgs('darwin')).toEqual([])
    const winArgs = gitFastConfigArgs('win32')
    expect(winArgs).toContain('core.commitGraph=false')
    expect(winArgs).toContain('core.multiPackIndex=false')
    expect(winArgs).toContain('core.useReplaceRefs=false')
  })

  test('#1173 getWorktreeNoLazyFetchEnv & formatNoLazyFetchObjectMissingHint', () => {
    expect(getWorktreeNoLazyFetchEnv(true)).toEqual({
      GIT_NO_LAZY_FETCH: '1',
      GIT_ALLOW_PROTOCOL: '/',
    })
    expect(getWorktreeNoLazyFetchEnv(false)).toEqual({})

    const hint = formatNoLazyFetchObjectMissingHint(
      'fatal: lazy fetching disabled',
      'abcdef1234567890',
    )
    expect(hint).toContain('on-demand fetching switched off')
    expect(hint).toContain('abcdef123456')
    expect(formatNoLazyFetchObjectMissingHint('fatal: other error')).toBe('')
  })
})
