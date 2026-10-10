/**
 * densable 2.1.246 #32 — official click-to-focus latch.
 *
 * Official dD / InternalApp @209913819:
 *   pressIsWindowActivation = consumeWindowActivationLatch(f) && f-OE()<GE
 *   GE=400  vy=300
 *   handleTerminalFocus: if(!e||now-lastActivationInputTime>=GE)
 *     windowActivationClickArmed=true
 *
 * 246 also wires pendingHyperlinkOpensInPanel / onSelectionStart.
 * Open chain: `(button&24) || macCmdClick || ME()`; ME = isGhosttyXtversion.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import App, {
  macCmdClickArrivesWithoutSgrModifierBit,
  WINDOW_ACTIVATION_GRACE_MS,
} from '../../components/App.js'
import { MOUNT_SETTLE_MS } from '../events/click-event.js'

const src = readFileSync(
  join(import.meta.dir, '../../components/App.tsx'),
  'utf8',
)
const ink = readFileSync(join(import.meta.dir, '../ink.tsx'), 'utf8')
const click = readFileSync(
  join(import.meta.dir, '../events/click-event.ts'),
  'utf8',
)

describe('densable 2.1.246 #32 window-activation click', () => {
  test('source-locks official GE=400 latch formula', () => {
    expect(WINDOW_ACTIVATION_GRACE_MS).toBe(400)
    expect(MOUNT_SETTLE_MS).toBe(300)
    expect(src).toContain('pressIsWindowActivation')
    expect(src).toContain('consumeWindowActivationLatch(now)')
    expect(src).toContain(
      'now - getTerminalFocusGainedAt() < WINDOW_ACTIVATION_GRACE_MS',
    )
    expect(src).toContain(
      'Date.now() - this.lastActivationInputTime >= WINDOW_ACTIVATION_GRACE_MS',
    )
    expect(src).toContain('windowActivationClickArmed = true')
    expect(src).toContain('onMouseAction')
    expect(typeof App.prototype.consumeWindowActivationLatch).toBe('function')
  })

  test('source-locks pendingHyperlinkOpensInPanel and onSelectionStart', () => {
    expect(src).toContain('pendingHyperlinkOpensInPanel')
    expect(src).toContain('onSelectionStart')
    expect(src).toContain('macCmdClickArrivesWithoutSgrModifierBit')
    expect(typeof macCmdClickArrivesWithoutSgrModifierBit).toBe('function')
    expect(src).toContain('(m.button & 24) !== 0')
    expect(src).toContain('isGhosttyXtversion()')
  })

  test('gold Yd: non-hover mouse press synthesizes handleTerminalFocus when blurred', () => {
    expect(src).toContain("item.kind === 'mouse'")
    expect(src).toContain("item.action === 'press'")
    expect(src).toContain(
      '!((item.button & 0x20) !== 0 && (item.button & 0x03) === 3)',
    )
    expect(src).toContain('!getTerminalFocused()')
    expect(src).toContain('app.handleTerminalFocus(true)')
  })

  test('gold onClickAt passes Ir mods; stray or repeat resets clickCount', () => {
    expect(src).toContain('sgrButtonMods(m.button)')
    expect(src).toContain("clickResult === 'stray' || clickResult === 'repeat'")
    expect(ink).toContain(
      "if (handled && event.endsClickChain) return 'repeat'",
    )
    expect(click).toContain('endClickChain()')
    expect(click).toContain(
      "export type MouseClickResult = 'stray' | 'handled' | 'unhandled' | 'repeat'",
    )
    expect(ink).toContain('cellIsBlankForHover')
    expect(ink).toContain('litWhereClicked')
    expect(ink).toContain('hoverIgnoresBlankCells')
    const hit = readFileSync(join(import.meta.dir, '../hit-test.ts'), 'utf8')
    expect(hit).toContain('export function cellIsBlankForHover')
    expect(ink).toContain('endPointerCapture()')
    expect(ink).toContain('staleAbsolutePaint')
  })
})
