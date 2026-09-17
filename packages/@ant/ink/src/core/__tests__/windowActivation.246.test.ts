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
})
