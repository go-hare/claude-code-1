/**
 * densable 2.1.217 #5 — bg session isolation canonicalize (`hsr` / `a9u` / `XNe`).
 *
 * Symlinked shared-checkout spellings must not let bg / worktree-isolated
 * sessions write outside their isolation boundary.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { execFileSync } from 'child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  getCwdState,
  getOriginalCwd,
  getProjectRoot,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
} from '../../bootstrap/state.js'
import { debugMock } from '../../../tests/mocks/debug.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import * as realConcurrentSessions from '../concurrentSessions.js'
import * as realWorktree from '../worktree.js'
import * as realSettings from '../settings/settings.js'
import * as realCwd from '../cwd.js'

// densable qRu/nKr/ZRu need real findGitRoot — do NOT mock.module('../git.js').
// Bun mock.module is process-global and poisons sibling ZRu AST tests.

const concurrentSnap = snapshotModuleExports(realConcurrentSessions)
const worktreeSnap = snapshotModuleExports(realWorktree)
const settingsSnap = snapshotModuleExports(realSettings)
const cwdSnap = snapshotModuleExports(realCwd)

const mockIsBgSession = mock(() => false)
const mockGetCurrentWorktreeSession = mock(
  (): {
    originalCwd: string
    worktreePath: string
    worktreeName: string
    sessionId: string
  } | null => null,
)
const mockGetSettings = mock(
  (): { worktree?: { bgIsolation?: 'worktree' | 'none' } } => ({}),
)
const mockGetCwdOverride = mock((): string | undefined => undefined)

// Complete debug surface — incomplete {logForDebugging} drops isDebugToStdErr
// and poisons /tui co-suites under process-global mock.module.
mock.module('../debug.js', debugMock)
mock.module('src/utils/debug.js', debugMock)
mock.module('src/utils/debug.ts', debugMock)

mock.module('../concurrentSessions.js', () => ({
  ...concurrentSnap,
  isBgSession: () => mockIsBgSession(),
}))

mock.module('../worktree.js', () => ({
  ...worktreeSnap,
  getCurrentWorktreeSession: () => mockGetCurrentWorktreeSession(),
}))

mock.module('../settings/settings.js', () => ({
  ...settingsSnap,
  getSettings_DEPRECATED: () => mockGetSettings(),
  getSettingsForSource: () => null,
  getInitialSettings: () => ({}),
}))

// densable agentWorktree often arrives via cwd ALS override; keep getCwd on
// bootstrap cwd state so setCwdState() in fixtures is visible.
mock.module('../cwd.js', () => ({
  ...cwdSnap,
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

afterAll(() => {
  mock.module('../concurrentSessions.js', () => ({ ...concurrentSnap }))
  mock.module('../worktree.js', () => ({ ...worktreeSnap }))
  mock.module('../settings/settings.js', () => ({ ...settingsSnap }))
  mock.module('../cwd.js', () => ({ ...cwdSnap }))
  mock.module('../debug.js', debugMock)
  mock.module('src/utils/debug.js', debugMock)
  mock.module('src/utils/debug.ts', debugMock)
})

const {
  canonicalizeForBgContainment,
  checkAgentWorktreeCwdEscape,
  checkBgIsolationWriteBlock,
  checkWorktreeIsolationWrite,
  N6g,
  pathInsideWorktree,
  pathTouchesRoot,
  qRu,
  resolveBgIsolationMode,
  XNe,
} = await import('../bgIsolationContainment.js')

let tmpRoot: string | undefined
const savedEnv: Record<string, string | undefined> = {}
let savedOriginalCwd: string
let savedProjectRoot: string

function snapEnv(...keys: string[]): void {
  for (const k of keys) savedEnv[k] = process.env[k]
}
function restoreEnv(): void {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

beforeEach(() => {
  snapEnv('CLAUDE_BG_ISOLATION', 'CLAUDE_CODE_SESSION_KIND')
  delete process.env.CLAUDE_BG_ISOLATION
  delete process.env.CLAUDE_CODE_SESSION_KIND
  savedOriginalCwd = getOriginalCwd()
  savedProjectRoot = getProjectRoot()
  mockIsBgSession.mockReset()
  mockIsBgSession.mockReturnValue(false)
  mockGetCurrentWorktreeSession.mockReset()
  mockGetCurrentWorktreeSession.mockReturnValue(null)
  mockGetSettings.mockReset()
  mockGetSettings.mockReturnValue({})
  mockGetCwdOverride.mockReset()
  mockGetCwdOverride.mockReturnValue(undefined)
})

afterEach(() => {
  restoreEnv()
  setOriginalCwd(savedOriginalCwd)
  setProjectRoot(savedProjectRoot)
  setCwdState(savedOriginalCwd)
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true })
    tmpRoot = undefined
  }
})

function makeFixture(): {
  shared: string
  worktree: string
  sharedFile: string
  worktreeFile: string
  linkToShared: string | null
} {
  // realpathSync.native expands Windows 8.3 ADMINI~1 (densable KRu rejects '~').
  // densable qRu/nKr need a real linked worktree (findGitRoot + canonical root).
  tmpRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'bg-iso-217-')))
  const shared = join(tmpRoot, 'shared-checkout')
  mkdirSync(shared, { recursive: true })
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'bgiso',
    GIT_AUTHOR_EMAIL: 'bgiso@test',
    GIT_COMMITTER_NAME: 'bgiso',
    GIT_COMMITTER_EMAIL: 'bgiso@test',
  }
  execFileSync('git', ['init'], { cwd: shared, stdio: 'ignore', env: gitEnv })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
    cwd: shared,
    stdio: 'ignore',
    env: gitEnv,
  })
  const worktree = join(tmpRoot, 'wt-agent')
  execFileSync('git', ['worktree', 'add', '-b', 'wt-agent', worktree], {
    cwd: shared,
    stdio: 'ignore',
    env: gitEnv,
  })
  const sharedFile = join(shared, 'secret.ts')
  const worktreeFile = join(worktree, 'secret.ts')
  writeFileSync(sharedFile, 'shared\n', 'utf8')
  writeFileSync(worktreeFile, 'wt\n', 'utf8')

  let linkToShared: string | null = null
  const linkPath = join(tmpRoot, 'shared-via-symlink')
  try {
    symlinkSync(
      shared,
      linkPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    linkToShared = linkPath
  } catch {
    linkToShared = null
  }

  setOriginalCwd(shared)
  setProjectRoot(shared)
  setCwdState(shared)

  return { shared, worktree, sharedFile, worktreeFile, linkToShared }
}

describe('resolveBgIsolationMode densable T_s', () => {
  test('env CLAUDE_BG_ISOLATION wins', () => {
    process.env.CLAUDE_BG_ISOLATION = 'none'
    mockGetSettings.mockReturnValue({ worktree: { bgIsolation: 'worktree' } })
    expect(resolveBgIsolationMode()).toBe('none')
    process.env.CLAUDE_BG_ISOLATION = 'worktree'
    expect(resolveBgIsolationMode()).toBe('worktree')
  })

  test('falls back to settings.worktree.bgIsolation', () => {
    mockGetSettings.mockReturnValue({ worktree: { bgIsolation: 'none' } })
    expect(resolveBgIsolationMode()).toBe('none')
  })

  test('undefined when neither env nor settings claim a mode', () => {
    expect(resolveBgIsolationMode()).toBeUndefined()
  })
})

describe('canonicalizeForBgContainment densable XNe/N6g', () => {
  test('resolves existing path via realpath', () => {
    const { sharedFile } = makeFixture()
    const c = canonicalizeForBgContainment(sharedFile)
    expect(c.skipped).toBe(false)
    expect(c.canonical).not.toBeNull()
    expect(c.canonical!.toLowerCase()).toBe(
      realpathSync(sharedFile).normalize('NFC').toLowerCase(),
    )
  })

  test('UNC / network-shaped is skipped without resolving', () => {
    const unc = '\\\\server\\share\\file.ts'
    // densable Zj network-skip lives in N6g win32 branch only. On darwin/linux,
    // expandPath treats `\\server\…` as a relative spelling under cwd, so the
    // public canonicalize entry cannot assert win32 skip semantics.
    const n6g = N6g(unc, 'win32')
    expect(n6g.skipped).toBe(true)
    expect(n6g.canonical).toBeNull()
    if (process.platform === 'win32') {
      const c = canonicalizeForBgContainment(unc)
      expect(c.skipped).toBe(true)
      expect(c.canonical).toBeNull()
    }
  })

  test('N6g refuses raw dot-segment spelling', () => {
    const c = N6g('C:\\repo\\..\\secret', 'win32')
    expect(c.canonical).toBeNull()
    expect(c.skipped).toBe(false)
  })

  test('N6g refuses Windows device-namespace', () => {
    const c = N6g('\\\\?\\C:\\Windows\\System32', 'win32')
    expect(c.canonical).toBeNull()
    expect(c.skipped).toBe(false)
  })

  test('N6g refuses trailing-dot-or-space on win32', () => {
    const c = N6g('C:\\repo\\file. ', 'win32')
    expect(c.canonical).toBeNull()
  })

  test('N6g skips UNC as network (not WSL)', () => {
    const c = N6g('\\\\fileserver\\share\\x.ts', 'win32')
    expect(c.skipped).toBe(true)
    expect(c.canonical).toBeNull()
  })

  test('N6g skips /net automount on posix', () => {
    const c = N6g('/net/host/export/file', 'linux')
    expect(c.skipped).toBe(true)
    expect(c.canonical).toBeNull()
  })

  test('XNe converges existing path within 8 hops', () => {
    const { sharedFile } = makeFixture()
    const c = XNe(sharedFile)
    expect(c.skipped).toBe(false)
    expect(c.canonical).not.toBeNull()
  })

  test('symlink chain converges via XNe', () => {
    const { shared, linkToShared } = makeFixture()
    if (!linkToShared) return
    const via = join(linkToShared, 'secret.ts')
    const c = canonicalizeForBgContainment(via)
    expect(c.skipped).toBe(false)
    expect(c.canonical).not.toBeNull()
    expect(c.canonical!.toLowerCase()).toBe(
      realpathSync(join(shared, 'secret.ts')).normalize('NFC').toLowerCase(),
    )
  })
})

describe('checkAgentWorktreeCwdEscape densable VRu/qRu', () => {
  test('blocks cwd on shared checkout when agentWorktree set', () => {
    const { shared, worktree } = makeFixture()
    const msg = checkAgentWorktreeCwdEscape(shared, worktree)
    expect(msg).not.toBeNull()
    expect(msg!).toContain('This agent is isolated in the worktree')
    expect(msg!).toContain('shared checkout')
    expect(msg!).toContain(worktree)
  })

  test('allows cwd inside the isolation worktree', () => {
    const { worktree } = makeFixture()
    expect(checkAgentWorktreeCwdEscape(worktree, worktree)).toBeNull()
  })

  test('qRu.escaped true when cwd touches shared and not in worktree', () => {
    const { shared, worktree } = makeFixture()
    const r = qRu(shared, worktree)
    expect(r.escaped).toBe(true)
  })

  test('qRu.escaped false when cwd is the worktree', () => {
    const { worktree } = makeFixture()
    expect(qRu(worktree, worktree).escaped).toBe(false)
  })

  test('wire-up: Shell.ts / BashTool / PowerShellTool pass agentWorktree', async () => {
    const { readFileSync } = await import('fs')
    const shellSrc = readFileSync(join(import.meta.dir, '../Shell.ts'), 'utf8')
    const bashSrc = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/BashTool/BashTool.tsx',
      ),
      'utf8',
    )
    const psSrc = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/PowerShellTool/PowerShellTool.tsx',
      ),
      'utf8',
    )
    expect(shellSrc).toContain('checkAgentWorktreeCwdEscape')
    expect(shellSrc).toContain('agentWorktree')
    expect(shellSrc).toContain('resolveIsolationRoot')
    expect(shellSrc).toContain('isolationRoot')
    // densable shell stack: context_lost (p && !GZe) → VRu → bash-only ZRu
    expect(shellSrc).toContain('getCwdOverride')
    expect(shellSrc).toContain('context_lost')
    expect(shellSrc).toContain('checkZRuGitRedirectCommand')
    expect(shellSrc).toContain("shellType === 'bash'")
    expect(shellSrc).toContain('command_redirect')
    expect(bashSrc).toContain('agentWorktree: toolUseContext.agentWorktree')
    expect(bashSrc).toContain('agentWorktree,')
    expect(psSrc).toContain('agentWorktree: toolUseContext.agentWorktree')
    expect(psSrc).toContain('agentWorktree,')
  })
})

describe('checkWorktreeIsolationWrite densable a9u / Vyr', () => {
  test('blocks write to shared checkout when isolated in worktree', () => {
    const { worktree, sharedFile } = makeFixture()
    // densable 2.1.222: checkWorktreeIsolationWrite(path, isolationRoot)
    const msg = checkWorktreeIsolationWrite(sharedFile, worktree)
    expect(msg).not.toBeNull()
    expect(msg!).toContain('isolated in')
    expect(msg!).toContain('worktree copy')
    expect(msg!).toContain(worktree)
  })

  test('allows write inside the worktree', () => {
    const { worktree, worktreeFile } = makeFixture()
    const msg = checkWorktreeIsolationWrite(worktreeFile, worktree)
    expect(msg).toBeNull()
  })

  test('agent message vs session message (densable dun)', () => {
    const { shared, worktree, sharedFile } = makeFixture()
    mockGetCurrentWorktreeSession.mockReturnValue(null)
    const agent = checkWorktreeIsolationWrite(sharedFile, worktree)
    expect(agent!).toContain('This agent is isolated')

    mockGetCurrentWorktreeSession.mockReturnValue({
      originalCwd: shared,
      worktreePath: worktree,
      worktreeName: 'wt-session',
      sessionId: 'sess-dun',
    })
    // densable 2.1.222 dun: "This session is isolated in the worktree …"
    const session = checkWorktreeIsolationWrite(sharedFile, worktree)
    expect(session!).toContain('This session is isolated')
    expect(session!).toContain('worktree')
  })

  test('symlink spelling of shared checkout still blocks (canonical compare)', () => {
    const { worktree, linkToShared } = makeFixture()
    if (!linkToShared) return
    const viaLink = join(linkToShared, 'secret.ts')
    const msg = checkWorktreeIsolationWrite(viaLink, worktree)
    expect(msg).not.toBeNull()
    expect(msg!).toContain('worktree copy')
  })
})

describe('checkBgIsolationWriteBlock densable hsr', () => {
  test('non-bg without worktree session is a no-op', () => {
    const { sharedFile } = makeFixture()
    mockIsBgSession.mockReturnValue(false)
    mockGetCurrentWorktreeSession.mockReturnValue(null)
    expect(checkBgIsolationWriteBlock(sharedFile)).toBeNull()
  })

  test('session worktree isolation blocks shared checkout writes', () => {
    const { shared, worktree, sharedFile } = makeFixture()
    mockIsBgSession.mockReturnValue(true)
    mockGetCurrentWorktreeSession.mockReturnValue({
      originalCwd: shared,
      worktreePath: worktree,
      worktreeName: 'wt-agent',
      sessionId: 'sess-1',
    })
    const msg = checkBgIsolationWriteBlock(sharedFile)
    expect(msg).not.toBeNull()
    // densable 2.1.222 dun noun (session)
    expect(msg!).toContain('This session is isolated')
  })

  test('agentWorktree isolation blocks shared checkout writes', () => {
    const { worktree, sharedFile } = makeFixture()
    mockIsBgSession.mockReturnValue(false)
    mockGetCurrentWorktreeSession.mockReturnValue(null)
    const msg = checkBgIsolationWriteBlock(sharedFile, {
      agentWorktree: worktree,
    })
    expect(msg).not.toBeNull()
    expect(msg!).toContain('This agent is isolated')
    expect(msg!).toContain(worktree)
  })

  test('pre-isolation bg blocks shared-checkout writes until EnterWorktree', () => {
    const { sharedFile } = makeFixture()
    mockIsBgSession.mockReturnValue(true)
    mockGetCurrentWorktreeSession.mockReturnValue(null)
    const msg = checkBgIsolationWriteBlock(sharedFile)
    expect(msg).not.toBeNull()
    expect(msg!).toContain("hasn't isolated its changes yet")
    expect(msg!).toContain('EnterWorktree')
    expect(msg!).toContain('bgIsolation')
  })

  test('pre-isolation bg with agentId uses subagent message', () => {
    const { sharedFile } = makeFixture()
    mockIsBgSession.mockReturnValue(true)
    mockGetCurrentWorktreeSession.mockReturnValue(null)
    const msg = checkBgIsolationWriteBlock(sharedFile, { agentId: 'agent-1' })
    expect(msg).not.toBeNull()
    expect(msg!).toContain("parent bg session hasn't isolated yet")
    expect(msg!).toContain('isolation: "worktree"')
  })

  test('bgIsolation none disables pre-isolation block', () => {
    const { sharedFile } = makeFixture()
    mockIsBgSession.mockReturnValue(true)
    mockGetCurrentWorktreeSession.mockReturnValue(null)
    process.env.CLAUDE_BG_ISOLATION = 'none'
    expect(checkBgIsolationWriteBlock(sharedFile)).toBeNull()
  })

  test('settings worktree.bgIsolation none disables pre-isolation block', () => {
    const { sharedFile } = makeFixture()
    mockIsBgSession.mockReturnValue(true)
    mockGetCurrentWorktreeSession.mockReturnValue(null)
    mockGetSettings.mockReturnValue({ worktree: { bgIsolation: 'none' } })
    expect(checkBgIsolationWriteBlock(sharedFile)).toBeNull()
  })

  test('network-shaped target against local root is deny-side via pathTouchesRoot', () => {
    const { shared } = makeFixture()
    const file = {
      lexical: resolve(shared, 'x.ts'),
      canonical: null as string | null,
      skipped: true,
    }
    const root = canonicalizeForBgContainment(shared)
    expect(pathTouchesRoot(file, root)).toBe(true)
  })

  test('wire-up: FileWrite/FileEdit/Notebook call hsr with densable error codes', async () => {
    const { readFileSync } = await import('fs')
    const writeSrc = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.ts',
      ),
      'utf8',
    )
    const editSrc = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/FileEditTool/FileEditTool.ts',
      ),
      'utf8',
    )
    const nbSrc = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/NotebookEditTool/NotebookEditTool.ts',
      ),
      'utf8',
    )
    expect(writeSrc).toContain('checkBgIsolationWriteBlock')
    expect(writeSrc).toMatch(/errorCode:\s*7/)
    expect(writeSrc).toContain('toolUseContext.agentWorktree')
    expect(editSrc).toContain('checkBgIsolationWriteBlock')
    expect(editSrc).toMatch(/errorCode:\s*12/)
    expect(editSrc).toContain('toolUseContext.agentWorktree')
    expect(nbSrc).toContain('checkBgIsolationWriteBlock')
    expect(nbSrc).toMatch(/errorCode:\s*12/)
    expect(nbSrc).toContain('toolUseContext.agentWorktree')
  })

  test('wire-up: createSubagentContext + runAgent pin agentWorktree', async () => {
    const { readFileSync } = await import('fs')
    const forkSrc = readFileSync(
      join(import.meta.dir, '../forkedAgent.ts'),
      'utf8',
    )
    const runAgentSrc = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/AgentTool/runAgent.ts',
      ),
      'utf8',
    )
    const toolSrc = readFileSync(join(import.meta.dir, '../../Tool.ts'), 'utf8')
    expect(toolSrc).toContain('agentWorktree?: string')
    expect(forkSrc).toContain(
      'agentWorktree: overrides?.agentWorktree ?? parentContext.agentWorktree',
    )
    expect(runAgentSrc).toContain('agentWorktree: worktreePath')
  })

  test('T_s: CLAUDE_JOB_DIR state.bgIsolation when env unset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bg-job-iso-'))
    try {
      writeFileSync(
        join(dir, 'state.json'),
        JSON.stringify({ bgIsolation: 'none' }),
        'utf8',
      )
      process.env.CLAUDE_JOB_DIR = dir
      delete process.env.CLAUDE_BG_ISOLATION
      mockGetSettings.mockReturnValue({ worktree: { bgIsolation: 'worktree' } })
      expect(resolveBgIsolationMode()).toBe('none')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('CLAUDE_JOB_DIR alone enables pre-isolation gate (densable zge/Jtt)', () => {
    const { sharedFile } = makeFixture()
    mockIsBgSession.mockReturnValue(false)
    mockGetCurrentWorktreeSession.mockReturnValue(null)
    process.env.CLAUDE_JOB_DIR = join(tmpdir(), 'fake-job-dir-no-state')
    delete process.env.CLAUDE_BG_ISOLATION
    const msg = checkBgIsolationWriteBlock(sharedFile)
    expect(msg).not.toBeNull()
    expect(msg!).toContain("hasn't isolated its changes yet")
  })
})

describe('pathInsideWorktree densable Cco', () => {
  test('canonical containment is case-sensitive for worktree membership', () => {
    const { worktree, worktreeFile } = makeFixture()
    const file = canonicalizeForBgContainment(worktreeFile)
    const wt = canonicalizeForBgContainment(worktree)
    expect(pathInsideWorktree(file, wt)).toBe(true)
    const outside = canonicalizeForBgContainment(
      join(tmpRoot!, 'other', 'x.ts'),
    )
    expect(pathInsideWorktree(outside, wt)).toBe(false)
  })
})
