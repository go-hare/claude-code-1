/**
 * densable lf / c7c — terminal task_notification once-gate for Host Tasks.
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
import * as realBootstrapState from '../../bootstrap/state.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

const bootstrapSnap = snapshotModuleExports(realBootstrapState)

function bootstrapStateMock() {
  return {
    ...bootstrapSnap,
    getIsNonInteractiveSession: () => true,
    getSessionId: () => 'sess-test',
  }
}

// Process-global mock.module — always spread snapshot so co-suites keep exports
// like addSlowOperation (see LocalAgentTask.test.ts pattern).
mock.module('../../bootstrap/state.js', bootstrapStateMock)
mock.module('src/bootstrap/state.js', bootstrapStateMock)

afterAll(() => {
  mock.module('../../bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
})

const {
  clearTaskTerminatedSdkGate,
  drainSdkEvents,
  emitTaskTerminatedSdk,
  enqueueSdkEvent,
} = await import('../sdkEventQueue.js')

describe('emitTaskTerminatedSdk (densable lf/c7c)', () => {
  beforeEach(() => {
    drainSdkEvents()
    clearTaskTerminatedSdkGate('t1')
    clearTaskTerminatedSdkGate('t2')
  })

  afterEach(() => {
    drainSdkEvents()
  })

  test('first terminal bookend enqueues task_notification', () => {
    const ok = emitTaskTerminatedSdk('t1', 'completed', {
      summary: 'Agent "x" finished',
      outputFile: '/tmp/out/t1',
    })
    expect(ok).toBe(true)
    const events = drainSdkEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'system',
      subtype: 'task_notification',
      task_id: 't1',
      status: 'completed',
      summary: 'Agent "x" finished',
      output_file: '/tmp/out/t1',
    })
    // Host Jp timestampFromRaw(raw.timestamp) for completedAt / duration.
    expect(typeof events[0]?.timestamp).toBe('string')
    expect(Number.isNaN(Date.parse(events[0]!.timestamp))).toBe(false)
  })

  test('second emit for same taskId is once-gated (print dual path)', () => {
    expect(emitTaskTerminatedSdk('t1', 'completed')).toBe(true)
    expect(emitTaskTerminatedSdk('t1', 'completed')).toBe(false)
    expect(emitTaskTerminatedSdk('t1', 'failed')).toBe(false)
    expect(drainSdkEvents()).toHaveLength(1)
  })

  test('different taskIds each get a bookend', () => {
    expect(emitTaskTerminatedSdk('t1', 'completed')).toBe(true)
    expect(emitTaskTerminatedSdk('t2', 'stopped')).toBe(true)
    const events = drainSdkEvents()
    const ids = events
      .filter(
        (
          e,
        ): e is typeof e & { subtype: 'task_notification'; task_id: string } =>
          e.type === 'system' && e.subtype === 'task_notification',
      )
      .map(e => e.task_id)
      .sort()
    expect(ids).toEqual(['t1', 't2'])
  })

  test('clearTaskTerminatedSdkGate allows re-notify after resume', () => {
    expect(emitTaskTerminatedSdk('t1', 'completed')).toBe(true)
    clearTaskTerminatedSdkGate('t1')
    expect(emitTaskTerminatedSdk('t1', 'completed')).toBe(true)
    expect(drainSdkEvents()).toHaveLength(2)
  })

  test('bookend eviction prefers keeping task_started/task_notification', () => {
    // Fill queue with non-bookend then bookend; over-cap should drop non-bookend.
    for (let i = 0; i < 1000; i++) {
      enqueueSdkEvent({
        type: 'system',
        subtype: 'session_state_changed',
        state: 'running',
      })
    }
    emitTaskTerminatedSdk('t1', 'completed', { summary: 'keep-me' })
    const events = drainSdkEvents()
    const notifs = events.filter(
      (e): e is typeof e & { subtype: 'task_notification'; task_id: string } =>
        e.type === 'system' && e.subtype === 'task_notification',
    )
    expect(notifs.length).toBeGreaterThanOrEqual(1)
    expect(notifs.some(e => e.task_id === 't1')).toBe(true)
  })
})
