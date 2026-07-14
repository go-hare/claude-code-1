import { logForDebugging } from './debug.js'
import { gracefulShutdownSync } from './gracefulShutdown.js'

/**
 * Creates an idle timeout manager for SDK mode.
 * Automatically exits the process after the specified idle duration.
 *
 * @param isIdle Function that returns true if the system is currently idle
 * @returns Object with start/stop methods to control the idle timer
 */
export function createIdleTimeoutManager(isIdle: () => boolean): {
  start: () => void
  stop: () => void
} {
  // Official EXIT_AFTER_STOP_DELAY densable pure parse (positive ms).
  let delayMs: number | null = null
  try {
    const { resolveExitAfterStopDelayMs } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    delayMs = resolveExitAfterStopDelayMs()
  } catch {
    const exitAfterStopDelay = process.env.CLAUDE_CODE_EXIT_AFTER_STOP_DELAY
    const parsed = exitAfterStopDelay ? parseInt(exitAfterStopDelay, 10) : null
    delayMs = parsed && !isNaN(parsed) && parsed > 0 ? parsed : null
  }
  const configuredDelayMs = delayMs !== null && delayMs > 0 ? delayMs : null

  let timer: NodeJS.Timeout | null = null
  let lastIdleTime = 0

  return {
    start() {
      // Clear any existing timer
      if (timer) {
        clearTimeout(timer)
        timer = null
      }

      // Only start timer if delay is configured and valid
      if (configuredDelayMs !== null) {
        lastIdleTime = Date.now()
        const exitAfterMs = configuredDelayMs

        timer = setTimeout(() => {
          // Check if we've been continuously idle for the full duration
          const idleDuration = Date.now() - lastIdleTime
          if (isIdle() && idleDuration >= exitAfterMs) {
            logForDebugging(`Exiting after ${exitAfterMs}ms of idle time`)
            gracefulShutdownSync()
          }
        }, exitAfterMs)
      }
    },

    stop() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
