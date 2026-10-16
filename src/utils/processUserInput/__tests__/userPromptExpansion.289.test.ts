/**
 * densable 2.1.289 Ze / AMr / QH — UserPromptExpansion hook executor.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { HOOK_EVENTS as sdkEvents } from '../../../entrypoints/agentSdkTypes.js'
import {
  HOOK_EVENTS,
  UserPromptExpansionHookInputSchema,
  UserPromptExpansionHookSpecificOutputSchema,
} from '../../../entrypoints/sdk/coreSchemas.js'
import { HOOK_EVENTS as typeEvents } from '../../../entrypoints/sdk/coreTypes.js'
import { hookJSONOutputSchema } from '../../../types/hooks.js'

const root = join(import.meta.dir, '../../..')

describe('densable 2.1.289 UserPromptExpansion registry', () => {
  test('HOOK_EVENTS sits immediately after UserPromptSubmit', () => {
    for (const events of [HOOK_EVENTS, typeEvents, sdkEvents]) {
      const list = events as readonly string[]
      const at = list.indexOf('UserPromptSubmit')
      expect(at).toBeGreaterThan(-1)
      expect(list[at + 1]).toBe('UserPromptExpansion')
    }
  })

  test('QH input schema accepts slash_command and mcp_prompt', () => {
    const base = {
      session_id: 'sess',
      transcript_path: '/tmp/t.jsonl',
      cwd: '/tmp',
      hook_event_name: 'UserPromptExpansion' as const,
      command_name: 'review',
      command_args: 'foo',
      prompt: '/review foo',
    }
    expect(
      UserPromptExpansionHookInputSchema().safeParse({
        ...base,
        expansion_type: 'slash_command',
      }).success,
    ).toBe(true)
    expect(
      UserPromptExpansionHookInputSchema().safeParse({
        ...base,
        expansion_type: 'mcp_prompt',
        command_source: 'mcp',
      }).success,
    ).toBe(true)
    expect(
      UserPromptExpansionHookInputSchema().safeParse({
        ...base,
        expansion_type: 'nope',
      }).success,
    ).toBe(false)
  })

  test('NK specific output parses additionalContext + suppressOriginalPrompt', () => {
    const parsed = UserPromptExpansionHookSpecificOutputSchema().safeParse({
      hookEventName: 'UserPromptExpansion',
      additionalContext: 'ctx',
      suppressOriginalPrompt: true,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.additionalContext).toBe('ctx')
      expect(parsed.data.suppressOriginalPrompt).toBe(true)
    }

    const json = hookJSONOutputSchema().safeParse({
      decision: 'block',
      reason: 'no',
      hookSpecificOutput: {
        hookEventName: 'UserPromptExpansion',
        suppressOriginalPrompt: true,
      },
    })
    expect(json.success).toBe(true)
  })
})

describe('densable 2.1.289 Ze / AMr host', () => {
  test('hooks.ts implements AMr + Ze 1:1 with gold', () => {
    const src = readFileSync(join(root, 'utils/hooks.ts'), 'utf8')
    expect(src).toContain("hook_event_name: 'UserPromptExpansion'")
    expect(src).toContain('expansion_type: expansionType')
    expect(src).toContain('executeUserPromptExpansionHooks')
    expect(src).toContain('runUserPromptExpansionHook')
    expect(src).toContain('getUserPromptExpansionHookBlockingMessage')
    expect(src).toContain(
      "command.source === 'mcp' ? 'mcp_prompt' : 'slash_command'",
    )
    expect(src).toContain('UserPromptExpansion operation blocked by hook:')
    expect(src).toContain(
      'UserPromptExpansion hooks cancelled (control stream closed)',
    )
    expect(src).toContain("case 'UserPromptExpansion':")
    expect(src).toContain('return hookInput.command_name')
    expect(src).toContain("'for UserPromptExpansion':")
  })

  test('processSlashCommand wires first-command + stacked Ze', () => {
    const src = readFileSync(
      join(root, 'utils/processUserInput/processSlashCommand.tsx'),
      'utf8',
    )
    expect(src).toContain('runUserPromptExpansionHook')
    expect(src).toContain('logCmdHookBlocked(command.name)')
    expect(src).toContain("error_code: 'cmd_hook_blocked'")
    expect(src).toContain(
      'Stacked skill /${getCommandName(stackedCommand)} blocked by UserPromptExpansion hook',
    )
    expect(src).toContain('expansion.hookMessages')
    expect(src).toContain('stackedExpansion.hookMessages')
    expect(src).toContain('...hookMessages')
  })

  test('hook_success allowlist includes UserPromptExpansion', () => {
    const src = readFileSync(join(root, 'utils/messages.ts'), 'utf8')
    expect(src).toContain("attachment.hookEvent !== 'UserPromptExpansion'")
  })

  test('hooksConfigManager metadata matches gold copy + command_name matcher', () => {
    const src = readFileSync(
      join(root, 'utils/hooks/hooksConfigManager.ts'),
      'utf8',
    )
    expect(src).toContain(
      "summary: 'When a user-typed slash command expands into a prompt'",
    )
    expect(src).toContain("fieldToMatch: 'command_name'")
    expect(src).toContain('block expansion and show stderr to user only')
  })
})
