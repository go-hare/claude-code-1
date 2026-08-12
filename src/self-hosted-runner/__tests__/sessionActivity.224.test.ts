/**
 * densable 2.1.224 #1 — child activity pipe NDJSON (sjv He).
 */
import { describe, expect, test } from 'bun:test'
import {
  BG_RESULT_FOLLOWUP_GRACE_MS,
  countNonMonitorTasks,
  createActivityPipeState,
  disposeActivityPipeState,
  handleActivityLine,
  handleStderrInitMarker,
  resolveBgResultFollowUpGraceMs,
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

describe('densable 2.1.228 #7 follow-up hold (bgResultAwaitingFollowup)', () => {
  test('resolveBgResultFollowUpGraceMs defaults to ZGi=30000', () => {
    expect(resolveBgResultFollowUpGraceMs({})).toBe(BG_RESULT_FOLLOWUP_GRACE_MS)
    expect(
      resolveBgResultFollowUpGraceMs({
        SELF_HOSTED_RUNNER_BG_RESULT_GRACE_MS: '',
      }),
    ).toBe(BG_RESULT_FOLLOWUP_GRACE_MS)
    expect(
      resolveBgResultFollowUpGraceMs({
        SELF_HOSTED_RUNNER_BG_RESULT_GRACE_MS: '5000',
      }),
    ).toBe(5000)
  })

  test('last backgrounded task finish starts follow-up hold and blocks turn-end', () => {
    const state = createActivityPipeState({
      SELF_HOSTED_RUNNER_BG_RESULT_GRACE_MS: '60000',
    })
    const kinds: SessionActivityKind[] = []
    const busy: boolean[] = []
    const status: string[] = []
    const h = {
      onSessionActivity: (k: SessionActivityKind) => kinds.push(k),
      onBgResultFollowUpBusy: (b: boolean) => busy.push(b),
      onStatus: (m: string) => status.push(m),
      sessionId: 'cse_test',
    }

    handleActivityLine(
      JSON.stringify({ type: 'system', subtype: 'init' }),
      state,
      h,
    )
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'task_started',
        task_id: 'bg1',
        task_type: 'bash',
      }),
      state,
      h,
    )
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'task_updated',
        task_id: 'bg1',
        patch: { is_backgrounded: true },
      }),
      state,
      h,
    )
    // result while bg live → deferred (no turn-end)
    handleActivityLine(
      JSON.stringify({ type: 'result', subtype: 'success' }),
      state,
      h,
    )
    expect(kinds).toContain('turn-end-deferred')
    expect(state.bgResultAwaitingFollowup).toBe(false)

    // terminal bg task → start hold, no turn-end yet
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'task_updated',
        task_id: 'bg1',
        patch: { status: 'completed' },
      }),
      state,
      h,
    )
    expect(state.bgResultAwaitingFollowup).toBe(true)
    expect(busy).toEqual([true])
    expect(status.some(s => s.includes('session still counted as busy'))).toBe(
      true,
    )
    expect(kinds.filter(k => k === 'turn-end')).toEqual([])

    // follow-up turn starting clears hold
    handleActivityLine(
      JSON.stringify({ type: 'system', subtype: 'turn_starting' }),
      state,
      h,
    )
    expect(state.bgResultAwaitingFollowup).toBe(false)
    expect(busy.at(-1)).toBe(false)
    expect(
      status.some(s => s.includes('background-result follow-up cleared')),
    ).toBe(false) // clear logs via onDebug; busy callback is enough
    disposeActivityPipeState(state)
  })

  test('grace elapsed releases hold and emits turn-end', async () => {
    const state = createActivityPipeState({
      SELF_HOSTED_RUNNER_BG_RESULT_GRACE_MS: '20',
    })
    const kinds: SessionActivityKind[] = []
    const status: string[] = []
    const h = {
      onSessionActivity: (k: SessionActivityKind) => kinds.push(k),
      onStatus: (m: string) => status.push(m),
      sessionId: 'cse_grace',
    }
    handleActivityLine(
      JSON.stringify({ type: 'system', subtype: 'init' }),
      state,
      h,
    )
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'task_started',
        task_id: 't',
        task_type: 'bash',
      }),
      state,
      h,
    )
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'task_updated',
        task_id: 't',
        patch: { is_backgrounded: true, status: 'completed' },
      }),
      state,
      h,
    )
    // task_updated with both is_backgrounded and completed: is_backgrounded
    // is only recorded when task still in map; order is add then delete.
    // densable processes is_backgrounded before terminal delete.
    // Our handler: if is_backgrounded && has → add; then if terminal && delete → Xe
    // With both in one patch and task still present, both fire. Good.
    expect(state.bgResultAwaitingFollowup).toBe(true)

    await new Promise(r => setTimeout(r, 50))
    expect(state.bgResultAwaitingFollowup).toBe(false)
    expect(kinds).toContain('turn-end')
    expect(status.some(s => s.includes('releasing the follow-up hold'))).toBe(
      true,
    )
    disposeActivityPipeState(state)
  })

  test('dispose with handlers notifies onBgResultFollowUpBusy(false, childExited)', () => {
    const state = createActivityPipeState()
    const busy: Array<{ v: boolean; exited?: boolean }> = []
    const debug: string[] = []
    // arm hold without full activity path
    state.bgResultAwaitingFollowup = true
    disposeActivityPipeState(
      state,
      {
        onBgResultFollowUpBusy: (v, childExited) => {
          busy.push({ v, exited: childExited })
        },
        onDebug: m => debug.push(m),
        sessionId: 'cse_dispose',
      },
      'child exited',
      true,
    )
    expect(state.bgResultAwaitingFollowup).toBe(false)
    expect(busy).toEqual([{ v: false, exited: true }])
    expect(
      debug.some(s => s.includes('background-result follow-up cleared')),
    ).toBe(true)
  })

  test('dispose without handlers still clears local flag (no throw)', () => {
    const state = createActivityPipeState()
    state.bgResultAwaitingFollowup = true
    disposeActivityPipeState(state)
    expect(state.bgResultAwaitingFollowup).toBe(false)
  })
})
