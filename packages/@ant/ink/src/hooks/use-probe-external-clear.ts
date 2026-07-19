/**
 * densable ksf — poll Ink.probeExternalClear on iTerm.app / Apple_Terminal
 * while fullscreen alt-screen is active. On external wipe (cmd+k / terminal
 * clear), invoke the callback (typically the chat:clearScreen double-press
 * path so residue is cleaned and the hint fires).
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import instances from '../core/instances.js'
import useStdin from './use-stdin.js'

function subscribeNoop(): () => void {
  return () => {}
}

function getTermProgram(): string {
  return process.env.TERM_PROGRAM ?? ''
}

export type UseProbeExternalClearOptions = {
  /**
   * densable Ki() — only poll when fullscreen alt-screen is actually active.
   * Callers pass isFullscreenActive() (or equivalent).
   */
  isFullscreenActive: boolean
}

/**
 * densable ksf(e): every 200ms call probeExternalClear; on true run e().
 * Terminals: iTerm.app, Apple_Terminal only (others don't wipe alt-screen
 * the same way / don't need the probe).
 */
export function useProbeExternalClear(
  onExternalClear: () => void,
  options: UseProbeExternalClearOptions,
): void {
  const { isFullscreenActive } = options
  const callbackRef = useRef(onExternalClear)
  callbackRef.current = onExternalClear
  const { internal_querier: querier } = useStdin()
  // TERM_PROGRAM is process-static for the session; useSyncExternalStore
  // keeps the densable shape (YT()?.terminal ?? ye.terminal) without a
  // terminal-profile store dependency in ink.
  const termProgram = useSyncExternalStore(
    subscribeNoop,
    getTermProgram,
    getTermProgram,
  )

  useEffect(() => {
    if (!isFullscreenActive || !querier) return
    if (termProgram !== 'iTerm.app' && termProgram !== 'Apple_Terminal') {
      return
    }
    const ink = instances.get(process.stdout)
    if (!ink) return

    const ac = new AbortController()
    void (async () => {
      while (!ac.signal.aborted) {
        let wiped = false
        try {
          wiped = await ink.probeExternalClear(querier)
        } catch {
          // querier/ink may tear down mid-probe
        }
        if (ac.signal.aborted) return
        if (wiped) callbackRef.current()
        await sleepUnref(200, ac.signal)
      }
    })()

    return () => ac.abort()
  }, [isFullscreenActive, querier, termProgram])
}

function sleepUnref(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (typeof timer === 'object') timer.unref?.()
    function onAbort(): void {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
