import { describe, expect, mock, test } from 'bun:test'

// Mock both alias-style and relative-style message modules that shared utils may resolve.
const messagesMock = {
  normalizeContentFromAPI: (content: any) => content,
  createAssistantAPIErrorMessage: (opts: any) => ({
    type: 'assistant',
    isApiErrorMessage: true,
    ...opts,
  }),
}
mock.module('../../../utils/messages.js', () => messagesMock)
mock.module('../../../../utils/messages.js', () => messagesMock)
mock.module('src/utils/messages.js', () => messagesMock)
mock.module('src/utils/messages.ts', () => messagesMock)

const {
  assembleFinalAssistantOutputs,
  collapseAdjacentDuplicateTextBlocks,
  EMPTY_OPENAI_USAGE,
  updateOpenAIUsage,
} = await import('../openaiShared.js')

describe('updateOpenAIUsage', () => {
  test('merges delta values and preserves cache fields when delta is zero/undefined', () => {
    const current = {
      input_tokens: 10,
      output_tokens: 2,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 7,
    }
    const next = updateOpenAIUsage(current, {
      input_tokens: 20,
      output_tokens: 8,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: undefined,
    })
    expect(next).toEqual({
      input_tokens: 20,
      output_tokens: 8,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 7,
    })
  })
})

describe('assembleFinalAssistantOutputs', () => {
  test('injects usage into the assembled assistant message', () => {
    const outputs = assembleFinalAssistantOutputs({
      partialMessage: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'test-model',
        stop_reason: null,
        stop_sequence: null,
        usage: { ...EMPTY_OPENAI_USAGE },
      } as any,
      contentBlocks: {
        0: { type: 'text', text: 'hello' },
      },
      tools: [],
      agentId: undefined,
      usage: {
        input_tokens: 1200,
        output_tokens: 45,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 300,
      },
      stopReason: 'end_turn',
      maxTokens: 0,
    })

    expect(outputs).toHaveLength(1)
    expect(outputs[0]!.type).toBe('assistant')
    const msg = outputs[0] as any
    expect(msg.message.usage.input_tokens).toBe(1200)
    expect(msg.message.usage.output_tokens).toBe(45)
    expect(msg.message.usage.cache_read_input_tokens).toBe(300)
    expect(msg.message.stop_reason).toBe('end_turn')
  })

  test('returns empty when no content blocks', () => {
    const outputs = assembleFinalAssistantOutputs({
      partialMessage: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'test-model',
        stop_reason: null,
        stop_sequence: null,
        usage: { ...EMPTY_OPENAI_USAGE },
      } as any,
      contentBlocks: {},
      tools: [],
      agentId: undefined,
      usage: { ...EMPTY_OPENAI_USAGE },
      stopReason: null,
      maxTokens: 0,
    })
    expect(outputs).toEqual([])
  })

  test('collapses adjacent identical text blocks into one', () => {
    const full = '先看接口清单现状'
    const outputs = assembleFinalAssistantOutputs({
      partialMessage: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'test-model',
        stop_reason: null,
        stop_sequence: null,
        usage: { ...EMPTY_OPENAI_USAGE },
      } as any,
      contentBlocks: {
        0: { type: 'text', text: full },
        1: { type: 'text', text: full },
        2: { type: 'text', text: full },
        3: { type: 'text', text: full },
        4: { type: 'text', text: full },
        5: { type: 'text', text: full },
        6: { type: 'text', text: full },
      },
      tools: [],
      agentId: undefined,
      usage: { ...EMPTY_OPENAI_USAGE },
      stopReason: 'end_turn',
      maxTokens: 0,
    })

    expect(outputs).toHaveLength(1)
    const content = (outputs[0] as any).message.content
    expect(content).toHaveLength(1)
    expect(content[0]).toEqual({ type: 'text', text: full })
  })

  test('does not collapse different adjacent text or non-text blocks', () => {
    const outputs = assembleFinalAssistantOutputs({
      partialMessage: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'test-model',
        stop_reason: null,
        stop_sequence: null,
        usage: { ...EMPTY_OPENAI_USAGE },
      } as any,
      contentBlocks: {
        0: { type: 'text', text: 'a' },
        1: { type: 'text', text: 'b' },
        2: { type: 'tool_use', id: 't1', name: 'bash', input: {} },
        3: { type: 'text', text: 'a' },
      },
      tools: [],
      agentId: undefined,
      usage: { ...EMPTY_OPENAI_USAGE },
      stopReason: 'tool_use',
      maxTokens: 0,
    })

    const content = (outputs[0] as any).message.content
    expect(content).toHaveLength(4)
  })
})

describe('collapseAdjacentDuplicateTextBlocks', () => {
  test('keeps a single block when all adjacent text is identical', () => {
    const collapsed = collapseAdjacentDuplicateTextBlocks([
      { type: 'text', text: 'same' },
      { type: 'text', text: 'same' },
      { type: 'text', text: 'same' },
    ])
    expect(collapsed).toEqual([{ type: 'text', text: 'same' }])
  })
})
