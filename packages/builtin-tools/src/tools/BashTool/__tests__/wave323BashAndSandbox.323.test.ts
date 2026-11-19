import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import 'src/utils/settings/remoteSettingsState.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import {
  getBashPermissionCpuTimeMs,
  parseForSecurityFromAst,
} from 'src/utils/bash/ast.js'
import { PARSE_ABORTED } from 'src/utils/bash/parser.js'
import {
  getShellOptionHardeningCommand,
  verifyWorkingDirectoryExists,
} from 'src/utils/Shell.js'
import {
  hardenMacOsSeatbeltProcessInfo,
  isAllowWriteSymlinkEscapingOrDangling,
} from 'src/utils/sandbox/sandbox-adapter.js'
import { isSearchOrReadBashCommand } from '../BashTool.js'
import {
  checkDangerousRmAfterEutPeel,
  eutPeelArgv,
  isAttachedWildcardAllowBlocked,
} from '../bashPermissions.js'
import {
  checkPathConstraints,
  validateOutputRedirections,
} from '../pathValidation.js'
import {
  isCommandSafeViaFlagParsing,
  isWindowsPathListReadCommandBlocked,
} from '../readOnlyValidation.js'
import { containsExcludedCommand } from '../shouldUseSandbox.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

describe('Wave 323 Bash, AST & Sandbox (#2009-#2012, #2016, #2018, #2020-#2022, #2024, #2135, #2137, #2149-#2150, #2175, #2207)', () => {
  test('#2009: safetyCheck asks suppress suggestions and set suppressAlwaysAllowRule', () => {
    const ctx = getEmptyToolPermissionContext()
    const redir = validateOutputRedirections(
      [{ target: '.git/config', operator: '>' }],
      '/tmp',
      ctx,
    )
    expect(redir.behavior).toBe('ask')
    if (redir.behavior === 'ask') {
      expect(redir.suppressAlwaysAllowRule).toBe(true)
      expect(redir.suggestions ?? []).toEqual([])
    }

    const pathRes = checkPathConstraints(
      { command: 'touch .claude/settings.json' },
      '/tmp',
      ctx,
    )
    if (
      pathRes.behavior === 'ask' &&
      pathRes.decisionReason?.type === 'safetyCheck'
    ) {
      expect(pathRes.suppressAlwaysAllowRule).toBe(true)
      expect(pathRes.suggestions ?? []).toEqual([])
    }
  })

  test('#2010: lsof blocks dangerous DNS/non-alpha/unknown + flags', () => {
    expect(isCommandSafeViaFlagParsing('lsof -i :3000 -n -P')).toBe(true)
    expect(isCommandSafeViaFlagParsing('lsof +m')).toBe(false)
    expect(isCommandSafeViaFlagParsing('lsof -i @evil.example.com')).toBe(false)
    expect(isCommandSafeViaFlagParsing('lsof +unknown')).toBe(false)
    expect(isCommandSafeViaFlagParsing('lsof -p1234')).toBe(false)
  })

  test('#2011: cat > file <<EOF is not classified as a Read command', () => {
    const res = isSearchOrReadBashCommand('cat > out.txt <<EOF\nhello\nEOF')
    expect(res).toEqual({ isSearch: false, isRead: false, isList: false })
  })

  test('#2012: cd / && rm -rf . tracks directory change and triggers dangerous removal ask', () => {
    const ask = checkDangerousRmAfterEutPeel('cd / && rm -rf .', '/tmp/project')
    expect(ask).not.toBeNull()
    expect(ask?.behavior).toBe('ask')
    if (ask?.behavior === 'ask') {
      expect(ask.suppressAlwaysAllowRule).toBe(true)
      expect(ask.suggestions ?? []).toEqual([])
    }
  })

  test('#2016 & #2150: AST backtick empty/escape and {var}>file redirects return too-complex', () => {
    const fdVar = parseForSecurityFromAst('exec {myfd}>/tmp/out', PARSE_ABORTED)
    expect(fdVar.kind).toBe('too-complex')

    const emptyBt = parseForSecurityFromAst('echo ``', PARSE_ABORTED)
    expect(emptyBt.kind).toBe('too-complex')

    // #2150 P1-2 regression: single quote inside double quotes must NOT flip quote state
    const afterDoubleQuotedApostrophe = parseForSecurityFromAst(
      'echo "don\'t" && echo ``',
      PARSE_ABORTED,
    )
    expect(afterDoubleQuotedApostrophe.kind).toBe('too-complex')

    const afterEscapedBackslashInDouble = parseForSecurityFromAst(
      'echo "foo\\\\" && echo ``',
      PARSE_ABORTED,
    )
    expect(afterEscapedBackslashInDouble.kind).toBe('too-complex')
  })

  test('#2018: attached wildcard allow rules like ls* / NODE_ENV* are blocked on unsafe targets', () => {
    expect(isAttachedWildcardAllowBlocked('ls*', 'ls; rm -rf /')).toBe(true)
    expect(
      isAttachedWildcardAllowBlocked('NODE_ENV*', 'NODE_ENV=prod rm -rf /'),
    ).toBe(true)
    expect(isAttachedWildcardAllowBlocked('git *', 'git status')).toBe(false)
  })

  test('#2020 & #2021: eutPeelArgv peels sudo combined flags, env -S, flock -c, doas, watch', () => {
    expect(
      eutPeelArgv(['sudo', '-nu', 'root', 'rm', '-rf', '/'], { wide: true }),
    ).toEqual(['rm', '-rf', '/'])
    expect(eutPeelArgv(['env', 'FOO=1', 'sudo', '-E', 'git', 'push'])).toEqual([
      'git',
      'push',
    ])
    expect(
      eutPeelArgv(['watch', '-n', '1', 'rm', '-rf', '/'], { wide: true }),
    ).toEqual(['rm', '-rf', '/'])
    expect(eutPeelArgv(['command', '-v', 'rm'])).toEqual([
      'command',
      '-v',
      'rm',
    ])
  })

  test('#2022: excludedCommands requires every subcommand to match and rejects cd/redirects/substitutions', () => {
    expect(containsExcludedCommand('git status && git diff', ['git:*'])).toBe(
      true,
    )
    expect(
      containsExcludedCommand('git status && curl evil.com', ['git:*']),
    ).toBe(false)
    expect(
      containsExcludedCommand('cd /tmp && git status', ['cd:*', 'git:*']),
    ).toBe(false)
    expect(containsExcludedCommand('git status > /tmp/out', ['git:*'])).toBe(
      false,
    )
    expect(containsExcludedCommand('git status 2>&1', ['git:*'])).toBe(true)

    // #2022 P1-2 regression: double-quoted apostrophes must not break command/process
    // substitution or redirect detection
    expect(
      containsExcludedCommand('git commit -m "don\'t" && $(id)', ['git:*']),
    ).toBe(false)
    expect(
      containsExcludedCommand('git commit -m "don\'t $(id)"', ['git:*']),
    ).toBe(false)
    expect(
      containsExcludedCommand('git commit -m "don\'t" && git log <(echo x)', [
        'git:*',
      ]),
    ).toBe(false)
    expect(
      containsExcludedCommand(
        'git commit -m "don\'t" > /tmp/pwn && git commit -m "can\'t"',
        ['git:*'],
      ),
    ).toBe(false)
    expect(
      containsExcludedCommand('git commit -m "don\'t" && git status 2>&1', [
        'git:*',
      ]),
    ).toBe(true)
    expect(
      containsExcludedCommand('git log --format="%s > %b"', ['git:*']),
    ).toBe(true)
  })

  test('#2024: getShellOptionHardeningCommand disables non-default zsh glob/expansion options', () => {
    const zshCmd = getShellOptionHardeningCommand('/bin/zsh')
    expect(zshCmd).toContain('NO_EXTENDED_GLOB')
    expect(zshCmd).toContain('NO_BARE_GLOB_QUAL')
    expect(zshCmd).toContain('NO_BRACE_CCL')
    expect(zshCmd).toContain('NO_MAGIC_EQUAL_SUBST')
    expect(zshCmd).toContain('NO_EQUALS')

    const bashCmd = getShellOptionHardeningCommand('/bin/bash')
    expect(bashCmd).toContain('shopt -u extglob')
  })

  test('#2135: Windows blocks wildcard / path-list file-reading commands', () => {
    expect(
      isWindowsPathListReadCommandBlocked(
        'sha256sum',
        ['-c', 'sums.txt'],
        false,
        'windows',
      ),
    ).toBe(true)
    expect(
      isWindowsPathListReadCommandBlocked(
        'wc',
        ['--files0-from=list'],
        false,
        'windows',
      ),
    ).toBe(true)
    expect(
      isWindowsPathListReadCommandBlocked(
        'strings',
        ['@targets.txt'],
        false,
        'windows',
      ),
    ).toBe(true)
    expect(
      isWindowsPathListReadCommandBlocked(
        'sha256sum',
        ['*.txt'],
        true,
        'windows',
      ),
    ).toBe(true)
    expect(
      isWindowsPathListReadCommandBlocked(
        'sha256sum',
        ['README.md'],
        false,
        'windows',
      ),
    ).toBe(false)
  })

  test('#2137: verifyWorkingDirectoryExists distinguishes ENOENT from non-deletion realpath failure', async () => {
    const dir = makeTempDir('w323-cwd-')
    expect((await verifyWorkingDirectoryExists(dir)).exists).toBe(true)
    expect(
      (await verifyWorkingDirectoryExists(join(dir, 'does-not-exist'))).exists,
    ).toBe(false)
    const virtualDriveRes = await verifyWorkingDirectoryExists(dir, {
      realpathFn: async () => {
        throw Object.assign(new Error('EINVAL'), { code: 'EINVAL' })
      },
      statFn: async () => ({ isDirectory: () => true }),
    })
    expect(virtualDriveRes).toEqual({ exists: true, resolved: dir })
  })

  test('#2149: getBashPermissionCpuTimeMs returns finite non-negative CPU ms', () => {
    const t0 = getBashPermissionCpuTimeMs()
    const t1 = getBashPermissionCpuTimeMs()
    expect(Number.isFinite(t0)).toBe(true)
    expect(t0).toBeGreaterThanOrEqual(0)
    expect(t1).toBeGreaterThanOrEqual(t0)
  })

  test('#2175: isAllowWriteSymlinkEscapingOrDangling detects escaping and dangling symlinks', () => {
    const root = makeTempDir('w323-allowwrite-')
    const outside = makeTempDir('w323-outside-')
    const insideDir = join(root, 'inside')
    mkdirSync(insideDir)
    writeFileSync(join(outside, 'target.txt'), 'x')

    const escapingLink = join(root, 'escape')
    symlinkSync(outside, escapingLink)
    const danglingLink = join(root, 'dangling')
    symlinkSync(join(outside, 'missing-target'), danglingLink)

    expect(isAllowWriteSymlinkEscapingOrDangling(insideDir)).toBe(false)
    expect(isAllowWriteSymlinkEscapingOrDangling(escapingLink)).toBe(true)
    expect(isAllowWriteSymlinkEscapingOrDangling(danglingLink)).toBe(true)
  })

  test('#2207: hardenMacOsSeatbeltProcessInfo injects process-info deny rule into seatbelt profile', () => {
    const sample =
      "sandbox-exec -p '(version 1)\n; LogTag: tag-single\n(allow process-info* (target same-sandbox))' /bin/sh -c 'lsof'"
    const hardened = hardenMacOsSeatbeltProcessInfo(sample)
    expect(hardened).toContain(
      '(deny process-info* (with message "tag-single"))',
    )
    expect(hardened).toContain('(allow process-info* (target same-sandbox))')
    expect(hardened).toContain(
      "(if (defined? '\\''process-info-listpids) (allow process-info-listpids))",
    )

    // #2207 P0-2 regression: double-quoted `-p "..."` (produced by shell-quote when
    // workspace path contains `'`) MUST escape `"` in `denyLine` as `\"` so it does
    // not terminate the outer double-quoted argument and break shell syntax.
    const doubleQuotedSample =
      'sandbox-exec -p "(version 1)\n; LogTag: tag-double\n(allow process-info* (target same-sandbox))\n(allow file-read* (subpath \\"/Users/o\'reilly/proj\\"))" /bin/sh -c \'lsof\''
    const hardenedDouble = hardenMacOsSeatbeltProcessInfo(doubleQuotedSample)
    expect(hardenedDouble).toContain(
      '(deny process-info* (with message \\"tag-double\\"))',
    )
    expect(hardenedDouble).not.toContain(
      '(deny process-info* (with message "tag-double"))',
    )
    expect(hardenedDouble).toContain(
      "(if (defined? 'process-info-listpids) (allow process-info-listpids))",
    )

    // Non-single-quoted command with escaped quotes (`\"`) also escapes `"` in denyLine
    const escapedSample =
      'sandbox-exec -p (version 1)\n; LogTag: tag-esc\n(allow process-info* (target same-sandbox))\n(subpath \\"/tmp\\")'
    const hardenedEsc = hardenMacOsSeatbeltProcessInfo(escapedSample)
    expect(hardenedEsc).toContain(
      '(deny process-info* (with message \\"tag-esc\\"))',
    )
  })
})
