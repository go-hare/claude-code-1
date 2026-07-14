/**
 * Official print-mode background wait ceiling (dEf / pEf / ONb / B6o).
 *
 * When `-p` drains commands and background agents are still running, wait up to
 * CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS (default 600_000). Set to 0 to wait
 * indefinitely. After the ceiling, official winds down with a 5s grace (B6o)
 * then stops waiting / kills shells.
 */

import { isEnvTruthy } from '../utils/envUtils.js'

/** Official ONb — default wait ceiling for print-mode bg drain (10 min). */
export const PRINT_BG_WAIT_CEILING_MS_DEFAULT = 600_000

/** Official B6o — grace after ceiling before wind-down sweep (5s). */
export const PRINT_BG_WAIT_GRACE_MS = 5_000

/**
 * Official dEf — resolve ceiling from env.
 * - unset / invalid → default 600_000
 * - `0` → wait indefinitely (null)
 * - positive → that many ms
 */
export function getPrintBgWaitCeilingMs(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS
  if (raw === undefined || raw === '') return PRINT_BG_WAIT_CEILING_MS_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return PRINT_BG_WAIT_CEILING_MS_DEFAULT
  if (n === 0) return null
  return Math.floor(n)
}

export type PrintBgWaitGateInput = {
  /** Running background tasks (excluding in_process_teammate). */
  runningBackgroundTasks: readonly { id: string; type: string }[]
  inputClosed: boolean
  hasMainThreadQueued: boolean
  hasActiveTeammates: boolean
  hasPendingNotification: boolean
  /** True when elapsed already exceeds the ceiling (or ceiling is null=false). */
  ceilingExceeded: boolean
  deadline: number | null
  swept: boolean
  now: number
  /** Official B6o grace after first wind-down trigger. */
  graceMs?: number
}

export type PrintBgWaitGateResult = {
  deadline: number | null
  swept: boolean
  shouldSweep: boolean
}

/**
 * Official pEf — decide whether to start/continue wind-down sweep of bg tasks.
 *
 * Wind-down only when input is closed, nothing queued, no active teammates,
 * there are running bg tasks, and either the ceiling is already exceeded or
 * there is no pending notification and no "must-wait" task (caller filters).
 */
export function nextPrintBgWaitGate(
  input: PrintBgWaitGateInput,
): PrintBgWaitGateResult {
  const graceMs = input.graceMs ?? PRINT_BG_WAIT_GRACE_MS
  const canWind =
    input.inputClosed &&
    !input.hasMainThreadQueued &&
    !input.hasActiveTeammates &&
    input.runningBackgroundTasks.length > 0 &&
    (input.ceilingExceeded ||
      (!input.hasPendingNotification &&
        !input.runningBackgroundTasks.some(isPrintBgWaitForeverTask)))

  if (!canWind) {
    return { deadline: null, swept: false, shouldSweep: false }
  }

  if (input.deadline === null) {
    // First trigger: if already past ceiling, sweep immediately; else set grace deadline.
    if (input.ceilingExceeded) {
      return { deadline: input.now, swept: true, shouldSweep: true }
    }
    return {
      deadline: input.now + graceMs,
      swept: false,
      shouldSweep: false,
    }
  }

  if (input.now < input.deadline) {
    return {
      deadline: input.deadline,
      swept: input.swept,
      shouldSweep: false,
    }
  }

  return {
    deadline: input.deadline,
    swept: true,
    shouldSweep: !input.swept,
  }
}

/**
 * Tasks that should not force early wind-down while still "must wait"
 * (official dOe subset — local_agent keeps waiting; local_bash is wind-downable).
 */
export function isPrintBgWaitForeverTask(task: { type: string }): boolean {
  return task.type === 'local_agent'
}

/** Stderr line when ceiling exceeded (official message). */
export function formatPrintBgWaitCeilingMessage(ceilingMs: number): string {
  return (
    `Background tasks still running after ${Math.round(ceilingMs / 1000)}s; ` +
    'terminating. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.\n'
  )
}

/** Official fEf branch classification for wind-down kill messages. */
export type PrintWindDownKind = 'shell' | 'observer' | 'other'

export function classifyPrintWindDownKind(task: {
  type: string
}): PrintWindDownKind {
  if (task.type === 'local_bash') return 'shell'
  // Official QD — mid-delivery MCP resource observer
  if (task.type === 'monitor_mcp') return 'observer'
  return 'other'
}

/** Official: print wind-down: killing background shell … */
export function formatPrintWindDownShellMessage(
  task: { id: string; description?: string },
  graceMs: number = PRINT_BG_WAIT_GRACE_MS,
): string {
  const desc = task.description ? ` ("${task.description}")` : ''
  return `print wind-down: killing background shell ${task.id}${desc} after ${graceMs}ms grace`
}

/** Official: print wind-down: killing mid-delivery observer … */
export function formatPrintWindDownObserverMessage(
  task: { id: string },
  graceMs: number = PRINT_BG_WAIT_GRACE_MS,
): string {
  return `print wind-down: killing mid-delivery observer ${task.id} after ${graceMs}ms grace`
}

/** Official: print wind-down: no longer waiting on background … */
export function formatPrintWindDownOtherMessage(
  task: { id: string; type: string },
  graceMs: number = PRINT_BG_WAIT_GRACE_MS,
): string {
  return `print wind-down: no longer waiting on background ${task.type} task ${task.id} after ${graceMs}ms grace`
}

/**
 * Official fEf message for a single task (debug log line).
 * Kill side-effects stay in the caller (stopTask / killTask).
 */
export function formatPrintWindDownMessage(
  task: { id: string; type: string; description?: string },
  graceMs: number = PRINT_BG_WAIT_GRACE_MS,
): string {
  switch (classifyPrintWindDownKind(task)) {
    case 'shell':
      return formatPrintWindDownShellMessage(task, graceMs)
    case 'observer':
      return formatPrintWindDownObserverMessage(task, graceMs)
    default:
      return formatPrintWindDownOtherMessage(task, graceMs)
  }
}

/**
 * Official CLAUDE_CODE_BG_TASKS_REPORT_RUNNING — when truthy, session stays
 * "running" while bg tasks / teammates / pending notifications are active.
 */
export function isBgTasksReportRunningEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_BG_TASKS_REPORT_RUNNING)
}

/**
 * Official lEf — whether the session may remain/report `running` after a turn.
 * When BG_TASKS_REPORT_RUNNING is on and bg activity exists, returns false
 * (caller should not flip to idle yet via the "still running" path — i.e.
 * suppress the idle transition while activity holds).
 *
 * Returns true when input is still open and current state is already running
 * (keep running). Returns false when bg-activity forces non-idle reporting
 * under the env flag (do not emit idle).
 */
export function shouldKeepSessionRunningOnDrain({
  inputClosed,
  currentState,
  hasActiveTeammates,
  hasRunningBgTasks,
  hasPendingNotification,
  reportRunning = isBgTasksReportRunningEnabled(),
}: {
  inputClosed: boolean
  currentState: string
  hasActiveTeammates: boolean
  hasRunningBgTasks: boolean
  hasPendingNotification: boolean
  reportRunning?: boolean
}): boolean {
  if (
    (hasActiveTeammates || hasRunningBgTasks || hasPendingNotification) &&
    reportRunning
  ) {
    return false
  }
  return !inputClosed && currentState === 'running'
}

/**
 * Official cEf — whether session may transition to idle while bg activity
 * exists. When BG_TASKS_REPORT_RUNNING and activity present, idle is blocked.
 */
export function canReportSessionIdleWithBgActivity({
  hasActiveTeammates,
  hasRunningBgTasks,
  hasPendingNotification,
  reportRunning = isBgTasksReportRunningEnabled(),
}: {
  hasActiveTeammates: boolean
  hasRunningBgTasks: boolean
  hasPendingNotification: boolean
  reportRunning?: boolean
}): boolean {
  return !(
    (hasActiveTeammates || hasRunningBgTasks || hasPendingNotification) &&
    reportRunning
  )
}
