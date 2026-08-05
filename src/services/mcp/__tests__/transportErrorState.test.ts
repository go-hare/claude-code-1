import { describe, expect, test } from 'bun:test'
import {
  MCP_TRANSPORT_DROP_ABORT_MS,
  armAllCallWatchdogs,
  clearCallWatchdogArm,
  createMcpTransportErrorState,
  shouldAbortForTransportDrop,
} from '../transportErrorState.js'

describe('transportErrorState mid-call drop (official O / M)', () => {
  test('create starts empty', () => {
    const s = createMcpTransportErrorState()
    expect(s.consecutiveErrors).toBe(0)
    expect(s.activeCallWatchdogs.size).toBe(0)
    expect(s.pendingElicitations).toBe(0)
    expect(s.lastElicitationClosedAt).toBe(0)
  })

  test('armAll only sets unarmed watchdogs', () => {
    const s = createMcpTransportErrorState()
    const a = { armedAt: 0 }
    const b = { armedAt: 100 }
    s.activeCallWatchdogs.add(a)
    s.activeCallWatchdogs.add(b)
    armAllCallWatchdogs(s)
    expect(a.armedAt).toBeGreaterThan(0)
    expect(b.armedAt).toBe(100)
  })

  test('shouldAbort after 90s when armed', () => {
    const w = { armedAt: 1_000 }
    expect(
      shouldAbortForTransportDrop(w, 1_000 + MCP_TRANSPORT_DROP_ABORT_MS),
    ).toBe(false)
    expect(
      shouldAbortForTransportDrop(w, 1_000 + MCP_TRANSPORT_DROP_ABORT_MS + 1),
    ).toBe(true)
    expect(shouldAbortForTransportDrop({ armedAt: 0 }, Date.now())).toBe(false)
  })

  test('progress clears arm', () => {
    const w = { armedAt: 50 }
    clearCallWatchdogArm(w)
    expect(w.armedAt).toBe(0)
    expect(shouldAbortForTransportDrop(w, Date.now() + 999_999)).toBe(false)
  })

  test('process pending MCP elicitation counter for auto-bg defer', () => {
    const {
      beginMcpElicitation,
      endMcpElicitation,
      hasPendingMcpElicitation,
      _resetPendingMcpElicitationsForTests,
    } =
      require('../transportErrorState.js') as typeof import('../transportErrorState.js')
    _resetPendingMcpElicitationsForTests()
    expect(hasPendingMcpElicitation()).toBe(false)
    beginMcpElicitation()
    expect(hasPendingMcpElicitation()).toBe(true)
    beginMcpElicitation()
    endMcpElicitation()
    expect(hasPendingMcpElicitation()).toBe(true)
    endMcpElicitation()
    expect(hasPendingMcpElicitation()).toBe(false)
    endMcpElicitation()
    expect(hasPendingMcpElicitation()).toBe(false)
    _resetPendingMcpElicitationsForTests()
  })
})
