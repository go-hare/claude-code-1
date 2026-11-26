/**
 * Prevents macOS from sleeping while Claude is working.
 *
 * Uses the built-in `caffeinate` command to create a power assertion that
 * prevents idle sleep. This keeps the Mac awake during API requests and
 * tool execution so long-running operations don't get interrupted.
 *
 * The caffeinate process is spawned with a timeout and periodically restarted.
 * This provides self-healing behavior: if the Node process is killed with
 * SIGKILL (which doesn't run cleanup handlers), the orphaned caffeinate will
 * automatically exit after the timeout expires.
 *
 * Only runs on macOS - no-op on other platforms.
 */
import { type ChildProcess, spawn } from 'child_process'
import {
  type CleanupUnregister,
  registerCleanup,
} from '../utils/cleanupRegistry.js'
import { logForDebugging } from '../utils/debug.js'
import { getBootstrapSessionHost, HostSlot } from '../utils/sessionHost.js'

// Caffeinate timeout in seconds. Process auto-exits after this duration.
// We restart it before expiry to maintain continuous sleep prevention.
const CAFFEINATE_TIMEOUT_SECONDS = 300 // 5 minutes

// Restart interval - restart caffeinate before it expires.
// Use 4 minutes to give plenty of buffer before the 5 minute timeout.
const RESTART_INTERVAL_MS = 4 * 60 * 1000

// Delay before killing the sleep inhibitor after refCount reaches 0.
const PENDING_KILL_TIMEOUT_MS = 30_000

// Process-global OS resource: ONE caffeinate process + ONE restart interval +
// ONE pending-kill timer backed by a process-wide total refcount so N hosts
// never spawn N caffeinate processes or leak intervals.
let caffeinateProcess: ChildProcess | null = null
let restartInterval: ReturnType<typeof setInterval> | null = null
let pendingKillTimeout: ReturnType<typeof setTimeout> | null = null
let pendingKillOwner: PreventSleepHostState | null = null
let totalRefCount = 0
let processExitCleanupRegistered = false

type PreventSleepHostState = {
  held: number
  cleanupUnregister: CleanupUnregister | null
}

const preventSleepHostSlot = new HostSlot<PreventSleepHostState>(() => ({
  held: 0,
  cleanupUnregister: null,
}))

function getPreventSleepHostState(): PreventSleepHostState {
  return preventSleepHostSlot.of(getBootstrapSessionHost())
}

function clearPendingKillTimer(): void {
  if (pendingKillTimeout !== null) {
    clearTimeout(pendingKillTimeout)
    pendingKillTimeout = null
  }
  pendingKillOwner = null
}

function releaseHostPreventSleep(hostState: PreventSleepHostState): void {
  const toRelease = hostState.held
  hostState.held = 0
  if (hostState.cleanupUnregister !== null) {
    const unregister = hostState.cleanupUnregister
    hostState.cleanupUnregister = null
    unregister()
  }
  if (toRelease > 0) {
    totalRefCount = Math.max(0, totalRefCount - toRelease)
  }
  if (totalRefCount === 0) {
    clearPendingKillTimer()
    stopRestartInterval()
    killCaffeinate()
  }
}

/**
 * Increment the reference count and start preventing sleep if needed.
 * Call this when starting work that should keep the Mac awake.
 */
export function startPreventSleep(): void {
  const hostState = getPreventSleepHostState()
  hostState.held++
  totalRefCount++

  if (hostState.cleanupUnregister === null) {
    // Register per-host cleanup so an exiting host releases only its own held
    // assertions without killing sleep prevention still held by sibling hosts.
    hostState.cleanupUnregister = registerCleanup(async () => {
      releaseHostPreventSleep(hostState)
    })
  }

  if (totalRefCount === 1) {
    clearPendingKillTimer()
    spawnCaffeinate()
    startRestartInterval()
  }
}

/**
 * Decrement the reference count and allow sleep if no more work is pending.
 * Call this when work completes.
 */
export function stopPreventSleep(): void {
  const hostState = getPreventSleepHostState()
  const wasHolding = hostState.held > 0
  if (wasHolding) {
    hostState.held--
    totalRefCount = Math.max(0, totalRefCount - 1)
  }

  if (hostState.held === 0 && hostState.cleanupUnregister !== null) {
    const unregister = hostState.cleanupUnregister
    hostState.cleanupUnregister = null
    unregister()
  }

  if (wasHolding && totalRefCount === 0 && pendingKillTimeout === null) {
    pendingKillOwner = hostState
    pendingKillTimeout = setTimeout(() => {
      pendingKillTimeout = null
      pendingKillOwner = null
      stopRestartInterval()
      killCaffeinate()
    }, PENDING_KILL_TIMEOUT_MS)
    pendingKillTimeout.unref?.()
  }
}

/**
 * Force stop preventing sleep for the current host, regardless of reference count.
 * Only terminates the shared caffeinate process once all hosts have released.
 */
export function forceStopPreventSleep(): void {
  releaseHostPreventSleep(getPreventSleepHostState())
}

export function isHolding(): boolean {
  const hostState = preventSleepHostSlot.peek(getBootstrapSessionHost())
  if (!hostState) {
    return false
  }
  return (
    hostState.held > 0 ||
    (pendingKillTimeout !== null && pendingKillOwner === hostState)
  )
}

/** Test-only: inspect process-global preventSleep state. */
export function _getPreventSleepStateForTesting(): {
  totalRefCount: number
  hostHeld: number
  caffeinateProcess: ChildProcess | null
  hasRestartInterval: boolean
  hasPendingKillTimeout: boolean
} {
  const hostState = preventSleepHostSlot.peek(getBootstrapSessionHost())
  return {
    totalRefCount,
    hostHeld: hostState?.held ?? 0,
    caffeinateProcess,
    hasRestartInterval: restartInterval !== null,
    hasPendingKillTimeout: pendingKillTimeout !== null,
  }
}

function startRestartInterval(): void {
  // Only run on macOS
  if (process.platform !== 'darwin') {
    return
  }

  // Already running
  if (restartInterval !== null) {
    return
  }

  restartInterval = setInterval(() => {
    // Only restart if we still need sleep prevention
    if (totalRefCount > 0 || pendingKillTimeout !== null) {
      logForDebugging('Restarting sleep inhibitor to maintain prevention')
      killCaffeinate()
      spawnCaffeinate()
    }
  }, RESTART_INTERVAL_MS)

  // Don't let the interval keep the Node process alive
  restartInterval.unref()
}

function stopRestartInterval(): void {
  if (restartInterval !== null) {
    clearInterval(restartInterval)
    restartInterval = null
  }
}

function spawnCaffeinate(): void {
  // Only run on macOS
  if (process.platform !== 'darwin') {
    return
  }

  // Already running
  if (caffeinateProcess !== null) {
    return
  }

  // Register a single process-wide exit guard so caffeinate is killed even if
  // the process exits during the 30s pendingKillTimeout grace window.
  if (!processExitCleanupRegistered) {
    processExitCleanupRegistered = true
    process.on('exit', () => {
      clearPendingKillTimer()
      stopRestartInterval()
      killCaffeinate()
    })
  }

  try {
    // -i: Create an assertion to prevent idle sleep
    //     This is the least aggressive option - display can still sleep
    // -t: Timeout in seconds - caffeinate exits automatically after this
    //     This provides self-healing if Node is killed with SIGKILL
    const proc = spawn(
      'caffeinate',
      ['-i', '-t', String(CAFFEINATE_TIMEOUT_SECONDS)],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    )
    caffeinateProcess = proc

    // Don't let caffeinate keep the Node process alive
    proc.unref()

    proc.on('error', err => {
      logForDebugging(`sleep inhibitor spawn error: ${err.message}`)
      if (caffeinateProcess === proc) {
        caffeinateProcess = null
      }
    })

    proc.on('exit', () => {
      if (caffeinateProcess === proc) {
        caffeinateProcess = null
      }
    })

    logForDebugging('Started caffeinate to prevent sleep')
  } catch {
    // Silently fail - caffeinate not available or spawn failed
    caffeinateProcess = null
  }
}

function killCaffeinate(): void {
  if (caffeinateProcess !== null) {
    const proc = caffeinateProcess
    caffeinateProcess = null
    try {
      // SIGKILL for immediate termination - SIGTERM could be delayed
      proc.kill('SIGKILL')
      logForDebugging('Stopped sleep inhibitor, allowing sleep')
    } catch {
      // Process may have already exited
    }
  }
}
