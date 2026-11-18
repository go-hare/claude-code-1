import { afterEach, describe, expect, test } from 'bun:test'
import {
  checkDangerousAwkInCommand,
  checkDangerousAwkProgram,
  checkDangerousRmInShellDashC,
  shouldPromptUnreadableShellDashC,
} from '../bashPermissions.js'

describe('BashTool Wave 4A (#594, #673)', () => {
  const prevStrict = process.env.CLAUDE_CODE_STRICT_INLINE_SHELL_RM_PROMPT

  afterEach(() => {
    if (prevStrict === undefined) {
      delete process.env.CLAUDE_CODE_STRICT_INLINE_SHELL_RM_PROMPT
    } else {
      process.env.CLAUDE_CODE_STRICT_INLINE_SHELL_RM_PROMPT = prevStrict
    }
  })

  test('#594 shouldPromptUnreadableShellDashC skips non-rm unreadable scripts unless strict mode is enabled', () => {
    delete process.env.CLAUDE_CODE_STRICT_INLINE_SHELL_RM_PROMPT
    expect(shouldPromptUnreadableShellDashC('bash -c "echo $FOO"')).toBe(false)
    expect(shouldPromptUnreadableShellDashC('bash -c "r\'m\' -rf /"')).toBe(
      true,
    )
    expect(shouldPromptUnreadableShellDashC("bash -c $'\\x72m -rf /'")).toBe(
      true,
    )

    process.env.CLAUDE_CODE_STRICT_INLINE_SHELL_RM_PROMPT = '1'
    expect(shouldPromptUnreadableShellDashC('bash -c "echo $FOO"')).toBe(true)
    const strictRes = checkDangerousRmInShellDashC(
      'bash -c "bash -c \'bash -c \\"bash -c echo\\"\'"',
    )
    expect(strictRes?.behavior).toBe('ask')
  })

  test('#673 checkDangerousAwkProgram refuses system, pipes, @load/@include/@indirect, extension(), and /inet/', () => {
    expect(checkDangerousAwkProgram('{ print $1 }')).toBe(false)
    expect(checkDangerousAwkProgram('{ system("id") }')).toContain('system()')
    expect(checkDangerousAwkProgram('{ "id" | getline x }')).toContain(
      'getline',
    )
    expect(checkDangerousAwkProgram('@load "filefuncs"')).toContain('@load')
    expect(checkDangerousAwkProgram('@include "evil.awk"')).toContain(
      '@include',
    )
    expect(checkDangerousAwkProgram('{ @fn() }')).toContain('@indirect')
    expect(checkDangerousAwkProgram('{ extension("x", "y") }')).toContain(
      'extension()',
    )
    expect(
      checkDangerousAwkProgram('{ print > "/inet/tcp/0/1.2.3.4/80" }'),
    ).toContain('/inet/')

    const askRes = checkDangerousAwkInCommand(
      'gawk \'@load "filefuncs"; BEGIN { print 1 }\'',
    )
    expect(askRes?.behavior).toBe('ask')
  })
})
