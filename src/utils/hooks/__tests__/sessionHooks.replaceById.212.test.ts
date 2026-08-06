/**
 * densable 2.1.212 #26 — gZc replace-by-id for function hooks.
 *
 * When team init re-runs in-session, Stop hooks with the same id must replace
 * the prior registration instead of stacking (duplicate idle notifications).
 */
import { describe, expect, test } from 'bun:test'
import type { AppState } from 'src/state/AppState.js'
import {
  addFunctionHook,
  type FunctionHook,
  type SessionHooksState,
} from '../sessionHooks.js'

function makeState(): {
  get: () => AppState
  set: (f: (prev: AppState) => AppState) => void
} {
  let sessionHooks: SessionHooksState = new Map()
  return {
    get: () => ({ sessionHooks }) as unknown as AppState,
    set: f => {
      const next = f({ sessionHooks } as unknown as AppState)
      sessionHooks = next.sessionHooks
    },
  }
}

function listFunctionHookIds(
  state: AppState,
  sessionId: string,
  event: 'Stop' = 'Stop',
): string[] {
  const store = state.sessionHooks.get(sessionId)
  const matchers = store?.hooks[event] ?? []
  const ids: string[] = []
  for (const m of matchers) {
    for (const h of m.hooks) {
      if (h.hook.type === 'function') {
        ids.push((h.hook as FunctionHook).id ?? '')
      }
    }
  }
  return ids
}

describe('densable #26 sessionHooks gZc replace-by-id', () => {
  test('same-id function hook replaces prior registration', () => {
    const { get, set } = makeState()
    const sessionId = 'sess-1'
    let callsA = 0
    let callsB = 0

    addFunctionHook(
      set,
      sessionId,
      'Stop',
      '',
      () => {
        callsA++
        return true
      },
      'err-a',
      { timeout: 10000, id: 'teammate-idle-notification' },
    )
    addFunctionHook(
      set,
      sessionId,
      'Stop',
      '',
      () => {
        callsB++
        return true
      },
      'err-b',
      { timeout: 10000, id: 'teammate-idle-notification' },
    )

    const ids = listFunctionHookIds(get(), sessionId)
    expect(ids).toEqual(['teammate-idle-notification'])

    // Only the replacement callback is stored
    const hooks = get().sessionHooks.get(sessionId)!.hooks.Stop![0]!.hooks
    expect(hooks).toHaveLength(1)
    const cb = (hooks[0]!.hook as FunctionHook).callback
    void cb([])
    expect(callsA).toBe(0)
    expect(callsB).toBe(1)
  })

  test('different ids still append', () => {
    const { get, set } = makeState()
    const sessionId = 'sess-2'
    addFunctionHook(set, sessionId, 'Stop', '', () => true, 'e1', {
      id: 'hook-a',
    })
    addFunctionHook(set, sessionId, 'Stop', '', () => true, 'e2', {
      id: 'hook-b',
    })
    expect(listFunctionHookIds(get(), sessionId).sort()).toEqual([
      'hook-a',
      'hook-b',
    ])
  })

  test('hooks without id still append (no replace)', () => {
    const { get, set } = makeState()
    const sessionId = 'sess-3'
    addFunctionHook(set, sessionId, 'Stop', '', () => true, 'e1')
    addFunctionHook(set, sessionId, 'Stop', '', () => true, 'e2')
    const hooks = get().sessionHooks.get(sessionId)!.hooks.Stop![0]!.hooks
    expect(hooks).toHaveLength(2)
  })
})
