import { AsyncLocalStorage } from 'async_hooks'
import { getCwdState, getOriginalCwd } from '../bootstrap/state.js'
import { getBootstrapSession } from './sessionHost.js'

const cwdOverrideStorage = new AsyncLocalStorage<string>()

let cwdVersion = 0
let lastObservedCwd: string | null = null

function syncCwdVersion(): number {
  const current = getCwd()
  if (lastObservedCwd === null) {
    lastObservedCwd = current
  } else if (lastObservedCwd !== current) {
    lastObservedCwd = current
    cwdVersion++
  }
  return cwdVersion
}

/**
 * Run a function with an overridden working directory for the current async context.
 * All calls to pwd()/getCwd() within the function (and its async descendants) will
 * return the overridden cwd instead of the global one. This enables concurrent
 * agents to each see their own working directory without affecting each other.
 */
export function runWithCwdOverride<T>(cwd: string, fn: () => T): T {
  return cwdOverrideStorage.run(cwd, fn)
}

/**
 * densable 2.1.216 worktree git isolation — agent isolation cwd when set via
 * runWithCwdOverride (isolation: "worktree" / explicit cwd). Undefined outside
 * an override ALS context.
 */
export function getCwdOverride(): string | undefined {
  return cwdOverrideStorage.getStore()
}

/**
 * Get the current working directory
 */
export function pwd(): string {
  return cwdOverrideStorage.getStore() ?? getCwdState()
}

/**
 * Get the current working directory or the original working directory if the current one is not available
 */
export function getCwd(): string {
  try {
    return pwd()
  } catch {
    return getOriginalCwd()
  }
}

/**
 * Monotonic version counter that increments whenever the active working
 * directory changes (via setCwd / setCwdState / session.setCwd).
 */
export function getCwdVersion(): number {
  return syncCwdVersion()
}

/**
 * Subscribe to working directory changes on the active bootstrap session.
 * Compatible with React's `useSyncExternalStore` so UI components such as
 * StatusLine refresh immediately when `/cd` updates the working directory.
 */
export function subscribeCwd(listener: () => void): () => void {
  let lastCwd = getCwd()
  syncCwdVersion()
  const session = getBootstrapSession()
  if (typeof session?.subscribe !== 'function') {
    return () => {}
  }
  return session.subscribe(() => {
    const nextCwd = getCwd()
    if (nextCwd !== lastCwd) {
      lastCwd = nextCwd
      syncCwdVersion()
      listener()
    }
  })
}
