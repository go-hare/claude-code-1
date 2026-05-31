import { resolve } from 'path'
import {
  type HeadlessBridgeOpts,
  BridgeHeadlessPermanentError,
  runBridgeHeadless,
} from '../bridge/bridgeMain.js'
import { getClaudeAIOAuthTokens } from '../utils/auth.js'
import { errorMessage } from '../utils/errors.js'

/**
 * Exit codes the supervisor uses to decide retry vs park.
 * Permanent errors (trust not accepted, no git repo for worktree) use
 * EXIT_CODE_PERMANENT so the supervisor doesn't waste cycles retrying.
 */
const EXIT_CODE_PERMANENT = 78 // EX_CONFIG from sysexits.h
const EXIT_CODE_TRANSIENT = 1

/**
 * Daemon worker entry point. Called from `cli.tsx` via:
 *   `claude --daemon-worker=<kind>`
 *
 * Official architecture:
 *   The supervisor spawns `--daemon-worker=remoteControl` which runs
 *   the bg manager (BG4) + control socket (SG4). This is the process
 *   that handles all control socket ops (ping/list/dispatch/attach/subscribe).
 */
export async function runDaemonWorker(kind?: string): Promise<void> {
  if (!kind) {
    console.error('Error: --daemon-worker requires a worker kind')
    process.exitCode = EXIT_CODE_PERMANENT
    return
  }

  switch (kind) {
    case 'remoteControl':
      await runRemoteControlWorker()
      break
    default:
      console.error(`Error: unknown daemon worker kind '${kind}'`)
      process.exitCode = EXIT_CODE_PERMANENT
  }
}

/**
 * Remote Control worker — official BG4.
 * Starts the bg manager (control socket + worker management).
 * This is the core daemon process that FleetView connects to.
 */
async function runRemoteControlWorker(): Promise<void> {
  const { startBgManager } = await import('./bgManager.js')

  const controller = new AbortController()
  const onSignal = () => controller.abort()
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)

  try {
    const manager = await startBgManager({
      onLog: (msg: string) => console.log(`[bg] ${msg}`),
    })

    console.log('[remoteControl] bg manager + control socket ready')

    // Wait for abort signal (supervisor sends SIGTERM on shutdown)
    await new Promise<void>(resolve => {
      if (controller.signal.aborted) {
        resolve()
        return
      }
      controller.signal.addEventListener('abort', () => resolve(), {
        once: true,
      })
    })

    await manager.close()
  } catch (err) {
    if (err instanceof BridgeHeadlessPermanentError) {
      console.error(`[remoteControl] permanent error: ${err.message}`)
      process.exitCode = EXIT_CODE_PERMANENT
    } else {
      console.error(`[remoteControl] error: ${errorMessage(err)}`)
      process.exitCode = EXIT_CODE_TRANSIENT
    }
  } finally {
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
  }
}
