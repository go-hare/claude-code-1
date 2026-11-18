import { describe, expect, test } from 'bun:test'
import type { Frame } from '../frame.js'
import { LogUpdate } from '../log-update.js'
import {
  CellWidth,
  CharPool,
  createScreen,
  HyperlinkPool,
  StylePool,
  setCellAt,
} from '../screen.js'

function makeFrame(
  stylePool: StylePool,
  width: number,
  height: number,
  viewportHeight: number,
  cursorY: number,
  fillChar = ' ',
): Frame {
  const charPool = new CharPool()
  const hyperlinkPool = new HyperlinkPool()
  const screen = createScreen(width, height, stylePool, charPool, hyperlinkPool)
  if (fillChar !== ' ') {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < 4; x++) {
        setCellAt(screen, x, y, {
          char: fillChar,
          styleId: stylePool.none,
          width: CellWidth.Narrow,
          hyperlink: undefined,
        })
      }
    }
  }
  return {
    screen,
    cursor: { x: 2, y: cursorY, visible: true },
    viewport: { width, height: viewportHeight },
    cursorAtContentEnd: false,
    scrollHint: undefined,
  } as unknown as Frame
}

describe('LogUpdate shrinking with scrollback and non-bottom cursor', () => {
  test('anchors cursor to prev.screen.height - 1 before clearing shrunk rows', () => {
    const stylePool = new StylePool()
    const updater = new LogUpdate({ stylePool, isTTY: true })
    const prev = makeFrame(stylePool, 80, 38, 24, 34, 'A')
    const next = makeFrame(stylePool, 80, 32, 24, 28, 'A')

    const patches = updater.render(prev, next, false)
    // Must move down from y=34 to bottom row y=37 (dy = +3) before clear(6)
    const firstMove = patches.find(p => p.type === 'cursorMove')
    expect(firstMove).toEqual({ type: 'cursorMove', x: 0, y: 3 })
    const clearPatch = patches.find(p => p.type === 'clear')
    expect(clearPatch).toEqual({ type: 'clear', count: 6 })
  })

  test('triggers full reset when shrinking target bottom falls above viewportY', () => {
    const stylePool = new StylePool()
    const updater = new LogUpdate({ stylePool, isTTY: true })
    // Simulate scrollback accumulated across frames: frame0 (h=50) -> prev (h=48, scrolledOutRows=26)
    // Then shrink to next (h=25 > viewport=24): targetBottomY = 24 < viewportY (26),
    // even though linesToClear = 23 <= 24. Must fullReset instead of clamping cursor.
    const frame0 = makeFrame(stylePool, 80, 50, 24, 46, 'A')
    const prev = makeFrame(stylePool, 80, 48, 24, 44, 'A')
    const next = makeFrame(stylePool, 80, 25, 24, 21, 'B')

    updater.render(frame0, prev, false)
    const patches = updater.render(prev, next, false)
    expect(patches.some(p => p.type === 'clearTerminal')).toBe(true)
  })
})
