import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EventEmitter } from 'events'
import chalk from 'chalk'
import React from 'react'
import ScrollBox, { type ScrollBoxHandle } from '../../components/ScrollBox.js'
import Text from '../../components/Text.js'
import {
  BIDI_SUBSTITUTE_RANGES,
  CELL_RUN_SHIFT,
  CELL_SEGMENTER_TABLE_CAP,
  CELL_TAB_FLAG,
  CELL_WIDTH_MASK,
  createCellSegmenter,
  JsCellSegmenter,
} from '../cell-segmenter.js'
import type { DOMElement } from '../dom.js'
import { FrameScheduler } from '../frame-scheduler.js'
import Ink from '../ink.js'
import {
  bindInkSessionHost,
  Ns,
  resetInkSessionHostForTests,
} from '../instances.js'
import Output, { calibratedSliceAnsi, LineCells } from '../output.js'
import { OverlayController } from '../overlay-controller.js'
import renderNodeToOutput, {
  createRenderFrameContext,
} from '../render-node-to-output.js'
import {
  CellWidth,
  CharPool,
  cellAt,
  createScreen,
  HyperlinkPool,
  StylePool,
} from '../screen.js'
import {
  getSelectedText,
  startSelection,
  updateSelection,
} from '../selection.js'
import { SoftWrapKind } from '../softWrap.js'
import { setTerminalEmojiWidthCalibrator, stringWidth } from '../stringWidth.js'
import { TerminalQuerier } from '../terminal-querier.js'
import Yoga from '../yoga-layout/index.js'

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

const origChalkLevel = chalk.level

afterEach(() => {
  chalk.level = origChalkLevel
  setTerminalEmojiWidthCalibrator(undefined)
  resetInkSessionHostForTests()
})

describe('Official 2.1.328 Engine Parity — JsCellSegmenter & LineCells (bm)', () => {
  test('JsCellSegmenter parses SGR colors, compound SGR, bold+dim, hidden filter, and non-SGR escapes', () => {
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const screen = createScreen(30, 1, stylePool, charPool, hyperlinkPool)
    const out = new Output({ width: 30, height: 1, stylePool, screen })

    // Compound bold+red, 256-color, hidden (SGR 8 must be stripped via BPa), non-SGR CSI skipped
    out.write(
      0,
      0,
      '\x1b[1;31mA\x1b[0m\x1b[38;5;208mB\x1b[39m\x1b[8mC\x1b[28m\x1b[2JD',
    )
    const sc = out.get()

    const cA = cellAt(sc, 0, 0)!
    expect(cA.char).toBe('A')
    expect(stylePool.get(cA.styleId).map(s => s.code)).toEqual([
      '\x1b[1m',
      '\x1b[31m',
    ])

    const cB = cellAt(sc, 1, 0)!
    expect(cB.char).toBe('B')
    expect(stylePool.get(cB.styleId).map(s => s.code)).toEqual([
      '\x1b[38;5;208m',
    ])

    // Hidden SGR 8 (endCode \x1b[28m = BPa) is filtered out by LineCells.ansiCodes
    const cC = cellAt(sc, 2, 0)!
    expect(cC.char).toBe('C')
    expect(stylePool.get(cC.styleId)).toEqual([])

    // Non-SGR CSI \x1b[2J skipped cleanly
    const cD = cellAt(sc, 3, 0)!
    expect(cD.char).toBe('D')
    expect(stylePool.get(cD.styleId)).toEqual([])
  })

  test('JsCellSegmenter extracts BEL- and ST-terminated OSC-8 hyperlinks with params and styles', () => {
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const screen = createScreen(20, 1, stylePool, charPool, hyperlinkPool)
    const out = new Output({ width: 20, height: 1, stylePool, screen })

    out.write(
      0,
      0,
      '\x1b[34m\x1b]8;id=1;https://a.test\x07hi\x1b]8;;\x07\x1b[39m \x1b]8;;https://b.test\x1b\\ok\x1b]8;;\x1b\\',
    )
    const sc = out.get()

    expect(cellAt(sc, 0, 0)?.char).toBe('h')
    expect(cellAt(sc, 0, 0)?.hyperlink).toBe('https://a.test')
    expect(stylePool.get(cellAt(sc, 0, 0)!.styleId).map(s => s.code)).toEqual([
      '\x1b[34m',
    ])

    expect(cellAt(sc, 2, 0)?.char).toBe(' ')
    expect(cellAt(sc, 2, 0)?.hyperlink).toBeUndefined()

    expect(cellAt(sc, 3, 0)?.char).toBe('o')
    expect(cellAt(sc, 3, 0)?.hyperlink).toBe('https://b.test')
    expect(cellAt(sc, 4, 0)?.char).toBe('k')
    expect(cellAt(sc, 4, 0)?.hyperlink).toBe('https://b.test')
  })

  test('CJK wide chars, SpacerTail, right-edge SpacerHead, and wide-char orphan cleanup', () => {
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const screen = createScreen(5, 2, stylePool, charPool, hyperlinkPool)
    const out = new Output({ width: 5, height: 2, stylePool, screen })

    // Row 0: "a漢漢" -> col 0:'a'(Narrow), 1:'漢'(Wide), 2:''(SpacerTail), 3:'漢'(Wide), 4:''(SpacerTail)
    out.write(0, 0, 'a漢漢')
    // Row 1: "ab漢" at col 2 -> col 2:'a', 3:'b', 4:SpacerHead (wide char can't fit in col 4)
    out.write(2, 1, 'ab漢')
    const sc = out.get()

    expect(cellAt(sc, 0, 0)?.width).toBe(CellWidth.Narrow)
    expect(cellAt(sc, 1, 0)?.char).toBe('漢')
    expect(cellAt(sc, 1, 0)?.width).toBe(CellWidth.Wide)
    expect(cellAt(sc, 2, 0)?.width).toBe(CellWidth.SpacerTail)
    expect(cellAt(sc, 3, 0)?.char).toBe('漢')
    expect(cellAt(sc, 3, 0)?.width).toBe(CellWidth.Wide)
    expect(cellAt(sc, 4, 0)?.width).toBe(CellWidth.SpacerTail)

    expect(cellAt(sc, 2, 1)?.char).toBe('a')
    expect(cellAt(sc, 3, 1)?.char).toBe('b')
    expect(cellAt(sc, 4, 1)?.width).toBe(CellWidth.SpacerHead)

    // Overwriting SpacerTail at col 2 clears orphaned Wide at col 1
    out.reset(5, 1, screen)
    out.write(0, 0, 'a漢b')
    out.write(2, 0, 'X')
    const sc2 = out.get()
    expect(cellAt(sc2, 1, 0)?.char).toBe(' ')
    expect(cellAt(sc2, 1, 0)?.width).toBe(CellWidth.Narrow)
    expect(cellAt(sc2, 2, 0)?.char).toBe('X')
    expect(cellAt(sc2, 2, 0)?.width).toBe(CellWidth.Narrow)
  })

  test('Tab expansion (CELL_TAB_FLAG = 256), column-aware width, and non-caching of tab lines', () => {
    const seg = new JsCellSegmenter({
      ambiguousIsNarrow: true,
      substitute: BIDI_SUBSTITUTE_RANGES,
    })
    const cells = new Int32Array(16)
    const runs = new Int32Array(16)
    const count = seg.segment('a\tb', cells, runs, false)
    expect(count).toBe(3)
    expect(cells[1]! & CELL_WIDTH_MASK).toBe(1)
    expect((cells[3]! & CELL_TAB_FLAG) !== 0).toBe(true)
    expect(cells[5]! & CELL_WIDTH_MASK).toBe(1)

    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const lc = new LineCells(stylePool, charPool)
    expect(lc.width('a\tb', 0, false)).toBe(9) // 1 + 7 + 1
    expect(lc.width('a\tb', 5, false)).toBe(4) // col 5->6, tab 6->8 (2), 'b'->9 => 9-5=4

    const screen = createScreen(20, 2, stylePool, charPool, hyperlinkPool)
    const out = new Output({ width: 20, height: 2, stylePool, screen })
    out.write(0, 0, 'a\tb')
    out.write(5, 1, 'a\tb')
    const sc = out.get()
    expect(cellAt(sc, 0, 0)?.char).toBe('a')
    expect(cellAt(sc, 8, 0)?.char).toBe('b')
    expect(cellAt(sc, 5, 1)?.char).toBe('a')
    expect(cellAt(sc, 8, 1)?.char).toBe('b')
    // Tab lines must NOT be cached in keptLines because expansion depends on x
    expect(out.lineCells.kept('a\tb')).toBeUndefined()
  })

  test('R_t bidi control substitution replaces ALM / overrides / isolates with U+FFFD', () => {
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const screen = createScreen(20, 1, stylePool, charPool, hyperlinkPool)
    const out = new Output({ width: 20, height: 1, stylePool, screen })

    // U+061C (1564), U+202E (8238 RLO), U+2066 (8294 LRI)
    out.write(0, 0, 'x\u061C\u202E\u2066y')
    const sc = out.get()
    expect(cellAt(sc, 0, 0)?.char).toBe('x')
    expect(cellAt(sc, 1, 0)?.char).toBe('\uFFFD')
    expect(cellAt(sc, 2, 0)?.char).toBe('\uFFFD')
    expect(cellAt(sc, 3, 0)?.char).toBe('\uFFFD')
    expect(cellAt(sc, 4, 0)?.char).toBe('y')
  })

  test('LineCells.keepColumns, trailingSpaces, calibrated width (no double count), and buffer growth > 512', () => {
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const lc = new LineCells(stylePool, charPool)

    // trailingSpaces counts trailing ASCII spaces even across SGR resets
    expect(lc.trailingSpaces('hello   ')).toBe(3)
    expect(lc.trailingSpaces('\x1b[32mhi\x1b[39m  ')).toBe(2)
    expect(lc.trailingSpaces('abc\t')).toBe(0)

    // Calibrated wide symbol ✌ (U+270C): width must be 2 (not 3 from double-counting nFi)
    expect(lc.width('✌', 0, false)).toBe(2)

    // keepColumns drops wide char straddling clip boundary
    lc.segment('a漢b', false) // cols: a=[0,1), 漢=[1,3), b=[3,4)
    const startCol = lc.keepColumns(0, 2, 4)
    // col 1..3 (漢) straddles x1=2 -> dropped; only 'b' at col 3 remains
    expect(startCol).toBe(3)
    expect(lc.count).toBe(1)
    expect(lc.graphemes[lc.cells[0]!]).toBe('b')

    // Long line > 512 cells triggers negative return growth & retry cleanly
    const longLine = 'z'.repeat(1200)
    expect(lc.segment(longLine, false)).toBe(1200)
    expect(lc.width(longLine, 0, false)).toBe(1200)
  })

  test('JsCellSegmenter BiDi visual reordering preserves per-cell runIdx and respects RLM prefix', () => {
    const seg = createCellSegmenter(BIDI_SUBSTITUTE_RANGES)
    const cells = new Int32Array(64)
    const runs = new Int32Array(64)

    // Explicit RLM (\u200F) with colored LTR + RTL runs
    const count = seg.segment(
      '\u200F\x1b[31mab\x1b[34mשלום\x1b[0m',
      cells,
      runs,
      true,
    )
    // \u200F is zero-width (no cell emitted), 2 Latin + 4 Hebrew = 6 cells
    expect(count).toBe(6)
    const visualChars = Array.from(
      { length: count },
      (_, i) => seg.graphemes[cells[2 * i]!],
    ).join('')
    // Under RLM paragraph direction, Hebrew is visually first (reversed), Latin stays "ab" after it
    expect(visualChars).toBe('םולשab')
    // Hebrew cells keep their blue runIdx; Latin cells keep their red runIdx
    const hebrewRunIdx = cells[1]! >>> CELL_RUN_SHIFT
    const latinRunIdx = cells[2 * 4 + 1]! >>> CELL_RUN_SHIFT
    expect(seg.sgrKeys[runs[2 * hebrewRunIdx]!]).toBe('\x1b[34m')
    expect(seg.sgrKeys[runs[2 * latinRunIdx]!]).toBe('\x1b[31m')
  })

  test('LineCells invalidates keptLines/styleIds on StylePool.compact(), chalk.level change, and native table cap', () => {
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const screen = createScreen(20, 1, stylePool, charPool, hyperlinkPool)
    const out = new Output({ width: 20, height: 1, stylePool, screen })

    // 1. chalk.level = 3 keeps 24-bit truecolor SGR and populates keptLines cache
    chalk.level = 3
    const rgbLine = '\x1b[38;2;255;0;0mhi\x1b[39m'
    out.write(0, 0, rgbLine)
    const sc3 = out.get()
    expect(stylePool.get(cellAt(sc3, 0, 0)!.styleId).map(s => s.code)).toEqual([
      '\x1b[38;2;255;0;0m',
    ])
    const cachedOffset = out.lineCells.kept(rgbLine)
    expect(cachedOffset).toBeDefined()

    // Repeat frame hits keptLines cache directly
    out.reset(20, 1, screen)
    out.write(0, 0, rgbLine)
    out.get()
    expect(out.lineCells.kept(rgbLine)).toBe(cachedOffset)

    // 2. Downgrading chalk.level to 2 triggers chalkGeneration mismatch -> downgrades truecolor to 256-color!
    chalk.level = 2
    out.reset(20, 1, screen)
    out.write(0, 0, rgbLine)
    const sc2 = out.get()
    const codes256 = stylePool.get(cellAt(sc2, 0, 0)!.styleId).map(s => s.code)
    expect(codes256).toEqual(['\x1b[38;5;196m'])

    // 3. StylePool.compact() triggers styleGeneration mismatch -> re-interns fresh IDs
    stylePool.compact()
    stylePool.intern([{ type: 'ansi', code: '\x1b[36m', endCode: '\x1b[39m' }])
    out.reset(20, 1, screen)
    out.write(0, 0, rgbLine)
    const scAfterCompact = out.get()
    expect(
      stylePool.get(cellAt(scAfterCompact, 0, 0)!.styleId).map(s => s.code),
    ).toEqual(['\x1b[38;5;196m'])

    // 4. resetNative() when table exceeds CELL_SEGMENTER_TABLE_CAP (16384)
    const oldNative = out.lineCells.native
    for (
      let i = out.lineCells.uris.length;
      i <= CELL_SEGMENTER_TABLE_CAP + 1;
      i++
    ) {
      out.lineCells.uris.push(`https://u${i}.example`)
    }
    out.lineCells.segment('fresh', false)
    expect(out.lineCells.native).not.toBe(oldNative)
    expect(out.lineCells.uris.length).toBe(1)
  })
})

describe('Official 2.1.328 Engine Parity — FrameScheduler (xm) & Ink drawFrame/backpressure', () => {
  test('FrameScheduler drains microtasks without dropping frames during sync render and manages extra frames', async () => {
    let now = 50
    let renders = 0
    const sched = new FrameScheduler(
      () => {
        renders++
      },
      () => 0,
      () => now,
    )

    // Queue a paced microtask, then simulate a sync render calling cancelExtraFrame only
    sched.scheduleFrame()
    sched.cancelExtraFrame()
    // Queued microtask still runs and clears frameMicrotaskQueued cleanly
    await Promise.resolve()
    expect(renders).toBe(1)

    // Subsequent frame schedules and drains normally (zero stuck flag)
    now += 20
    sched.scheduleFrame()
    await Promise.resolve()
    expect(renders).toBe(2)

    // scheduleExtraFrame + cancelExtraFrame cancels pending drain timer cleanly
    sched.scheduleExtraFrame()
    sched.cancelExtraFrame()
    await new Promise(r => setTimeout(r, 20))
    expect(renders).toBe(2)
  })

  test('Ink.drawFrame() entry beginFrame rolls back exceptions from runLayoutPass in newRenderer mode', () => {
    const { stdout } = createFakeTtyStdout(40, 10)
    const ink = new Ink({
      stdout,
      stdin: createFakeStdin(),
      stderr: stdout,
      exitOnCtrlC: false,
      patchConsole: false,
      newRenderer: true,
    })
    try {
      ink.render(React.createElement(Text, null, 'layout test'))

      const inkInternal = ink as unknown as {
        layout: { layoutDamaged: boolean; runLayoutPass: () => void }
        unwritten: unknown
      }
      const origRunLayout = inkInternal.layout.runLayoutPass.bind(
        inkInternal.layout,
      )
      let layoutCalls = 0
      inkInternal.layout.layoutDamaged = true
      inkInternal.layout.runLayoutPass = () => {
        layoutCalls++
        if (layoutCalls === 1) {
          throw new Error('transient layout fault')
        }
        inkInternal.layout.layoutDamaged = false
        origRunLayout()
      }

      // Entry beginFrame() captures unwritten before runLayoutPass(), so onRender()
      // rolls back and retries synchronously instead of crashing!
      expect(() => ink.onRender()).not.toThrow()
      expect(layoutCalls).toBe(2)
      expect(inkInternal.unwritten).toBeUndefined()
    } finally {
      ink.unmount()
    }
  })

  test('Ink.handleStdoutBackpressure triggers reassertTerminalModes+forceRedraw+releaseHeldFrame on drain and repaint otherwise', () => {
    const { stdout } = createFakeTtyStdout(40, 10)
    const ink = new Ink({
      stdout,
      stdin: createFakeStdin(),
      stderr: stdout,
      exitOnCtrlC: false,
      patchConsole: false,
      newRenderer: false,
    })
    try {
      const inkInternal = ink as unknown as {
        handleStdoutBackpressure: (ep: {
          durationMs: number
          peakQueuedBytes: number
          droppedBytes: number
          endedBy: 'drain' | 'flush'
        }) => void
        reassertTerminalModes: () => void
        forceRedraw: () => boolean
        repaint: () => void
      }

      let reasserts = 0
      let forceRedraws = 0
      let repaints = 0
      let released = 0

      inkInternal.reassertTerminalModes = () => {
        reasserts++
      }
      inkInternal.forceRedraw = () => {
        forceRedraws++
        return true
      }
      inkInternal.repaint = () => {
        repaints++
      }
      ink.scheduler.releaseHeldFrame = () => {
        released++
      }

      // Non-drain drop: calls repaint(), NOT forceRedraw / releaseHeldFrame
      inkInternal.handleStdoutBackpressure({
        durationMs: 100,
        peakQueuedBytes: 32768,
        droppedBytes: 1024,
        endedBy: 'flush',
      })
      expect(repaints).toBe(1)
      expect(reasserts).toBe(0)
      expect(forceRedraws).toBe(0)
      expect(released).toBe(0)

      // Drain drop: calls reassertTerminalModes + forceRedraw + releaseHeldFrame
      inkInternal.handleStdoutBackpressure({
        durationMs: 200,
        peakQueuedBytes: 65536,
        droppedBytes: 4096,
        endedBy: 'drain',
      })
      expect(reasserts).toBe(1)
      expect(forceRedraws).toBe(1)
      expect(released).toBe(1)
    } finally {
      ink.unmount()
    }
  })
})

describe('Adversarial Review Fixes — @ant/ink & Scroll Selection 2.1.328 Parity (P1-1..P2-5)', () => {
  test('P1-1: ScrollKeybindingHandler delegates selection tracking solely to render-phase followScroll (no double-shift / double-capture)', () => {
    // 1. Source contract against official 2.1.328 `oL`
    const handlerPath = resolve(
      import.meta.dir,
      '../../../../../../src/components/ScrollKeybindingHandler.tsx',
    )
    const handlerSrc = readFileSync(handlerPath, 'utf8')
    expect(handlerSrc).not.toContain('translateSelectionForJump')
    const lineUpIdx = handlerSrc.indexOf("'scroll:lineUp'")
    const topIdx = handlerSrc.indexOf("'scroll:top'")
    expect(lineUpIdx).toBeGreaterThan(0)
    expect(topIdx).toBeGreaterThan(lineUpIdx)
    expect(handlerSrc.slice(lineUpIdx, topIdx)).not.toContain(
      'selection.clearSelection()',
    )

    // 2. End-to-end ScrollBox + renderNodeToOutput + OverlayController.followScroll
    const { stdout } = createFakeTtyStdout(20, 5)
    const ink = new Ink({
      stdout,
      stdin: createFakeStdin(),
      stderr: stdout,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      const ref = React.createRef<ScrollBoxHandle>()
      const lines = Array.from({ length: 12 }, (_, i) =>
        React.createElement(
          Text,
          { key: i },
          `row-${String(i).padStart(2, '0')}`,
        ),
      )
      ink.render(
        React.createElement(
          ScrollBox,
          { ref, flexDirection: 'column', height: 5, stickyScroll: false },
          ...lines,
        ),
      )
      const handle = ref.current!
      const rootNode = (ink as unknown as { rootNode: DOMElement }).rootNode
      rootNode.yogaNode!.setWidth(20)
      rootNode.yogaNode!.setHeight(5)
      rootNode.yogaNode!.calculateLayout(20, 5)

      const stylePool = new StylePool()
      const charPool = new CharPool()
      const hyperlinkPool = new HyperlinkPool()
      const paint = () => {
        const sc = createScreen(20, 5, stylePool, charPool, hyperlinkPool)
        const out = new Output({ width: 20, height: 5, stylePool, screen: sc })
        const ctx = createRenderFrameContext()
        renderNodeToOutput(rootNode, out, ctx, { prevScreen: undefined })
        return { screen: out.get(), ctx }
      }

      // Frame 0: scrollTop = 0, rows 0..4 visible
      const f0 = paint()
      let frontScreen = f0.screen
      const overlays = new OverlayController(rootNode, stylePool, {
        screen: () => frontScreen,
        isAltScreenActive: () => true,
        scheduleRender: () => {},
      })

      // Select row-01 .. row-03 (rows 1..3)
      startSelection(overlays.selection, 0, 1)
      updateSelection(overlays.selection, 5, 3)
      overlays.selection.isDragging = false
      expect(getSelectedText(overlays.selection, frontScreen)).toBe(
        'row-01\nrow-02\nrow-03',
      )

      // PageDown by +2 rows (scrollTo(2)): ONLY render-phase followScroll runs
      handle.scrollTo(2)
      const f1 = paint()
      expect(f1.ctx.followScroll?.delta).toBe(2)
      // OverlayController.followScroll reads the previous frontScreen before swap
      overlays.followScroll(f1.ctx.followScroll)
      frontScreen = f1.screen

      // Selection shifted ONCE by -2 (row 1 scrolled off above, row 3 -> row 1)
      expect(overlays.selection.focus?.row).toBe(1)
      expect(overlays.selection.scrolledOffAbove).toEqual(['row-01'])
      // Full selected text has ZERO duplicate rows!
      expect(getSelectedText(overlays.selection, frontScreen)).toBe(
        'row-01\nrow-02\nrow-03',
      )
    } finally {
      ink.unmount()
    }
  })

  test('P1-2: probeExternalClear() sends only CPR without DA1 flush and never leaks owed()', async () => {
    const { stdout } = createFakeTtyStdout(40, 10)
    const ink = new Ink({
      stdout,
      stdin: createFakeStdin(),
      stderr: stdout,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      const inkInternal = ink as unknown as {
        altScreenActive: boolean
        displayCursor: { x: number; y: number; emittedRows: number } | null
        forceRedraw: () => boolean
      }
      inkInternal.altScreenActive = true
      inkInternal.displayCursor = { x: 0, y: 4, emittedRows: 10 }
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

      const ac = new AbortController()
      const p = ink.probeExternalClear(querier, ac.signal)
      expect(writes).toEqual(['\x1b[?6n'])
      expect(querier.owed()).toBe(0)

      ac.abort()
      expect(await p).toBe(false)
      expect(querier.owed()).toBe(0)
      expect(redraws).toBe(0)
    } finally {
      ink.unmount()
    }
  })

  test('P1-3: Output horizontal clipping and RTL wrap trimming use official calibrated sliceAnsi (qbt)', () => {
    // Direct qbt parity: "✌a✌b" has calibrated cols [0..2)='✌', [2..3)='a', [3..5)='✌', [5..6)='b'
    expect(calibratedSliceAnsi('✌a✌b', 2, 6)).toBe('a✌b')
    expect(calibratedSliceAnsi('\x1b[31m✌a✌b\x1b[39m', 2, 6)).toBe(
      '\x1b[31ma✌b\x1b[39m',
    )

    // Output horizontal clip: clipping "✌a✌b" with x1: 2, x2: 6 renders ['a', '✌', '', 'b']
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const screen = createScreen(8, 1, stylePool, charPool, hyperlinkPool)
    const out = new Output({ width: 8, height: 1, stylePool, screen })
    out.clip({ x1: 2, x2: 6, y1: undefined, y2: undefined })
    out.write(0, 0, '✌a✌b')
    out.unclip()
    const sc = out.get()

    const rendered = [2, 3, 4, 5].map(col => cellAt(sc, col, 0)?.char ?? '')
    expect(rendered).toEqual(['a', '✌', '', 'b'])
    expect(cellAt(sc, 3, 0)?.width).toBe(CellWidth.Wide)
    expect(cellAt(sc, 4, 0)?.width).toBe(CellWidth.SpacerTail)
  })

  test('P1-4: JsCellSegmenter.paint() clears ALL SpacerTails for w >= 3 graphemes and clears col 0 for col < 0 wide chars', () => {
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()

    // (a) Overwriting Wide head of a w=3 grapheme ("काा" = cols 0,1,2) with Narrow clears BOTH cols 1 & 2
    const sc1 = createScreen(6, 1, stylePool, charPool, hyperlinkPool)
    const out1 = new Output({ width: 6, height: 1, stylePool, screen: sc1 })
    out1.write(0, 0, '\u0915\u093e\u093ex')
    out1.get()
    expect(cellAt(sc1, 0, 0)?.width).toBe(CellWidth.Wide)
    expect(cellAt(sc1, 1, 0)?.width).toBe(CellWidth.SpacerTail)
    expect(cellAt(sc1, 2, 0)?.width).toBe(CellWidth.SpacerTail)
    expect(cellAt(sc1, 3, 0)?.char).toBe('x')

    out1.reset(6, 1, sc1)
    out1.write(0, 0, '\u0915\u093e\u093ex')
    out1.write(0, 0, 'Z')
    out1.get()
    expect(cellAt(sc1, 0, 0)?.char).toBe('Z')
    expect(cellAt(sc1, 1, 0)?.width).toBe(CellWidth.Narrow)
    expect(cellAt(sc1, 1, 0)?.char).toBe(' ')
    expect(cellAt(sc1, 2, 0)?.width).toBe(CellWidth.Narrow)
    expect(cellAt(sc1, 2, 0)?.char).toBe(' ')
    expect(cellAt(sc1, 3, 0)?.char).toBe('x')

    // Overwriting Wide head of w=3 grapheme with w=2 wide char clears col 2 tail
    const sc1b = createScreen(6, 1, stylePool, charPool, hyperlinkPool)
    const out1b = new Output({ width: 6, height: 1, stylePool, screen: sc1b })
    out1b.write(0, 0, '\u0915\u093e\u093ex')
    out1b.write(0, 0, '漢')
    out1b.get()
    expect(cellAt(sc1b, 0, 0)?.char).toBe('漢')
    expect(cellAt(sc1b, 1, 0)?.width).toBe(CellWidth.SpacerTail)
    expect(cellAt(sc1b, 2, 0)?.width).toBe(CellWidth.Narrow)
    expect(cellAt(sc1b, 2, 0)?.char).toBe(' ')

    // (b) Overwriting the 2nd SpacerTail (col 2) of a w=4 grapheme ("कााा" = cols 0..3) clears head + ALL tails
    const sc2 = createScreen(6, 1, stylePool, charPool, hyperlinkPool)
    const out2 = new Output({ width: 6, height: 1, stylePool, screen: sc2 })
    out2.write(0, 0, '\u0915\u093e\u093e\u093ey')
    out2.write(2, 0, 'Q')
    out2.get()
    expect(cellAt(sc2, 0, 0)?.char).toBe(' ')
    expect(cellAt(sc2, 0, 0)?.width).toBe(CellWidth.Narrow)
    expect(cellAt(sc2, 1, 0)?.char).toBe(' ')
    expect(cellAt(sc2, 1, 0)?.width).toBe(CellWidth.Narrow)
    expect(cellAt(sc2, 2, 0)?.char).toBe('Q')
    expect(cellAt(sc2, 3, 0)?.char).toBe(' ')
    expect(cellAt(sc2, 3, 0)?.width).toBe(CellWidth.Narrow)
    expect(cellAt(sc2, 4, 0)?.char).toBe('y')

    // (c) SpacerTail of a new w=3 grapheme overwriting head of an existing w=3 grapheme clears ALL its trailing tails
    const sc3 = createScreen(6, 1, stylePool, charPool, hyperlinkPool)
    const out3 = new Output({ width: 6, height: 1, stylePool, screen: sc3 })
    out3.write(0, 0, 'ab\u0915\u093e\u093e!')
    out3.write(0, 0, '\u0915\u093e\u093e')
    out3.get()
    expect(cellAt(sc3, 0, 0)?.width).toBe(CellWidth.Wide)
    expect(cellAt(sc3, 1, 0)?.width).toBe(CellWidth.SpacerTail)
    expect(cellAt(sc3, 2, 0)?.width).toBe(CellWidth.SpacerTail)
    expect(cellAt(sc3, 3, 0)?.char).toBe(' ')
    expect(cellAt(sc3, 3, 0)?.width).toBe(CellWidth.Narrow)
    expect(cellAt(sc3, 4, 0)?.char).toBe(' ')
    expect(cellAt(sc3, 4, 0)?.width).toBe(CellWidth.Narrow)
    expect(cellAt(sc3, 5, 0)?.char).toBe('!')

    // (d) Wide char starting at col < 0 clears its visible right-hand columns (col 0)
    const sc4 = createScreen(6, 1, stylePool, charPool, hyperlinkPool)
    const out4 = new Output({ width: 6, height: 1, stylePool, screen: sc4 })
    out4.write(0, 0, 'ABCDEF')
    out4.write(-1, 0, '中xy')
    out4.get()
    const row4 = Array.from({ length: 6 }, (_, x) => cellAt(sc4, x, 0)?.char)
    expect(row4).toEqual([' ', 'x', 'y', 'D', 'E', 'F'])
  })

  test('P1-5: JsCellSegmenter CSI/SGR parser aborts CSI on ESC, ignores private/intermediate ...m, and handles truncated 38;2 / 48;5', () => {
    chalk.level = 3
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const screen = createScreen(30, 4, stylePool, charPool, hyperlinkPool)
    const out = new Output({ width: 30, height: 4, stylePool, screen })

    // (a) Unterminated CSI followed by a new ESC: no "32m" text leakage, green applied
    out.write(0, 0, '\x1b[31\x1b[32mhi\x1b[0m')
    // (b) Private prefix '>' / '?' and intermediate ' ' ending in 'm' must NOT apply SGR
    out.write(0, 1, '\x1b[>4;2mA\x1b[?4mB\x1b[1 mC')
    // (c) Truncated 38;2;255;128m and 48;5m must NOT misparse 2 as dim or 5 as blink
    out.write(0, 2, '\x1b[38;2;255;128mX\x1b[48;5mY')
    // Valid colon-separated 38:2::r:g:b and 38:5:idx still parse cleanly
    out.write(0, 3, '\x1b[38:2::10:20:30mP\x1b[38:5:208mQ\x1b[0m')

    const sc = out.get()
    // Row 0
    expect(cellAt(sc, 0, 0)?.char).toBe('h')
    expect(cellAt(sc, 1, 0)?.char).toBe('i')
    expect(cellAt(sc, 2, 0)?.char).toBe(' ')
    expect(stylePool.get(cellAt(sc, 0, 0)!.styleId).map(s => s.code)).toEqual([
      '\x1b[32m',
    ])
    // Row 1: zero SGR styles applied
    expect(cellAt(sc, 0, 1)?.char).toBe('A')
    expect(cellAt(sc, 1, 1)?.char).toBe('B')
    expect(cellAt(sc, 2, 1)?.char).toBe('C')
    expect(stylePool.get(cellAt(sc, 0, 1)!.styleId)).toEqual([])
    expect(stylePool.get(cellAt(sc, 1, 1)!.styleId)).toEqual([])
    expect(stylePool.get(cellAt(sc, 2, 1)!.styleId)).toEqual([])
    // Row 2: zero SGR styles applied (neither dim nor blink)
    expect(cellAt(sc, 0, 2)?.char).toBe('X')
    expect(cellAt(sc, 1, 2)?.char).toBe('Y')
    expect(stylePool.get(cellAt(sc, 0, 2)!.styleId)).toEqual([])
    expect(stylePool.get(cellAt(sc, 1, 2)!.styleId)).toEqual([])
    // Row 3: valid colon SGR parsed
    expect(cellAt(sc, 0, 3)?.char).toBe('P')
    expect(stylePool.get(cellAt(sc, 0, 3)!.styleId).map(s => s.code)).toEqual([
      '\x1b[38;2;10;20;30m',
    ])
    expect(cellAt(sc, 1, 3)?.char).toBe('Q')
    expect(stylePool.get(cellAt(sc, 1, 3)!.styleId).map(s => s.code)).toEqual([
      '\x1b[38;5;208m',
    ])
  })

  test('P2-1: Ink.unmount() calls takeBackTerminal() on surviving tree() root to wake and redraw it', () => {
    const host = {}
    bindInkSessionHost(() => host)
    const { stdout, chunks } = createFakeTtyStdout(40, 10)
    const stdin = createFakeStdin()

    const treeInk = new Ink({
      stdout,
      stdin,
      stderr: stdout,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    const treeApi = treeInk.tree()
    const treeRoot = (treeInk as unknown as { rootNode: DOMElement }).rootNode
    const label = treeApi.text('SURVIVING_TREE_ROOT')
    treeApi.append(treeRoot, label)

    const reactInk = new Ink({
      stdout,
      stdin,
      stderr: stdout,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    Ns().set(stdout, reactInk)
    reactInk.render(React.createElement(Text, null, 'REACT_MODAL'))

    // While React root owns stdout, treeInk is handed off and takeBackTerminal() is a no-op
    let repaintCalls = 0
    const origRepaint = treeInk.repaint.bind(treeInk)
    treeInk.repaint = () => {
      repaintCalls++
      origRepaint()
    }
    treeInk.takeBackTerminal()
    expect(repaintCalls).toBe(0)

    chunks.length = 0
    // Unmounting React root yields stdout and invokes surviving treeRoot.takeBackTerminal()
    reactInk.unmount()
    expect(repaintCalls).toBe(1)
    expect(chunks.join('')).toContain('SURVIVING_TREE_ROOT')

    treeInk.unmount()
    // After treeInk unmounts, takeBackTerminal() is a safe no-op
    treeInk.takeBackTerminal()
    expect(repaintCalls).toBe(1)
  })

  test('P2-2: Output.writeDirected() checks isSoftwareBidiNeeded() (gm) before RTL right-alignment', () => {
    const prevWt = process.env.WT_SESSION
    const prevTerm = process.env.TERM_PROGRAM
    try {
      // Native BiDi terminal: writeDirected delegates to write(), preserving left-alignment & softWrap
      delete process.env.WT_SESSION
      process.env.TERM_PROGRAM = 'iTerm.app'
      const nativeHost = {}
      bindInkSessionHost(() => nativeHost)

      const stylePool = new StylePool()
      const charPool = new CharPool()
      const hyperlinkPool = new HyperlinkPool()
      const scNative = createScreen(10, 2, stylePool, charPool, hyperlinkPool)
      const outNative = new Output({
        width: 10,
        height: 2,
        stylePool,
        screen: scNative,
      })
      outNative.writeDirected(
        0,
        0,
        'abc\ndef',
        [SoftWrapKind.HardBreak, SoftWrapKind.Continuation],
        'rtl',
        10,
      )
      outNative.get()
      expect(
        Array.from({ length: 10 }, (_, x) => cellAt(scNative, x, 0)?.char).join(
          '',
        ),
      ).toBe('abc       ')
      expect(scNative.softWrap[1]).not.toBe(0)

      // Software BiDi terminal (WT_SESSION set): writeDirected right-aligns RTL within maxWidth
      process.env.WT_SESSION = 'wt-test'
      const swHost = {}
      bindInkSessionHost(() => swHost)

      const scSw = createScreen(10, 2, stylePool, charPool, hyperlinkPool)
      const outSw = new Output({
        width: 10,
        height: 2,
        stylePool,
        screen: scSw,
      })
      outSw.writeDirected(0, 0, 'abc', undefined, 'rtl', 10)
      outSw.get()
      expect(
        Array.from({ length: 10 }, (_, x) => cellAt(scSw, x, 0)?.char).join(''),
      ).toBe('       abc')
    } finally {
      if (prevWt === undefined) delete process.env.WT_SESSION
      else process.env.WT_SESSION = prevWt
      if (prevTerm === undefined) delete process.env.TERM_PROGRAM
      else process.env.TERM_PROGRAM = prevTerm
    }
  })

  test('P2-3: Standalone calibrated Indic vowel sign (\\u093e) is preserved so Yoga stringWidth === LineCells.width === 1', () => {
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const lc = new LineCells(stylePool, charPool)

    expect(stringWidth('\u093e')).toBe(1)
    expect(lc.width('\u093e', 0, false)).toBe(1)
    expect(lc.width('\u093e\u093e', 0, false)).toBe(2)
    expect(stringWidth('\u093e\u093e')).toBe(2)

    // Non-calibrated zero-width chars remain width 0
    expect(lc.width('\u200b', 0, false)).toBe(0)
    expect(lc.width('\u0301', 0, false)).toBe(0)

    const screen = createScreen(5, 1, stylePool, charPool, hyperlinkPool)
    const out = new Output({ width: 5, height: 1, stylePool, screen })
    out.write(0, 0, '\u093ex')
    out.get()
    expect(cellAt(screen, 0, 0)?.char).toBe('\u093e')
    expect(cellAt(screen, 0, 0)?.width).toBe(CellWidth.Narrow)
    expect(cellAt(screen, 1, 0)?.char).toBe('x')
  })

  test('P2-4: Cross-style ZWJ emoji and skin-tone modifiers stay merged as one width-2 grapheme on starting span style', () => {
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const lc = new LineCells(stylePool, charPool)

    // 2-span ZWJ emoji: red man + green ZWJ+woman -> single width-2 grapheme
    const zwj2 = '\x1b[31m👨\x1b[32m\u200D👩\x1b[0m'
    expect(lc.width(zwj2, 0, false)).toBe(2)

    // 3-span ZWJ emoji + trailing ASCII: single width-2 grapheme + width-1 '!'
    const zwj3 = '\x1b[31m👨\x1b[32m\u200D\x1b[33m👩\x1b[34m!\x1b[0m'
    expect(lc.width(zwj3, 0, false)).toBe(3)

    // Skin-tone modifier across style boundary: width 2
    const skin = '\x1b[31m👋\x1b[32m🏽\x1b[0m'
    expect(lc.width(skin, 0, false)).toBe(2)

    // Painted cells keep full ZWJ grapheme with the starting cell's red style, and '!' gets blue
    const screen = createScreen(10, 1, stylePool, charPool, hyperlinkPool)
    const out = new Output({ width: 10, height: 1, stylePool, screen })
    out.write(0, 0, zwj3)
    out.get()
    expect(cellAt(screen, 0, 0)?.char).toBe('👨\u200D👩')
    expect(cellAt(screen, 0, 0)?.width).toBe(CellWidth.Wide)
    expect(
      stylePool.get(cellAt(screen, 0, 0)!.styleId).map(s => s.code),
    ).toEqual(['\x1b[31m'])
    expect(cellAt(screen, 1, 0)?.width).toBe(CellWidth.SpacerTail)
    expect(cellAt(screen, 2, 0)?.char).toBe('!')
    expect(
      stylePool.get(cellAt(screen, 2, 0)!.styleId).map(s => s.code),
    ).toEqual(['\x1b[34m'])
  })

  test('P2-5: CLAUDE_CODE_DISABLE_LAYOUT_CHECK wires yogaConfig.checksNumbers and clearLayoutCacheRecursive clamps negative liveNodes', () => {
    const prev = process.env.CLAUDE_CODE_DISABLE_LAYOUT_CHECK
    try {
      delete process.env.CLAUDE_CODE_DISABLE_LAYOUT_CHECK
      const { stdout: s1 } = createFakeTtyStdout(40, 10)
      const inkDefault = new Ink({
        stdout: s1,
        stdin: createFakeStdin(),
        stderr: s1,
        exitOnCtrlC: false,
        patchConsole: false,
      })
      const root1 = (inkDefault as unknown as { rootNode: DOMElement }).rootNode
      expect(root1.yogaNode?.config?.checksNumbers).toBe(true)
      inkDefault.unmount()

      process.env.CLAUDE_CODE_DISABLE_LAYOUT_CHECK = '1'
      const { stdout: s2 } = createFakeTtyStdout(40, 10)
      const inkDisabled = new Ink({
        stdout: s2,
        stdin: createFakeStdin(),
        stderr: s2,
        exitOnCtrlC: false,
        patchConsole: false,
      })
      const root2 = (inkDisabled as unknown as { rootNode: DOMElement })
        .rootNode
      expect(root2.yogaNode?.config?.checksNumbers).toBe(false)
      inkDisabled.unmount()
    } finally {
      if (prev === undefined)
        delete process.env.CLAUDE_CODE_DISABLE_LAYOUT_CHECK
      else process.env.CLAUDE_CODE_DISABLE_LAYOUT_CHECK = prev
    }

    // liveNodes clamp: even with corrupted negative liveNodes, clearLayoutCacheRecursive clears tree cleanly
    const cfg = Yoga.Config.create()
    const parent = Yoga.Node.create(cfg)
    const child = Yoga.Node.create(cfg)
    parent.insertChild(child, 0)
    parent.calculateLayout(20, 10)
    expect(parent.isDirty()).toBe(false)
    expect(child.isDirty()).toBe(false)

    cfg.liveNodes = -10000
    parent.clearLayoutCacheRecursive()
    expect(parent.isDirty()).toBe(true)
    expect(child.isDirty()).toBe(true)
    parent.freeRecursive()
  })
})
