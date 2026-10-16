import { afterEach, describe, expect, test } from 'bun:test'
import {
  admitBackgroundLaunch,
  areBackgroundTasksDisabled,
  BACKGROUND_LAUNCH_NOT_TAKEN_MESSAGE,
  disableBackgroundTasks,
  getBackgroundLaunchRule,
  getSessionBackgroundGates,
  installBackgroundLaunchRule,
  isBackgroundAgentLaunchBlocked,
  isBackgroundLaunchDisabled,
  launchRuleToolUseIdFromAssistant,
  resetSessionBackgroundGatesForTests,
  resolveSpawnBackgroundTasksDisabled,
  runWithSessionBackgroundGates,
  sessionBackgroundGatesOf,
} from '../sessionBackgroundGates.js'
import { createSessionHost } from '../sessionHost.js'

describe('session background launch gates (densable Aut/gHo/Ier)', () => {
  afterEach(() => {
    resetSessionBackgroundGatesForTests()
  })

  test('installBackgroundLaunchRule needs tasks disabled first', () => {
    expect(() =>
      installBackgroundLaunchRule({
        parameterDescription: 'ask first',
        ask: () => undefined,
      }),
    ).toThrow(/background tasks disabled first/)
  })

  test('Ier exception: session disable + rule keeps schema field', () => {
    disableBackgroundTasks()
    installBackgroundLaunchRule({
      parameterDescription: 'confirm the launch',
      ask: () => undefined,
    })
    expect(isBackgroundLaunchDisabled()).toBe(false)
    expect(getBackgroundLaunchRule()?.parameterDescription).toBe(
      'confirm the launch',
    )
  })

  test('gHo ask() undefined is not admitted; registered() must return nothing', () => {
    disableBackgroundTasks()
    const rule = {
      parameterDescription: 'x',
      ask: () => undefined,
    }
    expect(
      admitBackgroundLaunch(rule, {
        toolUseId: 'tu_1',
        signal: new AbortController().signal,
      }),
    ).toBeUndefined()

    let handed: { agentId: string } | undefined
    const admitted = admitBackgroundLaunch(
      {
        parameterDescription: 'x',
        ask: () => ({
          confirm: () => undefined,
          registered: handover => {
            handed = handover
          },
        }),
      },
      { toolUseId: 'tu_1', signal: new AbortController().signal },
    )
    expect(
      admitted?.handOver({
        agentId: 'a1',
        abortController: new AbortController(),
      }),
    ).toBe(true)
    expect(handed?.agentId).toBe('a1')

    const refused = admitBackgroundLaunch(
      {
        parameterDescription: 'x',
        ask: () => ({
          confirm: () => undefined,
          registered: () => true as unknown as undefined,
        }),
      },
      { toolUseId: 'tu_1', signal: new AbortController().signal },
    )
    expect(
      refused?.handOver({
        agentId: 'a1',
        abortController: new AbortController(),
      }),
    ).toBe(false)
  })

  test('mn only extracts toolUseId when run_in_background===true', () => {
    expect(
      launchRuleToolUseIdFromAssistant(
        {
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tu_1',
                input: { run_in_background: true },
              },
            ],
          },
        },
        'tu_1',
      ),
    ).toBe('tu_1')
    expect(
      launchRuleToolUseIdFromAssistant(
        {
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tu_1',
                input: { run_in_background: false },
              },
            ],
          },
        },
        'tu_1',
      ),
    ).toBeUndefined()
  })

  test('Wn: rule present but not admitted disables async', () => {
    disableBackgroundTasks()
    installBackgroundLaunchRule({
      parameterDescription: 'x',
      ask: () => undefined,
    })
    const r = resolveSpawnBackgroundTasksDisabled({
      wantsBackground: true,
      assistant: {
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              input: { run_in_background: true },
            },
          ],
        },
      },
      toolUseId: 'tu_1',
      signal: new AbortController().signal,
    })
    expect(r.admitted).toBeUndefined()
    expect(r.backgroundTasksDisabled).toBe(true)
  })

  test('NLt copy is gold', () => {
    expect(BACKGROUND_LAUNCH_NOT_TAKEN_MESSAGE).toContain(
      'Run the agent without run_in_background',
    )
  })

  test('qd/Ier/gZ include Or() bare mode', () => {
    const saved = process.env.CLAUDE_CODE_SIMPLE
    process.env.CLAUDE_CODE_SIMPLE = '1'
    try {
      expect(areBackgroundTasksDisabled()).toBe(true)
      expect(isBackgroundLaunchDisabled()).toBe(true)
      expect(isBackgroundAgentLaunchBlocked()).toBe(true)
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CODE_SIMPLE
      else process.env.CLAUDE_CODE_SIMPLE = saved
    }
  })
})

describe('session background gates host bag isolation (densable Zv/R4o)', () => {
  afterEach(() => {
    resetSessionBackgroundGatesForTests()
  })

  test('sessionBackgroundGatesOf is distinct per host object', () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()
    expect(sessionBackgroundGatesOf(hostA)).not.toBe(
      sessionBackgroundGatesOf(hostB),
    )
  })

  test('same host object returns the same WeakMap bag', () => {
    const host = createSessionHost()
    expect(sessionBackgroundGatesOf(host)).toBe(sessionBackgroundGatesOf(host))
  })

  test('ALS mutators on hostA do not install a rule on hostB or bootstrap', () => {
    const hostA = createSessionHost()
    const hostB = createSessionHost()
    const bootstrap = getSessionBackgroundGates()
    runWithSessionBackgroundGates(sessionBackgroundGatesOf(hostA), () => {
      disableBackgroundTasks()
      installBackgroundLaunchRule({
        parameterDescription: 'hostA only',
        ask: () => undefined,
      })
      expect(getBackgroundLaunchRule()?.parameterDescription).toBe('hostA only')
    })
    expect(sessionBackgroundGatesOf(hostB).backgroundLaunchRule).toBeUndefined()
    expect(bootstrap.backgroundLaunchRule).toBeUndefined()
    expect(getBackgroundLaunchRule()).toBeUndefined()
  })

  test('getSessionBackgroundGates is ALS inside R4o and bootstrap outside', () => {
    const hostA = createSessionHost()
    runWithSessionBackgroundGates(sessionBackgroundGatesOf(hostA), () => {
      expect(getSessionBackgroundGates()).toBe(sessionBackgroundGatesOf(hostA))
    })
    expect(getSessionBackgroundGates()).not.toBe(
      sessionBackgroundGatesOf(hostA),
    )
  })
})
