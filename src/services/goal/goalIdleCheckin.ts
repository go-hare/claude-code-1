/**
 * densable 2.1.236 `/goal` idle+parked check-in timer (Uqn / Bqn / V9a / Wsv).
 *
 * Gold:
 *   Uqn — clear pending idle timer
 *   Bqn — arm `base * 2**min(checkinCount, jsv)` remainder, clamp G9a…rLe
 *   Wsv — fire: busy / queued-goal-checkin / queued-main-notif → retry G9a;
 *         new deferral run → reset count; else inject + re-arm
 *   mTi — queue task-notification origin `{kind, source: goal-checkin}`
 *
 * Empty deferring still injects + re-arms Bqn (gold Wsv). Cancel = clearTimeout
 * only (no tip invent generation gate).
 */

import { getMainLoopBusy, getMainThreadAgentId } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import {
  enqueuePendingNotification,
  peek,
} from '../../utils/messageQueueManager.js'
import { wrapInSystemReminder } from '../../utils/messages.js'
import { logForDebugging } from '../../utils/debug.js'
import { logEvent } from '../analytics/index.js'
import {
  escapeGoalCheckinXml,
  formatGoalCheckinBody,
  getGoalCheckinIntervalMs,
  getGoalIdleCheckinDelayMs,
  GOAL_CHECKIN_TIMER_MIN_MS,
  listGoalDeferringTasks,
  planGoalDeferralRun,
  type GoalCheckinActiveGoal,
  type GoalDeferringTask,
} from './goalCheckin.js'

export const GOAL_CHECKIN_ORIGIN = {
  kind: 'task-notification',
  source: 'goal-checkin',
} as const

export type GoalIdleCheckinContext = {
  goal: GoalCheckinActiveGoal
  now: number
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  getDeferringTasks?: () => GoalDeferringTask[]
  deliver?: (formatted: { summary: string; body: string }) => void
  hasQueued?: (pred: (cmd: QueuedCommand) => boolean) => boolean
  getIntervalMs?: () => number
  isMainLoopBusy?: () => boolean
  nowMs?: () => number
}

let pendingGoalIdleCheckin: ReturnType<typeof setTimeout> | undefined

function clearPendingTimerOnly(): void {
  if (pendingGoalIdleCheckin !== undefined) {
    clearTimeout(pendingGoalIdleCheckin)
    pendingGoalIdleCheckin = undefined
  }
}

export function cancelPendingGoalIdleCheckin(): void {
  clearPendingTimerOnly()
}

export function replacePendingGoalIdleCheckin(
  timer: ReturnType<typeof setTimeout> | undefined,
): void {
  // densable hygiene: always clear the prior timer before replacing so callers
  // cannot leak a deferred fire when they forget cancelPendingGoalIdleCheckin.
  clearPendingTimerOnly()
  pendingGoalIdleCheckin = timer
}

export function getPendingGoalIdleCheckin():
  | ReturnType<typeof setTimeout>
  | undefined {
  return pendingGoalIdleCheckin
}

/** densable Yht — queued idle check-in still waiting to drain. */
export function isGoalCheckinQueuedCommand(cmd: QueuedCommand): boolean {
  const origin = cmd.origin as { kind?: string; source?: string } | undefined
  return (
    origin?.kind === 'task-notification' && origin.source === 'goal-checkin'
  )
}

/** densable qsv — main-thread non-passive task-notification. */
export function isMainThreadActiveTaskNotification(
  cmd: QueuedCommand,
  mainAgentId: string = getMainThreadAgentId(),
): boolean {
  return (
    cmd.mode === 'task-notification' &&
    cmd.agentId === mainAgentId &&
    (cmd as { passive?: boolean }).passive !== true
  )
}

/**
 * densable MO({summary}) + sT(body) trailing.
 * Tag names are SEA literals (TS/DH), not xml.ts exports — those are
 * mock.module-polluted by other bun:test files.
 */
export function formatGoalIdleCheckinNotification(
  summary: string,
  body: string,
): string {
  return `<task-notification>
<summary>${escapeGoalCheckinXml(summary)}</summary>
</task-notification>
${wrapInSystemReminder(body)}`
}

function defaultDeliver(formatted: { summary: string; body: string }): void {
  enqueuePendingNotification({
    value: formatGoalIdleCheckinNotification(formatted.summary, formatted.body),
    mode: 'task-notification',
    agentId: getMainThreadAgentId(),
    origin: GOAL_CHECKIN_ORIGIN,
  })
}

function defaultHasQueued(pred: (cmd: QueuedCommand) => boolean): boolean {
  return peek(pred) !== undefined
}

function scheduleFire(ctx: GoalIdleCheckinContext, delayMs: number): void {
  const timer = setTimeout(() => {
    pendingGoalIdleCheckin = undefined
    fireGoalIdleCheckin(ctx)
  }, delayMs)
  timer.unref()
  pendingGoalIdleCheckin = timer
}

/**
 * densable Bqn — (re)arm idle check-in. No-op when interval is 0 or
 * `deferredSince` is unset.
 */
export function armGoalIdleCheckin(ctx: GoalIdleCheckinContext): void {
  cancelPendingGoalIdleCheckin()
  const baseMs = (ctx.getIntervalMs ?? getGoalCheckinIntervalMs)()
  if (baseMs === 0 || ctx.goal.deferredSince === undefined) return
  const delayMs = getGoalIdleCheckinDelayMs({
    baseMs,
    checkinCount: ctx.goal.checkinCount,
    deferredSince: ctx.goal.deferredSince,
    now: ctx.now,
  })
  scheduleFire(ctx, delayMs)
}

function retrySoon(ctx: GoalIdleCheckinContext): void {
  scheduleFire(ctx, GOAL_CHECKIN_TIMER_MIN_MS)
}

/** densable Wsv — idle timer fire. */
export function fireGoalIdleCheckin(ctx: GoalIdleCheckinContext): void {
  clearPendingTimerOnly()
  let armed = ctx.goal
  try {
    const current = ctx.getAppState().activeGoal
    if (
      current === undefined ||
      current.setAt !== ctx.goal.setAt ||
      current.condition !== ctx.goal.condition ||
      current.deferredSince === undefined
    ) {
      return
    }
    const baseMs = (ctx.getIntervalMs ?? getGoalCheckinIntervalMs)()
    if (baseMs === 0) return

    const busy = ctx.isMainLoopBusy ?? getMainLoopBusy
    const hasQueued = ctx.hasQueued ?? defaultHasQueued
    if (busy() || hasQueued(isGoalCheckinQueuedCommand)) {
      retrySoon(ctx)
      return
    }

    const deferring = (
      ctx.getDeferringTasks ??
      (() => listGoalDeferringTasks(ctx.getAppState().tasks))
    )()
    if (
      deferring.length === 0 &&
      hasQueued(cmd => isMainThreadActiveTaskNotification(cmd))
    ) {
      retrySoon(ctx)
      return
    }

    const now = (ctx.nowMs ?? Date.now)()
    const run = planGoalDeferralRun(current, deferring, now, baseMs)
    if (run.isNewRun) {
      const next: GoalCheckinActiveGoal = {
        ...current,
        deferredSince: now,
        checkinCount: 0,
        lastDeferralPassAt: now,
      }
      ctx.setAppState(prev =>
        prev.activeGoal !== current ? prev : { ...prev, activeGoal: next },
      )
      armed = next
      armGoalIdleCheckin({ ...ctx, goal: next, now })
      return
    }

    const deferredMs = now - run.deferredSince
    const checkinCount = run.checkinCount + 1
    const formatted = formatGoalCheckinBody(
      current.condition,
      deferredMs,
      deferring,
    )

    const next: GoalCheckinActiveGoal = {
      ...current,
      deferredSince: now,
      checkinCount,
      lastDeferralPassAt: now,
    }
    ctx.setAppState(prev =>
      prev.activeGoal !== current ? prev : { ...prev, activeGoal: next },
    )
    armed = next
    ;(ctx.deliver ?? defaultDeliver)(formatted)
    const shells = deferring.filter(
      t => t.type === 'local_bash' || t.type === 'local_shell',
    ).length
    logEvent('tengu_goal_checkin_injected', {
      deferredMs,
      activeShells: shells,
      activeAgents: deferring.length - shells,
      checkinCount,
    })
    logForDebugging(
      `[goal] check-in injected (idle_timer) after ${Math.round(deferredMs / 1000)}s deferred`,
    )
    armGoalIdleCheckin({ ...ctx, goal: next, now })
  } catch (err) {
    logForDebugging(
      `[goal] idle check-in fire failed: ${err instanceof Error ? err.message : String(err)}`,
      { level: 'error' },
    )
    try {
      if (armed.deferredSince !== undefined) {
        armGoalIdleCheckin({
          ...ctx,
          goal: armed,
          now: (ctx.nowMs ?? Date.now)(),
        })
      }
    } catch {
      // densable Wsv: swallow re-arm failure after fire_failed
    }
  }
}
