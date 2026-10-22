import { useContext, useEffect } from 'react'
import stripAnsi from 'strip-ansi'
import { CLEAR_TERMINAL_TITLE, OSC, osc } from '../core/termio/osc.js'
import { TerminalWriteContext } from './useTerminalNotification.js'

type WriteRaw = ((data: string) => void) | null

/**
 * densable `phe` — gold: `if(o===null||!r)return; r(Xh(SET_TITLE_AND_ICON, tn(o)))`.
 * No win32 `process.title` analog (gold hits 0).
 */
export function applyTerminalTitle(clean: string, writeRaw: WriteRaw): void {
  if (!writeRaw) return
  writeRaw(osc(OSC.SET_TITLE_AND_ICON, clean))
}

/**
 * Inverse of densable `phe` — OSC 0 empty + BEL.
 */
export function clearTerminalTitle(writeRaw: WriteRaw): void {
  if (!writeRaw) return
  writeRaw(CLEAR_TERMINAL_TITLE)
}

/**
 * Declaratively set the terminal tab/window title.
 *
 * densable `phe`. Pass `null` to opt out.
 */
export function useTerminalTitle(title: string | null): void {
  const writeRaw = useContext(TerminalWriteContext)

  useEffect(() => {
    if (title === null || !writeRaw) return
    applyTerminalTitle(stripAnsi(title), writeRaw)
  }, [title, writeRaw])
}
