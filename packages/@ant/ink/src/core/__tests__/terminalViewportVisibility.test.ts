import { describe, expect, test } from 'bun:test'
import { computeElementViewportVisibility } from '../../hooks/use-terminal-viewport.js'
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
  scrollHeight?: number
  scrollViewportHeight?: number
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
    scrollHeight: opts.scrollHeight,
    scrollViewportHeight: opts.scrollViewportHeight,
  } as unknown as DOMElement
  if (opts.yogaHeight !== undefined) {
    ;(yoga as FakeYoga).getComputedHeight = () => opts.yogaHeight!
  }
  return node
}

const SIZE = { rows: 24 }

describe('computeElementViewportVisibility', () => {
  test('unmeasurable node returns null (densable ER)', () => {
    expect(computeElementViewportVisibility(null, SIZE)).toBe(null)
    expect(
      computeElementViewportVisibility(
        { parentNode: undefined } as DOMElement,
        SIZE,
      ),
    ).toBe(null)
    const el = fakeNode({ top: 0, height: 1 })
    expect(computeElementViewportVisibility(el, null)).toBe(null)
  })

  test('element inside terminal rows is visible', () => {
    const root = fakeNode({ top: 0, height: 24, yogaHeight: 24 })
    const el = fakeNode({ top: 10, height: 1, parent: root })
    expect(computeElementViewportVisibility(el, SIZE)).toBe(true)
  })

  test('element far below terminal rows is offscreen without scroll', () => {
    const root = fakeNode({ top: 0, height: 200, yogaHeight: 200 })
    const el = fakeNode({ top: 180, height: 1, parent: root })
    expect(computeElementViewportVisibility(el, SIZE)).toBe(true)
    const deep = fakeNode({ top: 250, height: 1, parent: root })
    expect(computeElementViewportVisibility(deep, SIZE)).toBe(false)
  })

  test('height-0 box on viewport edge is visible (densable ER)', () => {
    const root = fakeNode({ top: 0, height: 200, yogaHeight: 200 })
    // viewportY = max(0, 200-24)+1 = 177; height 0 uses top >= viewportY
    const edge = fakeNode({ top: 177, height: 0, parent: root })
    expect(computeElementViewportVisibility(edge, SIZE)).toBe(true)
    const above = fakeNode({ top: 176, height: 0, parent: root })
    expect(computeElementViewportVisibility(above, SIZE)).toBe(false)
  })

  test('ScrollBox scrollTop brings offscreen element into view', () => {
    const root = fakeNode({ top: 0, height: 24, yogaHeight: 24 })
    const scroll = fakeNode({ top: 0, height: 20, parent: root, scrollTop: 0 })
    const spinner = fakeNode({ top: 500, height: 1, parent: scroll })
    expect(computeElementViewportVisibility(spinner, SIZE)).toBe(false)

    scroll.scrollTop = 490
    expect(computeElementViewportVisibility(spinner, SIZE)).toBe(true)
  })

  test('HWM overscroll is clamped before visibility walk (densable HS)', () => {
    const root = fakeNode({ top: 0, height: 24, yogaHeight: 24 })
    const scroll = fakeNode({
      top: 0,
      height: 20,
      parent: root,
      scrollTop: 900,
      scrollHeight: 520,
      scrollViewportHeight: 20,
    })
    const spinner = fakeNode({ top: 500, height: 1, parent: scroll })
    // unclamped 900 would pull spinner far above the viewport
    expect(computeElementViewportVisibility(spinner, SIZE)).toBe(true)
  })
})
