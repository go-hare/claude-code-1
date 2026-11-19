import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
;(globalThis as Record<string, unknown>).MACRO ??= { VERSION: '2.1.326' }
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js'
import { isSearchOrReadBashCommand } from '../BashTool.js'
import {
  checkPathConstraints,
  cpSourceTargetsDestContents,
  findSignInFilesReachedByPaths,
  hasCpMvBackupOrParentsFlag,
  isCpMvBackupSuffixEnvDependent,
} from '../pathValidation.js'
import {
  BASH_TOO_LONG_TO_JUDGE_MESSAGE,
  bashToolHasPermission,
  checkDangerousRmInShellDashC,
  evaluateBashTooLongExpansion,
  extractBareEnvAssignmentNames,
  hasUnsafeBareEnvAssignment,
  hasUnsafeEnvVarPrefix,
} from '../bashPermissions.js'
import { getDestructiveCommandWarning as getBashDestructiveWarning } from '../destructiveCommandWarning.js'
import { getDestructiveCommandWarning as getPsDestructiveWarning } from '../../PowerShellTool/destructiveCommandWarning.js'
import { formatPersistedOutputTruncatedNotice } from '../BashToolResultMessage.js'
import {
  checkWorktreeSharedBranchGitCommand,
  checkZRuGitRedirect,
} from 'src/utils/worktreeGitIsolation.js'
import {
  hasPowerShellParseTimeCodeLoad,
  PS_UNSAFE_PARSE_TIME_CODE_LOAD_ERROR_ID,
} from 'src/utils/powershell/parser.js'
import { checkPowerShellAliasShadows } from '../../PowerShellTool/powershellPermissions.js'
import { UGREP_SYSTEM_GREP_FALLBACK_PATTERNS } from 'src/utils/bash/ShellSnapshot.js'
import {
  parseShellCompletionInputContext,
  shellQuoteCompletionPath,
} from 'src/utils/bash/shellCompletion.js'
import {
  consumeBashSnapshotHeadStart,
  getBashSnapshotHeadStartState,
  resetBashSnapshotHeadStartForTesting,
  SNAPSHOT_HEAD_START_MAX_AGE_MS,
  startBashSnapshotHeadStart,
} from 'src/utils/Shell.js'
import { monitorExpiredEvent } from 'src/utils/monitorStreamNotify.js'

afterEach(() => {
  delete process.env.SIMPLE_BACKUP_SUFFIX
  delete process.env.VERSION_CONTROL
  resetBashSnapshotHeadStartForTesting()
})

describe('Wave 326 Group 1 — Bash, PowerShell, Worktree, Shell & Monitor', () => {
  test('#11 cp source covered only by Edit deny rule is not refused, while Read deny rule still denies', () => {
    const cwd = '/tmp/wave326-cp-test'
    const baseCtx = getEmptyToolPermissionContext()
    const editDenyOnlyCtx = {
      ...baseCtx,
      additionalWorkingDirectories: new Map([
        [cwd, { path: cwd, source: 'session' as const }],
      ]),
      alwaysDenyRules: {
        userSettings: ['Edit(//tmp/wave326-cp-test/source.txt)'],
      },
    }
    const res = checkPathConstraints(
      { command: 'cp source.txt dest.txt' },
      cwd,
      editDenyOnlyCtx,
    )
    expect(res.behavior).not.toBe('deny')

    // Read deny rule on source MUST still deny
    const readDenyCtx = {
      ...baseCtx,
      additionalWorkingDirectories: new Map([
        [cwd, { path: cwd, source: 'session' as const }],
      ]),
      alwaysDenyRules: {
        userSettings: ['Read(//tmp/wave326-cp-test/source.txt)'],
      },
    }
    const readDenied = checkPathConstraints(
      { command: 'cp source.txt dest.txt' },
      cwd,
      readDenyCtx,
    )
    expect(readDenied.behavior).toBe('deny')

    // Edit deny rule on destination MUST still deny
    const destDenyCtx = {
      ...baseCtx,
      additionalWorkingDirectories: new Map([
        [cwd, { path: cwd, source: 'session' as const }],
      ]),
      alwaysDenyRules: {
        userSettings: ['Edit(//tmp/wave326-cp-test/dest.txt)'],
      },
    }
    const destDenied = checkPathConstraints(
      { command: 'cp source.txt dest.txt' },
      cwd,
      destDenyCtx,
    )
    expect(destDenied.behavior).toBe('deny')

    // Regression: duplicate sources (`cp a a a protected_dir`) must NOT misclassify
    // `protected_dir` as a source due to Set deduplication of `allWritePaths`.
    const dupDestDenyCtx = {
      ...baseCtx,
      additionalWorkingDirectories: new Map([
        [cwd, { path: cwd, source: 'session' as const }],
      ]),
      alwaysDenyRules: {
        userSettings: ['Edit(//tmp/wave326-cp-test/protected_dir/**)'],
      },
    }
    const dupDenied = checkPathConstraints(
      { command: 'cp a a a protected_dir' },
      cwd,
      dupDestDenyCtx,
    )
    expect(dupDenied.behavior).toBe('deny')
  })

  test('#12 isSearchOrReadBashCommand rejects mutating find -delete, cat > file, sort -o/--output', () => {
    expect(isSearchOrReadBashCommand('find . -delete')).toEqual({
      isSearch: false,
      isRead: false,
      isList: false,
    })
    expect(isSearchOrReadBashCommand('cat a.txt > b.txt')).toEqual({
      isSearch: false,
      isRead: false,
      isList: false,
    })
    expect(isSearchOrReadBashCommand('sort -o out.txt in.txt')).toEqual({
      isSearch: false,
      isRead: false,
      isList: false,
    })
    expect(isSearchOrReadBashCommand('sort --output=out.txt in.txt')).toEqual({
      isSearch: false,
      isRead: false,
      isList: false,
    })
    expect(isSearchOrReadBashCommand('find . -exec rm {} \\;')).toEqual({
      isSearch: false,
      isRead: false,
      isList: false,
    })
    // Genuine reads/searches remain collapsible
    expect(isSearchOrReadBashCommand('find . -name "*.ts"')).toEqual({
      isSearch: true,
      isRead: false,
      isList: false,
    })
    expect(isSearchOrReadBashCommand('cat a.txt > /dev/null')).toEqual({
      isSearch: false,
      isRead: true,
      isList: false,
    })
  })

  test('#13 unreadable shell -c command without rm returns null (not unfinishedCheck), while unreadable with rm still asks dangerousRemoval', () => {
    const res = checkDangerousRmInShellDashC("bash -c $'echo \\x41' $(foo)")
    expect(res).toBeNull()

    const rmRes = checkDangerousRmInShellDashC("bash -c $'rm -rf /' $(foo)")
    expect(rmRes?.behavior).toBe('ask')
    if (
      rmRes?.behavior === 'ask' &&
      rmRes.decisionReason?.type === 'safetyCheck'
    ) {
      expect(
        (rmRes.decisionReason as { circuitBreaker?: string }).circuitBreaker,
      ).toBe('dangerousRemoval')
    }
  })

  test('#295/#310 cp/mv contents targets and env-dependent backup suffixes ask', () => {
    expect(cpSourceTargetsDestContents(['-T', 'a', 'b'], ['a'])).toBe(true)
    expect(cpSourceTargetsDestContents(['.', 'dest'], ['.'])).toBe(true)
    expect(hasCpMvBackupOrParentsFlag(['--parents', 'a', 'b'])).toBe(true)
    expect(hasCpMvBackupOrParentsFlag(['-b', 'a', 'b'])).toBe(true)

    process.env.SIMPLE_BACKUP_SUFFIX = '.bak'
    expect(isCpMvBackupSuffixEnvDependent(['-b', 'a', 'b'])).toBe(true)
    expect(
      isCpMvBackupSuffixEnvDependent(['-b', '-S', '.orig', 'a', 'b']),
    ).toBe(false)
  })

  test('#308 Bash path checks catch commands reaching Claude sign-in files (including symlinked ancestors and macOS case-folding)', () => {
    const creds = join(homedir(), '.claude', '.credentials.json')
    const hits = findSignInFilesReachedByPaths([creds], '/tmp')
    expect(hits.named).toContain(creds)

    const parentHits = findSignInFilesReachedByPaths(
      [join(homedir(), '.claude')],
      '/tmp',
    )
    expect(parentHits.below).toContain(creds)

    // macOS/Windows case-folding check
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const upperHits = findSignInFilesReachedByPaths(
        [join(homedir(), '.CLAUDE', '.CREDENTIALS.JSON')],
        '/tmp',
      )
      expect(upperHits.named).toContain(creds)
    }

    // Symlinked ancestor pointing to CLAUDE_CONFIG_DIR even when .credentials.json doesn't exist yet
    if (process.platform !== 'win32') {
      const tmpRoot = mkdtempSync(join(tmpdir(), 'signin-link-326-'))
      const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
      try {
        const realConfigDir = join(tmpRoot, 'real-claude')
        mkdirSync(realConfigDir, { recursive: true })
        const linkDir = join(tmpRoot, 'link-claude')
        symlinkSync(realConfigDir, linkDir)
        process.env.CLAUDE_CONFIG_DIR = realConfigDir

        const viaLink = findSignInFilesReachedByPaths(
          [join(linkDir, '.credentials.json')],
          tmpRoot,
        )
        expect(viaLink.named.length).toBeGreaterThan(0)
      } finally {
        if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
        else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
        rmSync(tmpRoot, { recursive: true, force: true })
      }
    }
  })

  test('#306 env-assignment check does NOT mask Bash deny rules or dangerousRemoval safetyChecks (e.g. FOO=1 rm -rf ~)', async () => {
    const sbEnabled = spyOn(
      SandboxManager,
      'isSandboxingEnabled',
    ).mockReturnValue(true)
    const sbAutoAllow = spyOn(
      SandboxManager,
      'isAutoAllowBashIfSandboxedEnabled',
    ).mockReturnValue(false)
    const sbUnsandboxed = spyOn(
      SandboxManager,
      'areUnsandboxedCommandsAllowed',
    ).mockReturnValue(false)
    try {
      const baseCtx = getEmptyToolPermissionContext()
      const denyCtx = {
        ...baseCtx,
        alwaysDenyRules: {
          userSettings: ['Bash(*rm*)'],
        },
      }
      const fakeContext = {
        getAppState: () => ({ toolPermissionContext: denyCtx }),
        abortController: new AbortController(),
        options: { isNonInteractiveSession: false },
      } as never

      // Wildcard deny rule MUST still win over sandbox env-assignment ask
      const denied = await bashToolHasPermission(
        { command: 'FOO=1 rm -rf /tmp/foo' },
        fakeContext,
      )
      expect(denied.behavior).toBe('deny')

      // Read deny rule on path target MUST still win over sandbox env-assignment ask
      const readDenyCtx = {
        ...baseCtx,
        alwaysDenyRules: {
          userSettings: ['Read(//tmp/secret.txt)'],
        },
      }
      const readDenied = await bashToolHasPermission(
        { command: 'FOO=1; cat /tmp/secret.txt' },
        {
          getAppState: () => ({ toolPermissionContext: readDenyCtx }),
          abortController: new AbortController(),
          options: { isNonInteractiveSession: false },
        } as never,
      )
      expect(readDenied.behavior).toBe('deny')

      // `FOO=1 rm -rf ~` must surface `dangerousRemoval` safetyCheck,
      // NOT be downgraded to generic `'other'` env-assignment ask
      const noDenyContext = {
        getAppState: () => ({ toolPermissionContext: baseCtx }),
        abortController: new AbortController(),
        options: { isNonInteractiveSession: false },
      } as never
      const dangerRes = await bashToolHasPermission(
        { command: 'FOO=1 rm -rf ~' },
        noDenyContext,
      )
      expect(dangerRes.behavior).toBe('ask')
      expect(dangerRes.decisionReason?.type).toBe('safetyCheck')

      // Meanwhile, an otherwise-allowed command setting an unsafe env var
      // (e.g. `FOO=1 ls` where `ls` is read-only/allowed) IS downgraded to ask
      const allowCtx = {
        ...baseCtx,
        alwaysAllowRules: {
          userSettings: ['Bash(FOO=1 echo:*)'],
        },
      }
      const allowContext = {
        getAppState: () => ({ toolPermissionContext: allowCtx }),
        abortController: new AbortController(),
        options: { isNonInteractiveSession: false },
      } as never
      const envAsk = await bashToolHasPermission(
        { command: 'FOO=1 echo hello' },
        allowContext,
      )
      expect(envAsk.behavior).toBe('ask')
      expect(envAsk.decisionReason?.type).toBe('other')
    } finally {
      sbEnabled.mockRestore()
      sbAutoAllow.mockRestore()
      sbUnsandboxed.mockRestore()
    }
  })

  test('#306/#231 unsafe env var prefixes, += appends, and bare env assignments are flagged', () => {
    expect(hasUnsafeEnvVarPrefix('GIT_SSH_COMMAND=evil git status')).toBe(true)
    expect(hasUnsafeEnvVarPrefix('PATH+=/evil ls')).toBe(true)
    expect(hasUnsafeEnvVarPrefix('LANG=C ls')).toBe(false)

    expect(extractBareEnvAssignmentNames('FOO=bar')).toEqual(['FOO'])
    expect(hasUnsafeBareEnvAssignment(['PWD'], true)).toBe(true)
    expect(hasUnsafeBareEnvAssignment(['SRT_SSH_PROXY_COMMAND'], true)).toBe(
      true,
    )
  })

  test('#312 evaluateBashTooLongExpansion denies with standsForDenyRules when deny rules or non-interactive, asks with unfinishedCheck otherwise', () => {
    const baseCtx = getEmptyToolPermissionContext()
    const longCmd = `echo $FOO ${'a'.repeat(33_000)}`

    const askRes = evaluateBashTooLongExpansion(longCmd, baseCtx)
    expect(askRes?.behavior).toBe('ask')
    if (askRes?.behavior === 'ask') {
      expect(askRes.message).toBe(BASH_TOO_LONG_TO_JUDGE_MESSAGE)
      expect(
        askRes.decisionReason?.type === 'safetyCheck' &&
          (askRes.decisionReason as { circuitBreaker?: string }).circuitBreaker,
      ).toBe('unfinishedCheck')
    }

    const denyCtx = {
      ...baseCtx,
      alwaysDenyRules: { userSettings: ['Bash(rm:*)'] },
    }
    const denyRes = evaluateBashTooLongExpansion(longCmd, denyCtx)
    expect(denyRes?.behavior).toBe('deny')
    expect(
      (denyRes?.decisionReason as { standsForDenyRules?: boolean })
        ?.standsForDenyRules,
    ).toBe(true)

    const nonInteractiveRes = evaluateBashTooLongExpansion(longCmd, baseCtx, {
      hasNoInteractivePrompt: true,
    })
    expect(nonInteractiveRes?.behavior).toBe('deny')
  })

  test('#313 tengu_level_meadow refuses shared-branch rewriting git commands in subagent worktrees', () => {
    expect(
      checkWorktreeSharedBranchGitCommand(['git', 'filter-branch', '--all'], 0),
    ).not.toBeNull()
    expect(
      checkWorktreeSharedBranchGitCommand(['git', 'fast-import'], 0),
    ).not.toBeNull()
    expect(
      checkWorktreeSharedBranchGitCommand(
        ['git', 'update-ref', 'refs/heads/main', 'HEAD'],
        0,
      ),
    ).not.toBeNull()
    expect(
      checkWorktreeSharedBranchGitCommand(
        ['git', 'symbolic-ref', 'HEAD', 'refs/heads/main'],
        0,
      ),
    ).not.toBeNull()
    expect(
      checkWorktreeSharedBranchGitCommand(
        ['git', 'reflog', 'delete', 'HEAD@{0}'],
        0,
      ),
    ).not.toBeNull()
    // Safe forms are allowed
    expect(
      checkWorktreeSharedBranchGitCommand(
        ['git', 'update-ref', 'HEAD', 'abc123'],
        0,
      ),
    ).toBeNull()
    expect(
      checkWorktreeSharedBranchGitCommand(
        ['git', 'symbolic-ref', '--short', 'HEAD'],
        0,
      ),
    ).toBeNull()
    expect(
      checkWorktreeSharedBranchGitCommand(['git', 'worktree', 'list'], 0),
    ).toBeNull()

    // Wired into checkZRuGitRedirect for subagent worktrees
    const block = checkZRuGitRedirect(
      {
        kind: 'simple',
        commands: [
          {
            text: 'git filter-branch --all',
            argv: ['git', 'filter-branch', '--all'],
            envVars: [],
            redirects: [],
          },
        ],
        bareAssignmentNames: [],
      },
      '/tmp/subagent-wt',
      '/tmp/subagent-wt',
    )
    expect(block).toContain('filter-branch')
    expect(block).toContain('refused in every repository')
  })

  test('#317/#318/#319 PowerShell UnsafeParseTimeCodeLoad and aliasShadows helpers', () => {
    expect(PS_UNSAFE_PARSE_TIME_CODE_LOAD_ERROR_ID).toBe(
      'UnsafeParseTimeCodeLoad',
    )
    expect(hasPowerShellParseTimeCodeLoad('using module Evil')).toBe(true)
    expect(hasPowerShellParseTimeCodeLoad('#Requires -Modules Evil')).toBe(true)
    expect(hasPowerShellParseTimeCodeLoad('Get-ChildItem .')).toBe(false)

    const shadow = checkPowerShellAliasShadows({
      valid: true,
      errors: [],
      statements: [],
      redirections: [],
      aliasShadows: [{ name: 'rm', target: 'Remove-Item' }],
    } as never)
    expect(shadow?.behavior).toBe('deny')
    if (shadow?.behavior === 'deny') {
      expect(shadow.message).toContain('Remove-Item')
    }
  })

  test('#142 destructive command warning scans huge Bash & PowerShell commands without freezing', () => {
    const huge = `;${' '.repeat(100_000)}echo ok`
    const t0 = performance.now()
    expect(getBashDestructiveWarning(huge)).toBeNull()
    expect(getPsDestructiveWarning(huge)).toBeNull()
    expect(performance.now() - t0).toBeLessThan(200)

    expect(getBashDestructiveWarning('rm -rf /tmp/foo')).toContain(
      'recursively',
    )
    expect(
      getPsDestructiveWarning('Remove-Item foo -Recurse -Force'),
    ).toContain('recursively')
  })

  test('#52/#156/#165/#244/#258 shell integration, truncation notice, completion quoting, snapshot head-start, and monitor stderr expiry', () => {
    // #52 ugrep fallback patterns include null-data and filter flags
    expect(UGREP_SYSTEM_GREP_FALLBACK_PATTERNS).toContain('--null-data')
    expect(UGREP_SYSTEM_GREP_FALLBACK_PATTERNS).toContain('-*-filter*')

    // #156 expanded view truncation notice names file & total size
    const notice = formatPersistedOutputTruncatedNotice(
      '/tmp/tool-results/out.txt',
      4096,
    )
    expect(notice).toContain('saved to')
    expect(notice).toContain('out.txt')
    expect(notice).toContain('in all')

    // #165 file completion without slash in arg position + quoting paths with spaces
    const ctx = parseShellCompletionInputContext('cat readm', 9)
    expect(ctx).toEqual({ prefix: 'readm', completionType: 'file' })
    expect(shellQuoteCompletionPath('my file.txt ')).toBe("'my file.txt' ")
    expect(shellQuoteCompletionPath('plain.txt ')).toBe('plain.txt ')

    // #244 snapshot head-start tracks timestamp and invalidates after >20s
    let fakeNow = 10_000
    startBashSnapshotHeadStart(() => fakeNow)
    expect(getBashSnapshotHeadStartState().snapshotStartedAheadAt).toBe(10_000)
    fakeNow += SNAPSHOT_HEAD_START_MAX_AGE_MS + 1
    const consumed = consumeBashSnapshotHeadStart(() => fakeNow)
    expect(consumed).toEqual({ startedAhead: true, discardedStale: true })
    expect(getBashSnapshotHeadStartState().skipReason).toBe('too_old')

    // #258 monitorExpiredEvent mentions stderr output file on 0 events
    const boundedMsg = monitorExpiredEvent(
      60_000,
      0,
      true,
      '/tmp/mon-stderr.log',
    )
    expect(boundedMsg).toContain('wrote to stderr')
    expect(boundedMsg).toContain('`/tmp/mon-stderr.log`')

    const unboundedMsg = monitorExpiredEvent(
      60_000,
      0,
      false,
      '/tmp/mon-stderr.log',
    )
    expect(unboundedMsg).toContain('wrote to stderr')
    expect(unboundedMsg).toContain('`/tmp/mon-stderr.log`')

    const withEvents = monitorExpiredEvent(
      60_000,
      2,
      true,
      '/tmp/mon-stderr.log',
    )
    expect(withEvents).not.toContain('wrote to stderr')
  })
})
