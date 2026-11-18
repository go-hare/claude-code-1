import { afterEach, describe, expect, test } from 'bun:test'
import {
  checkDangerousRmInShellDashC,
  extractShellDashCScripts,
  shouldPromptUnreadableShellDashC,
} from '../bashPermissions.js'

describe('BashTool #594 1:1 SEA OAe/Wnt/VSr/PAe/qSr alignment', () => {
  const prevDisable = process.env.CLAUDE_CODE_DISABLE_INLINE_SHELL_RM_PROMPT
  const prevStrict = process.env.CLAUDE_CODE_STRICT_INLINE_SHELL_RM_PROMPT

  afterEach(() => {
    if (prevDisable === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_INLINE_SHELL_RM_PROMPT
    } else {
      process.env.CLAUDE_CODE_DISABLE_INLINE_SHELL_RM_PROMPT = prevDisable
    }
    if (prevStrict === undefined) {
      delete process.env.CLAUDE_CODE_STRICT_INLINE_SHELL_RM_PROMPT
    } else {
      process.env.CLAUDE_CODE_STRICT_INLINE_SHELL_RM_PROMPT = prevStrict
    }
  })

  test("marks $'...' ANSI-C escape strings as unreadable and prompts on rm / escape", () => {
    const hexRm = extractShellDashCScripts("bash -c $'\\x72m -rf /'")
    expect(hexRm.hadShellDashC).toBe(true)
    expect(hexRm.unreadable).toBe(true)
    expect(
      checkDangerousRmInShellDashC("bash -c $'\\x72m -rf /'")?.behavior,
    ).toBe('ask')

    const plainRm = extractShellDashCScripts("bash -c $'rm -rf /'")
    expect(plainRm.hadShellDashC).toBe(true)
    expect(plainRm.unreadable).toBe(true)
    expect(checkDangerousRmInShellDashC("bash -c $'rm -rf /'")?.behavior).toBe(
      'ask',
    )

    const safeAnsiC = extractShellDashCScripts("bash -c $'echo hi'")
    expect(safeAnsiC.hadShellDashC).toBe(true)
    expect(safeAnsiC.unreadable).toBe(true)
    expect(checkDangerousRmInShellDashC("bash -c $'echo hi'")).toBeNull()
  })

  test('marks non-simple/control-flow sh -c scripts (if/for/eval) as unreadable and prompts on rm', () => {
    for (const cmd of [
      'sh -c "if true; then rm -rf /; fi"',
      'bash -c "for x in a; do rm -rf /; done"',
      'bash -c "eval \'rm -rf /\'"',
    ]) {
      const extracted = extractShellDashCScripts(cmd)
      expect(extracted.hadShellDashC).toBe(true)
      expect(extracted.unreadable).toBe(true)
      expect(checkDangerousRmInShellDashC(cmd)?.behavior).toBe('ask')
    }

    const safeIf = extractShellDashCScripts(
      'bash -c "if true; then echo hi; fi"',
    )
    expect(safeIf.unreadable).toBe(true)
    expect(
      checkDangerousRmInShellDashC('bash -c "if true; then echo hi; fi"'),
    ).toBeNull()
  })

  test('stops -c flag scan at -- / - and positional args, skips option args, and marks unknown -- flags unreadable', () => {
    expect(
      extractShellDashCScripts('bash -- -c "rm -rf /"').hadShellDashC,
    ).toBe(false)
    expect(extractShellDashCScripts('bash - -c "rm -rf /"').hadShellDashC).toBe(
      false,
    )
    expect(
      extractShellDashCScripts('bash script.sh -c "rm -rf /"').hadShellDashC,
    ).toBe(false)

    expect(
      extractShellDashCScripts('bash --rcfile /tmp/rc -c "rm -rf /"').scripts,
    ).toEqual(['rm -rf /'])
    expect(
      extractShellDashCScripts('bash --init-file /tmp/init -c "rm -rf /"')
        .scripts,
    ).toEqual(['rm -rf /'])
    expect(
      extractShellDashCScripts('bash -o errexit -c "rm -rf /"').scripts,
    ).toEqual(['rm -rf /'])
    expect(
      checkDangerousRmInShellDashC('bash --rcfile /tmp/rc -c "rm -rf /"')
        ?.behavior,
    ).toBe('ask')

    const unknownFlag = extractShellDashCScripts(
      'bash --unknown-flag -c "rm -rf /"',
    )
    expect(unknownFlag.hadShellDashC).toBe(true)
    expect(unknownFlag.unreadable).toBe(true)
    expect(
      checkDangerousRmInShellDashC('bash --unknown-flag -c "rm -rf /"')
        ?.behavior,
    ).toBe('ask')

    const unknownFlagSafe = extractShellDashCScripts(
      'bash --unknown-flag -c "echo hi"',
    )
    expect(unknownFlagSafe.unreadable).toBe(true)
    expect(
      checkDangerousRmInShellDashC('bash --unknown-flag -c "echo hi"'),
    ).toBeNull()
  })

  test('honors CLAUDE_CODE_DISABLE_INLINE_SHELL_RM_PROMPT and CLAUDE_CODE_STRICT_INLINE_SHELL_RM_PROMPT', () => {
    process.env.CLAUDE_CODE_DISABLE_INLINE_SHELL_RM_PROMPT = '1'
    expect(checkDangerousRmInShellDashC('bash -c "rm -rf /"')).toBeNull()
    delete process.env.CLAUDE_CODE_DISABLE_INLINE_SHELL_RM_PROMPT

    delete process.env.CLAUDE_CODE_STRICT_INLINE_SHELL_RM_PROMPT
    expect(shouldPromptUnreadableShellDashC('bash -c "echo hi"')).toBe(false)

    process.env.CLAUDE_CODE_STRICT_INLINE_SHELL_RM_PROMPT = '1'
    expect(shouldPromptUnreadableShellDashC('bash -c "echo hi"')).toBe(true)
    expect(
      checkDangerousRmInShellDashC('bash -c "if true; then echo hi; fi"')
        ?.behavior,
    ).toBe('ask')
  })
})
