import { afterEach, describe, expect, mock, test } from 'bun:test'

import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

import { getSessionId, setSessionTrustAccepted } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Message } from '../../types/message.js'
import { getSessionHooks } from '../../utils/hooks/sessionHooks.js'
import { call as jsxCall } from '../goal/goal.js'

describe('gold /goal jsx _t set/clear', () => {
  afterEach(() => {
    setSessionTrustAccepted(false)
  })

  function box() {
    const state: Pick<
      AppState,
      'activeGoal' | 'sessionHooks' | 'queuedGoalOrigin'
    > = {
      activeGoal: undefined,
      sessionHooks: new Map(),
      queuedGoalOrigin: undefined,
    }
    const messages: Message[] = []
    const context = {
      agentId: undefined,
      messages,
      getAppState: () => state as AppState,
      setAppState(f: (prev: AppState) => AppState) {
        const next = f(state as AppState)
        state.activeGoal = next.activeGoal
        state.sessionHooks = next.sessionHooks
        state.queuedGoalOrigin = next.queuedGoalOrigin
      },
      setMessages(f: (prev: Message[]) => Message[]) {
        const next = f(messages)
        messages.splice(0, messages.length, ...next)
      },
    }
    return { state, messages, context }
  }

  test('set returns null and onDone query + Xbn meta', async () => {
    setSessionTrustAccepted(true)
    const { state, context } = box()
    let done: {
      result?: string
      options?: { shouldQuery?: boolean; metaMessages?: string[] }
    } = {}
    const node = await jsxCall(
      (result, options) => {
        done = { result, options }
      },
      context as never,
      '全面对齐',
    )
    expect(node).toBeNull()
    expect(done.result).toBe('Goal set: 全面对齐')
    expect(done.options?.shouldQuery).toBe(true)
    expect(done.options?.metaMessages?.[0]).toContain('Stop hook is now active')
    expect(state.activeGoal?.condition).toBe('全面对齐')
    const stopHooks =
      getSessionHooks(state as AppState, getSessionId(), 'Stop').get('Stop') ??
      []
    expect(
      stopHooks.some(m =>
        m.hooks.some(h => h.type === 'prompt' && h.prompt === '全面对齐'),
      ),
    ).toBe(true)
  })

  test('clear returns null and onDone system Goal cleared', async () => {
    setSessionTrustAccepted(true)
    const { state, context } = box()
    await jsxCall(() => {}, context as never, '全面对齐')
    let done: { result?: string; options?: { display?: string } } = {}
    const node = await jsxCall(
      (result, options) => {
        done = { result, options }
      },
      context as never,
      'clear',
    )
    expect(node).toBeNull()
    expect(done).toEqual({
      result: 'Goal cleared: 全面对齐',
      options: { display: 'system' },
    })
    expect(state.activeGoal).toBeUndefined()
  })
})
