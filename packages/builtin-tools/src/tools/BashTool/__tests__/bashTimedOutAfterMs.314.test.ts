import { describe, expect, test } from 'bun:test'
import { BashTool } from '../BashTool.js'

describe('BashTool mapToolResultToToolResultBlockParam timedOutAfterMs (#1278)', () => {
  test('formats timedOutAfterMs in background shell copy', () => {
    const block = BashTool.mapToolResultToToolResultBlockParam(
      {
        stdout: '',
        stderr: '',
        interrupted: false,
        backgroundTaskId: 'b123456',
        timedOutAfterMs: 5000,
      },
      'tu_timedout_1',
    )
    expect(block.type).toBe('tool_result')
    expect(block.tool_use_id).toBe('tu_timedout_1')
    expect(typeof block.content).toBe('string')
    expect(block.content as string).toContain('5s timeout')
    expect(block.content as string).toContain('b123456')
  })
})
