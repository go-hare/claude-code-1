import { describe, expect, mock, test } from 'bun:test'
import * as realBootstrapState from '../../../bootstrap/state.js'
import * as realDiskOutput from '../../../utils/task/diskOutput.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

const noop = () => {}
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/sessionStorage.js', () => ({
  getAgentTranscriptPath: (id: string) => `/tmp/t/${id}`,
  isTranscriptPersistenceDisabled: () => true,
  recordSidechainTranscript: async () => {},
  recordQueueOperation: noop,
  writeAgentMetadata: async () => {},
}))
function diskOutputMock() {
  return {
    ...realDiskOutput,
    evictTaskOutput: noop,
    getTaskOutputPath: (id: string) => `/tmp/o/${id}`,
    initTaskOutput: async () => {},
    initTaskOutputAsSymlink: async () => {},
    getTaskOutputDelta: async () => null,
  }
}
mock.module('src/utils/task/diskOutput.js', diskOutputMock)
mock.module('../../../utils/task/diskOutput.js', diskOutputMock)
import * as realMessageQueue from 'src/utils/messageQueueManager.js'

/** In-memory queue surface for Zeo rewire tests (process-global mock.module). */
const zeoQueue: Array<Record<string, unknown>> = []
function messageQueueMock() {
  return {
    ...realMessageQueue,
    // Jeo (sweepStaleKeepaliveReasons) reads getCommandQueue for pending
    // task-notification holds — must share zeoQueue with Zeo rewire mocks.
    getCommandQueue: () => zeoQueue as any[],
    getCommandQueueSnapshot: () => zeoQueue as any[],
    getCommandQueueLength: () => zeoQueue.length,
    enqueuePendingNotification: (cmd: Record<string, unknown>) => {
      zeoQueue.push({ ...cmd })
    },
    dequeueAllMatching: (pred: (cmd: Record<string, unknown>) => boolean) => {
      const matched: Array<Record<string, unknown>> = []
      const remaining: Array<Record<string, unknown>> = []
      for (const cmd of zeoQueue) {
        if (pred(cmd)) matched.push(cmd)
        else remaining.push(cmd)
      }
      zeoQueue.length = 0
      zeoQueue.push(...remaining)
      return matched
    },
  }
}
mock.module('src/utils/messageQueueManager.js', messageQueueMock)
mock.module('../../../utils/messageQueueManager.js', messageQueueMock)
function bootstrapStateMock() {
  return {
    ...realBootstrapState,
    getSdkAgentProgressSummariesEnabled: () => false,
    getSessionId: () => 's',
    // densable mi() — stable main AgentId for AL / Zeo rewire
    getMainThreadAgentId: () => 's' as any,
    isMainThreadQueuedCommand: (cmd: { agentId?: string | null }) =>
      cmd.agentId === 's',
    getProjectRoot: () => '/test/project',
    getOriginalCwd: () => '/test/project',
    getCwdState: () => '/test/project',
    getIsNonInteractiveSession: () => false,
    getAllowedSettingSources: () => ['user', 'project', 'local'],
    getFlagSettingsPath: () => undefined,
    getFlagSettingsInline: () => null,
    setCwdState: noop,
    waitForScrollIdle: async () => {},
    addSlowOperation: noop,
  }
}
mock.module('src/bootstrap/state.js', bootstrapStateMock)
mock.module('../../bootstrap/state.js', bootstrapStateMock)
mock.module('src/services/PromptSuggestion/speculation.js', () => ({
  abortSpeculation: noop,
}))
mock.module('src/utils/cleanupRegistry.js', () => ({
  registerCleanup: () => noop,
}))
mock.module('src/utils/abortController.js', () => ({
  createAbortController: () => new AbortController(),
  createChildAbortController: () => new AbortController(),
}))
mock.module('src/utils/sdkEventQueue.js', () => ({
  enqueueSdkEvent: noop,
  emitTaskTerminatedSdk: () => true,
  drainSdkEvents: () => [],
}))
mock.module('src/utils/task/sdkProgress.js', () => ({
  emitTaskProgress: noop,
}))
mock.module('src/coordinator/workerResultValidator.js', () => ({
  // densable-shaped result object — escapeXml(result) requires a string
  validateWorkerResult: (finalMessage?: string) => ({
    result: finalMessage ?? '',
    wasTruncated: false,
  }),
}))
mock.module('src/services/tokenEstimation.js', () => ({
  roughTokenCountEstimationForMessages: () => 0,
}))
mock.module('src/utils/tasks.js', () => ({
  getTaskExecutionMetadata: () => undefined,
  getTaskListId: () => undefined,
  listTasks: () => [],
  markTaskCompletionSuggested: noop,
}))

const {
  registerAsyncAgent,
  registerAgentForeground,
  completeAgentTask,
  killAsyncAgent,
  failAgentTask,
  enqueueAgentNotification,
  rewireOrphanedOwnerNotifications,
  resolvePanelOwnerAgentId,
  isPanelAgentTask,
} = await import('../LocalAgentTask.js')

function store() {
  let state: { tasks: Record<string, any> } = { tasks: {} }
  return {
    set: (f: any) => {
      state = f(state)
    },
    get: () => state,
  }
}

function seedOwner(
  s: ReturnType<typeof store>,
  overrides: Record<string, any> = {},
) {
  s.set((p: any) => ({
    tasks: {
      ...p.tasks,
      owner: {
        id: 'owner',
        type: 'local_agent',
        status: 'running',
        description: 'o',
        startTime: 1,
        outputFile: '/t',
        outputOffset: 0,
        notified: false,
        agentId: 'owner',
        prompt: '',
        agentType: 'g',
        retrieved: false,
        lastReportedToolCount: 0,
        lastReportedTokenCount: 0,
        isBackgrounded: true,
        pendingMessages: [],
        retain: false,
        diskLoaded: false,
        ...overrides,
      },
    },
  }))
}

function spawnChild(s: ReturnType<typeof store>, id = 'child1') {
  registerAsyncAgent({
    agentId: id,
    description: 'c',
    prompt: 'p',
    selectedAgent: { agentType: 'general-purpose' } as any,
    setAppState: s.set as any,
    ownerAgentId: 'owner',
  })
}

describe('agent keepalive Gge/tB', () => {
  test('resolvePanelOwnerAgentId mirrors densable Yeo (panel only)', () => {
    const s = store()
    seedOwner(s, { agentType: 'general-purpose' })
    expect(resolvePanelOwnerAgentId('owner', () => s.get() as any)).toBe(
      'owner',
    )
    expect(isPanelAgentTask(s.get().tasks.owner)).toBe(true)

    s.set((p: any) => ({
      tasks: {
        ...p.tasks,
        owner: { ...p.tasks.owner, agentType: 'main-session' },
      },
    }))
    expect(
      resolvePanelOwnerAgentId('owner', () => s.get() as any),
    ).toBeUndefined()
    expect(
      resolvePanelOwnerAgentId(undefined, () => s.get() as any),
    ).toBeUndefined()
    expect(
      resolvePanelOwnerAgentId('missing', () => s.get() as any),
    ).toBeUndefined()
  })

  test('registerAsyncAgent attaches agent:id to owner when interactive', () => {
    const s = store()
    seedOwner(s)
    spawnChild(s, 'child1')
    expect(s.get().tasks.owner.keepaliveReasons.has('agent:child1')).toBe(true)
    expect(s.get().tasks.child1.ownerAgentId).toBe('owner')
  })

  test('registerAgentForeground stamps owner without Gge (densable OSu)', () => {
    const s = store()
    seedOwner(s)
    registerAgentForeground({
      agentId: 'fg1',
      description: 'f',
      prompt: 'p',
      selectedAgent: { agentType: 'general-purpose' } as any,
      setAppState: s.set as any,
      ownerAgentId: 'owner',
    })
    // densable OSu stamps ownerAgentId at fg register; Gge is mid-bg only.
    expect(s.get().tasks.fg1.ownerAgentId).toBe('owner')
    expect(s.get().tasks.fg1.isBackgrounded).toBe(false)
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:fg1')).toBeFalsy()
  })

  test('completeAgentTask does not detach while owner still running (BRt deferred)', () => {
    const s = store()
    seedOwner(s)
    spawnChild(s, 'child1')
    completeAgentTask(
      {
        agentId: 'child1',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [],
      } as any,
      s.set as any,
    )
    // Official DSu: no owner tB on complete — BRt decides.
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:child1')).toBe(true)
    expect(s.get().tasks.child1.status).toBe('completed')
    // park:true + no self KA → still schedules grace when empty
    expect(typeof s.get().tasks.child1.evictAfter).toBe('number')
  })

  test('completeAgentTask Jeo sweeps already-notified child KA before park', () => {
    // Nested parent held agent:child while running (BRt deferred tB). Child
    // already notified. densable Jeo before DSu must detach so parent does
    // not YC-park forever on a dead hold.
    const s = store()
    seedOwner(s)
    spawnChild(s, 'child1')
    // Child completes + first notify while owner still running → BRt skips tB
    completeAgentTask(
      {
        agentId: 'child1',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [],
      } as any,
      s.set as any,
    )
    s.set((p: any) => ({
      tasks: {
        ...p.tasks,
        child1: { ...p.tasks.child1, notified: true },
      },
    }))
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:child1')).toBe(true)

    // Parent completes: Jeo detaches agent:child; parent not parked
    completeAgentTask(
      {
        agentId: 'owner',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [],
      } as any,
      s.set as any,
    )
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:child1')).toBe(
      false,
    )
    expect(s.get().tasks.owner.status).toBe('completed')
    // empty KA + park:true → still schedules grace (not YC)
    expect(typeof s.get().tasks.owner.evictAfter).toBe('number')
  })

  test('enqueueAgentNotification skips tB when owner running (first notify)', async () => {
    const s = store()
    seedOwner(s)
    spawnChild(s, 'child1')
    completeAgentTask(
      {
        agentId: 'child1',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [],
      } as any,
      s.set as any,
    )
    await enqueueAgentNotification({
      taskId: 'child1',
      description: 'c',
      status: 'completed',
      setAppState: s.set as any,
    })
    // densable BRt: first notify + ownerBusy → skip tB (KA held)
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:child1')).toBe(true)
    expect(s.get().tasks.child1.notified).toBe(true)
  })

  test('enqueueAgentNotification detaches when owner not busy', async () => {
    const s = store()
    seedOwner(s, {
      status: 'completed',
      keepaliveReasons: new Set(),
      notified: true,
    })
    spawnChild(s, 'child1')
    // Force owner terminal after Gge (spawn re-attaches)
    s.set((p: any) => ({
      tasks: {
        ...p.tasks,
        owner: {
          ...p.tasks.owner,
          status: 'completed',
          // keep agent:child1 from Gge
        },
      },
    }))
    completeAgentTask(
      {
        agentId: 'child1',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [],
      } as any,
      s.set as any,
    )
    // Force owner to failed (not YC) so not busy
    s.set((p: any) => ({
      tasks: {
        ...p.tasks,
        owner: { ...p.tasks.owner, status: 'failed' },
      },
    }))
    await enqueueAgentNotification({
      taskId: 'child1',
      description: 'c',
      status: 'completed',
      setAppState: s.set as any,
    })
    // densable BRt: !ownerBusy → tB detaches
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:child1')).toBe(
      false,
    )
    expect(s.get().tasks.child1.notified).toBe(true)
  })

  test('complete park:true defers evictAfter when self holds KA', () => {
    const s = store()
    seedOwner(s)
    spawnChild(s, 'parent-agent')
    // Live nested so Jeo keeps agent:nested hold → DSu YC-parks parent
    s.set((p: any) => ({
      tasks: {
        ...p.tasks,
        'parent-agent': {
          ...p.tasks['parent-agent'],
          keepaliveReasons: new Set(['agent:nested']),
        },
        nested: {
          id: 'nested',
          type: 'local_agent',
          status: 'running',
          description: 'n',
          startTime: 1,
          outputFile: '/t',
          outputOffset: 0,
          notified: false,
          agentId: 'nested',
          prompt: '',
          agentType: 'g',
          retrieved: false,
          lastReportedToolCount: 0,
          lastReportedTokenCount: 0,
          isBackgrounded: true,
          pendingMessages: [],
          retain: false,
          diskLoaded: false,
          ownerAgentId: 'parent-agent',
        },
      },
    }))
    completeAgentTask(
      {
        agentId: 'parent-agent',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [],
      } as any,
      s.set as any,
    )
    expect(s.get().tasks['parent-agent'].status).toBe('completed')
    expect(s.get().tasks['parent-agent'].evictAfter).toBeUndefined()
    expect(
      s.get().tasks['parent-agent'].keepaliveReasons.has('agent:nested'),
    ).toBe(true)
  })

  test('killAsyncAgent detaches keepalive', () => {
    const s = store()
    seedOwner(s)
    spawnChild(s, 'child2')
    killAsyncAgent('child2', s.set as any)
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:child2')).toBe(
      false,
    )
    expect(s.get().tasks.child2.status).toBe('killed')
  })

  test('XV: killAsyncAgent kills YC parked agent (not only running)', () => {
    const s = store()
    seedOwner(s)
    // Parent completed but holds agent:child — YC parked
    s.set((p: any) => ({
      ...p,
      tasks: {
        ...p.tasks,
        owner: {
          ...p.tasks.owner,
          status: 'completed',
          endTime: Date.now(),
          notified: true,
          keepaliveReasons: new Set(['agent:parked-kid']),
          evictAfter: undefined,
        },
        'parked-kid': {
          id: 'parked-kid',
          type: 'local_agent',
          status: 'completed',
          description: 'parked',
          startTime: Date.now(),
          endTime: Date.now(),
          outputFile: '/tmp/p',
          outputOffset: 0,
          notified: true,
          agentId: 'parked-kid',
          prompt: '',
          agentType: 'general-purpose',
          retrieved: false,
          lastReportedToolCount: 0,
          lastReportedTokenCount: 0,
          isBackgrounded: true,
          pendingMessages: [],
          retain: false,
          diskLoaded: false,
          ownerAgentId: 'owner',
          keepaliveReasons: new Set(['agent:nested']),
        },
      },
    }))
    killAsyncAgent('owner', s.set as any)
    const owner = s.get().tasks.owner
    expect(owner.status).toBe('killed')
    expect(owner.keepaliveReasons?.size ?? 0).toBe(0)
    expect(typeof owner.evictAfter).toBe('number')
    expect(owner.quietlyParked).toBe(false)
  })

  test('Kle: markAgentsNotified no-op when notified && !quietlyParked', async () => {
    const { markAgentsNotified } = await import('../LocalAgentTask.js')
    const s = store()
    seedOwner(s)
    s.set((p: any) => ({
      ...p,
      tasks: {
        ...p.tasks,
        owner: {
          ...p.tasks.owner,
          notified: true,
          quietlyParked: false,
        },
      },
    }))
    const before = s.get().tasks.owner
    markAgentsNotified('owner', s.set as any)
    expect(s.get().tasks.owner).toBe(before)
  })

  test('Kle: markAgentsNotified re-marks when quietlyParked', async () => {
    const { markAgentsNotified } = await import('../LocalAgentTask.js')
    const s = store()
    seedOwner(s)
    s.set((p: any) => ({
      ...p,
      tasks: {
        ...p.tasks,
        owner: {
          ...p.tasks.owner,
          notified: true,
          quietlyParked: true,
        },
      },
    }))
    markAgentsNotified('owner', s.set as any)
    expect(s.get().tasks.owner.notified).toBe(true)
    expect(s.get().tasks.owner.quietlyParked).toBe(false)
  })

  test('XV: quietlyParked kill un-notifies then BRt; owner running keeps KA', async () => {
    const s = store()
    seedOwner(s)
    s.set((p: any) => ({
      ...p,
      tasks: {
        ...p.tasks,
        owner: {
          ...p.tasks.owner,
          status: 'running',
          keepaliveReasons: new Set(['agent:parked-q']),
        },
        'parked-q': {
          id: 'parked-q',
          type: 'local_agent',
          status: 'completed',
          description: 'q',
          startTime: Date.now(),
          endTime: Date.now(),
          outputFile: '/tmp/q',
          outputOffset: 0,
          notified: true,
          quietlyParked: true,
          agentId: 'parked-q',
          prompt: '',
          agentType: 'general-purpose',
          retrieved: false,
          lastReportedToolCount: 0,
          lastReportedTokenCount: 0,
          isBackgrounded: true,
          pendingMessages: [],
          retain: false,
          diskLoaded: false,
          ownerAgentId: 'owner',
          keepaliveReasons: new Set(['agent:x']),
        },
      },
    }))
    killAsyncAgent('parked-q', s.set as any)
    // Allow BRt async tail (hint/await) to settle
    await Promise.resolve()
    await Promise.resolve()
    const child = s.get().tasks['parked-q']
    expect(child.status).toBe('killed')
    expect(child.quietlyParked).toBe(false)
    expect(child.notified).toBe(true)
    // quietlyParked un-notifies then BRt; owner running → BRt skips tB (KA held)
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:parked-q')).toBe(
      true,
    )
  })

  test('XV: quietlyParked kill BRt detaches when owner not busy', async () => {
    const s = store()
    seedOwner(s, {
      status: 'failed',
      notified: true,
      keepaliveReasons: new Set(['agent:parked-q2']),
    })
    s.set((p: any) => ({
      ...p,
      tasks: {
        ...p.tasks,
        'parked-q2': {
          id: 'parked-q2',
          type: 'local_agent',
          status: 'completed',
          description: 'q2',
          startTime: Date.now(),
          endTime: Date.now(),
          outputFile: '/tmp/q2',
          outputOffset: 0,
          notified: true,
          quietlyParked: true,
          agentId: 'parked-q2',
          prompt: '',
          agentType: 'general-purpose',
          retrieved: false,
          lastReportedToolCount: 0,
          lastReportedTokenCount: 0,
          isBackgrounded: true,
          pendingMessages: [],
          retain: false,
          diskLoaded: false,
          ownerAgentId: 'owner',
          // YC requires non-empty self KA (completed + size>0)
          keepaliveReasons: new Set(['agent:nested-q2']),
        },
      },
    }))
    killAsyncAgent('parked-q2', s.set as any)
    await Promise.resolve()
    await Promise.resolve()
    expect(s.get().tasks['parked-q2'].status).toBe('killed')
    // Owner failed (not YC/running) → BRt detaches
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:parked-q2')).toBe(
      false,
    )
  })

  test('failAgentTask defers owner detach to BRt', async () => {
    const s = store()
    seedOwner(s)
    spawnChild(s, 'child3')
    failAgentTask('child3', 'boom', s.set as any)
    // Official eto: no owner tB on fail itself
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:child3')).toBe(true)
    expect(s.get().tasks.child3.status).toBe('failed')
    // Running owner → BRt also skips tB
    await enqueueAgentNotification({
      taskId: 'child3',
      description: 'c',
      status: 'failed',
      error: 'boom',
      setAppState: s.set as any,
    })
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:child3')).toBe(true)
  })

  test('Zeo: complete without park rewires undrained child task-notifications to main', () => {
    zeoQueue.length = 0
    const s = store()
    seedOwner(s)
    // Child of owner already completed (notif targeted owner)
    s.set((p: any) => ({
      ...p,
      tasks: {
        ...p.tasks,
        kid: {
          id: 'kid',
          type: 'local_agent',
          status: 'completed',
          description: 'k',
          startTime: 1,
          endTime: 2,
          outputFile: '/t',
          outputOffset: 0,
          notified: true,
          agentId: 'kid',
          prompt: '',
          agentType: 'g',
          retrieved: false,
          lastReportedToolCount: 0,
          lastReportedTokenCount: 0,
          isBackgrounded: true,
          pendingMessages: [],
          retain: false,
          diskLoaded: false,
          ownerAgentId: 'owner',
        },
      },
    }))
    zeoQueue.push({
      mode: 'task-notification',
      agentId: 'owner',
      taskId: 'kid',
      value: 'x',
    })
    // Complete owner with no self KA → not YC → Zeo runs
    completeAgentTask(
      {
        agentId: 'owner',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [],
      } as any,
      s.set as any,
    )
    expect(s.get().tasks.owner.status).toBe('completed')
    // densable Zeo: re-cf with agentId:mi() (main AL)
    expect(zeoQueue.length).toBe(1)
    expect(zeoQueue[0]!.agentId).toBe('s')
    expect(zeoQueue[0]!.taskId).toBe('kid')
  })

  test('Zeo: complete YC parked interactive skips rewire', () => {
    zeoQueue.length = 0
    const s = store()
    seedOwner(s)
    // Live nested (running, !notified) so Jeo keeps agent:nested → YC park after DSu
    s.set((p: any) => ({
      ...p,
      tasks: {
        ...p.tasks,
        owner: {
          ...p.tasks.owner,
          keepaliveReasons: new Set(['agent:nested']),
        },
        nested: {
          id: 'nested',
          type: 'local_agent',
          status: 'running',
          description: 'n',
          startTime: 1,
          outputFile: '/t',
          outputOffset: 0,
          notified: false,
          agentId: 'nested',
          prompt: '',
          agentType: 'g',
          retrieved: false,
          lastReportedToolCount: 0,
          lastReportedTokenCount: 0,
          isBackgrounded: true,
          pendingMessages: [],
          retain: false,
          diskLoaded: false,
          ownerAgentId: 'owner',
        },
      },
    }))
    // Orphan notif routed to owner — Zeo would rewire unless YC-park skip
    zeoQueue.push({
      mode: 'task-notification',
      agentId: 'owner',
      taskId: 'other',
      value: 'x',
    })
    completeAgentTask(
      {
        agentId: 'owner',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [],
      } as any,
      s.set as any,
    )
    // Still YC parked interactive (bootstrap getIsNonInteractiveSession=false)
    expect(s.get().tasks.owner.status).toBe('completed')
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:nested')).toBe(true)
    // Zeo skipped — queue entry still points at owner
    expect(zeoQueue.length).toBe(1)
    expect(zeoQueue[0]!.agentId).toBe('owner')
  })

  test('Zeo: fail always rewires (no park)', () => {
    zeoQueue.length = 0
    const s = store()
    seedOwner(s)
    s.set((p: any) => ({
      ...p,
      tasks: {
        ...p.tasks,
        kid2: {
          id: 'kid2',
          type: 'local_agent',
          status: 'completed',
          description: 'k2',
          startTime: 1,
          endTime: 2,
          outputFile: '/t',
          outputOffset: 0,
          notified: true,
          agentId: 'kid2',
          prompt: '',
          agentType: 'g',
          retrieved: false,
          lastReportedToolCount: 0,
          lastReportedTokenCount: 0,
          isBackgrounded: true,
          pendingMessages: [],
          retain: false,
          diskLoaded: false,
          ownerAgentId: 'owner',
        },
      },
    }))
    zeoQueue.push({
      mode: 'task-notification',
      agentId: 'owner',
      taskId: 'kid2',
      value: 'y',
    })
    failAgentTask('owner', 'boom', s.set as any)
    expect(s.get().tasks.owner.status).toBe('failed')
    expect(zeoQueue[0]!.agentId).toBe('s')
  })

  test('Zeo: rewireOrphanedOwnerNotifications no-op when queue empty', () => {
    zeoQueue.length = 0
    const s = store()
    seedOwner(s)
    rewireOrphanedOwnerNotifications('owner', s.set as any)
    expect(zeoQueue.length).toBe(0)
  })
})
