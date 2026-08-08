import { describe, expect, test } from 'bun:test'
import {
  CharPool,
  createScreen,
  fillFullRepaintSentinel,
  HyperlinkPool,
  StylePool,
} from '../screen.js'

describe('densable CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT ($n9 sentinel)', () => {
  test('fillFullRepaintSentinel sets every cell charId to spacer (1)', () => {
    const styles = new StylePool()
    const chars = new CharPool()
    const links = new HyperlinkPool()
    const screen = createScreen(4, 2, styles, chars, links)
    // Unwritten cells start as charId 0
    expect(screen.cells[0]).toBe(0)
    fillFullRepaintSentinel(screen)
    for (let i = 0; i < screen.cells.length; i += 2) {
      expect(screen.cells[i]).toBe(1) // SPACER_CHAR_INDEX
      expect(screen.cells[i + 1]).toBe(0) // empty style / no link / narrow
    }
  })
})
