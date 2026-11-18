import { describe, expect, test } from 'bun:test'
import type { AgentId } from '../../types/ids.js'
import type { Message } from '../../types/message.js'
import { rehydrateAgentNameRegistry } from '../sessionStorage.js'

function assistantToolUse(
  id: string,
  toolName: string,
  name: unknown,
): Message {
  return {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id,
          name: toolName,
          input: { name },
        },
      ],
    },
  } as unknown as Message
}

function userToolResult(
  toolUseId: string,
  toolUseResult: unknown,
  isError = false,
): Message {
  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          is_error: isError,
          content: 'ok',
        },
      ],
    },
    toolUseResult,
  } as unknown as Message
}

describe('2.1.299 #688 rehydrateAgentNameRegistry (xpr)', () => {
  const validAgentId = 'a0123456789abcdef' as AgentId
  const validAgentId2 = 'abuilder-0123456789abcdef' as AgentId

  test('rebuilds agentNameRegistry from Agent and Task tool_use/tool_result pairs', () => {
    const messages: Message[] = [
      assistantToolUse('tu1', 'Agent', 'researcher'),
      userToolResult('tu1', {
        status: 'async_launched',
        agentId: validAgentId,
      }),
      assistantToolUse('tu2', 'Task', 'builder'),
      userToolResult('tu2', { status: 'completed', agentId: validAgentId2 }),
    ]

    const result = rehydrateAgentNameRegistry(messages, new Map())
    expect(result).toEqual(
      new Map<string, AgentId>([
        ['researcher', validAgentId],
        ['builder', validAgentId2],
      ]),
    )
  })

  test('ignores errored tool results, reserved names, invalid agentIds, and existing entries', () => {
    const existingId = 'a9999999999999999' as AgentId
    const existing = new Map<string, AgentId>([['researcher', existingId]])

    const messages: Message[] = [
      assistantToolUse('tu1', 'Agent', 'researcher'),
      userToolResult('tu1', { status: 'completed', agentId: validAgentId }),
      assistantToolUse('tu2', 'Agent', 'team-lead'),
      userToolResult('tu2', { status: 'completed', agentId: validAgentId }),
      assistantToolUse('tu3', 'Agent', 'errored-agent'),
      userToolResult(
        'tu3',
        { status: 'completed', agentId: validAgentId },
        true,
      ),
      assistantToolUse('tu4', 'Agent', 'bad-id-agent'),
      userToolResult('tu4', {
        status: 'completed',
        agentId: 'not-an-agent-id',
      }),
    ]

    expect(rehydrateAgentNameRegistry(messages, existing)).toBeNull()
  })
})
