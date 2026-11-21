/**
 * densable 2.1.218 HWf — Host REPL turn pump (runHostEngineTurn).
 */
import { describe, expect, test } from 'bun:test'
import {
  createHostEngine,
  type HostEngine,
  type HostTurnIntent,
} from '../hostEngine.js'
import { createHostEngineFeed, runHostEngineTurn } from '../hostEngineTurn.js'
import {
  SdkEventQueueBag,
  runWithSdkEventQueue,
} from '../../utils/sdkEventQueue.js'
import {
  getIsNonInteractiveSession,
  setIsInteractive,
} from '../../bootstrap/state.js'

async function* runWithResult(
  prepared: { tag: string },
  _ac: AbortController,
  intent: HostTurnIntent,
): AsyncGenerator<unknown> {
  yield { type: 'assistant', uuid: intent.uuid, text: prepared.tag }
  yield {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'ok',
  }
  return { reason: 'completed' }
}

describe('densable 2.1.218 HWf runHostEngineTurn', () => {
  test('pushes turn params, drains assistant, stops at result', async () => {
    const feed = createHostEngineFeed<{ tag: string }>()
    const pending = feed.pendingQueryParams
    const engine = createHostEngine<{ tag: string }>({
      prepareTurn: async () => {
        const next = pending.shift()
        if (!next) throw new Error('no pending')
        return next
      },
      runTurn: runWithResult,
    })

    const events: unknown[] = []

    await runHostEngineTurn({
      engine,
      feed,
      turnInput: { tag: 'turn-a' },
      newMessages: [
        {
          type: 'user',
          message: { role: 'user', content: 'hi' },
        },
      ],
      onQueryEvent: e => events.push(e),
    })

    expect(
      events.some(e => (e as { type?: string }).type === 'assistant'),
    ).toBe(true)
    expect(events.some(e => (e as { type?: string }).type === 'result')).toBe(
      false,
    )
    expect(pending).toHaveLength(0)
    expect(feed.input).not.toBeNull()

    // second turn reuses the same streamInput
    await runHostEngineTurn({
      engine,
      feed,
      turnInput: { tag: 'turn-b' },
      newMessages: [
        {
          type: 'user',
          message: { role: 'user', content: 'again' },
        },
      ],
      onQueryEvent: e => events.push(e),
    })
    const assistants = events.filter(
      e => (e as { type?: string }).type === 'assistant',
    )
    expect(assistants.length).toBe(2)

    engine.close()
    feed.input?.done()
  })

  test('returns the exact terminal and routes requesting/status before assistant output', async () => {
    const feed = createHostEngineFeed()
    const order: string[] = []
    const statuses: unknown[] = []
    const terminal = {
      type: 'result' as const,
      subtype: 'success',
      terminal_reason: 'completed',
      is_error: false,
      result: 'done',
    }
    const engine = createHostEngine({
      prepareTurn: () => feed.pendingQueryParams.shift()!,
      runTurn: async function* () {
        yield { type: 'system', subtype: 'status', status: 'requesting' }
        yield {
          type: 'system',
          subtype: 'status',
          status: null,
          compact_result: 'success',
        }
        yield { type: 'assistant', text: 'response' }
        yield terminal
      },
    })
    try {
      const result = await runHostEngineTurn({
        engine,
        feed,
        turnInput: {},
        newMessages: [],
        onRead: () => order.push('read'),
        onMainRequestStart: () => order.push('requesting'),
        onStatus: value => statuses.push(value),
        onQueryEvent: () => order.push('assistant'),
      })
      expect(result).toBe(terminal)
      expect(order).toEqual(['read', 'requesting', 'assistant'])
      expect(statuses).toEqual([undefined, 'success'])
    } finally {
      feed.input?.done()
      engine.close()
    }
  })

  test.each([
    'api_error',
    'aborted_streaming',
  ])('degraded engine errors surface while cancelled results stay silent: %s', async reason => {
    const feed = createHostEngineFeed()
    const terminal = {
      type: 'result' as const,
      subtype: 'error_during_execution',
      terminal_reason: reason,
      is_error: true,
      errors: ['engine fixture failure'],
    }
    const engine = createHostEngine({
      prepareTurn: () => feed.pendingQueryParams.shift()!,
      runTurn: async function* () {
        yield terminal
      },
    })
    const events: unknown[] = []
    try {
      const result = await runHostEngineTurn({
        engine,
        feed,
        turnInput: {},
        newMessages: [],
        onQueryEvent: event => events.push(event),
      })
      expect(result).toBe(terminal)
      expect(events).toHaveLength(reason === 'api_error' ? 1 : 0)
      if (reason === 'api_error')
        expect(events[0]).toMatchObject({
          type: 'assistant',
          isApiErrorMessage: true,
          message: {
            content: [{ type: 'text', text: 'engine fixture failure' }],
          },
        })
    } finally {
      feed.input?.done()
      engine.close()
    }
  })

  test('status forwarding keeps non-requesting lifecycle values in the SDK lane', async () => {
    const wasNonInteractive = getIsNonInteractiveSession()
    const bag = new SdkEventQueueBag()
    const feed = createHostEngineFeed()
    const engine = createHostEngine({
      prepareTurn: () => feed.pendingQueryParams.shift()!,
      runTurn: async function* () {
        for (const status of ['requesting', 'compacting', 'idle', null])
          yield { type: 'system', subtype: 'status', status }
        yield { type: 'result', subtype: 'success' }
      },
    })
    setIsInteractive(false)
    try {
      await runWithSdkEventQueue(bag, () =>
        runHostEngineTurn({
          engine,
          feed,
          turnInput: {},
          newMessages: [],
          onQueryEvent: () => {},
        }),
      )
      const statuses = [...bag.queuesByKey.values()]
        .flat()
        .filter(e => e.type === 'system' && e.subtype === 'status')
        .map(e => (e as { status: string | null }).status)
      expect(statuses).toEqual(['compacting', 'idle', null])
    } finally {
      feed.input?.done()
      engine.close()
      setIsInteractive(!wasNonInteractive)
    }
  })

  test('a failing SDK status sink does not interrupt the model turn or lose its terminal', async () => {
    const wasNonInteractive = getIsNonInteractiveSession()
    const bag = new SdkEventQueueBag()
    bag.setEnqueueListener(() => {
      throw new Error('status sink fixture')
    })
    const feed = createHostEngineFeed()
    const terminal = { type: 'result' as const, subtype: 'success' }
    const engine = createHostEngine({
      prepareTurn: () => feed.pendingQueryParams.shift()!,
      runTurn: async function* () {
        yield {
          type: 'system',
          subtype: 'status',
          status: 'compacting',
          compact_result: 'success',
        }
        yield terminal
      },
    })
    const statuses: unknown[] = []
    setIsInteractive(false)
    try {
      const result = await runWithSdkEventQueue(bag, () =>
        runHostEngineTurn({
          engine,
          feed,
          turnInput: {},
          newMessages: [],
          onQueryEvent: () => {},
          onStatus: value => statuses.push(value),
        }),
      )
      expect(result).toBe(terminal)
      expect(statuses).toEqual(['success'])
    } finally {
      feed.input?.done()
      engine.close()
      setIsInteractive(!wasNonInteractive)
    }
  })

  test('filters system/init and command_lifecycle envelopes', async () => {
    async function* noisyTurn(
      _p: HostTurnIntent,
      _ac: AbortController,
      intent: HostTurnIntent,
    ): AsyncGenerator<unknown> {
      yield { type: 'system', subtype: 'init' }
      yield {
        type: 'command_lifecycle',
        command_uuid: intent.uuid,
        state: 'started',
      }
      yield { type: 'assistant', text: 'visible' }
      yield { type: 'result', subtype: 'success', is_error: false }
      return { reason: 'completed' }
    }

    const engine: HostEngine = createHostEngine({
      prepareTurn: async intent => intent,
      runTurn: noisyTurn,
    })
    const events: unknown[] = []
    const feed = createHostEngineFeed()

    await runHostEngineTurn({
      engine,
      feed,
      turnInput: { uuid: 'u1' },
      newMessages: [{ type: 'user', message: { role: 'user', content: 'x' } }],
      onQueryEvent: e => events.push(e),
    })

    expect(events).toEqual([{ type: 'assistant', text: 'visible' }])
    engine.close()
    feed.input?.done()
  })

  test('HWf drops set_expanded_view (gold CLI host onQueryEvent has no arm)', async () => {
    async function* expandTurn(
      _p: HostTurnIntent,
      _ac: AbortController,
    ): AsyncGenerator<unknown> {
      yield { type: 'set_expanded_view', expandedView: 'tasks' }
      yield { type: 'assistant', text: 'visible' }
      yield { type: 'result', subtype: 'success', is_error: false }
      return { reason: 'completed' }
    }

    const engine: HostEngine = createHostEngine({
      prepareTurn: async intent => intent,
      runTurn: expandTurn,
    })
    const events: unknown[] = []
    const feed = createHostEngineFeed()

    await runHostEngineTurn({
      engine,
      feed,
      turnInput: { uuid: 'u1' },
      newMessages: [{ type: 'user', message: { role: 'user', content: 'x' } }],
      onQueryEvent: e => events.push(e),
    })

    expect(events).toEqual([{ type: 'assistant', text: 'visible' }])
    engine.close()
    feed.input?.done()
  })

  test('queued turns do not consume the interrupted turn events or result', async () => {
    const feed = createHostEngineFeed()
    const pending = feed.pendingQueryParams
    const firstShown = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    const engine = createHostEngine<Record<string, unknown>>({
      prepareTurn: async () => pending.shift()!,
      runTurn: async function* (prepared) {
        yield { type: 'assistant', text: `${prepared.tag}:first` }
        if (prepared.tag === 'a') await releaseFirst.promise
        yield { type: 'assistant', text: `${prepared.tag}:last` }
        yield { type: 'result', subtype: 'success', result: prepared.tag }
        return { reason: 'completed' }
      },
    })
    const firstEvents: unknown[] = []
    const secondEvents: unknown[] = []
    try {
      const first = runHostEngineTurn({
        engine,
        feed,
        turnInput: { tag: 'a' },
        newMessages: [
          { type: 'user', message: { role: 'user', content: 'a' } },
        ],
        onQueryEvent: event => {
          firstEvents.push(event)
          firstShown.resolve()
        },
      })
      await firstShown.promise
      const second = runHostEngineTurn({
        engine,
        feed,
        turnInput: { tag: 'b' },
        newMessages: [
          { type: 'user', message: { role: 'user', content: 'b' } },
        ],
        onQueryEvent: event => secondEvents.push(event),
      })
      releaseFirst.resolve()
      await Promise.all([first, second])
      expect(firstEvents).toEqual([
        { type: 'assistant', text: 'a:first' },
        { type: 'assistant', text: 'a:last' },
      ])
      expect(secondEvents).toEqual([
        { type: 'assistant', text: 'b:first' },
        { type: 'assistant', text: 'b:last' },
      ])
    } finally {
      releaseFirst.resolve()
      engine.close()
      feed.input?.done()
    }
  })

  test('consumer-error draining holds the lock until the failed turn result', async () => {
    const feed = createHostEngineFeed()
    const failed = Promise.withResolvers<void>()
    const releaseDrain = Promise.withResolvers<void>()
    const engine = createHostEngine<Record<string, unknown>>({
      prepareTurn: async () => feed.pendingQueryParams.shift()!,
      runTurn: async function* (prepared) {
        yield { type: 'assistant', text: `${prepared.tag}:first` }
        if (prepared.tag === 'a') await releaseDrain.promise
        yield { type: 'assistant', text: `${prepared.tag}:last` }
        yield { type: 'result', subtype: 'success' }
        return { reason: 'completed' }
      },
    })
    const consumerError = new Error('rendering failed')
    const secondEvents: unknown[] = []
    try {
      const first = runHostEngineTurn({
        engine,
        feed,
        turnInput: { tag: 'a' },
        newMessages: [
          { type: 'user', message: { role: 'user', content: 'a' } },
        ],
        onQueryEvent: () => {
          failed.resolve()
          throw consumerError
        },
      }).catch(error => error)
      await failed.promise
      const second = runHostEngineTurn({
        engine,
        feed,
        turnInput: { tag: 'b' },
        newMessages: [
          { type: 'user', message: { role: 'user', content: 'b' } },
        ],
        onQueryEvent: event => secondEvents.push(event),
      })
      releaseDrain.resolve()
      expect(await first).toBe(consumerError)
      await second
      expect(secondEvents).toEqual([
        { type: 'assistant', text: 'b:first' },
        { type: 'assistant', text: 'b:last' },
      ])
    } finally {
      releaseDrain.resolve()
      engine.close()
      feed.input?.done()
    }
  })

  test('a failed engine read still releases the feed for the next reader', async () => {
    const feed = createHostEngineFeed()
    const readError = new Error('engine read failed')
    let reads = 0
    const engine = {
      streamInput: async () => {},
      interrupt: async () => ({ still_queued: [] }),
      next: async () => {
        reads++
        if (reads === 1) throw readError
        return {
          done: false,
          value:
            reads === 3
              ? { type: 'assistant', text: 'next turn' }
              : { type: 'result', subtype: 'success' },
        }
      },
    } as unknown as HostEngine
    const events: unknown[] = []
    try {
      await expect(
        runHostEngineTurn({
          engine,
          feed,
          turnInput: {},
          newMessages: [],
          onQueryEvent: () => {},
        }),
      ).rejects.toBe(readError)
      await runHostEngineTurn({
        engine,
        feed,
        turnInput: {},
        newMessages: [],
        onQueryEvent: event => events.push(event),
      })
      expect(events).toEqual([{ type: 'assistant', text: 'next turn' }])
      expect(reads).toBe(4)
    } finally {
      feed.input?.done()
    }
  })

  test('system/notification routes to addNotification', async () => {
    async function* notifTurn(
      _p: HostTurnIntent,
      _ac: AbortController,
    ): AsyncGenerator<unknown> {
      yield {
        type: 'system',
        subtype: 'notification',
        text: 'hello host',
        key: 'k1',
      }
      yield { type: 'result', subtype: 'success', is_error: false }
      return { reason: 'completed' }
    }

    const engine = createHostEngine({
      prepareTurn: async intent => intent,
      runTurn: notifTurn,
    })
    const notes: Array<{ text: string; key?: string }> = []
    const feed = createHostEngineFeed()

    await runHostEngineTurn({
      engine,
      feed,
      turnInput: {},
      newMessages: [{ type: 'user', message: { role: 'user', content: 'x' } }],
      onQueryEvent: () => {},
      addNotification: n => notes.push({ text: n.text, key: n.key }),
    })

    expect(notes).toEqual([{ text: 'hello host', key: 'k1' }])
    engine.close()
    feed.input?.done()
  })
})
