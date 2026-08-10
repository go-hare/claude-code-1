/**
 * densable ScheduleWakeup / dynamic /loop runtime (SEA 2.1.221).
 *
 * Mirrors:
 *   jKe  — tengu_kairos_loop_dynamic gate
 *   Cfr  — tengu_loop_noop_fold (optional noop field)
 *   NU_  — clamp delaySeconds to [60,3600] + minute snap + cacheLeadMs
 *   ZKu  — schedule one-shot kind:"loop" session cron
 *   QKu  — stop:true cancel all loop wakeups
 *   JKu  — model schedule entry (viaKeepalive:false)
 *
 * Session state lives in bootstrap/state (loopChainStartedAt / loopEnded / …).
 */

import {
  addSessionCronTask,
  clearLoopChainStartedAt,
  getLoopChainStartedAt,
  getLoopConsecutiveKeepalives,
  getLoopEnded,
  getLoopTickInFlightPrompt,
  getSessionCronTasks,
  removeSessionCronTasks,
  setLoopChainStartedAt,
  setLoopConsecutiveKeepalives,
  setLoopEnded,
  setLoopTickInFlightPrompt,
  setScheduledTasksEnabled,
  type SessionCronTask,
} from '../bootstrap/state.js'
import { logEvent } from '../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logForDebugging } from './debug.js'
import {
  DEFAULT_CRON_JITTER_CONFIG,
  type CronJitterConfig,
} from './cronTasks.js'
import { getCronJitterConfig } from './cronJitterConfig.js'
import { isEnvTruthy } from './envUtils.js'

/** densable loop.md sentinels (also in loopFire; inlined to avoid circular import). */
const LOOP_FILE_SENTINEL = '<<loop.md>>'
const LOOP_FILE_DYNAMIC_SENTINEL = '<<loop.md-dynamic>>'

/** densable `IU_` subset used by keepalive telemetry. */
function isLoopDefaultSentinelPrompt(prompt: string): boolean {
  return (
    prompt === AUTONOMOUS_LOOP_SENTINEL ||
    prompt === AUTONOMOUS_LOOP_DYNAMIC_SENTINEL ||
    prompt === LOOP_FILE_SENTINEL ||
    prompt === LOOP_FILE_DYNAMIC_SENTINEL
  )
}

/** densable `xin` — min delaySeconds */
export const LOOP_WAKEUP_MIN_SECONDS = 60
/** densable `zwo` — max delaySeconds */
export const LOOP_WAKEUP_MAX_SECONDS = 3600
/** densable `MU_` — keepalive fallback delaySeconds */
export const LOOP_KEEPALIVE_FALLBACK_SECONDS = 1200
/** densable `LU_` — consecutive keepalives before ending loop */
export const LOOP_KEEPALIVE_BUDGET = 1
/** densable `Tin` — 5-minute prompt-cache TTL (ms) used by NU_ cacheLead snap */
export const LOOP_PROMPT_CACHE_TTL_MS = 300_000

/** densable `Efr` — CronCreate-based autonomous loop sentinel */
export const AUTONOMOUS_LOOP_SENTINEL = '<<autonomous-loop>>'
/** densable `tmt` / `kin` — ScheduleWakeup dynamic-loop sentinel */
export const AUTONOMOUS_LOOP_DYNAMIC_SENTINEL = '<<autonomous-loop-dynamic>>'

/**
 * densable `jKe` — GrowthBook gate for ScheduleWakeup / dynamic /loop.
 * Default false (must be explicitly enabled).
 */
export function isKairosLoopDynamicEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_loop_dynamic', false)
}

/**
 * densable `Cfr` — when true, ScheduleWakeup inputSchema includes required `noop`.
 */
export function isLoopNoopFoldEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_loop_noop_fold', false)
}

/**
 * densable `YKu` — harness re-arms a fallback wakeup when the model forgets
 * ScheduleWakeup at end of tick. Env CLAUDE_CODE_LOOP_KEEPALIVE wins.
 */
export function isLoopKeepaliveGateEnabled(): boolean {
  if (process.env.CLAUDE_CODE_LOOP_KEEPALIVE !== undefined) {
    return isEnvTruthy(process.env.CLAUDE_CODE_LOOP_KEEPALIVE)
  }
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_kairos_loop_keepalive',
    false,
  )
}

/**
 * densable `GAs` — clear loopEnded when the user (re)starts a dynamic /loop.
 */
export function clearLoopEndedOnLoopStart(): void {
  setLoopEnded(false)
}

export type ClampedWakeup = {
  clamped: number
  wasClamped: boolean
  targetMs: number
  createdAt: number
  target: Date
}

/**
 * densable `NU_` — clamp delaySeconds and snap fire time to minute boundary,
 * optionally pulling earlier by cacheLeadMs when within 5m cache TTL.
 */
export function clampWakeupDelaySeconds(
  delaySeconds: number,
  nowMs: number = Date.now(),
  jitterCfg: CronJitterConfig = getCronJitterConfigSafe(),
): ClampedWakeup {
  let rounded: number
  if (Number.isNaN(delaySeconds)) rounded = LOOP_WAKEUP_MIN_SECONDS
  else if (delaySeconds === Infinity) rounded = LOOP_WAKEUP_MAX_SECONDS
  else if (delaySeconds === -Infinity) rounded = LOOP_WAKEUP_MIN_SECONDS
  else rounded = Math.round(delaySeconds)

  const clamped = Math.max(
    LOOP_WAKEUP_MIN_SECONDS,
    Math.min(LOOP_WAKEUP_MAX_SECONDS, rounded),
  )
  const wasClamped = !Number.isFinite(delaySeconds) || rounded !== clamped
  const idealMs = nowMs + clamped * 1000
  let targetMs = snapToNextMinute(idealMs)

  const cacheLeadMs = jitterCfg.cacheLeadMs ?? 0
  if (cacheLeadMs > 0 && clamped * 1000 <= LOOP_PROMPT_CACHE_TTL_MS) {
    const maxLead = LOOP_PROMPT_CACHE_TTL_MS - cacheLeadMs
    while (
      targetMs - nowMs > maxLead &&
      targetMs - 60_000 >= nowMs + LOOP_WAKEUP_MIN_SECONDS * 1000
    ) {
      targetMs -= 60_000
    }
  }

  const target = new Date(targetMs)
  // densable: createdAt = ideal < snapped ? ideal : snapped - 1
  const createdAt = idealMs < targetMs ? idealMs : targetMs - 1
  return { clamped, wasClamped, targetMs, createdAt, target }
}

/** densable `$U_` — ceil to next whole minute. */
export function snapToNextMinute(epochMs: number): number {
  const d = new Date(epochMs)
  if (d.getSeconds() > 0 || d.getMilliseconds() > 0) {
    d.setMinutes(d.getMinutes() + 1)
  }
  d.setSeconds(0, 0)
  return d.getTime()
}

/** densable `FU_` — 8-hex random id (same width as CronCreate short ids). */
export function newLoopWakeupId(): string {
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0')
}

export type ScheduleWakeupResult = {
  scheduledFor: number
  clampedDelaySeconds: number
  wasClamped: boolean
}

/**
 * densable `$$t` — mark loop ended + analytics.
 */
export function markLoopEnded(
  reason: string,
  extra?: Record<string, string | number | boolean>,
): void {
  setLoopEnded(true)
  logEvent('tengu_loop_ended', {
    reason: reason as never,
    ...(extra ?? {}),
  } as never)
}

/**
 * densable `BU_` — cancel all pending kind:"loop" session tasks; return count.
 */
export function cancelPendingLoopWakeups(): number {
  const ids = getSessionCronTasks()
    .filter(t => t.kind === 'loop')
    .map(t => t.id)
  if (ids.length === 0) return 0
  return removeSessionCronTasks(ids)
}

/**
 * densable `QKu` — ScheduleWakeup({stop:true}).
 * Returns cancelled wakeup count.
 */
export function stopDynamicLoop(): number {
  const alreadyEnded = getLoopEnded()
  const pending = getSessionCronTasks().filter(t => t.kind === 'loop')
  const inFlight = getLoopTickInFlightPrompt()
  setLoopTickInFlightPrompt(null)
  setLoopConsecutiveKeepalives(0)
  removeSessionCronTasks(pending.map(t => t.id))
  for (const t of pending) clearLoopChainStartedAt(t.prompt)
  if (inFlight !== null) clearLoopChainStartedAt(inFlight)
  if (alreadyEnded) {
    logForDebugging(
      '[loop] ScheduleWakeup({stop:true}) after loop already ended — cleanup only, terminal event suppressed',
    )
    return pending.length
  }
  logForDebugging(
    `[loop] model called ScheduleWakeup({stop:true}) — ending loop (${pending.length} pending wakeup(s) cancelled${inFlight !== null ? ', tick in flight' : ''})`,
  )
  markLoopEnded('model_stopped', { via_keepalive: false })
  logEvent('loop_schedule_wakeup' as never, {} as never)
  return pending.length
}

/**
 * densable `ZKu` / `JKu` — schedule a dynamic-loop one-shot wakeup.
 * Returns null when aged out.
 */
export function scheduleDynamicWakeup(
  delaySeconds: number,
  prompt: string,
  opts: {
    viaKeepalive?: boolean
    reason?: string
    nowMs?: number
  } = {},
): ScheduleWakeupResult | null {
  const viaKeepalive = opts.viaKeepalive === true
  const nowMs = opts.nowMs ?? Date.now()
  if (!viaKeepalive) setLoopConsecutiveKeepalives(0)

  // supersede prior loop wakeups (count for telemetry)
  const superseded = cancelPendingLoopWakeups()

  const chain = getLoopChainStartedAt(prompt)
  const gapExpired =
    chain !== undefined &&
    nowMs > chain.lastScheduledFor + LOOP_WAKEUP_MAX_SECONDS * 1000
  const startedAt = chain === undefined || gapExpired ? nowMs : chain.startedAt

  const jitterCfg = getCronJitterConfigSafe()
  const maxAge = jitterCfg.recurringMaxAgeMs
  if (maxAge > 0 && nowMs - startedAt >= maxAge) {
    if (!chain?.agedOut) {
      setLoopChainStartedAt(prompt, {
        startedAt,
        lastScheduledFor:
          nowMs - (LOOP_WAKEUP_MAX_SECONDS - LOOP_WAKEUP_MIN_SECONDS) * 1000,
        agedOut: true,
      })
      logEvent(
        'tengu_loop_dynamic_wakeup_aged_out' as never,
        {
          loop_age_ms: nowMs - startedAt,
          max_age_ms: maxAge,
        } as never,
      )
      markLoopEnded('aged_out', { via_keepalive: viaKeepalive })
      logEvent(
        'loop_schedule_wakeup' as never,
        {
          reason: 'loop_wakeup_aged_out',
        } as never,
      )
    }
    return null
  }

  const { clamped, wasClamped, targetMs, createdAt, target } =
    clampWakeupDelaySeconds(delaySeconds, nowMs, jitterCfg)

  // densable: cron = `${minute} ${hour} * * *` (local), one-shot kind loop
  const cron = `${target.getMinutes()} ${target.getHours()} * * *`
  const task: SessionCronTask = {
    id: newLoopWakeupId(),
    cron,
    prompt,
    createdAt,
    kind: 'loop',
  }
  addSessionCronTask(task)
  setLoopChainStartedAt(prompt, {
    startedAt,
    lastScheduledFor: targetMs,
  })
  setScheduledTasksEnabled(true)
  setLoopEnded(false)

  if (viaKeepalive) {
    setLoopConsecutiveKeepalives(getLoopConsecutiveKeepalives() + 1)
    logForDebugging(
      `[loop] keepalive armed (model did not reschedule): ${clamped}s fallback`,
    )
    logEvent(
      'tengu_loop_keepalive_fired' as never,
      {
        clamped_delay_seconds: clamped,
        // densable: HU_.isLoopDefaultSentinel(t)
        prompt_is_sentinel: isLoopDefaultSentinelPrompt(prompt),
      } as never,
    )
    logEvent(
      'loop_schedule_wakeup' as never,
      {
        reason: 'model_no_reschedule',
      } as never,
    )
    return {
      scheduledFor: targetMs,
      clampedDelaySeconds: clamped,
      wasClamped,
    }
  }

  logForDebugging(
    `[loop] dynamic wakeup scheduled: ${clamped}s${wasClamped ? ` (clamped from ${delaySeconds}s)` : ''}${opts.reason !== undefined ? ` — ${opts.reason}` : ''}`,
  )
  logEvent(
    'tengu_loop_dynamic_wakeup_scheduled' as never,
    {
      chosen_delay_seconds: Number.isFinite(delaySeconds) ? delaySeconds : 0,
      clamped_delay_seconds: clamped,
      was_clamped: wasClamped,
      reason_length: opts.reason?.length ?? 0,
      superseded_count: superseded,
    } as never,
  )
  logEvent('loop_schedule_wakeup' as never, {} as never)
  return {
    scheduledFor: targetMs,
    clampedDelaySeconds: clamped,
    wasClamped,
  }
}

/** densable `JKu` — model-driven schedule (not keepalive). */
export function scheduleModelWakeup(
  delaySeconds: number,
  prompt: string,
  reason?: string,
): ScheduleWakeupResult | null {
  return scheduleDynamicWakeup(delaySeconds, prompt, {
    viaKeepalive: false,
    reason,
  })
}

/**
 * densable `XKu` — harness keepalive when the model finished a tick without
 * re-arming ScheduleWakeup. Budget LU_=1 consecutive keepalives.
 */
export function scheduleKeepaliveWakeup(
  prompt: string,
): ScheduleWakeupResult | null {
  if (!isKairosLoopDynamicEnabled()) {
    markLoopEnded('gate_off')
    return null
  }
  if (getLoopConsecutiveKeepalives() >= LOOP_KEEPALIVE_BUDGET) {
    logForDebugging(
      '[loop] keepalive budget exhausted (model declined to reschedule twice) — ending loop',
    )
    markLoopEnded('model_stopped', { via_keepalive: true })
    return null
  }
  return scheduleDynamicWakeup(LOOP_KEEPALIVE_FALLBACK_SECONDS, prompt, {
    viaKeepalive: true,
  })
}

/** densable `rmt` — any pending kind:"loop" session wakeup. */
export function hasPendingLoopWakeups(): boolean {
  return getSessionCronTasks().some(t => t.kind === 'loop')
}

/** densable Vwo end reason — Esc/SIGINT = user_abort; SIGTERM/remote = remote_cancel. */
export type LoopWakeupCancelReason = 'user_abort' | 'remote_cancel'

/**
 * densable `Vwo` — user/remote abort cancels pending loop wakeups + in-flight tick chain.
 * Returns cancelled pending count (not including in-flight-only).
 *
 * @param reason analytics/markLoopEnded reason. Default `user_abort` (Esc/SIGINT).
 *   Headless SIGTERM / remote-cancel should pass `remote_cancel`.
 */
export function cancelLoopWakeupsOnUserAbort(
  reason: LoopWakeupCancelReason = 'user_abort',
): number {
  const pending = getSessionCronTasks().filter(t => t.kind === 'loop')
  const inFlight = getLoopTickInFlightPrompt()
  setLoopTickInFlightPrompt(null)
  setLoopConsecutiveKeepalives(0)
  if (pending.length === 0 && inFlight === null) return 0
  removeSessionCronTasks(pending.map(t => t.id))
  for (const t of pending) clearLoopChainStartedAt(t.prompt)
  if (inFlight !== null) clearLoopChainStartedAt(inFlight)
  logForDebugging(
    `[loop/dynamic] cancelled ${pending.length} pending loop wakeup(s) on ${reason}${inFlight !== null ? ' (tick in flight)' : ''}`,
  )
  markLoopEnded(reason, { loops_cancelled: pending.length })
  logEvent('loop_cancel_all' as never, { reason } as never)
  return pending.length
}

export type SettleLoopTickOptions = {
  /**
   * When false, only clear aPt — never arm XKu. Use when headless input is
   * closed or process is shutting down (keepalive would never fire).
   * Default true.
   */
  armKeepalive?: boolean
}

/**
 * densable post-tick harness — clear aPt after the turn ends idle, then XKu
 * when YKu is on and no pending loop wakeup remains (model forgot ScheduleWakeup).
 *
 * Shared by:
 *   - REPL `useScheduledTasks` when `isLoading` → false
 *   - headless `print.ts` `run()` finally after `running = false`
 *
 * Does NOT call scheduler.checkNow() — callers that own a CronScheduler should
 * invoke checkNow after this so a just-armed keepalive is not stranded until
 * the next 1s tick (usually irrelevant for 1200s fallback, but mirrors densable).
 */
export function settleLoopTickAfterIdle(options: SettleLoopTickOptions = {}): {
  hadInFlight: boolean
  /** undefined = no XKu attempt; null = XKu attempted but did not arm; else armed */
  keepalive: ScheduleWakeupResult | null | undefined
} {
  const armKeepalive = options.armKeepalive !== false
  const inFlight = getLoopTickInFlightPrompt()
  if (inFlight === null) {
    return { hadInFlight: false, keepalive: undefined }
  }
  setLoopTickInFlightPrompt(null)
  if (
    armKeepalive &&
    isLoopKeepaliveGateEnabled() &&
    !hasPendingLoopWakeups()
  ) {
    const keepalive = scheduleKeepaliveWakeup(inFlight)
    return { hadInFlight: true, keepalive }
  }
  return { hadInFlight: true, keepalive: undefined }
}

function getCronJitterConfigSafe(): CronJitterConfig {
  try {
    return getCronJitterConfig()
  } catch {
    return DEFAULT_CRON_JITTER_CONFIG
  }
}
