import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSubagentTurnHookTracker } from '../subagentTurnHooks.js'

describe('2.1.290 #40 subagent turn.complete answer emission ($d)', () => {
  test('emits turn.start then turn.complete with answer: report ?? lastAnswerText and summed usage', async () => {
    const calls: Array<{ event: string; payload: Record<string, unknown> }> = []
    const ac = new AbortController()
    const tracker = createSubagentTurnHookTracker(
      {
        text: 'do work',
        agentId: 'agent-1',
        signal: ac.signal,
      },
      {
        hasAnyTurnHook: () => true,
        runHookChain: async (event, payload, tail) => {
          calls.push({ event, payload })
          return tail(payload, [])
        },
      },
    )

    tracker.saw({
      type: 'assistant',
      isVirtual: false,
      message: {
        id: 'm1',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'intermediate' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 1,
        },
      },
    })
    tracker.saw({
      type: 'assistant',
      isVirtual: true,
      message: {
        id: 'm-virt',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'should be ignored' }],
      },
    })
    tracker.saw({
      type: 'assistant',
      isVirtual: false,
      message: {
        id: 'm2',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: '  final answer  ' }],
        usage: {
          input_tokens: 20,
          output_tokens: 15,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 0,
        },
      },
    })

    tracker.ended({ isAborted: false, hasFailed: false })
    await new Promise(r => setTimeout(r, 10))

    expect(calls.map(c => c.event)).toEqual(['turn.start', 'turn.complete'])
    expect(calls[0]!.payload).toMatchObject({
      text: 'do work',
      agentId: 'agent-1',
    })
    expect(calls[1]!.payload).toMatchObject({
      answer: 'final answer',
      agentId: 'agent-1',
      isAborted: false,
      reason: 'answer',
      usage: {
        input_tokens: 30,
        output_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 1,
        model: 'claude-sonnet-4-5',
      },
    })
  })

  test('prefers explicit report (we ?? O) over lastAnswerText', async () => {
    const calls: Array<{ event: string; payload: Record<string, unknown> }> = []
    const ac = new AbortController()
    const tracker = createSubagentTurnHookTracker(
      { text: 'prompt', agentId: 'agent-2', signal: ac.signal },
      {
        hasAnyTurnHook: () => true,
        runHookChain: async (event, payload, tail) => {
          calls.push({ event, payload })
          return tail(payload, [])
        },
      },
    )

    tracker.saw({
      type: 'assistant',
      message: {
        id: 'm1',
        content: [{ type: 'text', text: 'fallback text' }],
      },
    })
    tracker.ended({
      isAborted: false,
      hasFailed: false,
      report: 'report override',
    })
    await new Promise(r => setTimeout(r, 10))

    expect(calls[1]!.payload.answer).toBe('report override')
  })

  test('preserves lastAnswerText on api error and emits reason: error', async () => {
    const calls: Array<{ event: string; payload: Record<string, unknown> }> = []
    const ac = new AbortController()
    const tracker = createSubagentTurnHookTracker(
      { text: 'prompt', agentId: 'agent-3', signal: ac.signal },
      {
        hasAnyTurnHook: () => true,
        runHookChain: async (event, payload, tail) => {
          calls.push({ event, payload })
          return tail(payload, [])
        },
      },
    )

    tracker.saw({
      type: 'assistant',
      message: { id: 'm1', content: [{ type: 'text', text: 'good text' }] },
    })
    tracker.saw({
      type: 'assistant',
      isApiErrorMessage: true,
      message: { id: 'm2', content: [{ type: 'text', text: 'api err' }] },
    })
    tracker.ended({ isAborted: false, hasFailed: false })
    await new Promise(r => setTimeout(r, 10))

    expect(calls[1]!.payload).toMatchObject({
      answer: 'good text',
      reason: 'error',
    })
  })

  test('runAgent.ts wires createSubagentTurnHookTracker saw + ended', () => {
    const src = readFileSync(join(import.meta.dir, '../runAgent.ts'), 'utf8')
    expect(src).toContain('createSubagentTurnHookTracker')
    expect(src).toContain('turnHookTracker.saw(message)')
    expect(src).toContain('turnHookTracker.ended(')
  })
})
