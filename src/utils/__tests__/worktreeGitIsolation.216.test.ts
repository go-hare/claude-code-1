/**
 * densable 2.1.216 — worktree git isolation (XB / Ros / shared-checkout guard)
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  checkWorktreeSharedCheckoutGitRedirect,
  extractGitRedirectsFromArgv,
  isGitBinaryName,
  isWorktreeGitRedirectEnvName,
  registerWorktreeSessionProvider,
  resolveStaticPath,
  scrubGitEnvForWorktree,
} from '../worktreeGitIsolation.js'

afterEach(() => {
  registerWorktreeSessionProvider(() => null)
})

describe('scrubGitEnvForWorktree (densable XB)', () => {
  test('clears GIT_DIR / GIT_WORK_TREE / GIT_COMMON_DIR / GIT_INDEX_FILE', () => {
    const prev = {
      GIT_DIR: process.env.GIT_DIR,
      GIT_WORK_TREE: process.env.GIT_WORK_TREE,
      GIT_COMMON_DIR: process.env.GIT_COMMON_DIR,
      GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
    }
    try {
      process.env.GIT_DIR = '/shared/.git'
      process.env.GIT_WORK_TREE = '/shared'
      process.env.GIT_COMMON_DIR = '/shared/.git'
      process.env.GIT_INDEX_FILE = '/shared/.git/index'
      const env = scrubGitEnvForWorktree({ LC_ALL: 'C' })
      expect(env.GIT_DIR).toBeUndefined()
      expect(env.GIT_WORK_TREE).toBeUndefined()
      expect(env.GIT_COMMON_DIR).toBeUndefined()
      expect(env.GIT_INDEX_FILE).toBeUndefined()
      expect(env.LC_ALL).toBe('C')
      // other env preserved
      expect(env.PATH).toBe(process.env.PATH)
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })

  test('caller overrides apply last', () => {
    const env = scrubGitEnvForWorktree({
      GIT_DIR: '/intentional',
      FOO: 'bar',
    })
    expect(env.GIT_DIR).toBe('/intentional')
    expect(env.FOO).toBe('bar')
  })
})

describe('isGitBinaryName / isWorktreeGitRedirectEnvName', () => {
  test('git binary variants', () => {
    expect(isGitBinaryName('git')).toBe(true)
    expect(isGitBinaryName('git.exe')).toBe(true)
    expect(isGitBinaryName('git.real')).toBe(true)
    expect(isGitBinaryName('git-lfs')).toBe(true)
    expect(isGitBinaryName('/usr/bin/git')).toBe(true)
    expect(isGitBinaryName('gh')).toBe(false)
  })

  test('Ros + J9g env names', () => {
    expect(isWorktreeGitRedirectEnvName('GIT_DIR')).toBe(true)
    expect(isWorktreeGitRedirectEnvName('git_work_tree')).toBe(true)
    expect(isWorktreeGitRedirectEnvName('GIT_CONFIG_GLOBAL')).toBe(true)
    expect(isWorktreeGitRedirectEnvName('HOME')).toBe(true)
    expect(isWorktreeGitRedirectEnvName('CDPATH')).toBe(true)
    expect(isWorktreeGitRedirectEnvName('XDG_CONFIG_HOME')).toBe(true)
    expect(isWorktreeGitRedirectEnvName('PATH')).toBe(false)
  })
})

describe('extractGitRedirectsFromArgv', () => {
  test('parses -C and pin flags', () => {
    const r = extractGitRedirectsFromArgv([
      '-C',
      '/shared',
      '--git-dir',
      '/shared/.git',
      'status',
    ])
    expect(r.kind).toBe('pins')
    if (r.kind === 'pins') {
      expect(r.chdirs).toEqual(['/shared'])
      // --git-dir stops after first pin in current impl when returning early
      expect(r.pins.some(p => p.flag === '--git-dir')).toBe(true)
    }
  })

  test('opaque flags', () => {
    const r = extractGitRedirectsFromArgv(['--namespace', 'foo', 'status'])
    expect(r).toEqual({ kind: 'opaque', flag: '--namespace' })
  })
})

describe('checkWorktreeSharedCheckoutGitRedirect', () => {
  const isolation = {
    worktreePath: '/repo/.claude/worktrees/agent-a1',
    sharedCheckout: '/repo',
  }

  test('allows normal git status in worktree', () => {
    expect(
      checkWorktreeSharedCheckoutGitRedirect('git status', isolation),
    ).toBeNull()
  })

  test('denies git -C shared checkout', () => {
    const reason = checkWorktreeSharedCheckoutGitRedirect(
      'git -C /repo status',
      isolation,
    )
    expect(reason).toContain('redirects git to the shared checkout via -C')
  })

  test('denies --git-dir shared', () => {
    const reason = checkWorktreeSharedCheckoutGitRedirect(
      'git --git-dir=/repo/.git status',
      isolation,
    )
    expect(reason).toContain(
      'redirects git to the shared checkout via --git-dir',
    )
  })

  test('denies --work-tree shared', () => {
    const reason = checkWorktreeSharedCheckoutGitRedirect(
      'git --work-tree /repo status',
      isolation,
    )
    expect(reason).toContain(
      'redirects git to the shared checkout via --work-tree',
    )
  })

  test('denies GIT_DIR assignment to shared', () => {
    const reason = checkWorktreeSharedCheckoutGitRedirect(
      'GIT_DIR=/repo/.git git status',
      isolation,
    )
    expect(reason).toContain('sets GIT_DIR to the shared checkout')
  })

  test('denies GIT_WORK_TREE assignment to shared', () => {
    const reason = checkWorktreeSharedCheckoutGitRedirect(
      'GIT_WORK_TREE=/repo git status',
      isolation,
    )
    expect(reason).toContain('sets GIT_WORK_TREE to the shared checkout')
  })

  test('denies unverifiable runtime -C', () => {
    const reason = checkWorktreeSharedCheckoutGitRedirect(
      'git -C "$HOME/repo" status',
      isolation,
    )
    expect(reason).toContain("can't be verified before it runs")
  })

  test('allows git -C to worktree itself', () => {
    expect(
      checkWorktreeSharedCheckoutGitRedirect(
        'git -C /repo/.claude/worktrees/agent-a1 status',
        isolation,
      ),
    ).toBeNull()
  })

  test('resolveStaticPath rejects globs and expansions', () => {
    expect(resolveStaticPath('$HOME/x', '/base')).toBeNull()
    expect(resolveStaticPath('/abs/path', '/base')).toBe('/abs/path')
    expect(resolveStaticPath('rel', '/base')).toBe('/base/rel')
  })
})
