import { describe, expect, test } from 'bun:test'
import type { DOMElement } from '../dom.js'
import { FocusEvent } from '../events/focus-event.js'
import { FocusManager } from '../focus.js'

function makeNode(attrs: Record<string, unknown> = {}): DOMElement {
  return {
    nodeName: 'ink-box',
    attributes: attrs,
    childNodes: [],
    parentNode: undefined,
    style: {},
    yogaNode: undefined,
  } as unknown as DOMElement
}

function attach(root: DOMElement, child: DOMElement): void {
  child.parentNode = root
  root.childNodes.push(child)
}

describe('FocusManager (official densable 2.1.210)', () => {
  test('focus sets activeElement and notifies subscribers', () => {
    const events: string[] = []
    const fm = new FocusManager((target, event) => {
      events.push(`${event.type}:${target.attributes.id ?? '?'}`)
      return true
    })
    const a = makeNode({ id: 'a', tabIndex: 0 })
    const b = makeNode({ id: 'b', tabIndex: 0 })
    let notifies = 0
    const unsub = fm.subscribe(() => {
      notifies++
    })

    fm.focus(a)
    expect(fm.activeElement).toBe(a)
    expect(events).toEqual(['focus:a'])
    expect(notifies).toBe(1)

    fm.focus(b)
    expect(fm.activeElement).toBe(b)
    expect(events).toEqual(['focus:a', 'blur:a', 'focus:b'])
    expect(notifies).toBe(2)

    unsub()
    fm.focus(a)
    expect(notifies).toBe(2)
  })

  test('blur clears activeElement and notifies', () => {
    const fm = new FocusManager(() => true)
    const a = makeNode({ tabIndex: 0 })
    let n = 0
    fm.subscribe(() => {
      n++
    })
    fm.focus(a)
    fm.blur()
    expect(fm.activeElement).toBe(null)
    expect(n).toBe(2)
  })

  test('handleNodeRemoved restores from focusStack then autoFocusStack', () => {
    const root = makeNode({ id: 'root' })
    const auto = makeNode({ id: 'auto', tabIndex: 0, autoFocus: true })
    const mid = makeNode({ id: 'mid', tabIndex: 0 })
    const leaf = makeNode({ id: 'leaf', tabIndex: 0 })
    attach(root, auto)
    attach(root, mid)
    attach(root, leaf)
    root.focusManager = new FocusManager(() => true) as never

    const fm = new FocusManager(() => true)
    // Simulate tree membership: isInTree walks parentNode to root that...
    // handleNodeRemoved uses isInTree(candidate, root) where root is the
    // document root passed in. Our attach makes parent chain work if we
    // walk to root itself.
    fm.pushAutoFocusFallback(auto)
    fm.focus(auto)
    fm.focus(mid)
    fm.focus(leaf)
    expect(fm.activeElement).toBe(leaf)

    // Remove leaf → restore mid
    fm.handleNodeRemoved(leaf, root)
    expect(fm.activeElement).toBe(mid)

    // Remove mid → restore auto via stack/auto
    fm.handleNodeRemoved(mid, root)
    expect(fm.activeElement).toBe(auto)
  })

  test('pushAutoFocusFallback dedupes and caps order (last wins)', () => {
    const fm = new FocusManager(() => true)
    const a = makeNode({ id: 'a' })
    const b = makeNode({ id: 'b' })
    fm.pushAutoFocusFallback(a)
    fm.pushAutoFocusFallback(b)
    fm.pushAutoFocusFallback(a)
    // remove active so restore falls through empty focusStack to auto
    const root = makeNode()
    attach(root, a)
    attach(root, b)
    const dead = makeNode({ id: 'dead' })
    attach(root, dead)
    fm.focus(dead)
    fm.handleNodeRemoved(dead, root)
    expect(fm.activeElement).toBe(a)
  })

  test('nR-style reclaim: subscribe fires when focus moves to ancestor', () => {
    const root = makeNode({ id: 'root', tabIndex: 0 })
    const child = makeNode({ id: 'child', tabIndex: 0 })
    attach(root, child)

    const fm = new FocusManager(() => true)
    fm.focus(child)

    let reclaimed = 0
    const unsub = fm.subscribe(() => {
      if (fm.activeElement === child) return
      if (!fm.activeElement) {
        fm.focus(child)
        reclaimed++
        return
      }
      let parent = child.parentNode
      while (parent) {
        if (parent === fm.activeElement) {
          fm.focus(child)
          reclaimed++
          return
        }
        parent = parent.parentNode
      }
    })

    // Parent steals focus (tabIndex steal) — reclaim
    fm.focus(root)
    expect(fm.activeElement).toBe(child)
    expect(reclaimed).toBe(1)

    // Explicit blur → null active → reclaim
    fm.blur()
    expect(fm.activeElement).toBe(child)
    expect(reclaimed).toBe(2)

    unsub()
  })

  test('FocusEvent types are blur/focus', () => {
    const focus = new FocusEvent('focus', null)
    const blur = new FocusEvent('blur', null)
    expect(focus.type).toBe('focus')
    expect(blur.type).toBe('blur')
  })
})
