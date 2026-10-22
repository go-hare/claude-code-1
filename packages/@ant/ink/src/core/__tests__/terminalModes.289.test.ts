import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { restoreTerminalModes, TerminalModes } from '../terminalModes.js'
import {
  DISABLE_MOUSE_TRACKING,
  EFE,
  ENABLE_MOUSE_TRACKING,
  SHOW_CURSOR,
} from '../termio/dec.js'
import { OSC, osc } from '../termio/osc.js'

describe('densable 2.1.289 dqe TerminalModes', () => {
  test('suspend sets isSuspended; set/reset emit empty while suspended', () => {
    const modes = new TerminalModes()
    expect(modes.isSuspended).toBe(false)
    modes.set('bracketedPaste')
    const off = modes.suspend()
    expect(modes.isSuspended).toBe(true)
    expect(off.length).toBeGreaterThan(0)
    expect(modes.set('focusEvents')).toBe('')
    expect(modes.reset('bracketedPaste')).toBe('')
    const on = modes.resume()
    expect(modes.isSuspended).toBe(false)
    // reset() while suspended still removes the entry; resume re-emits remaining.
    expect(on).toContain(EFE)
  })

  test('mouse set/reset match tracking sequences', () => {
    const modes = new TerminalModes()
    expect(modes.set('mouse', 'full')).toBe(ENABLE_MOUSE_TRACKING)
    expect(modes.reset('mouse')).toBe(DISABLE_MOUSE_TRACKING)
  })

  test('altScreen also pushes altScreenKeys', () => {
    const modes = new TerminalModes()
    const on = modes.set('altScreen')
    expect(on).toContain('\x1b[?1049h')
    expect(modes.isSet('altScreen')).toBe(true)
    expect(modes.isSet('altScreenKeys')).toBe(true)
    const off = modes.reset('altScreen')
    expect(off).toContain('\x1b[?1049l')
    expect(modes.isSet('altScreen')).toBe(false)
    expect(modes.isSet('altScreenKeys')).toBe(false)
  })

  test('surface object uses T on seq; reset uses x off; set without object on is empty', () => {
    const colors = { background: '#111111', foreground: '#eeeeee' }
    const on =
      osc(OSC.SET_BG_COLOR, colors.background) +
      osc(OSC.SET_FG_COLOR, colors.foreground)
    const off = osc(OSC.RESET_BG_COLOR) + osc(OSC.RESET_FG_COLOR)

    const modes = new TerminalModes()
    expect(modes.set('surface', colors)).toBe(on)
    expect(modes.reset('surface')).toBe(off)

    const bare = new TerminalModes()
    expect(bare.set('surface')).toBe('')
    expect(bare.reset('surface')).toBe(off)
  })

  test('restoreTerminalModes wDn is G0 + extras + CSI r wrapped in save/restore', () => {
    const modes = new TerminalModes()
    let wrote = ''
    restoreTerminalModes(modes, seq => {
      wrote = seq
    })
    expect(wrote).toContain('\x1b(B\x0f')
    expect(wrote).toContain('\x1b7')
    expect(wrote).toContain('\x1b[r')
    expect(wrote).toContain('\x1b8')
    expect(wrote).toContain(SHOW_CURSOR)
    expect(wrote).toContain(DISABLE_MOUSE_TRACKING)
  })

  test('wDn kitty pop is eAe not a bare DISABLE_KITTY_KEYBOARD', async () => {
    const src = await Bun.file(
      join(import.meta.dir, '../terminalModes.ts'),
    ).text()
    expect(src).toContain('kittyKeyboardPopSeq()')
    expect(src).not.toContain("hadExtendedKeys ? '' : DISABLE_KITTY_KEYBOARD")
  })
})
