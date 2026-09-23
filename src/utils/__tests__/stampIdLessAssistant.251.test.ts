/**
 * densable 2.1.251 #24 — aVn stamps message.id on id-less assistant tool
 * calls before send. No fields other than message.id are added.
 */
import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '../../entrypoints/agentSdkTypes.js'
import { normalizeMessagesForAPI } from '../messages.js'
import { toInternalMessages } from '../messages/mappers.js'
import {
  stampIdLessAssistantEntry,
  stampIdLessAssistantMessages,
} from '../conversationRecovery.js'
import type { AssistantMessage } from '../../types/message.js'

function assistantSdk(id: string | undefined, toolId: string): SDKMessage {
  return {
    type: 'assistant',
    uuid: `00000000-0000-4000-8000-${toolId.padStart(12, '0')}`,
    message: {
      role: 'assistant',
      ...(id !== undefined ? { id } : {}),
      content: [
        {
          type: 'tool_use',
          id: toolId,
          name: 'Bash',
          input: { command: toolId },
        },
      ],
    },
  } as SDKMessage
}

describe('densable 2.1.251 #24 stamp id-less assistant messages', () => {
  test('stamps only message.id when requestId is absent', () => {
    const entry = {
      type: 'assistant',
      message: { role: 'assistant', content: [] as unknown[] },
    }
    const stamped = stampIdLessAssistantEntry(entry)
    const stampedMessage = stamped.message as { id?: string }
    expect(stamped).not.toBe(entry)
    expect(typeof stampedMessage.id).toBe('string')
    expect((stampedMessage.id ?? '').length).toBeGreaterThan(0)
    expect(Object.keys(stamped).sort()).toEqual(Object.keys(entry).sort())
    expect(Object.keys(stamped.message).sort()).toEqual([
      'content',
      'id',
      'role',
    ])
  })

  test('does not stamp when requestId is set or id is already present', () => {
    const withRequest = {
      type: 'assistant',
      requestId: 'req-1',
      message: { id: '' },
    }
    expect(stampIdLessAssistantEntry(withRequest)).toBe(withRequest)
    const withId = {
      type: 'assistant',
      message: { id: 'msg_keep' },
    }
    expect(stampIdLessAssistantEntry(withId)).toBe(withId)
  })

  test('empty id is stamped; the gold log count uses y/ies', () => {
    const [one] = stampIdLessAssistantMessages([
      { type: 'assistant', message: { id: '' } },
    ])
    expect(one?.message.id).not.toBe('')
    const many = stampIdLessAssistantMessages([
      { type: 'assistant', message: {} },
      { type: 'user', message: {} },
      { type: 'assistant', message: { id: 'keep' } },
    ])
    expect(typeof many[0]?.message.id).toBe('string')
    expect(many[1]).toEqual({ type: 'user', message: {} })
    expect(many[2]?.message.id).toBe('keep')
  })

  test('toInternalMessages stamps before same-id merge would collapse them', () => {
    const internal = toInternalMessages([
      assistantSdk(undefined, 'tool-a'),
      assistantSdk('', 'tool-b'),
    ])
    const assistants = internal.filter(
      (message): message is AssistantMessage => message.type === 'assistant',
    )
    expect(assistants).toHaveLength(2)
    expect(assistants[0]?.message.id).toBeTruthy()
    expect(assistants[1]?.message.id).toBeTruthy()
    expect(assistants[0]?.message.id).not.toBe(assistants[1]?.message.id)

    const normalized = normalizeMessagesForAPI(assistants)
    const kept = normalized.filter(message => message.type === 'assistant')
    expect(kept).toHaveLength(2)
  })
})
