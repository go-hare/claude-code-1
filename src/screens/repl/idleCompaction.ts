import { summarizePromptCache } from '../../commands/cost/promptCacheTracker.js'
import { logEvent } from '../../services/analytics/index.js'
import { currentLimits } from '../../services/claudeAiLimits.js'
import { isAutoCompactEnabled } from '../../services/compact/autoCompact.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { logError } from '../../utils/log.js'
import {
  getActiveSessionFromAls,
  getBootstrapSession,
  RootSessionSlot,
  runWithSession,
} from '../../utils/sessionRoot.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'

/** Official 2.1.325 constants for idle compaction (`n1r`, `o1r`, `s1r`, `l1r`). */
export const IDLE_COMPACT_DEFAULT_MIN_TOKENS = 200_000
export const IDLE_COMPACT_FLOOR_MIN_TOKENS = 100_000
export const IDLE_COMPACT_CACHE_FRACTION = 0.9
export const IDLE_COMPACT_MAX_LATE_MS = 60_000
/** Official 2.1.325 `fy` / `gy` (#1357 / #1446). */
export const IDLE_RETURN_MIN_MS = 1_800_000
export const IDLE_RETURN_MIN_TOKENS = 100_000

const IDLE_COMPACT_SETTINGS_HINT =
  ' · turn off with "idleCompaction": false in settings.json'
export const IDLE_COMPACT_COMPLETED_MESSAGE = `Compacted while idle, before the prompt cache expired${IDLE_COMPACT_SETTINGS_HINT}`
export const IDLE_COMPACT_SUMMARIZED_MESSAGE = `Compacted using a summary written while you were away${IDLE_COMPACT_SETTINGS_HINT}`

export type IdleCompactionSkipReason =
  | 'compaction_off'
  | 'idle_compaction_off'
  | 'precompute_compaction_off'
  | 'swap_unsupported'
  | 'prefix_changed'
  | 'not_one_hour'
  | 'lapsed'
  | 'small'
  | 'newer_request'
  | 'near_limit'

export type IdleCompactionRecord =
  | { timer: 'not_tried' }
  | { timer: 'unattended' | 'no_cache_record' | 'not_one_hour' | 'pending' }
  | {
      timer: 'fired'
      outcome: IdleCompactionSkipReason | 'started' | 'no_host' | string
      result?:
        | 'summarized'
        | 'compacted'
        | 'not_compacted'
        | 'cancelled'
        | 'failed'
    }

export type IdleCompactionSizes = {
  tokensBefore?: number
  tokensAfter?: number
}

export type IdleCompactionHost = {
  compact: (
    signal?: AbortSignal,
  ) => Promise<IdleCompactionSizes | null> | IdleCompactionSizes | null
  refusal?: () => Promise<string | undefined> | string | undefined
  abort?: () => void
}

/** Official 2.1.325 `hRn` (#1446). */
export function getIdleCompactMinTokens(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS
  const parsed = raw !== undefined ? Number(raw) : Number.NaN
  return Math.max(
    IDLE_COMPACT_FLOOR_MIN_TOKENS,
    Number.isFinite(parsed) ? parsed : IDLE_COMPACT_DEFAULT_MIN_TOKENS,
  )
}

export function isIdleCompactionSettingEnabled(): boolean {
  return getSettings_DEPRECATED()?.idleCompaction ?? true
}

export type IdleCompactionEligibilityContext = {
  autoCompactEnabled?: boolean
  idleCompactionEnabled?: boolean
  precomputeCompactionEnabled?: boolean
  swapSupported?: boolean
  cacheTtl?: '5m' | '1h' | null
  cacheWarm?: boolean
  lastRequestAt?: number | null
  rateLimitStatus?: string
  /**
   * Official 2.1.328 (`chunk@294254613.js:2206365` `QRe(y)`): fixed-load window
   * baseline tokens (`autoCompactWindow.loadTokens`). When present, idle
   * compaction requires `contextTokens - loadTokens >= 100_000`.
   */
  autoCompactWindow?: { loadTokens?: number }
  autoCompactWindowLoadTokens?: number
}

/**
 * Official 2.1.328 `Wus(isPrecompute, lateMs, contextTokens, turnEndMs, prefixIntact)`
 * (`chunk@294254613.js:2206350-2206420`).
 */
export function checkIdleCompactionEligibility(
  isPrecompute: boolean,
  lateMs: number,
  contextTokens: number,
  turnEndMs: number,
  prefixIntact: boolean,
  ctx: IdleCompactionEligibilityContext = {},
): IdleCompactionSkipReason | null {
  const autoCompact = ctx.autoCompactEnabled ?? isAutoCompactEnabled()
  if (!autoCompact) return 'compaction_off'

  const idleEnabled =
    ctx.idleCompactionEnabled ?? isIdleCompactionSettingEnabled()
  if (!idleEnabled) return 'idle_compaction_off'

  const precomputeEnabled = ctx.precomputeCompactionEnabled ?? true
  if (isPrecompute && !precomputeEnabled) return 'precompute_compaction_off'

  const swapSupported =
    ctx.swapSupported ?? !isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
  if (isPrecompute && !swapSupported) return 'swap_unsupported'

  if (!prefixIntact) return 'prefix_changed'

  const cache = summarizePromptCache()
  const ttl = ctx.cacheTtl ?? cache.lastRequest?.ttl ?? null
  if (ttl !== '1h') return 'not_one_hour'

  const warm = ctx.cacheWarm ?? cache.warm
  if (!warm || lateMs > IDLE_COMPACT_MAX_LATE_MS) return 'lapsed'

  const loadTokens =
    ctx.autoCompactWindowLoadTokens ?? ctx.autoCompactWindow?.loadTokens
  if (
    contextTokens < getIdleCompactMinTokens() ||
    (typeof loadTokens === 'number' &&
      Number.isFinite(loadTokens) &&
      contextTokens - loadTokens < IDLE_COMPACT_FLOOR_MIN_TOKENS)
  ) {
    return 'small'
  }

  const lastReqAt = ctx.lastRequestAt ?? cache.lastRequest?.at ?? 0
  if (lastReqAt > turnEndMs) return 'newer_request'

  // Official 2.1.328 (`chunk@294254613.js:2206410`): read live rate-limit status
  // from `currentLimits.status` instead of hardcoding `'allowed'`.
  const limitStatus = ctx.rateLimitStatus ?? currentLimits.status ?? 'allowed'
  if (limitStatus !== 'allowed') return 'near_limit'

  return null
}

async function runSafe(fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn()
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)))
  }
}

async function settleCompactionPromise(
  promise: Promise<IdleCompactionSizes | null>,
  successLabel: 'summarized' | 'compacted',
): Promise<{
  result: 'summarized' | 'compacted' | 'not_compacted' | 'cancelled' | 'failed'
  sizes: IdleCompactionSizes | null
}> {
  try {
    const sizes = await promise
    return {
      result: sizes === null ? 'not_compacted' : successLabel,
      sizes,
    }
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' || err.message.includes('aborted'))
    return {
      result: isAbort ? 'cancelled' : 'failed',
      sizes: null,
    }
  }
}

/** Official 2.1.325 `f1r` (#1446). */
export async function settleIdleCompaction(
  promise: Promise<IdleCompactionSizes | null>,
  startedAtMs: number,
  successLabel: 'summarized' | 'compacted',
): Promise<
  'summarized' | 'compacted' | 'not_compacted' | 'cancelled' | 'failed'
> {
  const { result, sizes } = await settleCompactionPromise(promise, successLabel)
  logEvent('tengu_idle_compact_settled', {
    result,
    durationMs: Date.now() - startedAtMs,
    tokensBefore: sizes?.tokensBefore,
    tokensAfter: sizes?.tokensAfter,
  })
  return result
}

/**
 * Official 2.1.325 `yRn` (#1446) — schedules idle compaction at 90% of the
 * 1h prompt-cache TTL window after a turn ends.
 */
export class IdleCompactionRunner {
  host: IdleCompactionHost | null = null
  summarize:
    | ((
        token: unknown,
      ) => Promise<IdleCompactionSizes | null> | IdleCompactionSizes | null)
    | null = null
  record: IdleCompactionRecord = { timer: 'not_tried' }
  lastTurnEnd: number | undefined = undefined
  lastTurnEndInfo:
    | { reason?: string; at: number; monotonicAt: number }
    | undefined = undefined
  private heldSummaryMessages: unknown[] | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlightAbort: AbortController | null = null

  recordTurnEnd(reason?: string): void {
    this.lastTurnEndInfo = {
      reason,
      at: Date.now(),
      monotonicAt: performance.now(),
    }
  }

  setHeldSummary(messages: unknown[] | null): void {
    this.heldSummaryMessages = messages
  }

  consumeHeldSummary(): unknown[] | null {
    const summary = this.heldSummaryMessages
    this.heldSummaryMessages = null
    return summary
  }

  consumeReturnAfterIdle(
    lastMessageAtMs: number | undefined,
    contextTokens: number,
  ): {
    idleSeconds: number
    contextTokens: number
    record: IdleCompactionRecord
  } | null {
    const prevRecord = this.record
    const prevTurnEnd = this.lastTurnEndInfo
    this.record = { timer: 'not_tried' }
    this.lastTurnEndInfo = undefined
    if (lastMessageAtMs === undefined) return null
    const now = Date.now()
    const idleMs = now - lastMessageAtMs
    const compacted =
      prevRecord.timer === 'fired' && prevRecord.result === 'compacted'
    if (
      !Number.isFinite(idleMs) ||
      idleMs < IDLE_RETURN_MIN_MS ||
      (contextTokens < IDLE_RETURN_MIN_TOKENS && !compacted)
    ) {
      return null
    }
    const idleSeconds = Math.round(idleMs / 1000)
    const sleptMs =
      prevTurnEnd !== undefined
        ? Math.max(
            0,
            Math.round(
              now -
                prevTurnEnd.at -
                (performance.now() - prevTurnEnd.monotonicAt),
            ),
          )
        : undefined
    logEvent('tengu_return_after_idle', {
      idle_seconds: idleSeconds,
      contextTokens,
      slept_ms: sleptMs,
      terminal_reason: prevTurnEnd?.reason,
      timer: prevRecord.timer,
      outcome: prevRecord.timer === 'fired' ? prevRecord.outcome : undefined,
      result: prevRecord.timer === 'fired' ? prevRecord.result : undefined,
      is_idle_compaction_on:
        isAutoCompactEnabled() &&
        isIdleCompactionSettingEnabled() &&
        this.host !== null,
    })
    return { idleSeconds, contextTokens, record: prevRecord }
  }

  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.inFlightAbort !== null) {
      this.inFlightAbort.abort('idle_compaction_cancelled')
      this.inFlightAbort = null
    }
    this.host?.abort?.()
  }

  arm(
    turnEndMs: number,
    getPrefixToken: () => unknown | null,
    options?: {
      isInteractive?: boolean
      getContextTokens?: () => number
      getAutoCompactWindowLoadTokens?: () => number | undefined
    },
  ): void {
    this.lastTurnEnd = turnEndMs
    void runSafe(() => {
      this.record = {
        timer: this.schedule(turnEndMs, getPrefixToken, options),
      }
    })
  }

  private schedule(
    turnEndMs: number,
    getPrefixToken: () => unknown | null,
    options?: {
      isInteractive?: boolean
      getContextTokens?: () => number
      getAutoCompactWindowLoadTokens?: () => number | undefined
    },
  ): 'unattended' | 'no_cache_record' | 'not_one_hour' | 'pending' {
    this.clear()
    if (options?.isInteractive === false) return 'unattended'
    const cache = summarizePromptCache()
    const ttl = cache.lastRequest?.ttl ?? null
    if (ttl === null) return 'no_cache_record'
    if (ttl !== '1h') return 'not_one_hour'
    if (cache.lastActivityAt === null || cache.expiresAt === null) {
      return 'no_cache_record'
    }
    const fireAtMs =
      cache.lastActivityAt +
      (cache.expiresAt - cache.lastActivityAt) * IDLE_COMPACT_CACHE_FRACTION
    const delayMs = Math.max(0, fireAtMs - Date.now())
    const captured = getActiveSessionFromAls()
    this.timer = setTimeout(() => {
      const run = () => {
        void runSafe(() =>
          this.fire(
            turnEndMs,
            fireAtMs,
            getPrefixToken,
            options?.getContextTokens,
            options?.getAutoCompactWindowLoadTokens,
          ),
        )
      }
      if (captured !== undefined && getActiveSessionFromAls() !== captured) {
        runWithSession(captured, run)
      } else {
        run()
      }
    }, delayMs)
    this.timer.unref?.()
    return 'pending'
  }

  private async fire(
    turnEndMs: number,
    fireAtMs: number,
    getPrefixToken: () => unknown | null,
    getContextTokens?: () => number,
    getAutoCompactWindowLoadTokens?: () => number | undefined,
  ): Promise<void> {
    this.timer = null
    const now = Date.now()
    const lateMs = Math.max(0, now - fireAtMs)
    const cache = summarizePromptCache()
    const cacheLeftMs = (cache.expiresAt ?? now) - now
    const contextTokens = getContextTokens ? getContextTokens() : 0
    const prefixToken = getPrefixToken()
    const isPrecompute = this.host === null
    const hostRef = this.host
    const hasAction =
      hostRef !== null || (this.summarize !== null && prefixToken !== null)

    const tokenLoad =
      getAutoCompactWindowLoadTokens?.() ??
      (prefixToken &&
      typeof prefixToken === 'object' &&
      'autoCompactWindow' in prefixToken
        ? (prefixToken as { autoCompactWindow?: { loadTokens?: number } })
            .autoCompactWindow?.loadTokens
        : undefined)
    const skip = checkIdleCompactionEligibility(
      isPrecompute,
      lateMs,
      contextTokens,
      turnEndMs,
      prefixToken !== null,
      tokenLoad !== undefined
        ? { autoCompactWindowLoadTokens: tokenLoad }
        : undefined,
    )
    const outcome =
      skip ??
      (hasAction ? ((await hostRef?.refusal?.()) ?? 'started') : 'no_host')
    this.record = { timer: 'fired', outcome }

    logEvent('tengu_idle_compact_fired', {
      outcome,
      cacheLeftMs,
      contextTokens,
      minTokens: getIdleCompactMinTokens(),
      lateMs,
      sinceTurnEndMs: now - turnEndMs,
    })

    if (outcome === 'started' && hasAction) {
      const ac = new AbortController()
      this.inFlightAbort = ac
      const action = hostRef
        ? () => hostRef.compact(ac.signal)
        : () => this.summarize!(prefixToken)
      try {
        this.record.result = await settleIdleCompaction(
          Promise.resolve().then(action),
          now,
          isPrecompute ? 'summarized' : 'compacted',
        )
      } finally {
        if (this.inFlightAbort === ac) {
          this.inFlightAbort = null
        }
      }
    }
  }
}

const idleCompactionRunnerBySession = new RootSessionSlot<IdleCompactionRunner>(
  () => new IdleCompactionRunner(),
)

export function getIdleCompactionRunner(): IdleCompactionRunner {
  return idleCompactionRunnerBySession.of(getBootstrapSession())
}
