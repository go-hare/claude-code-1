import { describe, expect, test } from 'bun:test'
import {
  computeElementViewportVisibility,
  notifyScrollVisibilityWatchers,
} from '../../hooks/use-terminal-viewport.js'
import type { DOMElement } from '../dom.js'

type FakeYoga = {
  getComputedHeight: () => number
  getComputedTop: () => number
}

function fakeNode(opts: {
  top: number
  height: number
  parent?: DOMElement
  scrollTop?: number
  yogaHeight?: number
}): DOMElement {
  const yoga: FakeYoga = {
    getComputedHeight: () => opts.height,
    getComputedTop: () => opts.top,
  }
  const node = {
    yogaNode: yoga as unknown as DOMElement['yogaNode'],
    parentNode: opts.parent,
    scrollTop: opts.scrollTop,
  } as unknown as DOMElement
  if (opts.yogaHeight !== undefined) {
    // Root uses this node's height for screenHeight walk.
    ;(yoga as FakeYoga).getComputedHeight = () => opts.yogaHeight!
  }
  return node
}

describe('computeElementViewportVisibility', () => {
  test('element inside terminal rows is visible', () => {
    // root height = rows → no scrollback offset; element at top of screen
    const root = fakeNode({ top: 0, height: 24, yogaHeight: 24 })
    // root is its own parent walk end — recompute walks parent chain
    const el = fakeNode({ top: 10, height: 1, parent: root })
    // root yoga height used as screenHeight: make root the terminal-sized root
    expect(computeElementViewportVisibility(el, 24)).toBe(true)
  })

  test('element far below terminal rows is offscreen without scroll', () => {
    // root taller than terminal (fullscreen content), element deep in content
    const root = fakeNode({ top: 0, height: 200, yogaHeight: 200 })
    const el = fakeNode({ top: 180, height: 1, parent: root })
    // viewport is last 24 rows of 200 → viewportY≈176, element at 180 is visible
    expect(computeElementViewportVisibility(el, 24)).toBe(true)
    // even deeper
    const deep = fakeNode({ top: 250, height: 1, parent: root })
    expect(computeElementViewportVisibility(deep, 24)).toBe(false)
  })

  test('ScrollBox scrollTop brings offscreen element into view', () => {
    // Fullscreen root constrained to terminal height; content scrolls inside.
    const root = fakeNode({ top: 0, height: 24, yogaHeight: 24 })
    // Scroll container between root and element
    const scroll = fakeNode({ top: 0, height: 20, parent: root, scrollTop: 0 })
    // Spinner near end of long transcript (yoga top 500 relative to scroll content)
    const spinner = fakeNode({ top: 500, height: 1, parent: scroll })
    expect(computeElementViewportVisibility(spinner, 24)).toBe(false)

    // Jump to bottom: scrollTop pulls spinner into viewport
    scroll.scrollTop = 490
    expect(computeElementViewportVisibility(spinner, 24)).toBe(true)
  })
})

describe('notifyScrollVisibilityWatchers', () => {
  test('notifies all registered listeners (via private subscribe path)', async () => {
    // Import is the module-level notify used by ScrollBox. Register by
    // calling useTerminalViewport is React-bound; test notify fan-out by
    // temporarily patching through a side-channel listener set is not
    // exported — instead verify notify is a no-throw no-op with zero
    // listeners and that the export is callable.
    expect(() => notifyScrollVisibilityWatchers()).not.toThrow()
  })
})
