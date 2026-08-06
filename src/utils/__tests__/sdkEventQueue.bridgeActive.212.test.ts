/**
 * densable 2.1.212 #22 — JT enqueue when REPL Remote Control is live (FC),
 * so task_progress with workflow_progress reaches mid-join RC clients.
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

let nonInteractive = false
let bridgeActive = false

function bootstrapStateMock() {
  return {
    ...bootstrapSnap,
    getIsNonInteractiveSession: () => nonInteractive,
    isReplBridgeActive: () => bridgeActive,
    getSessionId: () => 'sess-bridge-212',
  }
}

mock.module('../../bootstrap/state.js', bootstrapStateMock)
mock.module('src/bootstrap/state.js', bootstrapStateMock)

afterAll(() => {
  mock.module('../../bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
})

const { drainSdkEvents, enqueueSdkEvent, setSdkEventEnqueueListener } =
  await import('../sdkEventQueue.js')

describe('densable #22 JT/FC bridge-active enqueue', () => {
  beforeEach(() => {
    nonInteractive = false
    bridgeActive = false
    drainSdkEvents()
    setSdkEventEnqueueListener(null)
  })

  afterEach(() => {
    drainSdkEvents()
    setSdkEventEnqueueListener(null)
  })

  test('interactive without bridge drops enqueue (no drain consumer)', () => {
    nonInteractive = false
    bridgeActive = false
    enqueueSdkEvent({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'w1',
      description: 'wf',
      usage: { total_tokens: 1, tool_uses: 0, duration_ms: 1 },
      workflow_progress: [
        {
          type: 'workflow_agent',
          index: 0,
          state: 'start',
          label: 'a',
        },
      ],
    })
    expect(drainSdkEvents()).toHaveLength(0)
  })

  test('interactive + replBridgeActive enqueues task_progress (RC mid-join)', () => {
    nonInteractive = false
    bridgeActive = true
    enqueueSdkEvent({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'w1',
      description: 'Review: a',
      usage: { total_tokens: 9, tool_uses: 2, duration_ms: 100 },
      workflow_progress: [
        {
          type: 'workflow_agent',
          index: 0,
          state: 'start',
          label: 'a',
        },
        {
          type: 'workflow_agent',
          index: 0,
          state: 'progress',
          label: 'a',
          tokens: 9,
          toolCalls: 2,
        },
      ],
    })
    const events = drainSdkEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'w1',
    })
    const wp = (events[0] as { workflow_progress?: unknown[] })
      .workflow_progress
    expect(Array.isArray(wp)).toBe(true)
    expect(wp!.length).toBe(2)
  })

  test('setSdkEventEnqueueListener fires after successful enqueue (MGe)', () => {
    nonInteractive = true
    bridgeActive = false
    let hits = 0
    setSdkEventEnqueueListener(() => {
      hits++
    })
    enqueueSdkEvent({
      type: 'system',
      subtype: 'task_started',
      task_id: 't1',
      description: 'x',
    })
    expect(hits).toBe(1)
    // Dropped enqueue must not fire listener
    nonInteractive = false
    bridgeActive = false
    enqueueSdkEvent({
      type: 'system',
      subtype: 'task_started',
      task_id: 't2',
      description: 'y',
    })
    expect(hits).toBe(1)
  })
})
