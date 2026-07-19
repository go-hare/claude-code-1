import { beforeEach, describe, expect, mock, test } from 'bun:test'

const state = {
  goal: null as null | {
    objective: string
    status: string
    tokensUsed: number
    tokenBudget: number | null
    turnsExecuted: number
    setAt: number
  },
  cleared: false,
  setCalls: [] as string[],
}

mock.module('src/services/goal/goalState.js', () => ({
  getGoal: () => state.goal,
  setGoal: (objective: string) => {
    state.setCalls.push(objective)
    state.goal = {
      objective,
      status: 'active',
      tokensUsed: 0,
      tokenBudget: null,
      turnsExecuted: 0,
      setAt: Date.now(),
    }
  },
  clearGoal: () => {
    if (!state.goal) return null
    const g = state.goal
    state.goal = null
    state.cleared = true
    return g
  },
  completeGoal: () => {
    if (!state.goal) return null
    state.goal = { ...state.goal, status: 'complete' }
    return state.goal
  },
  pauseGoal: () => {
    if (!state.goal) return null
    state.goal = { ...state.goal, status: 'paused' }
    return state.goal
  },
  resumeGoal: () => {
    if (!state.goal || state.goal.status !== 'paused') return null
    state.goal = { ...state.goal, status: 'active' }
    return state.goal
  },
  continueGoalFromMaxTurns: () => {
    if (!state.goal || state.goal.status !== 'max_turns') return null
    state.goal = { ...state.goal, status: 'active', turnsExecuted: 0 }
    return state.goal
  },
  incrementGoalTurns: () => {},
  formatGoalElapsed: () => '0s',
  formatGoalStatusLabel: (s: string) => s,
  MAX_GOAL_TURNS: 20,
}))

mock.module('src/services/goal/goalStorage.js', () => ({
  persistCurrentGoal: () => {},
  persistGoalClear: () => {},
}))

mock.module('src/utils/messageQueueManager.js', () => ({
  removeByFilter: () => {},
}))

const { call } = await import('../goal-noninteractive.js')

beforeEach(() => {
  state.goal = null
  state.cleared = false
  state.setCalls = []
})

describe('goal noninteractive (densable m1y)', () => {
  test('status with no goal', async () => {
    const r = await call('', {} as never)
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain('No active goal')
    }
  })

  test('sets goal without dialog', async () => {
    const r = await call('ship the dual command work', {} as never)
    expect(r).toEqual({ type: 'text', value: 'Goal set.' })
    expect(state.setCalls).toEqual(['ship the dual command work'])
  })

  test('replaces existing goal without confirm', async () => {
    state.goal = {
      objective: 'old',
      status: 'active',
      tokensUsed: 1,
      tokenBudget: null,
      turnsExecuted: 2,
      setAt: 1,
    }
    const r = await call('new objective', {} as never)
    expect(r).toEqual({ type: 'text', value: 'Goal set.' })
    expect(state.goal?.objective).toBe('new objective')
  })

  test('clear', async () => {
    state.goal = {
      objective: 'x',
      status: 'active',
      tokensUsed: 0,
      tokenBudget: null,
      turnsExecuted: 0,
      setAt: 1,
    }
    const r = await call('clear', {} as never)
    expect(r).toEqual({ type: 'text', value: 'Goal cleared.' })
    expect(state.cleared).toBe(true)
  })

  test('pause / resume', async () => {
    state.goal = {
      objective: 'x',
      status: 'active',
      tokensUsed: 0,
      tokenBudget: null,
      turnsExecuted: 0,
      setAt: 1,
    }
    let r = await call('pause', {} as never)
    expect(r).toEqual({ type: 'text', value: 'Goal paused.' })
    r = await call('resume', {} as never)
    expect(r).toEqual({ type: 'text', value: 'Goal resumed.' })
  })
})
