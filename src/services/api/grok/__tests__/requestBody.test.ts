import { describe, expect, test } from 'bun:test'
import {
  buildGrokChatCompletionsBody,
  toGrokReasoningEffort,
} from '../requestBody.js'

describe('toGrokReasoningEffort', () => {
  test('passes low/medium/high/xhigh', () => {
    expect(toGrokReasoningEffort('low')).toBe('low')
    expect(toGrokReasoningEffort('medium')).toBe('medium')
    expect(toGrokReasoningEffort('high')).toBe('high')
    expect(toGrokReasoningEffort('xhigh')).toBe('xhigh')
  })

  test('drops max and numeric (not xAI Chat Completions values)', () => {
    expect(toGrokReasoningEffort('max')).toBeUndefined()
    expect(toGrokReasoningEffort(50)).toBeUndefined()
    expect(toGrokReasoningEffort(undefined)).toBeUndefined()
  })
})

describe('buildGrokChatCompletionsBody', () => {
  const base = {
    model: 'grok-4.6',
    messages: [{ role: 'user' as const, content: 'hi' }],
    tools: undefined,
    toolChoice: undefined,
  }

  test('omits reasoning_effort when effort is unset', () => {
    const body = buildGrokChatCompletionsBody(base)
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  test('sends reasoning_effort for 4.6 / 4.20-reasoning ladder', () => {
    const body = buildGrokChatCompletionsBody({
      ...base,
      effortValue: 'medium',
    })
    expect(body.reasoning_effort).toBe('medium')
    expect(body.model).toBe('grok-4.6')
  })

  test('sends xhigh for grok-4.6 (depth; caller clamps)', () => {
    const body = buildGrokChatCompletionsBody({
      ...base,
      model: 'grok-4.6',
      effortValue: 'xhigh',
    })
    expect(body.reasoning_effort).toBe('xhigh')
  })

  test('sends xhigh for multi-agent (caller clamps; we pass through)', () => {
    const body = buildGrokChatCompletionsBody({
      ...base,
      model: 'grok-4.20-multi-agent',
      effortValue: 'xhigh',
    })
    expect(body.reasoning_effort).toBe('xhigh')
  })

  test('does not send reasoning_effort for max', () => {
    const body = buildGrokChatCompletionsBody({
      ...base,
      effortValue: 'max',
    })
    expect(body.reasoning_effort).toBeUndefined()
  })

  test('includes tools only when non-empty', () => {
    const empty = buildGrokChatCompletionsBody({
      ...base,
      tools: [],
    })
    expect(empty.tools).toBeUndefined()

    const withTools = buildGrokChatCompletionsBody({
      ...base,
      tools: [
        {
          type: 'function',
          function: { name: 'x', parameters: {} },
        },
      ],
      toolChoice: 'auto',
    })
    expect(withTools.tools).toHaveLength(1)
    expect(withTools.tool_choice).toBe('auto')
  })
})
