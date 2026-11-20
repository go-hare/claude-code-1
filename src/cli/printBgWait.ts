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

export type PrintBgWaitTask = {
  id: string
  type: string
  isBackgrounded?: boolean
  kind?: string
  agentId?: string
  ambient?: boolean
}

export type PrintBgWaitGateInput = {
  /** Running background tasks (excluding in_process_teammate). */
  runningBackgroundTasks: readonly PrintBgWaitTask[]
  inputClosed: boolean
  hasMainThreadQueued: boolean
  hasActiveTeammates: boolean
  hasPendingNotification: boolean
  /** Official $nt / tengu_tidy_sloth — hold for backgrounded local_bash shells. */
  holdForBackgroundShells?: boolean
  /** Official tengu_giggly_dragonfly — hold for armed monitors. */
  holdForArmedMonitors?: boolean
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
        !input.runningBackgroundTasks.some(
          t =>
            isPrintBgWaitForeverTask(t) ||
            (input.holdForArmedMonitors && isArmedMonitorTask(t)) ||
            (input.holdForBackgroundShells && isBackgroundedLocalBashTask(t)),
        )))

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
 * (official $7 — local_agent keeps waiting).
 */
export function isPrintBgWaitForeverTask(task: { type: string }): boolean {
  return task.type === 'local_agent'
}

/**
 * Official rfa — backgrounded local_bash shell (not monitor, not agent-owned).
 */
export function isBackgroundedLocalBashTask(task: PrintBgWaitTask): boolean {
  return (
    task.type === 'local_bash' &&
    task.isBackgrounded === true &&
    task.kind !== 'monitor' &&
    task.agentId === undefined
  )
}

/**
 * Official oWt — armed monitor task.
 */
export function isArmedMonitorTask(task: PrintBgWaitTask): boolean {
  return (
    (task.type === 'local_bash' && task.kind === 'monitor') ||
    task.type === 'monitor_mcp' ||
    (task.type === 'monitor_ws' && task.ambient !== true)
  )
}

/** Official K0 = 120000ms — scheduled wakeup grace window. */
export const SCHEDULED_WAKEUP_HOLD_GRACE_MS = 120_000

/**
 * Official Fy — true when a session has a pending `/loop` scheduled wakeup.
 */
export function hasPendingSessionWakeup(
  cronTasks: readonly { kind?: string; scheduledFor?: number }[],
  { now, parkedSince }: { now: number; parkedSince: number | null },
): boolean {
  const baseline = parkedSince ?? now
  return cronTasks.some(
    t =>
      t.kind === 'loop' &&
      (t.scheduledFor === undefined ||
        now <=
          Math.max(t.scheduledFor, baseline) + SCHEDULED_WAKEUP_HOLD_GRACE_MS),
  )
}

/**
 * Official 2.1.328 (#670) `tengu_print_ceiling_stop_agents` (default `true`):
 * whether exceeding `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` actively stops
 * remaining background subagents (and those they are waiting for).
 */
export function shouldStopAgentsOnPrintBgCeiling(gbValue?: boolean): boolean {
  if (gbValue !== undefined) return gbValue
  try {
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    return getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_print_ceiling_stop_agents',
      true,
    )
  } catch {
    return true
  }
}

/**
 * Official 2.1.328 (#670): keep a single shared `firstIdle` timestamp across
 * a background subagent and any nested subagents it waits for, so chained
 * waits with `CLAUDE_CODE_FORK_SUBAGENT=0` count against one 10-minute wait
 * budget (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) instead of resetting per turn.
 */
export function advanceSharedPrintBgWaitFirstIdle(opts: {
  firstIdleAt: number | null
  hasRunningBgTasks: boolean
  now: number
}): number | null {
  if (!opts.hasRunningBgTasks) {
    return null
  }
  return opts.firstIdleAt ?? opts.now
}

/** Stderr line when ceiling exceeded (official 2.1.328 message when stopping agents). */
export function formatPrintBgWaitCeilingMessage(
  ceilingMs: number,
  summary?: string,
): string {
  const secs = Math.round(ceilingMs / 1000)
  const duration = secs >= 60 && secs % 60 === 0 ? `${secs / 60}m` : `${secs}s`
  if (summary) {
    return (
      `Background tasks still running ${duration} after the last turn (${summary}); ` +
      'stopping them. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.\n'
    )
  }
  return (
    `Background tasks still running after ${secs}s; ` +
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
