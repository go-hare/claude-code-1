import { afterEach, describe, expect, test } from 'bun:test'
import {
  hasActiveAgentishTasks,
  isBgShellPressureReapDisabled,
  shouldReapOnMemoryPressure,
  shouldRegisterShellPressureReap,
  SHELL_PRESSURE_IDLE_MS,
} from '../shellPressureReap.js'

afterEach(() => {
  delete process.env.CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP
})

describe('isBgShellPressureReapDisabled', () => {
  test('default off', () => {
    expect(isBgShellPressureReapDisabled({})).toBe(false)
  })
  test('env truthy disables', () => {
    expect(
      isBgShellPressureReapDisabled({
        CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP: '1',
      }),
    ).toBe(true)
  })
})

describe('shouldRegisterShellPressureReap', () => {
  test('main-thread interactive bash registers', () => {
    expect(
      shouldRegisterShellPressureReap({
        agentId: undefined,
        kind: 'bash',
        isInteractive: true,
        disabled: false,
      }),
    ).toBe(true)
  })
  test('monitor never registers', () => {
    expect(
      shouldRegisterShellPressureReap({
        agentId: undefined,
        kind: 'monitor',
        isInteractive: true,
        disabled: false,
      }),
    ).toBe(false)
  })
  test('agent-scoped never registers', () => {
    expect(
      shouldRegisterShellPressureReap({
        agentId: 'a1' as never,
        kind: 'bash',
        isInteractive: true,
        disabled: false,
      }),
    ).toBe(false)
  })
  test('non-interactive never registers', () => {
    expect(
      shouldRegisterShellPressureReap({
        agentId: undefined,
        kind: 'bash',
        isInteractive: false,
        disabled: false,
      }),
    ).toBe(false)
  })
  test('disabled env never registers', () => {
    expect(
      shouldRegisterShellPressureReap({
        agentId: undefined,
        kind: 'bash',
        isInteractive: true,
        disabled: true,
      }),
    ).toBe(false)
  })
})

describe('hasActiveAgentishTasks', () => {
  test('empty / only bash → false', () => {
    expect(hasActiveAgentishTasks({})).toBe(false)
    expect(
      hasActiveAgentishTasks({
        b1: { type: 'local_bash', status: 'running' },
      }),
    ).toBe(false)
  })
  test('running local_agent → true', () => {
    expect(
      hasActiveAgentishTasks({
        a1: { type: 'local_agent', status: 'running' },
      }),
    ).toBe(true)
  })
  test('completed agent ignored', () => {
    expect(
      hasActiveAgentishTasks({
        a1: { type: 'local_agent', status: 'completed' },
      }),
    ).toBe(false)
  })
  test('idle in_process_teammate ignored', () => {
    expect(
      hasActiveAgentishTasks({
        t1: { type: 'in_process_teammate', status: 'running', isIdle: true },
      }),
    ).toBe(false)
  })
  test('long-running remote_agent ignored', () => {
    expect(
      hasActiveAgentishTasks({
        r1: { type: 'remote_agent', status: 'running', isLongRunning: true },
      }),
    ).toBe(false)
  })
})

describe('shouldReapOnMemoryPressure', () => {
  const base = {
    status: 'running' as const,
    notified: false,
    lastInteractionTime: 0,
    now: SHELL_PRESSURE_IDLE_MS + 1,
    mainLoopBusy: false,
    hasActiveAgentTasks: false,
  }

  test('reaps when idle + free', () => {
    expect(shouldReapOnMemoryPressure(base)).toBe(true)
  })
  test('skips non-running', () => {
    expect(shouldReapOnMemoryPressure({ ...base, status: 'completed' })).toBe(
      false,
    )
  })
  test('skips already notified', () => {
    expect(shouldReapOnMemoryPressure({ ...base, notified: true })).toBe(false)
  })
  test('skips recent interaction', () => {
    expect(
      shouldReapOnMemoryPressure({
        ...base,
        lastInteractionTime: base.now - 1000,
      }),
    ).toBe(false)
  })
  test('skips mainLoopBusy', () => {
    expect(shouldReapOnMemoryPressure({ ...base, mainLoopBusy: true })).toBe(
      false,
    )
  })
  test('skips active agent tasks', () => {
    expect(
      shouldReapOnMemoryPressure({ ...base, hasActiveAgentTasks: true }),
    ).toBe(false)
  })
})
