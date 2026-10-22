/**
 * densable `watchSystemTheme` — OSC 11 poll plus DEC 2031 re-query.
 *
 * Mux (tmux/screen, not iTerm -CC) wraps the first query in DCS and races
 * a 2000ms unref timeout. No reply falls back to a bare OSC 11. A missing
 * reply sets `osc11Responsive` false so the next mount skips the initial
 * poll. DEC 2031 while alt-screen (surface) is active applies dark/light
 * directly and skips OSC 11.
 */

import type { Dispatch, SetStateAction } from 'react'
import { waitUntilAttachStable } from '../src/core/attachStamp.js'
import {
  getTerminalFocusState,
  subscribeTerminalFocus,
} from '../src/core/terminal-focus-state.js'
import instances from '../src/core/instances.js'
import { getOsc11Responsive, setOsc11Responsive } from '../src/core/terminal.js'
import {
  oscColor,
  type TerminalQuerier,
  type TerminalQuery,
} from '../src/core/terminal-querier.js'
import type { TerminalResponse } from '../src/core/parse-keypress.js'
import { wrapForMultiplexer } from '../src/core/termio/osc.js'
import { logForDebugging } from '../src/utils/debug.js'
import {
  setCachedSystemTheme,
  themeFromOscColor,
  type SystemTheme,
} from '../src/theme/systemTheme.js'

const MUX_TIMEOUT_MS = 2000

function sleepUnref(ms: number): Promise<undefined> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(undefined), ms)
    timer.unref?.()
  })
}

/**
 * iTerm `tmux -CC` sets TMUX but the pane is the emulator, so DCS wrap
 * never reaches a multiplexer. Same env heuristic as `isTmuxControlMode`.
 */
function isTmuxControlModeEnv(): boolean {
  if (!process.env.TMUX) return false
  if (process.env.TERM_PROGRAM !== 'iTerm.app') return false
  const term = process.env.TERM ?? ''
  return !term.startsWith('screen') && !term.startsWith('tmux')
}

export function watchSystemTheme(
  querier: TerminalQuerier,
  setTheme: Dispatch<SetStateAction<SystemTheme>>,
  opts?: { muxTimeoutMs?: number },
): () => void {
  let cancelled = false
  let inFlight = false
  const muxTimeoutMs = opts?.muxTimeoutMs ?? MUX_TIMEOUT_MS
  const inMux =
    Boolean(process.env.TMUX || process.env.STY) && !isTmuxControlModeEnv()

  async function poll(): Promise<void> {
    if (inFlight) return
    inFlight = true
    try {
      const bare = oscColor(11)
      const wrapped: TerminalQuery<Extract<TerminalResponse, { type: 'osc' }>> =
        inMux ? { ...bare, request: wrapForMultiplexer(bare.request) } : bare
      let response: Awaited<ReturnType<TerminalQuerier['send']>>
      let path = inMux ? 'dcs' : 'direct'
      if (inMux) {
        response = await Promise.race([
          querier.send(wrapped),
          sleepUnref(muxTimeoutMs),
        ])
        if (!response) {
          querier.cancel(wrapped)
          if (!cancelled) {
            path = 'mux-bare'
            ;[response] = await Promise.all([
              querier.send(bare),
              querier.flush(),
            ])
          }
        }
      } else {
        ;[response] = await Promise.all([
          querier.send(wrapped),
          querier.flush(),
        ])
      }
      if (cancelled) return
      if (!response || response.type !== 'osc') {
        logForDebugging(`watchSystemTheme: no OSC 11 response (${path})`)
        setOsc11Responsive(false)
        return
      }
      setOsc11Responsive(true)
      const theme = themeFromOscColor(response.data)
      if (theme === undefined) return
      setCachedSystemTheme(theme)
      setTheme(theme)
    } finally {
      inFlight = false
    }
  }

  const daemon = process.env.CLAUDE_BG_BACKEND === 'daemon'
  if (getOsc11Responsive() !== false && !daemon) void poll()

  const unsubTheme = querier.subscribeThemeChange(dark => {
    const ink = instances.get(process.stdout)
    if (ink?.isAltScreenActive) {
      const theme = dark ? 'dark' : 'light'
      setCachedSystemTheme(theme)
      setTheme(theme)
      return
    }
    void poll()
  })
  const unsubFocus = daemon
    ? subscribeTerminalFocus(() => {
        if (getTerminalFocusState() !== 'focused') return
        void waitUntilAttachStable().then(() => {
          if (!cancelled) void poll()
        })
      })
    : undefined

  return () => {
    cancelled = true
    unsubTheme()
    unsubFocus?.()
  }
}
