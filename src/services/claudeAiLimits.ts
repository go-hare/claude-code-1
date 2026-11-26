import { APIError } from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import isEqual from 'lodash-es/isEqual.js'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { isClaudeAISubscriber } from '../utils/auth.js'
import { getModelBetas } from '../utils/betas.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { logError } from '../utils/log.js'
import { getSmallFastModel } from '../utils/model/model.js'
import { getAPIProvider } from '../utils/model/providers.js'
import { isEssentialTrafficOnly } from '../utils/privacyLevel.js'
import { getBootstrapSessionHost, HostSlot } from '../utils/sessionRoot.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from './analytics/index.js'
import { logEvent } from './analytics/index.js'
import { getAPIMetadata } from './api/claude.js'
import { getAnthropicClient } from './api/client.js'
import { anthropicAdapter } from './providerUsage/adapters/anthropic.js'
import { updateProviderBuckets } from './providerUsage/store.js'
import {
  processRateLimitHeaders,
  shouldProcessRateLimits,
} from './rateLimitMocking.js'

// Re-export message functions from centralized location
export {
  getRateLimitErrorMessage,
  getRateLimitWarning,
  getUsingOverageText,
} from './rateLimitMessages.js'

type QuotaStatus = 'allowed' | 'allowed_warning' | 'rejected'

type RateLimitType =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_opus'
  | 'seven_day_sonnet'
  | 'seven_day_overage_included'
  | 'overage'

export type { RateLimitType }

type EarlyWarningThreshold = {
  utilization: number // 0-1 scale: trigger warning when usage >= this
  timePct: number // 0-1 scale: trigger warning when time elapsed <= this
}

type EarlyWarningConfig = {
  rateLimitType: RateLimitType
  claimAbbrev: '5h' | '7d'
  windowSeconds: number
  thresholds: EarlyWarningThreshold[]
}

// Early warning configurations in priority order (checked first to last)
// Used as fallback when server doesn't send surpassed-threshold header
// Warns users when they're consuming quota faster than the time window allows
const EARLY_WARNING_CONFIGS: EarlyWarningConfig[] = [
  {
    rateLimitType: 'five_hour',
    claimAbbrev: '5h',
    windowSeconds: 5 * 60 * 60,
    thresholds: [{ utilization: 0.9, timePct: 0.72 }],
  },
  {
    rateLimitType: 'seven_day',
    claimAbbrev: '7d',
    windowSeconds: 7 * 24 * 60 * 60,
    thresholds: [
      { utilization: 0.75, timePct: 0.6 },
      { utilization: 0.5, timePct: 0.35 },
      { utilization: 0.25, timePct: 0.15 },
    ],
  },
]

// Maps claim abbreviations to rate limit types for header-based detection
const EARLY_WARNING_CLAIM_MAP: Record<string, RateLimitType> = {
  '5h': 'five_hour',
  '7d': 'seven_day',
  overage: 'overage',
}

/**
 * Calculate what fraction of a time window has elapsed.
 * Used for time-relative early warning fallback.
 * @param resetsAt - Unix epoch timestamp in seconds when the limit resets
 * @param windowSeconds - Duration of the window in seconds
 * @returns fraction (0-1) of the window that has elapsed
 */
function computeTimeProgress(resetsAt: number, windowSeconds: number): number {
  const nowSeconds = Date.now() / 1000
  const windowStart = resetsAt - windowSeconds
  const elapsed = nowSeconds - windowStart
  return Math.max(0, Math.min(1, elapsed / windowSeconds))
}

// Reason why overage is disabled/rejected
// These values come from the API's unified limiter
export type OverageDisabledReason =
  | 'overage_not_provisioned' // Overage is not provisioned for this org or seat tier
  | 'org_level_disabled' // Organization doesn't have overage enabled
  | 'org_level_disabled_until' // Organization overage temporarily disabled
  | 'org_spend_cap_reached' // densable 2.1.221: individual spend cap (not org monthly)
  | 'out_of_credits' // Organization has insufficient credits
  | 'seat_tier_level_disabled' // Seat tier doesn't have overage enabled
  | 'member_level_disabled' // Account specifically has overage disabled
  | 'seat_tier_zero_credit_limit' // Seat tier has a zero credit limit
  | 'group_zero_credit_limit' // Resolved group limit has a zero credit limit
  | 'member_zero_credit_limit' // Account has a zero credit limit
  | 'org_service_level_disabled' // Org service specifically has overage disabled
  | 'org_service_zero_credit_limit' // Org service has a zero credit limit
  | 'no_limits_configured' // No overage limits configured for account
  | 'unknown' // Unknown reason, should not happen

export type OverageScope = 'service' | 'channel' | 'group_pool' | 'organization'

export type OveragePeriod = 'daily' | 'weekly' | 'monthly'

export type LowPriorityStatus =
  | 'active'
  | 'not_needed'
  | 'slot_busy'
  | 'weekly_limit'
  | 'budget_exhausted'
  | 'ineligible'
  | 'off'
  | 'unrecognized'

export type LowPriorityOffer = 'treatment' | 'control'

export type RateLimitGraceZone = {
  rateLimitType: 'five_hour' | 'seven_day'
  resetsAt?: number
  extraUsageStatus?: 'allowed' | 'allowed_warning'
  paidBy: 'credits' | 'allowance'
}

export type RateLimitGraceParseResult =
  | { limiterRan: false }
  | {
      limiterRan: true
      zone: RateLimitGraceZone | null
      covered?: boolean
    }

export type ClaudeAILimits = {
  status: QuotaStatus
  // unifiedRateLimitFallbackAvailable is currently used to warn users that set
  // their model to Opus whenever they are about to run out of quota. It does
  // not change the actual model that is used.
  unifiedRateLimitFallbackAvailable: boolean
  resetsAt?: number
  rateLimitType?: RateLimitType
  utilization?: number
  overageStatus?: QuotaStatus
  overageResetsAt?: number
  overageDisabledReason?: OverageDisabledReason
  isUsingOverage?: boolean
  /** Official 2.1.328 `anthropic-ratelimit-unified-overage-in-use`. */
  overageInUse?: boolean
  /** Official 2.1.328 `anthropic-ratelimit-unified-overage-scope`. */
  overageScope?: OverageScope
  /** Official 2.1.328 `anthropic-ratelimit-unified-overage-period`. */
  overagePeriod?: OveragePeriod
  /** Official 2.1.328 `Bt(e)` member spend limit period (when `org_spend_cap_reached` with no overage-scope). */
  memberSpendLimit?: { period?: OveragePeriod }
  /** Official 2.1.328 `anthropic-ratelimit-unified-overage-daily-cap-paused`. */
  dailyCapPaused?: boolean
  /** Official 2.1.328 `anthropic-ratelimit-unified-overage-period-monthly-utilization`. */
  overagePeriodMonthly?: { utilization: number }
  /** Official 2.1.328 `anthropic-ratelimit-unified-overage-period-channel-utilization`. */
  overagePeriodChannel?: { utilization: number }
  /** Official 2.1.328 `anthropic-ratelimit-unified-upgrade-paths`. */
  upgradePaths?: string[]
  /** Official 2.1.328 `anthropic-ratelimit-unified-grace-*` wrap-up fields. */
  rateLimitGraceActive?: boolean
  rateLimitGracePaidBy?: 'credits' | 'allowance'
  graceStatus?: string
  graceFiveHourUtilization?: number
  graceSevenDayUtilization?: number
  /** Official 2.1.328 `anthropic-ratelimit-unified-slow-*` low-priority lane fields. */
  lowPriorityStatus?: LowPriorityStatus
  lowPriorityOffer?: LowPriorityOffer
  lowPriorityRetryAfterSeconds?: number
  lowPriorityMaxWaitSeconds?: number
  lowPriorityBudgetUtilization?: number
  lowPriorityBudgetResetsAt?: number
  /** Official 2.1.328 `anthropic-ratelimit-unified-5h-status` / `-7d-status`. */
  fiveHourStatus?: QuotaStatus
  sevenDayStatus?: QuotaStatus
  surpassedThreshold?: number
}

type StatusChangeListener = (limits: ClaudeAILimits) => void

/**
 * densable aZ.quotaRejected / yYp — 429 error path only (not headers).
 * Second arg is densable hAm bucket: `main_thread` | `other`.
 */
export type QuotaRejectedQuerySourceBucket = 'main_thread' | 'other'
type QuotaRejectedListener = (
  limits: ClaudeAILimits,
  querySourceBucket: QuotaRejectedQuerySourceBucket,
) => void

/**
 * Raw per-window utilization from response headers, tracked on every API
 * response (unlike currentLimits.utilization which is only set when a warning
 * threshold fires). Exposed to statusline scripts via getRawUtilization().
 */
type RawWindowUtilization = {
  utilization: number // 0-1 fraction
  resets_at: number // unix epoch seconds
  /** Official 2.1.328 `si(e)`: `anthropic-ratelimit-unified-{5h,7d,7d_oi}-status`. */
  status?: QuotaStatus
}
export type WindowReading = {
  utilization?: number
  resets_at?: number
  surpassedThreshold?: number
  status?: QuotaStatus
}
export type WindowReadings = {
  five_hour?: WindowReading
  seven_day?: WindowReading
  seven_day_overage_included?: WindowReading
  overage?: WindowReading
}
export type RawUtilization = {
  five_hour?: RawWindowUtilization
  seven_day?: RawWindowUtilization
  /** Official 2.1.323 (#2106): Fable weekly limit (`7d_oi`) window utilization + reset. */
  seven_day_overage_included?: RawWindowUtilization
  /** densable 2.1.251 jL().overage — 0–1 utilization, unix-seconds reset. */
  overage?: RawWindowUtilization
}

type ClaudeAiLimitsHostState = {
  currentLimits: ClaudeAILimits
  /**
   * densable 2.1.251 `pm.limitsObserved` / `HPe`.
   * Set true on a non-stale observation apply and on `emitStatusChange`.
   * Cleared by `resetCurrentLimits` (account epoch bump).
   */
  limitsObserved: boolean
  lastAppliedObservationAtMs: number
  /** densable `pm.accountEpoch` — bumped on `resetCurrentLimits`. */
  accountEpoch: number
  rawUtilization: RawUtilization
  statusListeners: Set<StatusChangeListener>
  quotaRejectedListeners: Set<QuotaRejectedListener>
}

// Official 2.1.331 [W-169]: per-host Claude.ai rate-limit state on SessionHost.
const claudeAiLimitsHostSlot = new HostSlot<ClaudeAiLimitsHostState>(() => ({
  currentLimits: {
    status: 'allowed',
    unifiedRateLimitFallbackAvailable: false,
    isUsingOverage: false,
  },
  limitsObserved: false,
  lastAppliedObservationAtMs: 0,
  accountEpoch: 0,
  rawUtilization: {},
  statusListeners: new Set(),
  quotaRejectedListeners: new Set(),
}))

function getClaudeAiLimitsHostState(): ClaudeAiLimitsHostState {
  return claudeAiLimitsHostSlot.of(getBootstrapSessionHost())
}

function createHostSetProxy<T>(getSet: () => Set<T>): Set<T> {
  const dummy = new Set<T>()
  return new Proxy(dummy, {
    get(_target, prop) {
      const set = getSet()
      const value = Reflect.get(set, prop, set)
      return typeof value === 'function' ? value.bind(set) : value
    },
    has(_target, prop) {
      return Reflect.has(getSet(), prop)
    },
    ownKeys() {
      return Reflect.ownKeys(getSet())
    },
    getOwnPropertyDescriptor(_target, prop) {
      const desc = Reflect.getOwnPropertyDescriptor(getSet(), prop)
      return desc ? { ...desc, configurable: true } : undefined
    },
  })
}

// Live per-host proxy so callers reading `currentLimits.*` stay isolated across SessionHosts
export const currentLimits: ClaudeAILimits = new Proxy({} as ClaudeAILimits, {
  get(_target, prop) {
    const current = getClaudeAiLimitsHostState().currentLimits
    const value = Reflect.get(current, prop, current)
    return typeof value === 'function' ? value.bind(current) : value
  },
  set(_target, prop, value) {
    return Reflect.set(getClaudeAiLimitsHostState().currentLimits, prop, value)
  },
  deleteProperty(_target, prop) {
    return Reflect.deleteProperty(
      getClaudeAiLimitsHostState().currentLimits,
      prop,
    )
  },
  has(_target, prop) {
    return Reflect.has(getClaudeAiLimitsHostState().currentLimits, prop)
  },
  ownKeys() {
    return Reflect.ownKeys(getClaudeAiLimitsHostState().currentLimits)
  },
  getOwnPropertyDescriptor(_target, prop) {
    const desc = Reflect.getOwnPropertyDescriptor(
      getClaudeAiLimitsHostState().currentLimits,
      prop,
    )
    return desc ? { ...desc, configurable: true } : undefined
  },
})

/**
 * densable `HPe` — `return pm.limitsObserved`.
 */
export function areLimitsObserved(): boolean {
  return getClaudeAiLimitsHostState().limitsObserved
}

/**
 * densable `pm.isStaleObservation(e)`.
 * Stale if `e < lastAppliedObservationAtMs`. Else latch observed + timestamp.
 */
export function isStaleObservation(observationAtMs: number): boolean {
  const state = getClaudeAiLimitsHostState()
  if (observationAtMs < state.lastAppliedObservationAtMs) return true
  state.lastAppliedObservationAtMs = observationAtMs
  state.limitsObserved = true
  return false
}

/**
 * densable `pm.resetCurrentLimits`.
 * Clears windows, bumps account epoch, rewinds the observation latch.
 */
export function resetCurrentLimits(): void {
  const state = getClaudeAiLimitsHostState()
  state.currentLimits = {
    status: 'allowed',
    unifiedRateLimitFallbackAvailable: false,
    isUsingOverage: false,
  }
  state.rawUtilization = {}
  state.accountEpoch++
  state.lastAppliedObservationAtMs = Date.now()
  state.limitsObserved = false
}

export function getLimitsAccountEpoch(): number {
  return getClaudeAiLimitsHostState().accountEpoch
}

const RAW_UTILIZATION_KEYS = [
  'five_hour',
  'seven_day',
  'seven_day_overage_included',
  'overage',
] as const

const VALID_WINDOW_STATUSES: readonly QuotaStatus[] = [
  'allowed',
  'allowed_warning',
  'rejected',
]

function parseFiniteNumberHeader(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined
  const num = Number(raw)
  return Number.isFinite(num) ? num : undefined
}

function parseWindowQuotaStatus(raw: string | null): QuotaStatus | undefined {
  return VALID_WINDOW_STATUSES.find(status => status === raw)
}

/**
 * densable 2.1.243 `Y0a` — drop windows whose `resets_at` has passed.
 * Statusline `rate_limits` are "present only while … resets_at has not passed".
 */
export function selectOpenRawUtilization(
  raw: RawUtilization,
  nowSeconds = Date.now() / 1000,
): RawUtilization {
  const next: RawUtilization = {}
  for (const key of RAW_UTILIZATION_KEYS) {
    const window = raw[key]
    if (window !== undefined && window.resets_at > nowSeconds) {
      next[key] = window
    }
  }
  return next
}

export function getRawUtilization(): RawUtilization {
  return selectOpenRawUtilization(getClaudeAiLimitsHostState().rawUtilization)
}

/**
 * Official 2.1.328 `si(e)` (`chunk@293569796.js@42950`): parse per-window
 * utilization, reset, surpassed-threshold, and status headers (`5h`, `7d`,
 * `7d_oi`, `overage`). Drops `overage` when `overage-scope === 'group_pool'`.
 */
export function extractWindowReadings(
  headers: globalThis.Headers,
): WindowReadings {
  const readings: WindowReadings = {}
  for (const [key, abbrev] of [
    ['five_hour', '5h'],
    ['seven_day', '7d'],
    ['seven_day_overage_included', '7d_oi'],
    ['overage', 'overage'],
  ] as const) {
    const utilization = parseFiniteNumberHeader(
      headers.get(`anthropic-ratelimit-unified-${abbrev}-utilization`),
    )
    const reset = parseFiniteNumberHeader(
      headers.get(`anthropic-ratelimit-unified-${abbrev}-reset`),
    )
    const surpassedThreshold = parseFiniteNumberHeader(
      headers.get(`anthropic-ratelimit-unified-${abbrev}-surpassed-threshold`),
    )
    const status =
      key === 'overage'
        ? undefined
        : parseWindowQuotaStatus(
            headers.get(`anthropic-ratelimit-unified-${abbrev}-status`),
          )
    if (
      utilization === undefined &&
      reset === undefined &&
      surpassedThreshold === undefined &&
      status === undefined
    ) {
      continue
    }
    readings[key] = {
      ...(utilization !== undefined && { utilization }),
      ...(reset !== undefined && { resets_at: Math.round(reset) }),
      ...(surpassedThreshold !== undefined && { surpassedThreshold }),
      ...(status !== undefined && { status }),
    }
  }
  if (
    headers.get('anthropic-ratelimit-unified-overage-scope') === 'group_pool'
  ) {
    delete readings.overage
  }
  return readings
}

export function extractRawUtilization(
  headers: globalThis.Headers,
): RawUtilization {
  const result: RawUtilization = {}
  const isGroupPool =
    headers.get('anthropic-ratelimit-unified-overage-scope') === 'group_pool'
  for (const [key, abbrev] of [
    ['five_hour', '5h'],
    ['seven_day', '7d'],
    ['seven_day_overage_included', '7d_oi'],
    // Same header family as mockRateLimits overage-utilization / overage-reset.
    ['overage', 'overage'],
  ] as const) {
    if (key === 'overage' && isGroupPool) continue
    const util = headers.get(
      `anthropic-ratelimit-unified-${abbrev}-utilization`,
    )
    const reset = headers.get(`anthropic-ratelimit-unified-${abbrev}-reset`)
    if (util !== null && reset !== null) {
      const status =
        key === 'overage'
          ? undefined
          : parseWindowQuotaStatus(
              headers.get(`anthropic-ratelimit-unified-${abbrev}-status`),
            )
      result[key] = {
        utilization: Number(util),
        resets_at: Number(reset),
        ...(status !== undefined ? { status } : {}),
      }
    }
  }
  return result
}

export const statusListeners: Set<StatusChangeListener> = createHostSetProxy(
  () => getClaudeAiLimitsHostState().statusListeners,
)

export const quotaRejectedListeners: Set<QuotaRejectedListener> =
  createHostSetProxy(() => getClaudeAiLimitsHostState().quotaRejectedListeners)

export function emitStatusChange(limits: ClaudeAILimits) {
  const state = getClaudeAiLimitsHostState()
  state.currentLimits = limits
  // densable emitStatusChange: `this.limitsObserved=!0` before listeners.
  state.limitsObserved = true
  state.statusListeners.forEach(listener => listener(limits))
  const hoursTillReset = Math.round(
    (limits.resetsAt ? limits.resetsAt - Date.now() / 1000 : 0) / (60 * 60),
  )

  logEvent('tengu_claudeai_limits_status_changed', {
    status:
      limits.status as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    unifiedRateLimitFallbackAvailable: limits.unifiedRateLimitFallbackAvailable,
    hoursTillReset,
  })
}

/** densable quotaRejected.emit — keep separate from statusChanged. */
export function emitQuotaRejected(
  limits: ClaudeAILimits,
  querySourceBucket: QuotaRejectedQuerySourceBucket,
): void {
  for (const listener of getClaudeAiLimitsHostState().quotaRejectedListeners) {
    try {
      listener(limits, querySourceBucket)
    } catch (e) {
      logError(e as Error)
    }
  }
}

async function makeTestQuery() {
  const model = getSmallFastModel()
  const anthropic = await getAnthropicClient({
    maxRetries: 0,
    model,
    source: 'quota_check',
  })
  const messages: MessageParam[] = [{ role: 'user', content: 'quota' }]
  const betas = getModelBetas(model)
  return anthropic.beta.messages
    .create({
      model,
      max_tokens: 1,
      messages,
      metadata: getAPIMetadata(),
      ...(betas.length > 0 ? { betas } : {}),
    })
    .asResponse()
}

export async function checkQuotaStatus(): Promise<void> {
  // Skip network requests if nonessential traffic is disabled, except when
  // signed in to a Claude apps gateway (gateway spend limit goes to the
  // gateway the session is signed in to).
  if (isEssentialTrafficOnly() && getAPIProvider() !== 'gateway') {
    return
  }

  // Check if we should process rate limits (real subscriber or mock testing)
  if (!shouldProcessRateLimits(isClaudeAISubscriber())) {
    return
  }

  // In non-interactive mode (-p), the real query follows immediately and
  // extractQuotaStatusFromHeaders() will update limits from its response
  // headers (claude.ts), so skip this pre-check API call.
  if (getIsNonInteractiveSession()) {
    return
  }

  try {
    // Make a minimal request to check quota
    const raw = await makeTestQuery()

    // Update limits based on the response
    extractQuotaStatusFromHeaders(raw.headers)
  } catch (error) {
    if (error instanceof APIError) {
      extractQuotaStatusFromError(error)
    }
  }
}

/**
 * Check if early warning should be triggered based on surpassed-threshold header.
 * Returns ClaudeAILimits if a threshold was surpassed, null otherwise.
 */
function getHeaderBasedEarlyWarning(
  headers: globalThis.Headers,
  unifiedRateLimitFallbackAvailable: boolean,
): ClaudeAILimits | null {
  // Check each claim type for surpassed threshold header
  for (const [claimAbbrev, rateLimitType] of Object.entries(
    EARLY_WARNING_CLAIM_MAP,
  )) {
    const surpassedThreshold = headers.get(
      `anthropic-ratelimit-unified-${claimAbbrev}-surpassed-threshold`,
    )

    // If threshold header is present, user has crossed a warning threshold
    if (surpassedThreshold !== null) {
      const utilizationHeader = headers.get(
        `anthropic-ratelimit-unified-${claimAbbrev}-utilization`,
      )
      const resetHeader = headers.get(
        `anthropic-ratelimit-unified-${claimAbbrev}-reset`,
      )

      const utilization = utilizationHeader
        ? Number(utilizationHeader)
        : undefined
      const resetsAt = resetHeader ? Number(resetHeader) : undefined

      return {
        status: 'allowed_warning',
        resetsAt,
        rateLimitType: rateLimitType as RateLimitType,
        utilization,
        unifiedRateLimitFallbackAvailable,
        isUsingOverage: false,
        surpassedThreshold: Number(surpassedThreshold),
      }
    }
  }

  return null
}

/**
 * Check if time-relative early warning should be triggered for a rate limit type.
 * Fallback when server doesn't send surpassed-threshold header.
 * Returns ClaudeAILimits if thresholds are exceeded, null otherwise.
 */
function getTimeRelativeEarlyWarning(
  headers: globalThis.Headers,
  config: EarlyWarningConfig,
  unifiedRateLimitFallbackAvailable: boolean,
): ClaudeAILimits | null {
  const { rateLimitType, claimAbbrev, windowSeconds, thresholds } = config

  const utilizationHeader = headers.get(
    `anthropic-ratelimit-unified-${claimAbbrev}-utilization`,
  )
  const resetHeader = headers.get(
    `anthropic-ratelimit-unified-${claimAbbrev}-reset`,
  )

  if (utilizationHeader === null || resetHeader === null) {
    return null
  }

  const utilization = Number(utilizationHeader)
  const resetsAt = Number(resetHeader)
  const timeProgress = computeTimeProgress(resetsAt, windowSeconds)

  // Check if any threshold is exceeded: high usage early in the window
  const shouldWarn = thresholds.some(
    t => utilization >= t.utilization && timeProgress <= t.timePct,
  )

  if (!shouldWarn) {
    return null
  }

  return {
    status: 'allowed_warning',
    resetsAt,
    rateLimitType,
    utilization,
    unifiedRateLimitFallbackAvailable,
    isUsingOverage: false,
  }
}

/**
 * Get early warning limits using header-based detection with time-relative fallback.
 * 1. First checks for surpassed-threshold header (new server-side approach)
 * 2. Falls back to time-relative thresholds (client-side calculation)
 */
function getEarlyWarningFromHeaders(
  headers: globalThis.Headers,
  unifiedRateLimitFallbackAvailable: boolean,
): ClaudeAILimits | null {
  // Try header-based detection first (preferred when API sends the header)
  const headerBasedWarning = getHeaderBasedEarlyWarning(
    headers,
    unifiedRateLimitFallbackAvailable,
  )
  if (headerBasedWarning) {
    return headerBasedWarning
  }

  // Fallback: Use time-relative thresholds (client-side calculation)
  // This catches users burning quota faster than sustainable
  for (const config of EARLY_WARNING_CONFIGS) {
    const timeRelativeWarning = getTimeRelativeEarlyWarning(
      headers,
      config,
      unifiedRateLimitFallbackAvailable,
    )
    if (timeRelativeWarning) {
      return timeRelativeWarning
    }
  }

  return null
}

function parseClampedUnitHeader(
  headers: globalThis.Headers,
  name: string,
): number | undefined {
  const raw = headers.get(name)
  if (raw === null || raw.trim() === '') return undefined
  const num = Number(raw)
  return Number.isFinite(num) ? Math.max(0, Math.min(1, num)) : undefined
}

function parseNonNegativeHeader(
  headers: globalThis.Headers,
  name: string,
): number | undefined {
  const raw = headers.get(name)
  if (raw === null || raw.trim() === '') return undefined
  const num = Number(raw)
  return Number.isFinite(num) && num >= 0 ? num : undefined
}

function parseFutureEpochSecondsHeader(
  headers: globalThis.Headers,
  name: string,
  nowMs: number,
): number | undefined {
  const raw = headers.get(name)
  if (raw === null || raw.trim() === '') return undefined
  const num = Number(raw)
  return Number.isFinite(num) && num * 1000 > nowMs
    ? Math.round(num)
    : undefined
}

/**
 * Official 2.1.328 `An(e, r)` (`chunk@293569796.js@18854`): parse grace wrap-up
 * headers (`anthropic-ratelimit-unified-grace-status`, `-grace-5h-utilization`,
 * `-grace-7d-utilization`).
 */
export function parseRateLimitGraceHeaders(
  headers: globalThis.Headers,
  nowMs: number = Date.now(),
): RateLimitGraceParseResult {
  if (headers.get('anthropic-ratelimit-unified-status') === null) {
    return { limiterRan: false }
  }
  const grace5h =
    parseClampedUnitHeader(
      headers,
      'anthropic-ratelimit-unified-grace-5h-utilization',
    ) ?? 0
  const grace7d =
    parseClampedUnitHeader(
      headers,
      'anthropic-ratelimit-unified-grace-7d-utilization',
    ) ?? 0
  if (
    headers.get('anthropic-ratelimit-unified-grace-status') === 'eligible' ||
    (grace5h === 0 && grace7d === 0)
  ) {
    return { limiterRan: true, zone: null }
  }
  const reset5h = parseFutureEpochSecondsHeader(
    headers,
    'anthropic-ratelimit-unified-5h-reset',
    nowMs,
  )
  const reset7d = parseFutureEpochSecondsHeader(
    headers,
    'anthropic-ratelimit-unified-7d-reset',
    nowMs,
  )
  const prefer5h =
    grace5h > 0 &&
    reset5h !== undefined &&
    (reset7d === undefined || reset5h > reset7d)
  const rateLimitType: 'five_hour' | 'seven_day' =
    grace7d > 0 && !prefer5h ? 'seven_day' : 'five_hour'
  const overageStatusRaw = headers.get(
    'anthropic-ratelimit-unified-overage-status',
  )
  const extraUsageStatus =
    overageStatusRaw === 'allowed' || overageStatusRaw === 'allowed_warning'
      ? overageStatusRaw
      : undefined
  return {
    limiterRan: true,
    zone: {
      rateLimitType,
      resetsAt: rateLimitType === 'seven_day' ? reset7d : reset5h,
      extraUsageStatus,
      paidBy:
        headers.get('anthropic-ratelimit-unified-status') === 'rejected' &&
        extraUsageStatus !== undefined
          ? 'credits'
          : 'allowance',
    },
    covered:
      extraUsageStatus !== undefined ||
      headers.get('anthropic-ratelimit-unified-overage-in-use') === 'true',
  }
}

/** Official 2.1.328 `Md(e)` (`chunk@289476641.js@230101`): slow-lane status. */
function parseSlowStatusHeader(
  headers: globalThis.Headers,
): LowPriorityStatus | undefined {
  const raw = headers.get('anthropic-ratelimit-unified-slow-status')
  if (raw === null) return undefined
  switch (raw) {
    case 'active':
    case 'not_needed':
    case 'slot_busy':
    case 'weekly_limit':
    case 'budget_exhausted':
    case 'ineligible':
    case 'off':
      return raw
    default:
      return 'unrecognized'
  }
}

/** Official 2.1.328 `jt(e)` (`chunk@293569796.js@66864`): overage scope. */
function parseOverageScopeHeader(
  headers: globalThis.Headers,
): OverageScope | undefined {
  const raw = headers.get('anthropic-ratelimit-unified-overage-scope')
  if (
    raw === 'service' ||
    raw === 'channel' ||
    raw === 'group_pool' ||
    raw === 'organization'
  ) {
    return raw
  }
  return undefined
}

function parseOveragePeriodHeader(
  headers: globalThis.Headers,
): OveragePeriod | undefined {
  const raw = headers.get('anthropic-ratelimit-unified-overage-period')
  if (raw === 'daily' || raw === 'weekly' || raw === 'monthly') {
    return raw
  }
  return undefined
}

/** Official 2.1.328 `Bt(e)` (`chunk@293569796.js@66985`): member spend limit. */
function parseMemberSpendLimitHeader(
  headers: globalThis.Headers,
): { period?: OveragePeriod } | undefined {
  if (
    headers.get('anthropic-ratelimit-unified-overage-disabled-reason') !==
      'org_spend_cap_reached' ||
    headers.get('anthropic-ratelimit-unified-overage-scope') !== null
  ) {
    return undefined
  }
  const raw = headers.get('anthropic-ratelimit-unified-overage-period')
  if (raw === null) return {}
  if (raw === 'daily' || raw === 'weekly' || raw === 'monthly') {
    return { period: raw }
  }
  return undefined
}

/**
 * Official 2.1.328 `De(e, r)` + `An(e, r)` + `Md`/`t2a`/`I7o`/`M7o`/`Kp`/`Yp`
 * (`chunk@293569796.js@18854, 42000, 47104, 66864`, `chunk@289476641.js@230101`).
 * Parses all 33 unified rate-limit response headers.
 */
export function computeLimitsFromHeaders(
  headers: globalThis.Headers,
  nowMs: number = Date.now(),
): ClaudeAILimits {
  return computeNewLimitsFromHeaders(headers, nowMs)
}

function computeNewLimitsFromHeaders(
  headers: globalThis.Headers,
  nowMs: number = Date.now(),
): ClaudeAILimits {
  const status =
    (headers.get('anthropic-ratelimit-unified-status') as QuotaStatus) ||
    'allowed'
  const resetsAtHeader = headers.get('anthropic-ratelimit-unified-reset')
  const resetsAt = resetsAtHeader
    ? Math.round(Number(resetsAtHeader))
    : undefined
  const unifiedRateLimitFallbackAvailable =
    headers.get('anthropic-ratelimit-unified-fallback') === 'available'

  // Headers for rate limit type and overage support
  const rateLimitType = headers.get(
    'anthropic-ratelimit-unified-representative-claim',
  ) as RateLimitType | null
  const overageStatus = headers.get(
    'anthropic-ratelimit-unified-overage-status',
  ) as QuotaStatus | null
  const overageResetsAtHeader = headers.get(
    'anthropic-ratelimit-unified-overage-reset',
  )
  const overageResetsAt = overageResetsAtHeader
    ? Math.round(Number(overageResetsAtHeader))
    : undefined

  // Reason why overage is disabled (spending cap or wallet empty)
  const overageDisabledReason = headers.get(
    'anthropic-ratelimit-unified-overage-disabled-reason',
  ) as OverageDisabledReason | null

  // Official 2.1.328 overage scope, period, daily-cap, in-use, period utilizations, upgrade paths
  const overageScope = parseOverageScopeHeader(headers)
  const overagePeriod = parseOveragePeriodHeader(headers)
  const memberSpendLimit = parseMemberSpendLimitHeader(headers)
  const dailyCapPaused =
    headers.get('anthropic-ratelimit-unified-overage-daily-cap-paused') ===
    'true'
  const overageInUse =
    headers.get('anthropic-ratelimit-unified-overage-in-use') === 'true'
  const upgradePathsRaw = headers.get(
    'anthropic-ratelimit-unified-upgrade-paths',
  )
  const upgradePaths = upgradePathsRaw
    ? upgradePathsRaw
        .split(',')
        .map(path => path.trim())
        .filter(Boolean)
    : undefined
  const monthlyUtil = parseFiniteNumberHeader(
    headers.get(
      'anthropic-ratelimit-unified-overage-period-monthly-utilization',
    ),
  )
  const overagePeriodMonthly =
    monthlyUtil !== undefined ? { utilization: monthlyUtil } : undefined
  const channelUtil = parseFiniteNumberHeader(
    headers.get(
      'anthropic-ratelimit-unified-overage-period-channel-utilization',
    ),
  )
  const overagePeriodChannel =
    channelUtil !== undefined ? { utilization: channelUtil } : undefined

  // Official 2.1.328 grace wrap-up headers
  const graceStatusRaw = headers.get('anthropic-ratelimit-unified-grace-status')
  const graceFiveHourUtilization = parseClampedUnitHeader(
    headers,
    'anthropic-ratelimit-unified-grace-5h-utilization',
  )
  const graceSevenDayUtilization = parseClampedUnitHeader(
    headers,
    'anthropic-ratelimit-unified-grace-7d-utilization',
  )
  const graceParsed = parseRateLimitGraceHeaders(headers, nowMs)
  const graceZone = graceParsed.limiterRan ? graceParsed.zone : null

  // Official 2.1.328 slow-lane (low-priority) headers
  const lowPriorityStatus = parseSlowStatusHeader(headers)
  const slowOfferRaw = headers.get('anthropic-ratelimit-unified-slow-offer')
  const lowPriorityOffer: LowPriorityOffer | undefined =
    slowOfferRaw === 'treatment' || slowOfferRaw === 'control'
      ? slowOfferRaw
      : undefined
  const lowPriorityRetryAfterSeconds = parseNonNegativeHeader(
    headers,
    'anthropic-ratelimit-unified-slow-retry-after',
  )
  const lowPriorityMaxWaitSeconds = parseNonNegativeHeader(
    headers,
    'anthropic-ratelimit-unified-slow-max-wait',
  )
  const lowPriorityBudgetUtilization = parseClampedUnitHeader(
    headers,
    'anthropic-ratelimit-unified-slow-budget-utilization',
  )
  const slowBudgetResetNum = parseFiniteNumberHeader(
    headers.get('anthropic-ratelimit-unified-slow-budget-reset'),
  )
  const lowPriorityBudgetResetsAt =
    slowBudgetResetNum !== undefined
      ? Math.round(slowBudgetResetNum)
      : undefined

  // Official 2.1.328 per-window status headers
  const fiveHourStatus = parseWindowQuotaStatus(
    headers.get('anthropic-ratelimit-unified-5h-status'),
  )
  const sevenDayStatus = parseWindowQuotaStatus(
    headers.get('anthropic-ratelimit-unified-7d-status'),
  )

  // Determine if we're using overage (standard limits rejected but overage allowed)
  const isUsingOverage =
    status === 'rejected' &&
    (overageStatus === 'allowed' || overageStatus === 'allowed_warning')

  const extendedFields: Partial<ClaudeAILimits> = {
    ...(overageScope && { overageScope }),
    ...(overagePeriod && { overagePeriod }),
    ...(memberSpendLimit && { memberSpendLimit }),
    ...(dailyCapPaused && { dailyCapPaused: true }),
    ...(overageInUse && { overageInUse: true }),
    ...(upgradePaths && upgradePaths.length > 0 && { upgradePaths }),
    ...(overagePeriodMonthly && { overagePeriodMonthly }),
    ...(overagePeriodChannel && { overagePeriodChannel }),
    ...(graceStatusRaw !== null && { graceStatus: graceStatusRaw }),
    ...(graceFiveHourUtilization !== undefined && { graceFiveHourUtilization }),
    ...(graceSevenDayUtilization !== undefined && { graceSevenDayUtilization }),
    ...(graceZone !== null && {
      rateLimitGraceActive: true,
      ...(isUsingOverage && { rateLimitGracePaidBy: graceZone.paidBy }),
    }),
    ...(lowPriorityStatus !== undefined && { lowPriorityStatus }),
    ...(lowPriorityOffer !== undefined && { lowPriorityOffer }),
    ...(lowPriorityRetryAfterSeconds !== undefined && {
      lowPriorityRetryAfterSeconds,
    }),
    ...(lowPriorityMaxWaitSeconds !== undefined && {
      lowPriorityMaxWaitSeconds,
    }),
    ...(lowPriorityBudgetUtilization !== undefined && {
      lowPriorityBudgetUtilization,
    }),
    ...(lowPriorityBudgetResetsAt !== undefined && {
      lowPriorityBudgetResetsAt,
    }),
    ...(fiveHourStatus !== undefined && { fiveHourStatus }),
    ...(sevenDayStatus !== undefined && { sevenDayStatus }),
  }

  // Check for early warning based on surpassed-threshold header
  // If status is allowed/allowed_warning and we find a surpassed threshold, show warning
  let finalStatus: QuotaStatus = status
  if (status === 'allowed' || status === 'allowed_warning') {
    const earlyWarning = getEarlyWarningFromHeaders(
      headers,
      unifiedRateLimitFallbackAvailable,
    )
    if (earlyWarning) {
      // Official `We(e, r, o)` (`chunk@293569796.js@47900`): carry forward
      // upgradePaths, overage metadata (unless in grace), period utilizations,
      // grace/slow/window status metadata onto early-warning result.
      return {
        ...earlyWarning,
        ...(!extendedFields.rateLimitGraceActive && {
          ...(overageStatus && { overageStatus }),
          ...(overageResetsAt !== undefined && { overageResetsAt }),
          ...(overageDisabledReason && { overageDisabledReason }),
        }),
        ...extendedFields,
      }
    }
    // No early warning threshold surpassed
    finalStatus = 'allowed'
  }

  return {
    status: finalStatus,
    resetsAt,
    unifiedRateLimitFallbackAvailable,
    ...(rateLimitType && { rateLimitType }),
    ...(overageStatus && { overageStatus }),
    ...(overageResetsAt !== undefined && { overageResetsAt }),
    ...(overageDisabledReason && { overageDisabledReason }),
    isUsingOverage,
    ...extendedFields,
  }
}

/**
 * Cache the extra usage disabled reason from API headers.
 * densable b7u: skip caching on gateway — gateway spend headers are not
 * Claude.ai extra-usage state and must not pollute /usage-credits UI cache.
 */
function cacheExtraUsageDisabledReason(headers: globalThis.Headers): void {
  if (getAPIProvider() === 'gateway') {
    return
  }
  // A null reason means extra usage is enabled (no disabled reason header)
  const reason =
    headers.get('anthropic-ratelimit-unified-overage-disabled-reason') ?? null
  const cached = getGlobalConfig().cachedExtraUsageDisabledReason
  if (cached !== reason) {
    saveGlobalConfig(current => ({
      ...current,
      cachedExtraUsageDisabledReason: reason,
    }))
  }
}

/**
 * Official 2.1.323 (#2105): Side requests on smaller models (such as session
 * title generation, prompt suggestions, session memory, etc.) must not flip
 * `isUsingOverage` back to false while the main model (e.g. Fable) is past its
 * weekly limit and using usage credits, which caused the "Now using usage
 * credits" notice to repeat or fail to show.
 */
const SIDE_REQUEST_RATE_LIMIT_QUERY_SOURCES = new Set([
  'title_generation',
  'prompt_suggestion',
  'session_memory',
  'extract_memories',
  'away_summary',
  'compact_fab_check',
  'magic_docs',
  'file_suggestion',
  'slug_generation',
  'speculation',
])

export function isSideRequestQuerySourceForRateLimits(
  querySource?: string,
): boolean {
  if (!querySource) return false
  return SIDE_REQUEST_RATE_LIMIT_QUERY_SOURCES.has(querySource)
}

export function extractQuotaStatusFromHeaders(
  headers: globalThis.Headers,
  observationAtMs: number = Date.now(),
  opts?: { querySource?: string },
): void {
  const state = getClaudeAiLimitsHostState()
  // Check if we need to process rate limits
  const isSubscriber = isClaudeAISubscriber()

  if (!shouldProcessRateLimits(isSubscriber)) {
    // If we have any rate limit state, clear it
    state.rawUtilization = {}
    updateProviderBuckets('anthropic', [])
    if (
      state.currentLimits.status !== 'allowed' ||
      state.currentLimits.resetsAt
    ) {
      const defaultLimits: ClaudeAILimits = {
        status: 'allowed',
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      }
      emitStatusChange(defaultLimits)
    }
    return
  }

  // Process headers (applies mocks from /mock-limits command if active)
  const headersToUse = processRateLimitHeaders(headers)
  let newLimits = computeNewLimitsFromHeaders(headersToUse)
  // densable gold: j4e/b7u extra-usage cache BEFORE isStaleObservation.
  // Stale still writes cachedExtraUsageDisabledReason; only raw/status skip.
  cacheExtraUsageDisabledReason(headersToUse)
  if (isStaleObservation(observationAtMs)) {
    return
  }
  state.rawUtilization = extractRawUtilization(headersToUse)
  updateProviderBuckets(
    'anthropic',
    anthropicAdapter.parseHeaders(headersToUse),
  )

  // Official 2.1.323 (#2105): A quick side request on a smaller model (e.g.
  // Haiku naming the session) must not clear an active overage state (especially
  // past the weekly Fable limit) or suppress/repeat "Now using usage credits".
  if (
    isSideRequestQuerySourceForRateLimits(opts?.querySource) &&
    state.currentLimits.isUsingOverage === true &&
    !newLimits.isUsingOverage
  ) {
    newLimits = {
      ...newLimits,
      isUsingOverage: true,
      ...(state.currentLimits.rateLimitType !== undefined && {
        rateLimitType: state.currentLimits.rateLimitType,
      }),
      ...(state.currentLimits.resetsAt !== undefined && {
        resetsAt: state.currentLimits.resetsAt,
      }),
    }
  }

  if (!isEqual(state.currentLimits, newLimits)) {
    emitStatusChange(newLimits)
  }
}

/**
 * densable extractQuotaStatusFromError / MNa.
 * `querySourceBucket` is densable hAm (`main_thread` | `other`); drives s0v rearm.
 */
export function extractQuotaStatusFromError(
  error: APIError,
  querySourceBucket: QuotaRejectedQuerySourceBucket = 'other',
  observationAtMs: number = Date.now(),
): void {
  if (
    !shouldProcessRateLimits(isClaudeAISubscriber()) ||
    error.status !== 429
  ) {
    return
  }

  // densable fxo: gateway 429 without unified-status is not a quota event
  // (e.g. plain infra throttle). Spend precheck always sets the status header.
  if (
    getAPIProvider() === 'gateway' &&
    !error.headers?.get?.('anthropic-ratelimit-unified-status')
  ) {
    return
  }

  const state = getClaudeAiLimitsHostState()
  try {
    // densable: `d=this.isStaleObservation(r)` — stale skips raw/emit/rejected.
    const stale = isStaleObservation(observationAtMs)
    let newLimits = { ...state.currentLimits }
    if (error.headers) {
      // Process headers (applies mocks from /mock-limits command if active)
      const headersToUse = processRateLimitHeaders(error.headers)
      if (!stale) {
        state.rawUtilization = extractRawUtilization(headersToUse)
      }
      updateProviderBuckets(
        'anthropic',
        anthropicAdapter.parseHeaders(headersToUse),
      )
      newLimits = computeNewLimitsFromHeaders(headersToUse)

      // Cache extra usage status (persists across sessions)
      cacheExtraUsageDisabledReason(headersToUse)
    }
    // For errors, always set status to rejected even if headers are not present.
    newLimits.status = 'rejected'

    if (stale) {
      return
    }

    // densable: quotaRejected.emit(u, t) even when statusChanged is deduped
    emitQuotaRejected(newLimits, querySourceBucket)

    if (!isEqual(state.currentLimits, newLimits)) {
      emitStatusChange(newLimits)
    }
  } catch (e) {
    logError(e as Error)
  }
}
