/**
 * Cross-platform terminal clearing with scrollback support.
 * densable clearTerminal.ts (pj8 / F35 / Bj8) 1:1.
 */

import {
  CURSOR_HOME,
  cursorDown,
  csi,
  ERASE_LINE,
  ERASE_SCREEN,
  ERASE_SCROLLBACK,
  eraseToEndOfLine,
} from './termio/csi.js'
import { Jk } from './terminalCapabilities.js'

// HVP (Horizontal Vertical Position) - legacy Windows cursor home
const CURSOR_HOME_WINDOWS = csi(0, 'f')

function isWindowsTerminal(): boolean {
  return process.platform === 'win32' && !!process.env.WT_SESSION
}

function isMintty(): boolean {
  // mintty 3.1.5+ sets TERM_PROGRAM to 'mintty'
  if (process.env.TERM_PROGRAM === 'mintty') {
    return true
  }
  // GitBash/MSYS2/MINGW use mintty and set MSYSTEM
  if (process.platform === 'win32' && process.env.MSYSTEM) {
    return true
  }
  return false
}

function isModernWindowsTerminal(): boolean {
  // Windows Terminal sets WT_SESSION environment variable
  if (isWindowsTerminal()) {
    return true
  }

  // VS Code integrated terminal on Windows with ConPTY support
  if (
    process.platform === 'win32' &&
    process.env.TERM_PROGRAM === 'vscode' &&
    process.env.TERM_PROGRAM_VERSION
  ) {
    return true
  }

  // mintty (GitBash/MSYS2/Cygwin) supports modern escape sequences
  if (isMintty()) {
    return true
  }

  return false
}

/**
 * densable pj8 / getClearTerminalSequence — CSI 2 J + CSI 3 J + CSI H.
 * Alt-screen fullReset path uses this (densable writeDiff clearTerminal branch).
 * Windows legacy console cannot clear scrollback (CSI 3 J no-op / HVP home).
 */
export function getClearTerminalSequence(): string {
  if (process.platform === 'win32') {
    if (isModernWindowsTerminal()) {
      return ERASE_SCREEN + ERASE_SCROLLBACK + CURSOR_HOME
    }
    // Legacy Windows console - can't clear scrollback
    return ERASE_SCREEN + CURSOR_HOME_WINDOWS
  }
  return ERASE_SCREEN + ERASE_SCROLLBACK + CURSOR_HOME
}

/**
 * densable F35 / getEraseScreenSequence — CSI 2 J + CSI H (no scrollback wipe).
 */
export function getEraseScreenSequence(): string {
  return ERASE_SCREEN + CURSOR_HOME
}

/**
 * Official 2.1.327 (#451): Ghostty keeps soft-wrap join bits across `CSI 2 K`
 * (`erasedRowsStayJoined: true`), so resizing after a full-line erase pushes
 * erased rows into scrollback. Detect Ghostty via env or XTVERSION probe.
 */
export function isGhosttyErasedRowsStayJoined(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.TERM === 'xterm-ghostty' || env.TERM_PROGRAM === 'ghostty') {
    return true
  }
  return Jk().xtversionName?.toLowerCase().startsWith('ghostty') ?? false
}

/**
 * Official 2.1.327 `uPr` (#451): Ghostty-safe viewport erase that clears
 * row 0 with `CSI 2 K` and each row with `CSI K` (`eraseToEndOfLine`) +
 * `CSI 1 B` so erased rows do not stay soft-wrap joined on resize.
 */
export function eraseViewportInPlaceForGhostty(rows: number): string {
  if (rows <= 0) return CURSOR_HOME
  const step = eraseToEndOfLine() + cursorDown(1)
  return CURSOR_HOME + ERASE_LINE + step.repeat(rows) + CURSOR_HOME
}

/**
 * densable Bj8 / eWe + Official 2.1.327 uPr (#451) — main-screen fullReset
 * without wiping scrollback: home, erase each viewport line, home again.
 * On Ghostty (`erasedRowsStayJoined`), uses `uPr` (`CSI K` per row) so
 * subsequent resizes do not push erased lines into scrollback.
 */
export function eraseViewportInPlace(
  rows: number,
  erasedRowsStayJoined = isGhosttyErasedRowsStayJoined(),
): string {
  if (rows <= 0) return CURSOR_HOME
  if (erasedRowsStayJoined) {
    return eraseViewportInPlaceForGhostty(rows)
  }
  // densable: rM+(EwH+nw8(1)).repeat(H)+rM  — ERASE_LINE then CUD 1 per row
  let body = ''
  for (let i = 0; i < rows; i++) {
    body += ERASE_LINE + cursorDown(1)
  }
  return CURSOR_HOME + body + CURSOR_HOME
}

/**
 * Clears the terminal screen. On supported terminals, also clears scrollback.
 */
export const clearTerminal = getClearTerminalSequence()
