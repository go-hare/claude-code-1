/**
 * DEC (Digital Equipment Corporation) Private Mode Sequences
 *
 * DEC private modes use CSI ? N h (set) and CSI ? N l (reset) format.
 * These are terminal-specific extensions to the ANSI standard.
 */

import { csi } from './csi.js'

/**
 * DEC private mode numbers
 */
export const DEC = {
  CURSOR_VISIBLE: 25,
  ALT_SCREEN: 47,
  ALT_SCREEN_CLEAR: 1049,
  MOUSE_NORMAL: 1000,
  MOUSE_BUTTON: 1002,
  MOUSE_ANY: 1003,
  MOUSE_SGR: 1006,
  FOCUS_EVENTS: 1004,
  BRACKETED_PASTE: 2004,
  SYNCHRONIZED_UPDATE: 2026,
} as const

/** Generate CSI ? N h sequence (set mode) */
export function decset(mode: number): string {
  return csi(`?${mode}h`)
}

/** Generate CSI ? N l sequence (reset mode) */
export function decreset(mode: number): string {
  return csi(`?${mode}l`)
}

// Pre-generated sequences for common modes
export const BSU = decset(DEC.SYNCHRONIZED_UPDATE)
export const ESU = decreset(DEC.SYNCHRONIZED_UPDATE)
export const EBP = decset(DEC.BRACKETED_PASTE)
export const DBP = decreset(DEC.BRACKETED_PASTE)
export const EFE = decset(DEC.FOCUS_EVENTS)
export const DFE = decreset(DEC.FOCUS_EVENTS)
export const SHOW_CURSOR = decset(DEC.CURSOR_VISIBLE)
export const HIDE_CURSOR = decreset(DEC.CURSOR_VISIBLE)
export const ENTER_ALT_SCREEN = decset(DEC.ALT_SCREEN_CLEAR)
export const EXIT_ALT_SCREEN = decreset(DEC.ALT_SCREEN_CLEAR)

/** Official alt-screen entry wrapper: enter, clear, home, then restore extended keys. */
export function enterAltScreenSequence(extendedKeys = false): string {
  return (
    ENTER_ALT_SCREEN +
    csi('2J') +
    csi('H') +
    (extendedKeys ? csi('<u') + csi('>1u') + csi('>4;2m') : '')
  )
}

/** Official alt-screen exit wrapper: pop Kitty, restore main screen, reset modifyOtherKeys. */
export function exitAltScreenSequence(): string {
  return csi('<u') + EXIT_ALT_SCREEN + csi('>4m')
}
// Mouse tracking: 1000 reports button press/release/wheel, 1002 adds drag
// events (button-motion), 1003 adds all-motion (no button held — for
// hover), 1006 uses SGR format (CSI < btn;col;row M/m) instead of legacy
// X10 bytes.
//
// Official densable S5e / c_g / u_g (2.1.211):
//   full   = 1000 + 1002 + 1003 + 1006  (wheel + click/drag + hover)
//   scroll = 1000 + 1006                 (wheel only — no button-motion/any)
//   off    = ""
// Apple Terminal + full any-motion floods SGR during scroll-over-input and
// desyncs more easily; callers should pass mode from resolveMouseTrackingMode.
export type MouseTrackingMode = 'off' | 'scroll' | 'full'

/** Official densable c_g — full mouse tracking. */
export const ENABLE_MOUSE_TRACKING =
  decset(DEC.MOUSE_NORMAL) +
  decset(DEC.MOUSE_BUTTON) +
  decset(DEC.MOUSE_ANY) +
  decset(DEC.MOUSE_SGR)

/** Official densable u_g — wheel/button press only (no 1002/1003). */
export const ENABLE_MOUSE_TRACKING_SCROLL =
  decset(DEC.MOUSE_NORMAL) + decset(DEC.MOUSE_SGR)

/** Official densable vge — disable all mouse modes we enable. */
export const DISABLE_MOUSE_TRACKING =
  decreset(DEC.MOUSE_SGR) +
  decreset(DEC.MOUSE_ANY) +
  decreset(DEC.MOUSE_BUTTON) +
  decreset(DEC.MOUSE_NORMAL)

/** Official densable S5e(mode) — enable sequence for a tracking mode. */
export function enableMouseTracking(mode: MouseTrackingMode): string {
  switch (mode) {
    case 'full':
      return ENABLE_MOUSE_TRACKING
    case 'scroll':
      return ENABLE_MOUSE_TRACKING_SCROLL
    case 'off':
      return ''
  }
}
