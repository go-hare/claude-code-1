;(globalThis as { MACRO?: { VERSION: string } }).MACRO ??= {
  VERSION: '2.1.328',
}

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { bashToolHasPermission } from '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js'
import { SUPPORTED_PATH_COMMANDS } from '@claude-code/builtin-tools/tools/BashTool/pathValidation.js'
import {
  getCwdState,
  getOriginalCwd,
  resetRequestLatches,
  setCwdState,
  setOriginalCwd,
} from '../../../bootstrap/state.js'
import * as growthbook from '../../../services/analytics/growthbook.js'
import {
  isBetasSwitchSetAside,
  resetAutoModeClassifierTransportForTests,
  resolveAutoModeClassifierTransport,
  serverClassifierBetasEligible,
} from '../../../services/api/autoModeClassifierTransport.js'
import type { ToolPermissionContext, ToolUseContext } from '../../../Tool.js'
import {
  createMemoryPermissionReader,
  registerClaudeMdPermissionContextSource,
  drainWithheldMemoryOwed,
  getMemoryFilesForNestedDirectory,
  processMemoryFile,
  resetWithheldMemoryStateForTests,
  setClaudeMdPermissionContext,
} from '../../claudemd.js'
import {
  isEscapingGitRefFile,
  quarantineUnexpectedGitDirEntries,
  snapshotGitDirBeforeSandboxWrap,
} from '../../sandbox/sandbox-adapter.js'
import {
  checkBashArgvUnderOutsideReadsBlock,
  isOutsideReadsBlockedReason,
} from '../outsideReads.js'

const tempDirs: string[] = []
const savedEnv: Record<string, string | undefined> = {}
let savedOriginalCwd: string
let savedCwdState: string
const activeSpies: Array<{ mockRestore(): void }> = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) {
    savedEnv[key] = process.env[key]
  }
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function makePermissionContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'bypassPermissions',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: true,
    ...overrides,
  }
}

function makeToolUseContext(ctx: ToolPermissionContext): ToolUseContext {
  return {
    getAppState: () => ({ toolPermissionContext: ctx }),
    setAppState: () => {},
    options: {},
    readFileState: new Map(),
  } as unknown as ToolUseContext
}

beforeEach(() => {
  savedOriginalCwd = getOriginalCwd()
  savedCwdState = getCwdState()
  resetRequestLatches()
  resetAutoModeClassifierTransportForTests()
  resetWithheldMemoryStateForTests()
  setClaudeMdPermissionContext(undefined)
})

afterEach(() => {
  for (const spy of activeSpies.splice(0)) {
    spy.mockRestore()
  }
  setClaudeMdPermissionContext(undefined)
  registerClaudeMdPermissionContextSource(undefined)
  resetWithheldMemoryStateForTests()
  resetRequestLatches()
  resetAutoModeClassifierTransportForTests()
  setOriginalCwd(savedOriginalCwd)
  setCwdState(savedCwdState)
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete savedEnv[k]
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
})

describe('Deep Parity Fix 2 (Permissions / Sandbox / Server Classifier / CLAUDE.md)', () => {
  test('Bug 1 (P1): outsideReads resolves symlinks and dir_link/.. segment-by-segment via walkPermissionPaths', async () => {
    const workDir = makeTempDir('dp2-or-work-')
    const outsideDir = makeTempDir('dp2-or-outside-')
    const outsideSub = join(outsideDir, 'sub')
    mkdirSync(outsideSub, { recursive: true })
    const outsideSecret = join(outsideDir, 'secret.txt')
    writeFileSync(outsideSecret, 'TOP-SECRET')
    const insideFile = join(workDir, 'inside.txt')
    writeFileSync(insideFile, 'SAFE-INSIDE')

    const fileLink = join(workDir, 'escape_link.txt')
    const passwdLink = join(workDir, 'passwd_link')
    const dirLink = join(workDir, 'dir_link')
    const danglingLink = join(workDir, 'dangling_out')
    const magicLink = join(workDir, 'magic_fd')
    const safeLink = join(workDir, 'safe_link.txt')

    symlinkSync(outsideSecret, fileLink)
    symlinkSync('/etc/passwd', passwdLink)
    symlinkSync(outsideSub, dirLink)
    symlinkSync(join(outsideDir, 'does-not-exist.txt'), danglingLink)
    symlinkSync('/proc/self/fd/3', magicLink)
    symlinkSync(insideFile, safeLink)

    setOriginalCwd(workDir)
    setCwdState(workDir)

    const ctx = makePermissionContext({
      mode: 'bypassPermissions',
      blockReadsOutsideWorkingDirectories: true,
      alwaysAllowRules: {
        userSettings: ['Bash(python3 *)', 'Bash(xxd *)', 'Bash(cat *)'],
      },
    })
    const toolCtx = makeToolUseContext(ctx)

    // Direct argv checks: symlink to outside file, dir_link/../secret, dangling outside symlink, opaque symlink
    for (const argv of [
      ['python3', 'escape_link.txt'],
      ['xxd', 'passwd_link'],
      ['python3', 'dir_link/../secret.txt'],
      ['python3', 'dangling_out'],
      ['python3', 'magic_fd'],
      ['python3', 'dir_link/*'],
    ]) {
      const res = checkBashArgvUnderOutsideReadsBlock(argv, workDir, ctx, {
        knownPathHandledCommands: SUPPORTED_PATH_COMMANDS,
      })
      expect(res?.behavior).toBe('ask')
      expect(
        isOutsideReadsBlockedReason(
          res?.decisionReason as { type?: string; circuitBreaker?: string },
        ),
      ).toBe(true)
    }

    // Live probe via bashToolHasPermission: NEVER `allow` for outside symlink or dir_link/../secret
    for (const cmd of [
      'python3 escape_link.txt',
      'xxd passwd_link',
      'cat passwd_link',
      'python3 dir_link/../secret.txt',
      'cat dir_link/../secret.txt',
    ]) {
      const decision = await bashToolHasPermission({ command: cmd }, toolCtx)
      expect(decision.behavior).toBe('ask')
      expect(
        isOutsideReadsBlockedReason(
          decision.decisionReason as {
            type?: string
            circuitBreaker?: string
          },
        ),
      ).toBe(true)
    }

    // Legitimate symlink staying inside cwd remains allowed
    expect(
      checkBashArgvUnderOutsideReadsBlock(
        ['python3', 'safe_link.txt'],
        workDir,
        ctx,
        {
          knownPathHandledCommands: SUPPORTED_PATH_COMMANDS,
        },
      ),
    ).toBeUndefined()
  })

  test('Bug 2 (P1): git snapshot baseline stores symlink targets and quarantines retargeted symlinks', () => {
    const repo = makeTempDir('dp2-git-retarget-')
    const gitDir = join(repo, '.git')
    mkdirSync(join(gitDir, 'refs', 'heads'), { recursive: true })
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(join(gitDir, 'safe-target'), 'ok\n')

    const existingLink = join(gitDir, 'existing-link')
    symlinkSync('./safe-target', existingLink)

    // 1. Unchanged pre-existing symlink is preserved
    snapshotGitDirBeforeSandboxWrap(repo)
    const unchangedRes = quarantineUnexpectedGitDirEntries(repo)
    expect(unchangedRes.quarantined).toEqual([])
    expect(unchangedRes.removedSymlinks).toEqual([])
    expect(lstatSync(existingLink).isSymbolicLink()).toBe(true)

    // 2. Retargeted pre-existing symlink MUST be quarantined into recoverable copy
    snapshotGitDirBeforeSandboxWrap(repo)
    unlinkSync(existingLink)
    symlinkSync('/etc/passwd', existingLink)

    const retargetedRes = quarantineUnexpectedGitDirEntries(repo)
    expect(retargetedRes.quarantined).toContain(existingLink)
    expect(retargetedRes.removedSymlinks).toContain(existingLink)
    expect(() => lstatSync(existingLink)).toThrow()

    const quarantineDir = join(gitDir, '.claude-quarantine-unexpected')
    expect(existsSync(quarantineDir)).toBe(true)
    const savedEntries = readdirSync(quarantineDir)
    expect(savedEntries.length).toBeGreaterThan(0)
    const savedCopy = join(quarantineDir, savedEntries[0]!)
    expect(lstatSync(savedCopy).isSymbolicLink()).toBe(true)
    expect(readlinkSync(savedCopy)).toBe('/etc/passwd')
  })

  test('Bug 3 (P1 + P2): git quarantine scans .git/objects/info, depth > 8, additionalWorkingDirectories, 512B symref threshold, and recoverable copies', () => {
    const mainRepo = makeTempDir('dp2-git-main-')
    const extraRepo = makeTempDir('dp2-git-extra-')
    const mainGit = join(mainRepo, '.git')
    const extraGit = join(extraRepo, '.git')

    mkdirSync(join(mainGit, 'objects', 'info'), { recursive: true })
    mkdirSync(join(mainGit, 'objects', 'ab'), { recursive: true })
    mkdirSync(
      join(
        mainGit,
        'refs',
        'heads',
        'd1',
        'd2',
        'd3',
        'd4',
        'd5',
        'd6',
        'd7',
        'd8',
        'd9',
      ),
      { recursive: true },
    )
    mkdirSync(join(extraGit, 'refs', 'heads'), { recursive: true })
    writeFileSync(join(mainGit, 'HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(join(extraGit, 'HEAD'), 'ref: refs/heads/main\n')
    const looseObj = join(mainGit, 'objects', 'ab', 'cdef0123456789')
    writeFileSync(looseObj, 'loose-object-bytes')

    snapshotGitDirBeforeSandboxWrap(mainRepo, [extraRepo])

    // 1. New symlink under .git/objects/info/
    const objectsInfoLink = join(mainGit, 'objects', 'info', 'alternates')
    symlinkSync('/etc/passwd', objectsInfoLink)

    // 2. New symlink at depth > 8
    const deepLink = join(
      mainGit,
      'refs',
      'heads',
      'd1',
      'd2',
      'd3',
      'd4',
      'd5',
      'd6',
      'd7',
      'd8',
      'd9',
      'deep-link',
    )
    symlinkSync('/etc/hosts', deepLink)

    // 3. New symlink in additionalWorkingDirectories repo's .git
    const extraLink = join(extraGit, 'extra-evil-link')
    symlinkSync('/etc/passwd', extraLink)

    // 4. Oversized symref >= 512 bytes (and < 4096 bytes) vs valid short symref
    const oversizedRef = join(mainGit, 'refs', 'heads', 'oversized-symref')
    writeFileSync(oversizedRef, `ref: refs/heads/${'a'.repeat(520)}\n`)
    const validShortRef = join(mainGit, 'refs', 'heads', 'short-symref')
    writeFileSync(validShortRef, 'ref: refs/heads/main\n')

    expect(isEscapingGitRefFile(oversizedRef)).toBe(true)
    expect(isEscapingGitRefFile(validShortRef)).toBe(false)

    // Call without args (as SandboxManager.cleanupAfterCommand does) to clean ALL snapshotted repos
    const res = quarantineUnexpectedGitDirEntries()

    expect(res.quarantined).toContain(objectsInfoLink)
    expect(res.removedSymlinks).toContain(objectsInfoLink)
    expect(() => lstatSync(objectsInfoLink)).toThrow()

    expect(res.quarantined).toContain(deepLink)
    expect(res.removedSymlinks).toContain(deepLink)
    expect(() => lstatSync(deepLink)).toThrow()

    expect(res.quarantined).toContain(extraLink)
    expect(res.removedSymlinks).toContain(extraLink)
    expect(() => lstatSync(extraLink)).toThrow()

    expect(res.quarantined).toContain(oversizedRef)
    expect(existsSync(oversizedRef)).toBe(false)

    // Legitimate short symref and loose object file preserved
    expect(existsSync(validShortRef)).toBe(true)
    expect(existsSync(looseObj)).toBe(true)

    // Recoverable quarantine copies exist in BOTH repos
    const mainQuarantineFiles = readdirSync(
      join(mainGit, '.claude-quarantine-unexpected'),
    )
    expect(
      mainQuarantineFiles.some(f => f.includes('objects_info_alternates')),
    ).toBe(true)
    expect(mainQuarantineFiles.some(f => f.includes('deep-link'))).toBe(true)
    expect(mainQuarantineFiles.some(f => f.includes('oversized-symref'))).toBe(
      true,
    )

    const extraQuarantineFiles = readdirSync(
      join(extraGit, '.claude-quarantine-unexpected'),
    )
    expect(extraQuarantineFiles.some(f => f.includes('extra-evil-link'))).toBe(
      true,
    )
  })

  test('Bug 4 (P1): autoModeClassifierTransport uses firstParty provider gate (not Desktop-only) for isBetasSwitchSetAside', () => {
    setEnv('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', '1')
    setEnv('CLAUDE_CODE_ENTRYPOINT', 'cli')
    setEnv('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', undefined)
    setEnv('CLAUDE_CODE_SIMULATE_PROXY_USAGE', undefined)
    setEnv('CLAUDE_CODE_AUTO_MODE_SERVER', undefined)
    setEnv('CLAUDE_CODE_USE_BEDROCK', undefined)
    setEnv('CLAUDE_CODE_USE_VERTEX', undefined)
    setEnv('CLAUDE_CODE_USE_FOUNDRY', undefined)
    setEnv('CLAUDE_CODE_USE_GATEWAY', undefined)
    setEnv('ANTHROPIC_BASE_URL', undefined)
    setEnv('ANTHROPIC_UNIX_SOCKET', undefined)

    const spy = spyOn(
      growthbook,
      'getFeatureValue_CACHED_MAY_BE_STALE',
    ).mockImplementation(((name: string, fallback: unknown) => {
      if (name === 'tengu_drifting_valley') return true
      if (name === 'tengu_smooth_chipmunk') return true
      if (name === 'tengu_iridescent_crystal') return false
      return fallback
    }) as typeof growthbook.getFeatureValue_CACHED_MAY_BE_STALE)
    activeSpies.push(spy)

    // Normal firstParty CLI session IS eligible when tengu_drifting_valley is enabled
    resetAutoModeClassifierTransportForTests()
    expect(isBetasSwitchSetAside()).toBe(true)
    expect(serverClassifierBetasEligible()).toBe(true)
    expect(resolveAutoModeClassifierTransport('auto')).toBe('arbiter')

    // 3P providers remain blocked when CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS is set
    for (const flag of [
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
    ]) {
      setEnv(flag, '1')
      resetAutoModeClassifierTransportForTests()
      expect(isBetasSwitchSetAside()).toBe(false)
      expect(serverClassifierBetasEligible()).toBe(false)
      setEnv(flag, undefined)
    }

    // Custom gateway / unix socket remain blocked even on firstParty
    setEnv('ANTHROPIC_BASE_URL', 'https://gateway.internal.example')
    resetAutoModeClassifierTransportForTests()
    expect(isBetasSwitchSetAside()).toBe(false)
    setEnv('ANTHROPIC_BASE_URL', undefined)

    setEnv('ANTHROPIC_UNIX_SOCKET', '/tmp/anthropic.sock')
    resetAutoModeClassifierTransportForTests()
    expect(isBetasSwitchSetAside()).toBe(false)
  })

  test('Bug 5 (P1): recursive CLAUDE.md @include & nested dir loading enforces Read deny rules via permission-controlled reader', async () => {
    const projectDir = makeTempDir('dp2-claudemd-')
    const subDir = join(projectDir, 'nested')
    const rulesDir = join(subDir, '.claude', 'rules')
    mkdirSync(rulesDir, { recursive: true })

    const rootClaudeMd = join(projectDir, 'CLAUDE.md')
    const allowedMd = join(projectDir, 'allowed.md')
    const midMd = join(projectDir, 'mid.md')
    const secretMd = join(projectDir, 'secret.md')
    const secretLink = join(projectDir, 'secret-alias.md')
    const nestedClaudeMd = join(subDir, 'CLAUDE.md')
    const deniedRuleMd = join(rulesDir, 'secret-rule.md')

    writeFileSync(allowedMd, 'ALLOWED-CONTENT')
    writeFileSync(secretMd, 'DENIED-SECRET-CONTENT')
    symlinkSync(secretMd, secretLink)
    writeFileSync(midMd, 'MID-CONTENT\n@./secret.md\n@./secret-alias.md\n')
    writeFileSync(rootClaudeMd, 'ROOT-CONTENT\n@./allowed.md\n@./mid.md\n')
    writeFileSync(nestedClaudeMd, 'NESTED-ROOT\n@../secret.md\n')
    writeFileSync(deniedRuleMd, 'DENIED-RULE-CONTENT')

    setOriginalCwd(projectDir)
    setCwdState(projectDir)

    const denyCtx = makePermissionContext({
      alwaysDenyRules: {
        userSettings: ['Read(**/secret.md)', 'Read(**/secret-rule.md)'],
      },
    })

    // 1. Explicit permissionReader passed to processMemoryFile blocks recursive @include & symlink
    const reader = createMemoryPermissionReader(denyCtx)
    const filesExplicit = await processMemoryFile(
      rootClaudeMd,
      'Project',
      new Set(),
      false,
      0,
      undefined,
      reader,
    )
    const explicitContents = filesExplicit.map(f => f.content).join('\n')
    expect(explicitContents).toContain('ROOT-CONTENT')
    expect(explicitContents).toContain('ALLOWED-CONTENT')
    expect(explicitContents).toContain('MID-CONTENT')
    expect(explicitContents).not.toContain('DENIED-SECRET-CONTENT')

    const withheld = drainWithheldMemoryOwed([])
    const canonicalSecretMd = realpathSync(secretMd)
    expect(
      withheld.some(
        w =>
          (w.path === secretMd || w.path === canonicalSecretMd) &&
          w.why === 'denied',
      ),
    ).toBe(true)

    // 2. Registered session permission context automatically protects processMemoryFile & getMemoryFilesForNestedDirectory
    resetWithheldMemoryStateForTests()
    setClaudeMdPermissionContext(denyCtx)
    const filesFromCtx = await processMemoryFile(
      rootClaudeMd,
      'Project',
      new Set(),
      false,
    )
    expect(filesFromCtx.map(f => f.content).join('\n')).not.toContain(
      'DENIED-SECRET-CONTENT',
    )

    const nestedFiles = await getMemoryFilesForNestedDirectory(
      subDir,
      join(subDir, 'app.ts'),
      new Set(),
    )
    const nestedContents = nestedFiles.map(f => f.content).join('\n')
    expect(nestedContents).toContain('NESTED-ROOT')
    expect(nestedContents).not.toContain('DENIED-SECRET-CONTENT')
    expect(nestedContents).not.toContain('DENIED-RULE-CONTENT')

    // 3. Safe default when no permission context is set (isolated unit test)
    setClaudeMdPermissionContext(undefined)
    registerClaudeMdPermissionContextSource(undefined)
    const filesNoCtx = await processMemoryFile(
      rootClaudeMd,
      'Project',
      new Set(),
      false,
    )
    expect(filesNoCtx.map(f => f.content).join('\n')).toContain(
      'DENIED-SECRET-CONTENT',
    )
  })

  test('Bug 1b: live context source wins over judgedBy launch context (official uZr engineStore ordering)', async () => {
    const dir = makeTempDir('dp2-livectx-')
    const allowedCtx = makePermissionContext()
    const deniedCtx = makePermissionContext({
      alwaysDenyRules: { localSettings: ['Read(*)'] },
    })
    const claudeMd = join(dir, 'CLAUDE.md')
    writeFileSync(claudeMd, 'LIVE-CTX-SECRET')

    // judgedBy = launch context denies; live context allows → live must win.
    setClaudeMdPermissionContext(deniedCtx)
    registerClaudeMdPermissionContextSource(() => allowedCtx)
    const allowedFiles = await processMemoryFile(
      claudeMd,
      'Project',
      new Set(),
      false,
    )
    expect(allowedFiles.map(f => f.content).join('\n')).toContain(
      'LIVE-CTX-SECRET',
    )

    // Live context later turns restrictive (mid-session /permissions deny)
    // → subsequent loads must withhold, matching engineStore.current reads.
    let currentCtx: typeof allowedCtx = deniedCtx
    registerClaudeMdPermissionContextSource(() => currentCtx)
    const deniedFiles = await processMemoryFile(
      claudeMd,
      'Project',
      new Set(),
      false,
    )
    expect(deniedFiles).toEqual([])
  })

  test('Bug 6 (P2): git allows safe -c core.pager=cat / color.ui=never / valid pathspecs while blocking dangerous overrides & outside paths', () => {
    const workDir = makeTempDir('dp2-git-args-work-')
    const outsideDir = makeTempDir('dp2-git-args-out-')
    const insideFile = join(workDir, 'inside.txt')
    const outsideSecret = join(outsideDir, 'secret.txt')
    writeFileSync(insideFile, 'ok')
    writeFileSync(outsideSecret, 'secret')

    setOriginalCwd(workDir)
    setCwdState(workDir)

    const ctx = makePermissionContext({
      blockReadsOutsideWorkingDirectories: true,
    })

    // Safe git commands MUST be allowed (undefined)
    for (const argv of [
      ['git', '-c', 'core.pager=cat', 'status'],
      ['git', '-c', 'core.pager=less -FRX', 'log', '-n', '5'],
      ['git', '-c', 'color.ui=never', 'status'],
      ['git', '-c', 'pager.diff=cat', 'diff'],
      ['git', 'diff', '--', ':(exclude)dist/**', 'src/*.ts'],
      ['git', 'log', '--', ':(top)inside.txt'],
      ['git', 'diff', '--', 'inside.txt'],
    ]) {
      expect(
        checkBashArgvUnderOutsideReadsBlock(argv, workDir, ctx, {
          hasCdInCompound: true,
        }),
      ).toBeUndefined()
    }

    // Dangerous -c overrides & outside paths MUST stay blocked
    for (const argv of [
      ['git', '-c', 'core.fsmonitor=evil', 'status'],
      ['git', '-c', 'core.sshCommand=evil', 'status'],
      ['git', '-c', 'core.hooksPath=/tmp/evil-hooks', 'status'],
      ['git', '-c', 'include.path=/etc/gitconfig', 'status'],
      ['git', '-c', 'core.pager=sh -c "cat /etc/passwd"', 'status'],
      ['git', 'grep', '--no-index', 'root', '/etc/passwd'],
      ['git', '-C', '/etc', 'status'],
      ['git', 'diff', '--', `:(top)${outsideSecret}`],
    ]) {
      const res = checkBashArgvUnderOutsideReadsBlock(argv, workDir, ctx)
      expect(res?.behavior).toBe('ask')
      expect(
        isOutsideReadsBlockedReason(
          res?.decisionReason as { type?: string; circuitBreaker?: string },
        ),
      ).toBe(true)
    }
  })

  test('Bug 7 (P2): SAFE_ENV_ASSIGN_NAMES matches official 2.1.328 omt (allows LANGUAGE, GIT_TERMINAL_PROMPT, etc.; blocks GOFLAGS/GIT_PAGER/PAGER)', () => {
    const workDir = makeTempDir('dp2-env-work-')
    setOriginalCwd(workDir)
    setCwdState(workDir)

    const ctx = makePermissionContext({
      blockReadsOutsideWorkingDirectories: true,
    })

    for (const argv of [
      ['LANGUAGE=en_US:en', 'ls'],
      ['env', 'LANGUAGE=C', 'GIT_TERMINAL_PROMPT=0', 'ls'],
      ['GIT_TERMINAL_PROMPT=0', 'git', 'status'],
      ['DEBIAN_FRONTEND=noninteractive', 'ls'],
      ['GOEXPERIMENT=arenas', 'GO111MODULE=on', 'ls'],
      ['PYTEST_DISABLE_PLUGIN_AUTOLOAD=1', 'PYTEST_DEBUG=1', 'ls'],
      ['CHARSET=UTF-8', 'BLOCK_SIZE=1K', 'TIME_STYLE=iso', 'ls'],
    ]) {
      expect(
        checkBashArgvUnderOutsideReadsBlock(argv, workDir, ctx, {
          knownPathHandledCommands: SUPPORTED_PATH_COMMANDS,
        }),
      ).toBeUndefined()
    }

    // Unsafe env vars (including GOFLAGS/GIT_PAGER/PAGER removed from omt, and path values) MUST ask
    for (const argv of [
      ['env', 'GOFLAGS=-mod=vendor', 'ls'],
      ['env', 'GIT_PAGER=cat /etc/passwd', 'ls'],
      ['env', 'PAGER=less', 'ls'],
      ['LANGUAGE=/etc/passwd', 'ls'],
      ['GIT_TERMINAL_PROMPT=../etc', 'ls'],
    ]) {
      const res = checkBashArgvUnderOutsideReadsBlock(argv, workDir, ctx, {
        knownPathHandledCommands: SUPPORTED_PATH_COMMANDS,
      })
      expect(res?.behavior).toBe('ask')
      expect(
        isOutsideReadsBlockedReason(
          res?.decisionReason as { type?: string; circuitBreaker?: string },
        ),
      ).toBe(true)
    }
  })
})
