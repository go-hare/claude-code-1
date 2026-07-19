import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Message as MessageType } from 'src/types/message.js'
import { preferLongerAgentMessages } from '../syncAgentErrorRecover.js'

function msg(id: string): MessageType {
  return {
    type: 'assistant',
    uuid: id,
    message: {
      id,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: id }],
      model: 'x',
      stop_reason: null,
      stop_sequence: null,
      usage: {},
    },
  } as unknown as MessageType
}

describe('densable H6g preferLongerAgentMessages', () => {
  test('returns stream when transcript missing', () => {
    const stream = [msg('a')]
    expect(preferLongerAgentMessages(stream, undefined)).toBe(stream)
    expect(preferLongerAgentMessages(stream, null)).toBe(stream)
  })

  test('returns stream when transcript equal length', () => {
    const stream = [msg('a'), msg('b')]
    const transcript = [msg('x'), msg('y')]
    expect(preferLongerAgentMessages(stream, transcript)).toBe(stream)
  })

  test('returns stream when transcript shorter', () => {
    const stream = [msg('a'), msg('b')]
    const transcript = [msg('x')]
    expect(preferLongerAgentMessages(stream, transcript)).toBe(stream)
  })

  test('returns transcript when strictly longer (H6g)', () => {
    const stream = [msg('a')]
    const transcript = [msg('x'), msg('y'), msg('z')]
    expect(preferLongerAgentMessages(stream, transcript)).toBe(transcript)
  })

  test('empty stream prefers non-empty transcript', () => {
    const stream: MessageType[] = []
    const transcript = [msg('x')]
    expect(preferLongerAgentMessages(stream, transcript)).toBe(transcript)
  })

  test('empty transcript falls back to stream', () => {
    const stream = [msg('a')]
    expect(preferLongerAgentMessages(stream, [])).toBe(stream)
  })

  test('runAsyncAgentLifecycle wires preferLonger before finalizeAgentTool', () => {
    const utils = readFileSync(
      join(import.meta.dir, '../agentToolUtils.ts'),
      'utf8',
    )
    expect(utils).toContain('preferLongerAgentMessages')
    const h6gIdx = utils.indexOf(
      'preferLongerAgentMessages(\n      agentMessages',
    )
    const finIdx = utils.indexOf(
      'finalizeAgentTool(historyForFinalize',
      h6gIdx,
    )
    expect(h6gIdx).toBeGreaterThan(0)
    expect(finIdx).toBeGreaterThan(h6gIdx)
    // Vio throw still uses stream agentMessages (gold: Vio before H6g)
    const throwIdx = utils.indexOf(
      'throwIfLastAssistantIsApiError(agentMessages)',
    )
    expect(throwIdx).toBeGreaterThan(0)
    expect(throwIdx).toBeLessThan(h6gIdx)
  })
})
