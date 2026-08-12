/**
 * densable 2.1.224 #1 — child activity pipe NDJSON (sjv He).
 */
import { describe, expect, test } from 'bun:test'
import {
  countNonMonitorTasks,
  createActivityPipeState,
  disposeActivityPipeState,
  handleActivityLine,
  handleStderrInitMarker,
  type SessionActivityKind,
} from '../sessionActivity.js'

describe('densable 2.1.224 #1 sessionActivity (He)', () => {
  test('countNonMonitorTasks excludes monitor_*', () => {
    const m = new Map([
      ['a', 'bash'],
      ['b', 'monitor_mcp'],
      ['c', 'monitor_ws'],
      ['d', 'agent'],
    ])
    expect(countNonMonitorTasks(m)).toBe(2)
  })

  test('task_started / task_updated ledger + turn-end', () => {
    const state = createActivityPipeState()
    const kinds: SessionActivityKind[] = []
    const ledgers: number[] = []
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'init',
      }),
      state,
      {
        onSessionActivity: k => kinds.push(k),
        onBgTaskLedger: n => ledgers.push(n),
      },
    )
    expect(kinds).toContain('activity')
    expect(state.sawInit).toBe(true)

    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'task_started',
        task_id: 't1',
        task_type: 'bash',
      }),
      state,
      { onBgTaskLedger: n => ledgers.push(n) },
    )
    expect(ledgers.at(-1)).toBe(1)

    handleActivityLine(
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      state,
      { onSessionActivity: k => kinds.push(k) },
    )
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'task_updated',
        task_id: 't1',
        patch: { status: 'completed' },
      }),
      state,
      {
        onSessionActivity: k => kinds.push(k),
        onBgTaskLedger: n => ledgers.push(n),
      },
    )
    expect(ledgers.at(-1)).toBe(0)

    handleActivityLine(
      JSON.stringify({ type: 'result', subtype: 'success' }),
      state,
      { onSessionActivity: k => kinds.push(k) },
    )
    expect(kinds).toContain('turn-end')
    disposeActivityPipeState(state)
  })

  test('token ack from control_response shr-token-', () => {
    const state = createActivityPipeState()
    const acks: string[] = []
    handleActivityLine(
      JSON.stringify({
        type: 'control_response',
        response: { request_id: 'shr-token-session-1' },
      }),
      state,
      { onTokenAck: id => acks.push(id) },
    )
    expect(acks).toEqual(['shr-token-session-1'])
  })

  test('stderr SDKStartup latch', () => {
    const state = createActivityPipeState()
    const kinds: SessionActivityKind[] = []
    let init = false
    handleStderrInitMarker(
      'SDKStartup: phase=system_init_emitted ok=true',
      state,
      {
        onInitObserved: () => {
          init = true
        },
        onSessionActivity: k => kinds.push(k),
      },
    )
    expect(init).toBe(true)
    expect(kinds).toEqual(['init-observed'])
  })

  test('SessionStart hook error', () => {
    const state = createActivityPipeState()
    let n = 0
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'hook_response',
        hook_event: 'SessionStart',
        outcome: 'error',
      }),
      state,
      { onSessionStartHookError: () => n++ },
    )
    expect(n).toBe(1)
  })
})
