/**
 * densable oSf per-paint reset + offscreen render isolation locks.
 *
 * Gold `oSf(e)` resets every field of the render context in one place. Locally
 * the renderer called a trio (resetLayoutShifted / resetScrollHint /
 * resetScrollDrainNode) that omitted `followScroll`, whose only other clear is
 * `consumeFollowScroll` — and ink.tsx reaches that *after* the frameSink
 * early-return, so under a sticky sink nothing consumed it.
 *
 * `pendingClears` is not a context field: it lives in node-cache keyed by
 * DOMElement, so offscreen passes walk the same entries the live frame owns.
 */
import { describe, expect, test } from 'bun:test'
import { addPendingClear, createNode } from '../dom.js'
import Output from '../output.js'
import renderNodeToOutput, {
  createRenderFrameContext,
  resetRenderFrameContextState,
} from '../render-node-to-output.js'
import { CharPool, createScreen, HyperlinkPool, StylePool } from '../screen.js'

function makeOutput(width: number, height: number): Output {
  const stylePool = new StylePool()
  const screen = createScreen(
    width,
    height,
    stylePool,
    new CharPool(),
    new HyperlinkPool(),
  )
  return new Output({ width, height, stylePool, screen })
}

describe('resetRenderFrameContextState (official eS)', () => {
  test('clears every per-paint field, followScroll included', () => {
    const ctx = createRenderFrameContext()
    ctx.overlayActive = true
    ctx.layoutShifted = true
    ctx.scrollHint = { top: 1, bottom: 2, delta: 3 }
    ctx.scrollDrainNode = createNode('ink-box')
    ctx.followScroll = {
      delta: 7,
      viewportTop: 0,
      viewportBottom: 10,
      viewportLeft: 0,
      viewportRight: 79,
    }

    resetRenderFrameContextState(ctx)
    expect(ctx.layoutShifted).toBe(false)
    expect(ctx.scrollHint).toBeNull()
    expect(ctx.scrollDrainNode).toBeNull()
    expect(ctx.followScroll).toBeNull()
    expect(ctx.overlayActive).toBe(false)
  })

  test('rotates absolute rects: prev = cur, cur = []', () => {
    const ctx = createRenderFrameContext()
    const cur = [
      {
        node: createNode('ink-box'),
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        withinParent: true,
      },
    ]
    ctx.absoluteRectsCur = cur
    ctx.absoluteRectsPrev = []

    resetRenderFrameContextState(ctx)

    expect(ctx.absoluteRectsPrev).toBe(cur)
    expect(ctx.absoluteRectsCur).toEqual([])
    expect(ctx.absolutePaintCut).toBe(false)
  })

  test('a followScroll nobody consumed does not survive the next frame', () => {
    const ctx = createRenderFrameContext()
    ctx.followScroll = {
      delta: 4,
      viewportTop: 2,
      viewportBottom: 9,
      viewportLeft: 0,
      viewportRight: 79,
    }

    resetRenderFrameContextState(ctx)
    expect(ctx.followScroll).toBeNull()
  })
})

describe('pendingClears offscreen isolation', () => {
  test('live contexts consume, offscreen contexts opt out', () => {
    expect(createRenderFrameContext().consumeClears).toBe(true)
    expect(
      createRenderFrameContext({ consumeClears: false }).consumeClears,
    ).toBe(false)
  })

  test('a consuming pass deletes the entry after painting it', () => {
    const node = createNode('ink-box')
    addPendingClear(node, { x: 0, y: 0, width: 4, height: 2 }, false)
    expect(node.pendingClears).toBeDefined()

    const output = makeOutput(40, 10)
    const ctx = createRenderFrameContext()
    renderNodeToOutput(node, output, ctx, { prevScreen: undefined })
    expect(ctx.layoutShifted).toBe(true)

    expect(node.pendingClears).toBeUndefined()
  })

  test('a non-consuming pass paints the entry and leaves it', () => {
    const node = createNode('ink-box')
    addPendingClear(node, { x: 0, y: 0, width: 4, height: 2 }, false)

    const output = makeOutput(40, 10)
    const ctx = createRenderFrameContext({ consumeClears: false })
    renderNodeToOutput(node, output, ctx, { prevScreen: undefined })
    expect(ctx.layoutShifted).toBe(true)

    expect(node.pendingClears).toBeDefined()
  })
})
