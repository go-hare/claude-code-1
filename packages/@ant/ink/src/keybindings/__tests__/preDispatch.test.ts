import { describe, expect, test } from 'bun:test'
import type { Key } from '../../core/events/input-event.js'
import { Event } from '../../core/events/event.js'
import type { PreDispatchHandler } from '../KeybindingContext.js'
import type { InputEvent } from '../../core/events/input-event.js'

/**
 * densable Wlr/preDispatch unit shape:
 * - first handler returning true consumes (stop)
 * - handlers returning void/false fall through
 * - errors in one handler don't abort the loop
 *
 * ChordInterceptor owns the real loop; this mirrors Wlr so registry
 * semantics stay testable without mounting React/Ink.
 */
function runPreDispatch(
  handlers: Iterable<PreDispatchHandler>,
  input: string,
  key: Key,
  event: Event = new Event(),
): boolean {
  // ChordInterceptor passes a real InputEvent; handlers only need stopImmediatePropagation
  const asInput = event as InputEvent
  for (const handler of handlers) {
    try {
      if (handler(input, key, asInput) === true) {
        event.stopImmediatePropagation()
        return true
      }
    } catch {
      // densable swallows
    }
  }
  return false
}

function makeKey(partial: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    fn: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    home: false,
    end: false,
    wheelUp: false,
    wheelDown: false,
    ...partial,
  }
}

describe('preDispatch (densable Wlr/Q0t)', () => {
  test('returns false when no handlers registered', () => {
    const event = new Event()
    expect(runPreDispatch([], 'x', makeKey(), event)).toBe(false)
    expect(event.didStopImmediatePropagation()).toBe(false)
  })

  test('first truthy handler consumes and stops immediate propagation', () => {
    const calls: string[] = []
    const handlers: PreDispatchHandler[] = [
      () => {
        calls.push('a')
        return true
      },
      () => {
        calls.push('b')
        return true
      },
    ]
    const event = new Event()
    expect(runPreDispatch(handlers, 'c', makeKey({ ctrl: true }), event)).toBe(
      true,
    )
    expect(calls).toEqual(['a'])
    expect(event.didStopImmediatePropagation()).toBe(true)
  })

  test('void/false handlers fall through to later consumers', () => {
    const calls: string[] = []
    const handlers: PreDispatchHandler[] = [
      () => {
        calls.push('skip')
      },
      () => {
        calls.push('skip2')
        return false
      },
      () => {
        calls.push('hit')
        return true
      },
    ]
    expect(runPreDispatch(handlers, 'x', makeKey())).toBe(true)
    expect(calls).toEqual(['skip', 'skip2', 'hit'])
  })

  test('handler error is swallowed; later handlers still run', () => {
    const handlers: PreDispatchHandler[] = [
      () => {
        throw new Error('boom')
      },
      () => true,
    ]
    expect(runPreDispatch(handlers, 'x', makeKey())).toBe(true)
  })

  test('selection-style esc consumer only when hasSelection', () => {
    let hasSelection = false
    let cleared = false
    const handler: PreDispatchHandler = (_input, key) => {
      if (!hasSelection) return
      if (key.escape) {
        cleared = true
        return true
      }
      return
    }
    const esc = makeKey({ escape: true })
    expect(runPreDispatch([handler], '', esc)).toBe(false)
    expect(cleared).toBe(false)
    hasSelection = true
    expect(runPreDispatch([handler], '', esc)).toBe(true)
    expect(cleared).toBe(true)
  })

  test('register/unregister Set semantics match densable pzi', () => {
    const set = new Set<PreDispatchHandler>()
    const register = (h: PreDispatchHandler) => {
      set.add(h)
      return () => {
        set.delete(h)
      }
    }
    let n = 0
    const h: PreDispatchHandler = () => {
      n++
      return true
    }
    const unreg = register(h)
    expect(runPreDispatch(set, 'x', makeKey())).toBe(true)
    expect(n).toBe(1)
    unreg()
    expect(runPreDispatch(set, 'x', makeKey())).toBe(false)
    expect(n).toBe(1)
  })
})
