import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { resetStickyBetas } from '../../bootstrap/state.js'
import type { AttachmentMessage, Message } from '../../types/message.js'
import { isApiSystemMessage } from '../midConversationSystem.js'
import { createUserMessage, normalizeMessagesForAPI } from '../messages.js'

describe('normalizeMessagesForAPI mid-conv eN path', () => {
  afterEach(() => {
    resetStickyBetas()
    delete process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM
  })

  test('without model, no api_system is emitted', () => {
    const messages: Message[] = [
      createUserMessage({ content: 'hello' }),
      {
        type: 'attachment',
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
        attachment: {
          type: 'critical_system_reminder',
          content: 'pure meta text for buffer',
        },
      } as unknown as AttachmentMessage,
    ]
    const out = normalizeMessagesForAPI(messages, [])
    expect(out.every(m => m.type !== 'api_system')).toBe(true)
  })

  test('with FORCE + model, pure-text attachment after user becomes api_system', () => {
    process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM = '1'
    const messages: Message[] = [
      createUserMessage({ content: 'hello' }),
      {
        type: 'attachment',
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
        attachment: {
          type: 'critical_system_reminder',
          content: 'pure meta text for buffer',
        },
      } as unknown as AttachmentMessage,
    ]
    const out = normalizeMessagesForAPI(messages, [], 'claude-mythos-5')
    const sys = out.find(isApiSystemMessage)
    expect(sys).toBeDefined()
    expect(sys!.message.content).toContain('pure meta text for buffer')
    // densable: user then api_system
    const userIdx = out.findIndex(m => m.type === 'user')
    const sysIdx = out.findIndex(isApiSystemMessage)
    expect(userIdx).toBeGreaterThanOrEqual(0)
    expect(sysIdx).toBeGreaterThan(userIdx)
  })
})
