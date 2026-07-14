import { openSync } from 'fs'
import { ReadStream } from 'tty'
import type { RenderOptions } from '@anthropic/ink'
import { isEnvTruthy } from './envUtils.js'
import { logError } from './log.js'
import { applyRelaunchTerminalSizeFromEnv } from './residualFinalEnvGates.js'
import { isScreenReaderModeEnabled } from './screenReaderGate.js'

// Cached stdin override - computed once per process
let cachedStdinOverride: ReadStream | undefined | null = null

/**
 * Gets a ReadStream for /dev/tty when stdin is piped.
 * This allows interactive Ink rendering even when stdin is a pipe.
 * Result is cached for the lifetime of the process.
 */
function getStdinOverride(): ReadStream | undefined {
  // Return cached result if already computed
  if (cachedStdinOverride !== null) {
    return cachedStdinOverride
  }

  // No override needed if stdin is already a TTY
  if (process.stdin.isTTY) {
    cachedStdinOverride = undefined
    return undefined
  }

  // Skip in CI environments
  if (isEnvTruthy(process.env.CI)) {
    cachedStdinOverride = undefined
    return undefined
  }

  // Skip if running MCP (input hijacking breaks MCP)
  if (process.argv.includes('mcp')) {
    cachedStdinOverride = undefined
    return undefined
  }

  // No /dev/tty on Windows
  if (process.platform === 'win32') {
    cachedStdinOverride = undefined
    return undefined
  }

  // Try to open /dev/tty as an alternative input source
  try {
    const ttyFd = openSync('/dev/tty', 'r')
    const ttyStream = new ReadStream(ttyFd)
    // Explicitly set isTTY to true since we know /dev/tty is a TTY.
    // This is needed because some runtimes (like Bun's compiled binaries)
    // may not correctly detect isTTY on ReadStream created from a file descriptor.
    ttyStream.isTTY = true
    cachedStdinOverride = ttyStream
    return cachedStdinOverride
  } catch (err) {
    logError(err as Error)
    cachedStdinOverride = undefined
    return undefined
  }
}

/**
 * Returns base render options for Ink, including stdin override when needed.
 * Use this for all render() calls to ensure piped input works correctly.
 *
 * Official WU: apply one-shot CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE first so
 * Ink inherits restored columns/rows after a terminal relaunch.
 *
 * @param exitOnCtrlC - Whether to exit on Ctrl+C (usually false for dialogs)
 */
export function getBaseRenderOptions(
  exitOnCtrlC: boolean = false,
): RenderOptions {
  // Official t2u — restore stdout size from relaunch env before Ink measures.
  applyRelaunchTerminalSizeFromEnv()
  const stdin = getStdinOverride()
  // Official zBn / uU → Ink isScreenReaderEnabled (full onRenderScreenReader denser).
  const options: RenderOptions = {
    exitOnCtrlC,
    isScreenReaderEnabled: isScreenReaderModeEnabled(),
  }
  if (stdin) {
    options.stdin = stdin
  }
  return options
}
