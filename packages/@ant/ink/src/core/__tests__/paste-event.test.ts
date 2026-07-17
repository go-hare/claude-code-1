import { describe, expect, test } from 'bun:test'
import { PasteEvent } from '../events/paste-event.js'
import type { EventTarget } from '../events/terminal-event.js'
import { dispatcher } from '../reconciler.js'

function makeNode(
  handlers: Partial<{
    onPaste: (event: PasteEvent) => void
    onPasteCapture: (event: PasteEvent) => void
  }> = {},
  parent?: EventTarget,
): EventTarget {
  const node: EventTarget = {
    parentNode: parent,
    _eventHandlers: handlers,
  }
  return node
}

describe('PasteEvent (official densable 2.1.210)', () => {
  test('text is set and pastedText aliases it', () => {
    const event = new PasteEvent('hello paste')
    expect(event.type).toBe('paste')
    expect(event.text).toBe('hello paste')
    expect(event.pastedText).toBe('hello paste')
    expect(event.bubbles).toBe(true)
    expect(event.cancelable).toBe(true)
  })

  test('dispatchDiscrete delivers paste to target onPaste', () => {
    const received: string[] = []
    const target = makeNode({
      onPaste: event => {
        received.push(event.text)
        event.preventDefault()
      },
    })

    const event = new PasteEvent('bracketed content')
    dispatcher.dispatchDiscrete(target, event)

    expect(received).toEqual(['bracketed content'])
    expect(event.defaultPrevented).toBe(true)
  })

  test('capture then bubble order matches DOM', () => {
    const order: string[] = []
    const root = makeNode({
      onPasteCapture: () => {
        order.push('root-cap')
      },
      onPaste: () => {
        order.push('root-bub')
      },
    })
    const target = makeNode(
      {
        onPasteCapture: () => {
          order.push('target-cap')
        },
        onPaste: () => {
          order.push('target-bub')
        },
      },
      root,
    )

    dispatcher.dispatchDiscrete(target, new PasteEvent('x'))
    expect(order).toEqual(['root-cap', 'target-cap', 'target-bub', 'root-bub'])
  })

  test('empty paste text is delivered (image clipboard path)', () => {
    const received: string[] = []
    const target = makeNode({
      onPaste: event => {
        received.push(event.text)
      },
    })
    dispatcher.dispatchDiscrete(target, new PasteEvent(''))
    expect(received).toEqual([''])
  })
})
