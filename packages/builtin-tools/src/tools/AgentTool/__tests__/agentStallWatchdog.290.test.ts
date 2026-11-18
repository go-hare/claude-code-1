import { describe, expect, test } from 'bun:test'
import { getAsyncAgentStallTimeoutMs } from '../agentToolUtils.js'

describe('v2.1.290 #87: Agent stall watchdog timeout', () => {
  test('respects CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS override', () => {
    expect(
      getAsyncAgentStallTimeoutMs({
        CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: '45000',
      }),
    ).toBe(45_000)
  })

  test('returns 600s fallback when CLAUDE_ENABLE_STREAM_WATCHDOG is disabled', () => {
    expect(
      getAsyncAgentStallTimeoutMs({
        CLAUDE_ENABLE_STREAM_WATCHDOG: '0',
      }),
    ).toBe(600_000)
  })

  test('adds 300s grace to stream idle timeout when watchdog is enabled', () => {
    expect(
      getAsyncAgentStallTimeoutMs({
        CLAUDE_STREAM_IDLE_TIMEOUT_MS: '120000',
      }),
    ).toBe(420_000)
    expect(getAsyncAgentStallTimeoutMs({})).toBe(390_000)
  })
})
