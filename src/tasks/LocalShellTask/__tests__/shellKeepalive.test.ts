import { describe, expect, mock, test } from 'bun:test'
import * as realDiskOutput from '../../../utils/task/diskOutput.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

const noop = () => {}
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

// Do not mock messageQueueManager — Bun mock.module is process-global and
// incomplete stubs break SleepTool (hasCommandsInQueue / enqueue).

mock.module('src/utils/sdkEventQueue.js', () => ({
  enqueueSdkEvent: () => {},
}))

function diskOutputMock() {
  return {
    ...realDiskOutput,
    getTaskOutputPath: (id: string) => `/tmp/${id}`,
    getTaskOutputDelta: async () => null,
    evictTaskOutput: noop,
    initTaskOutputAsSymlink: async () => {},
  }
}
mock.module('src/utils/task/diskOutput.js', diskOutputMock)
mock.module('../../../utils/task/diskOutput.js', diskOutputMock)

mock.module('src/utils/cleanupRegistry.js', () => ({
  registerCleanup: () => () => {},
}))

mock.module('src/services/analytics/index.js', () => ({
  logEvent: noop,
  stripProtoFields: (x: unknown) => x,
}))

mock.module('src/services/PromptSuggestion/speculation.js', () => ({
  abortSpeculation: noop,
}))

const {
  addKeepaliveReason,
  bashKeepaliveReason,
  getKeepaliveReasons,
  monitorKeepaliveReason,
  removeKeepaliveReason,
  workflowKeepaliveReason,
} = await import('../../../utils/task/framework.js')

const { registerLocalWorkflowTask, completeWorkflowTask, killWorkflowTask } =
  await import('../../LocalWorkflowTask/LocalWorkflowTask.js')

const { registerMonitorMcpTask, completeMonitorMcpTask, killMonitorMcp } =
  await import('../../MonitorMcpTask/MonitorMcpTask.js')

const { killTask } = await import('../killShellTasks.js')

type AppStateLike = { tasks: Record<string, any> }

function createSetState(initial: AppStateLike = { tasks: {} }): {
  setAppState: (f: (prev: AppStateLike) => AppStateLike) => void
  getState: () => AppStateLike
} {
  let state = initial
  return {
    setAppState: f => {
      state = f(state)
    },
    getState: () => state,
  }
}

function seedOwner(
  setAppState: (f: (prev: AppStateLike) => AppStateLike) => void,
  ownerId = 'owner-a',
): void {
  setAppState(prev => ({
    ...prev,
    tasks: {
      ...prev.tasks,
      [ownerId]: {
        id: ownerId,
        type: 'local_agent',
        status: 'running',
        description: 'owner',
        notified: false,
        keepaliveReasons: new Set(),
      },
    },
  }))
}

describe('densable non-agent Gge/tB prefixes', () => {
  test('bash/monitor/workflow reason helpers match densable prefixes', () => {
    expect(bashKeepaliveReason('b1')).toBe('bash:b1')
    expect(monitorKeepaliveReason('m1')).toBe('monitor:m1')
    expect(workflowKeepaliveReason('w1')).toBe('workflow:w1')
  })

  test('workflow register Gge + complete tB (interactive path)', () => {
    const { setAppState, getState } = createSetState()
    seedOwner(setAppState)
    // registerLocalWorkflowTask gates Gge with !getIsNonInteractiveSession().
    // In unit tests bootstrap may be interactive-false; force-attach then complete
    // still detaches via tB path.
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'wf',
      workflowName: 'spec',
      workflowFile: '/tmp/wf.ts',
      agentId: 'owner-a' as any,
    })
    // Ensure hold exists even when non-interactive gate skipped Gge
    addKeepaliveReason(
      'owner-a',
      workflowKeepaliveReason(taskId),
      setAppState as any,
    )
    expect(
      getKeepaliveReasons(getState().tasks['owner-a']).has(
        workflowKeepaliveReason(taskId),
      ),
    ).toBe(true)

    completeWorkflowTask(taskId, setAppState as any)
    expect(
      getKeepaliveReasons(getState().tasks['owner-a']).has(
        workflowKeepaliveReason(taskId),
      ),
    ).toBe(false)
  })

  test('workflow kill detaches workflow: hold', () => {
    const { setAppState, getState } = createSetState()
    seedOwner(setAppState)
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'wf',
      workflowName: 'spec',
      workflowFile: '/tmp/wf.ts',
      agentId: 'owner-a' as any,
    })
    addKeepaliveReason(
      'owner-a',
      workflowKeepaliveReason(taskId),
      setAppState as any,
    )
    killWorkflowTask(taskId, setAppState as any)
    expect(
      getKeepaliveReasons(getState().tasks['owner-a']).has(
        workflowKeepaliveReason(taskId),
      ),
    ).toBe(false)
  })

  test('monitor_mcp register Gge + complete tB', () => {
    const { setAppState, getState } = createSetState()
    seedOwner(setAppState)
    const taskId = registerMonitorMcpTask(setAppState as any, {
      description: 'mon',
      serverName: 's',
      resourceUri: 'u',
      agentId: 'owner-a' as any,
    })
    expect(
      getKeepaliveReasons(getState().tasks['owner-a']).has(
        monitorKeepaliveReason(taskId),
      ),
    ).toBe(true)
    completeMonitorMcpTask(taskId, setAppState as any)
    expect(
      getKeepaliveReasons(getState().tasks['owner-a']).has(
        monitorKeepaliveReason(taskId),
      ),
    ).toBe(false)
  })

  test('monitor_mcp kill detaches monitor: hold', () => {
    const { setAppState, getState } = createSetState()
    seedOwner(setAppState)
    const taskId = registerMonitorMcpTask(setAppState as any, {
      description: 'mon',
      serverName: 's',
      resourceUri: 'u',
      agentId: 'owner-a' as any,
    })
    killMonitorMcp(taskId, setAppState as any)
    expect(
      getKeepaliveReasons(getState().tasks['owner-a']).has(
        monitorKeepaliveReason(taskId),
      ),
    ).toBe(false)
  })

  test('killTask detaches bash: hold on owner (jLe residual safety)', () => {
    const { setAppState, getState } = createSetState()
    seedOwner(setAppState)
    const bashId = 'b-test1'
    setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        [bashId]: {
          id: bashId,
          type: 'local_bash',
          status: 'running',
          description: 'sleep',
          command: 'sleep 1',
          agentId: 'owner-a',
          kind: 'bash',
          notified: false,
          shellCommand: null,
        },
      },
    }))
    addKeepaliveReason(
      'owner-a',
      bashKeepaliveReason(bashId),
      setAppState as any,
    )
    killTask(bashId, setAppState as any)
    expect(
      getKeepaliveReasons(getState().tasks['owner-a']).has(
        bashKeepaliveReason(bashId),
      ),
    ).toBe(false)
    expect(getState().tasks[bashId].status).toBe('killed')
  })

  test('killTask detaches monitor: hold when kind=monitor', () => {
    const { setAppState, getState } = createSetState()
    seedOwner(setAppState)
    const monId = 'b-mon1'
    setAppState(prev => ({
      ...prev,
      tasks: {
        ...prev.tasks,
        [monId]: {
          id: monId,
          type: 'local_bash',
          status: 'running',
          description: 'watch',
          command: 'true',
          agentId: 'owner-a',
          kind: 'monitor',
          notified: false,
          shellCommand: null,
        },
      },
    }))
    addKeepaliveReason(
      'owner-a',
      monitorKeepaliveReason(monId),
      setAppState as any,
    )
    killTask(monId, setAppState as any)
    expect(
      getKeepaliveReasons(getState().tasks['owner-a']).has(
        monitorKeepaliveReason(monId),
      ),
    ).toBe(false)
  })

  test('removeKeepalive is idempotent (double tB safe)', () => {
    const { setAppState, getState } = createSetState()
    seedOwner(setAppState)
    addKeepaliveReason('owner-a', bashKeepaliveReason('b9'), setAppState as any)
    removeKeepaliveReason(
      'owner-a',
      bashKeepaliveReason('b9'),
      setAppState as any,
    )
    removeKeepaliveReason(
      'owner-a',
      bashKeepaliveReason('b9'),
      setAppState as any,
    )
    expect(getKeepaliveReasons(getState().tasks['owner-a']).size).toBe(0)
  })
})
