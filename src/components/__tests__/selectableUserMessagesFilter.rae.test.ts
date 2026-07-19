/**
 * densable RAe residual: selectableUserMessagesFilter origin + stackedExpansion.
 * densable IRa: messagesAfterAreOnlySynthetic skips stackedExpansion users.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { Message, UserMessage } from '../../types/message.js'
import {
  messagesAfterAreOnlySynthetic,
  selectableUserMessagesFilter,
} from '../MessageSelector.js'
import {
  LOCAL_COMMAND_STDOUT_TAG,
  TASK_NOTIFICATION_TAG,
} from '../../constants/xml.js'

function userMsg(
  content: string,
  extra: Record<string, unknown> = {},
): UserMessage {
  return {
    type: 'user',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: { role: 'user', content },
    ...extra,
  } as unknown as UserMessage
}

function assistantText(text: string): Message {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  } as unknown as Message
}

describe('selectableUserMessagesFilter densable RAe', () => {
  test('keeps plain human / undefined origin / human origin', () => {
    expect(selectableUserMessagesFilter(userMsg('fix login'))).toBe(true)
    expect(
      selectableUserMessagesFilter(userMsg('fix login', { origin: { kind: 'human' } })),
    ).toBe(true)
  })

  test('rejects non-human origins (agent/channel/peer)', () => {
    expect(
      selectableUserMessagesFilter(userMsg('x', { origin: { kind: 'agent' } })),
    ).toBe(false)
    expect(
      selectableUserMessagesFilter(
        userMsg('x', { origin: { kind: 'channel' } }),
      ),
    ).toBe(false)
    expect(
      selectableUserMessagesFilter(userMsg('x', { origin: { kind: 'peer' } })),
    ).toBe(false)
  })

  test('rejects stackedExpansion even when human', () => {
    expect(
      selectableUserMessagesFilter(
        userMsg('expanded', {
          origin: { kind: 'human' },
          stackedExpansion: true,
        }),
      ),
    ).toBe(false)
  })

  test('still rejects jDt bases (meta / tool_result / tags)', () => {
    expect(
      selectableUserMessagesFilter(userMsg('m', { isMeta: true })),
    ).toBe(false)
    expect(
      selectableUserMessagesFilter(
        userMsg(`<${LOCAL_COMMAND_STDOUT_TAG}>ok</${LOCAL_COMMAND_STDOUT_TAG}>`),
      ),
    ).toBe(false)
    expect(
      selectableUserMessagesFilter(
        userMsg(`<${TASK_NOTIFICATION_TAG}>done`),
      ),
    ).toBe(false)
  })

  test('source anchors RAe origin + stackedExpansion', () => {
    const src = readFileSync(
      join(import.meta.dir, '../MessageSelector.tsx'),
      'utf8',
    )
    expect(src).toContain("origin.kind !== 'human'")
    expect(src).toContain('stackedExpansion')
    expect(src).toContain('densable RAe')
  })
})

describe('messagesAfterAreOnlySynthetic densable IRa stackedExpansion', () => {
  test('stackedExpansion user after last is non-blocking', () => {
    const human = userMsg('please fix')
    const stack = userMsg('stack row', { stackedExpansion: true })
    const msgs: Message[] = [human, stack]
    expect(messagesAfterAreOnlySynthetic(msgs, 0)).toBe(true)
  })

  test('real assistant text after last still blocks', () => {
    const human = userMsg('please fix')
    const asst = assistantText('I will fix that')
    expect(messagesAfterAreOnlySynthetic([human, asst], 0)).toBe(false)
  })

  test('source anchors IRa stackedExpansion skip', () => {
    const src = readFileSync(
      join(import.meta.dir, '../MessageSelector.tsx'),
      'utf8',
    )
    expect(src).toContain('densable IRa')
    expect(src).toContain('stackedExpansion')
  })
})
