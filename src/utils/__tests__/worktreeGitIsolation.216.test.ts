/**
 * densable 2.1.216/217 — worktree git isolation (XB / Ros / ZRu)
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  checkZRuGitRedirectCommand,
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

  test('densable JRu: --namespace is skipped (not opaque), pins empty', () => {
    // densable j6g.has(s) → i+=2 continue; does NOT return opaque from JRu
    const r = extractGitRedirectsFromArgv(['--namespace', 'foo', 'status'])
    expect(r.kind).toBe('pins')
    if (r.kind === 'pins') {
      expect(r.chdirs).toEqual([])
      expect(r.pins).toEqual([])
      expect(r.bare).toBe(false)
    }
  })

  test('opaque for -c core.worktree', () => {
    const r = extractGitRedirectsFromArgv(['-c', 'core.worktree=/x', 'status'])
    expect(r).toEqual({ kind: 'opaque', flag: '-c core.worktree' })
  })
})

describe('resolveStaticPath densable oKr', () => {
  test('rejects densable oKr opaque forms', () => {
    // densable am() — AST placeholders for expansions
    expect(resolveStaticPath('__TRACKED_VAR__/x', '/base')).toBeNull()
    expect(resolveStaticPath('__CMDSUB_OUTPUT__/x', '/base')).toBeNull()
    // densable KRu — tilde
    expect(resolveStaticPath('~/repo', '/base')).toBeNull()
    // densable Zw — dot segments
    expect(resolveStaticPath('../x', '/base')).toBeNull()
    const abs = resolveStaticPath('/abs/path', '/base')
    expect(abs).not.toBeNull()
    expect(abs!.replace(/\\/g, '/')).toMatch(/\/abs\/path$/)
    const rel = resolveStaticPath('rel', '/base')
    expect(rel).not.toBeNull()
    expect(rel!.replace(/\\/g, '/')).toMatch(/\/base\/rel$/)
  })
})

describe('checkZRuGitRedirectCommand densable ZRu (AST)', () => {
  function makeWorktreeFixture(): {
    shared: string
    worktree: string
    sharedPosix: string
    worktreePosix: string
    cleanup: () => void
  } {
    // densable nKr/qRu need a real git worktree (findGitRoot + canonical root).
    // realpathSync.native expands Windows 8.3 ADMINI~1 (KRu rejects bare '~').
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'zru-')))
    const shared = join(root, 'repo')
    mkdirSync(shared, { recursive: true })
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'zru',
      GIT_AUTHOR_EMAIL: 'zru@test',
      GIT_COMMITTER_NAME: 'zru',
      GIT_COMMITTER_EMAIL: 'zru@test',
    }
    execFileSync('git', ['init'], { cwd: shared, stdio: 'ignore', env: gitEnv })
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
      cwd: shared,
      stdio: 'ignore',
      env: gitEnv,
    })
    const worktree = join(shared, '.claude', 'worktrees', 'agent-a1')
    mkdirSync(join(shared, '.claude', 'worktrees'), { recursive: true })
    execFileSync('git', ['worktree', 'add', '-b', 'agent-a1', worktree], {
      cwd: shared,
      stdio: 'ignore',
      env: gitEnv,
    })
    // bash argv must use / — backslash is escape in bash words
    const sharedPosix = shared.replace(/\\/g, '/')
    const worktreePosix = worktree.replace(/\\/g, '/')
    return {
      shared,
      worktree,
      sharedPosix,
      worktreePosix,
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    }
  }

  test('allows plain git status', async () => {
    const { worktree, cleanup } = makeWorktreeFixture()
    try {
      expect(
        await checkZRuGitRedirectCommand('git status', worktree, worktree),
      ).toBeNull()
    } finally {
      cleanup()
    }
  })

  test('blocks git -C shared checkout', async () => {
    const { sharedPosix, worktree, cleanup } = makeWorktreeFixture()
    try {
      const msg = await checkZRuGitRedirectCommand(
        `git -C ${sharedPosix} status`,
        worktree,
        worktree,
      )
      expect(msg).not.toBeNull()
      expect(msg!).toContain('redirects git to the shared checkout via -C')
      expect(msg!).toContain(worktree)
    } finally {
      cleanup()
    }
  })

  test('blocks GIT_DIR assignment to shared', async () => {
    const { sharedPosix, worktree, cleanup } = makeWorktreeFixture()
    try {
      const msg = await checkZRuGitRedirectCommand(
        `GIT_DIR=${sharedPosix}/.git git status`,
        worktree,
        worktree,
      )
      expect(msg).not.toBeNull()
      expect(msg!).toMatch(/sets GIT_DIR to the shared checkout/i)
    } finally {
      cleanup()
    }
  })

  test('blocks too-complex command_substitution', async () => {
    const { worktree, cleanup } = makeWorktreeFixture()
    try {
      // densable U5e → too-complex; ZRu refuses (if/then is simple multi-cmd)
      const msg = await checkZRuGitRedirectCommand(
        '$(git -C /repo status)',
        worktree,
        worktree,
      )
      expect(msg).not.toBeNull()
      expect(msg!).toContain('too complex to verify')
    } finally {
      cleanup()
    }
  })

  test('blocks quoted $HOME expansion via AST placeholder', async () => {
    const { worktree, cleanup } = makeWorktreeFixture()
    try {
      const msg = await checkZRuGitRedirectCommand(
        'git -C "$HOME/repo" status',
        worktree,
        worktree,
      )
      expect(msg).not.toBeNull()
      expect(msg!).toContain("can't be verified before it runs")
    } finally {
      cleanup()
    }
  })

  test('allows git -C into own worktree', async () => {
    const { worktree, worktreePosix, cleanup } = makeWorktreeFixture()
    try {
      expect(
        await checkZRuGitRedirectCommand(
          `git -C ${worktreePosix} status`,
          worktree,
          worktree,
        ),
      ).toBeNull()
    } finally {
      cleanup()
    }
  })

  test('blocks bare statement GIT_DIR then git (densable bareAssignmentNames)', async () => {
    // densable U5e thr `n`: statement-level VAR=val is bare; env-prefix is not.
    // ZRu final bare check: bare git-redirect env without matching export on
    // the git command → deny "assigns GIT_DIR…cannot verify".
    const { sharedPosix, worktree, cleanup } = makeWorktreeFixture()
    try {
      const msg = await checkZRuGitRedirectCommand(
        `GIT_DIR=${sharedPosix}/.git && git status`,
        worktree,
        worktree,
      )
      expect(msg).not.toBeNull()
      expect(msg!).toMatch(/assigns GIT_DIR/i)
    } finally {
      cleanup()
    }
  })

  test('blocks export GIT_DIR then git via bareAssignmentNames', async () => {
    const { sharedPosix, worktree, cleanup } = makeWorktreeFixture()
    try {
      const msg = await checkZRuGitRedirectCommand(
        `export GIT_DIR=${sharedPosix}/.git && git status`,
        worktree,
        worktree,
      )
      expect(msg).not.toBeNull()
      expect(msg!).toMatch(/assigns GIT_DIR|sets GIT_DIR/i)
    } finally {
      cleanup()
    }
  })

  test('env-prefix GIT_DIR on git still blocked (not via bare list)', async () => {
    const { sharedPosix, worktree, cleanup } = makeWorktreeFixture()
    try {
      const msg = await checkZRuGitRedirectCommand(
        `GIT_DIR=${sharedPosix}/.git git status`,
        worktree,
        worktree,
      )
      expect(msg).not.toBeNull()
      expect(msg!).toMatch(/sets GIT_DIR to the shared checkout/i)
    } finally {
      cleanup()
    }
  })

  test('blocks densable YPg read GIT_DIR then git via bareAssignmentNames', async () => {
    // densable YPg: `read NAME` contributes NAME to bare list; ZRu final
    // bare check denies unverified git-redirect env assigns.
    const { worktree, cleanup } = makeWorktreeFixture()
    try {
      const msg = await checkZRuGitRedirectCommand(
        'read GIT_DIR && git status',
        worktree,
        worktree,
      )
      expect(msg).not.toBeNull()
      expect(msg!).toMatch(/assigns GIT_DIR/i)
    } finally {
      cleanup()
    }
  })

  test('blocks densable YPg printf -v GIT_DIR then git via bareAssignmentNames', async () => {
    const { worktree, cleanup } = makeWorktreeFixture()
    try {
      const msg = await checkZRuGitRedirectCommand(
        'printf -v GIT_DIR /x && git status',
        worktree,
        worktree,
      )
      expect(msg).not.toBeNull()
      expect(msg!).toMatch(/assigns GIT_DIR/i)
    } finally {
      cleanup()
    }
  })

  test('blocks --git-dir shared checkout (AST JRu pins)', async () => {
    const { sharedPosix, worktree, cleanup } = makeWorktreeFixture()
    try {
      const msg = await checkZRuGitRedirectCommand(
        `git --git-dir=${sharedPosix}/.git status`,
        worktree,
        worktree,
      )
      expect(msg).not.toBeNull()
      expect(msg!).toContain(
        'redirects git to the shared checkout via --git-dir',
      )
    } finally {
      cleanup()
    }
  })

  test('blocks --work-tree shared checkout (AST JRu pins)', async () => {
    const { sharedPosix, worktree, cleanup } = makeWorktreeFixture()
    try {
      const msg = await checkZRuGitRedirectCommand(
        `git --work-tree ${sharedPosix} status`,
        worktree,
        worktree,
      )
      expect(msg).not.toBeNull()
      expect(msg!).toContain(
        'redirects git to the shared checkout via --work-tree',
      )
    } finally {
      cleanup()
    }
  })

  test('blocks GIT_WORK_TREE env-prefix to shared (AST XRu, not bare)', async () => {
    const { sharedPosix, worktree, cleanup } = makeWorktreeFixture()
    try {
      const msg = await checkZRuGitRedirectCommand(
        `GIT_WORK_TREE=${sharedPosix} git status`,
        worktree,
        worktree,
      )
      expect(msg).not.toBeNull()
      expect(msg!).toMatch(/sets GIT_WORK_TREE to the shared checkout/i)
    } finally {
      cleanup()
    }
  })

  test('blocks unverifiable runtime -C tilde (densable KRu)', async () => {
    const { worktree, cleanup } = makeWorktreeFixture()
    try {
      const msg = await checkZRuGitRedirectCommand(
        'git -C ~/repo status',
        worktree,
        worktree,
      )
      expect(msg).not.toBeNull()
      expect(msg!).toContain("can't be verified before it runs")
    } finally {
      cleanup()
    }
  })
})
