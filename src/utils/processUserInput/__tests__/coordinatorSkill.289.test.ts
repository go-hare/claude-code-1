import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { executeShellCommandsInPrompt } from '../../promptShellExecution.js'
import { LaunchOptions } from '../../sessionHost.js'
import { processPromptSlashCommand } from '../processSlashCommand.js'
import type { Command } from '../../../commands.js'
import type { ToolUseContext } from '../../../Tool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const skillCallSource = readFileSync(
  join(
    __dirname,
    '../../../../packages/builtin-tools/src/tools/SkillTool/SkillTool.ts',
  ),
  'utf-8',
)
const slashSource = readFileSync(
  join(__dirname, '../processSlashCommand.tsx'),
  'utf-8',
)

describe('densable 2.1.289 Skill call / Le structure', () => {
  test('Skill call saves activeSkill, skips fork on IQ, passes I, restores in finally', () => {
    expect(skillCallSource).toContain(
      'const previousActiveSkill = context.options.activeSkill',
    )
    expect(skillCallSource).toContain(
      'context.options.activeSkill = commandName',
    )
    expect(skillCallSource).toContain(
      'isCoordinatorMainThread(context.agentId)',
    )
    expect(skillCallSource).toContain(
      "resolveSkillExecutionContext(command, args || '', context) === 'fork'",
    )
    expect(skillCallSource).toContain('!coordinatorMain')
    expect(skillCallSource).toContain('coordinatorMain,')
    expect(skillCallSource).toContain('if (coordinatorMain || !dispatched)')
    expect(skillCallSource).toContain(
      'context.options.activeSkill = previousActiveSkill',
    )
    expect(skillCallSource).toContain('readOnly: true')
    expect(skillCallSource).toContain(
      'coordinatorMain ? undefined : processedCommand.effort',
    )
  })

  test('Le is IQ && !I; I loads body with empty allowedTools and no hooks', () => {
    expect(slashSource).toContain(
      "resolveSkillExecutionContext(command, trailingArgs, context) === 'fork'",
    )
    expect(slashSource).toContain('!isCoordinatorMainThread(context.agentId)')
    expect(slashSource).toContain(
      'isCoordinatorMainThread(context.agentId) && !readOnlySkillLoad',
    )
    expect(slashSource).toContain(
      'isSkillPreload: true, readOnlySkillLoad: true',
    )
    expect(slashSource).toContain('!readOnlySkillLoad')
    expect(slashSource).toContain('readOnlySkillLoad')
    expect(slashSource).toContain(
      'disallowedTools: parseToolListFromCLI(command.disallowedTools ?? [])',
    )
    expect(slashSource).toContain('resolveSkillEffort(command, args, context)')
    expect(slashSource).toContain('promptShellHandOff,')
    expect(slashSource).toContain(
      'command.getEffort?.(trailingArgs, context) === undefined',
    )
    expect(slashSource).toContain('shouldSkipSkillAttachments(command)')
  })

  test('nue strips preamble shell when readOnlySkillLoad', async () => {
    const out = await executeShellCommandsInPrompt(
      'hello !`echo hi` world',
      {
        options: { readOnlySkillLoad: true, tools: [] },
      } as unknown as ToolUseContext,
      '/test-skill',
    )
    expect(out).toContain('[shell command execution disabled by policy]')
    expect(out).not.toContain('!`')
  })

  test('LaunchOptions.diskless() defaults false', () => {
    const opts = new LaunchOptions()
    expect(opts.diskless()).toBe(false)
    opts.replaceDiskless(true)
    expect(opts.diskless()).toBe(true)
    opts.reset()
    expect(opts.diskless()).toBe(false)
  })

  test('readOnlySkillLoad load path returns body without grants', async () => {
    const command = {
      type: 'prompt',
      name: 'gold-readonly-skill',
      description: 'd',
      allowedTools: ['Bash'],
      disallowedTools: ['Edit'],
      hooks: { PreToolUse: [] },
      userInvocable: true,
      getPromptForCommand: async () => [
        { type: 'text' as const, text: 'SKILL BODY' },
      ],
    } as unknown as Command
    const result = await processPromptSlashCommand(
      'gold-readonly-skill',
      '',
      [command],
      {
        agentId: undefined,
        options: { commands: [command], tools: [] },
        messages: [],
        setAppState() {},
        getAppState: () => ({
          toolPermissionContext: {
            alwaysAllowRules: {},
            alwaysDenyRules: {},
          },
        }),
        setToolPermissionContext() {},
      } as unknown as ToolUseContext,
      [],
      true,
    )
    expect(result.shouldQuery).toBe(true)
    expect(result.allowedTools).toEqual([])
    const text = result.messages
      .flatMap(message => {
        if (message.type !== 'user' || !('message' in message)) return []
        const content = message.message.content
        if (typeof content === 'string') return [content]
        if (!Array.isArray(content)) return []
        return content
          .filter(block => block.type === 'text')
          .map(block => ('text' in block ? block.text : ''))
      })
      .join('\n')
    expect(text).toContain('SKILL BODY')
    expect(text).not.toContain('available for workers')
  })
})
