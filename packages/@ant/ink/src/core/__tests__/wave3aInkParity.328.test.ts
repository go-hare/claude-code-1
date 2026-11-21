import { afterEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import React from 'react'
import * as dom from '../dom.js'
import { IncrementalPainter } from '../incremental-painter.js'
import Ink from '../ink.js'
import { LayoutController } from '../layout-controller.js'
import {
  createNewRenderers,
  getTerminalRenderCapabilities,
  type RenderTargetFrame,
} from '../new-renderer.js'
import Output from '../output.js'
import { OverlayController } from '../overlay-controller.js'
import { PointerController } from '../pointer-controller.js'
import renderNodeToOutput, {
  createRenderFrameContext,
} from '../render-node-to-output.js'
import {
  CellWidth,
  CharPool,
  createScreen,
  HyperlinkPool,
  type Screen,
  StylePool,
  setCellAt,
} from '../screen.js'
import {
  createTerminalEmojiWidthCalibrator,
  setTerminalEmojiWidthCalibrator,
  stringWidth,
} from '../stringWidth.js'
import Yoga from '../yoga-layout/index.js'

function makePools() {
  return {
    stylePool: new StylePool(),
    charPool: new CharPool(),
    hyperlinkPool: new HyperlinkPool(),
  }
}

function makeScreenWithLines(
  width: number,
  lines: string[],
  pools = makePools(),
): Screen {
  const screen = createScreen(
    width,
    lines.length,
    pools.stylePool,
    pools.charPool,
    pools.hyperlinkPool,
  )
  for (let y = 0; y < lines.length; y++) {
    const line = lines[y]!
    for (let x = 0; x < Math.min(width, line.length); x++) {
      setCellAt(screen, x, y, {
        char: line[x]!,
        styleId: 0,
        width: CellWidth.Narrow,
        hyperlink: undefined,
      })
    }
  }
  return screen
}

function createFakeTtyStdout(columns = 40, rows = 10) {
  const chunks: string[] = []
  const emitter = new EventEmitter()
  const stdout = Object.assign(emitter, {
    columns,
    rows,
    isTTY: true,
    write(chunk: string | Uint8Array): boolean {
      chunks.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    },
  }) as unknown as NodeJS.WriteStream & { columns: number; rows: number }
  return { stdout, chunks }
}

function createFakeStdin() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isTTY: true,
    setRawMode: () => {},
    resume: () => {},
    pause: () => {},
    read: () => null,
    setEncoding: () => {},
    ref: () => {},
    unref: () => {},
  }) as unknown as NodeJS.ReadStream
}

function createTestInk(
  columns = 40,
  rows = 10,
  opts?: { newRenderer?: boolean },
) {
  const { stdout, chunks } = createFakeTtyStdout(columns, rows)
  const ink = new Ink({
    stdout,
    stdin: createFakeStdin(),
    stderr: stdout,
    exitOnCtrlC: false,
    patchConsole: false,
    newRenderer: opts?.newRenderer,
  })
  return { ink, stdout, chunks }
}

afterEach(() => {
  setTerminalEmojiWidthCalibrator(undefined)
})

describe('Wave 3A [P0-6]: dom.markDirty propagatedToParent inside if (cache)', () => {
  test('dirtying text inside ink-virtual-text marks enclosing ink-text as self and box as child', () => {
    const root = dom.createNode('ink-root')
    const box = dom.createNode('ink-box')
    const text = dom.createNode('ink-text')
    const vtext = dom.createNode('ink-virtual-text')
    const leaf = dom.createTextNode('hello')

    dom.appendChildNode(root, box)
    dom.appendChildNode(box, text)
    dom.appendChildNode(text, vtext)
    dom.appendChildNode(vtext, leaf as unknown as dom.DOMElement)

    const makeCleanPaintCache = (): NonNullable<
      dom.DOMElement['paintCache']
    > => ({
      x: 0,
      y: 0,
      width: 20,
      height: 1,
      screenWidth: 20,
      colorLevel: 0,
      squeezed: false,
      top: 0,
      bottom: 1,
      shownTop: 0,
      shownBottom: 1,
      changed: undefined,
    })

    // Give box and ink-text clean paintCache (changed: undefined);
    // ink-virtual-text has NO paintCache (official behavior)
    box.paintCache = makeCleanPaintCache()
    text.paintCache = makeCleanPaintCache()
    vtext.paintCache = undefined

    dom.setTextNodeValue(leaf, 'world')

    // Because ink-virtual-text has no paintCache, propagatedToParent must stay false
    // until we hit ink-text, which MUST be marked 'self' (not 'child')!
    expect(text.paintCache?.changed).toBe('self')
    expect(box.paintCache?.changed).toBe('child')
  })

  test('IncrementalPainter repaints mutated text inside ink-virtual-text', () => {
    const root = dom.createNode('ink-root')
    const box = dom.createNode('ink-box')
    const text = dom.createNode('ink-text')
    const vtext = dom.createNode('ink-virtual-text')
    const leaf = dom.createTextNode('AAA')
    dom.appendChildNode(root, box)
    dom.appendChildNode(box, text)
    dom.appendChildNode(text, vtext)
    dom.appendChildNode(vtext, leaf as unknown as dom.DOMElement)

    root.yogaNode!.setWidth(20)
    root.yogaNode!.calculateLayout(20)

    const pools = makePools()
    const s1 = createScreen(
      20,
      1,
      pools.stylePool,
      pools.charPool,
      pools.hyperlinkPool,
    )
    const out1 = new Output({
      width: 20,
      height: 1,
      stylePool: pools.stylePool,
      screen: s1,
    })
    const painter = new IncrementalPainter(
      out1,
      createRenderFrameContext(),
      pools.stylePool,
    )
    painter.paint(root, s1, 0, false)

    // Mutate nested virtual-text leaf
    dom.setTextNodeValue(leaf, 'BBB')
    root.yogaNode!.calculateLayout(20)

    const s2 = createScreen(
      20,
      1,
      pools.stylePool,
      pools.charPool,
      pools.hyperlinkPool,
    )
    out1.reset(20, 1, s2)
    painter.paint(root, s2, 0, false)

    const row = Array.from(
      { length: 3 },
      (_, x) => pools.charPool.get(s2.cells[x * 2]!) ?? '',
    ).join('')
    expect(row).toBe('BBB')
  })
})

describe('Wave 3A [P0-7]: new-renderer invalidateScreenRows dirty sentinel (Zl=1)', () => {
  test('InlineRenderer emits EL when content shrinks from 5 rows to 2 rows', () => {
    const pools = makePools()
    const { inline } = createNewRenderers(pools.stylePool)
    const caps = getTerminalRenderCapabilities()

    const prev: RenderTargetFrame = {
      screen: makeScreenWithLines(
        20,
        ['row0', 'row1', 'row2', 'row3', 'row4'],
        pools,
      ),
      top: 0,
      viewport: { width: 20, height: 10 },
      cursor: { x: 0, y: 5, visible: false, staysVisible: false },
    }
    const emptyPrev: RenderTargetFrame = {
      screen: createScreen(
        20,
        0,
        pools.stylePool,
        pools.charPool,
        pools.hyperlinkPool,
      ),
      top: 0,
      viewport: { width: 20, height: 10 },
      cursor: { x: 0, y: 0, visible: false, staysVisible: false },
    }
    inline.render(emptyPrev, prev, caps)

    const shrunk: RenderTargetFrame = {
      screen: makeScreenWithLines(20, ['row0', 'row1'], pools),
      top: 0,
      viewport: { width: 20, height: 10 },
      cursor: { x: 0, y: 2, visible: false, staysVisible: false },
    }
    const res = inline.render(prev, shrunk, caps)
    expect(res.hasChanges).toBe(true)
    // Must emit EL (\x1b[K) to clear stale rows 2..4!
    expect(res.bytes).toContain('\x1b[K')
  })

  test('InlineRenderer cursorRowWasErased forces EL even when target row is blank', () => {
    const pools = makePools()
    const { inline } = createNewRenderers(pools.stylePool)
    const caps = getTerminalRenderCapabilities()

    const emptyPrev: RenderTargetFrame = {
      screen: createScreen(
        20,
        0,
        pools.stylePool,
        pools.charPool,
        pools.hyperlinkPool,
      ),
      top: 0,
      viewport: { width: 20, height: 10 },
      cursor: { x: 0, y: 0, visible: false, staysVisible: false },
    }
    const frame1: RenderTargetFrame = {
      screen: makeScreenWithLines(20, ['line0', '', ''], pools),
      top: 0,
      viewport: { width: 20, height: 10 },
      cursor: { x: 0, y: 1, visible: false, staysVisible: false },
    }
    inline.render(emptyPrev, frame1, caps)
    inline.cursorRowWasErased()

    // Identical frame with blank cursor row (row 1) MUST still emit EL
    const res = inline.render(frame1, frame1, caps)
    expect(res.hasChanges).toBe(true)
    expect(res.bytes).toContain('\x1b[K')
  })

  test('FullscreenRenderer cursorRowWasErased and repaintsEveryCell invalidate with sentinel', () => {
    const pools = makePools()
    const { fullscreen } = createNewRenderers(pools.stylePool)
    const caps = getTerminalRenderCapabilities()

    const frame: RenderTargetFrame = {
      screen: makeScreenWithLines(20, ['alpha', '', 'gamma'], pools),
      top: 0,
      viewport: { width: 20, height: 3 },
      cursor: { x: 0, y: 1, visible: false, staysVisible: false },
    }
    fullscreen.render(frame, caps)
    fullscreen.frameWasWritten()

    // Blank row 1 marked erased via sentinel must trigger EL erase
    fullscreen.cursorRowWasErased()
    const afterErase = fullscreen.render(frame, caps)
    expect(afterErase.hasChanges).toBe(true)
    expect(afterErase.bytes).toContain('\x1b[K')
    fullscreen.frameWasWritten()

    // repaintsEveryCell must invalidate all rows and re-emit content + blank row EL
    const fullCaps = getTerminalRenderCapabilities({ repaintsEveryCell: true })
    const fullRes = fullscreen.render(frame, fullCaps)
    expect(fullRes.hasChanges).toBe(true)
    expect(fullRes.bytes).toContain('alpha')
    expect(fullRes.bytes).toContain('\x1b[K')
    expect(fullRes.bytes).toContain('gamma')
  })
})

describe('Wave 3A [P0-8]: InlineRenderer cursor preamble Re, cursor-only move, reasonToRedraw, shownOnMainScreen', () => {
  test('emits vertical preamble (drawnHeight - Re) before diff and handles cursor-only move', () => {
    const pools = makePools()
    const { inline } = createNewRenderers(pools.stylePool)
    const caps = getTerminalRenderCapabilities()

    const emptyPrev: RenderTargetFrame = {
      screen: createScreen(
        20,
        0,
        pools.stylePool,
        pools.charPool,
        pools.hyperlinkPool,
      ),
      top: 0,
      viewport: { width: 20, height: 10 },
      cursor: { x: 0, y: 0, visible: false, staysVisible: false },
    }
    const f1: RenderTargetFrame = {
      screen: makeScreenWithLines(20, ['aaa', 'bbb', 'ccc', 'ddd'], pools),
      top: 0,
      viewport: { width: 20, height: 10 },
      cursor: { x: 2, y: 1, visible: true, staysVisible: false },
    }
    inline.render(emptyPrev, f1, caps)

    // Cursor-only move: content identical, cursor moves from (2,1) -> (3,3)
    const f2: RenderTargetFrame = {
      screen: makeScreenWithLines(20, ['aaa', 'bbb', 'ccc', 'ddd'], pools),
      top: 0,
      viewport: { width: 20, height: 10 },
      cursor: { x: 3, y: 3, visible: true, staysVisible: false },
    }
    const cursorOnly = inline.render(f1, f2, caps)
    expect(cursorOnly.hasChanges).toBe(false)
    // Moves down 2 rows (\x1b[2B) and to column 4 (1-indexed \x1b[4G)
    expect(cursorOnly.bytes).toContain('\x1b[2B')
    expect(cursorOnly.bytes).toContain('\x1b[4G')

    // Content change while cursor is parked above drawnHeight (Re=1, drawnHeight=4 -> preamble \x1b[3B)
    const f3: RenderTargetFrame = {
      screen: makeScreenWithLines(20, ['aaa', 'BBB', 'ccc', 'ddd'], pools),
      top: 0,
      viewport: { width: 20, height: 10 },
      cursor: { x: 1, y: 1, visible: true, staysVisible: false },
    }
    inline.render(f2, f1, caps) // return cursor to (2, 1)
    const withPreamble = inline.render(f1, f3, caps)
    expect(withPreamble.hasChanges).toBe(true)
    expect(withPreamble.bytes).toContain('\x1b[3B')
    expect(withPreamble.bytes).toContain('BBB')
  })

  test('reasonToRedraw triggers resize on width/height changes and offscreen when shrinking into viewport', () => {
    const pools = makePools()
    const { inline } = createNewRenderers(pools.stylePool)
    const caps = getTerminalRenderCapabilities()

    const emptyPrev: RenderTargetFrame = {
      screen: createScreen(
        20,
        0,
        pools.stylePool,
        pools.charPool,
        pools.hyperlinkPool,
      ),
      top: 0,
      viewport: { width: 20, height: 5 },
      cursor: { x: 0, y: 0, visible: false, staysVisible: false },
    }
    const wideFrame: RenderTargetFrame = {
      screen: makeScreenWithLines(20, ['a', 'b', 'c'], pools),
      top: 0,
      viewport: { width: 20, height: 5 },
      cursor: { x: 0, y: 3, visible: false, staysVisible: false },
    }
    inline.render(emptyPrev, wideFrame, caps)

    // Width change -> 'resize'
    const narrowerFrame: RenderTargetFrame = {
      screen: makeScreenWithLines(15, ['a', 'b', 'c'], pools),
      top: 0,
      viewport: { width: 15, height: 5 },
      cursor: { x: 0, y: 3, visible: false, staysVisible: false },
    }
    const resizeRes = inline.render(wideFrame, narrowerFrame, caps)
    expect(resizeRes.cleared).toBe('resize')

    // Overflowing frame (8 rows in height-5 viewport) shrinking back into viewport (3 rows) -> 'offscreen'
    const tallFrame: RenderTargetFrame = {
      screen: makeScreenWithLines(
        15,
        ['0', '1', '2', '3', '4', '5', '6', '7'],
        pools,
      ),
      top: 0,
      viewport: { width: 15, height: 5 },
      cursor: { x: 0, y: 8, visible: false, staysVisible: false },
    }
    inline.render(narrowerFrame, tallFrame, caps)
    const shortAgain: RenderTargetFrame = {
      screen: makeScreenWithLines(15, ['0', '1', '2'], pools),
      top: 0,
      viewport: { width: 15, height: 5 },
      cursor: { x: 0, y: 3, visible: false, staysVisible: false },
    }
    const offscreenRes = inline.render(tallFrame, shortAgain, caps)
    expect(offscreenRes.cleared).toBe('offscreen')
  })

  test('Ink.shownOnMainScreen preserves frontFrame.viewport across stdout resize and merges displayCursor', () => {
    const { ink, stdout } = createTestInk(40, 10, { newRenderer: true })
    try {
      const inkInternal = ink as unknown as {
        frontFrame: { viewport: { width: number; height: number } }
        displayCursor: { x: number; y: number; emittedRows: number } | null
        shownOnMainScreen: () => RenderTargetFrame
      }
      inkInternal.frontFrame.viewport = { width: 40, height: 10 }
      inkInternal.displayCursor = { x: 7, y: 3, emittedRows: 10 }
      // Simulate terminal resize BEFORE shownOnMainScreen is called
      stdout.columns = 80
      stdout.rows = 24
      const shown = inkInternal.shownOnMainScreen()
      expect(shown.viewport).toEqual({ width: 40, height: 10 })
      expect(shown.cursor.x).toBe(7)
      expect(shown.cursor.y).toBe(3)
    } finally {
      ink.unmount()
    }
  })
})

describe('Wave 3A [P1-#9]: Ink NewRenderer lifecycle & stringWidth emoji calibrator', () => {
  test('Ink sets rootNode.popovers, wires emoji calibrator, and adjusts height on leaveNewRenderer', () => {
    const { ink } = createTestInk(30, 8, { newRenderer: true })
    try {
      const inkInternal = ink as unknown as {
        rootNode: dom.DOMElement
        frontFrame: {
          top?: number
          screen: Screen
          cursor: { x: number; y: number; visible: boolean }
          viewport: { width: number; height: number }
        }
        displayCursor: { x: number; y: number; emittedRows: number } | null
      }
      expect(inkInternal.rootNode.popovers).toBeInstanceOf(Set)

      const pools = makePools()
      inkInternal.frontFrame = {
        top: 5,
        screen: makeScreenWithLines(30, ['row0', 'row1'], pools),
        cursor: { x: 1, y: 2, visible: true },
        viewport: { width: 30, height: 8 },
      }
      inkInternal.displayCursor = { x: 1, y: 1, emittedRows: 8 }

      const left = ink.leaveNewRenderer('test_reason')
      expect(left).toBe(true)
      expect(inkInternal.rootNode.popovers).toBeUndefined()
      expect(inkInternal.frontFrame.screen.height).toBe(7) // 5 + 2
      expect(inkInternal.frontFrame.cursor.y).toBe(7) // 5 + 2
      expect(inkInternal.displayCursor?.y).toBe(6) // 5 + 1
    } finally {
      ink.unmount()
    }
  })

  test('createTerminalEmojiWidthCalibrator matches terminal profiles and null disables fallback', () => {
    const ghostty = createTerminalEmojiWidthCalibrator({
      TERM: 'xterm-ghostty',
    })
    expect(ghostty).not.toBeNull()
    const unknown = createTerminalEmojiWidthCalibrator({
      TERM: 'dumb',
      TERM_PROGRAM: 'unknown-term',
    })
    expect(unknown).toBeNull()

    // Calling with null explicitly disables custom calibrator cleanly
    setTerminalEmojiWidthCalibrator(null)
    expect(stringWidth('hello')).toBe(5)
    setTerminalEmojiWidthCalibrator(ghostty)
    expect(stringWidth('hello')).toBe(5)
  })
})

describe('Wave 3A [P1-#10]: LayoutController.recoverFromFault commits rebuilt Yoga tree & clears paintCache', () => {
  test('recoverFromFault commits rebuilt yogaNode, clears paintCache, and invalidates prevFrame', () => {
    const config = Yoga.Config.create()
    const root = dom.createNode('ink-root', config)
    const child = dom.createNode('ink-box', config)
    dom.appendChildNode(root, child)

    const oldRootYoga = root.yogaNode
    const oldChildYoga = child.yogaNode
    child.paintCache = {
      x: 0,
      y: 0,
      width: 10,
      height: 1,
      screenWidth: 40,
      colorLevel: 0,
      squeezed: false,
      top: 0,
      bottom: 1,
      shownTop: 0,
      shownBottom: 1,
      changed: undefined,
    }
    child.cachedLayout = { x: 0, y: 0, width: 10, height: 1 }

    let invalidated = 0
    const controller = new LayoutController(root, config, {
      width: () => 40,
      invalidatePrevFrame: () => {
        invalidated++
      },
      onFailed: () => {},
    })

    const recovered = controller.recoverFromFault(new Error('wasm trap'))
    expect(recovered).toBe(true)
    expect(root.yogaNode).not.toBe(oldRootYoga)
    expect(child.yogaNode).not.toBe(oldChildYoga)
    expect(child.paintCache).toBeUndefined()
    expect(child.cachedLayout).toBeUndefined()
    expect(invalidated).toBe(1)
  })
})

describe('Wave 3A [P1-#11]: reconciler wait/no, dom.setStyle stampFirstFrame, InputGate guards', () => {
  test('dom.setStyle stamps firstFrame when transitioning out of display: none', () => {
    const root = dom.createNode('ink-root')
    const frameMarker = { writtenAt: 123 }
    root.nextFrame = frameMarker
    const node = dom.createNode('ink-box')
    dom.appendChildNode(root, node)
    node.firstFrame = undefined
    dom.setStyle(node, { display: 'none' })
    expect(node.firstFrame).toBeUndefined()
    dom.setStyle(node, { display: 'flex' })
    const stamped = (node as dom.DOMElement).firstFrame
    expect(stamped).toBe(frameMarker)
  })

  test('reconciler commitUpdate updates wait and no directly on DOMElement, not attributes', () => {
    const { ink } = createTestInk(40, 10)
    try {
      const inkInternal = ink as unknown as { rootNode: dom.DOMElement }
      ink.render(
        React.createElement('ink-box', {
          wait: 100,
          no: 200,
        } as Record<string, unknown>),
      )
      const box = inkInternal.rootNode.childNodes[0] as dom.DOMElement
      expect(box.wait).toBe(100 as unknown as dom.DOMElement['wait'])
      expect(box.no).toBe(200 as unknown as dom.DOMElement['no'])
      expect('wait' in box.attributes).toBe(false)
      expect('no' in box.attributes).toBe(false)

      ink.render(
        React.createElement('ink-box', {
          wait: 350,
          no: 450,
        } as Record<string, unknown>),
      )
      expect(box.wait).toBe(350 as unknown as dom.DOMElement['wait'])
      expect(box.no).toBe(450 as unknown as dom.DOMElement['no'])
      expect('wait' in box.attributes).toBe(false)
      expect('no' in box.attributes).toBe(false)
    } finally {
      ink.unmount()
    }
  })

  test('PointerController.showsWhatInputAnswers & Ink gate click/pointer/key/paste/wheel', () => {
    const pc = new PointerController()
    expect(pc.showsWhatInputAnswers()).toBe(true)
    pc.setHost({
      isAltScreenActive: () => true,
      showsWhatInputAnswers: () => false,
    })
    expect(pc.showsWhatInputAnswers()).toBe(false)

    const { ink } = createTestInk(40, 10)
    try {
      const inkInternal = ink as unknown as {
        rootNode: dom.DOMElement
        isFrameOwed: boolean
        takesInputFrom: number
        dispatchMouseClick: (
          col: number,
          row: number,
          isWindowActivation?: boolean,
          mods?: unknown,
          pressedAt?: number,
        ) => string
        dispatchKeyboardEvent: (
          key: Record<string, unknown>,
          extras?: { soloKeypress?: boolean; pressedAt?: number },
        ) => boolean
        dispatchPasteEvent: (text: string) => void
      }
      let pasted = 0
      const keysReceived: string[] = []
      inkInternal.rootNode._eventHandlers = {
        onPaste: () => {
          pasted++
        },
        onKeyDown: (ev: { key?: string; name?: string }) => {
          keysReceived.push(ev.name ?? ev.key ?? '')
        },
      }
      inkInternal.isFrameOwed = true
      expect(inkInternal.dispatchMouseClick(0, 0)).toBe('stray')
      inkInternal.dispatchPasteEvent('hello')
      expect(pasted).toBe(0)
      // Non-way-out key dropped while !showsWhatInputAnswers(), but ctrl+c way-out is NOT dropped
      inkInternal.dispatchKeyboardEvent({
        name: 'a',
        sequence: 'a',
        ctrl: false,
        meta: false,
        shift: false,
        option: false,
      })
      expect(keysReceived).toEqual([])
      inkInternal.dispatchKeyboardEvent({
        name: 'c',
        sequence: '\x03',
        ctrl: true,
        meta: false,
        shift: false,
        option: false,
      })
      expect(keysReceived).toEqual(['c'])
      // Once frame is no longer owed and recovery hold has passed, input dispatches normally
      inkInternal.isFrameOwed = false
      inkInternal.takesInputFrom = 0
      inkInternal.dispatchPasteEvent('hello')
      expect(pasted).toBe(1)
      inkInternal.dispatchKeyboardEvent({
        name: 'a',
        sequence: 'a',
        ctrl: false,
        meta: false,
        shift: false,
        option: false,
      })
      expect(keysReceived).toEqual(['c', 'a'])
    } finally {
      ink.unmount()
    }
  })
})

describe('Wave 3A [P1-#15]: dom.collectRemovedRects drains pendingClears into parent', () => {
  test('removeChildNode propagates removed child pendingClears into parent', () => {
    const parent = dom.createNode('ink-box')
    const child = dom.createNode('ink-box')
    dom.appendChildNode(parent, child)
    child.pendingClears = [{ x: 2, y: 3, width: 5, height: 1 }]

    dom.removeChildNode(parent, child)

    expect(child.pendingClears).toBeUndefined()
    expect(parent.pendingClears).toEqual([{ x: 2, y: 3, width: 5, height: 1 }])
  })
})

describe('Wave 3A [P1-#16]: IncrementalPainter.settle skips settleScrollBoxPosition when !needsSubtreeVisit', () => {
  test('clean scrollbox returns scrollTopRendered without invoking settleScrollBoxPosition', () => {
    const root = dom.createNode('ink-root')
    const scrollBox = dom.createNode('ink-box')
    dom.setStyle(scrollBox, { overflowY: 'scroll', height: 3 })
    scrollBox.scrollTop = 10
    scrollBox.pendingScrollDelta = 5
    scrollBox.scrollTopRendered = 4

    const item = dom.createNode('ink-box')
    dom.setStyle(item, { height: 20 })
    dom.appendChildNode(scrollBox, item)
    dom.appendChildNode(root, scrollBox)

    root.yogaNode!.setWidth(20)
    root.yogaNode!.calculateLayout(20)

    const pools = makePools()
    const s1 = createScreen(
      20,
      3,
      pools.stylePool,
      pools.charPool,
      pools.hyperlinkPool,
    )
    const out = new Output({
      width: 20,
      height: 3,
      stylePool: pools.stylePool,
      screen: s1,
    })
    const painter = new IncrementalPainter(
      out,
      createRenderFrameContext(),
      pools.stylePool,
    )
    // First paint populates clean paintCache
    painter.paint(root, s1, 0, false)

    // Now set pendingScrollDelta WITHOUT marking dirty (simulating clean subtree skip)
    scrollBox.pendingScrollDelta = 7
    scrollBox.scrollTopRendered = 4

    const s2 = createScreen(
      20,
      3,
      pools.stylePool,
      pools.charPool,
      pools.hyperlinkPool,
    )
    out.reset(20, 3, s2)
    painter.paint(root, s2, 0, false)

    // Because !needsSubtreeVisit, settle() skipped settleScrollBoxPosition!
    expect(scrollBox.pendingScrollDelta).toBe(7)
    expect(scrollBox.scrollTopRendered).toBe(4)
  })
})

describe('Wave 3A [P2-#4, #5, #6, #8]: Output, resetPools, OverlayController, render-node-to-output', () => {
  test('[P2-#4] Output calls checkRightEdgeOf on width-mismatched blit & shift, and applies direction in paintWrite', () => {
    const pools = makePools()
    const src = createScreen(
      10,
      1,
      pools.stylePool,
      pools.charPool,
      pools.hyperlinkPool,
    )
    setCellAt(src, 7, 0, {
      char: '漢',
      styleId: 0,
      width: CellWidth.Wide,
      hyperlink: undefined,
    })
    const dst = createScreen(
      8,
      2,
      pools.stylePool,
      pools.charPool,
      pools.hyperlinkPool,
    )
    const out = new Output({
      width: 8,
      height: 2,
      stylePool: pools.stylePool,
      screen: dst,
    })
    out.blit(src, 0, 0, 8, 1)
    out.get()
    expect(out.rowsAtRightEdge.has(0)).toBe(true)

    const dst2 = createScreen(
      8,
      2,
      pools.stylePool,
      pools.charPool,
      pools.hyperlinkPool,
    )
    setCellAt(dst2, 7, 0, {
      char: '漢',
      styleId: 0,
      width: CellWidth.Wide,
      hyperlink: undefined,
    })
    const out2 = new Output({
      width: 8,
      height: 2,
      stylePool: pools.stylePool,
      screen: dst2,
    })
    out2.shift(0, 1, 1)
    out2.get()
    expect(out2.rowsAtRightEdge.has(1)).toBe(true)

    // WriteOperation.direction forwarded under software bidi
    const prevWt = process.env.WT_SESSION
    process.env.WT_SESSION = '1'
    try {
      const dst3 = createScreen(
        10,
        1,
        pools.stylePool,
        pools.charPool,
        pools.hyperlinkPool,
      )
      const out3 = new Output({
        width: 10,
        height: 1,
        stylePool: pools.stylePool,
        screen: dst3,
      })
      out3.writeLines(0, 0, ['אב 12'], undefined, 'rtl')
      out3.get()
      const rowText = Array.from(
        { length: 10 },
        (_, x) => pools.charPool.get(dst3.cells[x * 2]!) ?? ' ',
      )
        .join('')
        .trim()
      expect(rowText.length).toBeGreaterThan(0)
    } finally {
      if (prevWt === undefined) delete process.env.WT_SESSION
      else process.env.WT_SESSION = prevWt
    }
  })

  test('[P2-#5] Ink.resetPools preserves charPool and only resets hyperlinkPool when > 4096', () => {
    const { ink } = createTestInk(20, 5)
    try {
      const inkInternal = ink as unknown as {
        charPool: CharPool
        hyperlinkPool: HyperlinkPool
        resetPools: () => void
      }
      const initialLinkSize = inkInternal.hyperlinkPool.size
      const charId = inkInternal.charPool.intern('★')
      inkInternal.hyperlinkPool.intern('https://example.com')
      expect(inkInternal.hyperlinkPool.size).toBe(initialLinkSize + 1)

      inkInternal.resetPools()
      // charPool MUST remain intact!
      expect(inkInternal.charPool.get(charId)).toBe('★')
      // hyperlinkPool <= 4096 MUST NOT be cleared!
      expect(inkInternal.hyperlinkPool.size).toBe(initialLinkSize + 1)

      for (let i = 0; i < 4100; i++) {
        inkInternal.hyperlinkPool.intern(`https://example.com/${i}`)
      }
      expect(inkInternal.hyperlinkPool.size).toBeGreaterThan(4096)
      inkInternal.resetPools()
      expect(inkInternal.hyperlinkPool.size).toBe(initialLinkSize)
      expect(inkInternal.charPool.get(charId)).toBe('★')
    } finally {
      ink.unmount()
    }
  })

  test('[P2-#6] OverlayController owns hoverLinkAt / clearHoveredLink / clearLinkUnderline', () => {
    let scheduled = 0
    const root = dom.createNode('ink-root')
    const pools = makePools()
    const screen = makeScreenWithLines(10, ['click'], pools)
    for (let x = 0; x < 5; x++) {
      setCellAt(screen, x, 0, {
        char: 'click'[x]!,
        styleId: 0,
        width: CellWidth.Narrow,
        hyperlink: 'https://example.com',
      })
    }
    const oc = new OverlayController(root, pools.stylePool, {
      screen: () => screen,
      isAltScreenActive: () => true,
      scheduleRender: () => {
        scheduled++
      },
    })

    oc.hoverLinkAt(1, 0, true)
    expect(oc.hoveredLink).toBe('https://example.com')
    expect(scheduled).toBe(1)
    oc.paint(screen, 1, 0)
    expect(oc.hoveredLinkSpans.length).toBeGreaterThan(0)

    oc.clearLinkUnderline()
    expect(oc.hoveredLinkSpans).toEqual([])
    oc.clearHoveredLink()
    expect(oc.hoveredLink).toBeUndefined()
    expect(scheduled).toBe(2)
  })

  test('[P2-#8] render-node-to-output sets paintsPastRect on narrow/zero-height bordered box (ZM)', () => {
    const root = dom.createNode('ink-root')
    const box = dom.createNode('ink-box')
    dom.setStyle(box, { borderStyle: 'single', width: 1, height: 2 })
    dom.appendChildNode(root, box)
    root.yogaNode!.setWidth(10)
    root.yogaNode!.calculateLayout(10)

    const pools = makePools()
    const screen = createScreen(
      10,
      4,
      pools.stylePool,
      pools.charPool,
      pools.hyperlinkPool,
    )
    const out = new Output({
      width: 10,
      height: 4,
      stylePool: pools.stylePool,
      screen,
    })
    renderNodeToOutput(root, out, createRenderFrameContext(), {
      prevScreen: undefined,
    })
    expect(box.paintsPastRect).toBe(true)
  })
})
