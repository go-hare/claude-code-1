import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetStateForTests } from '../../bootstrap/state.js'
import {
  clearGitStatusPrefetchForTesting,
  getGitStatus,
  getPendingGitStatusPrefetchForTesting,
  getSystemContext,
  getSystemPromptInjection,
  getUserContext,
  prefetchGitStatusForCompaction,
  setGhStandinTag,
  setSystemPromptInjection,
} from '../../context.js'
import { clearMemoryFileCaches, getMemoryFiles } from '../claudemd.js'
import { getCwd, setCwd } from '../cwd.js'
import { findGitRoot, getIsGit } from '../git.js'
import {
  getSessionAlsStore,
  runWithNewHostSession,
  runWithSession,
} from '../sessionContextAls.js'
import { registerSessionContextReader } from '../sessionRoot.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import {
  getCoreUserData,
  getGitEmail,
  initUser,
  resetUserCache,
} from '../user.js'

const tick = (ms = 5): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync('git', args, {
    cwd,
    env,
    stdio: 'pipe',
  })
}

describe('2.1.331 multi-host ALS isolation for context, claudemd, git, and user', () => {
  let rootTempDir = ''
  let repoA = ''
  let repoB = ''
  let dirC = ''
  let isolatedClaudeHome = ''
  let emptyGitConfigPath = ''

  const savedEnv: Record<string, string | undefined> = {}
  const envKeys = [
    'NODE_ENV',
    'CLAUDE_CONFIG_DIR',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_SYSTEM',
    'GIT_CONFIG_NOSYSTEM',
    'CLAUDE_CODE_DISABLE_CLAUDE_MDS',
    'CLAUDE_CODE_REMOTE',
    'CLAUDE_CODE_EXCLUDE_DYNAMIC_CONTEXT',
    'CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS',
    'CLAUDE_CODE_BARE',
    'USER_TYPE',
    'COO_CREATOR',
  ] as const

  beforeAll(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
    }

    rootTempDir = realpathSync(mkdtempSync(join(tmpdir(), 'als-ctx-git-331-')))
    repoA = join(rootTempDir, 'repo-A')
    repoB = join(rootTempDir, 'repo-B')
    dirC = join(rootTempDir, 'dir-C')
    isolatedClaudeHome = join(rootTempDir, 'claude-home')
    emptyGitConfigPath = join(rootTempDir, 'empty-gitconfig')

    mkdirSync(repoA, { recursive: true })
    mkdirSync(repoB, { recursive: true })
    mkdirSync(dirC, { recursive: true })
    mkdirSync(isolatedClaudeHome, { recursive: true })
    writeFileSync(emptyGitConfigPath, '')

    const gitEnv: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_CONFIG_GLOBAL: emptyGitConfigPath,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    }

    // Initialize repo-A on branch-alpha with ALPHA_SECRET_RULE and alpha@example.com
    runGit(repoA, ['init'], gitEnv)
    runGit(repoA, ['checkout', '-b', 'branch-alpha'], gitEnv)
    runGit(
      repoA,
      ['config', '--local', 'user.email', 'alpha@example.com'],
      gitEnv,
    )
    runGit(repoA, ['config', '--local', 'user.name', 'Alpha Bot'], gitEnv)
    writeFileSync(
      join(repoA, 'CLAUDE.md'),
      '# Repo A Instructions\nALPHA_SECRET_RULE\n',
    )
    writeFileSync(join(repoA, 'README.md'), 'alpha repo\n')
    runGit(repoA, ['add', 'CLAUDE.md', 'README.md'], gitEnv)
    runGit(
      repoA,
      ['-c', 'commit.gpgsign=false', 'commit', '-m', 'alpha initial commit'],
      gitEnv,
    )
    writeFileSync(join(repoA, 'alpha-untracked.txt'), 'untracked in alpha\n')

    // Initialize repo-B on branch-beta with BETA_SECRET_RULE and beta@example.com
    runGit(repoB, ['init'], gitEnv)
    runGit(repoB, ['checkout', '-b', 'branch-beta'], gitEnv)
    runGit(
      repoB,
      ['config', '--local', 'user.email', 'beta@example.com'],
      gitEnv,
    )
    runGit(repoB, ['config', '--local', 'user.name', 'Beta Bot'], gitEnv)
    writeFileSync(
      join(repoB, 'CLAUDE.md'),
      '# Repo B Instructions\nBETA_SECRET_RULE\n',
    )
    writeFileSync(join(repoB, 'README.md'), 'beta repo\n')
    runGit(repoB, ['add', 'CLAUDE.md', 'README.md'], gitEnv)
    runGit(
      repoB,
      ['-c', 'commit.gpgsign=false', 'commit', '-m', 'beta initial commit'],
      gitEnv,
    )
    writeFileSync(join(repoB, 'beta-untracked.txt'), 'untracked in beta\n')

    // Non-git directory dir-C with its own CLAUDE.md
    writeFileSync(
      join(dirC, 'CLAUDE.md'),
      '# Plain Dir C Instructions\nCHARLIE_PLAIN_DIR_RULE\n',
    )
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
    registerSessionContextReader(getSessionAlsStore)
    clearMemoryFileCaches()
    getUserContext.cache.clear()
    getSystemContext.cache.clear()
    getGitStatus.cache.clear()
    getIsGit.cache.clear()
    resetUserCache()
    clearGitStatusPrefetchForTesting()
    setSystemPromptInjection(null)
    setGhStandinTag(undefined)
    resetSettingsCache()
    resetStateForTests()
  })

  afterAll(() => {
    if (rootTempDir) {
      rmSync(rootTempDir, { recursive: true, force: true })
    }
  })

  test('concurrent runWithNewHostSession across repo-A, repo-B, and non-git dir-C has zero cross-contamination', async () => {
    process.env.CLAUDE_CONFIG_DIR = isolatedClaudeHome
    process.env.GIT_CONFIG_GLOBAL = emptyGitConfigPath
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    delete process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS
    delete process.env.CLAUDE_CODE_REMOTE
    delete process.env.CLAUDE_CODE_EXCLUDE_DYNAMIC_CONTEXT
    delete process.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS
    delete process.env.CLAUDE_CODE_BARE

    // Sanity-check that dir-C is genuinely outside any git repository
    expect(findGitRoot(dirC)).toBeNull()
    expect(findGitRoot(repoA)).toBe(repoA)
    expect(findGitRoot(repoB)).toBe(repoB)

    let markPlainProbed!: () => void
    const plainProbedFirst = new Promise<void>(resolve => {
      markPlainProbed = resolve
    })

    const [resC, resA, resB] = await Promise.all([
      // Start non-git dir-C FIRST so any unkeyed memoize(getIsGit / getGitEmail / getMemoryFiles)
      // would poison repo-A and repo-B if not scoped per RootSessionSlot!
      runWithNewHostSession(
        {
          id: 'host-session-c',
          cwd: dirC,
          originalCwd: dirC,
          projectRoot: dirC,
        },
        async () => {
          const isGit = await getIsGit()
          const gitEmail = await getGitEmail()
          markPlainProbed()
          await tick(8)
          const [gitStatus, sysCtx, memFiles, userCtx] = await Promise.all([
            getGitStatus(),
            getSystemContext(),
            getMemoryFiles(),
            getUserContext(),
          ])
          return { isGit, gitEmail, gitStatus, sysCtx, memFiles, userCtx }
        },
      ),

      runWithNewHostSession(
        {
          id: 'host-session-a',
          cwd: repoA,
          originalCwd: repoA,
          projectRoot: repoA,
        },
        async () => {
          await plainProbedFirst
          const [isGit, gitEmail] = await Promise.all([
            getIsGit(),
            getGitEmail(),
          ])
          await tick(5)
          const [gitStatus, sysCtx, memFiles, userCtx] = await Promise.all([
            getGitStatus(),
            getSystemContext(),
            getMemoryFiles(),
            getUserContext(),
          ])
          return { isGit, gitEmail, gitStatus, sysCtx, memFiles, userCtx }
        },
      ),

      runWithNewHostSession(
        {
          id: 'host-session-b',
          cwd: repoB,
          originalCwd: repoB,
          projectRoot: repoB,
        },
        async () => {
          await plainProbedFirst
          await tick(3)
          const [isGit, gitEmail, gitStatus, sysCtx, memFiles, userCtx] =
            await Promise.all([
              getIsGit(),
              getGitEmail(),
              getGitStatus(),
              getSystemContext(),
              getMemoryFiles(),
              getUserContext(),
            ])
          return { isGit, gitEmail, gitStatus, sysCtx, memFiles, userCtx }
        },
      ),
    ])

    // Verify Host C (non-git dir-C)
    expect(resC.isGit).toBe(false)
    expect(resC.gitEmail).toBeUndefined()
    expect(resC.gitStatus).toBeNull()
    expect(resC.sysCtx.gitStatus).toBeUndefined()
    const memContentC = resC.memFiles.map(f => f.content).join('\n')
    expect(memContentC).toContain('CHARLIE_PLAIN_DIR_RULE')
    expect(memContentC).not.toContain('ALPHA_SECRET_RULE')
    expect(memContentC).not.toContain('BETA_SECRET_RULE')
    expect(resC.userCtx.claudeMd).toContain('CHARLIE_PLAIN_DIR_RULE')
    expect(resC.userCtx.claudeMd).not.toContain('ALPHA_SECRET_RULE')
    expect(resC.userCtx.claudeMd).not.toContain('BETA_SECRET_RULE')

    // Verify Host A (repo-A on branch-alpha)
    expect(resA.isGit).toBe(true)
    expect(resA.gitEmail).toBe('alpha@example.com')
    expect(resA.gitStatus).not.toBeNull()
    expect(resA.gitStatus).toContain('Current branch: branch-alpha')
    expect(resA.gitStatus).toContain('Git user: Alpha Bot')
    expect(resA.gitStatus).toContain('alpha-untracked.txt')
    expect(resA.gitStatus).toContain('alpha initial commit')
    expect(resA.gitStatus).not.toContain('branch-beta')
    expect(resA.gitStatus).not.toContain('Beta Bot')
    expect(resA.gitStatus).not.toContain('beta-untracked.txt')
    expect(resA.sysCtx.gitStatus).toContain('Current branch: branch-alpha')
    expect(resA.sysCtx.gitStatus).not.toContain('branch-beta')
    const memContentA = resA.memFiles.map(f => f.content).join('\n')
    expect(memContentA).toContain('ALPHA_SECRET_RULE')
    expect(memContentA).not.toContain('BETA_SECRET_RULE')
    expect(memContentA).not.toContain('CHARLIE_PLAIN_DIR_RULE')
    expect(resA.userCtx.claudeMd).toContain('ALPHA_SECRET_RULE')
    expect(resA.userCtx.claudeMd).not.toContain('BETA_SECRET_RULE')
    expect(resA.userCtx.claudeMd).not.toContain('CHARLIE_PLAIN_DIR_RULE')

    // Verify Host B (repo-B on branch-beta)
    expect(resB.isGit).toBe(true)
    expect(resB.gitEmail).toBe('beta@example.com')
    expect(resB.gitStatus).not.toBeNull()
    expect(resB.gitStatus).toContain('Current branch: branch-beta')
    expect(resB.gitStatus).toContain('Git user: Beta Bot')
    expect(resB.gitStatus).toContain('beta-untracked.txt')
    expect(resB.gitStatus).toContain('beta initial commit')
    expect(resB.gitStatus).not.toContain('branch-alpha')
    expect(resB.gitStatus).not.toContain('Alpha Bot')
    expect(resB.gitStatus).not.toContain('alpha-untracked.txt')
    expect(resB.sysCtx.gitStatus).toContain('Current branch: branch-beta')
    expect(resB.sysCtx.gitStatus).not.toContain('branch-alpha')
    const memContentB = resB.memFiles.map(f => f.content).join('\n')
    expect(memContentB).toContain('BETA_SECRET_RULE')
    expect(memContentB).not.toContain('ALPHA_SECRET_RULE')
    expect(memContentB).not.toContain('CHARLIE_PLAIN_DIR_RULE')
    expect(resB.userCtx.claudeMd).toContain('BETA_SECRET_RULE')
    expect(resB.userCtx.claudeMd).not.toContain('ALPHA_SECRET_RULE')
    expect(resB.userCtx.claudeMd).not.toContain('CHARLIE_PLAIN_DIR_RULE')
  })

  test('.cache MapCache operations (clear, has, get, set, delete) are strictly scoped per RootSessionSlot', async () => {
    process.env.CLAUDE_CONFIG_DIR = isolatedClaudeHome
    process.env.GIT_CONFIG_GLOBAL = emptyGitConfigPath
    process.env.GIT_CONFIG_NOSYSTEM = '1'

    let hostBWarmed!: () => void
    const hostBWarmedGate = new Promise<void>(resolve => {
      hostBWarmed = resolve
    })
    let hostACleared!: () => void
    const hostAClearedGate = new Promise<void>(resolve => {
      hostACleared = resolve
    })

    await Promise.all([
      runWithNewHostSession(
        {
          id: 'cache-host-a',
          cwd: repoA,
          originalCwd: repoA,
          projectRoot: repoA,
        },
        async () => {
          await getIsGit()
          await getGitStatus()
          await getSystemContext()
          await getUserContext()
          await getMemoryFiles()
          await getGitEmail()

          expect(getIsGit.cache.has(repoA)).toBe(true)
          expect(getGitStatus.cache.has(repoA)).toBe(true)
          expect(getSystemContext.cache.has(repoA)).toBe(true)
          expect(getGitEmail.cache.has(repoA)).toBe(true)
          expect(getMemoryFiles.cache.size).toBeGreaterThan(0)
          expect(getUserContext.cache.size).toBeGreaterThan(0)

          await hostBWarmedGate

          // Clear ALL caches inside Host A — must NOT touch Host B's caches!
          getIsGit.cache.clear()
          getGitStatus.cache.clear()
          getSystemContext.cache.clear()
          getUserContext.cache.clear()
          getMemoryFiles.cache.clear()
          getGitEmail.cache.clear()

          expect(getIsGit.cache.size).toBe(0)
          expect(getGitStatus.cache.size).toBe(0)
          expect(getSystemContext.cache.size).toBe(0)
          expect(getUserContext.cache.size).toBe(0)
          expect(getMemoryFiles.cache.size).toBe(0)
          expect(getGitEmail.cache.size).toBe(0)

          // Verify set/get/delete on active session cache
          const synthetic = Promise.resolve('synthetic-alpha-status')
          getGitStatus.cache.set(repoA, synthetic)
          expect(getGitStatus.cache.get(repoA)).toBe(synthetic)
          expect(await getGitStatus()).toBe('synthetic-alpha-status')
          expect(getGitStatus.cache.delete(repoA)).toBe(true)
          expect(getGitStatus.cache.has(repoA)).toBe(false)

          hostACleared()
        },
      ),

      runWithNewHostSession(
        {
          id: 'cache-host-b',
          cwd: repoB,
          originalCwd: repoB,
          projectRoot: repoB,
        },
        async () => {
          const isGitPromise = getIsGit()
          const statusPromise = getGitStatus()
          const sysCtxPromise = getSystemContext()
          const userCtxPromise = getUserContext()
          const memPromise = getMemoryFiles()
          const emailPromise = getGitEmail()
          await Promise.all([
            isGitPromise,
            statusPromise,
            sysCtxPromise,
            userCtxPromise,
            memPromise,
            emailPromise,
          ])

          hostBWarmed()
          await hostAClearedGate

          // Host B's cache entries must still be intact with exact cached Promise references!
          expect(getIsGit.cache.has(repoB)).toBe(true)
          expect(getIsGit.cache.get(repoB)).toBe(isGitPromise)
          expect(getGitStatus.cache.get(repoB)).toBe(statusPromise)
          expect(getSystemContext.cache.get(repoB)).toBe(sysCtxPromise)
          expect(getGitEmail.cache.get(repoB)).toBe(emailPromise)
          expect(getMemoryFiles.cache.size).toBe(1)
          expect(getUserContext.cache.size).toBe(1)
          expect(await getGitStatus()).toContain('Current branch: branch-beta')
        },
      ),
    ])
  })

  test('isolates prefetchGitStatusForCompaction, systemPromptInjection, initUser/cachedEmail, and mid-session setCwd', async () => {
    process.env.CLAUDE_CONFIG_DIR = isolatedClaudeHome
    process.env.GIT_CONFIG_GLOBAL = emptyGitConfigPath
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    process.env.USER_TYPE = 'ant'
    delete process.env.COO_CREATOR

    const [outcomeA, outcomeB] = await Promise.all([
      runWithNewHostSession(
        {
          id: 'session-prefetch-alpha',
          cwd: repoA,
          originalCwd: repoA,
          projectRoot: repoA,
        },
        async sessionA => {
          setSystemPromptInjection('alpha-breaker')
          prefetchGitStatusForCompaction(async () => 'Prefetched: branch-alpha')
          await initUser()
          await tick(10)
          expect(getSystemPromptInjection()).toBe('alpha-breaker')
          expect(getPendingGitStatusPrefetchForTesting()?.cwd).toBe(repoA)
          const status = await getGitStatus()
          const coreUser = getCoreUserData()
          // Verify withProject fork shares RootSessionSlot with sessionA
          const forkA = sessionA.withProject({ cwd: dirC })
          const forkIsGit = await runWithSession(forkA, async () => {
            expect(getCwd()).toBe(dirC)
            return getIsGit()
          })
          return { status, coreUser, forkIsGit }
        },
      ),

      runWithNewHostSession(
        {
          id: 'session-prefetch-beta',
          cwd: dirC,
          originalCwd: dirC,
          projectRoot: dirC,
        },
        async () => {
          await tick(4)
          // Host A's injection & gitStatus prefetch must NOT appear in Host B
          expect(getSystemPromptInjection()).toBeNull()
          expect(getPendingGitStatusPrefetchForTesting()).toBeNull()
          expect(await getIsGit()).toBe(false)

          // Move mid-session from non-git dir-C into repo-B
          setCwd(repoB)
          expect(await getIsGit()).toBe(true)
          await initUser()
          const coreUser = getCoreUserData()
          const status = await getGitStatus()
          return { status, coreUser }
        },
      ),
    ])

    expect(outcomeA.status).toBe('Prefetched: branch-alpha')
    expect(outcomeA.coreUser.sessionId).toBe('session-prefetch-alpha')
    expect(outcomeA.coreUser.email).toBe('alpha@example.com')
    expect(outcomeA.forkIsGit).toBe(false)

    expect(outcomeB.status).toContain('Current branch: branch-beta')
    expect(outcomeB.coreUser.sessionId).toBe('session-prefetch-beta')
    expect(outcomeB.coreUser.email).toBe('beta@example.com')
  })
})
