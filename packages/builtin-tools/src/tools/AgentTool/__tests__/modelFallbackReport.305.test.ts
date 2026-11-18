import { describe, expect, test } from 'bun:test'
import type { Message } from 'src/types/message.js'
import {
  collectModelsUsed,
  finalizeAgentTool,
  findModelFallbackNotice,
} from '../agentToolUtils.js'

describe('AgentTool fallback model reporting (#1041)', () => {
  test('collectModelsUsed and findModelFallbackNotice detect switch to fallback model', () => {
    const messages = [
      {
        type: 'system',
        subtype: 'model_fallback',
        originalModel: 'claude-opus-4-6',
        fallbackModel: 'claude-sonnet-4-6',
        content: 'Switched',
      },
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          id: 'm1',
          model: 'claude-sonnet-4-6',
          role: 'assistant',
          content: [{ type: 'text', text: 'Done on fallback.' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
    ] as unknown as Message[]

    expect(collectModelsUsed(messages, 'claude-opus-4-6')).toEqual([
      'claude-opus-4-6',
      'claude-sonnet-4-6',
    ])
    expect(findModelFallbackNotice(messages)).toEqual({
      fallbackModel: 'claude-sonnet-4-6',
      originalModel: 'claude-opus-4-6',
    })

    const result = finalizeAgentTool(messages, 'agent-1', {
      prompt: 'test',
      resolvedAgentModel: 'claude-opus-4-6',
      isBuiltInAgent: true,
      startTime: Date.now() - 10,
      agentType: 'general-purpose',
      isAsync: false,
    })

    expect(result.resolvedModel).toBe('claude-opus-4-6')
    expect(result.modelsUsed).toEqual(['claude-opus-4-6', 'claude-sonnet-4-6'])
    expect(result.content[0]?.text).toContain('This agent switched to')
    expect(result.content[0]?.text).toContain(
      'because its earlier model could not be used',
    )
  })

  test('does not emit fallback notice if no model_fallback occurred', () => {
    const messages = [
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          id: 'm1',
          model: 'claude-opus-4-6',
          role: 'assistant',
          content: [{ type: 'text', text: 'Done normally.' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
    ] as unknown as Message[]

    expect(findModelFallbackNotice(messages)).toBeUndefined()
    const result = finalizeAgentTool(messages, 'agent-2', {
      prompt: 'test',
      resolvedAgentModel: 'claude-opus-4-6',
      isBuiltInAgent: true,
      startTime: Date.now() - 10,
      agentType: 'general-purpose',
      isAsync: false,
    })
    expect(result.modelsUsed).toBeUndefined()
    expect(result.content[0]?.text).toBe('Done normally.')
  })
})
