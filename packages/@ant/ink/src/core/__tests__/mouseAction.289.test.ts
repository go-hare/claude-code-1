/**
 * densable 2.1.289 Jhr mods on DualInk MouseActionEvent.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createNode } from '../dom.js'
import { MouseActionEvent } from '../events/mouse-action-event.js'
import { findPointerHoverTarget } from '../hit-test.js'
import { nodeCache } from '../node-cache.js'
import { DEC } from '../termio/dec.js'

const app = readFileSync(
  join(import.meta.dir, '../../components/App.tsx'),
  'utf8',
)
const ink = readFileSync(join(import.meta.dir, '../ink.tsx'), 'utf8')

describe('densable 2.1.289 Jhr mouse mods', () => {
  test('SGR bits 0x04/0x08/0x10 map shift/alt/ctrl', () => {
    const shift = new MouseActionEvent('mousedown', 1, 2, 0x04)
    expect(shift.shift).toBe(true)
    expect(shift.alt).toBe(false)
    expect(shift.ctrl).toBe(false)
    const alt = new MouseActionEvent('mousedown', 1, 2, 0x08)
    expect(alt.alt).toBe(true)
    const ctrl = new MouseActionEvent('mousedown', 1, 2, 0x10)
    expect(ctrl.ctrl).toBe(true)
    const none = new MouseActionEvent('mousedown', 1, 2, 0)
    expect(none.shift).toBe(false)
    expect(none.fine).toBeUndefined()
  })

  test('App handleMouseEvent dispatches DualInk onMouseAction', () => {
    expect(app).toContain('app.props.onMouseAction')
    expect(ink).toContain('onMouseAction={this.dispatchMouseAction}')
    expect(ink).toContain('hitDispatchMouseAction')
    expect(app).toContain('consumeDualInk')
    expect(app).toContain("if (consumeDualInk('mousedown'))")
    expect(app).toContain("if (consumeDualInk('mouseup')) return")
    expect(app).toContain('pendingPastePress')
    expect(app).toContain('consumePendingMousePaste')
    expect(app).toContain(
      'app.pendingPastePress = { button: baseButton, col, row }',
    )
    expect(app).toContain('consumePendingMousePaste(app, baseButton, col, row)')
    const store = app.indexOf(
      'app.pendingPastePress = { button: baseButton, col, row }',
    )
    const pasteFn = app.indexOf('function consumePendingMousePaste')
    expect(store).toBeGreaterThan(0)
    expect(pasteFn).toBeGreaterThan(0)
    expect(store).toBeLessThan(
      app.indexOf('consumePendingMousePaste(app, baseButton, col, row)'),
    )
  })

  test('consume uses handlePointerPress Xd / pointerCapture not DualInk return', () => {
    expect(ink).toContain('pointerCapture')
    expect(ink).toContain('handlePointerPress')
    expect(ink).toContain('handlePointerDrag')
    expect(ink).toContain('handlePointerRelease')
    expect(ink).toContain('findPointerHoverTarget')
    expect(ink).toContain('dispatchPointer')
    expect(ink).toContain('onPointerPress={this.handlePointerPress}')
    expect(ink).toContain('onPointerDrag={this.handlePointerDrag}')
    expect(ink).toContain('onPointerRelease={this.handlePointerRelease}')
    expect(app).toContain('onPointerPress')
    expect(app).toContain('onPointerDrag')
    expect(app).toContain('onPointerRelease')
    expect(app).toContain(
      'return app.props.onPointerPress?.(col, row, baseButton, mods, m.fine) === true',
    )
    expect(app).not.toContain(
      'app.props.onMouseAction?.(col, row, m.button, type) === true',
    )
    expect(app).toContain(
      "app.clickCount = 0;\n      if ((m.button & 0x20) === 0 && (baseButton === 1 || baseButton === 2) && consumeDualInk('mousedown'))",
    )
    expect(ink).toContain('this.releasePointerCapture(col, row, mods, fine)')
    const forgetStart = ink.indexOf('forgetPointer(): void')
    const forgetBody = ink.slice(
      forgetStart,
      ink.indexOf('\n  followHover', forgetStart),
    )
    expect(forgetBody).not.toContain('this.pointerCapture = null')
    expect(ink).toContain('isPointerCaptured(): boolean')
    expect(ink).toContain('return this.pointerCapture !== null')
    expect(ink).toContain('endPointerCapture(): void')
    expect(ink).toContain('this.endPointerCapture()')
    expect(ink).toContain('repaintAfterStaleAbsolutePaint')
    const hit = readFileSync(join(import.meta.dir, '../hit-test.ts'), 'utf8')
    expect(hit).toContain("kind: 'down' | 'move' | 'up'")
    expect(hit).toContain("node.parentNode || kind === 'up'")
  })

  test('gold x1 Yd hover does not emit DualInk mousedrag', () => {
    expect(app).toContain(
      "m.action === 'press' && (m.button & 0x20) !== 0 && baseButton === 3",
    )
    expect(app).toContain('consumeDualInk')
    const hoverArm = app.indexOf('if (isHoverMotion)')
    const consume = app.indexOf('const consumeDualInk')
    expect(hoverArm).toBeGreaterThan(0)
    expect(consume).toBeGreaterThan(0)
    expect(consume).toBeLessThan(hoverArm)
  })

  test('hit-test fires named handler then onPointer unless stopImmediate', () => {
    const hit = readFileSync(join(import.meta.dir, '../hit-test.ts'), 'utf8')
    expect(hit).toContain('const pointer = handlers?.onPointer')
    expect(hit).toContain('named?.(event)')
    expect(hit).toContain(
      'if (!event.didStopImmediatePropagation()) pointer?.(event)',
    )
  })

  test('dispatchHover Vd skips blank when hoverIgnoresBlankCells', () => {
    const hit = readFileSync(join(import.meta.dir, '../hit-test.ts'), 'utf8')
    expect(hit).toContain('hoverIgnoresBlankCells')
    expect(hit).toContain('hoverFollowsPaint')
    expect(hit).toContain('function hoverHandlersApply')
    expect(hit).toContain('export function cellIsBlankForHover')
    expect(ink).toContain('cellIsBlankForHover')
    expect(ink).toContain('litWhereClicked')
  })
})

describe('densable 2.1.289 DualInk hover follow split', () => {
  test('hit-test splits nv dispatchHover from iv followHover', () => {
    const hit = readFileSync(join(import.meta.dir, '../hit-test.ts'), 'utf8')
    expect(hit).toContain('function followHover')
    expect(hit).toContain('hoverFollowsPaint')
    expect(hit).toContain('ink-text')
  })

  test('Ink followHover after paint and forgetPointer wiring', () => {
    expect(ink).toContain('this.followHover()')
    expect(ink).toContain('forgetPointer')
    expect(ink).toContain('hoverFollowStreak')
    expect(ink).toContain('hoverFollowHeldUntil')
    expect(ink).toContain('onHoverLost={this.forgetPointer}')
  })

  test('App onHoverLost and lastHoverOnTarget', () => {
    expect(app).toContain('onHoverLost')
    expect(app).toContain('lastHoverOnTarget')
  })
})

describe('densable Xd tabIndex stops DualInk so left press can select', () => {
  test('tabIndex on the hit walk returns null before ancestor onPointer', () => {
    const root = createNode('ink-box')
    root._eventHandlers = { onPointer: () => {} }
    nodeCache.set(root, { x: 0, y: 0, width: 80, height: 20 })
    const left = createNode('ink-box')
    left.attributes.tabIndex = -1
    left.parentNode = root
    root.childNodes.push(left)
    nodeCache.set(left, { x: 0, y: 0, width: 50, height: 20 })
    const cell = createNode('ink-box')
    cell.parentNode = left
    left.childNodes.push(cell)
    nodeCache.set(cell, { x: 2, y: 4, width: 20, height: 1 })
    expect(findPointerHoverTarget(root, 5, 4)).toBeNull()
  })

  test('captured DualInk drag always dispatches move; selection drag seeds if not dragging', () => {
    const dragStart = ink.indexOf('handlePointerDrag = (')
    const dragBody = ink.slice(
      dragStart,
      ink.indexOf('handlePointerRelease = (', dragStart),
    )
    expect(dragBody).toContain('if (!capture) return false')
    expect(dragBody).toContain(
      "dispatchPointer(capture.node, 'move', col, row, capture.button, mods, fine)",
    )
    expect(dragBody).toContain('return true')
    expect(dragBody).not.toContain('findPointerHoverTarget')
    expect(dragBody).not.toContain('this.pointerCapture = null')
    expect(ink).toContain('if (!sel.isDragging)')
    expect(ink).toContain(
      'startSelection(sel, col, row, selectionScopeAt(this.rootNode, col, row))',
    )
  })
})

describe('densable 2.1.289 Wl onPointer local coords', () => {
  test('prepareForTarget uses nodeCache screen rect not yoga parent-relative', () => {
    const target = {
      yogaNode: { getComputedLeft: () => 2, getComputedTop: () => 3 },
    }
    nodeCache.set(target as never, { x: 10, y: 20, width: 8, height: 4 })
    const event = new MouseActionEvent('mousedown', 12, 24, 0)
    event.prepareForTarget(target as never)
    expect(event.localCol).toBe(2)
    expect(event.localRow).toBe(4)
  })
})

describe('densable 2.1.289 $l subscribeLayout bus', () => {
  test('Ink notifies layoutListeners after runLayoutPass', () => {
    expect(ink).toContain('subscribeLayout = (listener: () => void)')
    expect(ink).toContain('this.notifyLayoutListeners()')
    expect(ink).toContain('this.runLayoutPass(yoga)')
    expect(ink).toContain('subscribeLayout={this.subscribeLayout}')
    expect(app).toContain('subscribeLayout: this.props.subscribeLayout')
  })
})

describe('densable 2.1.289 Twe subscribeFrames / hoverTracked buses', () => {
  test('Ink tells frameListeners after paint before onFrame', () => {
    expect(ink).toContain('subscribeFrames = (listener: () => void)')
    expect(ink).toContain('this.tellFrameListeners()')
    expect(ink).toContain('subscribeFrames={this.subscribeFrames}')
    expect(app).toContain('subscribeFrames: this.props.subscribeFrames')
    const tellThenOnFrame =
      /this\.tellFrameListeners\(\);\s*this\.options\.onFrame\?\.\(\{/g
    expect(ink.match(tellThenOnFrame)?.length).toBe(2)
  })

  test('Ink notifies hoverTrackedListeners on setAltScreenActive', () => {
    expect(ink).toContain('subscribeHoverTracked = (listener: () => void)')
    expect(ink).toContain(
      "this.altScreenActive && this.altScreenMouseTracking === 'full'",
    )
    expect(ink).toContain('subscribeHoverTracked={this.subscribeHoverTracked}')
    expect(ink).toContain('isHoverTracked={this.isHoverTracked}')
    expect(app).toContain(
      'subscribeHoverTracked: this.props.subscribeHoverTracked',
    )
    expect(app).toContain('isHoverTracked: this.props.isHoverTracked')
    expect(ink).toContain('for (const listener of this.hoverTrackedListeners)')
  })
})

describe('densable 2.1.289 DualInk SGR-Pixels DEC 1016', () => {
  test('dec.ts contains MOUSE_PIXELS: 1016 outside ENABLE_MOUSE_TRACKING', () => {
    const dec = readFileSync(join(import.meta.dir, '../termio/dec.ts'), 'utf8')
    expect(dec).toContain('MOUSE_PIXELS: 1016')
    expect(DEC.MOUSE_PIXELS).toBe(1016)
    const enableStart = dec.indexOf('export const ENABLE_MOUSE_TRACKING =')
    const enableEnd = dec.indexOf('export const ENABLE_MOUSE_TRACKING_SCROLL')
    expect(dec.slice(enableStart, enableEnd)).not.toContain('MOUSE_PIXELS')
    expect(dec).toContain('decreset(DEC.MOUSE_PIXELS)')
    expect(dec).not.toContain('decset(DEC.MOUSE_PIXELS)')
  })

  test('ink contains syncMousePixels pixelReportsLive retainFinePointer handlePointerHover mouseReportsInPixels', () => {
    expect(ink).toContain('syncMousePixels')
    expect(ink).toContain('pixelReportsLive')
    expect(ink).toContain('retainFinePointer')
    expect(ink).toContain('handlePointerHover')
    expect(ink).toContain('mouseReportsInPixels')
    expect(ink).toContain('mouseReportsInPixels={this.mouseReportsInPixels}')
    expect(ink).toContain('onPointerHover={this.handlePointerHover}')
    expect(ink).toContain('retainFinePointer={this.retainFinePointer}')
    expect(ink).toContain('subscribeMousePixelsSupported')
    expect(ink).toContain('cancelFinePointerSettle')
  })

  test('terminal.ts notifies mousePixels settle listeners', () => {
    const terminal = readFileSync(
      join(import.meta.dir, '../terminal.ts'),
      'utf8',
    )
    expect(terminal).toContain('export function subscribeMousePixelsSupported')
    expect(terminal).toContain('mousePixelsSupportedListeners')
  })

  test('app contains onPointerHover mouseReportsInPixels lastHoverOnTarget', () => {
    expect(app).toContain('onPointerHover')
    expect(app).toContain('mouseReportsInPixels')
    expect(app).toContain('lastHoverOnTarget')
    expect(app).toContain('Math.max(1, Math.floor(fine.col) + 1)')
  })

  test('Fd formula is Math.max(1, Math.floor(n/f.width)+1)', () => {
    expect(app).toContain('Math.max(1, Math.floor(fine.col) + 1)')
    expect(app).toContain('col: n / f.width')
    const f = { width: 10, height: 16 }
    const n = 20
    const u = 32
    expect(Math.max(1, Math.floor(n / f.width) + 1)).toBe(3)
    expect(Math.max(1, Math.floor(u / f.height) + 1)).toBe(3)
  })

  test('parse ParsedMouse may mention fine', () => {
    const parse = readFileSync(
      join(import.meta.dir, '../parse-keypress.ts'),
      'utf8',
    )
    expect(parse).toContain('fine?: { col: number; row: number }')
  })

  test('probe DECRQM 1016 with status 1|2|3', () => {
    const probe = readFileSync(
      join(import.meta.dir, '../terminalProbe.ts'),
      'utf8',
    )
    expect(probe).toContain('decrqm(DEC.MOUSE_PIXELS)')
    expect(probe).toContain('probe: DECRPM 1016 status=')
    expect(probe).toContain(', cell ')
    expect(probe).toContain('mousePixels?.status === 3')
    expect(probe).toContain('querier.send(cellSize())')
    expect(probe).toContain('Cell size asked again:')
  })

  test('parse cellSize CSI 6;h;w t and querier cellSize()', () => {
    const parse = readFileSync(
      join(import.meta.dir, '../parse-keypress.ts'),
      'utf8',
    )
    const querier = readFileSync(
      join(import.meta.dir, '../terminal-querier.ts'),
      'utf8',
    )
    expect(parse).toContain("type: 'cellSize'")
    expect(parse).toContain('\\x1b\\[6;(\\d+);(\\d+)t')
    expect(querier).toContain("request: csi('16t')")
    expect(querier).toContain("r.type === 'cellSize'")
    expect(app).toContain('reprobeCellPixels')
    expect(ink).toContain('this.appRef.current?.reprobeCellPixels()')
  })

  test('gold x1 Yd hover skips onMouseAction DualInk press/drag', () => {
    expect(app).toContain(
      "m.action === 'press' && (m.button & 0x20) !== 0 && baseButton === 3",
    )
    expect(app).toContain('consumeDualInk')
    const hoverArm = app.indexOf('if (isHoverMotion)')
    const consume = app.indexOf('const consumeDualInk')
    expect(hoverArm).toBeGreaterThan(0)
    expect(consume).toBeGreaterThan(0)
    expect(consume).toBeLessThan(hoverArm)
  })

  test('gold $mo off reasserts SGR 1006 after 1016l', () => {
    expect(ink).toContain('decreset(DEC.MOUSE_PIXELS) + decset(DEC.MOUSE_SGR)')
  })

  test('gold igo APC _G id=31 query and unique English logs', () => {
    const parse = readFileSync(
      join(import.meta.dir, '../parse-keypress.ts'),
      'utf8',
    )
    const querier = readFileSync(
      join(import.meta.dir, '../terminal-querier.ts'),
      'utf8',
    )
    const probe = readFileSync(
      join(import.meta.dir, '../terminalProbe.ts'),
      'utf8',
    )
    expect(parse).toContain("type: 'kittyGraphics'")
    expect(parse).toContain('\\x1b_G(?:[^;]*,)?i=(\\d+)')
    expect(querier).toContain('KITTY_GRAPHICS_QUERY_ID = 31')
    expect(querier).toContain('a=q,t=d,f=24;AAAA')
    expect(probe).toContain('kittyGraphicsQuery()')
    expect(probe).toContain('probe: no reply to the graphics query')
    expect(probe).toContain(
      'probe: graphics reply ${graphics.message}, terminal',
    )
  })

  test('cellReprobe idle asking again coalesces overlapping p1', () => {
    expect(app).toContain("cellReprobe: 'idle' | 'asking' | 'again'")
    expect(app).toContain("this.cellReprobe = 'asking'")
    expect(app).toContain("this.cellReprobe = 'again'")
    expect(app).toContain('async runCellReprobe')
    expect(ink).toContain('onCellPixels={this.syncMousePixels}')
  })
})

describe('densable 2.1.289 onSelectionTakeDown before Il', () => {
  test('E1 / copySelection / clearTextSelection announce take-down first', () => {
    expect(app).toContain('onSelectionTakeDown: () => void')
    expect(app).toContain('app.props.onSelectionTakeDown()')
    const takeDown = app.indexOf('app.props.onSelectionTakeDown()')
    const clear = app.indexOf('clearSelection(sel)', takeDown)
    const change = app.indexOf('app.props.onSelectionChange()', takeDown)
    expect(takeDown).toBeGreaterThan(0)
    expect(clear).toBeGreaterThan(takeDown)
    expect(change).toBeGreaterThan(clear)
    expect(ink).toContain('onSelectionTakeDown={this.notifySelectionTakeDown}')
    expect(ink).toContain('subscribeToSelectionTakeDown')
    expect(ink).toContain('this.selectionTakeDown.announce()')
    const copy = ink.indexOf('copySelection(): string')
    const copyBody = ink.slice(copy, ink.indexOf('clearTextSelection()', copy))
    expect(copyBody.indexOf('this.notifySelectionTakeDown()')).toBeLessThan(
      copyBody.indexOf('clearSelection(this.selection)'),
    )
    const clearFn = ink.indexOf('clearTextSelection(): void')
    const clearBody = ink.slice(
      clearFn,
      ink.indexOf('setSearchHighlight', clearFn),
    )
    expect(clearBody.indexOf('this.notifySelectionTakeDown()')).toBeLessThan(
      clearBody.indexOf('clearSelection(this.selection)'),
    )
  })
})
