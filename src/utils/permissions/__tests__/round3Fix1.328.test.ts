;(globalThis as { MACRO?: { VERSION: string } }).MACRO ??= {
  VERSION: '2.1.328',
}

import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  bashToolHasPermission,
  buildUnparsedDangerousRmAsk,
} from '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js'
import {
  recordSandboxStateAtCheck,
  shouldKeepRewrittenCommandInSandbox,
} from '@claude-code/builtin-tools/tools/BashTool/shouldUseSandbox.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { sortGrepContentLines } from '@claude-code/builtin-tools/tools/GrepTool/GrepTool.js'
import { powershellToolHasPermission } from '@claude-code/builtin-tools/tools/PowerShellTool/powershellPermissions.js'
import {
  getAllowedSettingSources,
  getOriginalCwd,
  registerHookCallbacks,
  resetSdkInitState,
  setAllowedSettingSources,
  setOriginalCwd,
} from '../../../bootstrap/state.js'
import { executePermissionRequestHooksForSDK } from '../../../cli/structuredIO.js'
import type {
  Tool,
  ToolPermissionContext,
  ToolUseContext,
} from '../../../Tool.js'
import {
  isOpaqueSymlinkTarget,
  walkPermissionPaths,
} from '../../fsOperations.js'
import {
  _resetSandboxHeldStateForTesting,
  isSandboxFencingOutsideReads,
  quarantineUnexpectedGitDirEntries,
  SandboxManager,
  snapshotGitDirBeforeSandboxWrap,
} from '../../sandbox/sandbox-adapter.js'
import type { SettingSource } from '../../settings/constants.js'
import { resetSettingsCache } from '../../settings/settingsCache.js'
import {
  hasBypassImmuneNonClassifierAlsoBreaker,
  hasUnwaivableBypassImmuneSafetyCheck,
} from '../nhoGates.js'
import {
  checkBashArgvUnderOutsideReadsBlock,
  isOutsideReadsBlockedReason,
} from '../outsideReads.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const savedEnv: Record<string, string | undefined> = {}
function setEnv(key: string, val: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key]
  if (val === undefined) delete process.env[key]
  else process.env[key] = val
}

const origSources: SettingSource[] = [...getAllowedSettingSources()]
const origCwd = getOriginalCwd()

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete savedEnv[k]
  }
  setAllowedSettingSources([...origSources])
  setOriginalCwd(origCwd)
  resetSettingsCache()
  resetSdkInitState()
  _resetSandboxHeldStateForTesting()
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

function makePermissionContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

function makeToolUseContext(permCtx: ToolPermissionContext): ToolUseContext {
  let state = { toolPermissionContext: permCtx, sessionHooks: new Map() }
  return {
    abortController: new AbortController(),
    getAppState: () => state as never,
    setAppState: (updater: (prev: typeof state) => typeof state) => {
      state = updater(state)
    },
    options: { tools: [], mainLoopModel: 'claude-sonnet-4-6' },
  } as unknown as ToolUseContext
}

describe('Round 3 Fix 1 (LIVE-P0-1 + BH1-P0-1..6 + BH1-P1-1..5)', () => {
  test('LIVE-P0-1: cli.tsx --version, --help, and FORCE_COLOR=-1 --version exit 0 without ESM TDZ', () => {
    const repoRoot = join(import.meta.dir, '../../../..')
    for (const [args, extraEnv] of [
      [['src/entrypoints/cli.tsx', '--version'], {}],
      [['src/entrypoints/cli.tsx', '--help'], {}],
      [['src/entrypoints/cli.tsx', '--version'], { FORCE_COLOR: '-1' }],
    ] as const) {
      const proc = Bun.spawnSync([process.execPath, ...args], {
        cwd: repoRoot,
        env: { ...process.env, ...extraEnv },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      expect(proc.exitCode).toBe(0)
      expect(proc.stderr.toString()).not.toContain('Cannot access')
    }
  })

  test('BH1-P0-1: root-level glob prefix (/e[t]c/passwd, /etc*) resolves to "/" instead of "."', () => {
    const workDir = makeTempDir('r3-glob-cwd-')
    setOriginalCwd(workDir)
    const ctx = makePermissionContext({
      blockReadsOutsideWorkingDirectories: true,
    })

    for (const pattern of ['/e[t]c/passwd', '/etc*', '/*']) {
      const res = checkBashArgvUnderOutsideReadsBlock(
        ['cat', pattern],
        workDir,
        ctx,
      )
      expect(res?.behavior).toBe('ask')
      expect(
        isOutsideReadsBlockedReason(
          res?.decisionReason as { type?: string; circuitBreaker?: string },
        ),
      ).toBe(true)
    }

    // Relative glob stays anchored to "." (cwd) and is allowed inside cwd
    const relRes = checkBashArgvUnderOutsideReadsBlock(
      ['ls', '*.ts'],
      workDir,
      ctx,
    )
    expect(relRes).toBeUndefined()

    // Read deny rule on "/" is also checked for root-level globs
    const denyCtx = makePermissionContext({
      blockReadsOutsideWorkingDirectories: true,
      alwaysDenyRules: { userSettings: ['Read(//)'] },
    })
    const denyRes = checkBashArgvUnderOutsideReadsBlock(
      ['cat', '/e[t]c/passwd'],
      workDir,
      denyCtx,
    )
    expect(denyRes).toBeDefined()
    expect(denyRes?.behavior === 'deny' || denyRes?.behavior === 'ask').toBe(
      true,
    )
  })

  test('BH1-P0-2: git inspects positional args and -c/--config-env overrides while allowing normal in-repo commands', () => {
    const workDir = makeTempDir('r3-git-cwd-')
    const outsideDir = makeTempDir('r3-git-outside-')
    const secretFile = join(outsideDir, 'secret.txt')
    writeFileSync(secretFile, 'top-secret')
    writeFileSync(join(workDir, 'inside.txt'), 'ok')
    setOriginalCwd(workDir)

    const ctx = makePermissionContext({
      blockReadsOutsideWorkingDirectories: true,
    })

    // Outside positional paths MUST be blocked (ask with outsideReadsBlocked)
    for (const argv of [
      ['git', 'grep', '--no-index', 'secret', secretFile],
      ['git', 'diff', '--no-index', secretFile, join(workDir, 'inside.txt')],
      ['git', 'log', '--', secretFile],
      ['git', '-c', `core.attributesFile=${secretFile}`, 'status'],
      ['git', '-c', 'core.fsmonitor=cat /etc/passwd', 'status'],
      ['git', '--config-env=core.attributesFile=MY_ENV', 'status'],
    ]) {
      const res = checkBashArgvUnderOutsideReadsBlock(argv, workDir, ctx)
      expect(res?.behavior).toBe('ask')
      expect(
        isOutsideReadsBlockedReason(
          res?.decisionReason as { type?: string; circuitBreaker?: string },
        ),
      ).toBe(true)
    }

    // Read deny rule on outside file MUST return deny even via git grep --no-index or git -c
    const denyCtx = makePermissionContext({
      blockReadsOutsideWorkingDirectories: true,
      alwaysDenyRules: { userSettings: [`Read(/${secretFile})`] },
    })
    expect(
      checkBashArgvUnderOutsideReadsBlock(
        ['git', 'grep', '--no-index', 'secret', secretFile],
        workDir,
        denyCtx,
      )?.behavior,
    ).toBe('deny')
    expect(
      checkBashArgvUnderOutsideReadsBlock(
        ['git', '-c', `core.attributesFile=${secretFile}`, 'status'],
        workDir,
        denyCtx,
      )?.behavior,
    ).toBe('deny')

    // Normal in-repo read-only git commands remain allowed
    for (const argv of [
      ['git', 'status'],
      ['git', 'diff', 'HEAD~1', '--', 'inside.txt'],
      ['git', 'log', '-n', '5', '--oneline'],
      ['git', '-c', 'color.ui=always', 'status'],
      ['git', '-c', 'pager.diff=false', 'diff'],
    ]) {
      expect(
        checkBashArgvUnderOutsideReadsBlock(argv, workDir, ctx),
      ).toBeUndefined()
    }
  })

  test('BH1-P0-3: executePermissionRequestHooksForSDK mirrors permissions.ts (empty updatedInput, accountMemory rewrite deny, rule re-check, sandbox rewrite gating)', async () => {
    const toolUseID = 'tu-r3-sdk-hook-1'
    const originalInput = { command: 'echo hello' }

    // 1. Empty updatedInput `{}` falls back to original input & does NOT record sandbox rewrite
    recordSandboxStateAtCheck(toolUseID, originalInput, true)
    registerHookCallbacks({
      PermissionRequest: [
        {
          hooks: [
            {
              type: 'callback',
              callback: async () => ({
                hookSpecificOutput: {
                  hookEventName: 'PermissionRequest',
                  decision: { behavior: 'allow', updatedInput: {} },
                },
              }),
            },
          ],
        },
      ],
    } as never)

    const bashStubTool = {
      name: BASH_TOOL_NAME,
      checkPermissions: async () => ({
        behavior: 'allow',
        updatedInput: originalInput,
      }),
    } as unknown as Tool
    const ctx = makeToolUseContext(makePermissionContext())

    const resEmpty = await executePermissionRequestHooksForSDK(
      BASH_TOOL_NAME,
      toolUseID,
      originalInput,
      ctx,
      undefined,
      bashStubTool,
    )
    expect(resEmpty?.behavior).toBe('allow')
    if (resEmpty?.behavior === 'allow') {
      expect(resEmpty.updatedInput).toEqual(originalInput)
    }
    // Because empty `{}` is not a rewrite, original checked=true stays in force
    expect(shouldKeepRewrittenCommandInSandbox(toolUseID, originalInput)).toBe(
      true,
    )

    // 2. Account-memory tool rewrite via PermissionRequest hook MUST be denied
    resetSdkInitState()
    registerHookCallbacks({
      PermissionRequest: [
        {
          hooks: [
            {
              type: 'callback',
              callback: async () => ({
                hookSpecificOutput: {
                  hookEventName: 'PermissionRequest',
                  decision: {
                    behavior: 'allow',
                    updatedInput: { path: '/tampered' },
                  },
                },
              }),
            },
          ],
        },
      ],
    } as never)
    const memTool = {
      name: 'mcp__memory__write',
      mcpInfo: { accountMemoryServer: true },
      checkPermissions: async () => ({ behavior: 'allow', updatedInput: {} }),
    } as unknown as Tool
    const resMem = await executePermissionRequestHooksForSDK(
      memTool.name,
      'tu-r3-mem-1',
      { path: '/orig' },
      ctx,
      undefined,
      memTool,
    )
    expect(resMem?.behavior).toBe('deny')
    if (resMem?.behavior === 'deny') {
      expect(resMem.message).toContain('account memory server')
    }

    // 3. Rewritten input violating a deny rule MUST be denied via checkRuleBasedPermissions
    resetSdkInitState()
    registerHookCallbacks({
      PermissionRequest: [
        {
          hooks: [
            {
              type: 'callback',
              callback: async () => ({
                hookSpecificOutput: {
                  hookEventName: 'PermissionRequest',
                  decision: {
                    behavior: 'allow',
                    updatedInput: { command: 'rm -rf /' },
                  },
                },
              }),
            },
          ],
        },
      ],
    } as never)
    const denyRuleCtx = makeToolUseContext(
      makePermissionContext({
        alwaysDenyRules: { userSettings: ['Bash(rm:*)'] },
      }),
    )
    const resDeny = await executePermissionRequestHooksForSDK(
      BASH_TOOL_NAME,
      'tu-r3-deny-1',
      { command: 'echo ok' },
      denyRuleCtx,
      undefined,
      bashStubTool,
    )
    expect(resDeny?.behavior).toBe('deny')
  })

  test('BH1-P0-4: walkPermissionPaths resolves deepest existing ancestor on ENOENT for ANY hop', () => {
    const workDir = makeTempDir('r3-walk-work-')
    const outsideDir = makeTempDir('r3-walk-outside-')
    const realOutside = realpathSync(outsideDir)

    // Case 1: dangling symlink pointing through a directory symlink
    const dirSymlink = join(workDir, 'dir_symlink')
    symlinkSync(outsideDir, dirSymlink)
    const link1 = join(workDir, 'link1')
    symlinkSync('dir_symlink/newfile.txt', link1)

    const walk1 = walkPermissionPaths(link1)
    expect(walk1.unresolved).toBe(false)
    expect(
      walk1.paths.some(
        p =>
          p === join(outsideDir, 'newfile.txt') ||
          p === join(realOutside, 'newfile.txt'),
      ),
    ).toBe(true)

    // Case 2: chained dangling symlinks (linkA -> linkB/sub/missing where linkB -> /outside/missing_parent)
    const linkB = join(workDir, 'linkB')
    symlinkSync(join(outsideDir, 'missing_parent'), linkB)
    const linkA = join(workDir, 'linkA')
    symlinkSync('linkB/sub/missing.txt', linkA)

    const walk2 = walkPermissionPaths(linkA)
    expect(walk2.unresolved).toBe(false)
    expect(
      walk2.paths.some(
        p =>
          p === join(outsideDir, 'missing_parent', 'sub', 'missing.txt') ||
          p === join(realOutside, 'missing_parent', 'sub', 'missing.txt'),
      ),
    ).toBe(true)
  })

  test('BH1-P0-5: unanalyzable Bash (!sem.ok, ERROR) and PowerShell (!parsed.valid) cannot bypass outsideReadsBlocked', async () => {
    const workDir = makeTempDir('r3-unanalyzable-')
    setOriginalCwd(workDir)
    const ctx = makePermissionContext({
      mode: 'bypassPermissions',
      isBypassPermissionsModeAvailable: true,
      blockReadsOutsideWorkingDirectories: true,
    })
    const toolUseCtx = makeToolUseContext(ctx)

    // Bash !sem.ok (`eval`, `source`) -> outsideReadsBlocked ask
    const evalRes = await bashToolHasPermission(
      { command: 'eval "cat /etc/passwd"' },
      toolUseCtx,
    )
    expect(evalRes.behavior).toBe('ask')
    expect(
      isOutsideReadsBlockedReason(
        evalRes.decisionReason as { type?: string; circuitBreaker?: string },
      ),
    ).toBe(true)

    // Bash syntax ERROR -> dangerousRemoval with also: ['outsideReadsBlocked']
    const errRes = buildUnparsedDangerousRmAsk('if then (', undefined, {
      alsoOutsideReadsBlocked: true,
    })
    expect(errRes.behavior).toBe('ask')
    expect(
      hasUnwaivableBypassImmuneSafetyCheck(errRes.decisionReason as never),
    ).toBe(true)
    expect(
      hasBypassImmuneNonClassifierAlsoBreaker(errRes.decisionReason as never),
    ).toBe(true)

    const substRes = await bashToolHasPermission(
      { command: 'echo $(cat /etc/passwd)' },
      toolUseCtx,
    )
    expect(substRes.behavior).toBe('ask')
    expect(
      isOutsideReadsBlockedReason(
        substRes.decisionReason as { type?: string; circuitBreaker?: string },
      ),
    ).toBe(true)
    expect(
      hasUnwaivableBypassImmuneSafetyCheck(substRes.decisionReason as never),
    ).toBe(true)

    // PowerShell !parsed.valid -> outsideReadsBlocked ask
    const psRes = await powershellToolHasPermission(
      { command: 'Get-Content "unclosed' },
      toolUseCtx,
    )
    expect(psRes.behavior).toBe('ask')
    expect(
      isOutsideReadsBlockedReason(
        psRes.decisionReason as { type?: string; circuitBreaker?: string },
      ),
    ).toBe(true)
  })

  test('BH1-P0-6: isSandboxFencingOutsideReads checks full criteria and prevents sandbox auto-allow bypass', async () => {
    const configDir = makeTempDir('r3-sb-cfg-')
    const workDir = makeTempDir('r3-sb-work-')
    const outsideDir = makeTempDir('r3-sb-outside-')
    const secretFile = join(outsideDir, 'secret.txt')
    writeFileSync(secretFile, 'secret')

    setEnv('CLAUDE_CONFIG_DIR', configDir)
    setAllowedSettingSources(['userSettings'])
    setOriginalCwd(workDir)

    const spyEnabled = spyOn(
      SandboxManager,
      'isSandboxingEnabled',
    ).mockReturnValue(true)
    const spyAutoAllow = spyOn(
      SandboxManager,
      'isAutoAllowBashIfSandboxedEnabled',
    ).mockReturnValue(true)

    try {
      // 1. Missing settings blockReadsOutsideWorkingDirectories -> NOT fencing
      writeFileSync(join(configDir, 'settings.json'), JSON.stringify({}))
      resetSettingsCache()
      expect(isSandboxFencingOutsideReads()).toBe(false)

      // 2. Settings has blockReadsOutsideWorkingDirectories: true -> fencing
      writeFileSync(
        join(configDir, 'settings.json'),
        JSON.stringify({
          permissions: { blockReadsOutsideWorkingDirectories: true },
        }),
      )
      resetSettingsCache()
      expect(isSandboxFencingOutsideReads()).toBe(true)

      // 3. filesystem.disabled: true -> NOT fencing
      writeFileSync(
        join(configDir, 'settings.json'),
        JSON.stringify({
          permissions: { blockReadsOutsideWorkingDirectories: true },
          sandbox: { filesystem: { disabled: true } },
        }),
      )
      resetSettingsCache()
      expect(isSandboxFencingOutsideReads()).toBe(false)

      // 4. allowManagedReadPathsOnly: true in userSettings MUST be ignored (only policySettings counts, matching official dG())
      writeFileSync(
        join(configDir, 'settings.json'),
        JSON.stringify({
          permissions: { blockReadsOutsideWorkingDirectories: true },
          sandbox: { filesystem: { allowManagedReadPathsOnly: true } },
        }),
      )
      resetSettingsCache()
      expect(isSandboxFencingOutsideReads()).toBe(true)

      // 5. Glob characters in originalCwd -> NOT fencing
      const globWorkDir = join(workDir, 'dir[1]')
      mkdirSync(globWorkDir)
      setOriginalCwd(globWorkDir)
      writeFileSync(
        join(configDir, 'settings.json'),
        JSON.stringify({
          permissions: { blockReadsOutsideWorkingDirectories: true },
        }),
      )
      resetSettingsCache()
      expect(isSandboxFencingOutsideReads()).toBe(false)

      // 6. Auto-allow MUST NOT bypass outside-reads block when sandbox is NOT fencing
      const permCtx = makePermissionContext({
        blockReadsOutsideWorkingDirectories: true,
      })
      const res = await bashToolHasPermission(
        { command: `cat ${secretFile}` },
        makeToolUseContext(permCtx),
      )
      expect(res.behavior).toBe('ask')
      expect(
        isOutsideReadsBlockedReason(
          res.decisionReason as { type?: string; circuitBreaker?: string },
        ),
      ).toBe(true)
    } finally {
      spyEnabled.mockRestore()
      spyAutoAllow.mockRestore()
    }
  })

  test('BH1-P1-1: unsafe env VAR=val behind command wrappers (time/nice/timeout) is caught', () => {
    const workDir = makeTempDir('r3-env-wrap-')
    setOriginalCwd(workDir)
    const ctx = makePermissionContext({
      blockReadsOutsideWorkingDirectories: true,
    })

    for (const argv of [
      ['time', 'env', 'LD_PRELOAD=/tmp/evil.so', 'ls'],
      ['nice', '-n', '5', 'env', 'PYTHONPATH=/tmp/evil', 'ls'],
      ['timeout', '5', 'env', 'FOO=bar', 'ls'],
      ['time', 'LD_PRELOAD=/tmp/evil.so', 'ls'],
    ]) {
      const res = checkBashArgvUnderOutsideReadsBlock(argv, workDir, ctx)
      expect(res?.behavior).toBe('ask')
      expect(
        isOutsideReadsBlockedReason(
          res?.decisionReason as { type?: string; circuitBreaker?: string },
        ),
      ).toBe(true)
    }

    // Safe env var behind wrapper stays allowed
    expect(
      checkBashArgvUnderOutsideReadsBlock(
        ['time', 'env', 'CI=1', 'ls'],
        workDir,
        ctx,
      ),
    ).toBeUndefined()
  })

  test('BH1-P1-2: outsideReads uses pathInOutsideReadFenceWorkingPath (ignores projectSettings additionalDirectories)', () => {
    const workDir = makeTempDir('r3-fence-cwd-')
    const untrustedExtraDir = makeTempDir('r3-fence-proj-')
    const trustedExtraDir = makeTempDir('r3-fence-user-')
    const untrustedFile = join(untrustedExtraDir, 'a.txt')
    const trustedFile = join(trustedExtraDir, 'b.txt')
    writeFileSync(untrustedFile, 'untrusted')
    writeFileSync(trustedFile, 'trusted')
    setOriginalCwd(workDir)

    const ctx = makePermissionContext({
      blockReadsOutsideWorkingDirectories: true,
      additionalWorkingDirectories: new Map([
        [
          untrustedExtraDir,
          { path: untrustedExtraDir, source: 'projectSettings' },
        ],
        [trustedExtraDir, { path: trustedExtraDir, source: 'userSettings' }],
      ]),
    })

    const resUntrusted = checkBashArgvUnderOutsideReadsBlock(
      ['cat', untrustedFile],
      workDir,
      ctx,
    )
    expect(resUntrusted?.behavior).toBe('ask')
    expect(
      isOutsideReadsBlockedReason(
        resUntrusted?.decisionReason as {
          type?: string
          circuitBreaker?: string
        },
      ),
    ).toBe(true)

    expect(
      checkBashArgvUnderOutsideReadsBlock(['cat', trustedFile], workDir, ctx),
    ).toBeUndefined()
  })

  test('BH1-P1-3: PROC_OR_DEV_MAGIC_LINK_RE normalizes /dev/./fd/0 and /proc/./self/root', () => {
    for (const p of [
      '/dev/./fd/0',
      '/proc/./self/root',
      '/proc/foo/../self/fd/3',
      '/dev/fd/./1',
    ]) {
      expect(isOpaqueSymlinkTarget(p)).toBe(true)
      expect(walkPermissionPaths(p).unresolved).toBe(true)
    }
  })

  test('BH1-P1-4: replacing tracked .git file with symlink or FIFO is caught by quarantineUnexpectedGitDirEntries', () => {
    const repoDir = makeTempDir('r3-git-quarantine-')
    const gitDir = join(repoDir, '.git')
    mkdirSync(join(gitDir, 'refs', 'heads'), { recursive: true })
    const headPath = join(gitDir, 'HEAD')
    const configPath = join(gitDir, 'config')
    const mainRefPath = join(gitDir, 'refs', 'heads', 'main')
    writeFileSync(headPath, 'ref: refs/heads/main\n')
    writeFileSync(configPath, '[core]\n\trepositoryformatversion = 0\n')
    writeFileSync(mainRefPath, '0123456789abcdef0123456789abcdef01234567\n')

    // 1. Replace tracked .git/HEAD with symlink & tracked .git/config with FIFO
    snapshotGitDirBeforeSandboxWrap(repoDir)
    unlinkSync(headPath)
    symlinkSync('/etc/passwd', headPath)
    unlinkSync(configPath)
    execFileSync('mkfifo', [configPath])

    const res1 = quarantineUnexpectedGitDirEntries(repoDir)
    expect(res1.removedSymlinks).toContain(headPath)
    expect(existsSync(headPath)).toBe(false)
    expect(res1.quarantined).toContain(configPath)
    expect(existsSync(configPath)).toBe(false)

    // 2. Legitimate regular-file update to .git/HEAD is NOT touched
    writeFileSync(headPath, 'ref: refs/heads/main\n')
    snapshotGitDirBeforeSandboxWrap(repoDir)
    writeFileSync(headPath, 'ref: refs/heads/feature\n')
    const res2 = quarantineUnexpectedGitDirEntries(repoDir)
    expect(res2.removedSymlinks).toEqual([])
    expect(res2.quarantined).toEqual([])
    expect(existsSync(headPath)).toBe(true)
  })

  test('BH1-P1-5: sortGrepContentLines keeps before-context lines containing :digits: in their file group', () => {
    const lines = ['b.ts:1:match-b', 'a.ts-1-time=12:34:56', 'a.ts:2:match-a']
    const sorted = sortGrepContentLines(lines, true)
    expect(sorted).toEqual([
      'a.ts-1-time=12:34:56',
      'a.ts:2:match-a',
      '--',
      'b.ts:1:match-b',
    ])
  })
})
