import { describe, expect, test } from 'bun:test'
import {
  formatTuiRelaunchFailedMessage,
  TUI_RELAUNCH_FAILED_OFF_BOX,
} from '../index.js'

describe('/tui relaunch error formatting #372', () => {
  test('formats local relaunch error without exiting silently', () => {
    expect(formatTuiRelaunchFailedMessage('ENOENT', false)).toBe(
      "Couldn't switch renderers — ENOENT. The setting was saved; restart Claude Code to apply it.",
    )
  })

  test('withholds raw system error detail on off-box connections', () => {
    expect(formatTuiRelaunchFailedMessage('ENOENT', true)).toBe(
      TUI_RELAUNCH_FAILED_OFF_BOX,
    )
  })
})
