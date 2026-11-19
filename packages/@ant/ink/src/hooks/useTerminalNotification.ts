import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import StdinContext from '../components/StdinContext.js'
import {
  isGhosttyXtversion,
  isProgressReportingAvailable,
  type Progress,
} from '../core/terminal.js'
import { BEL } from '../core/termio/ansi.js'
import {
  ITERM2,
  OSC,
  osc,
  PROGRESS,
  wrapForMultiplexer,
} from '../core/termio/osc.js'

/**
 * Official 2.1.326 (#190, 328 `nb = 5000`): Ghostty clears an OSC 9;4 progress
 * bar after 15 seconds without an update. Re-emit active progress every 5s
 * while working so the Ghostty indicator stays alive.
 */
export const GHOSTTY_PROGRESS_HEARTBEAT_MS = 5000

function isGhosttyTerminal(): boolean {
  return (
    isGhosttyXtversion() ||
    process.env.TERM_PROGRAM === 'ghostty' ||
    process.env.TERM === 'xterm-ghostty'
  )
}

type WriteRaw = (data: string) => void

export const TerminalWriteContext = createContext<WriteRaw | null>(null)

export const TerminalWriteProvider = TerminalWriteContext.Provider

export type TerminalNotification = {
  notifyITerm2: (opts: { message: string; title?: string }) => void
  notifyKitty: (opts: { message: string; title: string; id: number }) => void
  notifyGhostty: (opts: { message: string; title: string }) => void
  notifyBell: () => void
  /**
   * Report progress to the terminal via OSC 9;4 sequences.
   * Supported terminals: ConEmu, Ghostty 1.2.0+, iTerm2 3.6.6+
   * Pass state=null to clear progress.
   */
  progress: (state: Progress['state'] | null, percentage?: number) => void
}

export function useTerminalNotification(): TerminalNotification {
  const writeRaw = useContext(TerminalWriteContext)
  const stdinContext = useContext(StdinContext)
  if (!writeRaw) {
    throw new Error(
      'useTerminalNotification must be used within TerminalWriteProvider',
    )
  }

  const activeProgressRef = useRef<{
    state: 'indeterminate' | 'running'
    percentage?: number
  } | null>(null)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current !== null) {
      clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
  }, [])

  const emitProgressSeq = useCallback(
    (state: Progress['state'] | null, percentage?: number) => {
      if (!isProgressReportingAvailable()) {
        return
      }
      if (!state) {
        writeRaw(
          wrapForMultiplexer(
            osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.CLEAR, ''),
          ),
        )
        return
      }
      const pct = Math.max(0, Math.min(100, Math.round(percentage ?? 0)))
      switch (state) {
        case 'completed':
          writeRaw(
            wrapForMultiplexer(
              osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.CLEAR, ''),
            ),
          )
          break
        case 'error':
          writeRaw(
            wrapForMultiplexer(
              osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.ERROR, pct),
            ),
          )
          break
        case 'indeterminate':
          writeRaw(
            wrapForMultiplexer(
              osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.INDETERMINATE, ''),
            ),
          )
          break
        case 'running':
          writeRaw(
            wrapForMultiplexer(
              osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.SET, pct),
            ),
          )
          break
        case null:
          break
      }
    },
    [writeRaw],
  )

  const notifyITerm2 = useCallback(
    ({ message, title }: { message: string; title?: string }) => {
      const displayString = title ? `${title}:\n${message}` : message
      writeRaw(wrapForMultiplexer(osc(OSC.ITERM2, `\n\n${displayString}`)))
    },
    [writeRaw],
  )

  const notifyKitty = useCallback(
    ({
      message,
      title,
      id,
    }: {
      message: string
      title: string
      id: number
    }) => {
      writeRaw(wrapForMultiplexer(osc(OSC.KITTY, `i=${id}:d=0:p=title`, title)))
      writeRaw(wrapForMultiplexer(osc(OSC.KITTY, `i=${id}:p=body`, message)))
      writeRaw(wrapForMultiplexer(osc(OSC.KITTY, `i=${id}:d=1:a=focus`, '')))
    },
    [writeRaw],
  )

  const notifyGhostty = useCallback(
    ({ message, title }: { message: string; title: string }) => {
      writeRaw(wrapForMultiplexer(osc(OSC.GHOSTTY, 'notify', title, message)))
    },
    [writeRaw],
  )

  const notifyBell = useCallback(() => {
    // Raw BEL — inside tmux this triggers tmux's bell-action (window flag).
    // Wrapping would make it opaque DCS payload and lose that fallback.
    writeRaw(BEL)
  }, [writeRaw])

  const progress = useCallback(
    (state: Progress['state'] | null, percentage?: number) => {
      emitProgressSeq(state, percentage)
      if (state === 'indeterminate' || state === 'running') {
        activeProgressRef.current = { state, percentage }
        // Official 2.1.326 (#190): keep Ghostty progress alive (<15s timeout).
        if (
          heartbeatTimerRef.current === null &&
          isGhosttyTerminal() &&
          process.env.CLAUDE_CODE_SESSION_KIND !== 'bg'
        ) {
          heartbeatTimerRef.current = setInterval(() => {
            const active = activeProgressRef.current
            if (active && isGhosttyTerminal()) {
              emitProgressSeq(active.state, active.percentage)
            }
          }, GHOSTTY_PROGRESS_HEARTBEAT_MS)
          heartbeatTimerRef.current.unref?.()
        }
      } else {
        activeProgressRef.current = null
        clearHeartbeat()
      }
    },
    [emitProgressSeq, clearHeartbeat],
  )

  // Official 2.1.326 (#190): clear progress on Ctrl+Z suspend and restore on resume.
  useEffect(() => {
    const emitter = stdinContext?.internal_eventEmitter
    if (!emitter) return
    const onSuspend = () => {
      if (activeProgressRef.current !== null) {
        clearHeartbeat()
        emitProgressSeq(null)
      }
    }
    const onResume = () => {
      const active = activeProgressRef.current
      if (active !== null) {
        progress(active.state, active.percentage)
      }
    }
    emitter.on('suspend', onSuspend)
    emitter.on('resume', onResume)
    return () => {
      emitter.off('suspend', onSuspend)
      emitter.off('resume', onResume)
    }
  }, [stdinContext, clearHeartbeat, emitProgressSeq, progress])

  useEffect(() => {
    return () => {
      clearHeartbeat()
    }
  }, [clearHeartbeat])

  return useMemo(
    () => ({ notifyITerm2, notifyKitty, notifyGhostty, notifyBell, progress }),
    [notifyITerm2, notifyKitty, notifyGhostty, notifyBell, progress],
  )
}
