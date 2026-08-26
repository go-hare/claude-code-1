/**
 * densable 2.1.236 #25 — SEA Bqn / Wsv idle+parked goal check-in backoff.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppState } from '../../../state/AppStateStore.js'
import {
  DEFAULT_GOAL_CHECKIN_MINUTES,
  getGoalCheckinBackoffIntervalMs,
  getGoalIdleCheckinDelayMs,
  GOAL_CHECKIN_BACKOFF_CAP,
  GOAL_CHECKIN_TIMER_MAX_MS,
  GOAL_CHECKIN_TIMER_MIN_MS,
  planGoalCheckin,
  type GoalCheckinActiveGoal,
  type GoalDeferringTask,
} from '../goalCheckin.js'
import {
  armGoalIdleCheckin,
  cancelPendingGoalIdleCheckin,
  fireGoalIdleCheckin,
  formatGoalIdleCheckinNotification,
  getGoalIdleArmGeneration,
  getPendingGoalIdleCheckin,
  isGoalCheckinQueuedCommand,
  replacePendingGoalIdleCheckin,
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

describe('goalIdleCheckin densable 2.1.236 (#25)', () => {
  test('Bqn backoff interval is 30 → 60 → 120 and caps at jsv=2', () => {
    expect(GOAL_CHECKIN_BACKOFF_CAP).toBe(2)
    expect(getGoalCheckinBackoffIntervalMs(BASE_MS, 0)).toBe(30 * 60_000)
    expect(getGoalCheckinBackoffIntervalMs(BASE_MS, 1)).toBe(60 * 60_000)
    expect(getGoalCheckinBackoffIntervalMs(BASE_MS, 2)).toBe(120 * 60_000)
    expect(getGoalCheckinBackoffIntervalMs(BASE_MS, 3)).toBe(120 * 60_000)
    expect(getGoalCheckinBackoffIntervalMs(BASE_MS, undefined)).toBe(
      30 * 60_000,
    )
  })

  test('Bqn delay clamps to G9a min and rLe max', () => {
    expect(
      getGoalIdleCheckinDelayMs({
        baseMs: BASE_MS,
        checkinCount: 0,
        deferredSince: 0,
        now: BASE_MS - 1_000,
      }),
    ).toBe(GOAL_CHECKIN_TIMER_MIN_MS)
    expect(
      getGoalIdleCheckinDelayMs({
        baseMs: BASE_MS,
        checkinCount: 0,
        deferredSince: 0,
        now: 0,
      }),
    ).toBe(BASE_MS)
    expect(
      getGoalIdleCheckinDelayMs({
        baseMs: Number.MAX_SAFE_INTEGER,
        checkinCount: 2,
        deferredSince: 0,
        now: 0,
      }),
    ).toBe(GOAL_CHECKIN_TIMER_MAX_MS)
  })

  test('rbf / planGoalCheckin still uses base interval after count=2', () => {
    const seeded = goal({
      deferredSince: 0,
      checkinCount: 2,
      lastDeferralPassAt: 0,
    })
    const early = planGoalCheckin(seeded, [runningAgent], BASE_MS - 1, {
      getIntervalMs: () => BASE_MS,
    })
    expect(early.injected).toBe(false)
    const late = planGoalCheckin(seeded, [runningAgent], BASE_MS, {
      getIntervalMs: () => BASE_MS,
    })
    expect(late.injected).toBe(true)
    expect(late.nextGoal.checkinCount).toBe(3)
  })

  test('Wsv injects, bumps checkinCount, and re-arms 60min after first fire', () => {
    const { ctx, delivered, state } = makeCtx(goal())
    fireGoalIdleCheckin(ctx)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.body).toContain('Goal check-in:')
    expect(state.activeGoal?.checkinCount).toBe(1)
    expect(getPendingGoalIdleCheckin()).toBeDefined()
    cancelPendingGoalIdleCheckin()

    const second = makeCtx(state.activeGoal!, {
      now: BASE_MS,
      nowMs: () => BASE_MS + 60 * 60_000,
    })
    fireGoalIdleCheckin(second.ctx)
    expect(second.delivered).toHaveLength(1)
    expect(second.state.activeGoal?.checkinCount).toBe(2)
  })

  test('Wsv retries G9a when main loop is busy or a goal-checkin is queued', () => {
    const busy = makeCtx(goal(), { isMainLoopBusy: () => true })
    fireGoalIdleCheckin(busy.ctx)
    expect(busy.delivered).toHaveLength(0)
    expect(getPendingGoalIdleCheckin()).toBeDefined()
    cancelPendingGoalIdleCheckin()

    const queued = makeCtx(goal(), {
      hasQueued: pred =>
        pred({
          value: 'x',
          mode: 'task-notification',
          origin: { kind: 'task-notification', source: 'goal-checkin' },
        } as never),
    })
    fireGoalIdleCheckin(queued.ctx)
    expect(queued.delivered).toHaveLength(0)
    expect(getPendingGoalIdleCheckin()).toBeDefined()
  })

  test('Bqn no-ops when interval is 0 or deferredSince is unset', () => {
    armGoalIdleCheckin(makeCtx(goal(), { getIntervalMs: () => 0 }).ctx)
    expect(getPendingGoalIdleCheckin()).toBeUndefined()
    armGoalIdleCheckin(makeCtx(goal({ deferredSince: undefined })).ctx)
    expect(getPendingGoalIdleCheckin()).toBeUndefined()
  })

  test('mTi XML wraps escaped summary + system-reminder body', () => {
    const xml = formatGoalIdleCheckinNotification(
      'Goal check-in: still running',
      'Goal check-in: «ship <fix>»',
    )
    expect(xml).toContain('<task-notification>')
    expect(xml).toContain('<summary>Goal check-in: still running</summary>')
    expect(xml).toContain('<system-reminder>')
    expect(xml).toContain('«ship <fix>»')
  })

  test('Yht recognizes goal-checkin origin', () => {
    expect(
      isGoalCheckinQueuedCommand({
        value: 'x',
        mode: 'task-notification',
        origin: { kind: 'task-notification', source: 'goal-checkin' },
      } as never),
    ).toBe(true)
    expect(
      isGoalCheckinQueuedCommand({
        value: 'x',
        mode: 'task-notification',
        origin: { kind: 'task-notification' },
      } as never),
    ).toBe(false)
  })

  test('tip invent: empty deferring injects once then clears — no re-arm', () => {
    const { ctx, delivered, state } = makeCtx(goal(), {
      getDeferringTasks: () => [],
      nowMs: () => BASE_MS,
    })
    fireGoalIdleCheckin(ctx)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.summary).toContain('no longer running')
    expect(state.activeGoal?.deferredSince).toBeUndefined()
    expect(state.activeGoal?.checkinCount).toBe(0)
    expect(getPendingGoalIdleCheckin()).toBeUndefined()
  })

  test('tip invent: cancel bumps generation so stale fire does not inject', () => {
    const { ctx, delivered } = makeCtx(goal())
    const genBefore = getGoalIdleArmGeneration()
    cancelPendingGoalIdleCheckin()
    expect(getGoalIdleArmGeneration()).toBe(genBefore + 1)
    // Simulate in-flight timer that captured the pre-cancel generation.
    fireGoalIdleCheckin(ctx, genBefore)
    expect(delivered).toHaveLength(0)
    expect(getPendingGoalIdleCheckin()).toBeUndefined()
  })

  test('L15: replacePendingGoalIdleCheckin clears prior timer before assign', async () => {
    let firstFired = false
    const first = setTimeout(() => {
      firstFired = true
    }, 40)
    replacePendingGoalIdleCheckin(first)
    const second = setTimeout(() => {}, 60_000)
    replacePendingGoalIdleCheckin(second)
    expect(getPendingGoalIdleCheckin()).toBe(second)
    await Bun.sleep(80)
    expect(firstFired).toBe(false)
    cancelPendingGoalIdleCheckin()
    expect(getPendingGoalIdleCheckin()).toBeUndefined()
  })

  test('/goal clear cancels pending idle check-in before clearing activeGoal', async () => {
    replacePendingGoalIdleCheckin(setTimeout(() => {}, 60_000))
    expect(getPendingGoalIdleCheckin()).toBeDefined()

    const goalCommand = (await import('../../../commands/goal.js')).default
    const loaded = await goalCommand.load!()
    let state: {
      activeGoal?: GoalCheckinActiveGoal
      sessionHooks?: Map<string, unknown>
    } = {
      activeGoal: goal({ condition: 'ship tests' }),
      sessionHooks: new Map(),
    }
    const result = await loaded.call('clear', {
      getAppState: () => state as unknown as AppState,
      setAppState: (updater: (prev: AppState) => AppState): void => {
        state = updater(state as unknown as AppState) as typeof state
      },
      setMessages: () => {},
      agentId: 'goal-clear-test-session',
    } as never)

    expect(getPendingGoalIdleCheckin()).toBeUndefined()
    expect(state.activeGoal).toBeUndefined()
    expect(result).toEqual({
      type: 'text',
      value: 'Goal cleared: ship tests',
    })
  })

  test('M4 wiring: goal.ts and REPL onActiveGoal teardown cancel pending check-in', () => {
    const goalSrc = readFileSync(
      join(import.meta.dir, '../../../commands/goal.ts'),
      'utf8',
    )
    const clearIdx = goalSrc.indexOf('CLEAR_KEYWORDS.has(input.toLowerCase())')
    expect(clearIdx).toBeGreaterThanOrEqual(0)
    const clearBlock = goalSrc.slice(clearIdx, clearIdx + 900)
    expect(clearBlock).toContain('cancelPendingGoalIdleCheckin')
    expect(clearBlock.indexOf('cancelPendingGoalIdleCheckin')).toBeLessThan(
      clearBlock.indexOf('activeGoal: undefined'),
    )

    const replSrc = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf8',
    )
    const onActiveIdx = replSrc.indexOf('onActiveGoal:')
    expect(onActiveIdx).toBeGreaterThanOrEqual(0)
    const onActiveBlock = replSrc.slice(onActiveIdx, onActiveIdx + 900)
    expect(onActiveBlock).toMatch(
      /value === undefined \|\| value === null[\s\S]*cancelPendingGoalIdleCheckin/,
    )
  })
})
