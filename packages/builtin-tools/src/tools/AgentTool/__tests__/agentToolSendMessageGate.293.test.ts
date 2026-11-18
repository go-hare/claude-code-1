import { describe, expect, test } from 'bun:test'
import { AgentTool } from '../AgentTool.js'

describe('AgentTool #293 SendMessage continuation hint gating', () => {
  test('omits SendMessage hint on async_launched when canContinueAgent is false', () => {
    const res = AgentTool.mapToolResultToToolResultBlockParam(
      {
        status: 'async_launched',
        agentId: 'agent-123',
        description: 'test task',
        prompt: 'do work',
        outputFile: '/tmp/out.jsonl',
        canReadOutputFile: true,
        canContinueAgent: false,
      } as never,
      'toolu_1',
    )
    const text = (res.content as Array<{ text: string }>)[0]!.text
    expect(text).not.toContain('SendMessage')
    expect(text).toContain('agentId: agent-123')
  })

  test('includes SendMessage hint on async_launched when canContinueAgent is true', () => {
    const res = AgentTool.mapToolResultToToolResultBlockParam(
      {
        status: 'async_launched',
        agentId: 'agent-123',
        description: 'test task',
        prompt: 'do work',
        outputFile: '/tmp/out.jsonl',
        canReadOutputFile: true,
        canContinueAgent: true,
      } as never,
      'toolu_1',
    )
    const text = (res.content as Array<{ text: string }>)[0]!.text
    expect(text).toContain('Use SendMessage with to:')
  })

  test('omits SendMessage trailer on completed when canContinueAgent is false', () => {
    const res = AgentTool.mapToolResultToToolResultBlockParam(
      {
        status: 'completed',
        agentId: 'agent-456',
        content: [{ type: 'text', text: 'done' }],
        totalTokens: 100,
        totalToolUseCount: 1,
        totalDurationMs: 50,
        prompt: 'do work',
        canContinueAgent: false,
      } as never,
      'toolu_2',
    )
    const blocks = res.content as Array<{ text: string }>
    const joined = blocks.map(b => b.text).join('\n')
    expect(joined).not.toContain('SendMessage')
    expect(joined).toContain('agentId: agent-456')
  })
})
