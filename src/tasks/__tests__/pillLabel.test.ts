import { describe, expect, test } from 'bun:test'
import { DIAMOND_OPEN } from '../../constants/figures.js'
import { getPillLabel } from '../pillLabel.js'
import type { BackgroundTaskState } from '../types.js'

function task(partial: Record<string, unknown>): BackgroundTaskState {
  return {
    id: 't1',
    status: 'running',
    description: 'x',
    startTime: 0,
    ...partial,
  } as BackgroundTaskState
}

describe('getPillLabel densable alt polarity', () => {
  test('local_workflow uses dynamic wording', () => {
    expect(getPillLabel([task({ type: 'local_workflow' })])).toBe(
      '1 background dynamic workflow',
    )
    expect(
      getPillLabel([
        task({ type: 'local_workflow', id: 'a' }),
        task({ type: 'local_workflow', id: 'b' }),
      ]),
    ).toBe('2 background dynamic workflows')
  })

  test('remote-workflow sessions use densable label', () => {
    expect(
      getPillLabel([
        task({
          type: 'remote_agent',
          remoteTaskType: 'remote-workflow',
        }),
      ]),
    ).toBe(`${DIAMOND_OPEN} 1 remote dynamic workflow`)
  })

  test('monitor_mcp label', () => {
    expect(getPillLabel([task({ type: 'monitor_mcp' })])).toBe('1 monitor')
  })

  test('mcp_task copper_thistle noun (inject via pure format default off)', () => {
    // Without live GB, copper_thistle defaults false → "task"
    expect(
      getPillLabel([
        task({ type: 'mcp_task' }) as unknown as BackgroundTaskState,
      ]),
    ).toBe('1 MCP task')
  })

  test('mixed types fall back to background tasks', () => {
    expect(
      getPillLabel([
        task({ type: 'local_agent', id: 'a' }),
        task({ type: 'dream', id: 'b' }),
      ]),
    ).toBe('2 background tasks')
  })
})
