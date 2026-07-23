/**
 * Real-path E2E for the multi-● bug:
 * OpenAI chunks → adaptOpenAIStreamToAnthropic → openai/index-style accumulation
 * → assembleFinalAssistantOutputs → normalizeMessages
 *
 * Each text assistant row after normalizeMessages becomes one ● in the UI.
 */
import { describe, expect, test } from 'bun:test'
import { adaptOpenAIStreamToAnthropic } from '../../../../../packages/@ant/model-provider/src/shared/openaiStreamAdapter.js'
import {
  assembleFinalAssistantOutputs,
  EMPTY_OPENAI_USAGE,
  updateOpenAIUsage,
} from '../openaiShared.js'
import { normalizeMessages } from '../../../../utils/messages.js'

type Chunk = {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: Record<string, unknown>
    finish_reason: string | null
  }>
  usage?: Record<string, unknown>
}

function makeChunk(
  content: string | undefined,
  finish_reason: string | null = null,
  usage?: Record<string, unknown>,
): Chunk {
  const hasUsageOnly =
    content === undefined && finish_reason === null && usage !== undefined
  return {
    id: 'chatcmpl-e2e',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'deepseek-chat',
    choices: hasUsageOnly
      ? []
      : [
          {
            index: 0,
            delta: content != null ? { content } : {},
            finish_reason,
          },
        ],
    usage,
  }
}

async function* asStream(chunks: Chunk[]) {
  for (const c of chunks) yield c as any
}

/** Mirror src/services/api/openai/index.ts event accumulation */
async function runOpenAIPath(chunks: Chunk[]) {
  const contentBlocks: Record<number, Record<string, unknown>> = {}
  let partialMessage: any = null
  let stopReason: string | null = null
  let usage = { ...EMPTY_OPENAI_USAGE }
  const streamEventTypes: string[] = []

  for await (const event of adaptOpenAIStreamToAnthropic(
    asStream(chunks),
    'deepseek-chat',
  )) {
    streamEventTypes.push(event.type)
    switch (event.type) {
      case 'message_start':
        partialMessage = (event as any).message
        if ((event as any).message?.usage) {
          usage = { ...usage, ...(event as any).message.usage }
        }
        break
      case 'content_block_start': {
        const idx = (event as any).index
        const cb = (event as any).content_block
        if (cb.type === 'tool_use') contentBlocks[idx] = { ...cb, input: '' }
        else if (cb.type === 'text') contentBlocks[idx] = { ...cb, text: '' }
        else if (cb.type === 'thinking')
          contentBlocks[idx] = { ...cb, thinking: '', signature: '' }
        else contentBlocks[idx] = { ...cb }
        break
      }
      case 'content_block_delta': {
        const block = contentBlocks[(event as any).index]
        if (!block) break
        const d = (event as any).delta
        if (d.type === 'text_delta')
          block.text = ((block.text as string) || '') + d.text
        else if (d.type === 'input_json_delta')
          block.input = ((block.input as string) || '') + d.partial_json
        else if (d.type === 'thinking_delta')
          block.thinking = ((block.thinking as string) || '') + d.thinking
        break
      }
      case 'message_delta':
        if ((event as any).usage) {
          usage = updateOpenAIUsage(usage, (event as any).usage)
        }
        if ((event as any).delta?.stop_reason != null) {
          stopReason = (event as any).delta.stop_reason
        }
        break
      default:
        break
    }
  }

  const outputs = assembleFinalAssistantOutputs({
    partialMessage,
    contentBlocks,
    tools: [],
    agentId: undefined,
    usage,
    stopReason,
    maxTokens: 0,
  })

  const assistants = outputs.filter(o => o.type === 'assistant')
  const normalized = normalizeMessages(assistants as any)
  const textRows = normalized.filter(
    (m: any) =>
      m.type === 'assistant' &&
      Array.isArray(m.message?.content) &&
      m.message.content.some((b: any) => b.type === 'text'),
  )
  const texts = textRows.map((m: any) =>
    m.message.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join(''),
  )

  return {
    streamEventTypes,
    blockCount: Object.keys(contentBlocks).length,
    contentBlocks: Object.values(contentBlocks),
    assistantMessages: assistants.length,
    /** Each text row after normalizeMessages → one ● in the REPL */
    bullets: textRows.length,
    texts,
    stopReason,
    usage,
  }
}

const FULL = '先看接口清单现状'

describe('multi-bullet E2E (adapter → assemble → normalizeMessages)', () => {
  test('broken proxy: 7× (full text + finish) → 1 ●', async () => {
    const r = await runOpenAIPath(
      Array.from({ length: 7 }, () => makeChunk(FULL, 'stop')),
    )
    expect(r.blockCount).toBe(1)
    expect(r.bullets).toBe(1)
    expect(r.texts).toEqual([FULL])
    expect(
      r.streamEventTypes.filter(t => t === 'content_block_start').length,
    ).toBe(1)
    expect(r.streamEventTypes.filter(t => t === 'message_delta').length).toBe(1)
    expect(r.stopReason).toBe('end_turn')
  })

  test('cumulative full-text deltas → 1 ● with correct text', async () => {
    const r = await runOpenAIPath([
      makeChunk('先看', null),
      makeChunk('先看接口', null),
      makeChunk('先看接口清单现状', null),
      makeChunk(undefined, 'stop'),
    ])
    expect(r.blockCount).toBe(1)
    expect(r.bullets).toBe(1)
    expect(r.texts).toEqual([FULL])
  })

  test('normal incremental streaming still works', async () => {
    const r = await runOpenAIPath([
      makeChunk('Hello', null),
      makeChunk(' world', null),
      makeChunk('!', null),
      makeChunk(undefined, 'stop'),
      makeChunk(undefined, null, {
        prompt_tokens: 10,
        completion_tokens: 3,
        total_tokens: 13,
      }),
    ])
    expect(r.bullets).toBe(1)
    expect(r.texts).toEqual(['Hello world!'])
    expect(r.usage.input_tokens).toBe(10)
    expect(r.usage.output_tokens).toBe(3)
  })

  test('multi-finish + trailing usage keeps 1 ● and real usage', async () => {
    const r = await runOpenAIPath([
      makeChunk(FULL, 'stop'),
      makeChunk(FULL, 'stop'),
      makeChunk(FULL, 'stop'),
      makeChunk(undefined, null, {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 40 },
      }),
    ])
    expect(r.bullets).toBe(1)
    expect(r.texts).toEqual([FULL])
    // Anthropic semantic: non-cached only
    expect(r.usage.input_tokens).toBe(60)
    expect(r.usage.cache_read_input_tokens).toBe(40)
    expect(r.usage.output_tokens).toBe(20)
  })

  test('assemble defense: 7 identical text blocks collapse to 1 ●', () => {
    const outputs = assembleFinalAssistantOutputs({
      partialMessage: {
        id: 'msg',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'm',
        stop_reason: null,
        stop_sequence: null,
        usage: EMPTY_OPENAI_USAGE,
      } as any,
      contentBlocks: Object.fromEntries(
        Array.from({ length: 7 }, (_, i) => [i, { type: 'text', text: FULL }]),
      ),
      tools: [],
      agentId: undefined,
      usage: EMPTY_OPENAI_USAGE,
      stopReason: 'end_turn',
      maxTokens: 0,
    })
    const assistants = outputs.filter(o => o.type === 'assistant')
    expect((assistants[0] as any).message.content).toHaveLength(1)
    const normalized = normalizeMessages(assistants as any)
    const bullets = normalized.filter(
      (m: any) =>
        m.type === 'assistant' &&
        m.message.content.some((b: any) => b.type === 'text'),
    ).length
    expect(bullets).toBe(1)
  })
})
