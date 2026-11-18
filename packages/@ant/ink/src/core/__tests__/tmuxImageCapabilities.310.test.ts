import { describe, expect, test } from 'bun:test'
import {
  defaultCapabilityReadings,
  evaluateTmuxImageCapabilities,
  isTmuxPaneFresh,
  parseTmuxPaneInfo,
  TerminalCapabilityStore,
  TMUX_PANE_STALE_MS,
} from '../terminalCapabilities.js'

describe('tmux image capabilities (2.1.310 #1206)', () => {
  test('kittyGraphicsSeed stays pending inside tmux so probe can settle it', () => {
    const prevTmux = process.env.TMUX
    const prevSty = process.env.STY
    const prevForce = process.env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    delete process.env.STY
    delete process.env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES
    try {
      const store = new TerminalCapabilityStore(defaultCapabilityReadings())
      expect(store.get('kittyGraphics')).toEqual({
        state: 'pending',
        likely: false,
        source: 'env: inside tmux, not asked yet',
      })
    } finally {
      if (prevTmux === undefined) delete process.env.TMUX
      else process.env.TMUX = prevTmux
      if (prevSty !== undefined) process.env.STY = prevSty
      if (prevForce !== undefined) {
        process.env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES = prevForce
      }
    }
  })

  test('parseTmuxPaneInfo parses passthrough, focus-events, isPlaced, and top status offset', () => {
    const parsed = parseTmuxPaneInfo('ghostty\ton\t1\t2\t4\t2\ttop\t0\n')
    expect(parsed).toEqual({
      termtype: 'ghostty',
      pane: {
        passthrough: 'on',
        hasFocusEvents: true,
        isPlaced: true,
        top: 4, // pane_top=2 + status=2 at top
        left: 4,
      },
      hasPassthroughOption: true,
    })

    const bigger = parseTmuxPaneInfo(
      'iTerm2 3.5.5\tall\t1\t0\t0\toff\tbottom\t1',
    )
    expect(bigger?.pane.passthrough).toBe('all')
    expect(bigger?.pane.isPlaced).toBe(false)
    expect(bigger?.pane.top).toBe(0)
  })

  test('evaluateTmuxImageCapabilities handles kitty, Ghostty, and iTerm2 3.5+', () => {
    const ghosttyOn = parseTmuxPaneInfo(
      'ghostty 1.0.0\ton\t1\t0\t0\ton\tbottom\t0',
    )
    expect(
      evaluateTmuxImageCapabilities(ghosttyOn, {
        versionName: 'tmux 3.4',
        hasPane: true,
      }),
    ).toMatchObject({
      kittyGraphics: { value: true },
      itermImages: { value: false },
    })

    const kittyOn = parseTmuxPaneInfo(
      'kitty(0.35.0)\tall\t1\t0\t0\ton\tbottom\t0',
    )
    expect(
      evaluateTmuxImageCapabilities(kittyOn, {
        versionName: 'tmux 3.4',
        hasPane: true,
      }),
    ).toMatchObject({
      kittyGraphics: { value: true },
      itermImages: { value: false },
    })

    const itermOn = parseTmuxPaneInfo(
      'iTerm2 3.5.1\ton\t1\t1\t0\ton\tbottom\t0',
    )
    expect(
      evaluateTmuxImageCapabilities(itermOn, {
        versionName: 'tmux 3.4',
        hasPane: true,
      }),
    ).toMatchObject({
      kittyGraphics: { value: false },
      itermImages: { value: true },
    })

    const itermAll = parseTmuxPaneInfo(
      'iTerm2 3.5.1\tall\t1\t0\t0\ton\tbottom\t0',
    )
    expect(
      evaluateTmuxImageCapabilities(itermAll, {
        versionName: 'tmux 3.4',
        hasPane: true,
      }),
    ).toMatchObject({
      kittyGraphics: { value: false },
      itermImages: { value: false },
    })

    const itermNotPlaced = parseTmuxPaneInfo(
      'iTerm2 3.5.1\ton\t1\t0\t0\ton\tbottom\t1',
    )
    expect(
      evaluateTmuxImageCapabilities(itermNotPlaced, {
        versionName: 'tmux 3.4',
        hasPane: true,
      }).itermImages.value,
    ).toBe(false)

    const noFocusEvents = parseTmuxPaneInfo(
      'ghostty\ton\t0\t0\t0\ton\tbottom\t0',
    )
    expect(
      evaluateTmuxImageCapabilities(noFocusEvents, {
        versionName: 'tmux 3.4',
        hasPane: true,
      }),
    ).toMatchObject({
      kittyGraphics: { value: false },
      itermImages: { value: false },
    })
  })

  test('isTmuxPaneFresh enforces 1500ms staleness window', () => {
    expect(isTmuxPaneFresh(false, undefined, 1000)).toBe(true)
    expect(isTmuxPaneFresh(true, undefined, 1000)).toBe(false)
    expect(isTmuxPaneFresh(true, 1000, 1000 + TMUX_PANE_STALE_MS)).toBe(true)
    expect(isTmuxPaneFresh(true, 1000, 1000 + TMUX_PANE_STALE_MS + 1)).toBe(
      false,
    )
  })
})
