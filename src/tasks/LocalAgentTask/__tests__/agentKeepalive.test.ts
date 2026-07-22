import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import * as realBootstrapState from '../../../bootstrap/state.js'
import * as realDiskOutput from '../../../utils/task/diskOutput.js'
import * as realTasks from '../../../utils/tasks.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

const noop = () => {}
// Snapshot BEFORE mock — live namespace rebinds under Bun mock.module.
const bootstrapSnap = snapshotModuleExports(realBootstrapState)
const diskOutputSnap = snapshotModuleExports(realDiskOutput)
const tasksSnap = snapshotModuleExports(realTasks)

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/sessionStorage.js', () => ({
  getAgentTranscriptPath: (id: string) => `/tmp/t/${id}`,
  isTranscriptPersistenceDisabled: () => true,
  recordSidechainTranscript: async () => {},
  recordQueueOperation: noop,
  writeAgentMetadata: async () => {},
  readAgentMetadata: async () => null,
  patchAgentMetadata: async (_id: string, patch: Record<string, unknown>) => ({
    agentType: 'unknown',
    ...patch,
  }),
}))
function diskOutputMock() {
  return {
    ...diskOutputSnap,
    evictTaskOutput: noop,
    getTaskOutputPath: (id: string) => `/tmp/o/${id}`,
    initTaskOutput: async () => {},
    initTaskOutputAsSymlink: async () => {},
    getTaskOutputDelta: async () => null,
  }
}
mock.module('src/utils/task/diskOutput.js', diskOutputMock)
mock.module('../../../utils/task/diskOutput.js', diskOutputMock)
// Use the real messageQueueManager (no mock.module). Replacing hasCommandsInQueue
// / enqueue with a private array breaks SleepTool co-suites under Bun's
// process-global last-write-wins mock registry. Zeo / Jeo tests seed and assert
// via the real queue APIs instead.
import {
  enqueuePendingNotification,
  getCommandQueue,
  resetCommandQueue,
} from 'src/utils/messageQueueManager.js'

/** Live view of the real queue for Zeo rewire assertions (same store product uses). */
function zeoQueueView(): Array<Record<string, unknown>> {
  return getCommandQueue() as Array<Record<string, unknown>>
}
function bootstrapStateMock() {
  return {
    ...bootstrapSnap,
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
afterAll(() => {
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('../../bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/utils/task/diskOutput.js', () => ({ ...diskOutputSnap }))
  mock.module('../../../utils/task/diskOutput.js', () => ({
    ...diskOutputSnap,
  }))
  mock.module('src/utils/tasks.js', () => ({ ...tasksSnap }))
  mock.module('../../utils/tasks.js', () => ({ ...tasksSnap }))
  mock.module('../../../utils/tasks.js', () => ({ ...tasksSnap }))
})
mock.module('src/services/PromptSuggestion/speculation.js', () => ({
  abortSpeculation: noop,
}))
mock.module('src/services/analytics/index.js', () => ({
  logEvent: noop,
  stripProtoFields: (x: unknown) => x,
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
// Do not mock tokenEstimation — constant 0 / fixed returns break
// LocalAgentTask estimateContentTokensCached cache-invalidation tests
// under Bun process-global mock.module.
//
// tasks.js: only override completion-hint helpers. NEVER leave a thin
// getTaskListId: () => undefined without restore — co-suites (Agent Teams /
// spawnInProcess) call sanitizePathComponent(getTaskListId()) and throw.
// Spread pre-mock snapshot so createTask/getTasksDir/etc. stay real, and
// restore the full module in afterAll (process-global last-write-wins).
function tasksMock() {
  return {
    ...tasksSnap,
    getTaskExecutionMetadata: () => undefined,
    listTasks: async () => [],
    markTaskCompletionSuggested: async () => false,
  }
}
mock.module('src/utils/tasks.js', tasksMock)
mock.module('../../utils/tasks.js', tasksMock)
mock.module('../../../utils/tasks.js', tasksMock)

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
  armIdleWindowTimer,
  clearIdleWindowTimer,
  clearAllIdleWindowTimersForTests,
  expireIdleWindowKeepalive,
} = await import('../LocalAgentTask.js')
const {
  IDLE_WINDOW_KEEPALIVE_REASON,
  IDLE_WINDOW_MS,
  hasNonIdleWindowKeepalive,
  idleWindowKeepaliveReason,
} = await import('../../../utils/task/framework.js')

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
  afterEach(() => {
    clearAllIdleWindowTimersForTests()
    resetCommandQueue()
  })

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

  test('Yeo ?? mi composition: top-level → main, nested panel → parent', () => {
    // densable Sot/OSu: Re = Yeo(He)??mi(); AgentTool call sites compose the same way.
    const s = store()
    seedOwner(s, { agentType: 'general-purpose' })
    const yeoThenMi = (parent?: string | null) =>
      resolvePanelOwnerAgentId(parent, () => s.get() as any) ?? 's'
    expect(yeoThenMi(undefined)).toBe('s')
    expect(yeoThenMi(null)).toBe('s')
    expect(yeoThenMi('missing')).toBe('s')
    expect(yeoThenMi('owner')).toBe('owner')
    // main-session parent is not panel → fall through to mi()
    s.set((p: any) => ({
      tasks: {
        ...p.tasks,
        owner: { ...p.tasks.owner, agentType: 'main-session' },
      },
    }))
    expect(yeoThenMi('owner')).toBe('s')
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
    // densable DSu a=!1: no bot; empty self KA after complete → panel grace
    expect(
      s.get().tasks.child1.keepaliveReasons?.has(IDLE_WINDOW_KEEPALIVE_REASON),
    ).toBe(false)
    expect(s.get().tasks.child1.evictAfter).toBeDefined()
    clearAllIdleWindowTimersForTests()
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

    // Parent completes: Jeo detaches agent:child; DSu a=!1 → empty KA, Zeo path
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
    // densable DSu a=!1: no bot; empty KA → not YC, panel grace
    expect(
      s.get().tasks.owner.keepaliveReasons?.has(IDLE_WINDOW_KEEPALIVE_REASON),
    ).toBe(false)
    expect(s.get().tasks.owner.evictAfter).toBeDefined()
    clearAllIdleWindowTimersForTests()
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
    // Local BRt: !ownerRunning → tB detaches
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:child1')).toBe(
      false,
    )
    expect(s.get().tasks.child1.notified).toBe(true)
  })

  test('park hang patch: last child of YC parent tB + deferred parent BRt', async () => {
    // Official densable holds KA when owner is YC-parked → last child never
    // tB's → parent stuck on board until next user turn. Local: tB always for
    // non-running owner + fire deferred parent completion when no live agent:.
    const s = store()
    seedOwner(s, {
      status: 'running',
      notified: false,
      description: 'parent-parked',
      result: {
        agentId: 'owner',
        content: [{ type: 'text', text: 'parent done' }],
        totalToolUseCount: 2,
        totalDurationMs: 99,
        totalTokens: 10,
      },
    })
    spawnChild(s, 'child1')
    // Parent completes while holding agent:child → YC parked, never notified
    // (AgentTool Yqe if(Z) defers BRt).
    completeAgentTask(
      {
        agentId: 'owner',
        totalTokens: 10,
        totalToolUseCount: 2,
        content: [{ type: 'text', text: 'parent done' }],
        totalDurationMs: 99,
      } as any,
      s.set as any,
    )
    expect(s.get().tasks.owner.status).toBe('completed')
    expect(s.get().tasks.owner.notified).toBe(false)
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:child1')).toBe(true)

    completeAgentTask(
      {
        agentId: 'child1',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [{ type: 'text', text: 'child done' }],
      } as any,
      s.set as any,
    )
    await enqueueAgentNotification({
      taskId: 'child1',
      description: 'c',
      status: 'completed',
      setAppState: s.set as any,
    })

    // Child KA detached (owner not running)
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:child1')).toBe(
      false,
    )
    expect(s.get().tasks.child1.notified).toBe(true)
    // Deferred parent completion BRt
    expect(s.get().tasks.owner.notified).toBe(true)
    // Empty KA after last agent: → panel grace
    expect(s.get().tasks.owner.evictAfter).toBeDefined()

    // Child + parent notifs both route to main (owner not running)
    const notifs = zeoQueueView().filter(c => c.mode === 'task-notification')
    expect(notifs.length).toBeGreaterThanOrEqual(2)
    expect(notifs.every(c => c.agentId === 's')).toBe(true)
    expect(notifs.some(c => c.taskId === 'child1')).toBe(true)
    expect(notifs.some(c => c.taskId === 'owner')).toBe(true)
    clearAllIdleWindowTimersForTests()
  })

  test('park hang fortification: child notifies while parent running then parent parks', async () => {
    // densable + prior local patch stuck: child BRt while parent running skips tB
    // and routes notif to parent queue; parent Jeo keeps agent:child → park without
    // BRt; Zeo skips YC. resolveParkedOwnerAfterChildrenSettled on DSu fixes it.
    const s = store()
    seedOwner(s, {
      status: 'running',
      notified: false,
      description: 'parent-child-first',
      result: {
        agentId: 'owner',
        content: [{ type: 'text', text: 'parent done' }],
        totalToolUseCount: 1,
        totalDurationMs: 50,
        totalTokens: 5,
      },
    })
    spawnChild(s, 'child1')

    completeAgentTask(
      {
        agentId: 'child1',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [{ type: 'text', text: 'child done first' }],
      } as any,
      s.set as any,
    )
    await enqueueAgentNotification({
      taskId: 'child1',
      description: 'c',
      status: 'completed',
      setAppState: s.set as any,
    })

    // Parent still running → KA held, child notif on owner queue
    expect(s.get().tasks.owner.status).toBe('running')
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:child1')).toBe(true)
    expect(s.get().tasks.child1.notified).toBe(true)
    expect(
      zeoQueueView().some(
        c =>
          c.mode === 'task-notification' &&
          c.taskId === 'child1' &&
          c.agentId === 'owner',
      ),
    ).toBe(true)

    completeAgentTask(
      {
        agentId: 'owner',
        totalTokens: 5,
        totalToolUseCount: 1,
        content: [{ type: 'text', text: 'parent done' }],
        totalDurationMs: 50,
      } as any,
      s.set as any,
    )
    // resolveParkedOwnerAfterChildrenSettled is async void after DSu
    await Promise.resolve()
    await Promise.resolve()

    expect(s.get().tasks.owner.status).toBe('completed')
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:child1')).toBe(
      false,
    )
    expect(s.get().tasks.owner.notified).toBe(true)
    const notifs = zeoQueueView().filter(c => c.mode === 'task-notification')
    expect(notifs.some(c => c.taskId === 'child1' && c.agentId === 's')).toBe(
      true,
    )
    expect(notifs.some(c => c.taskId === 'owner' && c.agentId === 's')).toBe(
      true,
    )
    clearAllIdleWindowTimersForTests()
  })

  test('park hang patch: multi-child keeps parent parked until last agent:', async () => {
    const s = store()
    seedOwner(s, {
      status: 'running',
      notified: false,
      description: 'multi-parent',
    })
    spawnChild(s, 'c1')
    spawnChild(s, 'c2')
    completeAgentTask(
      {
        agentId: 'owner',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [],
      } as any,
      s.set as any,
    )
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:c1')).toBe(true)
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:c2')).toBe(true)

    completeAgentTask(
      {
        agentId: 'c1',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [],
      } as any,
      s.set as any,
    )
    await enqueueAgentNotification({
      taskId: 'c1',
      description: 'c1',
      status: 'completed',
      setAppState: s.set as any,
    })
    // First child detaches but sibling still live → parent stays un-notified
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:c1')).toBe(false)
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:c2')).toBe(true)
    expect(s.get().tasks.owner.notified).toBe(false)

    completeAgentTask(
      {
        agentId: 'c2',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [],
      } as any,
      s.set as any,
    )
    await enqueueAgentNotification({
      taskId: 'c2',
      description: 'c2',
      status: 'completed',
      setAppState: s.set as any,
    })
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:c2')).toBe(false)
    expect(s.get().tasks.owner.notified).toBe(true)
    clearAllIdleWindowTimersForTests()
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
    // densable a=!1: live agent: only — no bot stamp
    expect(
      s
        .get()
        .tasks['parent-agent'].keepaliveReasons.has(
          IDLE_WINDOW_KEEPALIVE_REASON,
        ),
    ).toBe(false)
    clearAllIdleWindowTimersForTests()
  })

  test('densable bot idle-window: complete does not stamp (a=!1); helpers remain', () => {
    expect(idleWindowKeepaliveReason()).toBe('flag:idle-window')
    expect(IDLE_WINDOW_MS).toBe(30_000)
    expect(hasNonIdleWindowKeepalive(new Set(['flag:idle-window']))).toBe(false)
    expect(
      hasNonIdleWindowKeepalive(new Set(['flag:idle-window', 'agent:x'])),
    ).toBe(true)

    const s = store()
    seedOwner(s)
    spawnChild(s, 'idle-child')
    completeAgentTask(
      {
        agentId: 'idle-child',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [],
      } as any,
      s.set as any,
    )
    const child = s.get().tasks['idle-child']
    expect(child.status).toBe('completed')
    // densable DSu a=!1: never stamps bot on complete
    expect(child.keepaliveReasons.has(IDLE_WINDOW_KEEPALIVE_REASON)).toBe(false)
    // empty KA → panel grace (not YC)
    expect(child.evictAfter).toBeDefined()
    clearAllIdleWindowTimersForTests()
  })

  test('densable okg: expireIdleWindowKeepalive removes bot and may tB owner', () => {
    const s = store()
    seedOwner(s, {
      status: 'completed',
      keepaliveReasons: new Set(['agent:idle-kid']),
      notified: true,
    })
    // Seed completed child already notified, holding only bot
    s.set((p: any) => ({
      tasks: {
        ...p.tasks,
        'idle-kid': {
          id: 'idle-kid',
          type: 'local_agent',
          status: 'completed',
          description: 'c',
          startTime: 1,
          endTime: 2,
          outputFile: '/t',
          outputOffset: 0,
          notified: true,
          agentId: 'idle-kid',
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
          keepaliveReasons: new Set([IDLE_WINDOW_KEEPALIVE_REASON]),
        },
      },
    }))
    expireIdleWindowKeepalive('idle-kid', s.set as any)
    // bot removed
    expect(
      s
        .get()
        .tasks['idle-kid'].keepaliveReasons?.has(IDLE_WINDOW_KEEPALIVE_REASON),
    ).toBe(false)
    // empty KA after bot removal + notified + no pending → tB owner agent:id
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:idle-kid')).toBe(
      false,
    )
    // tB empty schedule may set owner.evictAfter if owner terminal+empty
    clearAllIdleWindowTimersForTests()
  })

  test('densable okg: skips owner tB when pending task-notification for child', () => {
    const s = store()
    seedOwner(s, {
      status: 'completed',
      keepaliveReasons: new Set(['agent:pend-kid']),
      notified: true,
    })
    s.set((p: any) => ({
      tasks: {
        ...p.tasks,
        'pend-kid': {
          id: 'pend-kid',
          type: 'local_agent',
          status: 'completed',
          description: 'c',
          startTime: 1,
          endTime: 2,
          outputFile: '/t',
          outputOffset: 0,
          notified: true,
          agentId: 'pend-kid',
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
          keepaliveReasons: new Set([IDLE_WINDOW_KEEPALIVE_REASON]),
        },
      },
    }))
    enqueuePendingNotification({
      mode: 'task-notification',
      agentId: 'owner',
      taskId: 'pend-kid',
      value: 'x',
    } as never)
    expireIdleWindowKeepalive('pend-kid', s.set as any)
    // owner still holds agent: (pending notif blocks tB)
    expect(s.get().tasks.owner.keepaliveReasons?.has('agent:pend-kid')).toBe(
      true,
    )
    resetCommandQueue()
    clearAllIdleWindowTimersForTests()
  })

  test('killAsyncAgent clears idle-window timer', () => {
    const s = store()
    seedOwner(s)
    spawnChild(s, 'timer-kid')
    completeAgentTask(
      {
        agentId: 'timer-kid',
        totalTokens: 1,
        totalToolUseCount: 0,
        content: [],
      } as any,
      s.set as any,
    )
    // densable a=!1: complete does not arm bot
    expect(
      s
        .get()
        .tasks['timer-kid'].keepaliveReasons.has(IDLE_WINDOW_KEEPALIVE_REASON),
    ).toBe(false)
    // manual arm (helper fidelity) then kill must clear timer + KA
    armIdleWindowTimer('timer-kid', s.set as any)
    s.set((p: any) => ({
      tasks: {
        ...p.tasks,
        'timer-kid': {
          ...p.tasks['timer-kid'],
          keepaliveReasons: new Set([IDLE_WINDOW_KEEPALIVE_REASON]),
        },
      },
    }))
    killAsyncAgent('timer-kid', s.set as any)
    expect(s.get().tasks['timer-kid'].status).toBe('killed')
    expect(s.get().tasks['timer-kid'].keepaliveReasons?.size ?? 0).toBe(0)
    clearIdleWindowTimer('timer-kid')
    clearAllIdleWindowTimersForTests()
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

  test('Zeo: complete defers rewire until okg clears bot idle-window', () => {
    resetCommandQueue()
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
    enqueuePendingNotification({
      mode: 'task-notification',
      agentId: 'owner',
      taskId: 'kid',
      value: 'x',
    } as never)
    // densable DSu a=!1 + Jeo empty KA → !YC → Zeo immediately on complete
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
    expect(
      s.get().tasks.owner.keepaliveReasons?.has(IDLE_WINDOW_KEEPALIVE_REASON),
    ).toBe(false)
    // not YC-parked → Zeo re-cf agentId:mi() without waiting okg
    const q = zeoQueueView()
    expect(q.length).toBe(1)
    expect(q[0]!.agentId).toBe('s')
    expect(q[0]!.taskId).toBe('kid')
    clearAllIdleWindowTimersForTests()
  })

  test('Zeo: complete YC parked interactive skips rewire', () => {
    resetCommandQueue()
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
    enqueuePendingNotification({
      mode: 'task-notification',
      agentId: 'owner',
      taskId: 'other',
      value: 'x',
    } as never)
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
    const q = zeoQueueView()
    expect(q.length).toBe(1)
    expect(q[0]!.agentId).toBe('owner')
  })

  test('Zeo: fail always rewires (no park)', () => {
    resetCommandQueue()
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
    enqueuePendingNotification({
      mode: 'task-notification',
      agentId: 'owner',
      taskId: 'kid2',
      value: 'y',
    } as never)
    failAgentTask('owner', 'boom', s.set as any)
    expect(s.get().tasks.owner.status).toBe('failed')
    expect(zeoQueueView()[0]!.agentId).toBe('s')
  })

  test('Zeo: rewireOrphanedOwnerNotifications no-op when queue empty', () => {
    resetCommandQueue()
    const s = store()
    seedOwner(s)
    rewireOrphanedOwnerNotifications('owner', s.set as any)
    expect(zeoQueueView().length).toBe(0)
  })
})
