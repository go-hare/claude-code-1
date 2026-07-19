import { describe, expect, test } from 'bun:test'
import { KeyboardEvent } from '@anthropic/ink'
import type { ParsedKey } from '@anthropic/ink'

/**
 * Mirrors official densable rfo wrap:
 *   if (onKeyDownBefore?.(W), W.defaultPrevented || W.didStopImmediatePropagation()) return
 *   a(W)
 * and PromptInput UI: vo then $F with the same short-circuit.
 */
function runKeyDownChain(
  handlers: Array<(e: KeyboardEvent) => void>,
  event: KeyboardEvent,
  base: (e: KeyboardEvent) => void,
): 'base' | 'short-circuit' {
  for (const h of handlers) {
    h(event)
    if (event.defaultPrevented || event.didStopImmediatePropagation()) {
      return 'short-circuit'
    }
  }
  base(event)
  return 'base'
}

function parsed(
  partial: Partial<ParsedKey> & { name?: string; sequence?: string },
): ParsedKey {
  return {
    kind: 'key',
    name: partial.name ?? '',
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    sequence: partial.sequence ?? '\r',
    raw: partial.sequence ?? '\r',
    isPasted: false,
    ...partial,
  }
}

describe('onKeyDownBefore composition (densable UI → rfo)', () => {
  test('typeahead preventDefault on return skips base submit/insert', () => {
    let baseCalls = 0
    let typeaheadCalls = 0
    const event = new KeyboardEvent(parsed({ name: 'return', sequence: '\r' }))
    const result = runKeyDownChain(
      [
        () => {
          /* history search no-op when not searching */
        },
        e => {
          typeaheadCalls++
          if (
            (e.name === 'return' || e.key === 'return') &&
            !e.shift &&
            !e.meta
          ) {
            e.preventDefault()
          }
        },
      ],
      event,
      () => {
        baseCalls++
      },
    )
    expect(result).toBe('short-circuit')
    expect(typeaheadCalls).toBe(1)
    expect(baseCalls).toBe(0)
    expect(event.defaultPrevented).toBe(true)
  })

  test('history preventDefault short-circuits before typeahead', () => {
    let typeaheadCalls = 0
    let baseCalls = 0
    const event = new KeyboardEvent(
      parsed({ name: 'backspace', sequence: '\x7f' }),
    )
    const result = runKeyDownChain(
      [
        e => {
          e.preventDefault()
        },
        () => {
          typeaheadCalls++
        },
      ],
      event,
      () => {
        baseCalls++
      },
    )
    expect(result).toBe('short-circuit')
    expect(typeaheadCalls).toBe(0)
    expect(baseCalls).toBe(0)
  })

  test('no preventDefault reaches base', () => {
    let baseCalls = 0
    const event = new KeyboardEvent(parsed({ name: 'a', sequence: 'a' }))
    const result = runKeyDownChain([() => {}, () => {}], event, () => {
      baseCalls++
    })
    expect(result).toBe('base')
    expect(baseCalls).toBe(1)
  })
})
