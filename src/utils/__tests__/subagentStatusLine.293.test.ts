import { describe, expect, test } from 'bun:test'
import type { SubagentStatusTaskRow } from '../subagentStatusLine.js'

describe('2.1.293 #286 subagentStatusLine agentType payload', () => {
  test('SubagentStatusTaskRow includes agentType field', () => {
    const row: SubagentStatusTaskRow = {
      id: 'agent-1',
      name: 'researcher',
      type: 'local_agent',
      agentType: 'Explore',
      status: 'running',
      description: 'Inspect code',
      label: 'Inspect code',
      startTime: 1000,
      model: 'claude-sonnet-4-6',
      effort: undefined,
      contextWindowSize: 200_000,
      tokenCount: 0,
      tokenSamples: [],
      cwd: '/tmp/repo',
    }
    expect(row.agentType).toBe('Explore')
  })
})
