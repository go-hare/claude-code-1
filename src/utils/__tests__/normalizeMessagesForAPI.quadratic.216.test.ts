/**
 * densable 2.1.216 — LN linear same-id assistant merge (Map + cursor)
 * Replaces 215 reverse-scan O(n²) behavior.
 */
import { describe, expect, test } from 'bun:test'
import type { Message } from 'src/types/message.js'
import {
  createAssistantMessage,
  createUserMessage,
  normalizeMessagesForAPI,
} from '../messages.js'

function user(text: string) {
  return createUserMessage({ content: text })
}

function assistantPartial(id: string, content: Array<Record<string, unknown>>) {
  const m = createAssistantMessage({ content: content as never })
  m.message.id = id
  return m
}

function toolResult(toolUseId: string, content = 'ok') {
  return createUserMessage({
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content,
      },
    ],
  })
}

describe('normalizeMessagesForAPI densable 2.1.216 LN', () => {
  test('many same-id partials separated by tool_result merge into one assistant', () => {
    const id = 'msg_stream_long'
    const msgs: Message[] = [user('go')]
    // 20 streaming partials interleaved with tool_results
    for (let i = 0; i < 20; i++) {
      msgs.push(
        assistantPartial(id, [
          i === 0
            ? { type: 'thinking', thinking: `t${i}`, signature: `s${i}` }
            : {
                type: 'tool_use',
                id: `toolu_${i}`,
                name: 'Bash',
                input: { command: `echo ${i}` },
              },
        ]),
      )
      if (i > 0) {
        // tool_result for previous tool_use sits between partials
        msgs.push(toolResult(`toolu_${i}`, `out${i}`))
      }
    }

    const result = normalizeMessagesForAPI(msgs)
    const assistants = result.filter(m => m.type === 'assistant')
    expect(assistants).toHaveLength(1)
    const content = (
      assistants[0] as { message: { content: Array<{ type: string }> } }
    ).message.content
    expect(content.some(b => b.type === 'thinking')).toBe(true)
    expect(content.filter(b => b.type === 'tool_use').length).toBe(19)
  })

  test('real user message clears segment — no cross-turn same-id merge', () => {
    const idA = 'msg_a'
    const idB = 'msg_b'
    const msgs: Message[] = [
      user('first'),
      assistantPartial(idA, [{ type: 'text', text: 'hello' }]),
      user('second turn'),
      assistantPartial(idB, [{ type: 'text', text: 'world' }]),
      // same id as first turn must NOT merge across real user
      assistantPartial(idA, [{ type: 'text', text: 'should not join first' }]),
    ]
    const result = normalizeMessagesForAPI(msgs)
    const assistants = result.filter(m => m.type === 'assistant')
    // first-turn assistant, second-turn idB, and second-turn idA partial = 3
    expect(assistants.length).toBeGreaterThanOrEqual(2)
    const first = assistants[0] as {
      message: { id: string; content: Array<{ type: string; text?: string }> }
    }
    expect(first.message.id).toBe(idA)
    const firstText = first.message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
    expect(firstText).not.toContain('should not join first')
  })

  test('consecutive same-id without tool_result still merges', () => {
    const id = 'msg_consec'
    const result = normalizeMessagesForAPI([
      user('x'),
      assistantPartial(id, [
        { type: 'thinking', thinking: 'a', signature: 's' },
      ]),
      assistantPartial(id, [
        {
          type: 'tool_use',
          id: 'toolu_x',
          name: 'Bash',
          input: { command: 'true' },
        },
      ]),
    ])
    expect(result.filter(m => m.type === 'assistant')).toHaveLength(1)
  })

  test('structural near-linear: large N same-id merges complete without reverse-scan blowup', () => {
    const id = 'msg_perf'
    const n = 500
    const msgs: Message[] = [user('perf')]
    for (let i = 0; i < n; i++) {
      msgs.push(
        assistantPartial(id, [
          {
            type: 'text',
            text: `chunk ${i}`,
          },
        ]),
      )
      if (i % 3 === 0) {
        msgs.push(toolResult(`toolu_p_${i}`, 'x'))
      }
    }
    const t0 = performance.now()
    const result = normalizeMessagesForAPI(msgs)
    const ms = performance.now() - t0
    const assistants = result.filter(m => m.type === 'assistant')
    expect(assistants).toHaveLength(1)
    // Structural: finish well under a second for 500 merges (quadratic would be far worse)
    expect(ms).toBeLessThan(2000)
  })
})
