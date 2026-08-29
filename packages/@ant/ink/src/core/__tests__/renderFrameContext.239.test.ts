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
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { serializeGapBackfill } from '../axcScreenSerialize.js'
import { createNode } from '../dom.js'
import Ink from '../ink.js'
import instances from '../instances.js'
import { addPendingClear, pendingClears } from '../node-cache.js'
import Output from '../output.js'
import renderNodeToOutput, {
  consumeFollowScroll,
  createRenderFrameContext,
  didLayoutShift,
  getScrollDrainNode,
  getScrollHint,
  resetRenderFrameContext,
  runWithRenderFrameContext,
} from '../render-node-to-output.js'
import { CharPool, createScreen, HyperlinkPool, StylePool } from '../screen.js'

function makeTtyStdout() {
  const stdout = new PassThrough() as PassThrough & {
    columns: number
    rows: number
    isTTY: boolean
  }
  stdout.columns = 80
  stdout.rows = 24
  stdout.isTTY = true
  return stdout
}

function makeTtyStdin() {
  const stdin = new EventEmitter() as EventEmitter & {
    isTTY: boolean
    setRawMode?: (m: boolean) => void
    ref?: () => void
    unref?: () => void
    resume?: () => void
    pause?: () => void
    read?: () => null
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  stdin.resume = () => {}
  stdin.pause = () => {}
  stdin.read = () => null
  return stdin
}

function withInkOnStdout<T>(fn: (ink: Ink) => T): T {
  const ink = new Ink({
    stdout: makeTtyStdout() as never,
    stdin: makeTtyStdin() as never,
    stderr: new PassThrough() as never,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  instances.set(process.stdout, ink)
  try {
    return fn(ink)
  } finally {
    instances.delete(process.stdout)
    ink.unmount()
  }
}

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

describe('resetRenderFrameContext (densable oSf)', () => {
  test('clears every per-paint field, followScroll included', () => {
    const ctx = createRenderFrameContext()
    ctx.overlayActive = true
    ctx.layoutShifted = true
    ctx.scrollHint = { top: 1, bottom: 2, delta: 3 }
    ctx.scrollDrainNode = createNode('ink-box')
    ctx.followScroll = { delta: 7, viewportTop: 0, viewportBottom: 10 }

    runWithRenderFrameContext(ctx, () => {
      resetRenderFrameContext()
      expect(didLayoutShift()).toBe(false)
      expect(getScrollHint()).toBeNull()
      expect(getScrollDrainNode()).toBeNull()
      expect(consumeFollowScroll()).toBeNull()
    })

    expect(ctx.overlayActive).toBe(false)
  })

  test('rotates absolute rects: prev = cur, cur = []', () => {
    const ctx = createRenderFrameContext()
    const cur = [{ x: 0, y: 0, width: 1, height: 1 }]
    ctx.absoluteRectsCur = cur
    ctx.absoluteRectsPrev = []

    runWithRenderFrameContext(ctx, () => {
      resetRenderFrameContext()
    })

    expect(ctx.absoluteRectsPrev).toBe(cur)
    expect(ctx.absoluteRectsCur).toEqual([])
  })

  test('a followScroll nobody consumed does not survive the next frame', () => {
    const ctx = createRenderFrameContext()

    runWithRenderFrameContext(ctx, () => {
      // Frame N set a delta; a sticky frameSink returned before ink.tsx could
      // consume it.
      ctx.followScroll = { delta: 4, viewportTop: 2, viewportBottom: 9 }

      // Frame N+1 begins.
      resetRenderFrameContext()

      expect(consumeFollowScroll()).toBeNull()
    })
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
    expect(pendingClears.get(node)).toBeDefined()

    const output = makeOutput(40, 10)
    runWithRenderFrameContext(createRenderFrameContext(), () => {
      renderNodeToOutput(node, output, { prevScreen: undefined })
      expect(didLayoutShift()).toBe(true)
    })

    expect(pendingClears.get(node)).toBeUndefined()
  })

  test('a non-consuming pass paints the entry and leaves it', () => {
    const node = createNode('ink-box')
    addPendingClear(node, { x: 0, y: 0, width: 4, height: 2 }, false)

    const output = makeOutput(40, 10)
    runWithRenderFrameContext(
      createRenderFrameContext({ consumeClears: false }),
      () => {
        renderNodeToOutput(node, output, { prevScreen: undefined })
        expect(didLayoutShift()).toBe(true)
      },
    )

    expect(pendingClears.get(node)).toBeDefined()
  })

  test('gap backfill leaves the live frame its pendingClears', () => {
    withInkOnStdout(ink => {
      const scroll = createNode('ink-box')
      scroll.scrollHeight = 50
      const content = createNode('ink-box')
      scroll.childNodes.push(content)
      content.parentNode = scroll

      addPendingClear(content, { x: 0, y: 0, width: 4, height: 2 }, false)

      serializeGapBackfill(scroll, 0, 5, 40, ink.getStylePool())

      // Consuming here would leave the removed child's cells on screen: the
      // live frame is the only pass whose Output reaches the terminal.
      expect(pendingClears.get(content)).toBeDefined()
    })
  })
})
