import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import {
  analyticsMock,
  pushAnalyticsLogEvent,
} from '../../../tests/mocks/analytics.js'
import type { Message } from '../../types/message.js'
import type { Notification } from '../../context/notifications.js'

const logEventMock = mock((_name: string, _props?: unknown) => {})
let popAnalyticsLogEvent: (() => void) | undefined
mock.module('../../services/analytics/index.js', analyticsMock)

import {
  createIdleReturnTurnSource,
  IdleReturnController,
  IDLE_RETURN_HINT_KEY,
} from '../idleReturnController.js'

function assistantWithTokens(tokens: number): Message {
  return {
    type: 'assistant',
    uuid: 'a',
    timestamp: new Date().toISOString(),
    message: {
      model: 'claude-opus-4-6',
      content: [{ type: 'text', text: 'hi' }],
      usage: {
        input_tokens: tokens,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  } as unknown as Message
}

function fakeClock() {
  const timers = new Map<number, { fn: () => void; at: number }>()
  let now = 0
  let seq = 0
  return {
    now: () => now,
    advance(ms: number) {
      now += ms
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= now)
        .sort((a, b) => a[1].at - b[1].at)
      for (const [id, t] of due) {
        timers.delete(id)
        t.fn()
      }
    },
    clock: {
      setTimeout(fn: () => void, ms: number) {
        const id = ++seq
        timers.set(id, { fn, at: now + ms })
        return () => {
          timers.delete(id)
        }
      },
    },
  }
}

function harness(opts?: {
  tokens?: number
  lastQueryCompletionTime?: number
  isLoading?: boolean
  submitCount?: number
}) {
  const time = fakeClock()
  const messages = [assistantWithTokens(opts?.tokens ?? 150_000)]
  const notifications: Notification[] = []
  const idleNotifs: number[] = []
  const source = createIdleReturnTurnSource({
    isLoading: opts?.isLoading ?? false,
    lastQueryCompletionTime: opts?.lastQueryCompletionTime ?? 0,
    submitCount: opts?.submitCount ?? 1,
  })
  const controller = new IdleReturnController({
    turn: source.turn,
    getMessages: () => messages,
    clock: time.clock,
    now: time.now,
    getLastInteractionTime: () => 0,
    isDialogOnScreen: () => false,
    hasPendingLoopWakeup: () => false,
    hasArmedQuotaAutoResume: () => false,
    getIdleNotifThresholdMs: () => 60_000,
    sendIdleNotification: () => {
      idleNotifs.push(time.now())
    },
    addNotification: n => {
      notifications.push(n)
    },
    removeNotification: key => {
      const i = notifications.findIndex(n => n.key === key)
      if (i >= 0) notifications.splice(i, 1)
    },
    hasSeededRemotePrompt: false,
  })
  return { time, source, controller, notifications, idleNotifs }
}

beforeAll(() => {
  popAnalyticsLogEvent = pushAnalyticsLogEvent((name, metadata) => {
    logEventMock(name, metadata)
  })
})

afterAll(() => {
  popAnalyticsLogEvent?.()
})

afterEach(() => {
  logEventMock.mockClear()
  delete process.env.CLAUDE_CODE_IDLE_THRESHOLD_MINUTES
  delete process.env.CLAUDE_CODE_IDLE_TOKEN_THRESHOLD
})

describe('IdleReturnController densable 2.1.246 F$', () => {
  test('does not schedule the hint until a query has completed', () => {
    const h = harness({ lastQueryCompletionTime: 0, tokens: 150_000 })
    h.time.advance(75 * 60_000)
    expect(h.notifications).toEqual([])
    h.controller.dispose()
  })

  test('does not schedule the hint below the 100k token gate', () => {
    const h = harness({ lastQueryCompletionTime: 1, tokens: 99_000 })
    h.time.advance(75 * 60_000)
    expect(h.notifications).toEqual([])
    h.controller.dispose()
  })

  test('shows new task? /clear after 75 minutes when tokens clear 100k', () => {
    const h = harness({ lastQueryCompletionTime: 1, tokens: 150_000 })
    h.time.advance(75 * 60_000 - 1)
    expect(h.notifications).toEqual([])
    h.time.advance(2)
    expect(h.notifications).toHaveLength(1)
    expect(h.notifications[0]!.key).toBe(IDLE_RETURN_HINT_KEY)
    expect(h.notifications[0]!.kind).toBe('contextual')
    expect(
      'segments' in h.notifications[0]! &&
        h.notifications[0].segments.map(s => s.text).join(''),
    ).toContain('new task? ')
    expect(
      logEventMock.mock.calls.some(
        c =>
          c[0] === 'tengu_idle_return_action' &&
          (c[1] as { action: string }).action === 'hint_shown',
      ),
    ).toBe(true)
    h.controller.dispose()
  })

  test('isLoading true cancels a scheduled hint and does not leave it queued', () => {
    const h = harness({ lastQueryCompletionTime: 1, tokens: 150_000 })
    h.source.publish({
      isLoading: true,
      lastQueryCompletionTime: 1,
      submitCount: 1,
    })
    h.time.advance(75 * 60_000)
    expect(h.notifications).toEqual([])
    h.controller.dispose()
  })

  test('submitCount change does not tear down a shown hint', () => {
    const h = harness({ lastQueryCompletionTime: 1, tokens: 150_000 })
    h.time.advance(75 * 60_000 + 1)
    expect(h.notifications).toHaveLength(1)
    h.source.publish({
      isLoading: false,
      lastQueryCompletionTime: 1,
      submitCount: 2,
    })
    expect(h.notifications).toHaveLength(1)
    h.controller.dispose()
  })

  test('dirty idle env falls back to 75m / 100k instead of NaN timers', () => {
    process.env.CLAUDE_CODE_IDLE_THRESHOLD_MINUTES = 'abc'
    process.env.CLAUDE_CODE_IDLE_TOKEN_THRESHOLD = 'abc'
    const below = harness({ lastQueryCompletionTime: 1, tokens: 50_000 })
    below.time.advance(75 * 60_000 + 1)
    expect(below.notifications).toEqual([])
    below.controller.dispose()

    const above = harness({ lastQueryCompletionTime: 1, tokens: 150_000 })
    above.time.advance(0)
    expect(above.notifications).toEqual([])
    above.time.advance(75 * 60_000 + 1)
    expect(above.notifications).toHaveLength(1)
    above.controller.dispose()
  })

  test('onClearSubmitted is a no-op until the hint has been shown', () => {
    const h = harness({ lastQueryCompletionTime: 1, tokens: 150_000 })
    h.controller.onClearSubmitted()
    expect(
      logEventMock.mock.calls.some(
        c =>
          c[0] === 'tengu_idle_return_action' &&
          (c[1] as { action: string }).action === 'hint_converted',
      ),
    ).toBe(false)
    h.time.advance(75 * 60_000 + 1)
    h.controller.onClearSubmitted()
    expect(
      logEventMock.mock.calls.some(
        c =>
          c[0] === 'tengu_idle_return_action' &&
          (c[1] as { action: string }).action === 'hint_converted',
      ),
    ).toBe(true)
    h.controller.dispose()
  })
})
