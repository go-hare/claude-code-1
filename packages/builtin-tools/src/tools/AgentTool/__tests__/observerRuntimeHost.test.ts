import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearAllObserverPairings,
  getObserverRuntimeHost,
  resetObserverRuntimeHostForTests,
} from 'src/utils/observerAgents.js'
import {
  createAgentObserverRuntimeHostHandlers,
  installAgentObserverRuntimeHost,
} from '../observerRuntimeHost.js'

afterEach(() => {
  resetObserverRuntimeHostForTests()
  clearAllObserverPairings()
})

describe('createAgentObserverRuntimeHostHandlers', () => {
  test('exposes spawn/deliver/abort/writeTombstone', () => {
    const h = createAgentObserverRuntimeHostHandlers({
      log: () => {},
    })
    expect(typeof h.spawnFirstRun).toBe('function')
    expect(typeof h.deliver).toBe('function')
    expect(typeof h.abortObserver).toBe('function')
    expect(typeof h.writeTombstone).toBe('function')
  })

  test('installAgentObserverRuntimeHost sets process host', async () => {
    expect(getObserverRuntimeHost()).toBeNull()
    const host = await installAgentObserverRuntimeHost({
      log: () => {},
    })
    expect(getObserverRuntimeHost()).toBe(host)
    expect(host.spawnFirstRun).toBeDefined()
    // Real host is not the refuse-stub only install — deliver exists.
    expect(typeof host.deliver).toBe('function')
  })
})
