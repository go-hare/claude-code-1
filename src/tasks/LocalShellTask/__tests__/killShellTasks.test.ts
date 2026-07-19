import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as realDiskOutput from '../../../utils/task/diskOutput.js'
import * as realFramework from '../../../utils/task/framework.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

const emitSdkCalls: Array<{
  taskId: string
  status: string
  opts?: Record<string, unknown>
}> = []

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

mock.module('src/utils/sdkEventQueue.js', () => ({
  emitTaskTerminatedSdk: (
    taskId: string,
    status: string,
    opts?: Record<string, unknown>,
  ) => {
    emitSdkCalls.push({ taskId, status, opts })
    return true
  },
  clearTaskTerminatedSdkOnce: () => {},
  enqueueSdkEvent: () => {},
  drainSdkEvents: () => [],
}))

// Spread real diskOutput so sibling suites keep full surface under process-global mock.module
function diskOutputMock() {
  return {
    ...realDiskOutput,
    evictTaskOutput: async () => {},
    getTaskOutputPath: (id: string) => `/tmp/${id}`,
  }
}
mock.module('src/utils/task/diskOutput.js', diskOutputMock)
mock.module('../../utils/task/diskOutput.js', diskOutputMock)

// Keep real framework (updateTaskState, removeKeepaliveReason, etc.)
mock.module('src/utils/task/framework.js', () => ({ ...realFramework }))
mock.module('../../utils/task/framework.js', () => ({ ...realFramework }))

mock.module('src/utils/messageQueueManager.js', () => ({
  dequeueAllMatching: () => [],
  enqueuePendingNotification: () => {},
}))

const { killTask } = await import('../killShellTasks.js')

type Tasks = Record<string, any>

function store(tasks: Tasks) {
  let state = { tasks }
  const setAppState = (updater: (prev: any) => any) => {
    state = updater(state)
  }
  return { setAppState, get: () => state }
}

function makeShell(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'local_bash',
    status: 'running',
    description: 'echo hi',
    command: 'echo hi',
    notified: false,
    toolUseId: 'tu-1',
    shellCommand: {
      kill: () => {},
      cleanup: () => {},
    },
    ...overrides,
  }
}

describe('killTask densable jLe lf', () => {
  beforeEach(() => {
    emitSdkCalls.length = 0
  })

  afterEach(() => {
    emitSdkCalls.length = 0
  })

  test('emits lf stopped when task was not yet notified', () => {
    // densable jLe: if(r&&!n) lf(e,"stopped",{toolUseId,summary})
    const { setAppState, get } = store({ s1: makeShell('s1') })
    killTask('s1', setAppState)
    expect(get().tasks.s1.status).toBe('killed')
    expect(get().tasks.s1.notified).toBe(true)
    expect(emitSdkCalls).toHaveLength(1)
    expect(emitSdkCalls[0]).toMatchObject({
      taskId: 's1',
      status: 'stopped',
      opts: { toolUseId: 'tu-1', summary: 'echo hi' },
    })
  })

  test('skips lf when already notified (stopTask/XFu path de-dupes)', () => {
    const { setAppState } = store({
      s1: makeShell('s1', { notified: true }),
    })
    killTask('s1', setAppState)
    expect(emitSdkCalls).toHaveLength(0)
  })

  test('no-op when not running', () => {
    const { setAppState, get } = store({
      s1: makeShell('s1', { status: 'completed' }),
    })
    killTask('s1', setAppState)
    expect(get().tasks.s1.status).toBe('completed')
    expect(emitSdkCalls).toHaveLength(0)
  })
})
