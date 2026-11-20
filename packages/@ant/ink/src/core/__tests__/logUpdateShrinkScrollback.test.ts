import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import * as React from 'react'
import Box from '../../components/Box.js'
import Text from '../../components/Text.js'
import { useDeclaredCursor } from '../../hooks/use-declared-cursor.js'
import type { Frame } from '../frame.js'
import { wrappedRender as render } from '../../index.js'
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

  test('does not emit extra cursor-up before clear when prev.cursor.y === prev.screen.height (official 2.1.328)', () => {
    const stylePool = new StylePool()
    const updater = new LogUpdate({ stylePool, isTTY: true })
    const prev = makeFrame(stylePool, 80, 38, 24, 38, 'A')
    const next = makeFrame(stylePool, 80, 35, 24, 35, 'A')

    const patches = updater.render(prev, next, false)
    expect(patches[0]).toEqual({ type: 'clear', count: 3 })
    expect(patches[1]).toEqual({ type: 'cursorMove', x: 0, y: -1 })
    expect(updater.scrolledOutRowsOf(next)).toBe(15)
  })

  test('main-screen displayCursor does not clamp above viewportTop and ghost subsequent updates', async () => {
    const COLS = 40
    const ROWS = 10
    const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(' '))
    let cx = 0
    let cy = 0
    let pendingWrap = false
    const scrollUp = () => {
      grid.shift()
      grid.push(Array(COLS).fill(' '))
    }
    const feed = (s: string) => {
      let i = 0
      while (i < s.length) {
        const ch = s[i]!
        if (ch === '\x1b') {
          if (s[i + 1] === '[') {
            let j = i + 2
            while (j < s.length && !/[A-Za-z]/.test(s[j]!)) j++
            const params = s.slice(i + 2, j)
            const cmd = s[j]!
            i = j + 1
            if (params.startsWith('?')) continue
            const nums =
              params === ''
                ? []
                : params.split(';').map(x => parseInt(x || '0', 10))
            const n = nums[0] || 1
            if (cmd === 'A') {
              cy = Math.max(0, cy - n)
              pendingWrap = false
            } else if (cmd === 'B') {
              cy = Math.min(ROWS - 1, cy + n)
              pendingWrap = false
            } else if (cmd === 'C') {
              cx = Math.min(COLS - 1, cx + n)
              pendingWrap = false
            } else if (cmd === 'D') {
              cx = Math.max(0, cx - n)
              pendingWrap = false
            } else if (cmd === 'G') {
              cx = Math.max(0, Math.min(COLS - 1, n - 1))
              pendingWrap = false
            } else if (cmd === 'H') {
              cy = Math.max(0, Math.min(ROWS - 1, (nums[0] || 1) - 1))
              cx = Math.max(0, Math.min(COLS - 1, (nums[1] || 1) - 1))
              pendingWrap = false
            } else if (cmd === 'K') {
              const mode = nums[0] || 0
              if (mode === 0) {
                for (let c = cx; c < COLS; c++) grid[cy]![c] = ' '
              } else if (mode === 2) {
                grid[cy]!.fill(' ')
              }
            } else if (cmd === 'J' && (nums[0] || 0) === 2) {
              for (const row of grid) row.fill(' ')
            }
            continue
          }
          i++
          continue
        }
        if (ch === '\r') {
          cx = 0
          pendingWrap = false
          i++
          continue
        }
        if (ch === '\n') {
          pendingWrap = false
          if (cy === ROWS - 1) scrollUp()
          else cy++
          i++
          continue
        }
        if (pendingWrap) {
          cx = 0
          if (cy === ROWS - 1) scrollUp()
          else cy++
          pendingWrap = false
        }
        grid[cy]![cx] = ch
        if (cx === COLS - 1) pendingWrap = true
        else cx++
        i++
      }
    }

    const stdout = new PassThrough() as unknown as NodeJS.WriteStream & {
      columns: number
      rows: number
      isTTY: boolean
    }
    stdout.columns = COLS
    stdout.rows = ROWS
    stdout.isTTY = true
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream
    stdin.isTTY = true
    stdin.setRawMode = () => stdin
    stdout.on('data', (chunk: Buffer) => feed(chunk.toString('utf8')))

    let setState!: React.Dispatch<
      React.SetStateAction<{ tailCount: number; sel: 1 | 2 }>
    >
    function Harness() {
      const [state, _setState] = React.useState<{
        tailCount: number
        sel: 1 | 2
      }>({ tailCount: 8, sel: 1 })
      setState = _setState
      // Declare cursor near row 6 — above viewportTop when height=20 (viewportTop=11)
      const cursorRef = useDeclaredCursor({ line: 0, column: 0, active: true })
      return React.createElement(
        Box,
        { flexDirection: 'column' },
        ...Array.from({ length: 6 }, (_, i) =>
          React.createElement(Text, { key: `top-${i}` }, `top ${i}`),
        ),
        React.createElement(
          Box,
          { ref: cursorRef },
          React.createElement(Text, null, 'anchored header'),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          React.createElement(Text, { key: `mid-${i}` }, `mid ${i}`),
        ),
        React.createElement(
          Text,
          null,
          state.sel === 1 ? '> 1. Yes' : '  1. Yes',
        ),
        React.createElement(
          Text,
          null,
          state.sel === 2 ? '> 2. No' : '  2. No',
        ),
        ...Array.from({ length: state.tailCount }, (_, i) =>
          React.createElement(Text, { key: `tail-${i}` }, `tail ${i}`),
        ),
      )
    }

    const inst = await render(React.createElement(Harness), {
      stdout,
      stdin,
      patchConsole: false,
    })
    await new Promise(r => setTimeout(r, 80))

    // Shrink tail 8 -> 2 while scrollback holds viewportTop=13 (cursorRef at y=6 < 13)
    setState({ tailCount: 2, sel: 1 })
    await new Promise(r => setTimeout(r, 80))

    // Toggle selection Down then Up — must not duplicate "> 1. Yes" / "  2. No"
    setState({ tailCount: 2, sel: 2 })
    await new Promise(r => setTimeout(r, 80))
    setState({ tailCount: 2, sel: 1 })
    await new Promise(r => setTimeout(r, 80))

    inst.unmount()

    const visible = grid.map(r => r.join('').trimEnd())
    const yesRows = visible.filter(l => l.includes('1. Yes'))
    const noRows = visible.filter(l => l.includes('2. No'))
    expect(yesRows).toEqual(['> 1. Yes'])
    expect(noRows).toEqual(['  2. No'])
  })
})
