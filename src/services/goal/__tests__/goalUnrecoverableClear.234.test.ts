import { describe, expect, test } from 'bun:test'
import {
  classifyGoalClearKind,
  clearGoalOnUnrecoverableError,
  isTransientApiErrorMessage,
} from '../goalUnrecoverableClear.js'

describe('goalUnrecoverableClear densable 2.1.234 (#42)', () => {
  test('K1a / isTransientApiErrorMessage', () => {
    expect(isTransientApiErrorMessage({ apiErrorIsTransient: true })).toBe(true)
    expect(isTransientApiErrorMessage({ error: 'overloaded' })).toBe(true)
    expect(isTransientApiErrorMessage({ error: 'server_error' })).toBe(true)
    expect(isTransientApiErrorMessage({ error: 'authentication_failed' })).toBe(
      false,
    )
    expect(isTransientApiErrorMessage({})).toBe(false)
  })

  test('LMv / classifyGoalClearKind: keep goal on transient / abort / completed', () => {
    expect(classifyGoalClearKind({ reason: 'completed' })).toBeNull()
    expect(classifyGoalClearKind({ reason: 'aborted_streaming' })).toBeNull()
    expect(classifyGoalClearKind({ reason: 'model_error' })).toBeNull()
    expect(
      classifyGoalClearKind({
        reason: 'api_error',
        isTransient: true,
        errorKind: 'authentication_failed',
      }),
    ).toBeNull()
    expect(
      classifyGoalClearKind({
        reason: 'api_error',
        errorKind: 'overloaded',
      }),
    ).toBeNull()
    expect(
      classifyGoalClearKind({
        reason: 'api_error',
        errorKind: 'rate_limit',
      }),
    ).toBeNull()
  })

  test('LMv: context_limit terminals', () => {
    expect(classifyGoalClearKind({ reason: 'blocking_limit' })).toBe(
      'context_limit',
    )
    expect(classifyGoalClearKind({ reason: 'prompt_too_long' })).toBe(
      'context_limit',
    )
    expect(classifyGoalClearKind({ reason: 'rapid_refill_breaker' })).toBe(
      'context_limit',
    )
  })

  test('LMv: billing / model_unavailable / auth', () => {
    expect(
      classifyGoalClearKind({
        reason: 'api_error',
        errorKind: 'billing_error',
      }),
    ).toBe('billing')
    expect(
      classifyGoalClearKind({
        reason: 'api_error',
        errorKind: 'model_not_found',
      }),
    ).toBe('model_unavailable')
    // auth clear unless remote / desktop / sdk oauth refresh
    const prevRemote = process.env.CLAUDE_CODE_REMOTE
    const prevEntry = process.env.CLAUDE_CODE_ENTRYPOINT
    delete process.env.CLAUDE_CODE_REMOTE
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    try {
      expect(
        classifyGoalClearKind({
          reason: 'api_error',
          errorKind: 'authentication_failed',
        }),
      ).toBe('auth')
      expect(
        classifyGoalClearKind({
          reason: 'api_error',
          errorKind: 'oauth_org_not_allowed',
        }),
      ).toBe('auth')
      process.env.CLAUDE_CODE_REMOTE = '1'
      expect(
        classifyGoalClearKind({
          reason: 'api_error',
          errorKind: 'authentication_failed',
        }),
      ).toBeNull()
      delete process.env.CLAUDE_CODE_REMOTE
      process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'
      expect(
        classifyGoalClearKind({
          reason: 'api_error',
          errorKind: 'authentication_failed',
        }),
      ).toBeNull()
    } finally {
      if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
      else process.env.CLAUDE_CODE_REMOTE = prevRemote
      if (prevEntry === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
      else process.env.CLAUDE_CODE_ENTRYPOINT = prevEntry
    }
  })

  test('pXp yields active_goal clear + sentinel + warning notice', async () => {
    const goal = {
      condition: 'ship the fix',
      setAt: Date.now() - 5000,
      iterations: 2,
      tokensAtStart: 0,
    }
    const events: Array<{ type?: string; [k: string]: unknown }> = []
    const toolUseContext = {
      abortController: new AbortController(),
      getAppState: () =>
        ({
          activeGoal: goal,
          sessionHooks: new Map(),
        }) as never,
      setAppState: () => {},
    }
    for await (const ev of clearGoalOnUnrecoverableError(
      goal,
      toolUseContext,
      'repl_main_thread',
      { reason: 'api_error', errorKind: 'billing_error' },
    )) {
      events.push(ev as { type?: string; [k: string]: unknown })
    }
    expect(events[0]).toEqual({ type: 'active_goal', value: undefined })
    expect(events[1]?.type).toBe('attachment')
    const attachment = (
      events[1] as {
        attachment?: {
          type?: string
          met?: boolean
          sentinel?: boolean
          condition?: string
        }
      }
    ).attachment
    expect(attachment).toMatchObject({
      type: 'goal_status',
      met: true,
      sentinel: true,
      condition: 'ship the fix',
    })
    expect(events[2]?.type).toBe('system')
    const content = String((events[2] as { content?: string }).content ?? '')
    expect(content).toContain('Goal cleared after an unrecoverable error')
    expect(content).toContain('credit balance too low')
    expect(content).toContain('ship the fix')
    expect(content).toContain('Run /goal again to continue')
  })

  test('pXp no-ops for non-clear terminals and agent turns', async () => {
    const goal = {
      condition: 'x',
      setAt: Date.now(),
      iterations: 0,
      tokensAtStart: 0,
    }
    const toolUseContext = {
      abortController: new AbortController(),
      getAppState: () =>
        ({ activeGoal: goal, sessionHooks: new Map() }) as never,
      setAppState: () => {},
    }
    const keep: unknown[] = []
    for await (const ev of clearGoalOnUnrecoverableError(
      goal,
      toolUseContext,
      'repl_main_thread',
      { reason: 'completed' },
    )) {
      keep.push(ev)
    }
    expect(keep).toEqual([])

    const agent: unknown[] = []
    for await (const ev of clearGoalOnUnrecoverableError(
      goal,
      { ...toolUseContext, agentId: 'agent-1' },
      'repl_main_thread',
      { reason: 'api_error', errorKind: 'billing_error' },
    )) {
      agent.push(ev)
    }
    expect(agent).toEqual([])
  })
})
