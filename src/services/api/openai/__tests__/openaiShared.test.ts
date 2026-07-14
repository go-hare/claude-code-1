import { describe, expect, mock, test } from 'bun:test'

mock.module('../../../../utils/messages.js', () => ({
  normalizeContentFromAPI: (content: any) => content,
  createAssistantAPIErrorMessage: (opts: any) => ({
    type: 'assistant',
    isApiErrorMessage: true,
    ...opts,
  }),
}))

const { assembleFinalAssistantOutputs, EMPTY_OPENAI_USAGE, updateOpenAIUsage } =
  await import('../openaiShared.js')

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
})
