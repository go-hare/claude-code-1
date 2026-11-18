import { describe, expect, mock, test } from 'bun:test'
import { buildShellSpawnEnv } from '../../Shell.js'
import {
  buildClearAliasAndFunctionCommand,
  CLEAR_UNSETENV_COMMAND,
  CLEAR_WHICH_COMMAND,
  STRIPPED_EXPORTED_FUNC_ENV_KEYS,
} from '../ShellSnapshot.js'

mock.module('../ast.js', () => ({
  parseForSecurity: async (cmd: string) => ({
    kind: 'simple',
    bareAssignmentNames: [],
    commands: [{ argv: cmd.trim().split(/\s+/), envVars: [] }],
  }),
}))

import { buildMacOsGitGrepCLocaleWrapper } from '../gitGrepLocale.js'

describe('v2.1.314 shell alignment (#1440, #1448)', () => {
  test('#1440 clears which/unsetenv aliases & functions and strips BASH_FUNC_which/unsetenv from spawn env', () => {
    expect(CLEAR_WHICH_COMMAND).toBe(buildClearAliasAndFunctionCommand('which'))
    expect(CLEAR_UNSETENV_COMMAND).toBe(
      buildClearAliasAndFunctionCommand('unsetenv'),
    )
    expect(CLEAR_WHICH_COMMAND).toBe(
      "{ \\builtin unalias -- 'which'; \\builtin unset -f -- 'which'; } >/dev/null 2>&1 || true",
    )
    expect(STRIPPED_EXPORTED_FUNC_ENV_KEYS).toContain('BASH_FUNC_which%%')
    expect(STRIPPED_EXPORTED_FUNC_ENV_KEYS).toContain('BASH_FUNC_unsetenv%%')

    const env = buildShellSpawnEnv({
      shellType: 'bash',
      binShell: '/bin/bash',
      envOverrides: {},
      envDefaults: {
        'BASH_FUNC_which%%': '() { echo fake; }',
        'BASH_FUNC_unsetenv()': '() { echo fake; }',
        '__BASH_FUNC<which>()': '() { echo fake; }',
        KEEP_ME: 'ok',
      },
    })
    expect(env['BASH_FUNC_which%%']).toBeUndefined()
    expect(env['BASH_FUNC_unsetenv()']).toBeUndefined()
    expect(env['__BASH_FUNC<which>()']).toBeUndefined()
    expect(env.KEEP_ME).toBe('ok')
  })

  test('#1448 buildMacOsGitGrepCLocaleWrapper wraps simple git grep on macOS with LC_ALL=C', async () => {
    const wrapped = await buildMacOsGitGrepCLocaleWrapper(
      'git grep foo src/',
      'macos',
    )
    expect(wrapped).not.toBeNull()
    expect(wrapped).toContain('/usr/bin/env')
    expect(wrapped).toContain('LC_ALL=C')

    expect(
      await buildMacOsGitGrepCLocaleWrapper('git grep foo src/', 'linux'),
    ).toBeNull()
    expect(
      await buildMacOsGitGrepCLocaleWrapper('git grep -P foo', 'macos'),
    ).toBeNull()
    expect(
      await buildMacOsGitGrepCLocaleWrapper('git status', 'macos'),
    ).toBeNull()
  })
})
