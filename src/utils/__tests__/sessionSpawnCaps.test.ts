import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import {
  assertAndTakeConcurrencySlot,
  assertCanSpawnSubagent,
  assertSubagentDepthAllowed,
  consumeWebSearchBudgetOrCapMessage,
  DEFAULT_MAX_CONCURRENT_SUBAGENTS,
  DEFAULT_MAX_SUBAGENTS_PER_SESSION,
  DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH,
  DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
  formatSubagentConcurrencyCapMessage,
  formatSubagentDepthCapMessage,
  formatWebSearchSessionCapMessage,
  getConcurrentSubagents,
  getTotalAgentSpawns,
  getWebSearchCalls,
  incrementTotalAgentSpawns,
  incrementWebSearchCalls,
  resetSessionSpawnCaps,
  resolveMaxConcurrentSubagents,
  resolveMaxSubagentsPerSession,
  resolveMaxSubagentSpawnDepth,
  resolveMaxWebSearchesPerSession,
  takeConcurrencySlot,
} from '../sessionSpawnCaps.js'
import {
  resetSubagentSpawnLedgerForTests,
  snapshotSubagentSpawnLedger,
} from '../subagentSpawnLedger.js'
import type { AppState } from '../../state/AppState.js'
import { createTaskRegistry } from '../taskRegistry.js'

// Pin growthbook to defaults for this file — co-suites that leave
// getFeatureValue_CACHED_MAY_BE_STALE always-true bypass amber_kestrel throw path.
const realGrowthbook = await import('src/services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: (_n: string, d: unknown) => d,
}))
afterAll(() => {
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

beforeEach(() => {
  resetSessionSpawnCaps()
  resetSubagentSpawnLedgerForTests()
})
afterEach(() => {
  resetSessionSpawnCaps()
  resetSubagentSpawnLedgerForTests()
})

describe('resolveMax*PerSession', () => {
  test('densable 2.1.224 #23: default subagent session cap is unlimited', () => {
    expect(resolveMaxSubagentsPerSession({})).toBe(Number.POSITIVE_INFINITY)
    expect(DEFAULT_MAX_SUBAGENTS_PER_SESSION).toBe(Number.POSITIVE_INFINITY)
    // WebSearch soft budget still defaults to 200
    expect(resolveMaxWebSearchesPerSession({})).toBe(
      DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
    )
    expect(DEFAULT_MAX_WEB_SEARCHES_PER_SESSION).toBe(200)
  })

  test('env override', () => {
    expect(
      resolveMaxSubagentsPerSession({
        CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: '3',
      }),
    ).toBe(3)
    expect(
      resolveMaxWebSearchesPerSession({
        CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION: '7',
      }),
    ).toBe(7)
  })

  test('invalid env falls back to unlimited (224)', () => {
    expect(
      resolveMaxSubagentsPerSession({
        CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: 'nope',
      }),
    ).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('resolveMaxConcurrentSubagents (densable 2.1.217 #18)', () => {
  test('default 20', () => {
    expect(resolveMaxConcurrentSubagents({})).toBe(
      DEFAULT_MAX_CONCURRENT_SUBAGENTS,
    )
  })

  test('env CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS', () => {
    expect(
      resolveMaxConcurrentSubagents({
        CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '5',
      }),
    ).toBe(5)
  })
})

describe('resolveMaxSubagentSpawnDepth (densable 2.1.219 #24)', () => {
  test('default 3 (densable qPu)', () => {
    expect(resolveMaxSubagentSpawnDepth({})).toBe(
      DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH,
    )
    expect(DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH).toBe(3)
  })

  test('env CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 disables nesting', () => {
    expect(
      resolveMaxSubagentSpawnDepth({
        CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1',
      }),
    ).toBe(1)
  })

  test('env CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH override', () => {
    expect(
      resolveMaxSubagentSpawnDepth({
        CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '5',
      }),
    ).toBe(5)
  })
})

describe('counters', () => {
  test('increment / reset', () => {
    expect(getTotalAgentSpawns()).toBe(0)
    expect(getWebSearchCalls()).toBe(0)
    incrementTotalAgentSpawns()
    incrementWebSearchCalls()
    incrementWebSearchCalls()
    expect(getTotalAgentSpawns()).toBe(1)
    expect(getWebSearchCalls()).toBe(2)
    resetSessionSpawnCaps()
    expect(getTotalAgentSpawns()).toBe(0)
    expect(getWebSearchCalls()).toBe(0)
  })
})

describe('takeConcurrencySlot', () => {
  test('increments and once-safe release', () => {
    expect(getConcurrentSubagents()).toBe(0)
    const release = takeConcurrencySlot()
    expect(getConcurrentSubagents()).toBe(1)
    takeConcurrencySlot()
    expect(getConcurrentSubagents()).toBe(2)
    release()
    expect(getConcurrentSubagents()).toBe(1)
    release() // once-safe
    expect(getConcurrentSubagents()).toBe(1)
  })

  test('assertAndTakeConcurrencySlot blocks at cap', () => {
    let state = { tasks: {}, runningSubagents: 0 } as AppState
    const slot = {
      env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '2' },
      getAppState: () => state,
      setAppState: (updater: (prev: AppState) => AppState) => {
        state = updater(state)
      },
    }
    const r1 = assertAndTakeConcurrencySlot(slot)
    const r2 = assertAndTakeConcurrencySlot(slot)
    expect(state.runningSubagents).toBe(2)
    expect(getConcurrentSubagents()).toBe(0)
    expect(() => assertAndTakeConcurrencySlot(slot)).toThrow(
      formatSubagentConcurrencyCapMessage(2),
    )
    expect(snapshotSubagentSpawnLedger().refused.concurrency_limit).toBe(1)
    r1()
    r2()
    expect(state.runningSubagents).toBe(0)
    assertAndTakeConcurrencySlot(slot)
    expect(state.runningSubagents).toBe(1)
  })
})

describe('assertSubagentDepthAllowed', () => {
  test('main (undefined context) depth 0 allowed under default max 3', () => {
    expect(assertSubagentDepthAllowed({ env: {} })).toBe(0)
  })

  test('depth 1 blocked when max is 1', () => {
    expect(() =>
      assertSubagentDepthAllowed({
        agentContext: {
          agentId: 'a1',
          agentType: 'subagent',
          depth: 1,
        },
        env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1' },
      }),
    ).toThrow(formatSubagentDepthCapMessage(1, 1))
    expect(snapshotSubagentSpawnLedger().refused.depth_limit).toBe(1)
  })

  test('depth 1 allowed when max is 2', () => {
    expect(
      assertSubagentDepthAllowed({
        agentContext: {
          agentId: 'a1',
          agentType: 'subagent',
          depth: 1,
        },
        env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2' },
      }),
    ).toBe(1)
  })
})

describe('assertCanSpawnSubagent', () => {
  test('allows then blocks at env cap', () => {
    const env = { CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: '2' }
    assertCanSpawnSubagent({ env })
    assertCanSpawnSubagent({ env })
    expect(() => assertCanSpawnSubagent({ env })).toThrow(
      /Subagent spawn limit reached \(2 of 2/,
    )
  })

  test('densable 2.1.224 #23: no default hard cap (200+ spawns ok)', () => {
    for (let i = 0; i < 210; i++) {
      assertCanSpawnSubagent({ env: {} })
    }
    expect(getTotalAgentSpawns()).toBe(210)
  })

  test('aborted throws AbortError', () => {
    const c = new AbortController()
    c.abort()
    expect(() => assertCanSpawnSubagent({ abortSignal: c.signal })).toThrow()
  })

  test('allowInterrupt + interrupt continues (densable 2.1.216 #15)', () => {
    const c = new AbortController()
    c.abort('interrupt')
    assertCanSpawnSubagent({ abortSignal: c.signal, allowInterrupt: true })
    expect(getTotalAgentSpawns()).toBe(1)
  })

  test('allowInterrupt does not ignore other abort reasons', () => {
    const c = new AbortController()
    c.abort('user-cancel')
    expect(() =>
      assertCanSpawnSubagent({ abortSignal: c.signal, allowInterrupt: true }),
    ).toThrow()
  })
})

describe('consumeWebSearchBudgetOrCapMessage', () => {
  test('soft cap message densable copy', () => {
    const env = { CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION: '1' }
    let calls = 0
    const taskRegistry = {
      getWebSearchCalls: () => calls,
      incrementWebSearchCalls: () => {
        calls += 1
      },
    }
    expect(consumeWebSearchBudgetOrCapMessage({ env, taskRegistry })).toBeNull()
    const cap = consumeWebSearchBudgetOrCapMessage({ env, taskRegistry })
    expect(cap?.capped).toBe(true)
    expect(cap?.message).toBe(formatWebSearchSessionCapMessage(1, 1))
    expect(cap?.message).toContain('CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION')
  })

  test('without taskRegistry does not use module counter', () => {
    const env = { CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION: '1' }
    expect(consumeWebSearchBudgetOrCapMessage({ env })).toBeNull()
    expect(getWebSearchCalls()).toBe(0)
    expect(consumeWebSearchBudgetOrCapMessage({ env })).toBeNull()
    expect(getWebSearchCalls()).toBe(0)
  })

  test('uses Xm taskRegistry, not process module counter', () => {
    const env = { CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION: '1' }
    const registry = createTaskRegistry(
      () => ({ tasks: {}, runningSubagents: 0 }) as AppState,
      () => {},
    )
    expect(
      consumeWebSearchBudgetOrCapMessage({ env, taskRegistry: registry }),
    ).toBeNull()
    expect(registry.getWebSearchCalls()).toBe(1)
    expect(getWebSearchCalls()).toBe(0)
    const cap = consumeWebSearchBudgetOrCapMessage({
      env,
      taskRegistry: registry,
    })
    expect(cap?.capped).toBe(true)
    expect(cap?.used).toBe(1)
    expect(cap?.max).toBe(1)
    expect(cap?.message).toBe(formatWebSearchSessionCapMessage(1, 1))
    expect(getWebSearchCalls()).toBe(0)
  })
})

describe('takeConcurrencySlot Xm instance', () => {
  test('getAppState/setAppState writes runningSubagents, not module counter', () => {
    let state = { tasks: {}, runningSubagents: 0 } as AppState
    const release = takeConcurrencySlot({
      getAppState: () => state,
      setAppState: updater => {
        state = updater(state)
      },
    })
    expect(state.runningSubagents).toBe(1)
    expect(getConcurrentSubagents()).toBe(0)
    release()
    expect(state.runningSubagents).toBe(0)
  })

  test('assertAndTakeConcurrencySlot takes from taskRegistry', () => {
    let state = { tasks: {}, runningSubagents: 0 } as AppState
    const registry = createTaskRegistry(
      () => state,
      updater => {
        state = updater(state)
      },
    )
    const env = { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '1' }
    const release = assertAndTakeConcurrencySlot({
      env,
      taskRegistry: registry,
    })
    expect(registry.getConcurrentSubagents()).toBe(1)
    expect(getConcurrentSubagents()).toBe(0)
    expect(() =>
      assertAndTakeConcurrencySlot({ env, taskRegistry: registry }),
    ).toThrow(formatSubagentConcurrencyCapMessage(1))
    release()
    expect(registry.getConcurrentSubagents()).toBe(0)
  })

  test('assertAndTakeConcurrencySlot without Xm does not use module counter', () => {
    const env = { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '1' }
    const release = assertAndTakeConcurrencySlot({ env })
    expect(getConcurrentSubagents()).toBe(0)
    release()
    expect(getConcurrentSubagents()).toBe(0)
  })
})
