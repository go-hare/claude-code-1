import { describe, expect, test } from 'bun:test'
import { commandHasGitStateSwitch } from './bashEditDiff.js'
import { PATH_EXTRACTORS } from './pathValidation.js'
import {
  checkReadOnlyConstraints,
  containsUnquotedExpansion,
  isCommandSafeViaFlagParsing,
} from './readOnlyValidation.js'
import {
  hasDangerousGitSubcommandFlag,
  isFullyExcludedCommandForPolicyWithPatterns,
} from './shouldUseSandbox.js'

describe('BashTool v2.1.290 #143 pyright read-only removal', () => {
  test('pyright is NOT treated as read-only via flag parsing or constraints', () => {
    expect(isCommandSafeViaFlagParsing('pyright')).toBe(false)
    expect(isCommandSafeViaFlagParsing('pyright --version')).toBe(false)
    expect(isCommandSafeViaFlagParsing('pyright src/')).toBe(false)
    expect(
      checkReadOnlyConstraints({ command: 'pyright --version' }, false)
        .behavior,
    ).toBe('passthrough')
  })
})

describe('BashTool v2.1.290 #148 ps dashed flags', () => {
  test('allows safe dashed -e / -ef / --forest with at most one [HLTm]', () => {
    expect(isCommandSafeViaFlagParsing('ps -e')).toBe(true)
    expect(isCommandSafeViaFlagParsing('ps -ef')).toBe(true)
    expect(isCommandSafeViaFlagParsing('ps -ef --forest')).toBe(true)
    expect(isCommandSafeViaFlagParsing('ps -efH')).toBe(true)
  })

  test('blocks BSD e/E and unsafe dashed -e combinations', () => {
    expect(isCommandSafeViaFlagParsing('ps e')).toBe(false)
    expect(isCommandSafeViaFlagParsing('ps auxe')).toBe(false)
    expect(isCommandSafeViaFlagParsing('ps -e -p 123')).toBe(false)
    expect(isCommandSafeViaFlagParsing('ps -ef -H --forest')).toBe(false)
    expect(isCommandSafeViaFlagParsing('ps -eHT')).toBe(false)
  })
})

describe('BashTool v2.1.290 #76 Dot sentinel & flag guards', () => {
  test('rejects sentinel tokens in flag values and positional args', () => {
    expect(isCommandSafeViaFlagParsing('grep __CMDSUB_OUTPUT__')).toBe(false)
    expect(isCommandSafeViaFlagParsing('grep __TRACKED_VAR__')).toBe(false)
    expect(isCommandSafeViaFlagParsing('grep __UNCERTAIN_VAR__')).toBe(false)
    expect(
      isCommandSafeViaFlagParsing('grep -e __CMDSUB_OUTPUT__ file.txt'),
    ).toBe(false)
  })

  test('rejects non-standard dash flags before -- (tengu_amber_thimble)', () => {
    expect(isCommandSafeViaFlagParsing('grep -@foo')).toBe(false)
    expect(isCommandSafeViaFlagParsing('grep -- -@foo')).toBe(true)
  })
})

describe('BashTool v2.1.290 #104 --flag=VALUE & double-quoted globs', () => {
  test('parsePatternCommand extracts paths from --flag=VALUE and -fVAL', () => {
    expect(PATH_EXTRACTORS.grep(['--file=/etc/passwd', 'foo'])).toEqual([
      '/etc/passwd',
      'foo',
    ])
    expect(PATH_EXTRACTORS.grep(['-f=/etc/passwd', 'foo'])).toEqual([
      '/etc/passwd',
      'foo',
    ])
    expect(PATH_EXTRACTORS.grep(['-f/etc/passwd', 'foo'])).toEqual([
      '/etc/passwd',
      'foo',
    ])
    expect(
      PATH_EXTRACTORS.rg(['--ignore-file=/etc/passwd', 'pattern', 'src']),
    ).toEqual(['/etc/passwd', 'src'])
    expect(
      PATH_EXTRACTORS.grep(['--exclude-from=/tmp/ex', 'pattern', 'src']),
    ).toEqual(['/tmp/ex', 'src'])
  })

  test('containsUnquotedExpansion distinguishes variable vs glob and skips double-quoted globs', () => {
    expect(containsUnquotedExpansion('grep "foo*" file.txt')).toBe(false)
    expect(containsUnquotedExpansion('grep "foo?" file.txt')).toBe(false)
    expect(containsUnquotedExpansion('grep "foo[0]" file.txt')).toBe(false)
    expect(containsUnquotedExpansion('grep "$HOME" file.txt')).toBe('variable')
    expect(containsUnquotedExpansion('ls *.ts')).toBe('glob')
    expect(containsUnquotedExpansion("ls '$HOME' '*.ts'")).toBe(false)
  })
})

describe('BashTool v2.1.290 #79 git clone short options', () => {
  test('detects git clone -u, -c, --config, --template, and bundled -qu (while -bu consumes u as -b arg)', () => {
    expect(
      hasDangerousGitSubcommandFlag([
        'git',
        'clone',
        '-u',
        '/tmp/evil',
        'https://example.com/repo.git',
      ]),
    ).toBe(true)
    expect(
      hasDangerousGitSubcommandFlag([
        'git',
        'clone',
        '-qu',
        '/tmp/evil',
        'https://example.com/repo.git',
      ]),
    ).toBe(true)
    expect(
      hasDangerousGitSubcommandFlag([
        'git',
        'clone',
        '-bu',
        'https://example.com/repo.git',
      ]),
    ).toBe(false)
    expect(
      hasDangerousGitSubcommandFlag([
        'git',
        'clone',
        '-c',
        'core.fsmonitor=evil',
        'https://example.com/repo.git',
      ]),
    ).toBe(true)
    expect(
      hasDangerousGitSubcommandFlag([
        'git',
        'clone',
        '--template=/tmp/tpl',
        'https://example.com/repo.git',
      ]),
    ).toBe(true)
    expect(
      hasDangerousGitSubcommandFlag([
        'git',
        'clone',
        '--depth',
        '1',
        'https://example.com/repo.git',
      ]),
    ).toBe(false)
  })

  test('blocks sandbox exclusion for git clone with dangerous short options', () => {
    expect(
      isFullyExcludedCommandForPolicyWithPatterns(
        'git clone -u /tmp/evil https://example.com/repo.git',
        ['git:*'],
      ),
    ).toBe(false)
    expect(
      isFullyExcludedCommandForPolicyWithPatterns(
        'git clone https://example.com/repo.git',
        ['git:*'],
      ),
    ).toBe(true)
  })
})

describe('BashTool v2.1.290 #130 git state-switch treeMoved', () => {
  test('commandHasGitStateSwitch detects git state-switching subcommands in compound commands', () => {
    expect(
      commandHasGitStateSwitch('echo hi > a.txt && git checkout main'),
    ).toBe(true)
    expect(commandHasGitStateSwitch('git -C /repo switch feature')).toBe(true)
    expect(commandHasGitStateSwitch('sudo git reset --hard')).toBe(true)
    expect(commandHasGitStateSwitch('git status && echo done')).toBe(false)
  })
})
