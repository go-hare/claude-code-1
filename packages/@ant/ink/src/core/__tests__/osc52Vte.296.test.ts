import { afterEach, describe, expect, test } from 'bun:test'
import {
  _resetClipboardHostPlatformCache,
  hasUnknownSequencePrintingBug,
  isVteBasedTerminal,
  setClipboard,
  setClipboardAttacherCapsGetter,
} from '../termio/osc.js'

describe('2.1.296 #502 VTE OSC 52 suppression', () => {
  const savedEnv = { ...process.env }

  afterEach(() => {
    setClipboardAttacherCapsGetter(null)
    _resetClipboardHostPlatformCache()
    for (const k of Object.keys(process.env)) {
      if (!(k in savedEnv)) delete process.env[k]
    }
    Object.assign(process.env, savedEnv)
  })

  test('isVteBasedTerminal matches gnome-terminal/vte-based with xterm TERM and no mux/override', () => {
    const vteEnv = {
      VTE_VERSION: '5202',
      TERM: 'xterm-256color',
    } as NodeJS.ProcessEnv
    expect(isVteBasedTerminal('vte-based', vteEnv)).toBe(true)
    expect(isVteBasedTerminal('gnome-terminal', vteEnv)).toBe(true)
    expect(isVteBasedTerminal('kitty', vteEnv)).toBe(false)
    expect(
      isVteBasedTerminal('vte-based', { ...vteEnv, TMUX: '/tmp/tmux' }),
    ).toBe(false)
    expect(
      isVteBasedTerminal('vte-based', { ...vteEnv, KITTY_WINDOW_ID: '1' }),
    ).toBe(false)
  })

  test('hasUnknownSequencePrintingBug is true only for VTE_VERSION < 5300', () => {
    expect(
      hasUnknownSequencePrintingBug('vte-based', {
        VTE_VERSION: '5202',
        TERM: 'xterm-256color',
      }),
    ).toBe(true)
    expect(
      hasUnknownSequencePrintingBug('vte-based', {
        VTE_VERSION: '5300',
        TERM: 'xterm-256color',
      }),
    ).toBe(false)
  })

  test('setClipboard returns empty string when printsUnknownSequences is true', async () => {
    setClipboardAttacherCapsGetter(() => ({
      mux: null,
      ssh: true,
      printsUnknownSequences: true,
    }))
    const seq = await setClipboard('hello mate')
    expect(seq).toBe('')
  })

  test('setClipboard emits OSC 52 over SSH when VTE bug is false', async () => {
    setClipboardAttacherCapsGetter(() => ({
      mux: null,
      ssh: true,
      printsUnknownSequences: false,
      terminal: 'iTerm.app',
    }))
    const seq = await setClipboard('hello')
    expect(seq).toContain(']52;c;')
  })
})
