// densable 2.1.239 #49 — nuy / ueu goal restore on resume.
import { afterEach, describe, expect, mock, test } from 'bun:test'

import { logMock } from '../../../../tests/mocks/log.js'
mock.module('src/utils/log.ts', logMock)

import { debugMock } from '../../../../tests/mocks/debug.js'
mock.module('src/utils/debug.ts', debugMock)

import {
  getSessionId,
  setIsInteractive,
  setSessionTrustAccepted,
} from '../../../bootstrap/state.js'
import type { AppState } from '../../../state/AppStateStore.js'
import type { Message } from '../../../types/message.js'
import { getSessionHooks } from '../../../utils/hooks/sessionHooks.js'
import {
  findGoalToRestore,
  restoreGoalFromTranscript,
} from '../restoreGoalFromTranscript.js'

const FID = '00000000-0000-0000-0000-000000000001' as const

function goalStatus(
  overrides: { met?: boolean; failed?: boolean; condition?: string } = {},
): Message {
  return {
    type: 'attachment',
    uuid: FID,
    timestamp: '2026-01-01T00:00:00.000Z',
    attachment: {
      type: 'goal_status',
      met: overrides.met ?? false,
      failed: overrides.failed,
      condition: overrides.condition ?? 'ship it',
    },
  } as unknown as Message
}

function userMsg(): Message {
  return {
    type: 'user',
    uuid: FID,
    timestamp: '2026-01-01T00:00:00.000Z',
    message: { role: 'user', content: 'hi' },
  } as unknown as Message
}

function box(activeGoal?: AppState['activeGoal']): {
  state: Pick<AppState, 'activeGoal' | 'sessionHooks'>
  setAppState: (f: (prev: AppState) => AppState) => void
} {
  const state: Pick<AppState, 'activeGoal' | 'sessionHooks'> = {
    activeGoal,
    sessionHooks: new Map(),
  }
  return {
    state,
    setAppState(f) {
      const next = f(state as AppState)
      state.activeGoal = next.activeGoal
      state.sessionHooks = next.sessionHooks
    },
  }
}

function stopPrompts(
  state: Pick<AppState, 'sessionHooks'>,
): Array<{ type: string; prompt?: string }> {
  const matchers =
    getSessionHooks(state as AppState, getSessionId(), 'Stop').get('Stop') ?? []
  return matchers.flatMap(m => m.hooks)
}

afterEach(() => {
  setIsInteractive(false)
  setSessionTrustAccepted(false)
})

describe('densable 2.1.239 findGoalToRestore', () => {
  test('empty / missing messages is null', () => {
    expect(findGoalToRestore(undefined)).toBeNull()
    expect(findGoalToRestore(null)).toBeNull()
    expect(findGoalToRestore([])).toBeNull()
  })

  test('no goal_status is null', () => {
    expect(findGoalToRestore([userMsg()])).toBeNull()
  })

  test('last unmet goal_status returns the condition', () => {
    expect(
      findGoalToRestore([
        userMsg(),
        goalStatus({ condition: 'old' }),
        userMsg(),
        goalStatus({ condition: 'ship tests' }),
      ]),
    ).toBe('ship tests')
  })

  test('met on the last goal_status aborts restore', () => {
    expect(
      findGoalToRestore([
        goalStatus({ condition: 'ship tests' }),
        goalStatus({ met: true, condition: 'ship tests' }),
      ]),
    ).toBeNull()
  })

  test('failed on the last goal_status aborts restore', () => {
    expect(
      findGoalToRestore([
        goalStatus({ condition: 'ship tests', failed: true }),
      ]),
    ).toBeNull()
  })

  test('unmet after a prior met restores the new condition', () => {
    expect(
      findGoalToRestore([
        goalStatus({ met: true, condition: 'old' }),
        goalStatus({ condition: 'new goal' }),
      ]),
    ).toBe('new goal')
  })

  test('empty condition is null', () => {
    expect(findGoalToRestore([goalStatus({ condition: '' })])).toBeNull()
  })
})

describe('densable 2.1.239 restoreGoalFromTranscript', () => {
  test('sets activeGoal origin restored and a Stop prompt hook', () => {
    const { state, setAppState } = box()
    restoreGoalFromTranscript(
      [goalStatus({ condition: 'ship tests' })],
      setAppState,
    )
    expect(state.activeGoal?.condition).toBe('ship tests')
    expect(state.activeGoal?.origin).toBe('restored')
    expect(state.activeGoal?.iterations).toBe(0)
    const prompts = stopPrompts(state)
    expect(prompts).toEqual([{ type: 'prompt', prompt: 'ship tests' }])
  })

  test('met transcript clears a leftover activeGoal and does not add a hook', () => {
    const { state, setAppState } = box({
      condition: 'old',
      setAt: 1,
      iterations: 3,
      tokensAtStart: 0,
    })
    restoreGoalFromTranscript(
      [goalStatus({ met: true, condition: 'old' })],
      setAppState,
    )
    expect(state.activeGoal).toBeUndefined()
    expect(stopPrompts(state)).toEqual([])
  })

  test('interactive untrusted workspace does not restore', () => {
    setIsInteractive(true)
    setSessionTrustAccepted(false)
    const { state, setAppState } = box()
    restoreGoalFromTranscript(
      [goalStatus({ condition: 'ship tests' })],
      setAppState,
    )
    expect(state.activeGoal).toBeUndefined()
    expect(stopPrompts(state)).toEqual([])
  })
})
