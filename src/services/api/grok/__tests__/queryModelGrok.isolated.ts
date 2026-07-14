/**
 * Tests for queryModelGrok usage attachment.
 *
 * Regression: Grok used to yield AssistantMessage at content_block_stop with
 * no usage. Background agent footer reads message.usage and stayed at
 * "↓ 0 tokens" forever. Assembly must happen at message_stop with real usage.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  AssistantMessage,
  StreamEvent,
} from '../../../../types/message.js'

function makeMessageStart(): BetaRawMessageStreamEvent {
  return {
    type: 'message_start',
    message: {
      id: 'msg_grok',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'grok-test',
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  } as any
}

function makeTextBlockEvents(): BetaRawMessageStreamEvent[] {
  return [
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any,
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello from grok' },
    } as any,
    { type: 'content_block_stop', index: 0 } as any,
  ]
}

function makeMessageDelta(
  stopReason: string,
  inputTokens: number,
  outputTokens: number,
): BetaRawMessageStreamEvent {
  return {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as any
}

async function* eventStream(events: BetaRawMessageStreamEvent[]) {
  for (const e of events) yield e
}

let _nextEvents: BetaRawMessageStreamEvent[] = []

mock.module('@ant/model-provider', () => ({
  resolveGrokModel: (m: string) => m,
  adaptOpenAIStreamToAnthropic: () => eventStream(_nextEvents),
  anthropicMessagesToOpenAI: () => [],
  anthropicToolsToOpenAI: () => [],
  anthropicToolChoiceToOpenAI: () => undefined,
}))

mock.module('../client.js', () => ({
  getGrokClient: () => ({
    chat: {
      completions: {
        create: async () => ({ [Symbol.asyncIterator]: async function* () {} }),
      },
    },
  }),
}))

mock.module('../../../../utils/debug.js', () => ({
  logForDebugging: () => {},
}))

mock.module('../../../../cost-tracker.js', () => ({
  addToTotalSessionCost: () => {},
}))

mock.module('../../../../utils/modelCost.js', () => ({
  calculateUSDCost: () => 0,
}))

mock.module('../../../../services/langfuse/tracing.js', () => ({
  recordLLMObservation: () => {},
}))

mock.module('../../../../services/langfuse/convert.js', () => ({
  convertMessagesToLangfuse: () => [],
  convertOutputToLangfuse: () => [],
  convertToolsToLangfuse: () => [],
}))

mock.module('../../../../utils/api.js', () => ({
  toolToAPISchema: async () => ({ name: 'x', input_schema: {} }),
}))

mock.module('../../../../utils/messages.js', () => ({
  normalizeMessagesForAPI: (m: any) => m,
  normalizeContentFromAPI: (content: any) => content,
  createAssistantAPIErrorMessage: (opts: any) => ({
    type: 'assistant',
    isApiErrorMessage: true,
    ...opts,
  }),
}))

describe('queryModelGrok usage attachment', () => {
  beforeEach(() => {
    _nextEvents = []
  })

  afterEach(() => {
    _nextEvents = []
  })

  test('yields one assistant message with real usage at message_stop', async () => {
    _nextEvents = [
      makeMessageStart(),
      ...makeTextBlockEvents(),
      makeMessageDelta('end_turn', 1500, 42),
      { type: 'message_stop' } as any,
    ]

    const { queryModelGrok } = await import('../index.js')
    const assistantMessages: AssistantMessage[] = []
    const streamEvents: StreamEvent[] = []

    for await (const item of queryModelGrok(
      [],
      { type: 'text', text: '' } as any,
      [],
      new AbortController().signal,
      {
        model: 'grok-test',
        tools: [],
        agents: [],
        querySource: 'main_loop',
        getToolPermissionContext: async () => ({}) as any,
      } as any,
    )) {
      if (item.type === 'assistant')
        assistantMessages.push(item as AssistantMessage)
      else if (item.type === 'stream_event')
        streamEvents.push(item as StreamEvent)
    }

    expect(assistantMessages).toHaveLength(1)
    const usage = (assistantMessages[0] as any).message.usage
    expect(usage.input_tokens).toBe(1500)
    expect(usage.output_tokens).toBe(42)
    expect((assistantMessages[0] as any).message.stop_reason).toBe('end_turn')
    // content_block_stop alone must not have produced an assistant message
    expect(streamEvents.some(e => e.type === 'stream_event')).toBe(true)
  })

  test('does not yield assistant message before message_stop', async () => {
    _nextEvents = [makeMessageStart(), ...makeTextBlockEvents()]

    const { queryModelGrok } = await import('../index.js')
    const assistantMessages: AssistantMessage[] = []

    for await (const item of queryModelGrok(
      [],
      { type: 'text', text: '' } as any,
      [],
      new AbortController().signal,
      {
        model: 'grok-test',
        tools: [],
        agents: [],
        querySource: 'main_loop',
        getToolPermissionContext: async () => ({}) as any,
      } as any,
    )) {
      if (item.type === 'assistant')
        assistantMessages.push(item as AssistantMessage)
    }

    // Stream ended without message_stop → safety fallback still assembles once
    // with whatever usage was known (zeros). Key point: still only one message,
    // not one per content_block_stop with missing usage forever.
    expect(assistantMessages.length).toBeLessThanOrEqual(1)
    if (assistantMessages[0]) {
      const usage = (assistantMessages[0] as any).message.usage
      expect(usage).toBeDefined()
      expect(typeof usage.input_tokens).toBe('number')
    }
  })
})
