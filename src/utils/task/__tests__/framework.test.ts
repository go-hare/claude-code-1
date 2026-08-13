import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import * as realDiskOutput from '../diskOutput.js'
import {
  enqueuePendingNotification,
  resetCommandQueue,
} from 'src/utils/messageQueueManager.js'

// ─── Mocks ───

const noop = () => {}

mock.module('src/utils/debug.ts', debugMock)

const realSdkEventQueue = await import('src/utils/sdkEventQueue.js')
const sdkEventQueueSnap = snapshotModuleExports(realSdkEventQueue)
const sdkEvents: any[] = []
function sdkEventQueueMock() {
  return {
    ...sdkEventQueueSnap,
    enqueueSdkEvent: (event: any) => sdkEvents.push(event),
    // Official 2.1 task_updated path used by updateTaskState (require).
    emitTaskUpdatedSdk: (taskId: string, patch: Record<string, unknown>) => {
      sdkEvents.push({
        type: 'system',
        subtype: 'task_updated',
        task_id: taskId,
        patch,
      })
    },
    emitTaskTerminatedSdk: () => true,
    emitTaskSummarySdk: () => {},
    emitThinkingTokensSdk: () => {},
    emitModelFallbackSdk: () => {},
    // Local capture for this suite — do not leave drainSdkEvents:()=>[] without restore.
    drainSdkEvents: () => sdkEvents.splice(0),
    clearTaskTerminatedSdkGate: () => {},
  }
}
mock.module('src/utils/sdkEventQueue.js', sdkEventQueueMock)
mock.module('../sdkEventQueue.js', sdkEventQueueMock)
afterAll(() => {
  mock.module('src/utils/sdkEventQueue.js', () => ({ ...sdkEventQueueSnap }))
  mock.module('../sdkEventQueue.js', () => ({ ...sdkEventQueueSnap }))
})

// Spread real diskOutput so DiskTaskOutput survives process-global mock.module
// pollution when this file runs with agentKeepalive / LocalAgentTask suites.
function diskOutputMock() {
  return {
    ...realDiskOutput,
    getTaskOutputPath: (id: string) => `/tmp/output/${id}`,
    getTaskOutputDelta: async () => null,
    evictTaskOutput: noop,
    initTaskOutputAsSymlink: async () => {},
  }
}
mock.module('src/utils/task/diskOutput.js', diskOutputMock)
mock.module('../diskOutput.js', diskOutputMock)

// Do NOT mock messageQueueManager. Bun mock.module is process-global —
// replacing hasCommandsInQueue/enqueue with a private array breaks SleepTool
// (static enqueue vs runtime hasCommandsInQueue on different stores).
// Jeo pending-notification probes seed the real queue instead.

// ─── Import after mocks ───

const {
  updateTaskState,
  registerTask,
  evictTerminalTask,
  addKeepaliveReason,
  removeKeepaliveReason,
  getKeepaliveReasons,
  computePanelEvictAfter,
  isParkedKeepaliveAgent,
  sweepStaleKeepaliveReasons,
  hasLiveAgentKeepaliveChildren,
  hasNonIdleWindowKeepalive,
  idleWindowKeepaliveReason,
  IDLE_WINDOW_KEEPALIVE_REASON,
  IDLE_WINDOW_MS,
  POLL_INTERVAL_MS,
  PANEL_GRACE_MS,
} = await import('../framework.js')

// ─── Helpers ───

function makeTask(overrides: Record<string, any> = {}): any {
  return {
    id: 'task-001',
    type: 'local_agent' as const,
    status: 'running' as const,
    description: 'Test task',
    startTime: Date.now(),
    outputFile: '/tmp/output/task-001',
    outputOffset: 0,
    notified: false,
    ...overrides,
  }
}

type AppStateLike = { tasks: Record<string, any> }
type SetAppStateLike = (f: (prev: AppStateLike) => AppStateLike) => void

function createSetAppState(initial: AppStateLike = { tasks: {} }): {
  setAppState: SetAppStateLike
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

afterEach(() => {
  sdkEvents.length = 0
  resetCommandQueue()
})

// ─── Tests ───

describe('updateTaskState', () => {
  test('updates task in AppState', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: { 'task-001': makeTask({ status: 'running' }) },
    })

    updateTaskState('task-001', setAppState as any, (task: any) => ({
      ...task,
      status: 'completed',
    }))

    expect(getState().tasks['task-001'].status).toBe('completed')
  })

  test('returns same reference when updater returns same task (no-op)', () => {
    const task = makeTask({ status: 'running' })
    const { setAppState, getState } = createSetAppState({
      tasks: { 'task-001': task },
    })

    updateTaskState('task-001', setAppState as any, (t: any) => t)

    // Should be the exact same reference
    expect(getState().tasks['task-001']).toBe(task)
  })

  test('skips if task not found', () => {
    const { setAppState, getState } = createSetAppState({ tasks: {} })

    updateTaskState('nonexistent', setAppState as any, (t: any) => ({
      ...t,
      status: 'completed',
    }))

    // No crash, tasks unchanged
    expect(Object.keys(getState().tasks)).toHaveLength(0)
  })

  test('emits system/task_updated wire-safe patch on status change', () => {
    const { setAppState } = createSetAppState({
      tasks: { 'task-001': makeTask({ status: 'running' }) },
    })

    updateTaskState('task-001', setAppState as any, (task: any) => ({
      ...task,
      status: 'completed',
      endTime: 1_700_000_000_000,
      description: 'done',
    }))

    const updated = sdkEvents.filter(e => e.subtype === 'task_updated')
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      type: 'system',
      subtype: 'task_updated',
      task_id: 'task-001',
      patch: {
        status: 'completed',
        description: 'done',
        end_time: 1_700_000_000_000,
      },
    })
  })

  test('emits is_backgrounded when isBackgrounded flips', () => {
    const { setAppState } = createSetAppState({
      tasks: {
        'task-001': makeTask({ status: 'running', isBackgrounded: false }),
      },
    })

    updateTaskState('task-001', setAppState as any, (task: any) => ({
      ...task,
      isBackgrounded: true,
    }))

    const updated = sdkEvents.filter(e => e.subtype === 'task_updated')
    expect(updated).toHaveLength(1)
    expect(updated[0].patch).toEqual({ is_backgrounded: true })
  })

  test('no task_updated on no-op same-reference updater', () => {
    const task = makeTask({ status: 'running' })
    const { setAppState } = createSetAppState({
      tasks: { 'task-001': task },
    })

    updateTaskState('task-001', setAppState as any, (t: any) => t)
    expect(sdkEvents.filter(e => e.subtype === 'task_updated')).toHaveLength(0)
  })
})

describe('registerTask', () => {
  test('adds task to AppState.tasks', () => {
    const { setAppState, getState } = createSetAppState()

    registerTask(makeTask(), setAppState as any)

    expect(getState().tasks['task-001']).toBeDefined()
    expect(getState().tasks['task-001'].status).toBe('running')
  })

  test('emits SDK event for new task', () => {
    const { setAppState } = createSetAppState()

    registerTask(makeTask(), setAppState as any)

    expect(sdkEvents).toHaveLength(1)
    expect(sdkEvents[0].subtype).toBe('task_started')
    expect(sdkEvents[0].task_id).toBe('task-001')
  })

  test('merges retain on re-register', () => {
    const { setAppState, getState } = createSetAppState()

    // First registration
    registerTask(makeTask({ retain: true }), setAppState as any)

    // Re-register (resume)
    registerTask(makeTask({ retain: false }), setAppState as any)

    // retain should be preserved from first registration
    expect(getState().tasks['task-001'].retain).toBe(true)
    // Only one SDK event (re-register skips emit)
    expect(sdkEvents).toHaveLength(1)
  })

  test('ekg merge preserves keepaliveReasons/owner on re-register', () => {
    const { setAppState, getState } = createSetAppState()
    const reasons = new Set(['workflow:w1', 'agent:a2'])
    registerTask(
      makeTask({
        retain: true,
        keepaliveReasons: reasons,
        ownerAgentId: 'owner-x',
        parentAgentId: 'parent-y',
        spawnDepth: 2,
        isObserver: true,
      }),
      setAppState as any,
    )
    // Resume replace without those fields (fresh task object)
    registerTask(
      makeTask({
        retain: false,
        description: 'resumed',
      }),
      setAppState as any,
    )
    const t = getState().tasks['task-001']
    expect(t.retain).toBe(true)
    expect(t.description).toBe('resumed')
    expect(t.keepaliveReasons).toBe(reasons)
    expect(t.keepaliveReasons.has('workflow:w1')).toBe(true)
    expect(t.ownerAgentId).toBe('owner-x')
    expect(t.parentAgentId).toBe('parent-y')
    expect(t.spawnDepth).toBe(2)
    expect(t.isObserver).toBe(true)
  })

  test('ekg merge preserves isIdle on re-register (local carry)', () => {
    const { setAppState, getState } = createSetAppState()
    registerTask(
      makeTask({
        retain: true,
        isIdle: true,
      }),
      setAppState as any,
    )
    // Resume replace seeds isIdle:false (Sot/OSu) — carry prior true.
    registerTask(
      makeTask({
        retain: false,
        isIdle: false,
        description: 'resumed-waiting',
      }),
      setAppState as any,
    )
    const t = getState().tasks['task-001']
    expect(t.isIdle).toBe(true)
    expect(t.description).toBe('resumed-waiting')
  })
})

describe('QYi computePanelEvictAfter / YC isParkedKeepaliveAgent', () => {
  test('retain never schedules', () => {
    expect(
      computePanelEvictAfter(
        { retain: true, keepaliveReasons: new Set() },
        { park: false },
      ),
    ).toBeUndefined()
  })

  test('park + non-empty KA skips deadline', () => {
    expect(
      computePanelEvictAfter(
        { retain: false, keepaliveReasons: new Set(['agent:x']) },
        { park: true },
      ),
    ).toBeUndefined()
  })

  test('park:false schedules grace even with KA', () => {
    const t0 = Date.now()
    const v = computePanelEvictAfter(
      { retain: false, keepaliveReasons: new Set(['agent:x']) },
      { park: false },
    )
    expect(typeof v).toBe('number')
    expect(v!).toBeGreaterThanOrEqual(t0 + PANEL_GRACE_MS - 5)
  })

  test('YC parked = completed local_agent with KA', () => {
    expect(
      isParkedKeepaliveAgent({
        type: 'local_agent',
        status: 'completed',
        keepaliveReasons: new Set(['agent:c']),
      }),
    ).toBe(true)
    expect(
      isParkedKeepaliveAgent({
        type: 'local_agent',
        status: 'running',
        keepaliveReasons: new Set(['agent:c']),
      }),
    ).toBe(false)
    expect(
      isParkedKeepaliveAgent({
        type: 'local_agent',
        status: 'completed',
        keepaliveReasons: new Set(),
      }),
    ).toBe(false)
    // densable bot alone still YC-parks
    expect(
      isParkedKeepaliveAgent({
        type: 'local_agent',
        status: 'completed',
        keepaliveReasons: new Set([IDLE_WINDOW_KEEPALIVE_REASON]),
      }),
    ).toBe(true)
  })

  test('densable bot idle-window helpers', () => {
    expect(IDLE_WINDOW_KEEPALIVE_REASON).toBe('flag:idle-window')
    expect(idleWindowKeepaliveReason()).toBe(IDLE_WINDOW_KEEPALIVE_REASON)
    expect(IDLE_WINDOW_MS).toBe(PANEL_GRACE_MS)
    expect(hasNonIdleWindowKeepalive(undefined)).toBe(false)
    expect(hasNonIdleWindowKeepalive(new Set())).toBe(false)
    expect(
      hasNonIdleWindowKeepalive(new Set([IDLE_WINDOW_KEEPALIVE_REASON])),
    ).toBe(false)
    expect(
      hasNonIdleWindowKeepalive(
        new Set([IDLE_WINDOW_KEEPALIVE_REASON, 'agent:x']),
      ),
    ).toBe(true)
    // park with only bot → no grace (held open)
    expect(
      computePanelEvictAfter(
        {
          retain: false,
          keepaliveReasons: new Set([IDLE_WINDOW_KEEPALIVE_REASON]),
        },
        { park: true },
      ),
    ).toBeUndefined()
  })
})

describe('Jeo sweepStaleKeepaliveReasons / JXt', () => {
  test('detaches missing child and notified agent/workflow; keeps live', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        owner: makeTask({
          id: 'owner',
          status: 'running',
          keepaliveReasons: new Set([
            'agent:gone',
            'agent:notified',
            'agent:live',
            'workflow:wf-done',
            'workflow:wf-live',
            'bash:b1',
          ]),
        }),
        notified: makeTask({
          id: 'notified',
          status: 'completed',
          notified: true,
        }),
        live: makeTask({
          id: 'live',
          status: 'running',
          notified: false,
        }),
        'wf-done': {
          ...makeTask({ id: 'wf-done', status: 'completed', notified: true }),
          type: 'local_workflow',
        },
        'wf-live': {
          ...makeTask({ id: 'wf-live', status: 'running', notified: false }),
          type: 'local_workflow',
        },
      },
    })

    sweepStaleKeepaliveReasons('owner', setAppState as any)
    const reasons = getState().tasks.owner.keepaliveReasons as Set<string>
    expect(reasons.has('agent:gone')).toBe(false)
    expect(reasons.has('agent:notified')).toBe(false)
    expect(reasons.has('agent:live')).toBe(true)
    expect(reasons.has('workflow:wf-done')).toBe(false)
    expect(reasons.has('workflow:wf-live')).toBe(true)
    // bash: not in official Jeo agent/workflow prefix set — left alone
    expect(reasons.has('bash:b1')).toBe(true)
  })

  test('keeps child when task-notification still queued for owner', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        owner: makeTask({
          id: 'owner',
          keepaliveReasons: new Set(['agent:pending', 'agent:stale']),
        }),
        pending: makeTask({
          id: 'pending',
          status: 'completed',
          notified: true,
        }),
        stale: makeTask({
          id: 'stale',
          status: 'completed',
          notified: true,
        }),
      },
    })
    enqueuePendingNotification({
      mode: 'task-notification',
      agentId: 'owner',
      taskId: 'pending',
      value: 'x',
    } as never)
    sweepStaleKeepaliveReasons('owner', setAppState as any)
    const reasons = getState().tasks.owner.keepaliveReasons as Set<string>
    expect(reasons.has('agent:pending')).toBe(true)
    expect(reasons.has('agent:stale')).toBe(false)
  })

  test('no-op when owner missing or not local_agent', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        bash: {
          ...makeTask({ id: 'bash', keepaliveReasons: new Set(['agent:x']) }),
          type: 'local_bash',
        },
      },
    })
    sweepStaleKeepaliveReasons('missing', setAppState as any)
    sweepStaleKeepaliveReasons('bash', setAppState as any)
    expect(getState().tasks.bash.keepaliveReasons.has('agent:x')).toBe(true)
  })

  test('JXt hasLiveAgentKeepaliveChildren', () => {
    const { getState, setAppState } = createSetAppState({
      tasks: {
        owner: makeTask({
          id: 'owner',
          keepaliveReasons: new Set(['workflow:w1', 'bash:b']),
        }),
      },
    })
    expect(
      hasLiveAgentKeepaliveChildren('owner', () => getState() as any),
    ).toBe(false)
    addKeepaliveReason('owner', 'agent:c1', setAppState as any)
    expect(
      hasLiveAgentKeepaliveChildren('owner', () => getState() as any),
    ).toBe(true)
    expect(
      hasLiveAgentKeepaliveChildren(undefined, () => getState() as any),
    ).toBe(false)
  })
})

describe('evictTerminalTask', () => {
  test('removes terminal+notified task', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        'task-001': makeTask({
          status: 'completed',
          notified: true,
          evictAfter: Date.now() - 1,
        }),
      },
    })

    evictTerminalTask('task-001', setAppState as any)

    expect(getState().tasks['task-001']).toBeUndefined()
  })

  test('skips if task not terminal', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: { 'task-001': makeTask({ status: 'running', notified: true }) },
    })

    evictTerminalTask('task-001', setAppState as any)

    expect(getState().tasks['task-001']).toBeDefined()
  })

  test('skips if task not notified', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: { 'task-001': makeTask({ status: 'completed', notified: false }) },
    })

    evictTerminalTask('task-001', setAppState as any)

    expect(getState().tasks['task-001']).toBeDefined()
  })

  test('skips if within evictAfter grace period', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        'task-001': makeTask({
          status: 'completed',
          notified: true,
          evictAfter: Date.now() + 60000, // 60s in the future
          retain: false,
        }),
      },
    })

    evictTerminalTask('task-001', setAppState as any)

    expect(getState().tasks['task-001']).toBeDefined()
  })

  test('skips if task not found', () => {
    const { setAppState, getState } = createSetAppState({ tasks: {} })

    evictTerminalTask('nonexistent', setAppState as any)

    // No crash
    expect(Object.keys(getState().tasks)).toHaveLength(0)
  })
})

describe('constants', () => {
  test('POLL_INTERVAL_MS is 1000', () => {
    expect(POLL_INTERVAL_MS).toBe(1000)
  })

  test('PANEL_GRACE_MS is 30000', () => {
    expect(PANEL_GRACE_MS).toBe(30_000)
  })
})

describe('addKeepaliveReason / removeKeepaliveReason (official Gge/tB)', () => {
  test('addKeepaliveReason only mutates local_agent', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        agent1: makeTask({ id: 'agent1', type: 'local_agent' }),
        bash1: makeTask({ id: 'bash1', type: 'local_bash' }),
      },
    })
    addKeepaliveReason('agent1', 'workflow:w1', setAppState as any)
    addKeepaliveReason('bash1', 'workflow:w1', setAppState as any)
    expect(
      getKeepaliveReasons(getState().tasks.agent1).has('workflow:w1'),
    ).toBe(true)
    expect(getState().tasks.bash1.keepaliveReasons).toBeUndefined()
  })

  test('removeKeepaliveReason sets evictAfter when empty+terminal+!retain', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        agent1: makeTask({
          id: 'agent1',
          type: 'local_agent',
          status: 'completed',
          notified: true,
          retain: false,
          keepaliveReasons: new Set(['workflow:w1']),
        }),
      },
    })
    const before = Date.now()
    removeKeepaliveReason('agent1', 'workflow:w1', setAppState as any)
    const t = getState().tasks.agent1
    expect(t.keepaliveReasons.size).toBe(0)
    expect(typeof t.evictAfter).toBe('number')
    expect(t.evictAfter).toBeGreaterThanOrEqual(before + PANEL_GRACE_MS - 50)
  })

  test('removeKeepaliveReason does not set evictAfter when retain', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        agent1: makeTask({
          id: 'agent1',
          type: 'local_agent',
          status: 'completed',
          notified: true,
          retain: true,
          keepaliveReasons: new Set(['workflow:w1']),
        }),
      },
    })
    removeKeepaliveReason('agent1', 'workflow:w1', setAppState as any)
    expect(getState().tasks.agent1.evictAfter).toBeUndefined()
  })

  test('evictTerminalTask blocked while keepaliveReasons non-empty', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        agent1: makeTask({
          id: 'agent1',
          type: 'local_agent',
          status: 'completed',
          notified: true,
          retain: false,
          evictAfter: Date.now() - 1,
          keepaliveReasons: new Set(['workflow:w1']),
        }),
      },
    })
    evictTerminalTask('agent1', setAppState as any)
    expect(getState().tasks.agent1).toBeDefined()
    // Clear keepalive → next eviction succeeds
    removeKeepaliveReason('agent1', 'workflow:w1', setAppState as any)
    // tB may have set a fresh grace; force expired
    updateTaskState('agent1', setAppState as any, (t: any) => ({
      ...t,
      evictAfter: Date.now() - 1,
    }))
    evictTerminalTask('agent1', setAppState as any)
    expect(getState().tasks.agent1).toBeUndefined()
  })

  test('no-op when owner missing or reason absent', () => {
    const { setAppState, getState } = createSetAppState({
      tasks: {
        agent1: makeTask({
          id: 'agent1',
          type: 'local_agent',
          status: 'running',
        }),
      },
    })
    addKeepaliveReason(undefined, 'workflow:w1', setAppState as any)
    removeKeepaliveReason('agent1', 'workflow:missing', setAppState as any)
    expect(getState().tasks.agent1.keepaliveReasons).toBeUndefined()
  })
})

describe('keepalive reason helpers', () => {
  test('prefixes match official Gge/tB strings', async () => {
    const {
      agentKeepaliveReason,
      bashKeepaliveReason,
      monitorKeepaliveReason,
      workflowKeepaliveReason,
    } = await import('../framework.js')
    expect(agentKeepaliveReason('a1')).toBe('agent:a1')
    expect(bashKeepaliveReason('b1')).toBe('bash:b1')
    expect(monitorKeepaliveReason('m1')).toBe('monitor:m1')
    expect(workflowKeepaliveReason('w1')).toBe('workflow:w1')
  })
})
