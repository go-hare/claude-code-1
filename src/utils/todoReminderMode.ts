/**
 * Official YDs — CLAUDE_CODE_TODO_REMINDER_MODE / tengu_soft_slate_nudge.
 *
 * Modes: 'baseline' (default reminders) | 'off' (suppress todo reminders).
 * Env wins; else GB `tengu_soft_slate_nudge` ("off" → off, else baseline).
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'

export type TodoReminderMode = 'baseline' | 'off'

export function isTodoReminderMode(value: unknown): value is TodoReminderMode {
  return value === 'baseline' || value === 'off'
}

/**
 * Pure resolve: env > gb > baseline.
 */
export function resolveTodoReminderMode(
  env: NodeJS.ProcessEnv = process.env,
  gbValue: unknown = undefined,
): TodoReminderMode {
  const fromEnv = env.CLAUDE_CODE_TODO_REMINDER_MODE
  if (isTodoReminderMode(fromEnv)) return fromEnv
  if (gbValue === 'off') return 'off'
  if (gbValue === 'baseline') return 'baseline'
  return 'baseline'
}

/** Live resolve with GrowthBook. */
export function getTodoReminderMode(
  env: NodeJS.ProcessEnv = process.env,
): TodoReminderMode {
  return resolveTodoReminderMode(
    env,
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_soft_slate_nudge', 'baseline'),
  )
}

export function isTodoReminderEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getTodoReminderMode(env) !== 'off'
}
