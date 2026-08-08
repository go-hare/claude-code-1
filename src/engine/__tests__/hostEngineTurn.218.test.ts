/**
 * densable 2.1.218 HWf — Host REPL turn pump (runHostEngineTurn).
 */
import { describe, expect, test } from 'bun:test'
import {
  createHostEngine,
  type HostEngine,
  type HostTurnIntent,
} from '../hostEngine.js'
import { runHostEngineTurn } from '../hostEngineTurn.js'
import { Stream } from '../../utils/stream.js'

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
    const pending: Array<{ tag: string }> = []
    const engine = createHostEngine<{ tag: string }>({
      prepareTurn: async () => {
        const next = pending.shift()
        if (!next) throw new Error('no pending')
        return next
      },
      runTurn: runWithResult,
    })

    const events: unknown[] = []
    const inputRef: { current: Stream<Record<string, unknown>> | null } = {
      current: null,
    }
    const pendingQueryParamsRef = {
      current: pending as Array<Record<string, unknown>>,
    }

    await runHostEngineTurn({
      engine,
      inputRef,
      pendingQueryParamsRef,
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
    expect(inputRef.current).not.toBeNull()

    // second turn reuses the same streamInput
    await runHostEngineTurn({
      engine,
      inputRef,
      pendingQueryParamsRef,
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
    inputRef.current?.done()
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
    const inputRef: { current: Stream<Record<string, unknown>> | null } = {
      current: null,
    }
    const pendingQueryParamsRef = {
      current: [] as Array<Record<string, unknown>>,
    }

    await runHostEngineTurn({
      engine,
      inputRef,
      pendingQueryParamsRef,
      turnInput: { uuid: 'u1' },
      newMessages: [{ type: 'user', message: { role: 'user', content: 'x' } }],
      onQueryEvent: e => events.push(e),
    })

    expect(events).toEqual([{ type: 'assistant', text: 'visible' }])
    engine.close()
    inputRef.current?.done()
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
    const inputRef: { current: Stream<Record<string, unknown>> | null } = {
      current: null,
    }
    const pendingQueryParamsRef = {
      current: [] as Array<Record<string, unknown>>,
    }

    await runHostEngineTurn({
      engine,
      inputRef,
      pendingQueryParamsRef,
      turnInput: {},
      newMessages: [{ type: 'user', message: { role: 'user', content: 'x' } }],
      onQueryEvent: () => {},
      addNotification: n => notes.push({ text: n.text, key: n.key }),
    })

    expect(notes).toEqual([{ text: 'hello host', key: 'k1' }])
    engine.close()
    inputRef.current?.done()
  })
})
