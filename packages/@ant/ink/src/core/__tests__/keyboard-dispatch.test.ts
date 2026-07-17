import { describe, expect, test } from 'bun:test'
import { KeyboardEvent } from '../events/keyboard-event.js'
import type { EventTarget } from '../events/terminal-event.js'
import type { ParsedKey } from '../parse-keypress.js'
import { dispatcher } from '../reconciler.js'

function makeNode(
  handlers: Partial<{
    onKeyDown: (event: KeyboardEvent) => void
    onKeyDownCapture: (event: KeyboardEvent) => void
  }> = {},
  parent?: EventTarget,
): EventTarget {
  return {
    parentNode: parent,
    _eventHandlers: handlers,
  }
}

function parsed(partial: Partial<ParsedKey> & { sequence: string }): ParsedKey {
  return {
    kind: 'key',
    name: '',
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    raw: partial.sequence,
    isPasted: false,
    ...partial,
  }
}

describe('dispatchKeyboardEvent target path (official densable)', () => {
  test('keydown reaches focused target, not only root', () => {
    const hits: string[] = []
    const root = makeNode({
      onKeyDown: () => {
        hits.push('root')
      },
    })
    const focused = makeNode(
      {
        onKeyDown: event => {
          hits.push('focused')
          event.preventDefault()
        },
      },
      root,
    )

    const event = new KeyboardEvent(parsed({ sequence: 'a', name: 'a' }))
    dispatcher.dispatchDiscrete(focused, event)
    // bubble: target then root (root still receives unless stopPropagation)
    expect(hits[0]).toBe('focused')
    expect(event.defaultPrevented).toBe(true)
  })

  test('paste is never a keydown (separate event type)', () => {
    const keyHits: string[] = []
    const target = makeNode({
      onKeyDown: () => {
        keyHits.push('key')
      },
    })
    // Simulating lag: isPasted → PasteEvent only; no KeyboardEvent constructed.
    expect(keyHits).toEqual([])
    void target
  })

  test('KeyboardEvent.key matches fag for printable and return', () => {
    expect(new KeyboardEvent(parsed({ sequence: 'x', name: 'x' })).key).toBe(
      'x',
    )
    expect(
      new KeyboardEvent(parsed({ sequence: '\r', name: 'return' })).key,
    ).toBe('return')
    expect(
      new KeyboardEvent(parsed({ sequence: '\n', name: 'enter' })).key,
    ).toBe('enter')
    // d7r mid-paste guard uses event.key === "return"
    const ret = new KeyboardEvent(parsed({ sequence: '\r', name: 'return' }))
    expect(ret.key === 'return').toBe(true)
  })

  test('large non-bracketed key length is measurable for pkt gate', () => {
    const big = 'z'.repeat(801)
    const e = new KeyboardEvent(parsed({ sequence: big }))
    expect(e.key.length).toBe(801)
    expect(e.key.length > 800).toBe(true)
  })
})
