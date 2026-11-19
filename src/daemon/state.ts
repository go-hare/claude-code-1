import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import {
  getProcessStartTime,
  isProcessRunning,
  processStartIdentityEquals,
} from '../utils/genericProcessUtils.js'

/**
 * Daemon state persisted to disk so that `status` / `stop` can work
 * from a different CLI process than the one that started the daemon.
 */
export interface DaemonStateData {
  pid: number
  cwd: string
  startedAt: string
  workerKinds: string[]
  lastStatus: 'running' | 'stopped' | 'error'
  /** Official 2.1.326 #15: process start identity for PID-reuse protection before kill. */
  procStart?: string
}

export type DaemonStatus = 'running' | 'stopped' | 'stale'

/**
 * Returns the path to the daemon state file for a given daemon name.
 */
export function getDaemonStateFilePath(name = 'remote-control'): string {
  return join(getClaudeConfigHomeDir(), 'daemon', `${name}.json`)
}

/**
 * Write daemon state to disk. Called by the supervisor on startup.
 */
export function writeDaemonState(
  state: DaemonStateData,
  name = 'remote-control',
): void {
  const filePath = getDaemonStateFilePath(name)
  mkdirSync(dirname(filePath), { recursive: true })
  const withStart: DaemonStateData =
    state.procStart !== undefined
      ? state
      : { ...state, procStart: getProcessStartTime(state.pid) }
  writeFileSync(filePath, JSON.stringify(withStart, null, 2), 'utf-8')
}

/**
 * Read daemon state from disk. Returns null if no state file exists.
 */
export function readDaemonState(
  name = 'remote-control',
): DaemonStateData | null {
  const filePath = getDaemonStateFilePath(name)
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as DaemonStateData
  } catch {
    return null
  }
}

/**
 * Remove the daemon state file.
 */
export function removeDaemonState(name = 'remote-control'): void {
  const filePath = getDaemonStateFilePath(name)
  try {
    unlinkSync(filePath)
  } catch {
    // File may not exist — that's fine
  }
}

/**
 * Check if a process with the given PID is alive.
 * Delegates to `isProcessRunning` so Windows uses FFI/bounded process checks (#697).
 */
function isProcessAlive(pid: number): boolean {
  return isProcessRunning(pid)
}

/**
 * Query the daemon status by reading the state file and probing the PID.
 *
 * Returns:
 *  - { status: 'running', state } — PID is alive
 *  - { status: 'stopped' }       — no state file
 *  - { status: 'stale' }         — state file exists but PID is dead (auto-cleaned)
 */
export function queryDaemonStatus(name = 'remote-control'): {
  status: DaemonStatus
  state?: DaemonStateData
} {
  const state = readDaemonState(name)
  if (!state) {
    return { status: 'stopped' }
  }

  if (isProcessAlive(state.pid)) {
    return { status: 'running', state }
  }

  // Stale — process is dead but state file remains
  removeDaemonState(name)
  return { status: 'stale' }
}

/**
 * Stop a running daemon by sending SIGTERM, waiting, then SIGKILL if needed.
 * Cleans up the state file afterward.
 *
 * @returns true if the daemon was stopped, false if it wasn't running
 */
export async function stopDaemonByPid(
  name = 'remote-control',
  timeoutMs = 10_000,
): Promise<boolean> {
  const state = readDaemonState(name)
  if (!state) {
    return false
  }

  const { pid, procStart } = state

  if (!isProcessAlive(pid)) {
    removeDaemonState(name)
    return false
  }

  // Official 2.1.326 #15: verify process start identity before signaling so a
  // reused PID (e.g. an SSH login) is never terminated by the daemon.
  if (procStart) {
    const currentStart = getProcessStartTime(pid)
    if (
      currentStart !== undefined &&
      !processStartIdentityEquals(procStart, currentStart)
    ) {
      removeDaemonState(name)
      return false
    }
  }

  // Send SIGTERM
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    removeDaemonState(name)
    return false
  }

  // Wait for exit with timeout
  const deadline = Date.now() + timeoutMs
  const pollInterval = 200

  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      removeDaemonState(name)
      return true
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval))
  }

  // Force kill
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Already dead
  }

  // Brief wait for SIGKILL to take effect
  await new Promise(resolve => setTimeout(resolve, 500))

  removeDaemonState(name)
  return true
}

/**
 * Official 2.1.295 (#384): track process-level stop signals (SIGTERM/SIGHUP/SIGINT)
 * so `claude agents` exiting alongside a stopping daemon never spawns or
 * respawns a new background service on teardown.
 */
let daemonShutdownSignaled = false

export function markDaemonShutdownSignaled(): void {
  daemonShutdownSignaled = true
}

export function isDaemonShutdownSignaled(): boolean {
  return daemonShutdownSignaled
}

export function resetDaemonShutdownSignaled(): void {
  daemonShutdownSignaled = false
}
