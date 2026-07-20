import { describe, expect, mock, test } from 'bun:test'
import * as realDiskOutput from '../../../utils/task/diskOutput.js'
import * as realMessageQueue from 'src/utils/messageQueueManager.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

const noop = () => {}
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

const metaStore = new Map<string, Record<string, unknown>>()
mock.module('src/utils/sessionStorage.js', () => ({
  getAgentTranscriptPath: (id: string) => `/tmp/t/${id}`,
  isTranscriptPersistenceDisabled: () => true,
  recordSidechainTranscript: async () => {},
  recordQueueOperation: noop,
  writeAgentMetadata: async (id: string, meta: Record<string, unknown>) => {
    metaStore.set(String(id), { ...meta })
  },
  readAgentMetadata: async (id: string) => metaStore.get(String(id)) ?? null,
  patchAgentMetadata: async (id: string, patch: Record<string, unknown>) => {
    const prev = metaStore.get(String(id)) ?? {}
    const next = {
      ...prev,
      ...patch,
      agentType: patch.agentType ?? prev.agentType ?? 'unknown',
    }
    metaStore.set(String(id), next)
    return next
  },
}))

const observerStops: Array<{ id: string; opts?: unknown }> = []
mock.module('src/utils/observerAgents.js', () => ({
  stopObserverPairing: async (id: string, opts?: unknown) => {
    observerStops.push({ id, opts })
    return undefined
  },
  writeObserverStoppedTombstone: async () => {},
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

const enqueued: Array<Record<string, unknown>> = []
function messageQueueMock() {
  return {
    ...realMessageQueue,
    enqueuePendingNotification: (opts: Record<string, unknown>) => {
      enqueued.push(opts)
    },
    dequeueAllMatching: () => [],
    getCommandQueue: () => [],
  }
}
mock.module('src/utils/messageQueueManager.js', messageQueueMock)
mock.module('../../../utils/messageQueueManager.js', messageQueueMock)

mock.module('src/utils/sdkEventQueue.js', () => ({
  enqueueSdkEvent: () => {},
  emitTaskTerminatedSdk: () => {},
}))

mock.module('src/utils/cleanupRegistry.js', () => ({
  registerCleanup: () => () => {},
}))

mock.module('src/services/PromptSuggestion/speculation.js', () => ({
  abortSpeculation: () => {},
}))

// LocalAgentTask pull path may load analytics; keep export surface complete
// under process-global mock pollution from sibling suites.
mock.module('src/services/analytics/index.js', () => ({
  logEvent: noop,
  stripProtoFields: (x: unknown) => x,
}))

// densable residual probes need local_bash kill without full shell runtime.
// Do NOT import src/tasks.js (huge graph / circular mock hang). Stub both
// types used by stopTask; local_agent kill delegates to killAsyncAgent after
// LocalAgentTask is loaded.
function killTaskState(
  taskId: string,
  setAppState: (f: (prev: any) => any) => void,
  killedBy?: string,
): void {
  setAppState((prev: any) => {
    const t = prev.tasks?.[taskId]
    if (!t) return prev
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: {
          ...t,
          status: 'killed',
          endTime: Date.now(),
          notified: true,
          killedBy,
          abortController: undefined,
        },
      },
    }
  })
}

let killAsyncAgentRef:
  | ((
      taskId: string,
      setAppState: (f: (prev: any) => any) => void,
      killedBy?: string,
    ) => void)
  | undefined

mock.module('src/tasks.js', () => ({
  getTaskByType: (type: string) => {
    if (type === 'local_bash') {
      return {
        name: 'LocalShellTask',
        type: 'local_bash',
        async kill(
          taskId: string,
          setAppState: (f: (prev: any) => any) => void,
          killedBy?: string,
        ) {
          killTaskState(taskId, setAppState, killedBy)
        },
      }
    }
    if (type === 'local_agent') {
      return {
        name: 'LocalAgentTask',
        type: 'local_agent',
        async kill(
          taskId: string,
          setAppState: (f: (prev: any) => any) => void,
          killedBy?: string,
        ) {
          if (killAsyncAgentRef) {
            killAsyncAgentRef(taskId, setAppState, killedBy)
          } else {
            killTaskState(taskId, setAppState, killedBy)
          }
        },
      }
    }
    return null
  },
}))

const {
  clearAgentStoppedByUser,
  isDescendantAgentOf,
  isObserverAgentTask,
  killAsyncAgent,
  killDescendantAgents,
  markAgentStoppedByUser,
} = await import('../LocalAgentTask.js')
killAsyncAgentRef = killAsyncAgent as typeof killAsyncAgentRef

const { isParkedKeepaliveAgent } = await import(
  '../../../utils/task/framework.js'
)

const { stopTask, StopTaskError } = await import('../../stopTask.js')

type AppStateLike = { tasks: Record<string, any> }

function createSetState(initial: AppStateLike = { tasks: {} }): {
  setAppState: (f: (prev: AppStateLike) => AppStateLike) => void
  getState: () => AppStateLike
  getAppState: () => AppStateLike
} {
  let state = initial
  return {
    setAppState: f => {
      state = f(state)
    },
    getState: () => state,
    getAppState: () => state,
  }
}

function agent(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type: 'local_agent',
    status: 'running',
    description: id,
    agentId: id,
    agentType: 'general-purpose',
    notified: false,
    keepaliveReasons: new Set(),
    ...overrides,
  }
}

describe('densable Beo / gtf / H1e stop cascade pure', () => {
  test('Beo isDescendantAgentOf walks parentAgentId chain', () => {
    const tasks = {
      root: agent('root'),
      mid: agent('mid', { parentAgentId: 'root' }),
      leaf: agent('leaf', { parentAgentId: 'mid' }),
      other: agent('other', { parentAgentId: 'nobody' }),
    }
    expect(isDescendantAgentOf(tasks.leaf as any, 'root', tasks as any)).toBe(
      true,
    )
    expect(isDescendantAgentOf(tasks.mid as any, 'root', tasks as any)).toBe(
      true,
    )
    expect(isDescendantAgentOf(tasks.leaf as any, 'mid', tasks as any)).toBe(
      true,
    )
    expect(isDescendantAgentOf(tasks.root as any, 'root', tasks as any)).toBe(
      false,
    )
    expect(isDescendantAgentOf(tasks.other as any, 'root', tasks as any)).toBe(
      false,
    )
  })

  test('OH isObserverAgentTask only when isObserver true', () => {
    expect(isObserverAgentTask(agent('o', { isObserver: true }))).toBe(true)
    expect(isObserverAgentTask(agent('o'))).toBe(false)
    expect(isObserverAgentTask({ type: 'local_bash' })).toBe(false)
  })

  test('gtf killDescendantAgents kills running descendants + stamps stoppedByUser', () => {
    const { setAppState, getState, getAppState } = createSetState({
      tasks: {
        root: agent('root'),
        child: agent('child', { parentAgentId: 'root' }),
        grand: agent('grand', { parentAgentId: 'child' }),
        stranger: agent('stranger'),
      },
    })
    killDescendantAgents(
      { id: 'root', agentId: 'root' },
      getAppState as any,
      setAppState as any,
      { source: 'user', killedBy: 'user' },
    )
    expect(getState().tasks.child.status).toBe('killed')
    expect(getState().tasks.grand.status).toBe('killed')
    expect(getState().tasks.child.stoppedByUser).toBe(true)
    expect(getState().tasks.stranger.status).toBe('running')
    expect(getState().tasks.root.status).toBe('running')
  })

  test('hAe markAgentStoppedByUser is idempotent', () => {
    const { setAppState, getState } = createSetState({
      tasks: { a: agent('a') },
    })
    markAgentStoppedByUser('a', setAppState as any)
    markAgentStoppedByUser('a', setAppState as any)
    expect(getState().tasks.a.stoppedByUser).toBe(true)
  })

  test('H1e stopTask refuses not_owner when callerAgentId mismatches', async () => {
    const { setAppState, getAppState } = createSetState({
      tasks: {
        a1: agent('a1', { ownerAgentId: 'owner-x', agentId: 'a1' }),
      },
    })
    await expect(
      stopTask('a1', {
        getAppState: getAppState as any,
        setAppState: setAppState as any,
        callerAgentId: 'other-agent',
      }),
    ).rejects.toMatchObject({ code: 'not_owner', name: 'StopTaskError' })
  })

  test('H1e stopTask main caller (undefined) can stop any task', async () => {
    const { setAppState, getAppState, getState } = createSetState({
      tasks: {
        a1: agent('a1', { ownerAgentId: 'owner-x', agentId: 'a1' }),
      },
    })
    const result = await stopTask('a1', {
      getAppState: getAppState as any,
      setAppState: setAppState as any,
      callerAgentId: undefined,
      source: 'user',
    })
    expect(result.taskId).toBe('a1')
    expect(getState().tasks.a1.status).toBe('killed')
    expect(getState().tasks.a1.stoppedByUser).toBe(true)
  })

  test('H1e stopTask cascades descendants only when target was YC-parked', async () => {
    const { setAppState, getAppState, getState } = createSetState({
      tasks: {
        parent: agent('parent', {
          status: 'completed',
          keepaliveReasons: new Set(['agent:child']),
          agentId: 'parent',
        }),
        child: agent('child', {
          parentAgentId: 'parent',
          agentId: 'child',
          status: 'running',
        }),
      },
    })
    expect(isParkedKeepaliveAgent(getState().tasks.parent)).toBe(true)

    await stopTask('parent', {
      getAppState: getAppState as any,
      setAppState: setAppState as any,
      source: 'user',
    })
    expect(getState().tasks.parent.status).toBe('killed')
    expect(getState().tasks.child.status).toBe('killed')
  })

  test('H1e stopTask running (non-parked) does NOT cascade descendants', async () => {
    const { setAppState, getAppState, getState } = createSetState({
      tasks: {
        parent: agent('parent', { agentId: 'parent', status: 'running' }),
        child: agent('child', {
          parentAgentId: 'parent',
          agentId: 'child',
          status: 'running',
        }),
      },
    })
    await stopTask('parent', {
      getAppState: getAppState as any,
      setAppState: setAppState as any,
      source: 'user',
    })
    expect(getState().tasks.parent.status).toBe('killed')
    // densable H1e cascade only when p=zle; running parent → no cascade
    expect(getState().tasks.child.status).toBe('running')
  })

  test('H1e observer cannot stop itself', async () => {
    const { setAppState, getAppState } = createSetState({
      tasks: {
        obs: agent('obs', {
          agentId: 'obs',
          isObserver: true,
          status: 'running',
        }),
      },
    })
    await expect(
      stopTask('obs', {
        getAppState: getAppState as any,
        setAppState: setAppState as any,
        callerAgentId: 'obs',
      }),
    ).rejects.toMatchObject({ code: 'not_owner' })
  })

  test('StopTaskError is constructible with not_owner', () => {
    const e = new StopTaskError('x', 'not_owner')
    expect(e.code).toBe('not_owner')
    expect(e.name).toBe('StopTaskError')
  })

  test('killAsyncAgent still kills running without cascade helper', () => {
    const { setAppState, getState } = createSetState({
      tasks: { a: agent('a') },
    })
    killAsyncAgent('a', setAppState as any, 'user')
    expect(getState().tasks.a.status).toBe('killed')
  })

  test('H1e Elo resolves missing id via agentNameRegistry', async () => {
    const { setAppState, getAppState, getState } = createSetState({
      tasks: {
        a1: agent('a1', { ownerAgentId: 'main', agentId: 'a1' }),
      },
    })
    // patch getAppState to include registry
    const base = getAppState
    const getWithReg = () =>
      ({
        ...base(),
        agentNameRegistry: new Map([['builder', 'a1']]),
      }) as any
    const result = await stopTask('builder', {
      getAppState: getWithReg,
      setAppState: setAppState as any,
      source: 'user',
    })
    expect(result.taskId).toBe('a1')
    expect(getState().tasks.a1.status).toBe('killed')
  })

  test('H1e Elo not_found includes Did you mean', async () => {
    const { setAppState, getAppState } = createSetState({
      tasks: {
        a1: agent('a1'),
      },
    })
    const getWithReg = () =>
      ({
        ...getAppState(),
        agentNameRegistry: new Map([['builder', 'a1']]),
      }) as any
    await expect(
      stopTask('buildr', {
        getAppState: getWithReg,
        setAppState: setAppState as any,
      }),
    ).rejects.toMatchObject({
      code: 'not_found',
      message: expect.stringContaining('Did you mean: builder?'),
    })
  })

  test('Gzg markAgentStoppedByUser persists disk stoppedByUser', async () => {
    metaStore.clear()
    const { setAppState, getState } = createSetState({
      tasks: { a1: agent('a1', { agentType: 'builder' }) },
    })
    markAgentStoppedByUser('a1', setAppState as any)
    expect(getState().tasks.a1.stoppedByUser).toBe(true)
    // fire-and-forget write
    await new Promise(r => setTimeout(r, 20))
    expect(metaStore.get('a1')?.stoppedByUser).toBe(true)
    expect(metaStore.get('a1')?.agentType).toBe('builder')
  })

  test('Aye clearAgentStoppedByUser strips only stoppedByUser', async () => {
    metaStore.set('a1', {
      agentType: 'builder',
      worktreePath: '/tmp/wt',
      stoppedByUser: true,
    })
    await clearAgentStoppedByUser('a1')
    const m = metaStore.get('a1')!
    expect(m.stoppedByUser).toBeUndefined()
    expect(m.agentType).toBe('builder')
    expect(m.worktreePath).toBe('/tmp/wt')
  })

  function bashTask(id: string, agentId: string | undefined) {
    return {
      id,
      type: 'local_bash',
      status: 'running',
      description: 'sleep 999',
      command: 'sleep 999',
      toolUseId: `tu-${id}`,
      agentId,
      notified: false,
      isBackgrounded: true,
      completionStatusSentInAttachment: false,
      shellCommand: null,
      lastReportedTotalLines: 0,
      outputFile: `/tmp/o/${id}`,
      outputOffset: 0,
      startTime: Date.now(),
    }
  }

  test('XFu: main (undefined caller) stopping owned bash notifies owner', async () => {
    // densable: tns(undefined, owner)=true so main can kill; then
    // Jk && agentId && i!==agentId → XFu
    enqueued.length = 0
    const { setAppState, getAppState, getState } = createSetState({
      tasks: { sh1: bashTask('sh1', 'owner-agent') },
    })
    await stopTask('sh1', {
      getAppState: getAppState as any,
      setAppState: setAppState as any,
      callerAgentId: undefined,
      source: 'user',
    })
    expect(getState().tasks.sh1.status).toBe('killed')
    expect(enqueued.length).toBe(1)
    expect(String(enqueued[0]!.agentId)).toBe('owner-agent')
    expect(enqueued[0]!.mode).toBe('task-notification')
    expect(String(enqueued[0]!.value)).toContain('stopped')
  })

  test('XFu: same-owner bash stop does not notify', async () => {
    enqueued.length = 0
    const { setAppState, getAppState } = createSetState({
      tasks: { sh1: bashTask('sh1', 'owner-agent') },
    })
    await stopTask('sh1', {
      getAppState: getAppState as any,
      setAppState: setAppState as any,
      callerAgentId: 'owner-agent',
      source: 'user',
    })
    expect(enqueued.length).toBe(0)
  })

  test('non-owner agent cannot stop foreign bash (not XFu path)', async () => {
    enqueued.length = 0
    const { setAppState, getAppState } = createSetState({
      tasks: { sh1: bashTask('sh1', 'owner-agent') },
    })
    await expect(
      stopTask('sh1', {
        getAppState: getAppState as any,
        setAppState: setAppState as any,
        callerAgentId: 'other-agent',
        source: 'user',
      }),
    ).rejects.toMatchObject({ code: 'not_owner' })
    expect(enqueued.length).toBe(0)
  })

  test('Fjr OH source=user stops observer pairing', async () => {
    observerStops.length = 0
    const { setAppState, getAppState, getState } = createSetState({
      tasks: {
        obs: agent('obs', {
          agentId: 'obs-agent',
          isObserver: true,
          agentType: 'observer',
        }),
      },
    })
    await stopTask('obs', {
      getAppState: getAppState as any,
      setAppState: setAppState as any,
      source: 'user',
    })
    expect(getState().tasks.obs.status).toBe('killed')
    expect(observerStops.some(s => s.id === 'obs')).toBe(true)
  })

  test('Fjr OH source=system does not stop observer pairing', async () => {
    observerStops.length = 0
    const { setAppState, getAppState } = createSetState({
      tasks: {
        obs: agent('obs', {
          agentId: 'obs-agent',
          isObserver: true,
          agentType: 'observer',
        }),
      },
    })
    await stopTask('obs', {
      getAppState: getAppState as any,
      setAppState: setAppState as any,
      source: 'system',
      killedBy: 'system',
    })
    expect(observerStops.length).toBe(0)
  })

  test('gtf cascade source=user OH also Fjr', () => {
    observerStops.length = 0
    const { setAppState, getAppState, getState } = createSetState({
      tasks: {
        root: agent('root'),
        obsChild: agent('obsChild', {
          parentAgentId: 'root',
          isObserver: true,
          agentType: 'observer',
        }),
        normalChild: agent('normalChild', { parentAgentId: 'root' }),
      },
    })
    killDescendantAgents(
      { id: 'root', agentId: 'root' },
      getAppState as any,
      setAppState as any,
      { source: 'user', killedBy: 'user' },
    )
    expect(getState().tasks.obsChild.status).toBe('killed')
    expect(getState().tasks.normalChild.status).toBe('killed')
    expect(observerStops.some(s => s.id === 'obsChild')).toBe(true)
    expect(getState().tasks.obsChild.stoppedByUser).toBe(true)
  })
})
