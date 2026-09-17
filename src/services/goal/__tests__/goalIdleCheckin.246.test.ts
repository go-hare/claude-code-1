/**
 * densable 2.1.246 #58 — SEA m9o=3 / GWe / b9o / d9n idle check-in cap.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppState } from '../../../state/AppStateStore.js'
import {
  DEFAULT_GOAL_CHECKIN_MINUTES,
  getGoalIdleCheckinDelayMs,
  GOAL_CHECKIN_TIMER_MIN_MS,
  GOAL_IDLE_CHECKIN_CAP,
  isGoalIdleCheckinCapped,
  type GoalCheckinActiveGoal,
  type GoalDeferringTask,
} from '../goalCheckin.js'
import {
  appendGoalIdleCheckinCapCopy,
  cancelPendingGoalIdleCheckin,
  clearGoalIdleCheckinCount,
  fireGoalIdleCheckin,
  getPendingGoalIdleCheckin,
  GOAL_IDLE_CHECKIN_PAUSED_BODY_SUFFIX,
  GOAL_IDLE_CHECKIN_PAUSED_SUMMARY_SUFFIX,
  type GoalIdleCheckinContext,
} from '../goalIdleCheckin.js'

const BASE_MS = DEFAULT_GOAL_CHECKIN_MINUTES * 60_000

const runningAgent: GoalDeferringTask = {
  id: 'a',
  type: 'local_agent',
  status: 'running',
  startTime: 1,
  description: 'agent',
}

function goal(
  overrides: Partial<GoalCheckinActiveGoal> = {},
): GoalCheckinActiveGoal {
  return {
    condition: 'finish tests',
    setAt: 1,
    iterations: 0,
    tokensAtStart: 0,
    deferredSince: 0,
    checkinCount: 0,
    ...overrides,
  }
}

function makeCtx(
  active: GoalCheckinActiveGoal,
  extras: Partial<GoalIdleCheckinContext> = {},
): {
  ctx: GoalIdleCheckinContext
  delivered: Array<{ summary: string; body: string }>
  state: { activeGoal?: GoalCheckinActiveGoal }
} {
  const delivered: Array<{ summary: string; body: string }> = []
  const state: { activeGoal?: GoalCheckinActiveGoal } = { activeGoal: active }
  const ctx: GoalIdleCheckinContext = {
    goal: active,
    now: 0,
    getAppState: () => state as unknown as AppState,
    setAppState: f => {
      const next = f(state as unknown as AppState)
      state.activeGoal = next.activeGoal
    },
    getDeferringTasks: () => [runningAgent],
    deliver: formatted => {
      delivered.push(formatted)
    },
    hasQueued: () => false,
    getIntervalMs: () => BASE_MS,
    isMainLoopBusy: () => false,
    nowMs: () => BASE_MS,
    ...extras,
  }
  return { ctx, delivered, state }
}

afterEach(() => {
  cancelPendingGoalIdleCheckin()
})

describe('goalIdleCheckin densable 2.1.246 (#58)', () => {
  test('GWe is idleCheckinCount >= m9o=3', () => {
    expect(GOAL_IDLE_CHECKIN_CAP).toBe(3)
    expect(isGoalIdleCheckinCapped({})).toBe(false)
    expect(isGoalIdleCheckinCapped({ idleCheckinCount: 2 })).toBe(false)
    expect(isGoalIdleCheckinCapped({ idleCheckinCount: 3 })).toBe(true)
  })

  test('NQ uses elapsed=0 when capped so the tick re-arms at full backoff', () => {
    expect(
      getGoalIdleCheckinDelayMs({
        baseMs: BASE_MS,
        checkinCount: 0,
        idleCheckinCount: 3,
        deferredSince: 0,
        now: BASE_MS - 1_000,
      }),
    ).toBe(BASE_MS)
    expect(
      getGoalIdleCheckinDelayMs({
        baseMs: BASE_MS,
        checkinCount: 0,
        idleCheckinCount: 2,
        deferredSince: 0,
        now: BASE_MS - 1_000,
      }),
    ).toBe(GOAL_CHECKIN_TIMER_MIN_MS)
  })

  test('Wsv injects at most 3 idle check-ins then re-arms only', () => {
    let current = goal()
    const delivered: Array<{ summary: string; body: string }> = []
    for (let i = 0; i < 3; i++) {
      const { ctx, delivered: batch, state } = makeCtx(current)
      fireGoalIdleCheckin(ctx)
      delivered.push(...batch)
      current = state.activeGoal!
    }
    expect(delivered).toHaveLength(3)
    expect(current.idleCheckinCount).toBe(3)
    expect(delivered[2]!.summary).toContain(
      GOAL_IDLE_CHECKIN_PAUSED_SUMMARY_SUFFIX,
    )
    expect(delivered[2]!.body).toContain(GOAL_IDLE_CHECKIN_PAUSED_BODY_SUFFIX)
    expect(delivered[0]!.summary).not.toContain(
      GOAL_IDLE_CHECKIN_PAUSED_SUMMARY_SUFFIX,
    )

    const capped = makeCtx(current)
    fireGoalIdleCheckin(capped.ctx)
    expect(capped.delivered).toHaveLength(0)
    expect(capped.state.activeGoal?.idleCheckinCount).toBe(3)
    expect(getPendingGoalIdleCheckin()).toBeDefined()
  })

  test('d9n strips idleCheckinCount and leaves other goal fields', () => {
    const state: { activeGoal?: GoalCheckinActiveGoal } = {
      activeGoal: goal({ idleCheckinCount: 3, checkinCount: 4 }),
    }
    clearGoalIdleCheckinCount(f => {
      const next = f(state as unknown as AppState)
      state.activeGoal = next.activeGoal
    })
    expect(state.activeGoal?.idleCheckinCount).toBeUndefined()
    expect(state.activeGoal?.checkinCount).toBe(4)
    expect(state.activeGoal?.condition).toBe('finish tests')
  })

  test('b9o appends the official pause copy', () => {
    expect(appendGoalIdleCheckinCapCopy({ summary: 'S', body: 'B' })).toEqual({
      summary: `S${GOAL_IDLE_CHECKIN_PAUSED_SUMMARY_SUFFIX}`,
      body: `B${GOAL_IDLE_CHECKIN_PAUSED_BODY_SUFFIX}`,
    })
  })

  test('query mid-turn absorb calls d9n on main-thread human prompts', () => {
    const querySrc = readFileSync(
      join(import.meta.dir, '../../../query.ts'),
      'utf8',
    )
    expect(querySrc).toContain('clearGoalIdleCheckinCount')
    expect(querySrc).toContain('isHumanLikeOrigin')
  })
})
