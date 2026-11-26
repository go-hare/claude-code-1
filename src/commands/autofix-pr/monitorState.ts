import { getBootstrapSessionHost, HostSlot } from '../../utils/sessionHost.js'

type MonitorState = {
  taskId: string
  owner: string
  repo: string
  prNumber: number
  abortController: AbortController
  startedAt: number
  /** Official 2.1.326 #101: remote CCR session id so `/autofix-pr stop` can archive it. */
  sessionId?: string
}

const monitorStateHostSlot = new HostSlot<{ active: MonitorState | null }>(
  () => ({
    active: null,
  }),
)

function getMonitorHostState(): { active: MonitorState | null } {
  return monitorStateHostSlot.of(getBootstrapSessionHost())
}

export function getActiveMonitor(): Readonly<MonitorState> | null {
  return getMonitorHostState().active
}

/**
 * Atomic check-and-set. Returns true if the lock was acquired, false if a
 * monitor is already active. Use this instead of getActiveMonitor + setActiveMonitor
 * — those two together race because the caller may await between them.
 */
export function trySetActiveMonitor(state: MonitorState): boolean {
  const hostState = getMonitorHostState()
  if (hostState.active) return false
  hostState.active = state
  return true
}

/**
 * Sets the active monitor unconditionally. Throws if a monitor is already
 * active. Prefer trySetActiveMonitor for race-free acquisition.
 */
export function setActiveMonitor(state: MonitorState): void {
  const hostState = getMonitorHostState()
  if (hostState.active)
    throw new Error(
      `Monitor already active: ${hostState.active.repo}#${hostState.active.prNumber}`,
    )
  hostState.active = state
}

/**
 * Releases the active monitor. If `taskId` is provided, only releases when the
 * active monitor's taskId matches — prevents a late-arriving cleanup from
 * clobbering a freshly-acquired lock owned by a different task.
 */
export function clearActiveMonitor(taskId?: string): void {
  const hostState = getMonitorHostState()
  if (!hostState.active) return
  if (taskId && hostState.active.taskId !== taskId) return
  hostState.active.abortController.abort()
  hostState.active = null
}

/**
 * Atomically merges partial updates into the active monitor. Returns true if
 * applied, false if no active monitor. Used when the caller needs to swap the
 * lock's taskId after the framework assigns a different one than the
 * tentative one used to acquire the lock — without this the framework's
 * cleanup (clearActiveMonitor with the framework taskId) would no-op against
 * a lock keyed by the caller's tentative id.
 */
export function updateActiveMonitor(partial: Partial<MonitorState>): boolean {
  const hostState = getMonitorHostState()
  if (!hostState.active) return false
  hostState.active = { ...hostState.active, ...partial }
  return true
}

export function isMonitoring(
  owner: string,
  repo: string,
  prNumber: number,
): boolean {
  const active = getMonitorHostState().active
  return (
    active?.owner === owner &&
    active?.repo === repo &&
    active?.prNumber === prNumber
  )
}
