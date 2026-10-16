/**
 * densable 2.1.289 CCR running_background_tasks writer (gold E) + membership notify.
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
import { getEmptyToolPermissionContext } from '../../Tool.js'
import type { AppState } from '../AppStateStore.js'
import { getDefaultAppState } from '../AppStateStore.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import { asAgentId } from '../../types/ids.js'

const emittedSdk: Array<
  {
    task_id: string
    task_type: string
    description: string
  }[]
> = []
const emittedInternal: Array<Record<string, unknown>> = []

const realSdkEventQueue = await import('../../utils/sdkEventQueue.js')
const sdkEventQueueSnap = snapshotModuleExports(realSdkEventQueue)
mock.module('../../utils/sdkEventQueue.js', () => ({
  ...sdkEventQueueSnap,
  emitBackgroundTasksChangedSdk: (
    tasks: Array<{
      task_id: string
      task_type: string
      description: string
    }>,
  ) => {
    emittedSdk.push(tasks)
  },
}))
mock.module('src/utils/sdkEventQueue.js', () => ({
  ...sdkEventQueueSnap,
  emitBackgroundTasksChangedSdk: (
    tasks: Array<{
      task_id: string
      task_type: string
      description: string
    }>,
  ) => {
    emittedSdk.push(tasks)
  },
}))

const realSessionState = await import('../../utils/sessionState.js')
const sessionStateSnap = snapshotModuleExports(realSessionState)
mock.module('../../utils/sessionState.js', () => ({
  ...sessionStateSnap,
  notifyInternalMetadataChanged: (metadata: Record<string, unknown>) => {
    emittedInternal.push(metadata)
  },
}))
mock.module('src/utils/sessionState.js', () => ({
  ...sessionStateSnap,
  notifyInternalMetadataChanged: (metadata: Record<string, unknown>) => {
    emittedInternal.push(metadata)
  },
}))

afterAll(() => {
  mock.module('../../utils/sdkEventQueue.js', () => ({ ...sdkEventQueueSnap }))
  mock.module('src/utils/sdkEventQueue.js', () => ({ ...sdkEventQueueSnap }))
  mock.module('../../utils/sessionState.js', () => ({ ...sessionStateSnap }))
  mock.module('src/utils/sessionState.js', () => ({ ...sessionStateSnap }))
})

const { listRunningBackgroundTasksForInternalMetadata, onChangeAppState } =
  await import('../onChangeAppState.js')

function baseState(tasks: AppState['tasks'] = {}): AppState {
  return {
    ...getDefaultAppState(),
    toolPermissionContext: getEmptyToolPermissionContext(),
    tasks,
  }
}

describe('listRunningBackgroundTasksForInternalMetadata (densable 289 E)', () => {
  test('includes allowlisted live types with optional fields', () => {
    const ownerId = asAgentId('owner-obs')
    const tasks = {
      b1: {
        id: 'b1',
        type: 'local_bash',
        status: 'running',
        description: 'sleep 10',
        startTime: Date.now(),
        outputFile: '/tmp/out',
        outputOffset: 0,
        notified: false,
        isBackgrounded: true,
        agentId: ownerId,
        kind: 'monitor',
      },
      m1: {
        id: 'm1',
        type: 'monitor_ws',
        status: 'running',
        description: 'ws',
        startTime: Date.now(),
        outputFile: '/tmp/out',
        outputOffset: 0,
        notified: false,
        ambient: true,
        agentId: ownerId,
      },
      a1: {
        id: 'a1',
        type: 'local_agent',
        status: 'running',
        description: 'Agent',
        startTime: Date.now(),
        outputFile: '/tmp/out',
        outputOffset: 0,
        notified: false,
        isBackgrounded: true,
        agentId: asAgentId('a1'),
      },
      [ownerId]: {
        id: ownerId,
        type: 'local_agent',
        status: 'running',
        description: 'observer',
        startTime: Date.now(),
        outputFile: '/tmp/out',
        outputOffset: 0,
        notified: false,
        isBackgrounded: true,
        agentId: ownerId,
        isObserver: true,
      },
      dream1: {
        id: 'dream1',
        type: 'dream',
        status: 'running',
        description: 'dream',
        startTime: Date.now(),
        outputFile: '/tmp/out',
        outputOffset: 0,
        notified: false,
      },
    } as AppState['tasks']

    const listed = listRunningBackgroundTasksForInternalMetadata(tasks)
    // observer agent itself excluded (Ku); dream excluded by type filter
    expect(listed.map(t => t.task_id).sort()).toEqual(['a1', 'b1', 'm1'])
    expect(listed.find(t => t.task_id === 'b1')).toEqual({
      task_id: 'b1',
      task_type: 'local_bash',
      description: 'sleep 10',
      owner_agent_id: ownerId,
      shell_kind: 'monitor',
      observer_owned: true,
    })
    expect(listed.find(t => t.task_id === 'm1')).toEqual({
      task_id: 'm1',
      task_type: 'monitor_ws',
      description: 'ws',
      owner_agent_id: ownerId,
      ambient: true,
      observer_owned: true,
    })
    expect(listed.find(t => t.task_id === 'a1')).toEqual({
      task_id: 'a1',
      task_type: 'local_agent',
      description: 'Agent',
    })
  })

  test('type filter excludes non-listed live types', () => {
    const tasks = {
      r1: {
        id: 'r1',
        type: 'remote_agent',
        status: 'running',
        description: 'remote',
        startTime: Date.now(),
        outputFile: '/tmp/out',
        outputOffset: 0,
        notified: false,
        isBackgrounded: true,
      },
    } as unknown as AppState['tasks']
    expect(listRunningBackgroundTasksForInternalMetadata(tasks)).toEqual([])
  })
})

describe('onChangeAppState running_background_tasks notify (densable 289)', () => {
  beforeEach(() => {
    emittedSdk.length = 0
    emittedInternal.length = 0
  })

  afterEach(() => {
    emittedSdk.length = 0
    emittedInternal.length = 0
  })

  test('membership change notifies internal metadata with E shape', () => {
    const oldState = baseState({})
    const newState = baseState({
      b1: {
        id: 'b1',
        type: 'local_bash',
        status: 'running',
        description: 'sleep 10',
        startTime: Date.now(),
        outputFile: '/tmp/out',
        outputOffset: 0,
        notified: false,
        isBackgrounded: true,
        kind: 'bash',
      } as AppState['tasks'][string],
    })
    onChangeAppState({ newState, oldState })
    expect(emittedInternal).toHaveLength(1)
    expect(emittedInternal[0]).toEqual({
      running_background_tasks: [
        {
          task_id: 'b1',
          task_type: 'local_bash',
          description: 'sleep 10',
          shell_kind: 'bash',
        },
      ],
    })
    expect(emittedSdk).toHaveLength(1)
  })

  test('non-membership field change does not notify internal list', () => {
    const task = {
      id: 'b1',
      type: 'local_bash' as const,
      status: 'running' as const,
      description: 'sleep 10',
      startTime: Date.now(),
      outputFile: '/tmp/out',
      outputOffset: 0,
      notified: false,
      isBackgrounded: true,
    }
    const oldState = baseState({ b1: task as AppState['tasks'][string] })
    const newState = baseState({
      b1: { ...task, outputOffset: 99 } as AppState['tasks'][string],
    })
    onChangeAppState({ newState, oldState })
    expect(emittedInternal).toHaveLength(0)
    expect(emittedSdk).toHaveLength(0)
  })
})
