import { afterEach, describe, expect, test } from 'bun:test'
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

afterEach(() => {
  resetSessionSpawnCaps()
})

describe('resolveMax*PerSession', () => {
  test('defaults 200', () => {
    expect(resolveMaxSubagentsPerSession({})).toBe(
      DEFAULT_MAX_SUBAGENTS_PER_SESSION,
    )
    expect(resolveMaxWebSearchesPerSession({})).toBe(
      DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
    )
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

  test('invalid env falls back', () => {
    expect(
      resolveMaxSubagentsPerSession({
        CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: 'nope',
      }),
    ).toBe(200)
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
    const env = { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '2' }
    const r1 = assertAndTakeConcurrencySlot({ env })
    const r2 = assertAndTakeConcurrencySlot({ env })
    expect(getConcurrentSubagents()).toBe(2)
    expect(() => assertAndTakeConcurrencySlot({ env })).toThrow(
      formatSubagentConcurrencyCapMessage(2),
    )
    r1()
    r2()
    expect(getConcurrentSubagents()).toBe(0)
    // after release can take again
    assertAndTakeConcurrencySlot({ env })
    expect(getConcurrentSubagents()).toBe(1)
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
  test('allows then blocks at cap', () => {
    const env = { CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: '2' }
    assertCanSpawnSubagent({ env })
    assertCanSpawnSubagent({ env })
    expect(() => assertCanSpawnSubagent({ env })).toThrow(
      /Subagent spawn limit reached \(2 of 2/,
    )
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
    expect(consumeWebSearchBudgetOrCapMessage({ env })).toBeNull()
    const cap = consumeWebSearchBudgetOrCapMessage({ env })
    expect(cap?.capped).toBe(true)
    expect(cap?.message).toBe(formatWebSearchSessionCapMessage(1, 1))
    expect(cap?.message).toContain('CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION')
  })
})
