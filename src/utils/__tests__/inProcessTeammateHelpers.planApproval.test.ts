import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { AppState } from 'src/state/AppState.js'
import type { InProcessTeammateTaskState } from 'src/tasks/InProcessTeammateTask/types.js'
import {
  applyPlanApprovalToInProcessTeammate,
  formatPlanApprovalForModel,
  setAwaitingPlanApproval,
} from '../inProcessTeammateHelpers.js'

const setMemberModeMock = mock(
  (_team: string, _name: string, _mode: string) => true,
)
mock.module('src/utils/swarm/teamHelpers.js', () => ({
  setMemberMode: setMemberModeMock,
}))

function makeTask(
  overrides: Partial<InProcessTeammateTaskState> = {},
): InProcessTeammateTaskState {
  return {
    id: 'task-researcher',
    type: 'in_process_teammate',
    status: 'running',
    description: 'test',
    startTime: Date.now(),
    identity: {
      agentId: 'researcher@demo',
      agentName: 'researcher',
      teamName: 'demo',
      color: 'cyan',
      planModeRequired: true,
      parentSessionId: 'parent',
    },
    prompt: 'plan stuff',
    selectedAgent: undefined,
    awaitingPlanApproval: true,
    permissionMode: 'plan',
    isIdle: false,
    shutdownRequested: false,
    pendingUserMessages: [],
    messages: [],
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    progress: undefined,
    ...overrides,
  } as InProcessTeammateTaskState
}

function makeStore(task: InProcessTeammateTaskState) {
  let state = {
    tasks: { [task.id]: task },
  } as unknown as AppState
  const setAppState = (f: (prev: AppState) => AppState) => {
    state = f(state)
  }
  return {
    setAppState,
    getTask: () => state.tasks[task.id] as InProcessTeammateTaskState,
  }
}

describe('formatPlanApprovalForModel (densable Ejr)', () => {
  test('approve without feedback', () => {
    expect(formatPlanApprovalForModel({ approved: true })).toBe(
      '[Plan Approved] You can now proceed with implementation',
    )
  })
  test('approve with feedback', () => {
    expect(
      formatPlanApprovalForModel({ approved: true, feedback: 'ship it' }),
    ).toBe('[Plan Approved] ship it')
  })
  test('reject with default feedback', () => {
    expect(formatPlanApprovalForModel({ approved: false })).toBe(
      '[Plan Rejected] Please revise your plan',
    )
  })
})

describe('applyPlanApprovalToInProcessTeammate (densable mFu)', () => {
  afterEach(() => {
    setMemberModeMock.mockClear()
  })

  test('approve clears awaiting and sets permissionMode + member mode', () => {
    const { setAppState, getTask } = makeStore(makeTask())
    const applied = applyPlanApprovalToInProcessTeammate(
      'task-researcher',
      {
        type: 'plan_approval_response',
        requestId: 'req-1',
        approved: true,
        timestamp: new Date().toISOString(),
        permissionMode: 'acceptEdits',
      },
      setAppState,
    )
    expect(applied).toBe(true)
    expect(getTask().awaitingPlanApproval).toBe(false)
    expect(getTask().permissionMode).toBe('acceptEdits')
    expect(setMemberModeMock).toHaveBeenCalledWith(
      'demo',
      'researcher',
      'acceptEdits',
    )
  })

  test('approve when lead was still in plan inherits default (caller maps; Urs keeps acceptEdits)', () => {
    const { setAppState, getTask } = makeStore(makeTask())
    applyPlanApprovalToInProcessTeammate(
      'task-researcher',
      {
        type: 'plan_approval_response',
        requestId: 'req-2',
        approved: true,
        timestamp: new Date().toISOString(),
        permissionMode: 'default',
      },
      setAppState,
    )
    expect(getTask().permissionMode).toBe('default')
  })

  test('reject clears awaiting only', () => {
    const { setAppState, getTask } = makeStore(makeTask())
    const applied = applyPlanApprovalToInProcessTeammate(
      'task-researcher',
      {
        type: 'plan_approval_response',
        requestId: 'req-3',
        approved: false,
        feedback: 'add tests',
        timestamp: new Date().toISOString(),
      },
      setAppState,
    )
    expect(applied).toBe(true)
    expect(getTask().awaitingPlanApproval).toBe(false)
    expect(getTask().permissionMode).toBe('plan')
    expect(setMemberModeMock).not.toHaveBeenCalled()
  })

  test('stale response ignored when not awaiting', () => {
    const { setAppState, getTask } = makeStore(
      makeTask({ awaitingPlanApproval: false, permissionMode: 'default' }),
    )
    const applied = applyPlanApprovalToInProcessTeammate(
      'task-researcher',
      {
        type: 'plan_approval_response',
        requestId: 'req-4',
        approved: true,
        timestamp: new Date().toISOString(),
        permissionMode: 'acceptEdits',
      },
      setAppState,
    )
    expect(applied).toBe(false)
    expect(getTask().permissionMode).toBe('default')
    expect(setMemberModeMock).not.toHaveBeenCalled()
  })

  test('setAwaitingPlanApproval helper', () => {
    const { setAppState, getTask } = makeStore(
      makeTask({ awaitingPlanApproval: false }),
    )
    setAwaitingPlanApproval('task-researcher', setAppState, true)
    expect(getTask().awaitingPlanApproval).toBe(true)
  })
})
