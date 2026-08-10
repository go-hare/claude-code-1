import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getCwdState,
  getOriginalCwd,
  getProjectRoot,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
} from '../../bootstrap/state.js'

/**
 * densable 2.1.222 #1 — worktree isolation every session type:
 * Qgt / dun / VRu / ZRu / hsr session noun + isolationRoot shell fallback.
 */

const mockIsBgSession = mock(() => false)
const mockGetCurrentWorktreeSession = mock(
  (): {
    originalCwd: string
    worktreePath: string
    worktreeName: string
    sessionId: string
  } | null => null,
)
const mockGetCwdOverride = mock((): string | undefined => undefined)

mock.module('../debug.js', () => ({
  logForDebugging: () => {},
}))

mock.module('../concurrentSessions.js', () => ({
  isBgSession: () => mockIsBgSession(),
}))

mock.module('../worktree.js', () => ({
  getCurrentWorktreeSession: () => mockGetCurrentWorktreeSession(),
}))

mock.module('../settings/settings.js', () => ({
  getSettings_DEPRECATED: () => ({}),
  getSettingsForSource: () => null,
  getInitialSettings: () => ({}),
}))

mock.module('../cwd.js', () => ({
  getCwd: () => {
    const ov = mockGetCwdOverride()
    if (ov) return ov
    try {
      return getCwdState()
    } catch {
      return getOriginalCwd()
    }
  },
  getCwdOverride: () => mockGetCwdOverride(),
  pwd: () => {
    const ov = mockGetCwdOverride()
    return ov ?? getCwdState()
  },
  runWithCwdOverride: <T>(cwd: string, fn: () => T) => {
    const prev = mockGetCwdOverride()
    mockGetCwdOverride.mockReturnValue(cwd)
    try {
      return fn()
    } finally {
      mockGetCwdOverride.mockReturnValue(prev)
    }
  },
}))

const {
  checkAgentWorktreeCwdEscape,
  checkBgIsolationWriteBlock,
  checkWorktreeIsolationWrite,
  isolationSubject,
  resolveIsolationRoot,
} = await import('../bgIsolationContainment.js')

const { checkZRuGitRedirectCommand } = await import(
  '../worktreeGitIsolation.js'
)

let prevOriginal: string
let prevProject: string
let prevCwd: string
let fixtureRoot: string

function makeFixture(): {
  shared: string
  worktree: string
  sharedFile: string
  worktreeFile: string
} {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'wt-iso-222-'))
  const shared = join(fixtureRoot, 'shared')
  const worktree = join(fixtureRoot, 'worktree')
  mkdirSync(shared, { recursive: true })
  mkdirSync(worktree, { recursive: true })
  // real git roots so qRu seed expansion works
  for (const d of [shared, worktree]) {
    execFileSync('git', ['init'], { cwd: d, stdio: 'ignore' })
  }
  const sharedFile = join(shared, 'main.ts')
  const worktreeFile = join(worktree, 'main.ts')
  writeFileSync(sharedFile, 'shared')
  writeFileSync(worktreeFile, 'wt')
  setOriginalCwd(realpathSync(shared))
  setProjectRoot(realpathSync(shared))
  setCwdState(realpathSync(shared))
  return {
    shared: realpathSync(shared),
    worktree: realpathSync(worktree),
    sharedFile: realpathSync(sharedFile),
    worktreeFile: realpathSync(worktreeFile),
  }
}

beforeEach(() => {
  prevOriginal = getOriginalCwd()
  prevProject = getProjectRoot()
  prevCwd = getCwdState()
  mockIsBgSession.mockReturnValue(false)
  mockGetCurrentWorktreeSession.mockReturnValue(null)
  mockGetCwdOverride.mockReturnValue(undefined)
})

afterEach(() => {
  try {
    setOriginalCwd(prevOriginal)
    setProjectRoot(prevProject)
    setCwdState(prevCwd)
  } catch {
    // ignore
  }
  if (fixtureRoot) {
    try {
      rmSync(fixtureRoot, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

describe('densable 2.1.222 #1 Qgt / dun / every session type', () => {
  test('resolveIsolationRoot prefers agentWorktree over session', () => {
    const { shared, worktree } = makeFixture()
    mockGetCurrentWorktreeSession.mockReturnValue({
      originalCwd: shared,
      worktreePath: join(shared, 'session-wt'),
      worktreeName: 'sess',
      sessionId: 's1',
    })
    expect(resolveIsolationRoot({ agentWorktree: worktree })).toBe(worktree)
  })

  test('resolveIsolationRoot falls back to EnterWorktree session', () => {
    const { shared, worktree } = makeFixture()
    mockGetCurrentWorktreeSession.mockReturnValue({
      originalCwd: shared,
      worktreePath: worktree,
      worktreeName: 'sess',
      sessionId: 's1',
    })
    expect(resolveIsolationRoot({})).toBe(worktree)
  })

  test('isolationSubject dun: session vs agent', () => {
    const { shared, worktree } = makeFixture()
    mockGetCurrentWorktreeSession.mockReturnValue(null)
    expect(isolationSubject(worktree)).toEqual({
      noun: 'This agent',
      possessive: "a worktree-isolated agent's",
    })
    mockGetCurrentWorktreeSession.mockReturnValue({
      originalCwd: shared,
      worktreePath: worktree,
      worktreeName: 'sess',
      sessionId: 's1',
    })
    expect(isolationSubject(worktree)).toEqual({
      noun: 'This session',
      possessive: "a worktree-isolated session's",
    })
  })

  test('hsr session path blocks shared write without agentWorktree', () => {
    const { shared, worktree, sharedFile } = makeFixture()
    mockIsBgSession.mockReturnValue(false)
    mockGetCurrentWorktreeSession.mockReturnValue({
      originalCwd: shared,
      worktreePath: worktree,
      worktreeName: 'sess',
      sessionId: 's1',
    })
    const msg = checkBgIsolationWriteBlock(sharedFile)
    expect(msg).not.toBeNull()
    expect(msg!).toContain('This session is isolated')
    expect(msg!).toContain(worktree)
  })

  test('VRu cwd escape uses session possessive', () => {
    const { shared, worktree } = makeFixture()
    mockGetCurrentWorktreeSession.mockReturnValue({
      originalCwd: shared,
      worktreePath: worktree,
      worktreeName: 'sess',
      sessionId: 's1',
    })
    // cwd at shared checkout while isolation root is worktree
    const msg = checkAgentWorktreeCwdEscape(shared, worktree)
    expect(msg).not.toBeNull()
    expect(msg!).toContain('This session is isolated')
    expect(msg!).toContain("a worktree-isolated session's commands")
  })

  test('VRu agent path uses agent possessive', () => {
    const { shared, worktree } = makeFixture()
    mockGetCurrentWorktreeSession.mockReturnValue(null)
    const msg = checkAgentWorktreeCwdEscape(shared, worktree)
    expect(msg).not.toBeNull()
    expect(msg!).toContain('This agent is isolated')
    expect(msg!).toContain("a worktree-isolated agent's commands")
  })

  test('ZRu git redirect uses session possessive', async () => {
    const { shared, worktree } = makeFixture()
    mockGetCurrentWorktreeSession.mockReturnValue({
      originalCwd: shared,
      worktreePath: worktree,
      worktreeName: 'sess',
      sessionId: 's1',
    })
    const msg = await checkZRuGitRedirectCommand(
      `git -C ${shared} status`,
      worktree,
      worktree,
    )
    expect(msg).not.toBeNull()
    expect(msg!).toContain('This session is isolated')
    expect(msg!).toContain("a worktree-isolated session's git operations")
  })

  test('write fence allows worktree path under session isolation', () => {
    const { shared, worktree, worktreeFile } = makeFixture()
    mockGetCurrentWorktreeSession.mockReturnValue({
      originalCwd: shared,
      worktreePath: worktree,
      worktreeName: 'sess',
      sessionId: 's1',
    })
    expect(checkWorktreeIsolationWrite(worktreeFile, worktree)).toBeNull()
    expect(checkBgIsolationWriteBlock(worktreeFile)).toBeNull()
  })

  test('Shell source wires Qgt isolationRoot fallback', async () => {
    const shellSrc = await Bun.file('src/utils/Shell.ts').text()
    expect(shellSrc).toContain('resolveIsolationRoot')
    expect(shellSrc).toContain('isolationRoot')
    expect(shellSrc).toContain('isolationRootOpt')
    // densable k = f ?? p then VRu/ZRu
    expect(shellSrc).toContain(
      'checkAgentWorktreeCwdEscape(cwd, isolationRoot)',
    )
    expect(shellSrc).toContain(
      'blocked shell exec outside isolation worktree: cwd=${cwd} isolationRoot=${isolationRoot}',
    )
  })

  test('bgIsolationContainment exports Qgt/dun', async () => {
    const text = await Bun.file('src/utils/bgIsolationContainment.ts').text()
    expect(text).toContain('export function resolveIsolationRoot')
    expect(text).toContain('export function isolationSubject')
    expect(text).toContain("a worktree-isolated session's")
    expect(text).toContain('densable 2.1.222')
  })
})
