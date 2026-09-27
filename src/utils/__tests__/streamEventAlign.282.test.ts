import { describe, expect, test } from 'bun:test'
import {
  handleMessageFromStream,
  isNarrationThinkingBlock,
} from '../messages.js'

function call(
  message: { type: string; [k: string]: unknown },
  hooks: {
    onMessage?: () => void
    onSetStreamMode?: (mode: string) => void
    onStreamingToolUses?: (f: (tools: unknown[]) => unknown[]) => void
    onStreamingThinking?: (f: (c: unknown) => unknown) => void
    onUpdateLength?: (n: number) => void
  } = {},
) {
  handleMessageFromStream(
    message as never,
    hooks.onMessage ?? (() => {}),
    hooks.onUpdateLength ?? (() => {}),
    hooks.onSetStreamMode ?? (() => {}),
    hooks.onStreamingToolUses ?? (() => {}),
    undefined,
    hooks.onStreamingThinking,
  )
}

describe('2.1.282 stream event alignment', () => {
  test('ping does not move the spinner', () => {
    const modes: string[] = []
    call(
      { type: 'stream_event', event: { type: 'ping' } },
      { onSetStreamMode: mode => modes.push(mode) },
    )
    expect(modes).toEqual([])
  })

  test('input_json_delta records length and does not append tool JSON', () => {
    const lengths: number[] = []
    let toolUpdates = 0
    call(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"a":1}' },
        },
      },
      {
        onUpdateLength: n => lengths.push(n),
        onStreamingToolUses: () => {
          toolUpdates++
        },
      },
    )
    expect(lengths).toEqual(['{"a":1}'.length])
    expect(toolUpdates).toBe(0)
  })

  test('reopening the same tool index replaces the block', () => {
    let tools: Array<{
      index: number
      contentBlock: { name?: string; input?: unknown }
      unparsedToolInput: string
    }> = [
      {
        index: 0,
        contentBlock: { name: 'Bash', input: { command: 'ls' } },
        unparsedToolInput: '{"command":"ls"}',
      },
    ]
    call(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 't1',
            name: 'Bash',
            input: {},
          },
        },
      },
      {
        onStreamingToolUses: update => {
          tools = update(tools) as typeof tools
        },
      },
    )
    expect(tools[0]?.contentBlock.input).toEqual({})
    expect(tools[0]?.unparsedToolInput).toBe('')
  })

  test('narration thinking clears the live row', () => {
    const results: unknown[] = []
    const signature = narrationSignature()
    call(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'thinking',
              thinking: 'hidden aside',
              signature,
            },
          ],
        },
      },
      {
        onStreamingThinking: f => {
          results.push(f({ thinking: 'old', isStreaming: true }))
        },
      },
    )
    expect(results).toEqual([null])
  })

  test('ordinary thinking stamps ended instead of clearing', () => {
    const results: Array<{ isStreaming?: boolean } | null> = []
    call(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'thinking', thinking: 'real thought' }],
        },
      },
      {
        onStreamingThinking: f => {
          results.push(f(null) as { isStreaming?: boolean } | null)
        },
      },
    )
    expect(results[0]?.isStreaming).toBe(false)
  })
})

describe('isNarrationThinkingBlock', () => {
  test('empty thinking is not narration', () => {
    expect(
      isNarrationThinkingBlock({
        type: 'thinking',
        thinking: '  ',
        signature: narrationSignature(),
      }),
    ).toBe(false)
  })

  test('a narration signature with text is narration', () => {
    expect(
      isNarrationThinkingBlock({
        type: 'thinking',
        thinking: 'aside',
        signature: narrationSignature(),
      }),
    ).toBe(true)
  })
})

function narrationSignature(): string {
  const tag = new TextEncoder().encode('narration')
  const field8 = bytesField(8, tag)
  const field1 = bytesField(1, field8)
  return Buffer.from(bytesField(2, field1)).toString('base64')
}

function bytesField(field: number, payload: Uint8Array): Uint8Array {
  const key = Uint8Array.from([(field << 3) | 2])
  const len = Uint8Array.from([payload.length])
  const out = new Uint8Array(key.length + len.length + payload.length)
  out.set(key, 0)
  out.set(len, key.length)
  out.set(payload, key.length + len.length)
  return out
}
