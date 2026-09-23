import { describe, expect, test } from 'bun:test'
import { SessionOnceLatches } from '../sessionSlots.js'

describe('SessionOnceLatches (2.1.251 Ge shape)', () => {
  test('once is gold-identical first-wins', () => {
    const g = new SessionOnceLatches()
    expect(g.once('effort_thinking_disabled_clamp')).toBe(true)
    expect(g.once('effort_thinking_disabled_clamp')).toBe(false)
    expect(g.hasFired('effort_thinking_disabled_clamp')).toBe(true)
    g.markFired('other')
    expect(g.hasFired('other')).toBe(true)
  })

  test('resetStreamNoEventsWarningLatch deletes only that key', () => {
    const g = new SessionOnceLatches()
    g.once('stream_no_events_fallback_warning')
    g.once('effort_thinking_disabled_clamp')
    g.resetStreamNoEventsWarningLatch()
    expect(g.hasFired('stream_no_events_fallback_warning')).toBe(false)
    expect(g.hasFired('effort_thinking_disabled_clamp')).toBe(true)
  })

  test('sibling bag fields match gold Ge shape', () => {
    const g = new SessionOnceLatches()
    expect(g.promptCacheBreak.hydrationAttempted).toBe(false)
    expect(g.promptCacheBreak.latestQueuedPersist).toBeNull()
    expect(g.promptCacheBreak.previousStateBySource).toBeInstanceOf(Map)
    expect(g.threadDecisionTracker).toBeUndefined()
    expect(g.dumpPrompts.recentRequests).toEqual([])
    expect(g.dumpPrompts.stateByAgent).toBeInstanceOf(Map)
    expect(g.lastIngressUuidBySession).toBeInstanceOf(Map)
    expect(g.cacheCoverage).toBeInstanceOf(WeakMap)
    expect(g.gzipRequestBody.latchedOff).toBe(false)
    expect(g.gzipRequestBody.telemetryByClientRequestId.max).toBe(256)
    expect(g.gzipRequestBody.ccrWorkerSkipReasonsLogged).toBeInstanceOf(Set)
    expect(g.sentPrefix.lastReport).toBeInstanceOf(WeakMap)
    expect(g.keepForeignThinkingOnUpgrade).toBeUndefined()
    expect(g.streamFirstByteArmedRequestIds.max).toBe(64)
    expect(g.skillHealthMap).toBeUndefined()
    expect(g.firedOnceKeys).toBeInstanceOf(Set)
  })
})
