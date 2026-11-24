import { afterEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import React, { Component, type ReactNode } from 'react'
import Box from '../../components/Box.js'
import ScrollBox, { type ScrollBoxHandle } from '../../components/ScrollBox.js'
import Text from '../../components/Text.js'
import { TerminalSizeContext } from '../../components/TerminalSizeContext.js'
import useInput from '../../hooks/use-input.js'
import {
  computeElementClippedViewportVisibility,
  computeElementViewportVisibility,
  useTerminalViewport,
} from '../../hooks/use-terminal-viewport.js'
import {
  KeybindingSetup,
  type KeybindingSetupProps,
} from '../../keybindings/KeybindingSetup.js'
import type { ParsedBinding } from '../../keybindings/types.js'
import * as dom from '../dom.js'
import { KeyboardEvent } from '../events/keyboard-event.js'
import { FrameScheduler } from '../frame-scheduler.js'
import Ink from '../ink.js'
import {
  bindInkSessionHost,
  Ns,
  resetInkSessionHostForTests,
} from '../instances.js'
import {
  createKeyReader,
  flushKeys,
  keyReaderHasPending,
  readKeys,
} from '../keyReader.js'
import { LayoutEdge } from '../layout/node.js'
import {
  createNewRenderers,
  getTerminalRenderCapabilities,
  type RenderTargetFrame,
} from '../new-renderer.js'
import Output from '../output.js'
import { INITIAL_STATE, parseMultipleKeypresses } from '../parse-keypress.js'
import { removeChildAndCleanup } from '../reconciler.js'
import renderNodeToOutput, {
  createRenderFrameContext,
} from '../render-node-to-output.js'
import {
  CellWidth,
  CharPool,
  cellAt,
  createScreen,
  HyperlinkPool,
  type Screen,
  StylePool,
  setCellAt,
} from '../screen.js'
import type { Styles } from '../styles.js'
import { TerminalQuerier } from '../terminal-querier.js'

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
  opts?: { newRenderer?: boolean; onBeforeRender?: () => void },
) {
  const { stdout, chunks } = createFakeTtyStdout(columns, rows)
  const stdin = createFakeStdin()
  const ink = new Ink({
    stdout,
    stdin,
    stderr: stdout,
    exitOnCtrlC: false,
    patchConsole: false,
    newRenderer: opts?.newRenderer,
    onBeforeRender: opts?.onBeforeRender,
  })
  return { ink, stdout, stdin, chunks }
}

function makeScreenWithLines(
  width: number,
  lines: string[],
  pools: {
    stylePool: StylePool
    charPool: CharPool
    hyperlinkPool: HyperlinkPool
  },
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

afterEach(() => {
  resetInkSessionHostForTests()
})

describe('UI Data-Flow Audit — @ant/ink 12 verified fixes', () => {
  test('1. P0-D6-1: StylePool.compact() clears underlineCache and Output invalidates LineCells keptLines/styleIds on stylePool.generation change', () => {
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()

    // Intern red, green, blue so blue gets a higher styleId
    const red = stylePool.intern([
      { type: 'ansi', code: '\x1b[31m', endCode: '\x1b[39m' },
    ])
    const green = stylePool.intern([
      { type: 'ansi', code: '\x1b[32m', endCode: '\x1b[39m' },
    ])
    const blue = stylePool.intern([
      { type: 'ansi', code: '\x1b[34m', endCode: '\x1b[39m' },
    ])
    expect(red).not.toBe(blue)
    expect(green).not.toBe(blue)

    // Populate underlineCache before compaction
    const underlinedBlueBefore = stylePool.withUnderline(blue)
    expect(
      stylePool.get(underlinedBlueBefore).some(c => c.code === '\x1b[4m'),
    ).toBe(true)

    // Populate Output.lineCells.keptLines with blue line
    const screen1 = createScreen(10, 1, stylePool, charPool, hyperlinkPool)
    const output = new Output({
      width: 10,
      height: 1,
      stylePool,
      screen: screen1,
    })
    output.write(0, 0, '\x1b[34mhello\x1b[39m')
    const painted1 = output.get()
    const oldCellStyleId = cellAt(painted1, 0, 0)!.styleId
    expect(stylePool.get(oldCellStyleId).map(c => c.code)).toEqual(['\x1b[34m'])
    expect(output.lineCells.kept('\x1b[34mhello\x1b[39m')).toBeDefined()

    // Compact StylePool and allocate a DIFFERENT style (yellow) at the first slot
    stylePool.compact()
    const yellow = stylePool.intern([
      { type: 'ansi', code: '\x1b[33m', endCode: '\x1b[39m' },
    ])
    const blueAfter = stylePool.intern([
      { type: 'ansi', code: '\x1b[34m', endCode: '\x1b[39m' },
    ])
    expect(yellow).not.toBe(blueAfter)

    // underlineCache MUST have been cleared on compact(), otherwise calling
    // withUnderline(yellow) (whose numeric ID collides with old red/blue) would
    // return the stale pre-compaction ID!
    const underlinedYellow = stylePool.withUnderline(yellow)
    const yellowUnderlineCodes = stylePool
      .get(underlinedYellow)
      .map(c => c.code)
    expect(yellowUnderlineCodes).toContain('\x1b[33m')
    expect(yellowUnderlineCodes).toContain('\x1b[4m')
    expect(yellowUnderlineCodes).not.toContain('\x1b[34m')

    // Case A: Output.get() -> lineCells.startFrame() detects generation bump and invalidates keptLines/styleIds
    const screen2 = createScreen(10, 1, stylePool, charPool, hyperlinkPool)
    output.reset(10, 1, screen2)
    output.write(0, 0, '\x1b[34mhello\x1b[39m')
    const painted2 = output.get()
    const newCellStyleId = cellAt(painted2, 0, 0)!.styleId
    expect(newCellStyleId).toBe(blueAfter)
    expect(stylePool.get(newCellStyleId).map(c => c.code)).toEqual(['\x1b[34m'])

    // Case B: Compaction between reset() and get() ALSO invalidates LineCells caches
    const screen3 = createScreen(10, 1, stylePool, charPool, hyperlinkPool)
    output.reset(10, 1, screen3)
    stylePool.compact()
    // Intern magenta first so blue gets a brand-new ID
    stylePool.intern([{ type: 'ansi', code: '\x1b[35m', endCode: '\x1b[39m' }])
    output.write(0, 0, '\x1b[34mhello\x1b[39m')
    const painted3 = output.get()
    expect(
      stylePool.get(cellAt(painted3, 0, 0)!.styleId).map(c => c.code),
    ).toEqual(['\x1b[34m'])
  })

  test('2. P0-D6-2: Official FrameScheduler (xm) drains queued microtasks without dropping frames, respects input priority and backlog hold', async () => {
    let now = 100
    let queuedBytes = 0
    let frames = 0
    const sched = new FrameScheduler(
      () => {
        frames++
      },
      () => queuedBytes,
      () => now,
    )

    // Queue microtask M1; duplicate scheduleFrame() while queued coalesces
    sched.scheduleFrame()
    sched.scheduleFrame()
    await Promise.resolve()
    expect(frames).toBe(1)

    // Scheduling a new frame after pacing interval fires cleanly (no stuck flag)
    now += 20
    sched.scheduleFrame()
    await Promise.resolve()
    expect(frames).toBe(2)

    // Input priority reduces interval to 4ms
    sched.requestInputPriorityFrame()
    now += 5
    sched.scheduleFrame()
    await Promise.resolve()
    expect(frames).toBe(3)

    // Backlog holds frame; releaseHeldFrame() resumes cleanly once drained
    queuedBytes = 32768
    now += 20
    sched.scheduleFrame()
    expect(sched.isHeldForBacklog).toBe(true)
    await Promise.resolve()
    expect(frames).toBe(3)

    queuedBytes = 0
    sched.releaseHeldFrame()
    expect(sched.isHeldForBacklog).toBe(false)
    await Promise.resolve()
    expect(frames).toBe(4)

    // cancelAll() clears timers and backlog state cleanly
    queuedBytes = 32768
    now += 20
    sched.scheduleFrame()
    expect(sched.isHeldForBacklog).toBe(true)
    sched.cancelAll()
    expect(sched.isHeldForBacklog).toBe(false)
  })

  test('3. P0-D6-3: Ink.drawFrame() rolls back via onRender() without falling through to LogUpdate on renderToBytes() error', () => {
    // (a) Single transient error in renderToBytes(): rolls back via takeBackUnwrittenFrame
    // and succeeds on immediate synchronous retry without ever calling LogUpdate.render!
    const { ink } = createTestInk(40, 10, { newRenderer: true })
    try {
      const inkInternal = ink as unknown as {
        log: { render: (...args: unknown[]) => unknown }
        renderToBytes: (...args: unknown[]) => unknown
        renderers: unknown
        unwritten: unknown
      }

      ink.render(React.createElement(Text, null, 'hello world'))

      let logRenderCalls = 0
      inkInternal.log.render = () => {
        logRenderCalls++
        return []
      }

      const origRenderToBytes = inkInternal.renderToBytes.bind(ink)
      let attempts = 0
      inkInternal.renderToBytes = (...args: unknown[]) => {
        attempts++
        if (attempts === 1) {
          throw new Error('transient byte renderer error')
        }
        return origRenderToBytes(...args)
      }

      expect(() => ink.onRender()).not.toThrow()
      expect(attempts).toBe(2)
      expect(logRenderCalls).toBe(0)
      expect(inkInternal.renderers).toBeDefined()
      expect(inkInternal.unwritten).toBeUndefined()
    } finally {
      ink.unmount()
    }

    // (b) Persistent error in renderToBytes(): never falls through to LogUpdate,
    // schedules retries, and throws after exceeding official MAX_UNWRITTEN_RETRIES (p2 = 2)
    const { ink: ink2 } = createTestInk(40, 10, { newRenderer: true })
    try {
      const ink2Internal = ink2 as unknown as {
        log: { render: (...args: unknown[]) => unknown }
        renderToBytes: (...args: unknown[]) => unknown
        scheduleRender: () => void
        prevFrameContaminated: boolean
        unwritten: { tries: number; isLost: boolean } | undefined
      }
      ink2.render(React.createElement(Text, null, 'keep safe'))

      let logRenderCalls = 0
      ink2Internal.log.render = () => {
        logRenderCalls++
        return []
      }
      let scheduled = 0
      ink2Internal.scheduleRender = () => {
        scheduled++
      }
      ink2Internal.prevFrameContaminated = false
      ink2Internal.renderToBytes = () => {
        throw new Error('persistent byte renderer crash')
      }

      // 1st onRender: fails -> immediate retry fails (tries=1) -> schedules async retry
      expect(() => ink2.onRender()).not.toThrow()
      expect(logRenderCalls).toBe(0)
      expect(scheduled).toBe(1)
      expect(ink2Internal.unwritten?.tries).toBe(1)

      // 2nd onRender: fails (tries=2 <= p2=2) -> schedules async retry
      expect(() => ink2.onRender()).not.toThrow()
      expect(scheduled).toBe(2)
      expect(ink2Internal.unwritten?.tries).toBe(2)

      // 3rd onRender: fails (tries=3 > p2=2) -> restores wasContaminated & rethrows
      expect(() => ink2.onRender()).toThrow('persistent byte renderer crash')
      expect(logRenderCalls).toBe(0)
      expect(ink2Internal.prevFrameContaminated).toBe(false)
    } finally {
      ink2.unmount()
    }
  })

  test('4. P1-D6-1: parseMultipleKeypresses resets IN_PASTE on empty paste timeout flush and stops KeyReader timer', () => {
    // Empty PASTE_START followed by timeout flush
    const [k1, s1] = parseMultipleKeypresses({ ...INITIAL_STATE }, '\x1b[200~')
    expect(k1).toEqual([])
    expect(s1.mode).toBe('IN_PASTE')
    expect(s1.pasteBuffer).toBe('')

    const [k2, s2] = parseMultipleKeypresses(s1, null)
    expect(k2).toEqual([])
    expect(s2.mode).toBe('NORMAL')
    expect(s2.pasteBuffer).toBe('')

    // Subsequent typing must parse as normal keypresses, not get trapped in pasteBuffer
    const [k3, s3] = parseMultipleKeypresses(s2, 'a')
    expect(s3.mode).toBe('NORMAL')
    expect(k3.length).toBe(1)
    expect(k3[0]?.kind).toBe('key')
    if (k3[0]?.kind === 'key') {
      expect(k3[0].name).toBe('a')
    }

    // KeyReader must not stay pending (no infinite 2s flush loop)
    const r0 = createKeyReader(0)
    const r1 = readKeys(r0, '\x1b[200~', 100)
    expect(keyReaderHasPending(r1.reader)).toBe(true)
    const r2 = flushKeys(r1.reader, 2100)
    expect(r2.keys).toEqual([])
    expect(keyReaderHasPending(r2.reader)).toBe(false)
    expect(r2.wakeAt).toBeNull()

    // Non-empty paste flush still emits buffered text and resets to NORMAL
    const [, p1] = parseMultipleKeypresses({ ...INITIAL_STATE }, '\x1b[200~abc')
    const [pKeys, p2] = parseMultipleKeypresses(p1, null)
    expect(pKeys).toEqual([{ kind: 'paste', text: 'abc' }])
    expect(p2.mode).toBe('NORMAL')
    expect(p2.pasteBuffer).toBe('')
  })

  test('5. P1-D6-2: ScrollBox.scrollTo() and scrollToBottom() leave scrollTopRendered for paint-time clamping', () => {
    const { ink } = createTestInk(20, 5)
    try {
      const ref = React.createRef<ScrollBoxHandle>()
      const lines = Array.from({ length: 20 }, (_, i) =>
        React.createElement(Text, { key: i }, `line-${i}`),
      )
      ink.render(
        React.createElement(
          ScrollBox,
          { ref, flexDirection: 'column', height: 5, stickyScroll: false },
          ...lines,
        ),
      )

      const handle = ref.current!
      const el = handle.getDomElement()!
      const rootNode = (ink as unknown as { rootNode: dom.DOMElement }).rootNode
      rootNode.yogaNode!.setWidth(20)
      rootNode.yogaNode!.setHeight(5)
      rootNode.yogaNode!.calculateLayout(20, 5)

      const pools = {
        stylePool: new StylePool(),
        charPool: new CharPool(),
        hyperlinkPool: new HyperlinkPool(),
      }
      const paint = () => {
        const screen = createScreen(
          20,
          5,
          pools.stylePool,
          pools.charPool,
          pools.hyperlinkPool,
        )
        const out = new Output({
          width: 20,
          height: 5,
          stylePool: pools.stylePool,
          screen,
        })
        const ctx = createRenderFrameContext()
        renderNodeToOutput(rootNode, out, ctx, { prevScreen: undefined })
        return ctx
      }

      // First paint sets scrollTopRendered = 0
      paint()
      expect(el.scrollTopRendered).toBe(0)

      // ModalScroller pattern: scrollTo(Number.MAX_SAFE_INTEGER)
      handle.scrollTo(Number.MAX_SAFE_INTEGER)
      // Must NOT eagerly overwrite scrollTopRendered with Number.MAX_SAFE_INTEGER
      expect(el.scrollTopRendered).toBe(0)
      const ctxEnd = paint()
      // True clamped delta is maxScroll (15) - 0 = +15, NOT -9e15!
      expect(el.scrollTopRendered).toBe(15)
      expect(ctxEnd.followScroll?.delta).toBe(15)

      // In-range scrollTo(5) must preserve previous scrollTopRendered (15) until paint
      handle.scrollTo(5)
      expect(el.scrollTopRendered).toBe(15)
      const ctxMid = paint()
      expect(el.scrollTopRendered).toBe(5)
      expect(ctxMid.followScroll?.delta).toBe(-10)

      // Non-sticky scrollToBottom() must preserve previous scrollTopRendered (5) until paint
      handle.scrollToBottom()
      expect(el.scrollTopRendered).toBe(5)
      const ctxBottom = paint()
      expect(el.scrollTopRendered).toBe(15)
      expect(ctxBottom.followScroll?.delta).toBe(10)
    } finally {
      ink.unmount()
    }
  })

  test('6. P1-D6-3: FullscreenRenderer.invalidate() without reason actively invalidates and erases blank rows/margins on next render', () => {
    const pools = {
      stylePool: new StylePool(),
      charPool: new CharPool(),
      hyperlinkPool: new HyperlinkPool(),
    }
    const { fullscreen } = createNewRenderers(pools.stylePool)
    const caps = getTerminalRenderCapabilities()

    const frame: RenderTargetFrame = {
      screen: makeScreenWithLines(10, ['alpha', '', 'gamma'], pools),
      top: 0,
      viewport: { width: 10, height: 3 },
      cursor: { x: 0, y: 0, visible: false, staysVisible: false },
    }
    fullscreen.render(frame, caps)
    fullscreen.frameWasWritten()

    // Ink.repaint() calls fullscreen.invalidate() with NO reason
    fullscreen.invalidate()
    const afterRepaint = fullscreen.render(frame, caps)
    expect(afterRepaint.cleared).toBeUndefined()
    expect(afterRepaint.hasChanges).toBe(true)
    expect(afterRepaint.bytes).toContain('alpha')
    expect(afterRepaint.bytes).toContain('gamma')
    // Must emit EL (\x1b[K) to actively erase blank row 1 and trailing margins!
    expect(afterRepaint.bytes).toContain('\x1b[K')
    fullscreen.frameWasWritten()

    // Even an entirely blank screen must actively erase every row after invalidate()
    const blankFrame: RenderTargetFrame = {
      screen: makeScreenWithLines(10, ['', '', ''], pools),
      top: 0,
      viewport: { width: 10, height: 3 },
      cursor: { x: 0, y: 0, visible: false, staysVisible: false },
    }
    fullscreen.invalidate()
    const blankAfterRepaint = fullscreen.render(blankFrame, caps)
    expect(blankAfterRepaint.hasChanges).toBe(true)
    const elCount = blankAfterRepaint.bytes.split('\x1b[K').length - 1
    expect(elCount).toBe(3)
  })

  test('7. P1-D6-4: reconciler avoids render-phase rawModeEnabledCount leak, guards focusManager-less removeChild, and handles style === undefined', () => {
    // (a) Aborted render (thrown inside ErrorBoundary) must NOT leak rawModeEnabledCount!
    const { ink } = createTestInk(40, 10)
    try {
      const inkInternal = ink as unknown as {
        rootNode: dom.DOMElement
        appRef: { current: { rawModeEnabledCount: number } | null }
      }
      const rootNode = inkInternal.rootNode

      class Boundary extends Component<
        { children: ReactNode },
        { failed: boolean }
      > {
        state = { failed: false }
        static getDerivedStateFromError() {
          return { failed: true }
        }
        render() {
          return this.state.failed
            ? React.createElement(Text, null, 'fallback')
            : this.props.children
        }
      }

      const Thrower = () => {
        throw new Error('render abort')
      }

      // First render: sibling with onKeyDown is created before Thrower throws
      ink.render(
        React.createElement(
          Boundary,
          null,
          React.createElement(Box, { onKeyDown: () => {} }),
          React.createElement(Thrower),
        ),
      )
      expect(inkInternal.appRef.current?.rawModeEnabledCount ?? 0).toBe(0)

      // Now mount a committed Box with onKeyDown -> +1; update/remove -> 0
      ink.render(React.createElement(Box, { key: 'live', onKeyDown: () => {} }))
      expect(inkInternal.appRef.current?.rawModeEnabledCount).toBe(1)

      // Removing style prop (commitUpdate style === undefined) must NOT throw TypeError
      ink.render(
        React.createElement('ink-box', {
          key: 'styled',
          style: { position: 'absolute', padding: 1 },
        } as Record<string, unknown>),
      )
      expect(() =>
        ink.render(
          React.createElement('ink-box', {
            key: 'styled',
          } as Record<string, unknown>),
        ),
      ).not.toThrow()
      const styledNode = rootNode.childNodes[0] as dom.DOMElement
      expect(styledNode.style).toEqual({})

      // Unmounting all onKeyDown boxes brings rawModeEnabledCount cleanly back to 0
      ink.render(React.createElement(Text, null, 'done'))
      expect(inkInternal.appRef.current?.rawModeEnabledCount).toBe(0)
    } finally {
      ink.unmount()
    }

    // (b) dom.setStyle(node, undefined) must not throw
    const box = dom.createNode('ink-box')
    dom.setStyle(box, { position: 'absolute' })
    expect(() =>
      dom.setStyle(box, undefined as unknown as Styles),
    ).not.toThrow()
    expect(box.style).toEqual({})

    // (c) removeChildAndCleanup on a focusManager-less tree must not throw
    const detachedParent = dom.createNode('ink-box')
    const detachedChild = dom.createNode('ink-box')
    dom.appendChildNode(detachedParent, detachedChild)
    expect(() =>
      removeChildAndCleanup(detachedParent, detachedChild),
    ).not.toThrow()
    expect(detachedParent.childNodes).toEqual([])
    expect(detachedChild.yogaNode).toBeUndefined()
  })

  test('8. P2-D6-8: Official two-point beginFrame() protects handleResize/layout in newRenderer and clears unwritten on failedLayouts early return', () => {
    // (a) Legacy mode (newRenderer: false): beginFrame() is a no-op
    let unwrittenDuringBeforeRender: unknown = 'unset'
    let inkRef: Ink | undefined
    const { ink } = createTestInk(40, 10, {
      onBeforeRender: () => {
        unwrittenDuringBeforeRender = (
          inkRef as unknown as { unwritten: unknown }
        ).unwritten
      },
    })
    inkRef = ink
    try {
      const inkInternal = ink as unknown as {
        layout: { failedLayouts: number; runLayoutPass: () => void }
        unwritten: unknown
      }
      inkInternal.layout.failedLayouts = 1
      inkInternal.layout.runLayoutPass = () => {}

      ink.onRender()
      expect(unwrittenDuringBeforeRender).toBeUndefined()
      expect(inkInternal.unwritten).toBeUndefined()
    } finally {
      ink.unmount()
    }

    // (b) newRenderer mode: entry beginFrame() sets unwritten before onBeforeRender
    // and layout/resize (enabling rollback if runLayoutPass throws), and onRender()
    // clears unwritten when failedLayouts > 0 returns cleanly without throwing.
    let newRendererUnwrittenAtBeforeRender: unknown = 'unset'
    let ink2Ref: Ink | undefined
    const { ink: ink2 } = createTestInk(40, 10, {
      newRenderer: true,
      onBeforeRender: () => {
        newRendererUnwrittenAtBeforeRender = (
          ink2Ref as unknown as { unwritten: unknown }
        ).unwritten
      },
    })
    ink2Ref = ink2
    try {
      const ink2Internal = ink2 as unknown as {
        layout: { failedLayouts: number; runLayoutPass: () => void }
        unwritten: unknown
      }
      ink2Internal.layout.failedLayouts = 1
      ink2Internal.layout.runLayoutPass = () => {}

      ink2.onRender()
      expect(newRendererUnwrittenAtBeforeRender).toBeDefined()
      expect(ink2Internal.unwritten).toBeUndefined()
    } finally {
      ink2.unmount()
    }
  })

  test('9. P2-D6-9: Ink.unmount() uses dynamic Ns(), identity-checks stdout deletion, preserves treeRoots, and frees ownTree Yoga nodes', () => {
    const customHost = {}
    bindInkSessionHost(() => customHost)

    const { stdout } = createFakeTtyStdout(40, 10)
    const stdin = createFakeStdin()

    // (a) InkInstancesMap.delete() must NOT wipe treeRoots
    const inkTree = new Ink({
      stdout,
      stdin,
      stderr: stdout,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    const treeApi = inkTree.tree()
    const treeRoot = (inkTree as unknown as { rootNode: dom.DOMElement })
      .rootNode
    const box = treeApi.box()
    const label = treeApi.text('hello')
    treeApi.append(treeRoot, box)
    treeApi.append(box, label)
    expect(Ns().treeRoots.get(stdout)).toBe(inkTree)

    const inkReact1 = new Ink({
      stdout,
      stdin,
      stderr: stdout,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    Ns().set(stdout, inkReact1)
    Ns().delete(stdout)
    // Deleting the React root must NOT wipe the separate treeRoots entry!
    expect(Ns().treeRoots.get(stdout)).toBe(inkTree)

    // (b) Identity check: unmounting an older Ink instance must NOT delete a newer occupant from Ns()
    const inkReact2 = new Ink({
      stdout,
      stdin,
      stderr: stdout,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    Ns().set(stdout, inkReact2)
    inkReact1.unmount()
    expect(Ns().get(stdout)).toBe(inkReact2)
    expect(Ns().treeRoots.get(stdout)).toBe(inkTree)

    inkReact2.unmount()
    expect(Ns().get(stdout)).toBeUndefined()
    expect(Ns().treeRoots.get(stdout)).toBe(inkTree)

    // (c) Unmounting ownTree Ink instance frees child Yoga nodes and deletes its own treeRoots entry
    expect(box.yogaNode).toBeDefined()
    expect(label.yogaNode).toBeDefined()
    inkTree.unmount()
    expect(Ns().treeRoots.get(stdout)).toBeUndefined()
    expect(box.yogaNode).toBeUndefined()
    expect(label.yogaNode).toBeUndefined()
    expect(
      (inkTree as unknown as { rootNode: dom.DOMElement }).rootNode.yogaNode,
    ).toBeUndefined()
  })

  test('10. P2-D6-10 / P1-2: probeExternalClear() sends only CPR (no DA1 sentinel / owed() leak) and cancels pending query on AbortSignal', async () => {
    const { ink } = createTestInk(40, 10)
    try {
      const inkInternal = ink as unknown as {
        altScreenActive: boolean
        displayCursor: { x: number; y: number; emittedRows: number } | null
        forceRedraw: () => boolean
      }
      inkInternal.altScreenActive = true
      inkInternal.displayCursor = { x: 0, y: 5, emittedRows: 10 }
      let redraws = 0
      inkInternal.forceRedraw = () => {
        redraws++
        return true
      }

      const writes: string[] = []
      const fakeOut = {
        write(s: string) {
          writes.push(s)
          return true
        },
      } as unknown as NodeJS.WriteStream
      const querier = new TerminalQuerier(fakeOut)
      querier.setInputAttached(true)

      // (a) Official 2.1.328: writes ONLY CSI ? 6 n (never DA1 sentinel \x1b[c]) so owed() stays 0
      const ac = new AbortController()
      const abortedProbe = ink.probeExternalClear(querier, ac.signal)
      expect(writes).toEqual(['\x1b[?6n'])
      expect(querier.owed()).toBe(0)

      // Aborting cancels the pending query immediately so probe resolves false without leaking
      ac.abort()
      expect(await abortedProbe).toBe(false)
      expect(redraws).toBe(0)
      expect(querier.owed()).toBe(0)
      // Stale cursorPosition reply after cancel is NOT matched by a leaked query
      expect(
        querier.onResponse({ type: 'cursorPosition', row: 1, col: 1 }),
      ).toBe(false)

      // (b) Normal non-wipe CPR reply (row > 1) resolves false without forceRedraw
      const okProbe = ink.probeExternalClear(querier)
      expect(querier.owed()).toBe(0)
      expect(
        querier.onResponse({ type: 'cursorPosition', row: 6, col: 1 }),
      ).toBe(true)
      expect(await okProbe).toBe(false)
      expect(redraws).toBe(0)

      // (c) Wipe detected (row === 1) triggers forceRedraw and keeps owed() === 0
      const wipeProbe = ink.probeExternalClear(querier)
      expect(querier.owed()).toBe(0)
      expect(
        querier.onResponse({ type: 'cursorPosition', row: 1, col: 1 }),
      ).toBe(true)
      expect(await wipeProbe).toBe(true)
      expect(redraws).toBe(1)
      expect(querier.owed()).toBe(0)
    } finally {
      ink.unmount()
    }
  })

  test('11. P2-D6-11: useTerminalViewport().pureCheck intersects ancestor ScrollBox and overflow:hidden clip bounds', () => {
    const makeNode = (opts: {
      top: number
      height: number
      parent?: dom.DOMElement
      style?: Styles
      scrollTop?: number
      scrollTopRendered?: number
      scrollHeight?: number
      scrollViewportHeight?: number
      borderTop?: number
      borderBottom?: number
      paddingTop?: number
      paddingBottom?: number
    }): dom.DOMElement => {
      const yoga = {
        getComputedTop: () => opts.top,
        getComputedHeight: () => opts.height,
        getComputedBorder: (edge: LayoutEdge) =>
          edge === LayoutEdge.Top
            ? (opts.borderTop ?? 0)
            : edge === LayoutEdge.Bottom
              ? (opts.borderBottom ?? 0)
              : 0,
        getComputedPadding: (edge: LayoutEdge) =>
          edge === LayoutEdge.Top
            ? (opts.paddingTop ?? 0)
            : edge === LayoutEdge.Bottom
              ? (opts.paddingBottom ?? 0)
              : 0,
      }
      return {
        yogaNode: yoga as unknown as dom.DOMElement['yogaNode'],
        parentNode: opts.parent,
        style: opts.style ?? {},
        scrollTop: opts.scrollTop,
        scrollTopRendered: opts.scrollTopRendered,
        scrollHeight: opts.scrollHeight,
        scrollViewportHeight: opts.scrollViewportHeight,
      } as unknown as dom.DOMElement
    }

    const size = { rows: 24 }
    const root = makeNode({ top: 0, height: 24 })
    const scrollBox = makeNode({
      top: 0,
      height: 10,
      parent: root,
      style: { overflowY: 'scroll' },
      scrollTop: 0,
      scrollTopRendered: 0,
      scrollHeight: 50,
      scrollViewportHeight: 8,
      borderTop: 1,
      borderBottom: 1,
      paddingTop: 1,
      paddingBottom: 1,
    })
    const content = makeNode({ top: 0, height: 50, parent: scrollBox })
    const item = makeNode({ top: 20, height: 2, parent: content })

    // Unclipped terminal viewport thinks row 20 is inside 24-row terminal -> true
    expect(computeElementViewportVisibility(item, size)).toBe(true)
    // Clipped visibility sees row 20 is below the 10-row ScrollBox -> null
    expect(computeElementClippedViewportVisibility(item, size)).toBe(null)

    // Scroll into ScrollBox visible padding box [2..8): 20 - 15 = 5 -> visible!
    scrollBox.scrollTop = 15
    scrollBox.scrollTopRendered = 15
    expect(computeElementClippedViewportVisibility(item, size)).toBe(true)

    // Scroll past top border+padding: 20 - 20 = 0, item ends at 2 <= borderTop(1)+paddingTop(1) -> null
    scrollBox.scrollTop = 20
    scrollBox.scrollTopRendered = 20
    expect(computeElementClippedViewportVisibility(item, size)).toBe(null)

    // Stale scrollHeight (content grew from 50 to 60 before repaint) -> null
    scrollBox.scrollTop = 15
    scrollBox.scrollTopRendered = 15
    scrollBox.scrollHeight = 40
    expect(computeElementClippedViewportVisibility(item, size)).toBe(null)

    // overflow: hidden ancestor clips children outside [borderTop, height - borderBottom)
    const hiddenBox = makeNode({
      top: 0,
      height: 5,
      parent: root,
      style: { overflowY: 'hidden' },
      borderTop: 1,
      borderBottom: 1,
    })
    const clippedHiddenChild = makeNode({
      top: 4,
      height: 2,
      parent: hiddenBox,
    })
    const visibleHiddenChild = makeNode({
      top: 2,
      height: 1,
      parent: hiddenBox,
    })
    expect(
      computeElementClippedViewportVisibility(clippedHiddenChild, size),
    ).toBe(null)
    expect(
      computeElementClippedViewportVisibility(visibleHiddenChild, size),
    ).toBe(true)

    // Hook wiring check: useTerminalViewport() index 3 (pureCheck) uses clipped check
    const { ink } = createTestInk(40, 24)
    try {
      let capturedPureCheck: (() => boolean | null) | undefined
      let capturedUnclippedCheck: (() => boolean | null) | undefined
      let capturedSetRef: ((el: dom.DOMElement | null) => void) | undefined

      function Probe() {
        const [setRef, , , pureCheck, unclippedCheck] = useTerminalViewport()
        capturedSetRef = setRef
        capturedPureCheck = pureCheck
        capturedUnclippedCheck = unclippedCheck
        return React.createElement(Box)
      }

      ink.render(
        React.createElement(
          TerminalSizeContext.Provider,
          { value: { columns: 40, rows: 24 } },
          React.createElement(Probe),
        ),
      )

      capturedSetRef!(clippedHiddenChild)
      expect(capturedUnclippedCheck!()).toBe(true)
      expect(capturedPureCheck!()).toBe(null)

      capturedSetRef!(visibleHiddenChild)
      expect(capturedPureCheck!()).toBe(true)
    } finally {
      ink.unmount()
    }
  })

  test('12. P2-D4-14: KeybindingSetup.interceptChord passes through single unbound (null) keys while still swallowing mid-chord unbound keys', () => {
    const bindings: ParsedBinding[] = [
      // Single key explicitly unbound in Chat context
      {
        chord: [
          {
            key: 'k',
            ctrl: true,
            alt: false,
            shift: false,
            meta: false,
            super: false,
          },
        ],
        action: null,
        context: 'Chat',
      },
      // Two-key chord prefix in Global context: ctrl+x s -> test:save, ctrl+x u -> unbound (null)
      {
        chord: [
          {
            key: 'x',
            ctrl: true,
            alt: false,
            shift: false,
            meta: false,
            super: false,
          },
          {
            key: 's',
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
            super: false,
          },
        ],
        action: 'test:save',
        context: 'Global',
      },
      {
        chord: [
          {
            key: 'x',
            ctrl: true,
            alt: false,
            shift: false,
            meta: false,
            super: false,
          },
          {
            key: 'u',
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
            super: false,
          },
        ],
        action: null,
        context: 'Global',
      },
    ]

    const { ink } = createTestInk(40, 10)
    try {
      const receivedInputs: string[] = []
      const receivedKeyDowns: string[] = []

      function Child() {
        useInput((input, key) => {
          receivedInputs.push(key.ctrl ? `ctrl+${input}` : input)
        })
        return React.createElement(Box, {
          tabIndex: 0,
          autoFocus: true,
          onKeyDown: (ev: KeyboardEvent) => {
            receivedKeyDowns.push(ev.ctrl ? `ctrl+${ev.name}` : ev.name)
          },
        })
      }

      const KeybindingSetupHost = KeybindingSetup as React.ComponentType<
        Omit<KeybindingSetupProps, 'children'>
      >
      ink.render(
        React.createElement(
          KeybindingSetupHost,
          {
            loadBindings: () => ({ bindings, warnings: [] }),
            subscribeToChanges: () => () => {},
          },
          React.createElement(Child),
        ),
      )

      const dispatchKey = (name: string, ctrl: boolean, sequence: string) => {
        ;(
          ink as unknown as {
            dispatchKeyboardEvent: (key: Record<string, unknown>) => boolean
          }
        ).dispatchKeyboardEvent({
          kind: 'key',
          name,
          fn: false,
          ctrl,
          meta: false,
          shift: false,
          option: false,
          super: false,
          sequence,
          raw: sequence,
        })
      }

      // Single key ctrl+k is unbound (null) in Chat — MUST NOT be globally swallowed in capture phase!
      dispatchKey('k', true, '\x0b')
      expect(receivedInputs).toEqual(['ctrl+k'])
      expect(receivedKeyDowns).toEqual(['ctrl+k'])

      // Mid-chord: ctrl+x starts chord (swallowed), then 'u' resolves to unbound (MUST be swallowed!)
      dispatchKey('x', true, '\x18')
      dispatchKey('u', false, 'u')
      expect(receivedInputs).toEqual(['ctrl+k'])
      expect(receivedKeyDowns).toEqual(['ctrl+k'])

      // After chord cleared, normal 'u' passes through again
      dispatchKey('u', false, 'u')
      expect(receivedInputs).toEqual(['ctrl+k', 'u'])
      expect(receivedKeyDowns).toEqual(['ctrl+k', 'u'])
    } finally {
      ink.unmount()
    }
  })
})
