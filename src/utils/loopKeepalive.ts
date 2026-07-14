/**
 * Official CLAUDE_CODE_LOOP_KEEPALIVE / LOOP_PERSISTENT + GB densables.
 * Full Kairos /loop runtime remains denser; these are the switches + pure plans.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvTruthy } from './envUtils.js'

/** Default proactive tick interval (ms) — under prompt-cache TTL. */
export const LOOP_DEFAULT_TICK_INTERVAL_MS = 30_000

/**
 * Keepalive tick interval (ms) — longer cadence to keep cache warm without
 * aggressive autonomous ticks when LOOP_KEEPALIVE is on.
 */
export const LOOP_KEEPALIVE_TICK_INTERVAL_MS = 240_000

export function isLoopKeepaliveEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (env.CLAUDE_CODE_LOOP_KEEPALIVE !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_LOOP_KEEPALIVE)
  }
  if (input?.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_kairos_loop_keepalive',
    false,
  )
}

export function isLoopPersistentEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (env.CLAUDE_CODE_LOOP_PERSISTENT !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_LOOP_PERSISTENT)
  }
  if (input?.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_kairos_loop_persistent',
    false,
  )
}

/**
 * Official densable — tick interval when loop/proactive is active.
 * Keepalive uses a longer interval; otherwise default 30s.
 */
export function resolveLoopTickIntervalMs(input?: {
  env?: NodeJS.ProcessEnv
  keepaliveEnabled?: boolean
  defaultMs?: number
  keepaliveMs?: number
}): number {
  const keepalive =
    input?.keepaliveEnabled ?? isLoopKeepaliveEnabled({ env: input?.env })
  if (keepalive) {
    return input?.keepaliveMs ?? LOOP_KEEPALIVE_TICK_INTERVAL_MS
  }
  return input?.defaultMs ?? LOOP_DEFAULT_TICK_INTERVAL_MS
}

/**
 * Official densable — should /loop survive idle / session boundary.
 * Persistent keeps durable scheduling; keepalive keeps process ticks alive
 * even when the user has not re-armed.
 */
export function planLoopKeepaliveBehavior(input?: {
  env?: NodeJS.ProcessEnv
  keepaliveEnabled?: boolean
  persistentEnabled?: boolean
  loopActive?: boolean
  userRequestedStop?: boolean
}): {
  keepalive: boolean
  persistent: boolean
  /** Keep scheduling ticks when loop was active (unless user stop). */
  shouldContinueTicks: boolean
  intervalMs: number
  /** Persist loop schedule across session clear / restart. */
  shouldPersistSchedule: boolean
} {
  const keepalive =
    input?.keepaliveEnabled ?? isLoopKeepaliveEnabled({ env: input?.env })
  const persistent =
    input?.persistentEnabled ?? isLoopPersistentEnabled({ env: input?.env })
  const userStop = input?.userRequestedStop === true
  const loopActive = input?.loopActive === true
  const shouldContinueTicks = !userStop && (loopActive || keepalive)
  const shouldPersistSchedule = persistent && !userStop
  return {
    keepalive,
    persistent,
    shouldContinueTicks,
    intervalMs: resolveLoopTickIntervalMs({
      env: input?.env,
      keepaliveEnabled: keepalive,
    }),
    shouldPersistSchedule,
  }
}
