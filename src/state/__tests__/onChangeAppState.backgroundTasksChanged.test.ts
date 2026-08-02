/**
 * densable 2.1.211 JNe/Zlr/Kw — background_tasks_changed on tasks membership.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import type { AppState } from '../AppStateStore.js'
import { getDefaultAppState } from '../AppStateStore.js'

const emitted: Array<{
  task_id: string
  task_type: string
  description: string
}[]> = []

mock.module('../../utils/sdkEventQueue.js', () => ({
  emitBackgroundTasksChangedSdk: (
    tasks: Array<{
      task_id: string
      task_type: string
      description: string
    }>,
  ) => {
    emitted.push(tasks)
  },
}))

const { onChangeAppState } = await import('../onChangeAppState.js')

function baseState(
  tasks: AppState['tasks'] = {},
): AppState {
  return {
    ...getDefaultAppState(),
    toolPermissionContext: getEmptyToolPermissionContext(),
    tasks,
  }
}

describe('onChangeAppState background_tasks_changed (densable 211)', () => {
  beforeEach(() => {
    emitted.length = 0
  })

  afterEach(() => {
    emitted.length = 0
  })

  test('emits REPLACE list when running background shell appears', () => {
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
      } as AppState['tasks'][string],
    })
    onChangeAppState({ newState, oldState })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toEqual([
      {
        task_id: 'b1',
        task_type: 'local_bash',
        description: 'sleep 10',
      },
    ])
  })

  test('excludes foreground agent (isBackgrounded===false)', () => {
    const oldState = baseState({})
    const newState = baseState({
      a1: {
        id: 'a1',
        type: 'local_agent',
        status: 'running',
        description: 'Agent "x"',
        startTime: Date.now(),
        outputFile: '/tmp/out',
        outputOffset: 0,
        notified: false,
        isBackgrounded: false,
      } as AppState['tasks'][string],
    })
    onChangeAppState({ newState, oldState })
    expect(emitted).toHaveLength(0)
  })

  test('emits empty set when last live task completes', () => {
    const oldState = baseState({
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
      } as AppState['tasks'][string],
    })
    const newState = baseState({
      b1: {
        id: 'b1',
        type: 'local_bash',
        status: 'completed',
        description: 'sleep 10',
        startTime: Date.now(),
        outputFile: '/tmp/out',
        outputOffset: 0,
        notified: true,
        isBackgrounded: true,
      } as AppState['tasks'][string],
    })
    onChangeAppState({ newState, oldState })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toEqual([])
  })

  test('no emit when only non-membership fields change', () => {
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
      b1: {
        ...task,
        outputOffset: 99,
      } as AppState['tasks'][string],
    })
    onChangeAppState({ newState, oldState })
    expect(emitted).toHaveLength(0)
  })
})
