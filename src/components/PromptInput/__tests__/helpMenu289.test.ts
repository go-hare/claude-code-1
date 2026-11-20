import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { formatEffortShortcutPair } from '../PromptInputHelpMenu.js'
import { resolveQueuedSendNowLayout } from '../PromptInputQueuedCommands.js'

describe('2.1.328 PromptInputHelpMenu (gln) & PromptInputQueuedCommands (wVe)', () => {
  test('gln copy, effort shortcut row, row layout, and active-panel gating', () => {
    const src = readFileSync(
      join(import.meta.dir, '../PromptInputHelpMenu.tsx'),
      'utf8',
    )
    expect(src).toContain('! for shell mode')
    expect(src).not.toContain('! for bash mode')
    expect(src).not.toContain('& for background')
    expect(src).toContain('shortcut="escape escape"')
    expect(src).toContain('action="clear input"')
    expect(src).not.toContain('double tap esc to clear input')
    expect(src).toContain('action="cycle modes"')
    expect(src).not.toContain('auto-accept edits')
    expect(src).toContain('action="see full transcript"')
    expect(src).not.toContain('for verbose output')
    // Effort shortcut row sits between cycle modes and see full transcript
    const cycleIdx = src.indexOf('action="cycle modes"')
    const effortIdx = src.indexOf('<EffortShortcutHint')
    const transcriptIdx = src.indexOf('action="see full transcript"')
    expect(cycleIdx).toBeGreaterThan(0)
    expect(effortIdx).toBeGreaterThan(cycleIdx)
    expect(transcriptIdx).toBeGreaterThan(effortIdx)
    // No misapplied short-window hiding or narrow vertical column stacking
    expect(src).not.toContain('isShortWindow')
    expect(src).not.toContain('isShortFullscreen')
    expect(src).not.toContain("isNarrow ? 'column' : 'row'")
    expect(src).toContain('<Box flexDirection="row" gap={gap}>')
    // Panel shortcuts gated on open panels
    expect(src).toContain('getPanesState().open.length > 0')
  })

  test('formatEffortShortcutPair matches official a_e formatting', () => {
    expect(formatEffortShortcutPair('shift+up', 'shift+down')).toBe('shift+↑/↓')
    expect(formatEffortShortcutPair('ctrl+x =', 'ctrl+x -')).toBe('ctrl+x =/-')
  })

  test('footer bash pill is shell mode', () => {
    const src = readFileSync(
      join(import.meta.dir, '../PromptInputFooterLeftSide.tsx'),
      'utf8',
    )
    expect(src).toContain('! for shell mode')
    expect(src).not.toContain('! for bash mode')
  })

  test('wVe resolveQueuedSendNowLayout omits Queued prefix when narrow', () => {
    const wide = resolveQueuedSendNowLayout('ctrl+enter', 80)
    expect(wide).toEqual({
      hintText: 'ctrl+enter to send now',
      showQueuedPrefix: true,
      paddingLeft: 0,
    })

    // "  ⎿  Queued · ctrl+enter to send now" is 36 cols; 30 cols must drop prefix
    const narrow = resolveQueuedSendNowLayout('ctrl+enter', 30)
    expect(narrow).toEqual({
      hintText: 'ctrl+enter to send now',
      showQueuedPrefix: false,
      paddingLeft: 2,
    })

    const clickOnly = resolveQueuedSendNowLayout('', 40)
    expect(clickOnly).toEqual({
      hintText: 'click to send now',
      showQueuedPrefix: true,
      paddingLeft: 0,
    })
  })
})
