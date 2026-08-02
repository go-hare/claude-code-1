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
  emitModelFallbackSdk,
  emitTaskSummarySdk,
  emitTaskTerminatedSdk,
  emitTaskUpdatedSdk,
  emitThinkingTokensSdk,
  enqueueSdkEvent,
} = await import('../sdkEventQueue.js')
const { notifyCommandLifecycle } = await import('../commandLifecycle.js')

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

describe('command_lifecycle stream-json (Official 2.1)', () => {
  beforeEach(() => {
    drainSdkEvents()
  })

  afterEach(() => {
    drainSdkEvents()
  })

  test('notifyCommandLifecycle enqueues started/completed with command uuid', () => {
    notifyCommandLifecycle('cmd-uuid-1', 'started')
    notifyCommandLifecycle('cmd-uuid-1', 'completed')
    const events = drainSdkEvents()
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'command_lifecycle',
      uuid: 'cmd-uuid-1',
      state: 'started',
      session_id: 'sess-test',
    })
    expect(events[1]).toMatchObject({
      type: 'command_lifecycle',
      uuid: 'cmd-uuid-1',
      state: 'completed',
    })
    // Drain must not rewrite the command uuid (Host/CCR ack key).
    expect(events[0]?.uuid).toBe('cmd-uuid-1')
    expect(typeof events[0]?.timestamp).toBe('string')
  })

  test('empty uuid does not enqueue', () => {
    notifyCommandLifecycle('', 'started')
    expect(drainSdkEvents()).toHaveLength(0)
  })
})

describe('thinking_tokens stream-json (Official 2.1)', () => {
  beforeEach(() => {
    drainSdkEvents()
  })

  afterEach(() => {
    drainSdkEvents()
  })

  test('emitThinkingTokensSdk enqueues cumulative + delta', () => {
    emitThinkingTokensSdk(120, 40)
    const events = drainSdkEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 120,
      estimated_tokens_delta: 40,
      session_id: 'sess-test',
    })
    expect(typeof events[0]?.uuid).toBe('string')
  })
})

describe('task_updated / task_summary / model_fallback (Official 2.1)', () => {
  beforeEach(() => {
    drainSdkEvents()
  })

  afterEach(() => {
    drainSdkEvents()
  })

  test('emitTaskUpdatedSdk enqueues wire-safe patch', () => {
    emitTaskUpdatedSdk('task-1', {
      status: 'running',
      is_backgrounded: true,
      description: 'Agent "x"',
    })
    const events = drainSdkEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'system',
      subtype: 'task_updated',
      task_id: 'task-1',
      patch: {
        status: 'running',
        is_backgrounded: true,
        description: 'Agent "x"',
      },
      session_id: 'sess-test',
    })
  })

  test('emitTaskUpdatedSdk no-ops on empty patch or empty id', () => {
    emitTaskUpdatedSdk('', { status: 'running' })
    emitTaskUpdatedSdk('task-1', {})
    expect(drainSdkEvents()).toHaveLength(0)
  })

  test('emitTaskSummarySdk detail string and null clear', () => {
    emitTaskSummarySdk('Editing src/foo.ts')
    emitTaskSummarySdk(null)
    const events = drainSdkEvents()
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'system',
      subtype: 'task_summary',
      detail: 'Editing src/foo.ts',
    })
    expect(events[1]).toMatchObject({
      type: 'system',
      subtype: 'task_summary',
      detail: null,
    })
  })

  test('emitModelFallbackSdk enqueues host notification', () => {
    emitModelFallbackSdk({
      trigger: 'overloaded',
      originalModel: 'claude-opus',
      fallbackModel: 'claude-sonnet',
      content: 'Switched to sonnet due to high demand for opus',
    })
    const events = drainSdkEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'system',
      subtype: 'model_fallback',
      trigger: 'overloaded',
      original_model: 'claude-opus',
      fallback_model: 'claude-sonnet',
      content: 'Switched to sonnet due to high demand for opus',
    })
  })

  test('eviction prefers keeping task_updated under pressure', () => {
    for (let i = 0; i < 1000; i++) {
      enqueueSdkEvent({
        type: 'system',
        subtype: 'session_state_changed',
        state: 'running',
      })
    }
    emitTaskUpdatedSdk('keep-updated', { is_backgrounded: true })
    const events = drainSdkEvents()
    const updated = events.filter(
      (e): e is typeof e & { subtype: 'task_updated'; task_id: string } =>
        e.type === 'system' && e.subtype === 'task_updated',
    )
    expect(updated.some(e => e.task_id === 'keep-updated')).toBe(true)
  })
})
