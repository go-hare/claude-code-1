;(globalThis as { MACRO?: { VERSION: string } }).MACRO ??= {
  VERSION: '2.1.328',
}

import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { bashToolHasPermission } from '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js'
import { SUPPORTED_PATH_COMMANDS } from '@claude-code/builtin-tools/tools/BashTool/pathValidation.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import {
  GrepTool,
  sortGrepContentLines,
} from '@claude-code/builtin-tools/tools/GrepTool/GrepTool.js'
import {
  getOriginalCwd,
  registerHookCallbacks,
  resetSdkInitState,
  setOriginalCwd,
} from '../../../bootstrap/state.js'
import { executePermissionRequestHooksForSDK } from '../../../cli/structuredIO.js'
import type {
  Tool,
  ToolPermissionContext,
  ToolUseContext,
} from '../../../Tool.js'
import {
  canSandboxFenceOutsideReads,
  isGitRefBearingPath,
  isSandboxFencingOutsideReads,
  quarantineUnexpectedGitDirEntries,
  SandboxManager,
  snapshotGitDirBeforeSandboxWrap,
} from '../../sandbox/sandbox-adapter.js'
import * as settingsModule from '../../settings/settings.js'
import { resetSettingsCache } from '../../settings/settingsCache.js'
import {
  checkBashArgvUnderOutsideReadsBlock,
  isOutsideReadsBlockedReason,
  isStdinCodeInterpreterArgv,
} from '../outsideReads.js'

const tempDirs: string[] = []
const originalCwdBackup = getOriginalCwd()
const originalEvalConfined = process.env.CLAUDE_CODE_EVAL_CONFINED
const originalEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

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

function makeToolUseContext(
  permCtx: ToolPermissionContext,
  abortController = new AbortController(),
): ToolUseContext {
  let state = { toolPermissionContext: permCtx, sessionHooks: new Map() }
  return {
    abortController,
    getAppState: () => state as ReturnType<ToolUseContext['getAppState']>,
    setAppState: updater => {
      state = updater(
        state as ReturnType<ToolUseContext['getAppState']>,
      ) as typeof state
    },
    options: {
      isNonInteractiveSession: true,
      tools: [],
    } as unknown as ToolUseContext['options'],
  } as ToolUseContext
}

afterEach(() => {
  setOriginalCwd(originalCwdBackup)
  if (originalEvalConfined === undefined) {
    delete process.env.CLAUDE_CODE_EVAL_CONFINED
  } else {
    process.env.CLAUDE_CODE_EVAL_CONFINED = originalEvalConfined
  }
  if (originalEntrypoint === undefined) {
    delete process.env.CLAUDE_CODE_ENTRYPOINT
  } else {
    process.env.CLAUDE_CODE_ENTRYPOINT = originalEntrypoint
  }
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  resetSdkInitState()
  resetSettingsCache()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
})

describe('Fresh Fix 3 (Security / Perms / Sandbox / Bash / GrepTool / StructuredIO)', () => {
  test('C-P0-1: SUPPORTED_PATH_COMMANDS exported and passed so cd/ls/rg/grep are not falsely blocked under outsideReadsBlocked', async () => {
    expect(SUPPORTED_PATH_COMMANDS.has('cd')).toBe(true)
    expect(SUPPORTED_PATH_COMMANDS.has('ls')).toBe(true)
    expect(SUPPORTED_PATH_COMMANDS.has('rg')).toBe(true)
    expect(SUPPORTED_PATH_COMMANDS.has('grep')).toBe(true)
    expect(SUPPORTED_PATH_COMMANDS.has('cat')).toBe(true)

    const ctx = makePermissionContext({
      blockReadsOutsideWorkingDirectories: true,
    })

    // Both bare name and full path match knownPathHandledCommands
    expect(
      checkBashArgvUnderOutsideReadsBlock(['rg', 'a**b'], process.cwd(), ctx, {
        knownPathHandledCommands: SUPPORTED_PATH_COMMANDS,
      }),
    ).toBeUndefined()
    expect(
      checkBashArgvUnderOutsideReadsBlock(
        ['/usr/bin/grep', '-rn', '$foo', 'src/'],
        process.cwd(),
        ctx,
        {
          knownPathHandledCommands: SUPPORTED_PATH_COMMANDS,
        },
      ),
    ).toBeUndefined()

    const toolCtx = makeToolUseContext(ctx)
    const cdLs = await bashToolHasPermission(
      { command: 'cd src && ls -la' },
      toolCtx,
    )
    expect(cdLs.behavior).toBe('allow')

    const rgGlob = await bashToolHasPermission(
      { command: "rg 'a**b'" },
      toolCtx,
    )
    expect(rgGlob.behavior).toBe('allow')

    const grepDollar = await bashToolHasPermission(
      { command: "grep -rn '$foo' src/" },
      toolCtx,
    )
    expect(
      isOutsideReadsBlockedReason(
        grepDollar.decisionReason as { type?: string; circuitBreaker?: string },
      ),
    ).toBe(false)
  })

  test('C-P0-2: node/python3/bun --version are not blocked, while python3 heredoc/here-string/pipe stdin is blocked with outsideReadsBlocked', async () => {
    const ctx = makePermissionContext({
      blockReadsOutsideWorkingDirectories: true,
    })
    const toolCtx = makeToolUseContext(ctx)

    // Flag-only interpreters without stdin supply are NOT blocked
    for (const cmd of [
      'node --version',
      'python3 --version',
      'bun --version',
    ]) {
      const res = await bashToolHasPermission({ command: cmd }, toolCtx)
      expect(
        isOutsideReadsBlockedReason(
          res.decisionReason as { type?: string; circuitBreaker?: string },
        ),
      ).toBe(false)
      expect(res.behavior === 'allow' || res.behavior === 'passthrough').toBe(
        true,
      )
    }

    // isStdinCodeInterpreterArgv matches official UYr
    expect(isStdinCodeInterpreterArgv(['python3'])).toBe(true)
    expect(isStdinCodeInterpreterArgv(['python3', '-u'])).toBe(true)
    expect(isStdinCodeInterpreterArgv(['python3', '-'])).toBe(true)
    expect(isStdinCodeInterpreterArgv(['python3', 'script.py'])).toBe(false)
    expect(isStdinCodeInterpreterArgv(['cat'])).toBe(false)

    // Heredoc, here-string, piped stdin, and explicit `-` MUST ask with outsideReadsBlocked
    for (const cmd of [
      'python3 <<EOF\nprint(1)\nEOF',
      "python3 <<< 'print(1)'",
      "echo 'print(1)' | python3",
      'python3 -',
    ]) {
      const res = await bashToolHasPermission({ command: cmd }, toolCtx)
      expect(res.behavior).toBe('ask')
      expect(
        isOutsideReadsBlockedReason(
          res.decisionReason as { type?: string; circuitBreaker?: string },
        ),
      ).toBe(true)
    }
  })

  test('C-P0-3: quarantineUnexpectedGitDirEntries preserves .git/COMMIT_EDITMSG starting with ref: and quarantines overwritten FETCH_HEAD/ORIG_HEAD/MERGE_HEAD/AUTO_MERGE', () => {
    expect(isGitRefBearingPath('HEAD')).toBe(true)
    expect(isGitRefBearingPath('FETCH_HEAD')).toBe(true)
    expect(isGitRefBearingPath('ORIG_HEAD')).toBe(true)
    expect(isGitRefBearingPath('MERGE_HEAD')).toBe(true)
    expect(isGitRefBearingPath('AUTO_MERGE')).toBe(true)
    expect(isGitRefBearingPath('refs/heads/main')).toBe(true)
    expect(isGitRefBearingPath('modules/sub/HEAD')).toBe(true)
    expect(isGitRefBearingPath('modules/sub/refs/heads/main')).toBe(true)
    expect(isGitRefBearingPath('worktrees/wt1/HEAD')).toBe(true)
    expect(isGitRefBearingPath('worktrees/wt1/refs/heads/main')).toBe(true)

    expect(isGitRefBearingPath('COMMIT_EDITMSG')).toBe(false)
    expect(isGitRefBearingPath('MERGE_MSG')).toBe(false)
    expect(isGitRefBearingPath('SQUASH_MSG')).toBe(false)
    expect(isGitRefBearingPath('TAG_EDITMSG')).toBe(false)
    expect(isGitRefBearingPath('description')).toBe(false)
    expect(isGitRefBearingPath('index')).toBe(false)
    expect(isGitRefBearingPath('logs/HEAD')).toBe(false)
    expect(isGitRefBearingPath('logs/refs/heads/main')).toBe(false)

    const repo = makeTempDir('ff3-git-quarantine-')
    mkdirSync(join(repo, '.git', 'refs', 'heads'), { recursive: true })
    mkdirSync(join(repo, '.git', 'logs'), { recursive: true })
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(join(repo, '.git', 'FETCH_HEAD'), 'deadbeef\tbranch main\n')
    writeFileSync(join(repo, '.git', 'ORIG_HEAD'), 'deadbeef\n')
    writeFileSync(join(repo, '.git', 'MERGE_HEAD'), 'deadbeef\n')
    writeFileSync(join(repo, '.git', 'AUTO_MERGE'), 'deadbeef\n')
    writeFileSync(join(repo, '.git', 'logs', 'HEAD'), 'ref: ../config\n')

    snapshotGitDirBeforeSandboxWrap(repo)

    // Non-ref files starting with `ref:` MUST NOT be quarantined
    writeFileSync(join(repo, '.git', 'COMMIT_EDITMSG'), 'ref: ../config\n')
    writeFileSync(join(repo, '.git', 'MERGE_MSG'), 'ref: ../evil\n')
    // Pre-existing ref-bearing files overwritten with escaping `ref:` MUST be quarantined
    writeFileSync(join(repo, '.git', 'FETCH_HEAD'), 'ref: ../config\n')
    writeFileSync(join(repo, '.git', 'ORIG_HEAD'), 'ref: ../config\n')
    writeFileSync(join(repo, '.git', 'MERGE_HEAD'), 'ref: ../config\n')
    writeFileSync(join(repo, '.git', 'AUTO_MERGE'), 'ref: ../config\n')

    const result = quarantineUnexpectedGitDirEntries(repo)
    expect(existsSync(join(repo, '.git', 'COMMIT_EDITMSG'))).toBe(true)
    expect(existsSync(join(repo, '.git', 'MERGE_MSG'))).toBe(true)
    expect(existsSync(join(repo, '.git', 'logs', 'HEAD'))).toBe(true)

    expect(existsSync(join(repo, '.git', 'FETCH_HEAD'))).toBe(false)
    expect(existsSync(join(repo, '.git', 'ORIG_HEAD'))).toBe(false)
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
    expect(existsSync(join(repo, '.git', 'AUTO_MERGE'))).toBe(false)
    expect(result.quarantined.length).toBe(4)
  })

  test('C-P1-1: sortGrepContentLines and GrepTool handle -n:false context, -<digits>- filenames, and context lines with colons', async () => {
    expect(
      sortGrepContentLines(
        ['b.ts-before', 'b.ts:match', '--', 'a.ts-before', 'a.ts:match'],
        true,
      ),
    ).toEqual(['a.ts-before', 'a.ts:match', '--', 'b.ts-before', 'b.ts:match'])

    expect(
      sortGrepContentLines(
        ['foo-1-bar.ts:10:hello', 'foo-2-baz.ts:5:world', 'a.ts:1:x'],
        true,
      ),
    ).toEqual([
      'a.ts:1:x',
      '--',
      'foo-1-bar.ts:10:hello',
      '--',
      'foo-2-baz.ts:5:world',
    ])

    expect(
      sortGrepContentLines(['b.ts-1-time=12:34:56', 'b.ts:2:match'], true),
    ).toEqual(['b.ts-1-time=12:34:56', 'b.ts:2:match'])

    // End-to-end GrepTool with `--null` + `-n: false` + `-C: 1`
    const dir = makeTempDir('ff3-grep-tool-')
    writeFileSync(join(dir, 'b.ts'), 'before_b\nmatch_b\nafter_b\n')
    writeFileSync(join(dir, 'a.ts'), 'time=12:34:56\nmatch_a\nafter_a\n')
    writeFileSync(join(dir, 'foo-1-bar.ts'), 'ctx1\nmatch_foo\nctx2\n')

    const res = await GrepTool.call(
      {
        pattern: 'match_',
        path: dir,
        output_mode: 'content',
        '-n': false,
        '-C': 1,
      },
      makeToolUseContext(makePermissionContext()),
    )
    expect(res.data.mode).toBe('content')
    const lines =
      res.data.mode === 'content' ? res.data.content.split('\n') : []
    expect(lines.length).toBe(11)
    expect(lines[0]).toEndWith('a.ts-time=12:34:56')
    expect(lines[1]).toEndWith('a.ts:match_a')
    expect(lines[2]).toEndWith('a.ts-after_a')
    expect(lines[3]).toBe('--')
    expect(lines[4]).toEndWith('b.ts-before_b')
    expect(lines[5]).toEndWith('b.ts:match_b')
    expect(lines[6]).toEndWith('b.ts-after_b')
    expect(lines[7]).toBe('--')
    expect(lines[8]).toEndWith('foo-1-bar.ts-ctx1')
    expect(lines[9]).toEndWith('foo-1-bar.ts:match_foo')
    expect(lines[10]).toEndWith('foo-1-bar.ts-ctx2')
  })

  test('C-P1-2 + C-P2-2: git safe patterns pass, git outside reads stay blocked, and unsafe env path values are rejected', () => {
    const workDir = makeTempDir('ff3-git-work-')
    const outsideDir = makeTempDir('ff3-git-out-')
    const secret = join(outsideDir, 'secret.txt')
    writeFileSync(secret, 'secret')
    setOriginalCwd(workDir)

    const ctx = makePermissionContext({
      blockReadsOutsideWorkingDirectories: true,
    })

    // Safe git invocations must pass
    expect(
      checkBashArgvUnderOutsideReadsBlock(
        ['git', 'diff', '--', '**/*.ts'],
        workDir,
        ctx,
      ),
    ).toBeUndefined()
    expect(
      checkBashArgvUnderOutsideReadsBlock(
        ['git', 'log', '--grep=$foo'],
        workDir,
        ctx,
      ),
    ).toBeUndefined()
    expect(
      checkBashArgvUnderOutsideReadsBlock(
        ['git', 'commit', '-m', 'cost $10'],
        workDir,
        ctx,
      ),
    ).toBeUndefined()
    expect(
      checkBashArgvUnderOutsideReadsBlock(['git', 'status'], workDir, ctx, {
        hasCdInCompound: true,
      }),
    ).toBeUndefined()

    // Attacks must remain blocked
    for (const argv of [
      ['git', 'grep', '--no-index', 'root', secret],
      ['git', 'diff', '--no-index', secret, join(workDir, 'x')],
      ['git', 'log', '--', secret],
      ['git', '-C', outsideDir, 'status'],
      ['git', '-c', 'core.fsmonitor=evil', 'status'],
      ['DEBUG=/etc/passwd', 'ls'],
      ['env', 'DEBUG=/etc/passwd', 'ls'],
      ['env', 'TERM=../../foo', 'ls'],
      ['TERM=~/secret', 'ls'],
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

    // Safe non-path env assignments remain allowed
    expect(
      checkBashArgvUnderOutsideReadsBlock(
        ['env', 'NODE_ENV=test', 'TZ=America/New_York', 'ls'],
        workDir,
        ctx,
        { knownPathHandledCommands: SUPPORTED_PATH_COMMANDS },
      ),
    ).toBeUndefined()
  })

  test('C-P1-3: executePermissionRequestHooksForSDK mirrors isEvalConfined, isCoworkCloudAutoHookAllowBlocked, decision.interrupt abort, and decisionReason.reason', async () => {
    const fakeBashTool = { name: BASH_TOOL_NAME } as unknown as Tool

    // 1. isEvalConfined ignores PermissionRequest allow
    process.env.CLAUDE_CODE_EVAL_CONFINED = '1'
    registerHookCallbacks({
      PermissionRequest: [
        {
          hooks: [
            {
              type: 'callback',
              callback: async () => ({
                hookSpecificOutput: {
                  hookEventName: 'PermissionRequest',
                  decision: { behavior: 'allow' },
                },
              }),
            },
          ],
        },
      ],
    })
    const confinedRes = await executePermissionRequestHooksForSDK(
      BASH_TOOL_NAME,
      'tu-ff3-confined',
      { command: 'echo hi' },
      makeToolUseContext(makePermissionContext()),
      undefined,
      fakeBashTool,
    )
    expect(confinedRes).toBeUndefined()
    delete process.env.CLAUDE_CODE_EVAL_CONFINED

    // 2. Cowork cloud auto mode ignores PermissionRequest allow for Bash
    process.env.CLAUDE_CODE_ENTRYPOINT = 'remote_cowork'
    const coworkRes = await executePermissionRequestHooksForSDK(
      BASH_TOOL_NAME,
      'tu-ff3-cowork',
      { command: 'echo hi' },
      makeToolUseContext(makePermissionContext({ mode: 'auto' })),
      undefined,
      fakeBashTool,
    )
    expect(coworkRes).toBeUndefined()
    delete process.env.CLAUDE_CODE_ENTRYPOINT

    // 3. decision.behavior === 'deny' with interrupt aborts controller and sets reason
    resetSdkInitState()
    const ac = new AbortController()
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
                    behavior: 'deny',
                    message: 'Blocked by security policy',
                    interrupt: true,
                  },
                },
              }),
            },
          ],
        },
      ],
    })
    const denyRes = await executePermissionRequestHooksForSDK(
      BASH_TOOL_NAME,
      'tu-ff3-deny-interrupt',
      { command: 'echo hi' },
      makeToolUseContext(makePermissionContext(), ac),
      undefined,
      fakeBashTool,
    )
    expect(ac.signal.aborted).toBe(true)
    expect(denyRes?.behavior).toBe('deny')
    if (denyRes?.behavior === 'deny') {
      expect(denyRes.message).toBe('Blocked by security policy')
      expect(denyRes.decisionReason).toEqual({
        type: 'hook',
        hookName: 'PermissionRequest',
        reason: 'Blocked by security policy',
      })
    }
  })

  test('C-P1-4: allowManagedReadPathsOnly checks policySettings ONLY and canSandboxFenceOutsideReads splits capability from setting state', () => {
    const workDir = makeTempDir('ff3-sbx-work-')
    const configDir = makeTempDir('ff3-sbx-cfg-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    setOriginalCwd(workDir)

    const spyEnabled = spyOn(
      SandboxManager,
      'isSandboxingEnabled',
    ).mockReturnValue(true)

    try {
      // Setting blockReadsOutsideWorkingDirectories is OFF:
      // canSandboxFenceOutsideReads() is true (UI can explain sandbox will fence),
      // while isSandboxFencingOutsideReads() is false (not currently fencing).
      writeFileSync(join(configDir, 'settings.json'), JSON.stringify({}))
      resetSettingsCache()
      expect(canSandboxFenceOutsideReads()).toBe(true)
      expect(isSandboxFencingOutsideReads()).toBe(false)

      // userSettings allowManagedReadPathsOnly MUST be ignored
      writeFileSync(
        join(configDir, 'settings.json'),
        JSON.stringify({
          permissions: { blockReadsOutsideWorkingDirectories: true },
          sandbox: { filesystem: { allowManagedReadPathsOnly: true } },
        }),
      )
      resetSettingsCache()
      expect(canSandboxFenceOutsideReads()).toBe(true)
      expect(isSandboxFencingOutsideReads()).toBe(true)

      // policySettings allowManagedReadPathsOnly MUST disable fencing
      const spySettings = spyOn(
        settingsModule,
        'getSettingsForSource',
      ).mockImplementation(source => {
        if (source === 'policySettings') {
          return {
            sandbox: { filesystem: { allowManagedReadPathsOnly: true } },
          }
        }
        return {
          permissions: { blockReadsOutsideWorkingDirectories: true },
        }
      })
      try {
        expect(canSandboxFenceOutsideReads()).toBe(false)
        expect(isSandboxFencingOutsideReads()).toBe(false)
      } finally {
        spySettings.mockRestore()
      }
    } finally {
      spyEnabled.mockRestore()
    }
  })
})
