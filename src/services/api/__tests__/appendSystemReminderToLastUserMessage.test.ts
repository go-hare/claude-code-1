/**
 * Tests for appendSystemReminderToLastUserMessage — the deferred-tools
 * SR injection helper that replaces the prior pattern of appending a
 * standalone synthetic user message at the tail of the request.
 *
 * Bug background: a request that ends in a user-role message whose only
 * content is a `<system-reminder>` (no real user text, no tool_result)
 * triggers a bare-ack failure mode: the model emits "OK" / "Got it." as
 * its entire reply, swallowing the actual user message that preceded it
 * in the conversation. The helper attaches the SR text onto the last
 * existing user message instead, so the request never ends on a
 * synthetic SR-only turn.
 */
import { describe, expect, test } from 'bun:test'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { appendSystemReminderToLastUserMessage } from '../claude.js'
import type { AssistantMessage, UserMessage } from '../../../types/message.js'

const SR =
  '<system-reminder>\n<available-deferred-tools>\nFoo\n</available-deferred-tools>\n</system-reminder>'

function userMsg(content: UserMessage['message']['content']): UserMessage {
  return {
    type: 'user',
    message: { role: 'user', content },
    uuid: '00000000-0000-0000-0000-000000000000',
    timestamp: '2026-05-17T00:00:00.000Z',
  } as UserMessage
}

function assistantMsg(
  content: AssistantMessage['message']['content'],
): AssistantMessage {
  return {
    type: 'assistant',
    message: { role: 'assistant', content },
    uuid: '00000000-0000-0000-0000-000000000001',
    timestamp: '2026-05-17T00:00:00.000Z',
  } as AssistantMessage
}

describe('appendSystemReminderToLastUserMessage', () => {
  test('returns input unchanged when message list is empty', () => {
    const result = appendSystemReminderToLastUserMessage([], SR)
    expect(result).toEqual([])
  })

  test('returns input unchanged when tail is an assistant message', () => {
    const tail = assistantMsg([{ type: 'text', text: 'thinking…' }])
    const messages = [userMsg('first'), tail]
    const result = appendSystemReminderToLastUserMessage(messages, SR)
    expect(result).toBe(messages)
  })

  test('does NOT append a new user message — array length is preserved', () => {
    const messages = [userMsg('hello')]
    const result = appendSystemReminderToLastUserMessage(messages, SR)
    expect(result.length).toBe(messages.length)
  })

  test('hoists string content to a 2-block array with original text + SR block', () => {
    const messages = [userMsg('hello')]
    const result = appendSystemReminderToLastUserMessage(messages, SR)
    const last = result[0]
    expect(last.message.role).toBe('user')
    const content = last.message.content as TextBlockParam[]
    expect(Array.isArray(content)).toBe(true)
    expect(content.length).toBe(2)
    expect(content[0]).toEqual({ type: 'text', text: 'hello' })
    expect(content[1]).toEqual({ type: 'text', text: SR })
  })

  test('appends SR block as the last element of an existing array content', () => {
    const messages = [
      userMsg([
        { type: 'text', text: 'context' },
        {
          type: 'tool_result',
          tool_use_id: 'tu_1',
          content: 'result',
        },
      ]),
    ]
    const result = appendSystemReminderToLastUserMessage(messages, SR)
    const content = result[0].message.content as Array<{
      type: string
      text?: string
    }>
    expect(content.length).toBe(3)
    expect(content[0]).toEqual({ type: 'text', text: 'context' })
    expect(content[1].type).toBe('tool_result')
    expect(content[2]).toEqual({ type: 'text', text: SR })
  })

  test('only mutates the last user message — earlier messages stay identical (reference-equal)', () => {
    const earlier1 = userMsg('first')
    const earlier2 = assistantMsg([{ type: 'text', text: 'reply' }])
    const tail = userMsg('last')
    const messages = [earlier1, earlier2, tail]
    const result = appendSystemReminderToLastUserMessage(messages, SR)
    expect(result[0]).toBe(earlier1)
    expect(result[1]).toBe(earlier2)
    expect(result[2]).not.toBe(tail)
  })

  test('does not mutate the input message in place', () => {
    const tail = userMsg('last')
    const before = tail.message.content
    appendSystemReminderToLastUserMessage([tail], SR)
    expect(tail.message.content).toBe(before)
  })

  test('preserves empty string content as empty text block (does not collapse to single SR block)', () => {
    const messages = [userMsg('')]
    const result = appendSystemReminderToLastUserMessage(messages, SR)
    const content = result[0].message.content as TextBlockParam[]
    expect(content.length).toBe(2)
    expect(content[0]).toEqual({ type: 'text', text: '' })
    expect(content[1]).toEqual({ type: 'text', text: SR })
  })
})
