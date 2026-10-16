/**
 * densable 2.1.289 host-keyed sdkEventQueue (`o_` / `mx` / `Nr` / `n_` / `r_`).
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
import { createSessionHost } from '../sessionHost.js'

const bootstrapSnap = snapshotModuleExports(realBootstrapState)

function bootstrapStateMock() {
  return {
    ...bootstrapSnap,
    getIsNonInteractiveSession: () => true,
    getSessionId: () => 'sess-bootstrap',
    isReplBridgeActive: () => false,
  }
}

mock.module('../../bootstrap/state.js', bootstrapStateMock)
mock.module('src/bootstrap/state.js', bootstrapStateMock)

afterAll(() => {
  mock.module('../../bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
})

const {
  drainSdkEvents,
  drainSdkEventsForSession,
  emitTaskTerminatedSdk,
  clearTaskTerminatedSdkGate,
  enqueueSdkEvent,
  getSdkEventQueue,
  getSdkEventQueueKey,
  resetSdkEventQueueForTests,
  runWithSdkEventQueue,
  runWithSdkTerminalEmitClaims,
  sdkEventQueueOf,
  sdkTerminalEmitClaimsOf,
  setSdkEventQueueKey,
  shouldRedactPersistedSdkLane,
} = await import('../sdkEventQueue.js')

describe('densable 2.1.289 host-keyed sdkEventQueue', () => {
  beforeEach(() => {
    resetSdkEventQueueForTests()
  })

  afterEach(() => {
    resetSdkEventQueueForTests()
  })

  test('sdkEventQueueOf is distinct per host object', () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()
    expect(sdkEventQueueOf(hostA)).not.toBe(sdkEventQueueOf(hostB))
    expect(sdkEventQueueOf(hostA)).toBe(sdkEventQueueOf(hostA))
  })

  test('two hosts isolation via sdkEventQueueOf + runWith', () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()
    runWithSdkEventQueue(sdkEventQueueOf(hostA), () => {
      enqueueSdkEvent({
        type: 'system',
        subtype: 'task_started',
        task_id: 'a1',
        description: 'hostA',
      })
      expect(getSdkEventQueue()).toBe(sdkEventQueueOf(hostA))
      expect(drainSdkEvents()).toHaveLength(1)
    })
    runWithSdkEventQueue(sdkEventQueueOf(hostB), () => {
      expect(drainSdkEvents()).toHaveLength(0)
      enqueueSdkEvent({
        type: 'system',
        subtype: 'task_started',
        task_id: 'b1',
        description: 'hostB',
      })
      const events = drainSdkEvents()
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        subtype: 'task_started',
        task_id: 'b1',
      })
    })
    // Drain leaves an empty array in queuesByKey (Map entry retained).
    expect(sdkEventQueueOf(hostA).currentQueueOrNull()).toEqual([])
    expect(getSdkEventQueue()).not.toBe(sdkEventQueueOf(hostA))
  })

  test('setSdkEventQueueKey + drainSdkEventsForSession', () => {
    setSdkEventQueueKey('sess-alt')
    expect(getSdkEventQueueKey()).toBe('sess-alt')
    enqueueSdkEvent({
      type: 'system',
      subtype: 'task_started',
      task_id: 'k1',
      description: 'keyed',
    })
    // Default key drain misses the sess-alt lane.
    setSdkEventQueueKey('cli')
    expect(drainSdkEvents()).toHaveLength(0)
    const events = drainSdkEventsForSession('sess-alt')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      task_id: 'k1',
      session_id: 'sess-alt',
    })
  })

  test('session-id setQueueKey enqueue drains via drainSdkEventsForSession', () => {
    const sessionId = 'sess-bootstrap'
    setSdkEventQueueKey(() => sessionId)
    expect(getSdkEventQueueKey()).toBe(sessionId)
    enqueueSdkEvent({
      type: 'system',
      subtype: 'task_started',
      task_id: 'sess-lane',
      description: 'session lane',
    })
    const events = drainSdkEventsForSession(sessionId)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      task_id: 'sess-lane',
      session_id: sessionId,
    })
    expect(drainSdkEvents()).toHaveLength(0)
  })

  test('drainForSession stamps the requested session id', () => {
    const bag = getSdkEventQueue()
    bag.setQueueKey('sess-drain')
    bag.enqueue({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'p1',
      description: 'x',
      usage: { total_tokens: 1, tool_uses: 0, duration_ms: 1 },
    })
    const events = bag.drainForSession('sess-drain')
    expect(events).toHaveLength(1)
    expect(events[0]?.session_id).toBe('sess-drain')
    expect(events[0]?.timestamp).toBeUndefined()
  })

  test('per-host terminal gate isolation', () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()
    runWithSdkTerminalEmitClaims(sdkTerminalEmitClaimsOf(hostA), () => {
      expect(emitTaskTerminatedSdk('t-shared', 'completed')).toBe(true)
      expect(emitTaskTerminatedSdk('t-shared', 'failed')).toBe(false)
    })
    runWithSdkTerminalEmitClaims(sdkTerminalEmitClaimsOf(hostB), () => {
      expect(emitTaskTerminatedSdk('t-shared', 'completed')).toBe(true)
      expect(
        sdkTerminalEmitClaimsOf(hostB).terminalEmitClaims.has('t-shared'),
      ).toBe(true)
      clearTaskTerminatedSdkGate('t-shared')
      expect(
        sdkTerminalEmitClaimsOf(hostB).terminalEmitClaims.has('t-shared'),
      ).toBe(false)
      expect(emitTaskTerminatedSdk('t-shared', 'stopped')).toBe(true)
    })
    // hostA claim remains; hostB was re-claimed after clear.
    expect(
      sdkTerminalEmitClaimsOf(hostA).terminalEmitClaims.has('t-shared'),
    ).toBe(true)
    expect(
      sdkTerminalEmitClaimsOf(hostB).terminalEmitClaims.has('t-shared'),
    ).toBe(true)
  })

  test('redactsPersistedLane blanks task_notification.output_file on drain', () => {
    const bag = getSdkEventQueue()
    bag.redactsPersistedLane = () => true
    bag.enqueue({
      type: 'system',
      subtype: 'task_notification',
      task_id: 't1',
      status: 'completed',
      output_file: '/tmp/secret',
      summary: 'done',
    })
    const events = bag.drain()
    expect(events[0]).toMatchObject({
      subtype: 'task_notification',
      output_file: '',
      summary: 'done',
    })
  })

  test('Wf analog: ENVIRONMENT_KIND=bridge redacts by default', () => {
    const saved = process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    process.env.CLAUDE_CODE_ENVIRONMENT_KIND = 'bridge'
    resetSdkEventQueueForTests()
    try {
      expect(shouldRedactPersistedSdkLane()).toBe(true)
      enqueueSdkEvent({
        type: 'system',
        subtype: 'task_notification',
        task_id: 't-bridge',
        status: 'completed',
        output_file: '/tmp/secret',
        summary: 'done',
      })
      const events = drainSdkEvents()
      expect(events[0]).toMatchObject({
        subtype: 'task_notification',
        output_file: '',
      })
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
      else process.env.CLAUDE_CODE_ENVIRONMENT_KIND = saved
      resetSdkEventQueueForTests()
    }
  })
})
