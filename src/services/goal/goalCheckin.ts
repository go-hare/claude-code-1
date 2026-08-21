/**
 * densable 2.1.234 `/goal` background-defer check-in (wPv / APv / kPv / iYp / DMv)
 * + 2.1.236 idle-timer backoff helpers (Bqn: jsv / G9a / rLe).
 *
 * Gold:
 *   wPv — GB `tengu_saffron_wren` (default on) × env minutes (SPv=30) → ms; 0 disables
 *   kPv — start / continue / reset deferral window when a newer task starts after last pass
 *   iYp — if deferred ≥ interval, build check-in body + bump checkinCount
 *   APv — still-running vs cleared body copy (guillemets around goal condition)
 *   DMv — tasks that defer goal Stop evaluation (agents/teammates/workflows + shells)
 */

import type { TaskState } from '../../tasks/types.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

/** densable SPv / Usv — default minutes when env unset. */
export const DEFAULT_GOAL_CHECKIN_MINUTES = 30

/** densable jsv — idle-timer exponential cap (`2 ** min(checkinCount, jsv)`). */
export const GOAL_CHECKIN_BACKOFF_CAP = 2

/** densable G9a — minimum idle-timer delay (also busy/queued retry). */
export const GOAL_CHECKIN_TIMER_MIN_MS = 60_000

/** densable rLe — setTimeout clamp. */
export const GOAL_CHECKIN_TIMER_MAX_MS = 2_147_483_647

/** densable EPv / zsv — max chars per task line in check-in body. */
export const GOAL_CHECKIN_TASK_LINE_MAX = 120

export type GoalCheckinActiveGoal = {
  condition: string
  setAt: number
  iterations: number
  tokensAtStart: number
  deferredSince?: number
  checkinCount?: number
  lastDeferralPassAt?: number
}

export type GoalDeferringTask = {
  id: string
  type: string
  status: string
  description?: string
  command?: string
  kind?: string
  startTime: number
  agentType?: string
  isIdle?: boolean
  isLongRunning?: boolean
  isObserver?: boolean
}

const AGENTISH_TYPES = new Set([
  'local_agent',
  'remote_agent',
  'in_process_teammate',
  'local_workflow',
])

const TASK_TYPE_LABEL: Record<string, string> = {
  local_agent: 'subagent',
  local_workflow: 'workflow',
  local_bash: 'shell',
  monitor_mcp: 'monitor',
  monitor_ws: 'monitor',
  mcp_task: 'MCP task',
  in_process_teammate: 'teammate',
  dream: 'dream',
  remote_agent: 'cloud session',
}

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed'
}

/** densable Wa — minimal XML escape for injected prompt text. */
export function escapeGoalCheckinXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/** densable BV — truncate with ellipsis + remaining char count. */
export function truncateGoalCheckinLine(
  text: string,
  max = GOAL_CHECKIN_TASK_LINE_MAX,
): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  return `${head}… [+${text.length - head.length} chars]`
}

/**
 * densable wPv — interval ms. `0` disables check-ins (env `=0` or GB off).
 */
export function getGoalCheckinIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
  deps: {
    isFeatureEnabled?: () => boolean
  } = {},
): number {
  const enabled =
    deps.isFeatureEnabled ??
    (() => getFeatureValue_CACHED_MAY_BE_STALE('tengu_saffron_wren', true))
  if (!enabled()) return 0
  const raw = env.CLAUDE_CODE_GOAL_CHECKIN_MINUTES
  let minutes = DEFAULT_GOAL_CHECKIN_MINUTES
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n)) minutes = n
  }
  if (minutes <= 0) return 0
  return minutes * 60_000
}

/**
 * densable Bqn interval before remainder clamp:
 * `base * 2 ** Math.min(checkinCount ?? 0, jsv)` → 30 → 60 → 120 min.
 */
export function getGoalCheckinBackoffIntervalMs(
  baseMs: number,
  checkinCount: number | undefined,
): number {
  return baseMs * 2 ** Math.min(checkinCount ?? 0, GOAL_CHECKIN_BACKOFF_CAP)
}

/**
 * densable Bqn delay: `min(rLe, max(G9a, backoff - (now - deferredSince)))`.
 */
export function getGoalIdleCheckinDelayMs(args: {
  baseMs: number
  checkinCount?: number
  deferredSince: number
  now: number
}): number {
  const backoff = getGoalCheckinBackoffIntervalMs(
    args.baseMs,
    args.checkinCount,
  )
  return Math.min(
    GOAL_CHECKIN_TIMER_MAX_MS,
    Math.max(
      GOAL_CHECKIN_TIMER_MIN_MS,
      backoff - (args.now - args.deferredSince),
    ),
  )
}

/**
 * densable lpi — agent-like non-terminal tasks (skip idle teammates / long-running remote).
 */
export function isGoalDeferringAgentTask(task: GoalDeferringTask): boolean {
  if (!AGENTISH_TYPES.has(task.type)) return false
  if (isTerminalStatus(task.status)) return false
  if (task.type === 'in_process_teammate' && task.isIdle) return false
  if (task.type === 'remote_agent' && task.isLongRunning) return false
  return true
}

/** densable cpi — non-terminal local_bash / local_shell. */
export function isGoalDeferringShellTask(task: GoalDeferringTask): boolean {
  return (
    (task.type === 'local_bash' || task.type === 'local_shell') &&
    !isTerminalStatus(task.status)
  )
}

/**
 * densable DMv — tasks that keep goal Stop evaluation deferred.
 * Skips observer agents and main-session local_agent.
 */
export function listGoalDeferringTasks(
  tasks: Record<string, TaskState | GoalDeferringTask>,
): GoalDeferringTask[] {
  return Object.values(tasks)
    .map(t => t as GoalDeferringTask)
    .filter(t => {
      if (t.type === 'local_agent' && t.isObserver === true) return false
      if (t.type === 'local_agent' && t.agentType === 'main-session')
        return false
      return isGoalDeferringAgentTask(t) || isGoalDeferringShellTask(t)
    })
}

/** densable kPv — deferral window bookkeeping. */
export function planGoalDeferralRun(
  goal: Pick<
    GoalCheckinActiveGoal,
    'deferredSince' | 'checkinCount' | 'lastDeferralPassAt'
  >,
  deferring: readonly { startTime: number }[],
  now: number,
  intervalMs: number,
): {
  deferredSince: number
  checkinCount: number
  isNewRun: boolean
} {
  if (goal.deferredSince === undefined) {
    return { deferredSince: now, checkinCount: 0, isNewRun: true }
  }
  const earliestStart = Math.min(...deferring.map(t => t.startTime))
  const isNewRun =
    goal.lastDeferralPassAt !== undefined &&
    Number.isFinite(earliestStart) &&
    earliestStart > goal.lastDeferralPassAt &&
    now - goal.lastDeferralPassAt > intervalMs
  if (isNewRun) {
    return { deferredSince: now, checkinCount: 0, isNewRun: true }
  }
  return {
    deferredSince: goal.deferredSince,
    checkinCount: goal.checkinCount ?? 0,
    isNewRun: false,
  }
}

/** densable APv — check-in body (still running vs cleared). */
export function formatGoalCheckinBody(
  condition: string,
  deferredMs: number,
  deferring: readonly GoalDeferringTask[],
): { summary: string; body: string } {
  const minutes = Math.max(1, Math.round(deferredMs / 60_000))
  const label = escapeGoalCheckinXml(condition.replace(/\s+/g, ' ').trim())
  if (deferring.length === 0) {
    return {
      summary: 'Goal check-in: background work no longer running',
      body: `Goal check-in: «${label}» is still active. Its evaluation was deferred for ${minutes} min while background work ran, and that work is no longer running (it finished or was stopped without reporting back). Continue toward the goal.`,
    }
  }
  const lines = deferring.map(t => {
    const isMonitor =
      (t.type === 'local_bash' || t.type === 'local_shell') &&
      t.kind === 'monitor'
    const typeLabel = isMonitor
      ? 'monitor'
      : (TASK_TYPE_LABEL[t.type] ?? t.type)
    const detail =
      (t.type === 'local_bash' || t.type === 'local_shell') && !isMonitor
        ? (t.command ?? t.description ?? '')
        : (t.description ?? t.command ?? '')
    const raw = `- ${t.id} · ${typeLabel} · ${detail}`
    return escapeGoalCheckinXml(truncateGoalCheckinLine(raw))
  })
  return {
    summary: 'Goal check-in: background work still running',
    body: `Goal check-in: «${label}» is still active, and evaluation has been deferred for ${minutes} min because background work is still running:
${lines.join('\n')}
Check on their progress (e.g. read their output). If they are progressing, say so briefly and keep waiting; if they are stuck or no longer needed, fix or stop them and continue toward the goal.`,
  }
}

export type GoalCheckinPlanResult = {
  nextGoal: GoalCheckinActiveGoal
  checkinText: string | undefined
  injected: boolean
}

/**
 * densable iYp — update deferral fields; optionally emit check-in text.
 */
export function planGoalCheckin(
  goal: GoalCheckinActiveGoal,
  deferring: readonly GoalDeferringTask[],
  now: number,
  deps: {
    getIntervalMs?: () => number
    onInjected?: (info: {
      trigger: string
      deferredMs: number
      checkinCount: number
      deferring: readonly GoalDeferringTask[]
    }) => void
  } = {},
): GoalCheckinPlanResult {
  const intervalMs = (deps.getIntervalMs ?? getGoalCheckinIntervalMs)()
  if (intervalMs === 0) {
    return { nextGoal: goal, checkinText: undefined, injected: false }
  }
  const run = planGoalDeferralRun(goal, deferring, now, intervalMs)
  const deferredMs = now - run.deferredSince
  if (deferredMs < intervalMs) {
    return {
      nextGoal: {
        ...goal,
        deferredSince: run.deferredSince,
        checkinCount: run.checkinCount,
        lastDeferralPassAt: now,
      },
      checkinText: undefined,
      injected: false,
    }
  }
  const checkinCount = run.checkinCount + 1
  const { body } = formatGoalCheckinBody(goal.condition, deferredMs, deferring)
  deps.onInjected?.({
    trigger: 'turn_end',
    deferredMs,
    checkinCount,
    deferring,
  })
  return {
    nextGoal: {
      ...goal,
      deferredSince: now,
      checkinCount,
      lastDeferralPassAt: now,
    },
    checkinText: body,
    injected: true,
  }
}

/** Clear deferral fields when background work is gone (densable else-branch). */
export function clearGoalDeferralFields(
  goal: GoalCheckinActiveGoal,
): GoalCheckinActiveGoal {
  if (goal.deferredSince === undefined) return goal
  return {
    ...goal,
    deferredSince: undefined,
    checkinCount: 0,
    lastDeferralPassAt: undefined,
  }
}
