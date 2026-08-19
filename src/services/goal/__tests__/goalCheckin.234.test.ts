import { describe, expect, test } from 'bun:test'
import {
  clearGoalDeferralFields,
  DEFAULT_GOAL_CHECKIN_MINUTES,
  formatGoalCheckinBody,
  getGoalCheckinIntervalMs,
  listGoalDeferringTasks,
  planGoalCheckin,
  planGoalDeferralRun,
  truncateGoalCheckinLine,
} from '../goalCheckin.js'

describe('goalCheckin densable 2.1.234 (#43)', () => {
  test('wPv / getGoalCheckinIntervalMs: default 30min, env 0 disables, GB off disables', () => {
    expect(getGoalCheckinIntervalMs({}, { isFeatureEnabled: () => true })).toBe(
      DEFAULT_GOAL_CHECKIN_MINUTES * 60_000,
    )
    expect(
      getGoalCheckinIntervalMs(
        { CLAUDE_CODE_GOAL_CHECKIN_MINUTES: '0' },
        { isFeatureEnabled: () => true },
      ),
    ).toBe(0)
    expect(
      getGoalCheckinIntervalMs(
        { CLAUDE_CODE_GOAL_CHECKIN_MINUTES: '5' },
        { isFeatureEnabled: () => true },
      ),
    ).toBe(5 * 60_000)
    expect(
      getGoalCheckinIntervalMs({}, { isFeatureEnabled: () => false }),
    ).toBe(0)
  })

  test('DMv / listGoalDeferringTasks filters observer + main-session + terminal', () => {
    const out = listGoalDeferringTasks({
      a: {
        id: 'a',
        type: 'local_agent',
        status: 'running',
        startTime: 1,
        description: 'x',
      },
      b: {
        id: 'b',
        type: 'local_agent',
        status: 'running',
        startTime: 1,
        isObserver: true,
      },
      c: {
        id: 'c',
        type: 'local_agent',
        status: 'running',
        startTime: 1,
        agentType: 'main-session',
      },
      d: {
        id: 'd',
        type: 'local_bash',
        status: 'running',
        startTime: 2,
        command: 'sleep 1',
      },
      e: {
        id: 'e',
        type: 'local_bash',
        status: 'completed',
        startTime: 2,
      },
      f: {
        id: 'f',
        type: 'dream',
        status: 'running',
        startTime: 3,
      },
      g: {
        id: 'g',
        type: 'in_process_teammate',
        status: 'running',
        startTime: 4,
        isIdle: true,
      },
    } as never)
    expect(out.map(t => t.id).sort()).toEqual(['a', 'd'])
  })

  test('DMv empty when only invent-bg (dream/observer) — stopHooks must not OR extra work', () => {
    expect(
      listGoalDeferringTasks({
        f: {
          id: 'f',
          type: 'dream',
          status: 'running',
          startTime: 3,
        },
        b: {
          id: 'b',
          type: 'local_agent',
          status: 'running',
          startTime: 1,
          isObserver: true,
        },
      } as never),
    ).toEqual([])
  })

  test('kPv / planGoalDeferralRun starts and resets on new task after interval', () => {
    const first = planGoalDeferralRun({}, [{ startTime: 1000 }], 5000, 30_000)
    expect(first).toEqual({
      deferredSince: 5000,
      checkinCount: 0,
      isNewRun: true,
    })
    const cont = planGoalDeferralRun(
      { deferredSince: 5000, checkinCount: 2, lastDeferralPassAt: 6000 },
      [{ startTime: 1000 }],
      8000,
      30_000,
    )
    expect(cont.deferredSince).toBe(5000)
    expect(cont.checkinCount).toBe(2)
    expect(cont.isNewRun).toBe(false)
    const reset = planGoalDeferralRun(
      { deferredSince: 5000, checkinCount: 2, lastDeferralPassAt: 6000 },
      [{ startTime: 40_000 }],
      50_000,
      30_000,
    )
    expect(reset).toEqual({
      deferredSince: 50_000,
      checkinCount: 0,
      isNewRun: true,
    })
  })

  test('APv / formatGoalCheckinBody still-running vs cleared', () => {
    const still = formatGoalCheckinBody('ship <fix>', 45 * 60_000, [
      {
        id: 't1',
        type: 'local_bash',
        status: 'running',
        startTime: 1,
        command: 'npm test',
      },
    ])
    expect(still.summary).toContain('still running')
    expect(still.body).toContain('«ship &lt;fix&gt;»')
    expect(still.body).toContain('45 min')
    expect(still.body).toContain('t1')
    expect(still.body).toContain('shell')
    const gone = formatGoalCheckinBody('done', 30 * 60_000, [])
    expect(gone.summary).toContain('no longer running')
    expect(gone.body).toContain('Continue toward the goal')
  })

  test('iYp / planGoalCheckin injects after interval', () => {
    const goal = {
      condition: 'finish tests',
      setAt: 0,
      iterations: 0,
      tokensAtStart: 0,
    }
    const tasks = [
      {
        id: 'a',
        type: 'local_agent' as const,
        status: 'running',
        startTime: 1,
        description: 'agent',
      },
    ]
    const early = planGoalCheckin(goal, tasks, 10_000, {
      getIntervalMs: () => 30 * 60_000,
    })
    expect(early.injected).toBe(false)
    expect(early.nextGoal.deferredSince).toBe(10_000)
    expect(early.checkinText).toBeUndefined()

    const late = planGoalCheckin(
      { ...early.nextGoal },
      tasks,
      10_000 + 31 * 60_000,
      { getIntervalMs: () => 30 * 60_000 },
    )
    expect(late.injected).toBe(true)
    expect(late.checkinText).toContain('Goal check-in:')
    expect(late.nextGoal.checkinCount).toBe(1)

    expect(
      planGoalCheckin(goal, tasks, 999_999, { getIntervalMs: () => 0 })
        .injected,
    ).toBe(false)
  })

  test('clearGoalDeferralFields + truncate', () => {
    expect(
      clearGoalDeferralFields({
        condition: 'x',
        setAt: 1,
        iterations: 0,
        tokensAtStart: 0,
        deferredSince: 9,
        checkinCount: 2,
        lastDeferralPassAt: 8,
      }),
    ).toEqual({
      condition: 'x',
      setAt: 1,
      iterations: 0,
      tokensAtStart: 0,
      deferredSince: undefined,
      checkinCount: 0,
      lastDeferralPassAt: undefined,
    })
    expect(truncateGoalCheckinLine('abc', 10)).toBe('abc')
    expect(truncateGoalCheckinLine('abcdefghijXXX', 10)).toContain('… [+')
  })
})
