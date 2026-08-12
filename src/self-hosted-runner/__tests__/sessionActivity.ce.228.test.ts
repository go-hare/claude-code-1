/**
 * densable ce() — hold / turn-end gates must exclude monitor_* tasks.
 * Regression for review: state.tasks.size wrongly blocked hold when only
 * monitor_mcp/monitor_ws remained.
 */
import { describe, expect, test } from 'bun:test'
import {
  countNonMonitorTasks,
  createActivityPipeState,
  disposeActivityPipeState,
  handleActivityLine,
  snapshotBgTasks,
  type SessionActivityKind,
} from '../sessionActivity.js'

describe('sessionActivity densable ce() non-monitor gates', () => {
  test('snapshotBgTasks.liveTasks uses countNonMonitorTasks not tasks.size', () => {
    const state = createActivityPipeState()
    state.tasks.set('m1', 'monitor_mcp')
    state.tasks.set('m2', 'monitor_ws')
    state.tasks.set('b1', 'bash')
    expect(countNonMonitorTasks(state.tasks)).toBe(1)
    expect(snapshotBgTasks(state).liveTasks).toBe(1)
    state.tasks.delete('b1')
    expect(snapshotBgTasks(state).liveTasks).toBe(0)
    expect(state.tasks.size).toBe(2) // monitors still present
  })

  test('result with only monitor_* remaining emits turn-end (ce()===0)', () => {
    const state = createActivityPipeState()
    const kinds: SessionActivityKind[] = []
    handleActivityLine(
      JSON.stringify({ type: 'system', subtype: 'init' }),
      state,
      { onSessionActivity: k => kinds.push(k) },
    )
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'task_started',
        task_id: 'mon',
        task_type: 'monitor_mcp',
      }),
      state,
      {},
    )
    expect(state.tasks.size).toBe(1)
    expect(countNonMonitorTasks(state.tasks)).toBe(0)

    handleActivityLine(
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      state,
      { onSessionActivity: k => kinds.push(k) },
    )
    handleActivityLine(
      JSON.stringify({ type: 'result', subtype: 'success' }),
      state,
      { onSessionActivity: k => kinds.push(k) },
    )
    expect(kinds).toContain('turn-end')
    disposeActivityPipeState(state)
  })

  test('background task terminal starts hold when only monitor remains', () => {
    const state = createActivityPipeState()
    let holdBusy: boolean | undefined
    handleActivityLine(
      JSON.stringify({ type: 'system', subtype: 'init' }),
      state,
      {},
    )
    // real task + monitor
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'task_started',
        task_id: 'work',
        task_type: 'bash',
      }),
      state,
      {},
    )
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'task_started',
        task_id: 'mon',
        task_type: 'monitor_ws',
      }),
      state,
      {},
    )
    // open turn then result while tasks live → background remaining
    handleActivityLine(
      JSON.stringify({ type: 'user', message: { content: 'go' } }),
      state,
      {},
    )
    handleActivityLine(
      JSON.stringify({ type: 'result', subtype: 'success' }),
      state,
      {
        onSessionActivity: () => {},
        onBgResultFollowUpBusy: busy => {
          holdBusy = busy
        },
      },
    )
    // work was backgrounded; complete it — monitor must not block hold
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'task_updated',
        task_id: 'work',
        patch: { status: 'completed' },
      }),
      state,
      {
        onBgResultFollowUpBusy: busy => {
          holdBusy = busy
        },
      },
    )
    expect(countNonMonitorTasks(state.tasks)).toBe(0)
    expect(state.bgResultAwaitingFollowup || holdBusy === true).toBe(true)
    disposeActivityPipeState(state)
  })
})
