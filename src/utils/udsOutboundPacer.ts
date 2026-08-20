/**
 * densable 2.1.236 #30 — outbound UDS send burst pacer (T5d / wDn / jKo / zKo).
 *
 * Reserve-before-send so a cross-session message is never falsely marked sent
 * when the peer's inbox rate limit would drop it. Distinct from ingress
 * peer-guard admit reasons (rate-limited / queue-full).
 */

import { z } from 'zod/v4'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { lazySchema } from './lazySchema.js'
import { canonicalSocketKey } from './udsIdleNotify.js'

/**
 * densable dX twin for outbound pacing keys.
 * Reuses tip `canonicalSocketKey` (named-pipe normalize / absolute resolve) —
 * do not invent a third algorithm.
 */
export function canonicalOutboundPaceKey(path: string): string | undefined {
  return canonicalSocketKey(path)
}

/** densable vla — defaults shared with harbor kite limits. */
export const DEFAULT_HARBOR_KITE_LIMITS = {
  bucketCapacity: 30,
  refillPerSecond: 0.5,
  dedupWindowMs: 30_000,
  maxSelfHops: 10,
  maxChainLength: 28,
  maxTrackedSenders: 256,
} as const

export type HarborKiteLimits = {
  bucketCapacity: number
  refillPerSecond: number
  dedupWindowMs: number
  maxSelfHops: number
  maxChainLength: number
  maxTrackedSenders: number
}

/** densable R5d — typed refuse class for outbound paced sends. */
export const UDS_OUTBOUND_PACED_ERROR_CLASS = 'outbound_paced' as const

/**
 * densable x5d — refuse when outbound burst would outpace the target's inbox
 * rate limit. `code` matches SEA second ctor arg; `errorClass` is R5d.
 */
export class UdsOutboundPacedError extends Error {
  readonly errorClass = UDS_OUTBOUND_PACED_ERROR_CLASS
  readonly code =
    'cross-session sends to one target outpaced its inbox rate limit' as const
  readonly sentInBurst: number

  constructor(sentInBurst: number) {
    super(
      `Too many messages to this session just now: ${sentInBurst} were sent recently and more would be dropped by its rate limit, so this one was not sent. Batch what remains into one message, or wait a little before sending more.`,
    )
    this.name = 'UdsOutboundPacedError'
    this.sentInBurst = sentInBurst
  }
}

/** densable hQt */
export function isUdsOutboundPacedError(
  error: unknown,
): error is UdsOutboundPacedError {
  return (
    error instanceof UdsOutboundPacedError &&
    error.errorClass === UDS_OUTBOUND_PACED_ERROR_CLASS
  )
}

export function createUdsOutboundPacedError(
  sentInBurst: number,
): UdsOutboundPacedError {
  return new UdsOutboundPacedError(sentInBurst)
}

type BucketState = {
  tokens: number
  updatedAt: number
  sentInBurst: number
  burstStartedAt: number
}

export type ReserveOk = {
  ok: true
  refund: () => void
}

export type ReserveFail = {
  ok: false
  sentInBurst: number
}

export type ReserveResult = ReserveOk | ReserveFail

export type OutboundPacer = {
  reserve: (key: string) => ReserveResult
  credit: (key: string) => void
  debit: (key: string) => void
}

/** densable zLb — noop reservation when pacing is skipped. */
export const NOOP_OUTBOUND_RESERVE: ReserveOk = {
  ok: true,
  refund: () => {},
}

/** densable wDn — refill tokens toward capacity over elapsed time. */
export function refillTokens(
  tokens: number,
  updatedAt: number,
  now: number,
  capacity: number,
  refillPerSecond: number,
): number {
  const elapsedSec = Math.max(0, now - updatedAt) / 1000
  return Math.min(capacity, tokens + elapsedSec * refillPerSecond)
}

/** densable jKo — true when at least one token is available. */
export function hasToken(tokens: number): boolean {
  return tokens >= 1
}

/**
 * densable zKo — LRU-ish map get-or-insert with capacity eviction.
 * Touches hit keys to the end; evicts first entry matching `canEvict`
 * (else oldest key) when at capacity.
 */
export function getOrInsertTracked<T>(
  map: Map<string, T>,
  key: string,
  maxTracked: number,
  create: () => T,
  canEvict: (value: T) => boolean = () => true,
): T {
  const existing = map.get(key)
  if (existing !== undefined) {
    map.delete(key)
    map.set(key, existing)
    return existing
  }
  while (map.size >= Math.max(1, maxTracked)) {
    let evictKey: string | undefined
    for (const [k, v] of map) {
      if (canEvict(v)) {
        evictKey = k
        break
      }
    }
    evictKey ??= map.keys().next().value
    if (evictKey === undefined) break
    map.delete(evictKey)
  }
  const created = create()
  map.set(key, created)
  return created
}

/**
 * densable T5d — per-target token bucket with sentInBurst tracking.
 * `limits` is a getter so GB updates apply on the next reserve.
 */
export function createOutboundPacer(
  limits: () => Pick<
    HarborKiteLimits,
    'bucketCapacity' | 'refillPerSecond' | 'maxTrackedSenders'
  >,
  nowFn: () => number = Date.now,
): OutboundPacer {
  const buckets = new Map<string, BucketState>()

  function touch(key: string, now: number): BucketState {
    const { bucketCapacity, refillPerSecond, maxTrackedSenders } = limits()
    let created = false
    const state = getOrInsertTracked(
      buckets,
      key,
      maxTrackedSenders,
      () => {
        created = true
        return {
          tokens: bucketCapacity,
          updatedAt: now,
          sentInBurst: 0,
          burstStartedAt: now,
        }
      },
      entry =>
        refillTokens(
          entry.tokens,
          entry.updatedAt,
          now,
          bucketCapacity,
          refillPerSecond,
        ) >= bucketCapacity,
    )
    if (!created) {
      state.tokens = refillTokens(
        state.tokens,
        state.updatedAt,
        now,
        bucketCapacity,
        refillPerSecond,
      )
      state.updatedAt = now
      const burstWindowMs =
        (bucketCapacity / Math.max(refillPerSecond, 0.000000001)) * 1000
      if (
        state.tokens >= bucketCapacity ||
        now - state.burstStartedAt > burstWindowMs
      ) {
        state.sentInBurst = 0
        state.burstStartedAt = now
      }
    }
    return state
  }

  function reserve(key: string): ReserveResult {
    const state = touch(key, nowFn())
    if (!hasToken(state.tokens)) {
      return { ok: false, sentInBurst: state.sentInBurst }
    }
    state.tokens -= 1
    state.sentInBurst += 1
    const snap = state
    let refunded = false
    return {
      ok: true,
      refund: () => {
        if (refunded) return
        refunded = true
        snap.tokens = Math.min(limits().bucketCapacity, snap.tokens + 1)
        snap.sentInBurst = Math.max(0, snap.sentInBurst - 1)
      },
    }
  }

  function credit(key: string): void {
    const state = touch(key, nowFn())
    state.tokens = Math.min(limits().bucketCapacity, state.tokens + 1)
    state.sentInBurst = Math.max(0, state.sentInBurst - 1)
  }

  function debit(key: string): void {
    const state = touch(key, nowFn())
    state.tokens = Math.max(0, state.tokens - 1)
    state.sentInBurst += 1
  }

  return { reserve, credit, debit }
}

const harborKiteLimitsSchema = lazySchema(() => {
  const d = DEFAULT_HARBOR_KITE_LIMITS
  return z.object({
    bucketCapacity: z.number().min(5).max(500).catch(d.bucketCapacity),
    refillPerSecond: z.number().min(0.05).max(50).catch(d.refillPerSecond),
    dedupWindowMs: z.number().int().min(0).max(600_000).catch(d.dedupWindowMs),
    maxSelfHops: z.number().int().min(3).max(100).catch(d.maxSelfHops),
    maxChainLength: z.number().int().min(8).max(99).catch(d.maxChainLength),
    maxTrackedSenders: z
      .number()
      .int()
      .min(16)
      .max(100_000)
      .catch(d.maxTrackedSenders),
  })
})

/**
 * densable JHr / OLb — read tengu_harbor_kite_limits with per-field catch-defaults.
 */
export function getHarborKiteLimits(): HarborKiteLimits {
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_harbor_kite_limits',
    DEFAULT_HARBOR_KITE_LIMITS,
  )
  const parsed = harborKiteLimitsSchema().safeParse(raw)
  if (!parsed.success) {
    logForDebugging(
      '[peer-guard] tengu_harbor_kite_limits is not an object; using defaults',
      { level: 'warn' },
    )
    return { ...DEFAULT_HARBOR_KITE_LIMITS }
  }
  return parsed.data
}

/**
 * densable P5d — pacing on unless env or GB force-off.
 * CLAUDE_CODE_HARBOR_KITE_PACING_OFF or tengu_harbor_kite_pacing_off → off.
 */
export function isHarborKitePacingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isEnvTruthy(env.CLAUDE_CODE_HARBOR_KITE_PACING_OFF)) {
    return false
  }
  return !getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_harbor_kite_pacing_off',
    false,
  )
}

/**
 * densable CDn gate fragment:
 * `(ownInbox !== undefined || platform !== windows) && P5d()`.
 * Windows without an own inbox skips the pacer (noop ok).
 */
export function shouldPaceOutboundSend(input: {
  ownSocketPath: string | undefined
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
}): boolean {
  const platform = input.platform ?? process.platform
  const hasOwnInbox = input.ownSocketPath !== undefined
  if (!(hasOwnInbox || platform !== 'win32')) {
    return false
  }
  return isHarborKitePacingEnabled(input.env)
}

let sharedPacer: OutboundPacer | undefined

/** densable jLb — lazy process-wide outbound pacer. */
export function getOutboundPacer(): OutboundPacer {
  return (sharedPacer ??= createOutboundPacer(getHarborKiteLimits))
}

/** Test-only: drop the shared singleton so limits/clock inject cleanly. */
export function resetOutboundPacerForTests(): void {
  sharedPacer = undefined
}
