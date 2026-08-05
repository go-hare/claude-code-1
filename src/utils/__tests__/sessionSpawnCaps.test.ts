import { afterEach, describe, expect, test } from 'bun:test'
import {
  assertCanSpawnSubagent,
  consumeWebSearchBudgetOrCapMessage,
  DEFAULT_MAX_SUBAGENTS_PER_SESSION,
  DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
  formatWebSearchSessionCapMessage,
  getTotalAgentSpawns,
  getWebSearchCalls,
  incrementTotalAgentSpawns,
  incrementWebSearchCalls,
  resetSessionSpawnCaps,
  resolveMaxSubagentsPerSession,
  resolveMaxWebSearchesPerSession,
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
