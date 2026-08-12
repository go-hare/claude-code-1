/**
 * densable Gsn() — OSC 52 toast hold-key labels.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { getNativeSelectionHoldKey } from '../ScrollKeybindingHandler.js'

describe('densable Gsn getNativeSelectionHoldKey', () => {
  const prevTerm = process.env.TERM_PROGRAM
  const prevLc = process.env.LC_TERMINAL
  const prevSsh = process.env.SSH_CONNECTION
  const prevTmux = process.env.TMUX
  const prevSty = process.env.STY

  afterEach(() => {
    if (prevTerm === undefined) delete process.env.TERM_PROGRAM
    else process.env.TERM_PROGRAM = prevTerm
    if (prevLc === undefined) delete process.env.LC_TERMINAL
    else process.env.LC_TERMINAL = prevLc
    if (prevSsh === undefined) delete process.env.SSH_CONNECTION
    else process.env.SSH_CONNECTION = prevSsh
    if (prevTmux === undefined) delete process.env.TMUX
    else process.env.TMUX = prevTmux
    if (prevSty === undefined) delete process.env.STY
    else process.env.STY = prevSty
  })

  test('Apple_Terminal → Fn', () => {
    process.env.TERM_PROGRAM = 'Apple_Terminal'
    delete process.env.SSH_CONNECTION
    delete process.env.TMUX
    expect(getNativeSelectionHoldKey()).toBe('Fn')
  })

  test('iTerm.app → Option', () => {
    process.env.TERM_PROGRAM = 'iTerm.app'
    expect(getNativeSelectionHoldKey()).toBe('Option')
  })

  test('ghostty / kitty → Shift', () => {
    process.env.TERM_PROGRAM = 'ghostty'
    expect(getNativeSelectionHoldKey()).toBe('Shift')
    process.env.TERM_PROGRAM = 'kitty'
    expect(getNativeSelectionHoldKey()).toBe('Shift')
  })

  test('LC_TERMINAL=iTerm2 → Option', () => {
    delete process.env.TERM_PROGRAM
    process.env.LC_TERMINAL = 'iTerm2'
    delete process.env.SSH_CONNECTION
    delete process.env.TMUX
    // On macos without known term, densable still may return long Shift hint
    // when Wt()==macos; LC_TERMINAL check is before that.
    expect(getNativeSelectionHoldKey()).toBe('Option')
  })
})
