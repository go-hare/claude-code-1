/**
 * densable 2.1.228 #11 — St mid-turn toolResults keep skill deferred_tools_delta.
 */
import { describe, expect, mock, test } from 'bun:test'

mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

import { accumulateToolResultForMidTurn } from '../accumulateToolResultForMidTurn.js'
import type { AttachmentMessage, UserMessage } from '../../types/message.js'
import type { Tools } from '../../Tool.js'

function dtdAttachment(name = 'mcp__x__t'): AttachmentMessage {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-0000000000aa',
    timestamp: new Date().toISOString(),
    attachment: {
      type: 'deferred_tools_delta',
      addedNames: [name],
      addedLines: [`${name} — desc`],
      removedNames: [],
    },
  } as AttachmentMessage
}

function userMsg(text: string): UserMessage {
  return {
    type: 'user',
    uuid: '00000000-0000-4000-8000-0000000000bb',
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: text },
  } as UserMessage
}

describe('accumulateToolResultForMidTurn densable St (2.1.228 #11)', () => {
  test('pushes deferred_tools_delta attachment raw so mid-turn scan can see it', () => {
    const toolResults: Array<UserMessage | AttachmentMessage> = []
    const att = dtdAttachment()
    accumulateToolResultForMidTurn(att, toolResults, [] as unknown as Tools)
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]).toBe(att)
    expect(toolResults[0]!.type).toBe('attachment')
    expect((toolResults[0] as AttachmentMessage).attachment.type).toBe(
      'deferred_tools_delta',
    )
  })

  test('skips virtual user messages (densable pPr/kWt)', () => {
    const toolResults: Array<UserMessage | AttachmentMessage> = []
    const virtual = {
      ...userMsg('inner'),
      isVirtual: true,
    } as UserMessage & { isVirtual: true }
    accumulateToolResultForMidTurn(virtual, toolResults, [] as unknown as Tools)
    expect(toolResults).toEqual([])
  })

  test('normal user messages still accumulate as user after normalize', () => {
    const toolResults: Array<UserMessage | AttachmentMessage> = []
    const u = userMsg('hello')
    accumulateToolResultForMidTurn(u, toolResults, [] as unknown as Tools)
    expect(toolResults.length).toBeGreaterThanOrEqual(1)
    expect(toolResults.every(m => m.type === 'user')).toBe(true)
  })
})
