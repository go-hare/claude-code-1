/**
 * Official 2.1 Host control: background_tasks / Ctrl+B semantics.
 * Covers backgroundAll (exclude main-session), backgroundTaskByToolUseId,
 * and task_updated emit only when isBackgrounded actually flips.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import * as realBootstrapState from '../../../bootstrap/state.js'
import * as realDiskOutput from '../../../utils/task/diskOutput.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

const bootstrapSnap = snapshotModuleExports(realBootstrapState)
const diskOutputSnap = snapshotModuleExports(realDiskOutput)

const sdkEvents: Array<Record<string, unknown>> = []
const agentBgCalls: string[] = []

function bootstrapStateMock() {
  return {
    ...bootstrapSnap,
    getIsNonInteractiveSession: () => true,
    getSessionId: () => 'sess-bg-test',
    getIsInteractive: () => false,
    getLastInteractionTime: () => Date.now(),
    getMainLoopBusy: () => false,
  }
}

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('../../../bootstrap/state.js', bootstrapStateMock)
mock.module('src/bootstrap/state.js', bootstrapStateMock)

// Spread real + afterAll restore — incomplete strip poisons workflow notifications.
const realSdkEventQueue = await import('src/utils/sdkEventQueue.js')
const sdkEventQueueSnap = snapshotModuleExports(realSdkEventQueue)
function sdkEventQueueMock() {
  return {
    ...sdkEventQueueSnap,
    enqueueSdkEvent: (event: Record<string, unknown>) => sdkEvents.push(event),
    emitTaskUpdatedSdk: (taskId: string, patch: Record<string, unknown>) => {
      sdkEvents.push({
        type: 'system',
        subtype: 'task_updated',
        task_id: taskId,
        patch,
      })
    },
    emitTaskTerminatedSdk: () => true,
    drainSdkEvents: () => {
      const out = sdkEvents.splice(0)
      return out
    },
    clearTaskTerminatedSdkGate: () => {},
  }
}
mock.module('src/utils/sdkEventQueue.js', sdkEventQueueMock)
mock.module('../../../utils/sdkEventQueue.js', sdkEventQueueMock)

// LocalShellTask imports LocalAgentTask — stub bg so we don't need full agent runtime.
// Paths must match resolved module ids from LocalShellTask.tsx (not this test file).
function localAgentTaskMock() {
  return {
    isLocalAgentTask: (task: unknown): boolean =>
      typeof task === 'object' &&
      task !== null &&
      (task as { type?: string }).type === 'local_agent',
    backgroundAgentTask: (
      taskId: string,
      getAppState: () => { tasks: Record<string, any> },
      setAppState: (f: (prev: any) => any) => void,
    ): boolean => {
      const task = getAppState().tasks[taskId]
      if (!task || task.type !== 'local_agent' || task.isBackgrounded) {
        return false
      }
      agentBgCalls.push(taskId)
      setAppState((prev: any) => {
        const t = prev.tasks[taskId]
        if (!t || t.isBackgrounded) return prev
        return {
          ...prev,
          tasks: {
            ...prev.tasks,
            [taskId]: { ...t, isBackgrounded: true },
          },
        }
      })
      try {
        const { emitTaskUpdatedSdk } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('src/utils/sdkEventQueue.js') as {
            emitTaskUpdatedSdk: (
              id: string,
              patch: Record<string, unknown>,
            ) => void
          }
        emitTaskUpdatedSdk(taskId, { is_backgrounded: true })
      } catch {
        // optional
      }
      return true
    },
  }
}
mock.module('../../LocalAgentTask/LocalAgentTask.js', localAgentTaskMock)
mock.module('src/tasks/LocalAgentTask/LocalAgentTask.js', localAgentTaskMock)

function mainSessionTaskMock() {
  return {
    isMainSessionTask: (task: unknown): boolean =>
      typeof task === 'object' &&
      task !== null &&
      (task as { type?: string }).type === 'local_agent' &&
      (task as { agentType?: string }).agentType === 'main-session',
  }
}
mock.module('../../LocalMainSessionTask.js', mainSessionTaskMock)
mock.module('src/tasks/LocalMainSessionTask.js', mainSessionTaskMock)

// Never complete shell.result during unit tests — avoids enqueueShellNotification
// side effects (abortSpeculation needs full AppState).
function neverResolvingResult() {
  return new Promise<{ code: number; interrupted: boolean }>(() => {})
}

// Spread real diskOutput so DiskTaskOutput survives process-global mock pollution.
function diskOutputMock() {
  return {
    ...diskOutputSnap,
    getTaskOutputPath: (id: string) => `/tmp/out/${id}`,
    evictTaskOutput: async () => {},
    getTaskOutputDelta: async () => null,
    initTaskOutputAsSymlink: async () => {},
  }
}
mock.module('../../../utils/task/diskOutput.js', diskOutputMock)
mock.module('src/utils/task/diskOutput.js', diskOutputMock)
mock.module('../../utils/task/diskOutput.js', diskOutputMock)

const {
  backgroundAll,
  backgroundTask,
  backgroundTaskByToolUseId,
  hasForegroundTasks,
} = await import('../LocalShellTask.js')

function makeShellTask(
  id: string,
  overrides: Record<string, unknown> = {},
): any {
  const defaultShellCommand = {
    background: mock(() => true),
    result: neverResolvingResult(),
  }
  return {
    id,
    type: 'local_bash',
    status: 'running',
    description: `shell ${id}`,
    command: 'sleep 1',
    startTime: Date.now(),
    outputFile: `/tmp/out/${id}`,
    outputOffset: 0,
    notified: false,
    isBackgrounded: false as boolean,
    completionStatusSentInAttachment: false,
    lastReportedTotalLines: 0,
    toolUseId: overrides.toolUseId ?? `tu-${id}`,
    ...overrides,
    // Always ensure a shellCommand (override may replace background mock).
    shellCommand: (overrides.shellCommand as any) ?? defaultShellCommand,
  }
}

function makeAgentTask(
  id: string,
  overrides: Record<string, unknown> = {},
): any {
  return {
    id,
    type: 'local_agent',
    status: 'running',
    description: `agent ${id}`,
    startTime: Date.now(),
    outputFile: `/tmp/out/${id}`,
    outputOffset: 0,
    notified: false,
    isBackgrounded: false,
    toolUseId: overrides.toolUseId ?? `tu-${id}`,
    agentType: overrides.agentType ?? 'general-purpose',
    ...overrides,
  }
}

type State = { tasks: Record<string, any> }

function createState(tasks: Record<string, any>) {
  let state: State = { tasks }
  return {
    getAppState: () => state as any,
    setAppState: (f: (prev: any) => any) => {
      state = f(state)
    },
    getState: () => state,
  }
}

beforeEach(() => {
  sdkEvents.length = 0
  agentBgCalls.length = 0
})

afterEach(() => {
  sdkEvents.length = 0
  agentBgCalls.length = 0
})

afterAll(() => {
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('../../../bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/utils/sdkEventQueue.js', () => ({ ...sdkEventQueueSnap }))
  mock.module('../../../utils/sdkEventQueue.js', () => ({
    ...sdkEventQueueSnap,
  }))
})

describe('hasForegroundTasks / backgroundAll', () => {
  test('hasForegroundTasks ignores main-session agents', () => {
    const state = {
      tasks: {
        main: makeAgentTask('main', { agentType: 'main-session' }),
        a1: makeAgentTask('a1'),
      },
    }
    expect(hasForegroundTasks(state as any)).toBe(true)

    const onlyMain = {
      tasks: {
        main: makeAgentTask('main', { agentType: 'main-session' }),
      },
    }
    expect(hasForegroundTasks(onlyMain as any)).toBe(false)
  })

  test('backgroundAll backgrounds shell + agent but not main-session', () => {
    const shell = makeShellTask('sh1')
    const agent = makeAgentTask('ag1')
    const main = makeAgentTask('main', { agentType: 'main-session' })
    const { getAppState, setAppState, getState } = createState({
      sh1: shell,
      ag1: agent,
      main,
    })

    backgroundAll(getAppState, setAppState)

    expect(getState().tasks.sh1.isBackgrounded).toBe(true)
    expect(getState().tasks.ag1.isBackgrounded).toBe(true)
    expect(getState().tasks.main.isBackgrounded).toBe(false)
    expect(agentBgCalls).toEqual(['ag1'])

    const updated = sdkEvents.filter(e => e.subtype === 'task_updated')
    expect(updated.some(e => e.task_id === 'sh1')).toBe(true)
    expect(updated.some(e => e.task_id === 'ag1')).toBe(true)
    expect(updated.some(e => e.task_id === 'main')).toBe(false)
  })
})

describe('backgroundTaskByToolUseId', () => {
  test('backgrounds shell matched by toolUseId and returns true', () => {
    const shell = makeShellTask('sh1', { toolUseId: 'tool-abc' })
    const { getAppState, setAppState, getState } = createState({ sh1: shell })

    const ok = backgroundTaskByToolUseId('tool-abc', getAppState, setAppState)
    expect(ok).toBe(true)
    expect(getState().tasks.sh1.isBackgrounded).toBe(true)
    expect(
      sdkEvents.some(
        e =>
          e.subtype === 'task_updated' &&
          e.task_id === 'sh1' &&
          (e.patch as { is_backgrounded?: boolean })?.is_backgrounded === true,
      ),
    ).toBe(true)
  })

  test('backgrounds agent matched by toolUseId', () => {
    const agent = makeAgentTask('ag1', { toolUseId: 'tool-agent' })
    const { getAppState, setAppState, getState } = createState({ ag1: agent })

    const ok = backgroundTaskByToolUseId('tool-agent', getAppState, setAppState)
    expect(ok).toBe(true)
    expect(getState().tasks.ag1.isBackgrounded).toBe(true)
    expect(agentBgCalls).toEqual(['ag1'])
  })

  test('returns false for unknown toolUseId', () => {
    const { getAppState, setAppState } = createState({
      sh1: makeShellTask('sh1', { toolUseId: 'other' }),
    })
    expect(backgroundTaskByToolUseId('missing', getAppState, setAppState)).toBe(
      false,
    )
    expect(sdkEvents.filter(e => e.subtype === 'task_updated')).toHaveLength(0)
  })

  test('returns false for main-session even if toolUseId matches', () => {
    const main = makeAgentTask('main', {
      agentType: 'main-session',
      toolUseId: 'tool-main',
    })
    const { getAppState, setAppState, getState } = createState({ main })
    expect(
      backgroundTaskByToolUseId('tool-main', getAppState, setAppState),
    ).toBe(false)
    expect(getState().tasks.main.isBackgrounded).toBe(false)
  })

  test('returns false when already backgrounded (no task_updated)', () => {
    const shell = makeShellTask('sh1', {
      toolUseId: 'tool-abc',
      isBackgrounded: true,
    })
    const { getAppState, setAppState } = createState({ sh1: shell })
    expect(
      backgroundTaskByToolUseId('tool-abc', getAppState, setAppState),
    ).toBe(false)
    expect(sdkEvents.filter(e => e.subtype === 'task_updated')).toHaveLength(0)
  })
})

describe('backgroundTask emit guard', () => {
  test('emits task_updated only when state flips', () => {
    const shell = makeShellTask('sh1')
    const { getAppState, setAppState } = createState({ sh1: shell })

    expect(backgroundTask('sh1', getAppState, setAppState)).toBe(true)
    const first = sdkEvents.filter(e => e.subtype === 'task_updated')
    expect(first).toHaveLength(1)

    sdkEvents.length = 0
    // Already backgrounded — early return, no emit
    expect(backgroundTask('sh1', getAppState, setAppState)).toBe(false)
    expect(sdkEvents.filter(e => e.subtype === 'task_updated')).toHaveLength(0)
  })

  test('no emit when shellCommand.background fails', () => {
    const shellCommand = {
      background: mock(() => false),
      result: neverResolvingResult(),
    }
    const shell = makeShellTask('sh1', { shellCommand })
    const { getAppState, setAppState, getState } = createState({ sh1: shell })

    expect(backgroundTask('sh1', getAppState, setAppState)).toBe(false)
    expect(getState().tasks.sh1.isBackgrounded).toBe(false)
    expect(sdkEvents.filter(e => e.subtype === 'task_updated')).toHaveLength(0)
  })
})
