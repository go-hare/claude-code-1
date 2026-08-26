/**
 * densable 2.1.239 #33 — click-to-focus must not fire Button/permission.
 * Gold: yvf=400, Jhf(), consumeWindowActivationLatch, dropAsStray, p9r.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import App, {
  handleMouseEvent,
  WINDOW_ACTIVATION_GRACE_MS,
} from '../../components/App.js'
import { ClickEvent, MOUNT_SETTLE_MS } from '../events/click-event.js'
import type { ParsedMouse } from '../parse-keypress.js'
import { createSelectionState } from '../selection.js'
import {
  getTerminalFocusGainedAt,
  resetTerminalFocusState,
  setTerminalFocused,
} from '../terminal-focus-state.js'

afterEach(() => {
  resetTerminalFocusState()
})

function mouse(
  action: 'press' | 'release',
  col = 2,
  row = 2,
  button = 0,
): ParsedMouse {
  return {
    kind: 'mouse',
    action,
    button,
    col,
    row,
    sequence: '',
  }
}

function stubApp(onClickAt?: App['props']['onClickAt']) {
  const clicks: Array<[number, number, boolean | undefined]> = []
  const app = Object.create(App.prototype) as App
  app.pressIsWindowActivation = false
  app.windowActivationClickArmed = true
  app.lastActivationInputTime = Number.NEGATIVE_INFINITY
  app.clickCount = 0
  app.lastClickTime = 0
  app.lastClickCol = -1
  app.lastClickRow = -1
  app.pendingHyperlinkTimer = null
  app.lastHoverCol = -1
  app.lastHoverRow = -1
  app.consumeWindowActivationLatch = App.prototype.consumeWindowActivationLatch
  const selection = createSelectionState()
  ;(app as { props: App['props'] }).props = {
    selection,
    onSelectionChange: () => {},
    onHoverAt: () => {},
    onSelectionDrag: () => {},
    onMultiClick: () => {},
    onClickAt:
      onClickAt ??
      ((col, row, activation) => {
        clicks.push([col, row, activation])
        return 'unhandled'
      }),
    getHyperlinkAt: () => undefined,
    onOpenHyperlink: () => {},
  } as unknown as App['props']
  return { app, clicks, selection }
}

describe('densable 2.1.239 #33 window-activation click', () => {
  test('yvf is 400 and _Yn is 300', () => {
    expect(WINDOW_ACTIVATION_GRACE_MS).toBe(400)
    expect(MOUNT_SETTLE_MS).toBe(300)
  })

  test('Jhf stamps only on focus-gained', () => {
    expect(getTerminalFocusGainedAt()).toBe(Number.NEGATIVE_INFINITY)
    setTerminalFocused(true)
    const gained = getTerminalFocusGainedAt()
    expect(gained).toBeGreaterThan(0)
    setTerminalFocused(false)
    expect(getTerminalFocusGainedAt()).toBe(gained)
  })

  test('first left click after FOCUS_IN within yvf is window activation', () => {
    setTerminalFocused(true)
    const { app, clicks } = stubApp()
    handleMouseEvent(app, mouse('press', 3, 4))
    expect(app.pressIsWindowActivation).toBe(true)
    expect(app.clickCount).toBe(0)
    handleMouseEvent(app, mouse('release', 3, 4))
    expect(clicks).toEqual([[2, 3, true]])
  })

  test('keyboard consume disarms latch so the next click is real', () => {
    setTerminalFocused(true)
    const { app, clicks } = stubApp()
    expect(app.consumeWindowActivationLatch(Date.now())).toBe(true)
    handleMouseEvent(app, mouse('press', 3, 4))
    expect(app.pressIsWindowActivation).toBe(false)
    handleMouseEvent(app, mouse('release', 3, 4))
    expect(clicks).toEqual([[2, 3, false]])
  })

  test('startup click before any FOCUS_IN is not activation (Jhf is -∞)', () => {
    const { app } = stubApp()
    handleMouseEvent(app, mouse('press', 3, 4))
    expect(app.pressIsWindowActivation).toBe(false)
    expect(app.clickCount).toBe(1)
  })

  test('stray result resets clickCount', () => {
    setTerminalFocused(true)
    const { app } = stubApp(() => 'stray')
    handleMouseEvent(app, mouse('press', 3, 4))
    app.clickCount = 2
    handleMouseEvent(app, mouse('release', 3, 4))
    expect(app.clickCount).toBe(0)
    expect(app.lastClickTime).toBe(0)
  })

  test('ClickEvent dropAsStray / allowDefault', () => {
    const e = new ClickEvent(1, 2, false, 'https://x', true)
    expect(e.isWindowActivation).toBe(true)
    expect(e.hyperlinkUrl).toBe('https://x')
    e.dropAsStray()
    e.allowDefault()
    expect(e.droppedAsStray).toBe(true)
    expect(e.defaultAllowed).toBe(true)
  })
})
