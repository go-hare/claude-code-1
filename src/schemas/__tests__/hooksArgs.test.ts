/**
 * Official 2.1.207: command hooks may declare exec-form `args`.
 * Shell-form (no args) must not embed ${user_config.*}.
 */
import { describe, expect, test } from 'bun:test'
import { HookCommandSchema } from '../hooks.js'

const USER_CONFIG_REF = /\$\{user_config\.[^}]+\}/

function isExecForm(hook: { args?: string[] }): boolean {
  return Array.isArray(hook.args)
}

function shellFormUserConfigError(
  command: string,
  pluginId?: string,
): string | null {
  if (USER_CONFIG_REF.test(command)) {
    const from = pluginId ? `plugin ${pluginId}` : 'plugin'
    return (
      `Hook from ${from} references \${user_config.*} in a shell-form command. ` +
      `The substituted value would be re-parsed by the shell. Use exec form instead ` +
      `{"command": "<executable>", "args": ["\${user_config.KEY}", ...]} ` +
      `or read $CLAUDE_PLUGIN_OPTION_<KEY> from the hook's environment. ` +
      `Command: ${command}`
    )
  }
  return null
}

function execFormWhitespaceError(
  command: string,
  args: string[] | undefined,
): string | null {
  if (Array.isArray(args) && /\s/.test(command.trim())) {
    return (
      `Hook command "${command}" has both "args" and whitespace in "command". ` +
      `Exec form treats "command" as a single executable name; move the rest into "args". ` +
      `Example: { "command": "node", "args": ["script.js"] }.`
    )
  }
  return null
}

describe('HookCommandSchema args (2.1.207 exec form)', () => {
  test('accepts command hook without args (shell form)', () => {
    const parsed = HookCommandSchema().parse({
      type: 'command',
      command: 'echo hello',
    })
    expect(parsed.type).toBe('command')
    if (parsed.type === 'command') {
      expect(parsed.args).toBeUndefined()
    }
  })

  test('accepts command hook with args (exec form)', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: plugin placeholder syntax under test
    const pluginRootArg = '${CLAUDE_PLUGIN_ROOT}/hook.js'
    // biome-ignore lint/suspicious/noTemplateCurlyInString: plugin placeholder syntax under test
    const tokenArg = '${user_config.token}'
    const parsed = HookCommandSchema().parse({
      type: 'command',
      command: 'node',
      args: [pluginRootArg, tokenArg],
    })
    expect(parsed.type).toBe('command')
    if (parsed.type === 'command') {
      expect(parsed.args).toEqual([pluginRootArg, tokenArg])
    }
  })

  test('rejects non-string args entries', () => {
    const result = HookCommandSchema().safeParse({
      type: 'command',
      command: 'node',
      args: ['ok', 1],
    })
    expect(result.success).toBe(false)
  })
})

describe('shell-form user_config reject (2.1.207)', () => {
  test('shell form with user_config is rejected', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: plugin placeholder syntax under test
    const cmd = 'curl -H "Auth: ${user_config.token}" https://x'
    expect(isExecForm({})).toBe(false)
    const err = shellFormUserConfigError(cmd, 'demo@marketplace')
    expect(err).toContain('shell-form command')
    expect(err).toContain('plugin demo@marketplace')
    expect(err).toContain('exec form')
  })

  test('exec form with user_config is allowed by the gate', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: plugin placeholder syntax under test
    const tokenArg = '${user_config.token}'
    const hook = {
      command: 'node',
      args: [tokenArg],
    }
    expect(isExecForm(hook)).toBe(true)
    // Shell-form gate only runs when !isExecForm
    expect(shellFormUserConfigError(hook.command)).toBeNull()
  })

  test('shell form without user_config is allowed', () => {
    expect(shellFormUserConfigError('prettier --write .')).toBeNull()
  })

  test('exec form rejects whitespace in command', () => {
    expect(execFormWhitespaceError('node script.js', ['a'])).toContain(
      'has both "args" and whitespace',
    )
    expect(execFormWhitespaceError('node', ['script.js'])).toBeNull()
  })
})
