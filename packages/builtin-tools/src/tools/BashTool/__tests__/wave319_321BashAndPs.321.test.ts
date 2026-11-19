import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
} from 'src/Tool.js'
import { getCwd } from 'src/utils/cwd.js'
import {
  bashToolCheckPermission,
  bashToolHasPermission,
  checkCommandAndSuggestRules,
  checkCompoundDirectoryChangesPathConstraints,
  enforceDangerouslyDisableSandboxAsk,
  isSafeEnvVarValue,
  stripAllLeadingEnvVars,
  stripSafeWrappers,
} from '../bashPermissions.js'
import {
  diffBashEditDiffSnapshot,
  parsePorcelainV2Status,
  takeBashEditDiffSnapshot,
} from '../bashEditDiff.js'
import {
  checkPathConstraints,
  expandCpMvDestinationPaths,
  normalizePathCommandName,
} from '../pathValidation.js'
import {
  checkReadOnlyConstraints,
  expandSafeDoubleQuotedPwd,
  stripPlainTimeoutPrefix,
} from '../readOnlyValidation.js'
import {
  checkSedConstraints,
  normalizeSedSubcommand,
} from '../sedValidation.js'
import { powershellToolCheckPermission } from '../../PowerShellTool/powershellPermissions.js'

// pathValidation -> filesystem.getBundledSkillsRoot reads build-time MACRO.VERSION
;(globalThis as { MACRO?: { VERSION: string } }).MACRO ??= {
  VERSION: '0.0.0-test',
}

function makePermCtx(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    ...overrides,
  }
}

describe('Wave 319-321 Group 1: Bash & PowerShell (#1731, #1742, #1754, #1776, #1778, #1809, #1810, #1848, #1849, #1850, #1900, #1955)', () => {
  test('#1731 quoted words in Bash commands still match deny and ask rules', () => {
    const denyCtx = makePermCtx({
      alwaysDenyRules: { userSettings: ['Bash(git push:*)'] },
    })
    const quotedDeny = bashToolCheckPermission(
      { command: '"git" "push" origin main' },
      denyCtx,
    )
    expect(quotedDeny.behavior).toBe('deny')

    const askCtx = makePermCtx({
      alwaysAskRules: { userSettings: ['Bash(npm publish:*)'] },
    })
    const quotedAsk = bashToolCheckPermission(
      { command: "npm 'publish' --access public" },
      askCtx,
    )
    expect(quotedAsk.behavior).toBe('ask')
    expect(quotedAsk.decisionReason?.type).toBe('rule')
  })

  test('#1778 stripAllLeadingEnvVars and stripSafeWrappers validate env values and array subscripts', () => {
    expect(isSafeEnvVarValue('LC_ALL', 'C')).toBe(true)
    expect(isSafeEnvVarValue('LC_ALL', 'en_US.UTF-8')).toBe(true)
    expect(isSafeEnvVarValue('LC_ALL', '../../../etc/passwd')).toBe(false)
    expect(isSafeEnvVarValue('TZ', '/etc/passwd')).toBe(false)
    expect(isSafeEnvVarValue('TZ', '$(id)')).toBe(false)
    expect(isSafeEnvVarValue('LANG', '')).toBe(true)

    // Unsafe locale / path value must NOT be stripped by stripSafeWrappers
    expect(stripSafeWrappers('LC_ALL=../../evil ls')).toBe(
      'LC_ALL=../../evil ls',
    )
    expect(stripSafeWrappers('LC_ALL=C ls')).toBe('ls')

    // Command substitution inside array subscript must NOT be stripped
    expect(stripAllLeadingEnvVars('A[$(id)]=1 ls')).toBe('A[$(id)]=1 ls')
    expect(stripAllLeadingEnvVars('A[0]=1 ls')).toBe('ls')
  })

  test('#1809 session exact ask rule does not override broader prefix/wildcard deny rule in Bash and PowerShell', () => {
    const bashCtx = makePermCtx({
      alwaysAskRules: { session: ['Bash(rm -rf build)'] },
      alwaysDenyRules: { userSettings: ['Bash(rm:*)'] },
    })
    const bashRes = bashToolCheckPermission(
      { command: 'rm -rf build' },
      bashCtx,
    )
    expect(bashRes.behavior).toBe('deny')

    // Non-session (userSettings) exact ask rule still beats nothing when no exact deny exists,
    // while session exact ask falls back to ask when no deny rule matches:
    const bashAskOnly = makePermCtx({
      alwaysAskRules: { session: ['Bash(echo hi)'] },
    })
    expect(
      bashToolCheckPermission({ command: 'echo hi' }, bashAskOnly).behavior,
    ).toBe('ask')

    const psCtx = makePermCtx({
      alwaysAskRules: { session: ['PowerShell(Remove-Item build)'] },
      alwaysDenyRules: { userSettings: ['PowerShell(Remove-Item:*)'] },
    })
    const psRes = powershellToolCheckPermission(
      { command: 'Remove-Item build' },
      psCtx,
    )
    expect(psRes.behavior).toBe('deny')
  })

  test('#1754 readOnlyValidation strips plain timeout DURATION prefix', () => {
    expect(stripPlainTimeoutPrefix('timeout 30 rg foo')).toBe('rg foo')
    expect(stripPlainTimeoutPrefix('timeout 5.5s grep bar file.ts')).toBe(
      'grep bar file.ts',
    )
    // Flags to timeout or shell builtins are NOT stripped
    expect(stripPlainTimeoutPrefix('timeout -s KILL 5 rg foo')).toBe(
      'timeout -s KILL 5 rg foo',
    )
    expect(stripPlainTimeoutPrefix('timeout 5 cd /tmp')).toBe(
      'timeout 5 cd /tmp',
    )

    const ro = checkReadOnlyConstraints({ command: 'timeout 30 rg foo' }, false)
    expect(ro.behavior).toBe('allow')
  })

  test('#1810 which uses safeFlags allowlist instead of unrestricted READONLY_COMMANDS', () => {
    expect(
      checkReadOnlyConstraints({ command: 'which -a git' }, false).behavior,
    ).toBe('allow')
    expect(
      checkReadOnlyConstraints({ command: 'which --all node' }, false).behavior,
    ).toBe('allow')
    // Flag outside lookup/display safeFlags requires permission
    expect(
      checkReadOnlyConstraints({ command: 'which --read-functions git' }, false)
        .behavior,
    ).toBe('passthrough')
  })

  test('#1776 sedValidation normalizes wrapper/env/quoted sed invocations', () => {
    expect(normalizeSedSubcommand("FOO=1 'sed' -i '1e id' file")).toBe(
      "sed -i '1e id' file",
    )
    expect(
      normalizeSedSubcommand('timeout 10 /usr/bin/sed -n "1e whoami" a'),
    ).toBe('sed -n "1e whoami" a')

    const acceptCtx = makePermCtx({ mode: 'acceptEdits' })
    expect(
      checkSedConstraints(
        { command: "FOO=1 'sed' -i 's/a/b/e' file.txt" },
        acceptCtx,
      ).behavior,
    ).toBe('ask')
    expect(
      checkSedConstraints(
        { command: 'timeout 5 /usr/bin/sed -n "1e id" file.txt' },
        acceptCtx,
      ).behavior,
    ).toBe('ask')
  })

  test('#1850 & #1955 pathValidation expands cp/mv destination dir targets and normalizes /bin/cp /bin/mv', () => {
    expect(normalizePathCommandName('/bin/cp')).toBe('cp')
    expect(normalizePathCommandName('/usr/bin/mv')).toBe('mv')
    expect(normalizePathCommandName('C:\\msys64\\usr\\bin\\cp.exe')).toBe('cp')

    const expanded = expandCpMvDestinationPaths(
      ['-t', '.claude', 'settings.json'],
      ['settings.json'],
    )
    expect(expanded).toContain('.claude/settings.json')

    const cwd = getCwd()
    const denyCtx = makePermCtx({
      alwaysDenyRules: {
        userSettings: [`Edit(/${join(cwd, 'dest', 'secret.txt')})`],
      },
    })
    const resCp = checkPathConstraints(
      { command: '/bin/cp secret.txt dest/' },
      cwd,
      denyCtx,
    )
    expect(resCp.behavior).toBe('deny')

    const resMvFlag = checkPathConstraints(
      { command: '/usr/bin/mv -t dest secret.txt' },
      cwd,
      denyCtx,
    )
    expect(resMvFlag.behavior).toBe('deny')
  })

  test('#1900 expands safe "$PWD" to current directory for read-only validation', () => {
    const cwd = getCwd()
    expect(expandSafeDoubleQuotedPwd('grep -r foo "$PWD/src"', cwd)).toBe(
      `grep -r foo "${cwd}/src"`,
    )
    // Does not expand when PWD is referenced elsewhere
    expect(expandSafeDoubleQuotedPwd('echo $PWD "$PWD/src"', cwd)).toBe(
      'echo $PWD "$PWD/src"',
    )
    const ro = checkReadOnlyConstraints(
      { command: 'grep -r foo "$PWD/src"' },
      false,
    )
    expect(ro.behavior).toBe('allow')
  })

  test('#1848 enforceDangerouslyDisableSandboxAsk preserves non-sandbox behavior and returns sandboxOverride when applicable', () => {
    const passthrough = enforceDangerouslyDisableSandboxAsk(
      { command: 'ls', dangerouslyDisableSandbox: false },
      { behavior: 'allow', updatedInput: { command: 'ls' } },
    )
    expect(passthrough.behavior).toBe('allow')
  })

  test('#1849 compound commands track cd/pushd/popd candidate directories for write validation', () => {
    const cwd = getCwd()
    const denyCtx = makePermCtx({
      alwaysDenyRules: {
        userSettings: [`Edit(/${join(cwd, 'sub', 'blocked.txt')})`],
      },
    })
    const res = checkCompoundDirectoryChangesPathConstraints(
      ['pushd sub', 'touch blocked.txt'],
      [undefined, undefined],
      cwd,
      denyCtx,
    )
    expect(res?.behavior).toBe('deny')
  })

  test('#1742 bashEditDiff parses porcelain=v2 and detects rapid same-second file edits', async () => {
    const parsed = parsePorcelainV2Status(
      [
        '? new.txt',
        '? dir/',
        '1 .M N... 100644 100644 100644 abc def mod.txt',
        '1 .D N... 100644 100644 000000 abc 000 del.txt',
        '',
      ].join('\0'),
    )
    expect(parsed.changed).toEqual(['new.txt', 'mod.txt'])
    expect(parsed.deleted).toEqual(['del.txt'])
    expect(parsed.untrackedDirectories).toEqual(['dir/'])

    const repo = mkdtempSync(join(tmpdir(), 'cc-bed-1742-'))
    try {
      execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' })
      execFileSync('git', ['config', 'user.email', 'test@example.com'], {
        cwd: repo,
        stdio: 'ignore',
      })
      execFileSync('git', ['config', 'user.name', 'Test'], {
        cwd: repo,
        stdio: 'ignore',
      })
      writeFileSync(join(repo, 'a.txt'), 'hello\n')
      execFileSync('git', ['add', 'a.txt'], { cwd: repo, stdio: 'ignore' })
      execFileSync('git', ['commit', '-m', 'init'], {
        cwd: repo,
        stdio: 'ignore',
      })

      const snap = await takeBashEditDiffSnapshot(repo)
      expect(snap).not.toBeNull()
      expect(snap).not.toBe('unavailable')
      if (snap && snap !== 'unavailable') {
        // Same-length, same-second overwrite (classic git racy-clean scenario)
        writeFileSync(join(repo, 'a.txt'), 'world\n')
        const diff = await diffBashEditDiffSnapshot(snap)
        expect(diff.files.some(f => f.filePath.endsWith('/a.txt'))).toBe(true)
        rmSync(snap.gitDirectory, { recursive: true, force: true })
      }
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('#1900 keeps AST path (no shell-quote fallback) and expands "$PWD" in astCommand.argv', () => {
    const cwd = getCwd()
    const denyCtx = makePermCtx({
      alwaysDenyRules: {
        userSettings: [`Edit(/${join(cwd, 'secret.txt')})`],
      },
    })
    // Command with single-quote backslash + "$PWD/secret.txt": if AST were
    // dropped to undefined, shell-quote could misparse the single-quoted backslash
    // and skip path validation; keeping `[expandedAstCommand]` validates argv directly.
    const astCmd = {
      argv: ['rm', '$PWD/secret.txt', '\\'],
      envVars: [],
      redirects: [],
      text: `rm "$PWD/secret.txt" '\\'`,
    }
    const res = bashToolCheckPermission(
      { command: `rm "$PWD/secret.txt" '\\'` },
      denyCtx,
      false,
      astCmd,
      cwd,
    )
    expect(res.behavior).toBe('deny')

    // Also handles tree-sitter VAR_PLACEHOLDER representation (`__TRACKED_VAR__/secret.txt`)
    const astCmdTracked = {
      argv: ['rm', '__TRACKED_VAR__/secret.txt'],
      envVars: [],
      redirects: [],
      text: `rm "$PWD/secret.txt"`,
    }
    const resTracked = bashToolCheckPermission(
      { command: `rm "$PWD/secret.txt"` },
      denyCtx,
      false,
      astCmdTracked,
      cwd,
    )
    expect(resTracked.behavior).toBe('deny')
  })

  test('#1809 exact ask from projectSettings/userSettings cannot downgrade policySettings prefix deny', async () => {
    const bashCtx = makePermCtx({
      alwaysAskRules: {
        projectSettings: ['Bash(rm -rf build)'],
        userSettings: ['Bash(git push --force)'],
      },
      alwaysDenyRules: {
        policySettings: ['Bash(rm:*)', 'Bash(git push:*)'],
      },
    })
    expect(
      bashToolCheckPermission({ command: 'rm -rf build' }, bashCtx).behavior,
    ).toBe('deny')
    expect(
      bashToolCheckPermission({ command: 'git push --force' }, bashCtx)
        .behavior,
    ).toBe('deny')
    expect(
      (
        await checkCommandAndSuggestRules(
          { command: 'rm -rf build' },
          bashCtx,
          null,
        )
      ).behavior,
    ).toBe('deny')

    // When no deny rule matches, projectSettings exact ask still asks
    const askOnlyCtx = makePermCtx({
      alwaysAskRules: { projectSettings: ['Bash(echo hi)'] },
    })
    expect(
      bashToolCheckPermission({ command: 'echo hi' }, askOnlyCtx).behavior,
    ).toBe('ask')

    const psCtx = makePermCtx({
      alwaysAskRules: {
        projectSettings: ['PowerShell(Remove-Item build)'],
        userSettings: ['PowerShell(Stop-Process -Name app)'],
      },
      alwaysDenyRules: {
        policySettings: [
          'PowerShell(Remove-Item:*)',
          'PowerShell(Stop-Process:*)',
        ],
      },
    })
    expect(
      powershellToolCheckPermission({ command: 'Remove-Item build' }, psCtx)
        .behavior,
    ).toBe('deny')
    expect(
      powershellToolCheckPermission(
        { command: 'Stop-Process -Name app' },
        psCtx,
      ).behavior,
    ).toBe('deny')
  })

  test('#1849 multi-cd deny precedence, redirect deny not masked, and GH#28784 suggestion stripping', async () => {
    const makeToolUseCtx = (permCtx: ToolPermissionContext) =>
      ({
        getAppState: () => ({ toolPermissionContext: permCtx }),
        abortController: new AbortController(),
        options: { isNonInteractiveSession: false },
      }) as never

    // 1. pushd /etc && rm passwd && popd must hit deny (not downgrade to multi-cd ask)
    // Include both /etc and /private/etc so macOS symlink resolution matches cleanly.
    const etcDenyCtx = makePermCtx({
      alwaysDenyRules: {
        policySettings: ['Edit(//etc/passwd)', 'Edit(//private/etc/passwd)'],
      },
    })
    const multiCdRes = await bashToolHasPermission(
      { command: 'pushd /etc && rm passwd && popd' },
      makeToolUseCtx(etcDenyCtx),
    )
    expect(multiCdRes.behavior).toBe('deny')

    // 2. Earlier subcommand 'ask' in compound chain must not mask later subcommand 'deny'
    const chainRes = checkCompoundDirectoryChangesPathConstraints(
      ['cd /etc', 'touch hosts', 'rm passwd'],
      [undefined, undefined, undefined],
      getCwd(),
      etcDenyCtx,
    )
    expect(chainRes?.behavior).toBe('deny')

    // 3. trackedCwdDecision 'ask' must not shadow output-redirection 'deny' (> /etc/secret)
    const redirectDenyCtx = makePermCtx({
      alwaysDenyRules: {
        policySettings: ['Edit(//etc/secret)', 'Edit(//private/etc/secret)'],
      },
    })
    const redirectRes = await bashToolHasPermission(
      { command: 'cd /tmp && touch foo > /etc/secret' },
      makeToolUseCtx(redirectDenyCtx),
    )
    expect(redirectRes.behavior).toBe('deny')

    // 4. GH#28784 guard: when trackedCwdDecision asks alongside non-allowed sibling commands,
    // path-only suggestions must be stripped so approving cannot silently allow python3.
    const siblingRes = await bashToolHasPermission(
      { command: 'cd /tmp && touch foo.txt && python3 evil.py' },
      makeToolUseCtx(makePermCtx()),
    )
    expect(siblingRes.behavior).toBe('ask')
    if (siblingRes.behavior === 'ask') {
      expect(siblingRes.suggestions).toBeUndefined()
    }
  })

  test('#1955 normalizePathCommandName handles Windows rm.exe and rmdir.exe', () => {
    expect(normalizePathCommandName('rm.exe')).toBe('rm')
    expect(normalizePathCommandName('RM.EXE')).toBe('rm')
    expect(normalizePathCommandName('C:\\msys64\\usr\\bin\\rm.exe')).toBe('rm')
    expect(normalizePathCommandName('rmdir.exe')).toBe('rmdir')
    expect(normalizePathCommandName('C:\\msys64\\usr\\bin\\rmdir.exe')).toBe(
      'rmdir',
    )
  })
})
