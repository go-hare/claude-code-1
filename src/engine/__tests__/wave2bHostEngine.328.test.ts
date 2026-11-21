/**
 * Wave 2B regression tests — official 2.1.328 HGt / BLt host engine lifecycle
 * and result envelope synthesis.
 */
import { describe, expect, test } from 'bun:test'
import { createHostEngine } from '../hostEngine.js'
import { createHostEngineFeed, runHostEngineTurn } from '../hostEngineTurn.js'

describe('Wave 2B hostEngine lifecycle & result synthesis (2.1.328 HGt)', () => {
  test('prepareTurn failure yields turn_setup_failed result and does not deadlock readLock', async () => {
    const feed = createHostEngineFeed<{ tag: string; fail?: boolean }>()
    const engine = createHostEngine<{ tag: string; fail?: boolean }>({
      prepareTurn: async () => {
        const next = feed.pendingQueryParams.shift()
        if (!next) throw new Error('missing pending params')
        if (next.fail) throw new Error('boom during prepareTurn')
        return next
      },
      runTurn: async function* (prepared) {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: prepared.tag }] },
        }
        return { reason: 'completed' }
      },
      log: () => {},
    })

    const firstEvents: unknown[] = []
    const secondEvents: unknown[] = []
    try {
      const firstResult = await runHostEngineTurn({
        engine,
        feed,
        turnInput: { tag: 'bad', fail: true },
        newMessages: [
          { type: 'user', message: { role: 'user', content: 'first' } },
        ],
        onQueryEvent: e => firstEvents.push(e),
      })

      expect(firstResult).toMatchObject({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        terminal_reason: 'turn_setup_failed',
      })
      // runHostEngineTurn renders the degraded-turn error assistant message
      expect(firstEvents).toHaveLength(1)
      expect(firstEvents[0]).toMatchObject({
        type: 'assistant',
        isApiErrorMessage: true,
      })

      // Subsequent turn acquires readLock cleanly and completes
      const secondResult = await runHostEngineTurn({
        engine,
        feed,
        turnInput: { tag: 'recovered' },
        newMessages: [
          { type: 'user', message: { role: 'user', content: 'second' } },
        ],
        onQueryEvent: e => secondEvents.push(e),
      })
      expect(secondResult).toMatchObject({
        type: 'result',
        subtype: 'success',
        is_error: false,
        terminal_reason: 'completed',
      })
      expect(secondEvents).toHaveLength(1)
    } finally {
      feed.input?.done()
      engine.close()
    }
  })

  test('runTurn completes finally cleanup BEFORE synthesized result is yielded (no mid-turn suspension while idle)', async () => {
    const feed = createHostEngineFeed<{ tag: string }>()
    const lifecycle: string[] = []
    let finallyRan = false
    const engine = createHostEngine<{ tag: string }>({
      onCommandLifecycle: (uuid, state) => lifecycle.push(`${uuid}:${state}`),
      prepareTurn: () => feed.pendingQueryParams.shift()!,
      runTurn: async function* (prepared) {
        try {
          yield {
            type: 'assistant',
            message: {
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: `hello ${prepared.tag}` }],
            },
          }
          return { reason: 'completed' }
        } finally {
          finallyRan = true
        }
      },
      log: () => {},
    })

    try {
      const result = await runHostEngineTurn({
        engine,
        feed,
        turnInput: { tag: 'idle-clean' },
        newMessages: [
          { type: 'user', message: { role: 'user', content: 'hi' } },
        ],
        onQueryEvent: () => {},
      })
      // At the exact moment runHostEngineTurn returns, runTurn's finally MUST
      // have already completed (not suspended waiting for the next turn).
      expect(finallyRan).toBe(true)
      expect(result).toMatchObject({
        type: 'result',
        subtype: 'success',
        is_error: false,
        terminal_reason: 'completed',
        stop_reason: 'end_turn',
        result: 'hello idle-clean',
      })
    } finally {
      feed.input?.done()
      engine.close()
    }
  })

  test('uncaught runTurn error runs finally, emits error_during_execution result, and renders degraded error', async () => {
    const feed = createHostEngineFeed()
    let finallyRan = false
    const engine = createHostEngine({
      prepareTurn: () => feed.pendingQueryParams.shift()!,
      runTurn: async function* () {
        try {
          yield { type: 'system', subtype: 'status', status: 'requesting' }
          throw new Error('uncaught boom in query')
        } finally {
          finallyRan = true
        }
      },
      log: () => {},
    })

    const events: unknown[] = []
    try {
      const result = await runHostEngineTurn({
        engine,
        feed,
        turnInput: {},
        newMessages: [
          { type: 'user', message: { role: 'user', content: 'go' } },
        ],
        onQueryEvent: e => events.push(e),
      })
      expect(finallyRan).toBe(true)
      expect(result).toMatchObject({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['uncaught boom in query'],
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'assistant',
        isApiErrorMessage: true,
        message: {
          content: [{ type: 'text', text: 'uncaught boom in query' }],
        },
      })
    } finally {
      feed.input?.done()
      engine.close()
    }
  })

  test.each([
    'completed',
    'stop_hook_prevented',
    'hook_stopped',
    'background_requested',
    'tool_deferred',
    'aborted_streaming',
    'aborted_tools',
    'max_turns',
  ])('non-error terminal reason %s synthesizes is_error: false', async reason => {
    const feed = createHostEngineFeed()
    const engine = createHostEngine({
      prepareTurn: () => feed.pendingQueryParams.shift()!,
      runTurn: async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'ok' }] },
        }
        return { reason }
      },
      log: () => {},
    })

    try {
      const result = await runHostEngineTurn({
        engine,
        feed,
        turnInput: {},
        newMessages: [],
        onQueryEvent: () => {},
      })
      expect(result).toMatchObject({
        type: 'result',
        subtype: 'success',
        is_error: false,
        terminal_reason: reason,
      })
    } finally {
      feed.input?.done()
      engine.close()
    }
  })

  test.each([
    'api_error',
    'model_error',
    'prompt_too_long',
    'blocking_limit',
  ])('real error-class terminal reason %s synthesizes is_error: true', async reason => {
    const feed = createHostEngineFeed()
    const engine = createHostEngine({
      prepareTurn: () => feed.pendingQueryParams.shift()!,
      runTurn: async function* () {
        yield { type: 'system', subtype: 'status', status: 'requesting' }
        return { reason }
      },
      log: () => {},
    })

    try {
      const result = await runHostEngineTurn({
        engine,
        feed,
        turnInput: {},
        newMessages: [],
        onQueryEvent: () => {},
      })
      expect(result).toMatchObject({
        type: 'result',
        subtype: 'success',
        is_error: true,
        terminal_reason: reason,
      })
    } finally {
      feed.input?.done()
      engine.close()
    }
  })

  test('budget_exhausted and max_turns_reached map to official SDK result subtypes', async () => {
    const feed = createHostEngineFeed<{
      mode: 'budget' | 'max_turns' | 'api_msg'
    }>()
    const engine = createHostEngine<{
      mode: 'budget' | 'max_turns' | 'api_msg'
    }>({
      prepareTurn: () => feed.pendingQueryParams.shift()!,
      runTurn: async function* (prepared) {
        if (prepared.mode === 'budget') {
          return { reason: 'budget_exhausted' }
        }
        if (prepared.mode === 'max_turns') {
          yield {
            type: 'attachment',
            attachment: {
              type: 'max_turns_reached',
              turnCount: 5,
              maxTurns: 5,
            },
          }
          return { reason: 'max_turns' }
        }
        yield {
          type: 'assistant',
          isApiErrorMessage: true,
          message: { content: [{ type: 'text', text: 'API overloaded' }] },
        }
        return { reason: 'completed' }
      },
      log: () => {},
    })

    try {
      const budgetRes = await runHostEngineTurn({
        engine,
        feed,
        turnInput: { mode: 'budget' },
        newMessages: [],
        onQueryEvent: () => {},
      })
      expect(budgetRes).toMatchObject({
        type: 'result',
        subtype: 'error_max_budget_usd',
        is_error: true,
        terminal_reason: 'budget_exhausted',
      })

      const maxTurnsRes = await runHostEngineTurn({
        engine,
        feed,
        turnInput: { mode: 'max_turns' },
        newMessages: [],
        onQueryEvent: () => {},
      })
      expect(maxTurnsRes).toMatchObject({
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        num_turns: 5,
      })

      const apiMsgRes = await runHostEngineTurn({
        engine,
        feed,
        turnInput: { mode: 'api_msg' },
        newMessages: [],
        onQueryEvent: () => {},
      })
      expect(apiMsgRes).toMatchObject({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'API overloaded',
      })
    } finally {
      feed.input?.done()
      engine.close()
    }
  })
})
