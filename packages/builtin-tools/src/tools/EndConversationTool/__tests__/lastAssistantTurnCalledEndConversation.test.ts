import { describe, expect, test } from 'bun:test'
import type { Message } from 'src/types/message.js'
import { lastAssistantTurnCalledEndConversation } from '../lastAssistantTurnCalledEndConversation.js'

function assistantWithTools(names: string[]): Message {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      id: 'm',
      type: 'message',
      role: 'assistant',
      content: names.map((name, i) => ({
        type: 'tool_use' as const,
        id: `tu_${i}`,
        name,
        input: {},
      })),
      model: 'claude-opus-4-8',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  } as Message
}

function userText(text: string): Message {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: text,
    },
  } as Message
}

function userToolResults(ids: string[]): Message {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: ids.map(id => ({
        type: 'tool_result' as const,
        tool_use_id: id,
        content: 'ok',
      })),
    },
  } as Message
}

describe('lastAssistantTurnCalledEndConversation', () => {
  test('false on empty', () => {
    expect(lastAssistantTurnCalledEndConversation([])).toBe(false)
  })

  test('true when previous assistant in turn used EndConversation', () => {
    const msgs = [
      userText('hi'),
      assistantWithTools(['EndConversation']),
      userToolResults(['tu_0']),
    ]
    expect(lastAssistantTurnCalledEndConversation(msgs)).toBe(true)
  })

  test('false when last assistant used other tools only', () => {
    const msgs = [
      userText('hi'),
      assistantWithTools(['Bash']),
      userToolResults(['tu_0']),
    ]
    expect(lastAssistantTurnCalledEndConversation(msgs)).toBe(false)
  })

  test('false after a new user text turn', () => {
    const msgs = [
      userText('hi'),
      assistantWithTools(['EndConversation']),
      userToolResults(['tu_0']),
      userText('more abuse'),
    ]
    expect(lastAssistantTurnCalledEndConversation(msgs)).toBe(false)
  })

  test('true across multi-assistant same turn with tool_results only', () => {
    // First assistant called EndConversation (reflect), second has no EndConversation
    // but tool_results only between — densable: once saw assistant without EC and
    // only tool_results, returns false on user; if EC is on a later assistant:
    const msgs = [
      userText('hi'),
      assistantWithTools(['Bash']),
      userToolResults(['tu_0']),
      assistantWithTools(['EndConversation']),
      userToolResults(['tu_0']),
    ]
    expect(lastAssistantTurnCalledEndConversation(msgs)).toBe(true)
  })
})
