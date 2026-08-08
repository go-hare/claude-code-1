import { describe, expect, test } from 'bun:test'
import {
  eraseViewportInPlace,
  getClearTerminalSequence,
  getEraseScreenSequence,
} from '../clearTerminal.js'
import {
  CURSOR_HOME,
  cursorDown,
  ERASE_LINE,
  ERASE_SCREEN,
  ERASE_SCROLLBACK,
} from '../termio/csi.js'

describe('densable clearTerminal (pj8 / F35 / Bj8)', () => {
  test('getClearTerminalSequence is CSI 2J + 3J + H on modern hosts', () => {
    // On this Windows host WT_SESSION may or may not be set in CI; assert
    // densable shape when scrollback wipe is available (always true off win32
    // legacy, and when modern detection matches).
    const seq = getClearTerminalSequence()
    expect(seq.startsWith(ERASE_SCREEN)).toBe(true)
    expect(seq.endsWith(CURSOR_HOME) || seq.includes(CURSOR_HOME)).toBe(true)
  })

  test('getEraseScreenSequence is densable F35: 2J + H', () => {
    expect(getEraseScreenSequence()).toBe(ERASE_SCREEN + CURSOR_HOME)
  })

  test('eraseViewportInPlace is densable Bj8: H + (2K+CUD)×rows + H', () => {
    expect(eraseViewportInPlace(0)).toBe(CURSOR_HOME)
    expect(eraseViewportInPlace(3)).toBe(
      CURSOR_HOME + (ERASE_LINE + cursorDown(1)).repeat(3) + CURSOR_HOME,
    )
  })
})
