import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, test } from 'bun:test'
import {
  consumeQueuedGoalOrigin,
  setQueuedGoalOrigin,
} from '../queuedGoalOrigin.js'

type State = {
  queuedGoalOrigin?: { condition: string; origin: string }
}

function makeBox(initial?: State['queuedGoalOrigin']) {
  let state: State = { queuedGoalOrigin: initial }
  return {
    getAppState: () => state,
    setAppState: (f: (prev: State) => State) => {
      state = f(state)
    },
    get queued() {
      return state.queuedGoalOrigin
    },
  }
}

describe('queuedGoalOrigin ebl/smw', () => {
  test('setQueuedGoalOrigin stamps condition + origin', () => {
    const box = makeBox()
    setQueuedGoalOrigin(
      box.setAppState as never,
      'bun test exits 0',
      'proposal_direct',
    )
    expect(box.queued).toEqual({
      condition: 'bun test exits 0',
      origin: 'proposal_direct',
    })
  })

  test('consume matching condition returns origin and clears latch', () => {
    const box = makeBox({
      condition: 'bun test exits 0',
      origin: 'proposal_approved',
    })
    expect(consumeQueuedGoalOrigin('bun test exits 0', box as never)).toBe(
      'proposal_approved',
    )
    expect(box.queued).toBeUndefined()
  })

  test('/goal SZr consumes queuedGoalOrigin into activeGoal.origin', () => {
    const goalSrc = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../commands/goal.ts',
      ),
      'utf8',
    )
    expect(goalSrc).toContain('consumeQueuedGoalOrigin')
    expect(goalSrc).toContain('origin,')
  })

  test('consume mismatch / absent returns user and leaves latch', () => {
    const empty = makeBox()
    expect(consumeQueuedGoalOrigin('x', empty as never)).toBe('user')

    const box = makeBox({
      condition: 'bun test exits 0',
      origin: 'proposal_direct',
    })
    expect(consumeQueuedGoalOrigin('other', box as never)).toBe('user')
    expect(box.queued).toEqual({
      condition: 'bun test exits 0',
      origin: 'proposal_direct',
    })
  })
})
