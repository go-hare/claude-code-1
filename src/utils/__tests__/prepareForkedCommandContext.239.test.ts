/**
 * densable 2.1.239 leftover — official Lto a()/isMeta/g/SXr.
 * No mock.module (shared process).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  addInvokedSkill,
  clearInvokedSkills,
  getInvokedSkillsForAgent,
} from '../../bootstrap/state.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import type { AppState } from '../../state/AppState.js'
import type { CommandBase, PromptCommand } from '../../types/command.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type { ToolUseContext } from '../../Tool.js'
import { createUserMessage } from '../messages.js'
import { prepareForkedCommandContext } from '../forkedAgent.js'

function forkCmd(
  overrides: Partial<CommandBase & PromptCommand> = {},
): CommandBase & PromptCommand {
  return {
    type: 'prompt',
    name: 'demo',
    description: 'demo',
    progressMessage: 'running',
    contentLength: 0,
    source: 'builtin',
    context: 'fork',
    getPromptForCommand: async () => [{ type: 'text', text: 'SKILL BODY' }],
    ...overrides,
  }
}

function agent(): AgentDefinition {
  return {
    agentType: 'general-purpose',
    source: 'built-in',
    baseDir: 'built-in',
    whenToUse: 'general',
    getSystemPrompt: () => '',
  }
}

function ctx(agentId?: string): ToolUseContext {
  return {
    agentId,
    getAppState: () =>
      ({
        toolPermissionContext: getEmptyToolPermissionContext(),
      }) as unknown as AppState,
    options: {
      tools: [],
      agentDefinitions: { activeAgents: [agent()] },
    },
  } as unknown as ToolUseContext
}

afterEach(() => {
  clearInvokedSkills()
})

describe('densable 2.1.239 Lto leftover', () => {
  test('prompt isMeta and first a() records empty iXe content', async () => {
    const prepared = await prepareForkedCommandContext(forkCmd(), '', ctx())
    expect(prepared.promptMessages[0]?.isMeta).toBe(true)
    expect(prepared.promptMessages).toHaveLength(1)
    const stored = getInvokedSkillsForAgent(null).get(':demo')
    expect(stored?.content).toBe('')
    expect(stored?.skillPath).toBe('builtin:demo')
    expect(prepared.forkReadFileState.size).toBe(0)
  })

  test('a() keeps previously cached invoked content', async () => {
    addInvokedSkill('demo', 'builtin:demo', 'PRIOR', null)
    await prepareForkedCommandContext(forkCmd(), '', ctx())
    expect(getInvokedSkillsForAgent(null).get(':demo')?.content).toBe('PRIOR')
  })

  test('deferInvocationRecording skips a() until recordInvocation', async () => {
    const prepared = await prepareForkedCommandContext(forkCmd(), '', ctx(), {
      deferInvocationRecording: true,
    })
    expect(getInvokedSkillsForAgent(null).get(':demo')).toBeUndefined()
    prepared.recordInvocation()
    expect(getInvokedSkillsForAgent(null).get(':demo')?.content).toBe('')
  })

  test('extractAttachments collect + drop isPartialView from g', async () => {
    const att = createUserMessage({ content: 'att', isMeta: true })
    const prepared = await prepareForkedCommandContext(forkCmd(), '', ctx(), {
      deferInvocationRecording: true,
      extractAttachments: (_skill, context) => {
        context.readFileState.set('partial.md', {
          content: 'p',
          timestamp: 1,
          offset: 1,
          limit: undefined,
          isPartialView: true,
        })
        context.readFileState.set('full.md', {
          content: 'f',
          timestamp: 1,
          offset: 1,
          limit: undefined,
        })
        return [att]
      },
    })
    expect(prepared.promptMessages).toHaveLength(2)
    expect(prepared.promptMessages[1]).toBe(att)
    expect(prepared.forkReadFileState.has('partial.md')).toBe(false)
    expect(prepared.forkReadFileState.has('full.md')).toBe(true)
  })
})
