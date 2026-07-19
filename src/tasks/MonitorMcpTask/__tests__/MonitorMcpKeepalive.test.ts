import { describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import * as realBootstrapState from '../../../bootstrap/state.js'
import * as realDiskOutput from '../../../utils/task/diskOutput.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/sdkEventQueue.js', () => ({
  enqueueSdkEvent: () => {},
}))
mock.module('src/utils/messageQueueManager.js', () => ({
  enqueuePendingNotification: () => {},
  dequeueAllMatching: () => [],
}))
// Spread real diskOutput so DiskTaskOutput survives process-global mock pollution.
function diskOutputMock() {
  return {
    ...realDiskOutput,
    getTaskOutputPath: (id: string) => `/tmp/${id}`,
    getTaskOutputDelta: async () => null,
    evictTaskOutput: () => {},
    initTaskOutputAsSymlink: async () => {},
  }
}
mock.module('src/utils/task/diskOutput.js', diskOutputMock)
mock.module('../../../utils/task/diskOutput.js', diskOutputMock)
mock.module('src/bootstrap/state.js', () => ({
  ...realBootstrapState,
  getIsNonInteractiveSession: () => false,
  getSessionId: () => 's',
  addSlowOperation: () => {},
}))

const {
  registerMonitorMcpTask,
  killMonitorMcp,
  completeMonitorMcpTask,
} = await import('../MonitorMcpTask.js')
const { killTask } = await import('../../LocalShellTask/killShellTasks.js')
const { isLocalShellTask } = await import('../../LocalShellTask/guards.js')

function store() {
  let state: { tasks: Record<string, any> } = { tasks: {} }
  return {
    setAppState: (f: any) => {
      state = f(state)
    },
    get: () => state,
  }
}

function seedOwner(s: ReturnType<typeof store>, id = 'owner1') {
  s.setAppState((p: any) => ({
    ...p,
    tasks: {
      ...p.tasks,
      [id]: {
        id,
        type: 'local_agent',
        status: 'completed',
        description: 'o',
        startTime: 1,
        endTime: 2,
        outputFile: '/t',
        outputOffset: 0,
        notified: true,
        agentId: id,
        prompt: '',
        agentType: 'g',
        retrieved: false,
        lastReportedToolCount: 0,
        lastReportedTokenCount: 0,
        isBackgrounded: true,
        pendingMessages: [],
        retain: false,
        diskLoaded: false,
      },
    },
  }))
}

describe('MonitorMcp keepalive', () => {
  test('register+kill attaches and detaches monitor:id', () => {
    const s = store()
    seedOwner(s)
    const id = registerMonitorMcpTask(s.setAppState as any, {
      description: 'm',
      serverName: 'srv',
      resourceUri: 'uri',
      agentId: 'owner1' as any,
    })
    expect(s.get().tasks.owner1.keepaliveReasons.has(`monitor:${id}`)).toBe(
      true,
    )
    killMonitorMcp(id, s.setAppState as any)
    expect(s.get().tasks.owner1.keepaliveReasons?.size ?? 0).toBe(0)
    expect(typeof s.get().tasks.owner1.evictAfter).toBe('number')
  })

  test('complete detaches', () => {
    const s = store()
    seedOwner(s)
    const id = registerMonitorMcpTask(s.setAppState as any, {
      description: 'm',
      serverName: 'srv',
      resourceUri: 'uri',
      agentId: 'owner1' as any,
    })
    completeMonitorMcpTask(id, s.setAppState as any)
    expect(s.get().tasks.owner1.keepaliveReasons?.has(`monitor:${id}`)).toBe(
      false,
    )
  })
})

describe('killShellTask bash keepalive detach', () => {
  test('killTask detaches bash:id from owner', () => {
    const s = store()
    seedOwner(s)
    s.setAppState((p: any) => ({
      ...p,
      tasks: {
        ...p.tasks,
        b1: {
          id: 'b1',
          type: 'local_bash',
          status: 'running',
          description: 'bash',
          startTime: 1,
          outputFile: '/t',
          outputOffset: 0,
          notified: false,
          command: 'echo',
          completionStatusSentInAttachment: false,
          shellCommand: null,
          lastReportedTotalLines: 0,
          isBackgrounded: true,
          agentId: 'owner1',
          kind: 'bash',
        },
        owner1: {
          ...p.tasks.owner1,
          keepaliveReasons: new Set(['bash:b1']),
        },
      },
    }))
    expect(isLocalShellTask(s.get().tasks.b1)).toBe(true)
    killTask('b1', s.setAppState as any)
    expect(s.get().tasks.b1.status).toBe('killed')
    expect(s.get().tasks.owner1.keepaliveReasons?.has('bash:b1')).toBe(false)
  })
})
