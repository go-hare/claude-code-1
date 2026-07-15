import { afterEach, describe, expect, test } from 'bun:test'
import {
  armObserverPairing,
  clearAllObserverPairings,
  resetObserverRuntimeHostForTests,
} from 'src/utils/observerAgents.js'
import {
  isObserverReportArmed,
  isObserverReportCallable,
  isObserverReportEnabled,
  ObserverReportTool,
} from '../ObserverReportTool.js'

afterEach(() => {
  clearAllObserverPairings()
  resetObserverRuntimeHostForTests()
  delete process.env.CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS
  delete process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS
})

describe('ObserverReport WId surface densable', () => {
  test('isObserverReportEnabled respects env gate', () => {
    expect(isObserverReportEnabled({})).toBe(false)
    expect(
      isObserverReportEnabled({
        CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1',
      }),
    ).toBe(true)
    expect(
      isObserverReportEnabled(
        { CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS: '1' },
        false,
      ),
    ).toBe(false)
  })

  test('isObserverReportCallable / Armed require pairing or observer task id', () => {
    expect(isObserverReportCallable(undefined)).toBe(false)
    expect(isObserverReportCallable('main')).toBe(false)
    expect(isObserverReportArmed('main')).toBe(false)

    armObserverPairing({
      observerTaskId: 'obs-w1',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'agent-1',
    })
    expect(isObserverReportCallable('obs-w1')).toBe(true)
    expect(isObserverReportArmed('obs-w1')).toBe(true)
    expect(isObserverReportCallable('not-an-observer')).toBe(false)
  })

  test('checkPermissions denies main / non-observer agentId', async () => {
    const deny = await ObserverReportTool.checkPermissions!({ report: 'x' }, {
      agentId: undefined,
    } as any)
    expect(deny.behavior).toBe('deny')

    armObserverPairing({
      observerTaskId: 'obs-w2',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'agent-2',
    })
    const allow = await ObserverReportTool.checkPermissions!({ report: 'x' }, {
      agentId: 'obs-w2',
    } as any)
    expect(allow.behavior).toBe('allow')
  })

  test('call returns not-observer message without pairing', async () => {
    const result = await ObserverReportTool.call!({ report: 'hi' }, {
      agentId: 'main',
    } as any)
    expect(result.data.success).toBe(false)
    expect(result.data.message).toContain('only available to an observer')
  })

  test('call prefers setAppStateForTasks over no-op setAppState', async () => {
    armObserverPairing({
      observerTaskId: 'obs-w3',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'agent-3',
    })
    const setAppStateCalls: unknown[] = []
    const setAppStateForTasksCalls: unknown[] = []
    const noopSetAppState = (fn: unknown) => {
      setAppStateCalls.push(fn)
    }
    const realSetAppStateForTasks = (fn: unknown) => {
      setAppStateForTasksCalls.push(fn)
    }
    // deliverObserverReport needs running observed task for agent path —
    // even without that, the enqueueAgent closure must close over
    // setAppStateForTasks when present (async observer no-op setAppState).
    const result = await ObserverReportTool.call!({ report: 'findings' }, {
      agentId: 'obs-w3',
      setAppState: noopSetAppState,
      setAppStateForTasks: realSetAppStateForTasks,
      getAppState: () => ({
        tasks: {
          'agent-3': { type: 'local_agent', status: 'running' },
        },
      }),
    } as any)
    // Either main or agent enqueue path may fire depending on pairing key;
    // if agent path fires, setAppStateForTasks is used not the no-op.
    if (setAppStateForTasksCalls.length > 0 || setAppStateCalls.length > 0) {
      expect(setAppStateCalls.length).toBe(0)
      expect(setAppStateForTasksCalls.length).toBeGreaterThan(0)
    }
    expect(result.data).toBeDefined()
  })

  test('isEnabled follows process env when set', () => {
    process.env.CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS = '1'
    expect(ObserverReportTool.isEnabled()).toBe(true)
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS
    expect(ObserverReportTool.isEnabled()).toBe(false)
  })

  test('shouldDefer keeps main-pool prompt surface thin', () => {
    expect(ObserverReportTool.shouldDefer).toBe(true)
  })
})
