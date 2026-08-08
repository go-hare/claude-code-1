/**
 * densable 2.1.218 #6 — Pid/Edt: zero kept-assistant usage after message-picker
 * partial compact so getCurrentUsage does not report stale pre-compact totals.
 */
import { describe, expect, test } from 'bun:test'
import type { Message } from '../../../types/message.js'
import { getCurrentUsage } from '../../../utils/tokens.js'
import {
  buildPartialPostCompactMessages,
  zeroKeptAssistantUsage,
  type CompactionResult,
} from '../compact.js'

function assistantWithUsage(uuid: string, input: number, output = 1): Message {
  return {
    type: 'assistant',
    uuid,
    timestamp: new Date().toISOString(),
    message: {
      id: `msg-${uuid}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-7',
      content: [{ type: 'text', text: 'kept' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 20,
      },
    },
  } as Message
}

function userMsg(uuid: string, text: string): Message {
  return {
    type: 'user',
    uuid,
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: text },
  } as Message
}

function boundary(uuid: string): Message {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    uuid,
    timestamp: new Date().toISOString(),
    compactMetadata: { preTokens: 99999, trigger: 'manual' },
  } as Message
}

describe('densable 2.1.218 #6 Edt/Pid', () => {
  test('Edt zeros assistant usage fields', () => {
    const a = assistantWithUsage('a1', 50000)
    const z = zeroKeptAssistantUsage(a)
    expect(z.type).toBe('assistant')
    if (z.type !== 'assistant') return
    const usage = z.message?.usage
    expect(usage).toBeDefined()
    const u = usage as {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens: number
      cache_read_input_tokens: number
    }
    expect(u.input_tokens).toBe(0)
    expect(u.output_tokens).toBe(0)
    expect(u.cache_creation_input_tokens).toBe(0)
    expect(u.cache_read_input_tokens).toBe(0)
  })

  test('Edt leaves user messages unchanged', () => {
    const u = userMsg('u1', 'hi')
    expect(zeroKeptAssistantUsage(u)).toBe(u)
  })

  test('Pid zeros kept usage so getCurrentUsage is not stale pre-compact', () => {
    const keptAssistant = assistantWithUsage('keep-asst', 180_000)
    const summary = userMsg('sum', 'summary of earlier work')
    const b = boundary('bound')
    const result = {
      boundaryMarker: b,
      summaryMessages: [summary],
      messagesToKeep: [keptAssistant],
      attachments: [],
      hookResults: [],
    } as CompactionResult

    // Pre-fix shape (old REPL assembly without Edt) would report 180k+
    const staleUsage = getCurrentUsage([b, keptAssistant, summary] as Message[])
    expect(staleUsage?.input_tokens).toBe(180_000)

    const post = buildPartialPostCompactMessages(result, 'from')
    const usage = getCurrentUsage(post)
    // All-zero usage is skipped by getCurrentUsage → null (estimate path)
    expect(usage).toBeNull()
    expect(post[0]).toBe(b)
    expect(post.some(m => String(m.uuid) === 'keep-asst')).toBe(true)
  })

  test('Pid orders up_to as summary then keep', () => {
    const kept = userMsg('k', 'keep me')
    const summary = userMsg('s', 'sum')
    const b = boundary('b')
    const post = buildPartialPostCompactMessages(
      {
        boundaryMarker: b,
        summaryMessages: [summary],
        messagesToKeep: [kept],
        attachments: [],
        hookResults: [],
      } as CompactionResult,
      'up_to',
    )
    expect(post.map(m => String(m.uuid))).toEqual(['b', 's', 'k'])
  })

  test('Pid orders from as keep then summary', () => {
    const kept = userMsg('k', 'keep me')
    const summary = userMsg('s', 'sum')
    const b = boundary('b')
    const post = buildPartialPostCompactMessages(
      {
        boundaryMarker: b,
        summaryMessages: [summary],
        messagesToKeep: [kept],
        attachments: [],
        hookResults: [],
      } as CompactionResult,
      'from',
    )
    expect(post.map(m => String(m.uuid))).toEqual(['b', 'k', 's'])
  })
})
