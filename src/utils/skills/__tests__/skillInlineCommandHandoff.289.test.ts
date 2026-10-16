import { describe, expect, test } from 'bun:test'
import { createUserMessage } from '../../messages.js'
import {
  findLastRealUserMessageIndex,
  pendingSkillInlineCommands,
  skillInlineCommandContainsPendingLine,
} from '../skillInlineCommandHandoff.js'

describe('densable 2.1.289 skill inline CDo / nQo / vDo', () => {
  test('nQo token-boundary match', () => {
    expect(skillInlineCommandContainsPendingLine('ls && pwd', 'ls')).toBe(true)
    expect(skillInlineCommandContainsPendingLine('else', 'ls')).toBe(false)
    expect(skillInlineCommandContainsPendingLine('echo hello', 'hello')).toBe(
      true,
    )
  })

  test('vDo skips meta and tool_result users', () => {
    const human = createUserMessage({ content: 'go' })
    const meta = createUserMessage({ content: 'skill', isMeta: true })
    const toolResult = {
      ...createUserMessage({ content: [] }),
      message: {
        role: 'user' as const,
        content: [
          { type: 'tool_result' as const, tool_use_id: 't', content: 'ok' },
        ],
      },
    }
    expect(
      findLastRealUserMessageIndex([human, meta, toolResult as typeof human]),
    ).toBe(0)
  })

  test('oQo leftover when tool_use did not consume the pending line', () => {
    const user = createUserMessage({
      content: 'skill',
      isMeta: true,
      promptShellHandOff: {
        agentId: null,
        commands: [{ tool: 'Bash', command: 'pwd' }],
      },
    })
    const leftover = pendingSkillInlineCommands([user], [], null)
    expect(leftover).toEqual([{ tool: 'Bash', command: 'pwd' }])
  })

  test('oQo clears when matching assistant tool_use consumes the line', () => {
    const user = createUserMessage({
      content: 'skill',
      isMeta: true,
      promptShellHandOff: {
        agentId: null,
        commands: [{ tool: 'Bash', command: 'pwd' }],
      },
    })
    const assistant = {
      type: 'assistant' as const,
      uuid: '00000000-0000-0000-0000-000000000002',
      timestamp: new Date().toISOString(),
      message: {
        role: 'assistant' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: 'tu',
            name: 'Bash',
            input: { command: 'pwd' },
          },
        ],
      },
    }
    expect(
      pendingSkillInlineCommands([user], [assistant as never], null),
    ).toEqual([])
  })
})
