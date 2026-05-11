import { describe, expect, test } from 'bun:test'
import {
  adaptResponsesStreamToAnthropic,
  buildResponsesRequest,
} from '../responsesAdapter.js'

describe('buildResponsesRequest', () => {
  test('includes reasoning effort for ChatGPT Responses requests', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      reasoningEffort: 'xhigh',
    })

    expect(request.reasoning).toEqual({ effort: 'xhigh' })
  })

  test('does not include unsupported max_output_tokens parameter', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
    }) as Record<string, unknown>

    expect('max_output_tokens' in request).toBe(false)
  })
})

describe('adaptResponsesStreamToAnthropic', () => {
  async function* stream(events: Array<Record<string, unknown>>) {
    for (const event of events) {
      yield event
    }
  }

  async function collect(events: Array<Record<string, unknown>>) {
    const output = []
    for await (const event of adaptResponsesStreamToAnthropic(
      stream(events),
      'gpt-5.5',
    )) {
      output.push(event)
    }
    return output
  }

  test('converts reasoning summary deltas to thinking deltas for spinner state', async () => {
    const output = await collect([
      {
        type: 'response.reasoning_summary_text.delta',
        delta: 'thinking summary',
      },
      {
        type: 'response.output_text.delta',
        delta: 'final answer',
      },
      {
        type: 'response.completed',
        response: { status: 'completed', usage: { output_tokens: 4 } },
      },
    ])

    expect(
      output.some(
        event =>
          event.type === 'content_block_start' &&
          (event as any).content_block?.type === 'thinking',
      ),
    ).toBe(true)
    expect(
      output.some(
        event =>
          event.type === 'content_block_delta' &&
          (event as any).delta?.type === 'thinking_delta' &&
          (event as any).delta?.thinking === 'thinking summary',
      ),
    ).toBe(true)
    expect(
      output.some(
        event =>
          event.type === 'content_block_delta' &&
          (event as any).delta?.type === 'text_delta' &&
          (event as any).delta?.text === 'final answer',
      ),
    ).toBe(true)
  })
})
