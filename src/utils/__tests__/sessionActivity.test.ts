import { afterEach, describe, expect, test } from 'bun:test'
import {
  getMainLoopRefcount,
  resetSessionActivityForTests,
  resolveSessionActivityAgentId,
  setMainLoopRefcountListener,
  startSessionActivity,
  stopSessionActivity,
} from '../sessionActivity.js'

describe('sessionActivity mainLoopRefcount densable', () => {
  afterEach(() => {
    resetSessionActivityForTests()
  })

  test('main-thread activity bumps mainLoopRefcount', () => {
    const seen: number[] = []
    setMainLoopRefcountListener(n => seen.push(n))
    startSessionActivity('api_call')
    expect(getMainLoopRefcount()).toBe(1)
    expect(seen).toEqual([1])
    stopSessionActivity('api_call')
    expect(getMainLoopRefcount()).toBe(0)
    expect(seen).toEqual([1, 0])
  })

  test('nested agent activity does not bump mainLoopRefcount', () => {
    const seen: number[] = []
    setMainLoopRefcountListener(n => seen.push(n))
    startSessionActivity('tool_exec', 'agent-1')
    expect(getMainLoopRefcount()).toBe(0)
    expect(seen).toEqual([])
    stopSessionActivity('tool_exec', 'agent-1')
    expect(getMainLoopRefcount()).toBe(0)
  })

  test('resolveSessionActivityAgentId HOn: background agentContext wins', () => {
    expect(
      resolveSessionActivityAgentId({
        agentContext: {
          agentType: 'subagent',
          agentId: 'bg-1',
          isBackgroundAgent: true,
        },
        isBackgroundAgent: false,
        agentId: 'other',
      }),
    ).toBe('bg-1')
  })

  test('resolveSessionActivityAgentId HOn: non-background agentContext is ignored', () => {
    expect(
      resolveSessionActivityAgentId({
        agentContext: {
          agentType: 'subagent',
          agentId: 'sync-1',
          isBackgroundAgent: false,
        },
        isBackgroundAgent: false,
        agentId: 'sync-1',
      }),
    ).toBeUndefined()
  })

  test('resolveSessionActivityAgentId fallback: isBackgroundAgent flag', () => {
    expect(
      resolveSessionActivityAgentId({
        isBackgroundAgent: true,
        agentId: 'opt-bg',
      }),
    ).toBe('opt-bg')
    expect(
      resolveSessionActivityAgentId({
        isBackgroundAgent: false,
        agentId: 'opt-fg',
      }),
    ).toBeUndefined()
  })

  test('resolveSessionActivityAgentId ignores main agentType', () => {
    expect(
      resolveSessionActivityAgentId({
        agentContext: {
          agentType: 'main',
          agentId: 'main-id',
          isBackgroundAgent: true,
        },
      }),
    ).toBeUndefined()
  })
})
