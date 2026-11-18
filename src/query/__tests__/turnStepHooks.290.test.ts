import { describe, expect, test } from 'bun:test'
import { streamTurnStepWithHooks } from '../turnStepHooks.js'
import type { CallModelParams } from '../turnStepHooks.js'
import * as functionHooksModules from '../../utils/plugins/functionHooksModules.js'

function makeCallArgs(
  overrides?: Partial<CallModelParams['options']>,
): CallModelParams {
  return {
    messages: [],
    systemPrompt: [] as never,
    thinkingConfig: { type: 'disabled' } as never,
    tools: [],
    signal: new AbortController().signal,
    options: {
      model: 'claude-sonnet-4-6',
      isNonInteractiveSession: false,
      hasAppendSystemPrompt: false,
      mcpTools: [],
      querySource: 'repl_main_thread',
      ...overrides,
    } as CallModelParams['options'],
  }
}

function makeAssistantItem(
  uuid: string,
  timestamp: string,
  content: unknown[],
  stopReason = 'end_turn',
) {
  return {
    type: 'assistant' as const,
    uuid,
    timestamp,
    message: {
      id: `msg_${uuid}`,
      model: 'claude-sonnet-4-6',
      role: 'assistant' as const,
      content,
      stop_reason: stopReason,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  }
}

describe('turn.step 2.1.290 serverToolUses + discardedMessages', () => {
  test('notes server_tool_use / mcp_tool_use start and end timestamps and clears discardedMessages', async () => {
    let capturedResult: Record<string, unknown> | undefined
    const fakeHooks = {
      ...functionHooksModules,
      runFunctionHookStreamChain: async function* (
        _event: string,
        payload: Record<string, unknown>,
        tail: (
          e: Record<string, unknown>,
        ) => AsyncGenerator<unknown, unknown, unknown>,
      ) {
        const gen = tail(payload)
        while (true) {
          const next = await gen.next()
          if (next.done) {
            capturedResult = next.value as Record<string, unknown>
            return next.value
          }
          yield next.value
        }
      },
    } as unknown as typeof functionHooksModules

    const callModel = async function* () {
      yield makeAssistantItem('a1', '2026-11-18T00:00:01.000Z', [
        { type: 'text', text: 'discarded text' },
      ])
      yield {
        type: 'server_fallback',
        discardedMessages: [{ uuid: 'a1' }],
      } as never
      yield makeAssistantItem('a2', '2026-11-18T00:00:02.000Z', [
        {
          type: 'server_tool_use',
          id: 'srv_1',
          name: 'web_search',
          input: { query: 'bun' },
        },
        {
          type: 'mcp_tool_use',
          id: 'mcp_1',
          name: 'docs',
          input: { q: 'test' },
        },
      ])
      yield makeAssistantItem('a3', '2026-11-18T00:00:05.000Z', [
        { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [] },
        { type: 'text', text: 'kept answer' },
      ])
    }

    const items: unknown[] = []
    for await (const item of streamTurnStepWithHooks({
      hooks: fakeHooks,
      callModel: callModel as never,
      callArgs: makeCallArgs({ agentId: 'agent-1' as never }),
      turnId: 'turn-1',
      stepIndex: 0,
    })) {
      items.push(item)
    }

    expect(items.length).toBeGreaterThan(0)
    expect(capturedResult).toBeDefined()
    expect(capturedResult?.answer).toBe('kept answer')
    const serverToolUses = capturedResult?.serverToolUses as Array<{
      id: string
      name: string
      startedAt: number
      endedAt?: number
    }>
    expect(serverToolUses).toHaveLength(2)
    expect(serverToolUses[0]).toMatchObject({
      id: 'srv_1',
      name: 'web_search',
      startedAt: Date.parse('2026-11-18T00:00:02.000Z'),
      endedAt: Date.parse('2026-11-18T00:00:05.000Z'),
    })
    expect(serverToolUses[1]).toMatchObject({
      id: 'mcp_1',
      name: 'docs',
      startedAt: Date.parse('2026-11-18T00:00:02.000Z'),
    })
    expect(serverToolUses[1]?.endedAt).toBeUndefined()
  })

  test('streaming_fallback_began clears all previously noted assistant messages', async () => {
    let capturedResult: Record<string, unknown> | undefined
    const fakeHooks = {
      ...functionHooksModules,
      runFunctionHookStreamChain: async function* (
        _event: string,
        payload: Record<string, unknown>,
        tail: (
          e: Record<string, unknown>,
        ) => AsyncGenerator<unknown, unknown, unknown>,
      ) {
        const gen = tail(payload)
        while (true) {
          const next = await gen.next()
          if (next.done) {
            capturedResult = next.value as Record<string, unknown>
            return next.value
          }
          yield next.value
        }
      },
    } as unknown as typeof functionHooksModules

    const callModel = async function* () {
      yield makeAssistantItem('b1', '2026-11-18T00:00:01.000Z', [
        { type: 'text', text: 'before fallback' },
      ])
      yield { type: 'streaming_fallback_began' } as never
      yield makeAssistantItem('b2', '2026-11-18T00:00:03.000Z', [
        { type: 'text', text: 'after fallback' },
      ])
    }

    for await (const _item of streamTurnStepWithHooks({
      hooks: fakeHooks,
      callModel: callModel as never,
      callArgs: makeCallArgs({ agentId: 'agent-1' as never }),
      turnId: 'turn-2',
      stepIndex: 1,
    })) {
      // drain
    }

    expect(capturedResult?.answer).toBe('after fallback')
    expect(capturedResult?.serverToolUses).toBeUndefined()
  })
})
