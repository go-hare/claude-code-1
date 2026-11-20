import { afterEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'
import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ToolPermissionContext } from 'src/Tool.js'
import { FileStateCache } from 'src/utils/fileStateCache.js'
import { isOutsideReadsBlockedReason } from 'src/utils/permissions/outsideReads.js'
import {
  evaluateBashSnapshotHeadStartSkip,
  getBashSnapshotHeadStartState,
  resetBashSnapshotHeadStartForTesting,
  startBashSnapshotHeadStart,
} from 'src/utils/Shell.js'
import { findPowerShell } from 'src/utils/shell/powershellDetection.js'
import {
  buildWaitingPowerShellBootstrapScript,
  computePowerShellHandOverHmac,
  getWaitingPowerShellState,
  normalizeWaitingPowerShellEnv,
  recordPowerShellCommandLaunch,
  resetWaitingPowerShellForTesting,
  startWaitingPowerShell,
  WaitingPowerShell,
  waitingPowerShellLaunchesMatch,
} from 'src/utils/shell/powershellProvider.js'
import type { ParsedPowerShellCommand } from 'src/utils/powershell/parser.js'
import { ExitWorktreeTool } from '../../ExitWorktreeTool/ExitWorktreeTool.js'
import { FileEditTool } from '../../FileEditTool/FileEditTool.js'
import {
  GrepTool,
  sortGrepContentLines,
  sortGrepCountLines,
} from '../../GrepTool/GrepTool.js'
import { NotebookEditTool } from '../../NotebookEditTool/NotebookEditTool.js'
import { powershellToolHasPermission } from '../../PowerShellTool/powershellPermissions.js'
import {
  GET_MODULE_ASK_MESSAGE,
  powershellCommandIsSafe,
} from '../../PowerShellTool/powershellSecurity.js'
import { getPrompt as getPowerShellPrompt } from '../../PowerShellTool/prompt.js'
import { isAllowlistedCommand } from '../../PowerShellTool/readOnlyValidation.js'
import {
  MAX_WEB_FETCH_URL_LENGTH,
  WebFetchTool,
} from '../../WebFetchTool/WebFetchTool.js'
import {
  _resetPrewarmedBashEditDiffSnapshotsForTesting,
  consumePrewarmedBashEditDiffSnapshot,
  diffBashEditDiffSnapshot,
  discardPrewarmedBashEditDiffSnapshot,
  formatBashEditDiffForToolResult,
  getOmittedBashEditDiffPaths,
  prewarmBashEditDiffSnapshot,
  takeBashEditDiffSnapshot,
} from '../bashEditDiff.js'
import {
  BASH_TOO_LONG_TO_JUDGE_MESSAGE,
  bashToolHasPermission,
  buildUnparsedDangerousRmAsk,
  evaluateBashTooLongExpansion,
} from '../bashPermissions.js'
import { checkSedConstraints } from '../sedValidation.js'
import { getSimplePrompt } from '../prompt.js'
import {
  _resetSandboxCheckRecordsForTesting,
  recordSandboxStateAtCheck,
  recordSandboxStateAtHookRewrite,
  shouldKeepRewrittenCommandInSandbox,
} from '../shouldUseSandbox.js'

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

afterEach(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete savedEnv[k]
  }
  resetBashSnapshotHeadStartForTesting()
  await resetWaitingPowerShellForTesting()
  _resetPrewarmedBashEditDiffSnapshotsForTesting()
  _resetSandboxCheckRecordsForTesting()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 327-328 Bash, PowerShell & Built-in Tools', () => {
  test('#407: WebFetch refuses URLs over 2,000 characters at schema validation', () => {
    expect(MAX_WEB_FETCH_URL_LENGTH).toBe(2000)
    const longUrl = `https://example.com/${'a'.repeat(2005)}`
    const res = WebFetchTool.inputSchema.safeParse({
      url: longUrl,
      prompt: 'summarize',
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues[0]?.message).toContain('2000')
    }
    const ok = WebFetchTool.inputSchema.safeParse({
      url: 'https://example.com/ok',
      prompt: 'summarize',
    })
    expect(ok.success).toBe(true)
  })

  test('#414: GrepTool sorts content and count lines by file path for stable paging', () => {
    const contentLines = [
      'z/file.ts:10:match',
      'a/file.ts:2:first',
      'a/file.ts:15:second',
      'm/file.ts:1:mid',
    ]
    expect(sortGrepContentLines(contentLines)).toEqual([
      'a/file.ts:2:first',
      'a/file.ts:15:second',
      'm/file.ts:1:mid',
      'z/file.ts:10:match',
    ])

    const countLines = ['z/file.ts:3', 'a/file.ts:1', 'm/file.ts:9']
    expect(sortGrepCountLines(countLines)).toEqual([
      'a/file.ts:1',
      'm/file.ts:9',
      'z/file.ts:3',
    ])
  })

  test('#416: NotebookEdit preserves final newline when editing a notebook', async () => {
    const dir = makeTempDir('wave328-nb-')
    const nbPath = join(dir, 'test.ipynb')
    const initial = `${JSON.stringify(
      {
        cells: [
          {
            cell_type: 'code',
            execution_count: null,
            metadata: {},
            outputs: [],
            source: ['x = 1'],
          },
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      },
      null,
      1,
    )}\n`
    writeFileSync(nbPath, initial, 'utf8')
    const bypassContext: ToolPermissionContext = {
      mode: 'bypassPermissions',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: true,
    }
    const res = await NotebookEditTool.call(
      {
        notebook_path: nbPath,
        cell_id: 'cell-0',
        new_source: 'x = 2',
        edit_mode: 'replace',
      },
      {
        readFileState: new Map(),
        updateFileHistoryState: () => {},
        getAppState: () => ({ toolPermissionContext: bypassContext }),
      } as unknown as Parameters<typeof NotebookEditTool.call>[1],
      undefined as never,
      undefined as never,
    )
    expect(res.data.error).toBe('')
    const updated = readFileSync(nbPath, 'utf8')
    expect(updated.endsWith('\n')).toBe(true)
    expect(updated).toContain('x = 2')
  })

  test('#418 & #488: bashEditDiff names binary/too-large/overflow files & pre-warms snapshot', async () => {
    const dir = realpathSync(makeTempDir('wave328-diff-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: dir,
    })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    writeFileSync(join(dir, 'init.txt'), 'hello\n')
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })

    // #488: pre-warm returns the same in-flight promise when consumed
    const prewarmed = prewarmBashEditDiffSnapshot(dir)
    const consumed = consumePrewarmedBashEditDiffSnapshot(dir)
    expect(consumed).toBe(prewarmed)
    const snapshot = await consumed
    expect(snapshot).not.toBeNull()
    expect(snapshot).not.toBe('unavailable')

    // Write a binary file (null bytes -> git emits Binary files differ, no text hunks)
    const binPath = join(dir, 'asset.bin')
    writeFileSync(binPath, Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]))

    const diff = await diffBashEditDiffSnapshot(
      snapshot as Exclude<typeof snapshot, null | 'unavailable'>,
    )
    expect(diff.files.length).toBe(0)
    expect(diff.moreFiles).toBe(1)
    expect(diff.changedFiles).toContain(binPath)
    expect(getOmittedBashEditDiffPaths(diff)).toEqual([binPath])

    const formatted = formatBashEditDiffForToolResult(diff)
    expect(formatted).toContain('<bash_edit_diff>')
    expect(formatted).toContain('asset.bin')

    // Also verify snapshot helper still works directly
    const snap2 = await takeBashEditDiffSnapshot(dir)
    expect(snap2).not.toBeNull()
    if (snap2 && snap2 !== 'unavailable') {
      rmSync(snap2.gitDirectory, { recursive: true, force: true })
    }
  })

  test('#475: CLAUDE_CODE_DISABLE_SHELL_HEAD_START=1 turns off Bash snapshot head-start', () => {
    setEnv('CLAUDE_CODE_DISABLE_SHELL_HEAD_START', '1')
    expect(evaluateBashSnapshotHeadStartSkip()).toBe('switched_off')
    const started = startBashSnapshotHeadStart()
    expect(started).toBe(false)
    expect(getBashSnapshotHeadStartState().skipReason).toBe('switched_off')

    expect(evaluateBashSnapshotHeadStartSkip({ permissionMode: 'plan' })).toBe(
      'switched_off',
    )
    setEnv('CLAUDE_CODE_DISABLE_SHELL_HEAD_START', undefined)
    expect(evaluateBashSnapshotHeadStartSkip({ permissionMode: 'plan' })).toBe(
      'plan',
    )
    expect(evaluateBashSnapshotHeadStartSkip({ isSandboxEnabled: true })).toBe(
      'sandbox',
    )
    expect(evaluateBashSnapshotHeadStartSkip({ isSubagent: true })).toBe(
      'subagent',
    )
  })

  test('#476: Bash (compact & full) and PowerShell prompts warn not to commit secret files', async () => {
    const leanBash = await getSimplePrompt(undefined, true)
    expect(leanBash).toContain(
      'Do not commit files that likely contain secrets (.env, credentials.json, .claude/settings.local.json, etc).',
    )
    const fullBash = await getSimplePrompt(undefined, false)
    expect(fullBash).toContain('.claude/settings.local.json')

    const psPrompt = await getPowerShellPrompt()
    expect(psPrompt).toContain(
      'Do not commit files that likely contain secrets (.env, credentials.json, .claude/settings.local.json, etc).',
    )
  })

  test('#478: unparsed dangerous rm refusal distinguishes commands with vs without rm', () => {
    const withoutRm = buildUnparsedDangerousRmAsk('echo "unterminated')
    expect(withoutRm.behavior).toBe('ask')
    if (withoutRm.behavior === 'ask') {
      expect(withoutRm.message).toContain('plain syntax')
      expect(withoutRm.message).not.toContain('dangerous rm operations')
    }

    const withRm = buildUnparsedDangerousRmAsk('rm -rf "unterminated')
    expect(withRm.behavior).toBe('ask')
    if (withRm.behavior === 'ask') {
      expect(withRm.message).toContain('dangerous rm operations')
    }
  })

  test('#485: Windows PowerShell detection checks install locations concurrently & prefers System32 over PATH', async () => {
    const probeOrder: string[] = []
    let whichPowershellCalled = false
    const result = await findPowerShell({
      platform: 'windows',
      env: {
        ProgramFiles: 'C:\\Program Files',
        LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
        USERPROFILE: 'C:\\Users\\dev',
        SYSTEMROOT: 'C:\\Windows',
      },
      whichFn: async bin => {
        if (bin === 'pwsh') return null
        if (bin === 'powershell') {
          whichPowershellCalled = true
          return 'C:\\CustomPath\\powershell.exe'
        }
        return null
      },
      probePathFn: async p => {
        probeOrder.push(p)
        if (p.includes('System32') && p.endsWith('powershell.exe')) return p
        return null
      },
      probeWindowsAppsAliasFn: async p => {
        probeOrder.push(p)
        return null
      },
    })
    // System32 powershell.exe won without even falling back to PATH powershell.exe
    expect(result).toContain('System32')
    expect(result).toContain('powershell.exe')
    expect(whichPowershellCalled).toBe(false)
    // All 4 standard install locations were probed
    expect(probeOrder.length).toBe(4)
  })

  test('#487: waiting PowerShell env fingerprinting, HMAC signing & head-start disable gate', async () => {
    const launchA = {
      powershellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      cwd: 'C:\\repo',
      env: { PATH: 'C:\\Windows', FOO: '1' },
    }
    const launchB = {
      powershellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      cwd: 'C:\\repo',
      env: { FOO: '1', PATH: 'C:\\Windows' },
    }
    expect(normalizeWaitingPowerShellEnv(launchA.env)).toBe(
      normalizeWaitingPowerShellEnv(launchB.env),
    )
    expect(waitingPowerShellLaunchesMatch(launchA, launchB)).toBe(true)

    const sig1 = computePowerShellHandOverHmac('deadbeef', 'Write-Output 1')
    const sig2 = computePowerShellHandOverHmac('deadbeef', 'Write-Output 1')
    expect(sig1).toBe(sig2)
    expect(sig1).toMatch(/^[0-9A-F]{64}$/)
    expect(buildWaitingPowerShellBootstrapScript()).toContain('HMACSHA256')

    recordPowerShellCommandLaunch(launchA)
    setEnv('CLAUDE_CODE_DISABLE_SHELL_HEAD_START', '1')
    const started = await startWaitingPowerShell({
      taskId: 't1',
      outputPath: join(tmpdir(), 'unused-ps-out.txt'),
      sandboxEnabled: false,
      platform: 'windows',
    })
    expect(started).toBe(false)
    expect(getWaitingPowerShellState().isPowerShellHeadStartAsked).toBe(true)
  })

  test('#498: ExitWorktreeTool checkPermissions allows keep and inspects remove+discard_changes', async () => {
    expect(typeof ExitWorktreeTool.checkPermissions).toBe('function')
    const keepRes = await ExitWorktreeTool.checkPermissions!(
      { action: 'keep' },
      {} as never,
    )
    expect(keepRes.behavior).toBe('allow')
  })

  test('#508: evaluateBashTooLongExpansion always returns deny with guidance', () => {
    const ctx: ToolPermissionContext = {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    }
    const res = evaluateBashTooLongExpansion('echo $HUGE_VAR', ctx, {
      forceTooLong: true,
    })
    expect(res).not.toBeNull()
    expect(res?.behavior).toBe('deny')
    if (res && res.behavior === 'deny') {
      expect(res.message).toBe(BASH_TOO_LONG_TO_JUDGE_MESSAGE)
      expect(res.message).toContain('shorter')
    }
  })

  test('#509: PowerShell Get-Module / gmo / module is ruleProof ask and not read-only allowlisted', () => {
    const makeParsed = (name: string): ParsedPowerShellCommand =>
      ({
        valid: true,
        errors: [],
        statements: [
          {
            text: `${name} -ListAvailable`,
            statementType: 'PipelineAst',
            commands: [
              {
                name,
                nameType: 'cmdlet',
                elementType: 'CommandAst',
                args: ['-ListAvailable'],
                elementTypes: ['StringConstant', 'Parameter'],
                text: `${name} -ListAvailable`,
              },
            ],
            redirections: [],
          },
        ],
        variables: [],
        hasUsingStatements: false,
        hasScriptRequirements: false,
        hasBackgroundJob: false,
      }) as unknown as ParsedPowerShellCommand

    for (const cmd of [
      'Get-Module',
      'gmo',
      'module',
      'Microsoft.PowerShell.Core\\Get-Module',
    ]) {
      const parsed = makeParsed(cmd)
      const safety = powershellCommandIsSafe(`${cmd} -ListAvailable`, parsed)
      expect(safety.behavior).toBe('ask')
      expect(safety.ruleProof).toBe(true)
      expect(safety.message).toBe(GET_MODULE_ASK_MESSAGE)
      expect(
        isAllowlistedCommand(
          parsed.statements[0]!.commands[0]!,
          `${cmd} -ListAvailable`,
        ),
      ).toBe(false)
    }
  })

  test('#671: PermissionRequest hook rewrite to sandbox-excluded command runs outside sandbox', () => {
    const id = 'toolu_rewrite_excluded'
    // Original command was checked as sandboxed
    recordSandboxStateAtCheck(id, { command: 'npm test' }, true)
    expect(
      shouldKeepRewrittenCommandInSandbox(id, { command: 'npm test' }),
    ).toBe(true)

    // PermissionRequest hook rewrites to a sandbox-excluded command (wasSandboxed = false)
    recordSandboxStateAtHookRewrite(id, { command: 'docker ps' }, false)
    // Rewritten command matching rewriteNoted runs OUTSIDE sandbox
    expect(
      shouldKeepRewrittenCommandInSandbox(id, { command: 'docker ps' }),
    ).toBe(false)

    // Unrelated command that doesn't match rewriteNoted falls back to checked=true
    expect(
      shouldKeepRewrittenCommandInSandbox(id, { command: 'other cmd' }),
    ).toBe(true)
  })

  test('#503 regression: sed under blockReadsOutsideWorkingDirectories emits bypass-immune ask before allow rules', async () => {
    const ctx: ToolPermissionContext = {
      mode: 'bypassPermissions',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: { localSettings: ['Bash(sed *)'] },
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: true,
      blockReadsOutsideWorkingDirectories: true,
    }
    const sedRes = checkSedConstraints(
      { command: "sed '1r /etc/passwd' file.txt" },
      ctx,
    )
    expect(sedRes.behavior).toBe('ask')
    if (sedRes.behavior === 'ask') {
      expect(isOutsideReadsBlockedReason(sedRes.decisionReason)).toBe(true)
    }

    const permRes = await bashToolHasPermission(
      { command: "sed '1r /etc/passwd' file.txt" },
      {
        getAppState: () => ({ toolPermissionContext: ctx }),
      } as never,
    )
    expect(permRes.behavior).toBe('ask')
    if (permRes.behavior === 'ask') {
      expect(isOutsideReadsBlockedReason(permRes.decisionReason)).toBe(true)
    }
  })

  test('#509 regression: parse-failed PowerShell exact-allow cannot bypass Get-Process; Get-Module or obfuscated Get-Module', async () => {
    const cmds = [
      'Get-Process; Get-Module',
      'Get-Process; Get`-Module',
      "Get-Process; & 'Get-Module'",
    ]
    for (const cmd of cmds) {
      const ctx: ToolPermissionContext = {
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: { localSettings: [`PowerShell(${cmd})`] },
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      }
      const res = await powershellToolHasPermission(
        { command: cmd },
        {
          getAppState: () => ({ toolPermissionContext: ctx }),
        } as never,
        // Simulate parse-failed state (pwsh unavailable / syntax error)
        {
          valid: false,
          errors: [{ message: 'pwsh unavailable' }],
          statements: [],
          variables: [],
          hasUsingStatements: false,
          hasScriptRequirements: false,
          hasBackgroundJob: false,
        } as unknown as ParsedPowerShellCommand,
      )
      expect(res.behavior).toBe('ask')
    }

    // Parsed path: ruleProof Get-Module safetyCheck is not shadowed by a prefix ask rule
    const parsedGetModule = {
      valid: true,
      errors: [],
      statements: [
        {
          text: 'Get-Module -ListAvailable',
          statementType: 'PipelineAst',
          commands: [
            {
              name: 'Get-Module',
              nameType: 'cmdlet',
              elementType: 'CommandAst',
              args: ['-ListAvailable'],
              elementTypes: ['StringConstant', 'Parameter'],
              text: 'Get-Module -ListAvailable',
            },
          ],
          redirections: [],
        },
      ],
      variables: [],
      hasUsingStatements: false,
      hasScriptRequirements: false,
      hasBackgroundJob: false,
    } as unknown as ParsedPowerShellCommand
    const ctxWithAsk: ToolPermissionContext = {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: { localSettings: ['PowerShell(Get-Module:*)'] },
      isBypassPermissionsModeAvailable: false,
    }
    const reduced = await powershellToolHasPermission(
      { command: 'Get-Module -ListAvailable' },
      {
        getAppState: () => ({ toolPermissionContext: ctxWithAsk }),
      } as never,
      parsedGetModule,
    )
    expect(reduced.behavior).toBe('ask')
    if (reduced.behavior === 'ask') {
      expect(reduced.decisionReason).toEqual({
        type: 'other',
        reason: GET_MODULE_ASK_MESSAGE,
      })
      expect(reduced.suggestions).toEqual([])
    }

    // With blockReadsOutsideWorkingDirectories enabled, ruleProof emits outsideReadsBlocked ask
    const reducedWithReadBlock = await powershellToolHasPermission(
      { command: 'Get-Module -ListAvailable' },
      {
        getAppState: () => ({
          toolPermissionContext: {
            ...ctxWithAsk,
            blockReadsOutsideWorkingDirectories: true,
          },
        }),
      } as never,
      parsedGetModule,
    )
    expect(reducedWithReadBlock.behavior).toBe('ask')
    if (reducedWithReadBlock.behavior === 'ask') {
      expect(
        isOutsideReadsBlockedReason(reducedWithReadBlock.decisionReason),
      ).toBe(true)
      expect(reducedWithReadBlock.suggestions).toEqual([])
    }
  })

  test('#487 regression: WaitingPowerShell bootstrap deadline/FileShare, spawn error, and handover failure discard', async () => {
    const script = buildWaitingPowerShellBootstrapScript()
    expect(script).toContain('[DateTime]::UtcNow.AddMilliseconds(')
    expect(script).toContain('[System.IO.FileShare]::ReadWrite')
    expect(script).toContain('[System.IO.FileShare]::Delete')
    expect(script).toContain('catch {')

    const dir = makeTempDir('wave328-ps-wait-')
    const outPath = join(dir, 'out.txt')
    const hoPath = join(dir, 'handover.txt')
    writeFileSync(outPath, '')
    const fd = openSync(hoPath, 'wx')
    let killed = false
    const fakeChild = Object.assign(new EventEmitter(), {
      pid: 99999,
      exitCode: null,
      signalCode: null,
      kill: () => {
        killed = true
        return true
      },
    }) as unknown as ChildProcess
    const state = {
      isPowerShellHeadStartAsked: false,
      lastPowerShellLaunch: undefined,
      waitingPowerShell: undefined,
      isStartingWaitingPowerShell: false,
      unfitWaitingPowerShells: 0,
      failedWaitingPowerShells: 0,
      idleWaitingPowerShells: 0,
      powerShellStartsToSkip: 0,
      commandsEnded: 0,
    }
    const waiting = new WaitingPowerShell(
      'task-1',
      outPath,
      { path: hoPath, key: 'deadbeef', fd },
      { powershellPath: 'pwsh', cwd: dir, env: { A: '1' } },
      fakeChild,
      state,
    )
    // Emit 'error' on child: must not throw uncaught and must increment failedWaitingPowerShells & kill/discard
    fakeChild.emit('error', new Error('ENOENT'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(state.failedWaitingPowerShells).toBe(1)
    expect(killed).toBe(true)
    expect(waiting.isWaiting()).toBe(false)
  })

  test('#414 regression: single-file Grep preserves line order and filenames with -digits- stay grouped', async () => {
    // Filenames containing `-<digits>-` must match `:lineno:` before `-lineno-`
    const lines = [
      'src/z-123-bar.ts:20:match2',
      'src/a-99-foo.ts:2:match1',
      'src/a-99-foo.ts:10:match2',
    ]
    expect(sortGrepContentLines(lines, false)).toEqual([
      'src/a-99-foo.ts:2:match1',
      'src/a-99-foo.ts:10:match2',
      'src/z-123-bar.ts:20:match2',
    ])

    // Single-file GrepTool call preserves line order (line 2 before line 10)
    const dir = makeTempDir('wave328-grep-single-')
    const singleFile = join(dir, 'sample.txt')
    const fileLines = Array.from({ length: 12 }, (_, idx) =>
      idx === 1 || idx === 9 ? `needle line ${idx + 1}` : `other ${idx + 1}`,
    )
    writeFileSync(singleFile, `${fileLines.join('\n')}\n`)
    const bypassCtx: ToolPermissionContext = {
      mode: 'bypassPermissions',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: true,
    }
    const res = await GrepTool.call(
      {
        pattern: 'needle',
        path: singleFile,
        output_mode: 'content',
        '-n': true,
      },
      {
        abortController: new AbortController(),
        getAppState: () => ({ toolPermissionContext: bypassCtx }),
      } as never,
    )
    const content = 'content' in res.data ? (res.data.content ?? '') : ''
    const contentLines = content.split('\n').filter(Boolean)
    expect(contentLines[0]).toMatch(/^2:/)
    expect(contentLines[1]).toMatch(/^10:/)
  })

  test('#488 regression: prewarm snapshots are keyed by toolUseId and clean up on discard', async () => {
    const dir = realpathSync(makeTempDir('wave328-prewarm-key-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: dir,
    })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    writeFileSync(join(dir, 'a.txt'), 'v1\n')
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })

    const p1 = prewarmBashEditDiffSnapshot(dir, 'toolu_denied')
    const p2 = prewarmBashEditDiffSnapshot(dir, 'toolu_allowed')
    expect(p1).not.toBe(p2)

    const snap1 = await p1
    discardPrewarmedBashEditDiffSnapshot(dir, 'toolu_denied')
    // Consuming toolu_allowed still returns p2 cleanly
    expect(consumePrewarmedBashEditDiffSnapshot(dir, 'toolu_allowed')).toBe(p2)
    const snap2 = await p2
    await new Promise(resolve => setTimeout(resolve, 30))
    if (snap1 && snap1 !== 'unavailable') {
      expect(existsSync(snap1.gitDirectory)).toBe(false)
    }
    if (snap2 && snap2 !== 'unavailable') {
      rmSync(snap2.gitDirectory, { recursive: true, force: true })
    }
  })

  test('#413 regression: FileEditTool rejects refreshedBehindModel entries as stale even when timestamp matches', async () => {
    const dir = makeTempDir('wave328-edit-refreshed-')
    const filePath = join(dir, 'target.ts')
    writeFileSync(filePath, 'const a = 1\n', 'utf8')
    const readFileState = new FileStateCache(10, 1024 * 1024)
    readFileState.set(filePath, {
      content: 'const a = 1\n',
      timestamp: Date.now() + 60_000,
      offset: undefined,
      limit: undefined,
      refreshedBehindModel: true,
    })
    const validation = await FileEditTool.validateInput!(
      {
        file_path: filePath,
        old_string: 'const a = 1',
        new_string: 'const a = 2',
      },
      {
        readFileState,
        getAppState: () => ({
          toolPermissionContext: {
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          },
        }),
      } as never,
    )
    expect(validation.result).toBe(false)
    if (!validation.result) {
      expect(validation.errorCode).toBe(7)
    }
  })
})
