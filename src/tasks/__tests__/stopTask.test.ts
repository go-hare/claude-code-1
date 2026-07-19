import { describe, expect, mock, test } from 'bun:test'
import * as realBootstrapState from '../../bootstrap/state.js'
import * as realDiskOutput from '../../utils/task/diskOutput.js'
import * as realMessageQueue from '../../utils/messageQueueManager.js'
import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'

const noop = () => {}
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/sessionStorage.js', () => ({
  getAgentTranscriptPath: (id: string) => `/tmp/t/${id}`,
  isTranscriptPersistenceDisabled: () => true,
  recordSidechainTranscript: async () => {},
  recordQueueOperation: noop,
  writeAgentMetadata: async () => {},
  readAgentMetadata: async () => null,
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
mock.module('../../utils/task/diskOutput.js', diskOutputMock)
const shellStopNotifications: Array<Record<string, unknown>> = []
function messageQueueMock() {
  return {
    ...realMessageQueue,
    enqueuePendingNotification: (cmd: Record<string, unknown>) => {
      shellStopNotifications.push({ ...cmd })
    },
    dequeueAllMatching: () => [],
  }
}
mock.module('src/utils/messageQueueManager.js', messageQueueMock)
mock.module('../../utils/messageQueueManager.js', messageQueueMock)
function bootstrapStateMock() {
  return {
    ...realBootstrapState,
    getSdkAgentProgressSummariesEnabled: () => false,
    getSessionId: () => 's',
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
  validateWorkerResult: () => true,
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
// stopTask uses getTaskByType for non-agent types — default undefined so
// local_agent path uses killAsyncAgent; XFu shell tests override via getTaskByTypeMock.
const getTaskByTypeMock = mock((_type?: string) => undefined as any)
mock.module('src/tasks.js', () => ({
  getTaskByType: (type: string) => getTaskByTypeMock(type),
}))

const { stopTask, StopTaskError } = await import('../stopTask.js')
const { isAgentDescendantOf, killDescendantAgents, markAgentStoppedByUser } =
  await import('../LocalAgentTask/LocalAgentTask.js')

function store(
  tasks: Record<string, any> = {},
  extra: { agentNameRegistry?: Map<string, string> } = {},
) {
  let state: {
    tasks: Record<string, any>
    agentNameRegistry: Map<string, string>
  } = {
    tasks,
    agentNameRegistry: extra.agentNameRegistry ?? new Map(),
  }
  return {
    set: (f: any) => {
      state = f(state)
    },
    get: () => state,
  }
}

function teammate(
  taskId: string,
  agentName: string,
  teamName = 'team',
  overrides: Record<string, any> = {},
): Record<string, any> {
  return {
    id: taskId,
    type: 'in_process_teammate',
    status: 'running',
    description: agentName,
    startTime: 1,
    outputFile: `/t/${taskId}`,
    outputOffset: 0,
    notified: false,
    identity: {
      agentId: `${agentName}@${teamName}`,
      agentName,
      teamName,
      planModeRequired: false,
      parentSessionId: 'main',
    },
    prompt: '',
    permissionMode: 'default',
    awaitingPlanApproval: false,
    pendingUserMessages: [],
    isIdle: false,
    shutdownRequested: false,
    ...overrides,
  }
}

function agent(
  id: string,
  overrides: Record<string, any> = {},
): Record<string, any> {
  return {
    id,
    type: 'local_agent',
    status: 'running',
    description: id,
    startTime: 1,
    outputFile: `/t/${id}`,
    outputOffset: 0,
    notified: false,
    agentId: id,
    prompt: '',
    agentType: 'general-purpose',
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true,
    pendingMessages: [],
    retain: false,
    diskLoaded: false,
    keepaliveReasons: new Set(),
    ...overrides,
  }
}

describe('stopTask ySr/gtf', () => {
  test('isAgentDescendantOf walks parentAgentId chain', () => {
    const tasks = {
      root: agent('root'),
      mid: agent('mid', { parentAgentId: 'root' }),
      leaf: agent('leaf', { parentAgentId: 'mid' }),
      other: agent('other', { parentAgentId: 'x' }),
    }
    expect(isAgentDescendantOf(tasks.leaf as any, 'root', tasks as any)).toBe(
      true,
    )
    expect(isAgentDescendantOf(tasks.mid as any, 'root', tasks as any)).toBe(
      true,
    )
    expect(isAgentDescendantOf(tasks.other as any, 'root', tasks as any)).toBe(
      false,
    )
    expect(isAgentDescendantOf(tasks.root as any, 'root', tasks as any)).toBe(
      false,
    )
  })

  test('stopTask kills running local_agent and marks stoppedByUser', async () => {
    const s = store({ a: agent('a') })
    const result = await stopTask('a', {
      getAppState: s.get as any,
      setAppState: s.set as any,
    })
    expect(result.outcome).toBe('killed')
    expect(s.get().tasks.a.status).toBe('killed')
    expect(s.get().tasks.a.stoppedByUser).toBe(true)
  })

  test('stopTask kills YC parked local_agent (not only running)', async () => {
    const s = store({
      a: agent('a', {
        status: 'completed',
        notified: true,
        keepaliveReasons: new Set(['agent:kid']),
        endTime: 2,
      }),
    })
    const result = await stopTask('a', {
      getAppState: s.get as any,
      setAppState: s.set as any,
    })
    expect(result.outcome).toBe('killed')
    expect(s.get().tasks.a.status).toBe('killed')
  })

  test('stopTask dismisses terminal non-parked local_agent via Rba (evictAfter:0)', async () => {
    const s = store({
      a: agent('a', {
        status: 'failed',
        notified: true,
        endTime: 2,
        keepaliveReasons: new Set(),
        retain: true,
        diskLoaded: true,
      }),
    })
    const result = await stopTask('a', {
      getAppState: s.get as any,
      setAppState: s.set as any,
    })
    expect(result.outcome).toBe('dismissed')
    // Official Rba keeps the task entry, forces hide with evictAfter:0
    expect(s.get().tasks.a).toBeDefined()
    expect(s.get().tasks.a.evictAfter).toBe(0)
    expect(s.get().tasks.a.retain).toBe(false)
    expect(s.get().tasks.a.diskLoaded).toBe(false)
  })

  test('stopTask cascades gtf kill to descendants', async () => {
    const s = store({
      root: agent('root'),
      mid: agent('mid', { parentAgentId: 'root' }),
      leaf: agent('leaf', {
        parentAgentId: 'mid',
        status: 'completed',
        notified: true,
        keepaliveReasons: new Set(['agent:x']),
        endTime: 2,
      }),
      cousin: agent('cousin', { parentAgentId: 'other-root' }),
    })
    await stopTask('root', {
      getAppState: s.get as any,
      setAppState: s.set as any,
    })
    expect(s.get().tasks.root.status).toBe('killed')
    expect(s.get().tasks.mid.status).toBe('killed')
    expect(s.get().tasks.leaf.status).toBe('killed')
    // cousin not under root
    expect(s.get().tasks.cousin.status).toBe('running')
    expect(s.get().tasks.mid.stoppedByUser).toBe(true)
    expect(s.get().tasks.leaf.stoppedByUser).toBe(true)
  })

  test('killDescendantAgents alone kills only tree under root', () => {
    const tasks = {
      root: agent('root'),
      kid: agent('kid', { parentAgentId: 'root' }),
      other: agent('other'),
    }
    const s = store(tasks)
    killDescendantAgents(
      { id: 'root', agentId: 'root' },
      s.get().tasks,
      s.set as any,
      { source: 'user' },
    )
    expect(s.get().tasks.kid.status).toBe('killed')
    expect(s.get().tasks.other.status).toBe('running')
    expect(s.get().tasks.root.status).toBe('running')
  })

  test('markAgentStoppedByUser is idempotent', () => {
    const s = store({ a: agent('a') })
    markAgentStoppedByUser('a', s.set as any)
    const first = s.get().tasks.a
    markAgentStoppedByUser('a', s.set as any)
    // same object identity when already set (updateTaskState returns task)
    expect(s.get().tasks.a.stoppedByUser).toBe(true)
    expect(first.stoppedByUser).toBe(true)
  })

  test('stopTask not_found', async () => {
    const s = store({})
    await expect(
      stopTask('missing', {
        getAppState: s.get as any,
        setAppState: s.set as any,
      }),
    ).rejects.toMatchObject({
      name: 'StopTaskError',
      code: 'not_found',
      message: expect.stringContaining('No task found with ID: missing'),
    })
  })

  test('Elo: resolve agentNameRegistry name to local_agent and kill', async () => {
    const s = store(
      { a1: agent('a1') },
      { agentNameRegistry: new Map([['researcher', 'a1']]) },
    )
    const result = await stopTask('researcher', {
      getAppState: s.get as any,
      setAppState: s.set as any,
    })
    expect(result.taskId).toBe('a1')
    expect(result.outcome).toBe('killed')
    expect(s.get().tasks.a1.status).toBe('killed')
  })

  test('Elo: ambiguous both-kinds throws not_found with message', async () => {
    const s = store(
      {
        t1: teammate('t1', 'researcher'),
        a1: agent('a1'),
      },
      { agentNameRegistry: new Map([['researcher', 'a1']]) },
    )
    await expect(
      stopTask('researcher', {
        getAppState: s.get as any,
        setAppState: s.set as any,
      }),
    ).rejects.toMatchObject({
      code: 'not_found',
      message: expect.stringContaining('matches both teammate'),
    })
    expect(s.get().tasks.a1.status).toBe('running')
    expect(s.get().tasks.t1.status).toBe('running')
  })

  test('Elo: not_found includes Did you mean suggestion', async () => {
    const s = store(
      { a1: agent('a1') },
      { agentNameRegistry: new Map([['researcher', 'a1']]) },
    )
    await expect(
      stopTask('researcehr', {
        getAppState: s.get as any,
        setAppState: s.set as any,
      }),
    ).rejects.toMatchObject({
      code: 'not_found',
      message: expect.stringMatching(/Did you mean: researcher\?/),
    })
  })

  test('H1e not_owner: observer cannot stop itself', async () => {
    const s = store({
      obs: agent('obs', { isObserver: true, agentType: 'observer' }),
    })
    await expect(
      stopTask('obs', {
        getAppState: s.get as any,
        setAppState: s.set as any,
        callerAgentId: 'obs',
      }),
    ).rejects.toMatchObject({
      name: 'StopTaskError',
      code: 'not_owner',
      message: expect.stringContaining('cannot stop itself'),
    })
    expect(s.get().tasks.obs.status).toBe('running')
  })

  test('H1e not_owner: foreign agent cannot stop local_agent', async () => {
    const s = store({ a: agent('a') })
    await expect(
      stopTask('a', {
        getAppState: s.get as any,
        setAppState: s.set as any,
        callerAgentId: 'other',
      }),
    ).rejects.toMatchObject({
      name: 'StopTaskError',
      code: 'not_owner',
      message: expect.stringContaining('is owned by'),
    })
    expect(s.get().tasks.a.status).toBe('running')
  })

  test('H1e ownership: main session (no caller) can stop any', async () => {
    const s = store({ a: agent('a'), obs: agent('obs', { isObserver: true }) })
    const r1 = await stopTask('a', {
      getAppState: s.get as any,
      setAppState: s.set as any,
    })
    expect(r1.outcome).toBe('killed')
    const r2 = await stopTask('obs', {
      getAppState: s.get as any,
      setAppState: s.set as any,
    })
    expect(r2.outcome).toBe('killed')
  })

  test('TaskStopTool validate still requires running for non-agent — source-scan ySr in stopTask', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path')
    const src = fs.readFileSync(
      path.join(import.meta.dir, '../stopTask.ts'),
      'utf8',
    )
    expect(src).toContain('killDescendantAgents')
    expect(src).toContain('markAgentStoppedByUser')
    expect(src).toContain('isParkedKeepaliveAgent')
    expect(src).toContain('evictAfter: 0')
    expect(src).toContain('stopObserverPairingInPlace')
    // densable ySr observer branch: isObserver first, outcome always killed
    expect(src).toContain('task.isObserver === true')
    // densable H1e OH: no gtf under isObserver branch (killDescendantAgents only
    // on non-observer path after markAgentsNotified of self)
    const obsIdx = src.indexOf('task.isObserver === true')
    const gtfInObs = src.indexOf('killDescendantAgents', obsIdx)
    const nonObsDismiss = src.indexOf("outcome: 'dismissed'")
    // first killDescendantAgents after isObserver should be past dismissed branch
    expect(gtfInObs).toBeGreaterThan(nonObsDismiss)
    // densable H1e not_owner
    expect(src).toContain("'not_owner'")
    expect(src).toContain('cannot stop itself')
    expect(src).toContain('callerAgentId')
    // densable Elo / sas
    expect(src).toContain('resolveTaskQuery')
    expect(src).toContain('formatTaskNotFoundMessage')
  })

  test('ySr isObserver terminal user stop returns killed + Rba (not dismissed)', async () => {
    const {
      armObserverPairing,
      getObserverPairingByObserverTaskId,
      clearAllObserverPairings,
    } = await import('../../utils/observerAgents.js')
    clearAllObserverPairings()
    armObserverPairing({
      observerTaskId: 'obs-term',
      observedKey: 'main',
      observedTaskId: 'main',
      observedEnvelopeName: 'main',
      observerAgentType: 'observer',
    })
    const s = store({
      'obs-term': agent('obs-term', {
        status: 'failed',
        notified: true,
        endTime: 2,
        keepaliveReasons: new Set(),
        isObserver: true,
        retain: true,
      }),
    })
    const result = await stopTask('obs-term', {
      getAppState: s.get as any,
      setAppState: s.set as any,
    })
    // densable: if(isObserver){...; if(user&&!running&&!YC)Rba; return "killed"}
    expect(result.outcome).toBe('killed')
    expect(s.get().tasks['obs-term'].evictAfter).toBe(0)
    expect(s.get().tasks['obs-term'].retain).toBe(false)
    expect(getObserverPairingByObserverTaskId('obs-term')?.state).toBe(
      'stopped',
    )
    clearAllObserverPairings()
  })

  test('ySr isObserver running: Fjr + hAe + XV, no gtf, outcome killed', async () => {
    const {
      armObserverPairing,
      getObserverPairingByObserverTaskId,
      clearAllObserverPairings,
    } = await import('../../utils/observerAgents.js')
    clearAllObserverPairings()
    armObserverPairing({
      observerTaskId: 'obs-run',
      observedKey: 'main',
      observedTaskId: 'main',
      observedEnvelopeName: 'main',
      observerAgentType: 'observer',
    })
    const s = store({
      'obs-run': agent('obs-run', {
        isObserver: true,
        agentType: 'observer',
      }),
      // Not a descendant of obs-run — must stay running (no gtf from OH self-stop).
      kid: agent('kid', { parentAgentId: 'obs-run' }),
    })
    const result = await stopTask('obs-run', {
      getAppState: s.get as any,
      setAppState: s.set as any,
    })
    expect(result.outcome).toBe('killed')
    expect(s.get().tasks['obs-run'].status).toBe('killed')
    expect(s.get().tasks['obs-run'].stoppedByUser).toBe(true)
    expect(s.get().tasks.kid.status).toBe('running')
    expect(getObserverPairingByObserverTaskId('obs-run')?.state).toBe('stopped')
    clearAllObserverPairings()
  })

  test('ySr isObserver YC parked: XV only (no hAe, no Rba)', async () => {
    const {
      armObserverPairing,
      getObserverPairingByObserverTaskId,
      clearAllObserverPairings,
    } = await import('../../utils/observerAgents.js')
    clearAllObserverPairings()
    armObserverPairing({
      observerTaskId: 'obs-yc',
      observedKey: 'main',
      observedTaskId: 'main',
      observedEnvelopeName: 'main',
      observerAgentType: 'observer',
    })
    const s = store({
      'obs-yc': agent('obs-yc', {
        status: 'completed',
        notified: true,
        endTime: 2,
        keepaliveReasons: new Set(['agent:x']),
        isObserver: true,
        agentType: 'observer',
        retain: true,
      }),
    })
    const result = await stopTask('obs-yc', {
      getAppState: s.get as any,
      setAppState: s.set as any,
    })
    expect(result.outcome).toBe('killed')
    expect(s.get().tasks['obs-yc'].status).toBe('killed')
    // densable H1e non-running OH: XV only — no hAe
    expect(s.get().tasks['obs-yc'].stoppedByUser).toBeUndefined()
    // densable ySr Rba only when !running && !YC
    expect(s.get().tasks['obs-yc'].evictAfter).not.toBe(0)
    expect(getObserverPairingByObserverTaskId('obs-yc')?.state).toBe('stopped')
    clearAllObserverPairings()
  })

  test('gtf Fjr: user-source observer descendant pairing stops in-place', async () => {
    const {
      armObserverPairing,
      getObserverPairingByObserverTaskId,
      clearAllObserverPairings,
    } = await import('../../utils/observerAgents.js')
    clearAllObserverPairings()
    armObserverPairing({
      observerTaskId: 'obs-kid',
      observedKey: 'root',
      observedTaskId: 'root',
      observedEnvelopeName: 'root',
      observerAgentType: 'observer',
      buffer: [{ kind: 'activity', text: 'x' } as never],
    })
    const s = store({
      root: agent('root'),
      'obs-kid': agent('obs-kid', {
        parentAgentId: 'root',
        isObserver: true,
        agentType: 'observer',
      }),
    })
    killDescendantAgents(
      { id: 'root', agentId: 'root' },
      s.get().tasks,
      s.set as any,
      { source: 'user' },
    )
    const p = getObserverPairingByObserverTaskId('obs-kid')
    expect(p?.state).toBe('stopped')
    expect(p?.buffer?.length ?? 0).toBe(0)
    expect(s.get().tasks['obs-kid'].status).toBe('killed')
    // system source must NOT Fjr (pairing stays armed)
    clearAllObserverPairings()
    armObserverPairing({
      observerTaskId: 'obs2',
      observedKey: 'root2',
      observedTaskId: 'root2',
      observedEnvelopeName: 'root2',
      observerAgentType: 'observer',
    })
    const s2 = store({
      root2: agent('root2'),
      obs2: agent('obs2', {
        parentAgentId: 'root2',
        isObserver: true,
      }),
    })
    killDescendantAgents(
      { id: 'root2', agentId: 'root2' },
      s2.get().tasks,
      s2.set as any,
      { source: 'system' },
    )
    expect(getObserverPairingByObserverTaskId('obs2')?.state).toBe('armed')
    clearAllObserverPairings()
  })

  test('jGr bulkSystemKillTasks: system kill bg agents + OH, skip foreground', async () => {
    const { bulkSystemKillTasks } = await import('../stopTask.js')
    const s = store({
      bg: agent('bg', { isBackgrounded: true }),
      fg: agent('fg', { isBackgrounded: false }),
      obs: agent('obs', { isObserver: true, agentType: 'observer' }),
      parked: agent('parked', {
        status: 'completed',
        notified: true,
        keepaliveReasons: new Set(['agent:x']),
        endTime: 2,
      }),
    })
    bulkSystemKillTasks(s.get().tasks, s.set as any)
    // densable: running && Kw && LLe (non-OH local_agent bg) → system kill + hAe + Kle
    expect(s.get().tasks.bg.status).toBe('killed')
    expect(s.get().tasks.bg.killedBy).toBe('system')
    expect(s.get().tasks.bg.stoppedByUser).toBe(true)
    expect(s.get().tasks.bg.notified).toBe(true)
    // OH running always killed (system), no hAe
    expect(s.get().tasks.obs.status).toBe('killed')
    expect(s.get().tasks.obs.killedBy).toBe('system')
    expect(s.get().tasks.obs.stoppedByUser).toBeUndefined()
    // foreground isBackgrounded===false → Kw false → skip
    expect(s.get().tasks.fg.status).toBe('running')
    // YC parked not running → jGr skips (kSu/UPa handles parked for user ESC)
    expect(s.get().tasks.parked.status).toBe('completed')
  })

  test('kSu killAllRunningAgentTasks forwards killedBy + UPa source-scan', async () => {
    const { killAllRunningAgentTasks } = await import(
      '../LocalAgentTask/LocalAgentTask.js'
    )
    const s = store({
      a: agent('a'),
      p: agent('p', {
        status: 'completed',
        notified: true,
        keepaliveReasons: new Set(['agent:x']),
        endTime: 2,
      }),
    })
    killAllRunningAgentTasks(s.get().tasks as any, s.set as any, 'system')
    expect(s.get().tasks.a.status).toBe('killed')
    expect(s.get().tasks.a.killedBy).toBe('system')
    expect(s.get().tasks.p.status).toBe('killed')
    expect(s.get().tasks.p.killedBy).toBe('system')

    // densable UPa killAgents path includes teammates + hAe
    const { readFileSync } = await import('fs')
    const cancel = readFileSync(
      new URL('../../hooks/useCancelRequest.ts', import.meta.url),
      'utf8',
    )
    expect(cancel).toContain("t.type === 'in_process_teammate'")
    expect(cancel).toContain('killInProcessTeammate')
    expect(cancel).toContain('markAgentStoppedByUser')
    expect(cancel).toContain(
      "killAllRunningAgentTasks(tasks, setAppState, 'user')",
    )
  })

  test('TaskStop killedBy parent stamps XV + source-scan', async () => {
    const s = store({ a: agent('a') })
    await stopTask('a', {
      getAppState: s.get as any,
      setAppState: s.set as any,
      killedBy: 'parent',
    })
    expect(s.get().tasks.a.status).toBe('killed')
    expect(s.get().tasks.a.killedBy).toBe('parent')

    // default / SDK path remains user
    const s2 = store({ b: agent('b') })
    await stopTask('b', {
      getAppState: s2.get as any,
      setAppState: s2.set as any,
    })
    expect(s2.get().tasks.b.killedBy).toBe('user')

    const { readFileSync } = await import('fs')
    const tool = readFileSync(
      new URL(
        '../../../packages/builtin-tools/src/tools/TaskStopTool/TaskStopTool.ts',
        import.meta.url,
      ),
      'utf8',
    )
    expect(tool).toContain("killedBy: 'parent'")
    const lat = readFileSync(
      new URL('../LocalAgentTask/LocalAgentTask.tsx', import.meta.url),
      'utf8',
    )
    expect(lat).toContain('was stopped by Claude')
    expect(lat).toContain('was stopped by user')
    expect(lat).toMatch(
      /killAsyncAgent\(\s*taskId:\s*string,\s*setAppState:\s*SetAppState,\s*killedBy:/,
    )
    // densable LocalAgentTask.kill(e,t,r,n){XV(e,t,n)} — forward killedBy
    expect(lat).toMatch(
      /async kill\(taskId,\s*setAppState,\s*killedBy\s*=\s*'user'\)/,
    )
    expect(lat).toContain('killAsyncAgent(taskId, setAppState, killedBy)')
  })

  test('XFu Ul-escapes shell stop notification for foreign owner', async () => {
    // densable XFu: Ul(t)/Ul(r)/Ul(s); call site omits stopperAgentId → main session
    // Shell task type is local_bash (isLocalShellTask); getTaskByType('local_bash')
    shellStopNotifications.length = 0
    const killMock = mock(() => {})
    getTaskByTypeMock.mockImplementation(((type?: string) =>
      type === 'local_bash' ? { kill: killMock } : undefined) as typeof getTaskByTypeMock)
    try {
      const s = store({
        'sh-id': {
          id: 'sh-id',
          type: 'local_bash',
          status: 'running',
          description: 'echo a < b & c',
          command: 'echo a < b & c',
          startTime: 1,
          outputFile: '/t/sh',
          outputOffset: 0,
          notified: false,
          agentId: 'owner-agent',
          toolUseId: 'tu<1>&2',
          isBackgrounded: true,
          completionStatusSentInAttachment: false,
          shellCommand: null,
          lastReportedTotalLines: 0,
        },
      })
      await stopTask('sh-id', {
        getAppState: s.get as any,
        setAppState: s.set as any,
        // caller is main session (undefined) ≠ owner-agent → XFu
      })
    } finally {
      getTaskByTypeMock.mockImplementation(() => undefined)
    }

    expect(killMock).toHaveBeenCalled()
    expect(shellStopNotifications.length).toBe(1)
    const cmd = shellStopNotifications[0]!
    expect(cmd.mode).toBe('task-notification')
    expect(cmd.priority).toBe('next')
    expect(cmd.agentId).toBe('owner-agent')
    const msg = String(cmd.value)
    expect(msg).toContain('<status>stopped</status>')
    expect(msg).toContain(
      'Task "echo a &lt; b &amp; c" was stopped by main session',
    )
    expect(msg).toContain('<task-id>sh-id</task-id>')
    // toolUseId Ul-escaped
    expect(msg).toContain('tu&lt;1&gt;&amp;2')
    expect(msg).not.toContain('tu<1>&2')
  })
})
