import axios from 'axios'
import { z } from 'zod'
import { getOauthConfig } from '../../constants/oauth.js'
import {
  getClaudeAIOAuthTokens,
  getOauthAccountInfo,
  hasProfileScope,
  isClaudeAISubscriber,
} from '../../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getAuthHeaders } from '../../utils/http.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import { isOAuthTokenExpired } from '../oauth/client.js'
import { getRawUtilization } from '../claudeAiLimits.js'

export type RateLimit = {
  utilization: number | null // a percentage from 0 to 100
  resets_at: string | null // ISO 8601 timestamp
}

export type ExtraUsage = {
  is_enabled: boolean
  monthly_limit: number | null
  used_credits: number | null
  utilization: number | null
  /** SEA iXl: cents formatter currency; defaults to USD when absent. */
  currency?: string | null
  /**
   * densable BTr switch arm — when set, /usage-credits surfaces early message
   * instead of admin-request confirm (2.1.222).
   */
  disabled_reason?: string | null
}

/**
 * densable iXl capped-path utilization: prefer API utilization, else
 * clamp(used/limit*100, 0..100) when monthly_limit>0 (⇒ 0% before spend),
 * else 100 when limit is 0.
 */
export function resolveExtraUsageUtilization(extraUsage: {
  utilization: number | null | undefined
  monthly_limit: number
  used_credits: number
}): number {
  if (typeof extraUsage.utilization === 'number') {
    return extraUsage.utilization
  }
  if (extraUsage.monthly_limit > 0) {
    return Math.max(
      0,
      Math.min(100, (extraUsage.used_credits / extraUsage.monthly_limit) * 100),
    )
  }
  return 100
}

/** densable SEA `$sT` — currency code → display prefix. */
const USAGE_CREDIT_CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  BRL: 'R$',
  CAD: 'CA$',
  AUD: 'A$',
  NZD: 'NZ$',
  SGD: 'S$',
}

/** densable SEA `BsT` — whole-unit currencies (no /100 cents conversion). */
const USAGE_CREDIT_WHOLE_UNIT_CURRENCIES = new Set(['JPY', 'KRW', 'VND'])

function usageCreditCurrencyPrefix(currency: string): string {
  const code = currency.toUpperCase()
  return USAGE_CREDIT_CURRENCY_SYMBOLS[code] ?? `${code} `
}

export type UsageCreditsAmountMode = 'precise' | 'whole' | 'fit'

/**
 * densable SEA `am` twin for Usage credits row.
 * USD-like amounts are cents → major units; JPY/KRW/VND are already whole units.
 */
export function formatUsageCreditsAmount(
  centsOrWhole: number,
  currency?: string | null,
  mode: UsageCreditsAmountMode = 'precise',
): string {
  const code = (currency ?? 'USD').toUpperCase()
  const prefix = usageCreditCurrencyPrefix(code)
  if (USAGE_CREDIT_WHOLE_UNIT_CURRENCIES.has(code)) {
    return `${prefix}${Math.round(centsOrWhole).toLocaleString('en-US')}`
  }
  const major = centsOrWhole / 100
  if (mode === 'whole') {
    return `${prefix}${Math.round(major).toLocaleString('en-US')}`
  }
  if (mode === 'fit' && major % 1 === 0) {
    return `${prefix}${major.toLocaleString('en-US')}`
  }
  return `${prefix}${major.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export type UsagePlanLimit = {
  kind: string
  group: string
  percent: number
  resets_at: string | null
  scope?: {
    model?: { display_name: string } | null
    surface?: { display_name: string } | null
  } | null
}

export type Utilization = {
  five_hour?: RateLimit | null
  seven_day?: RateLimit | null
  seven_day_oauth_apps?: RateLimit | null
  seven_day_opus?: RateLimit | null
  seven_day_sonnet?: RateLimit | null
  cinder_cove?: RateLimit | null
  extra_usage?: ExtraUsage | null
  limits?: UsagePlanLimit[] | null
}

export type UsageSeedSource = 'headers' | 'persisted'

export type UsageSeed = {
  utilization: Utilization
  source: UsageSeedSource
  fetchedAtMs?: number
}

type PersistedUsageSeed = {
  utilization: Utilization
  fetchedAtMs: number
}

/** Official `UNo` — skip rewrite when same-account snapshot is newer. */
export const USAGE_PERSIST_WRITE_DEBOUNCE_MS = 300_000
/** Official `FNo` — drop last-known snapshot older than this. */
export const USAGE_PERSIST_READ_TTL_MS = 3_600_000

/** Official `q` — persist only when the live body has at least one of these. */
const USAGE_PERSIST_BODY_FIELDS = [
  'five_hour',
  'seven_day',
  'seven_day_oauth_apps',
  'seven_day_opus',
  'seven_day_sonnet',
  'cinder_cove',
  'extra_usage',
  'limits',
] as const

const usageWindowSchema = z
  .object({
    utilization: z.number().nullable(),
    resets_at: z.string().nullable(),
  })
  .passthrough()

/** Official `zNo` — cachedUsageUtilization on global config. */
const cachedUsageUtilizationSchema = z.object({
  fetchedAtMs: z.number(),
  accountUuid: z.string().optional(),
  utilization: z
    .object({
      five_hour: usageWindowSchema.nullish(),
      seven_day: usageWindowSchema.nullish(),
      seven_day_oauth_apps: usageWindowSchema.nullish(),
      seven_day_opus: usageWindowSchema.nullish(),
      seven_day_sonnet: usageWindowSchema.nullish(),
      cinder_cove: usageWindowSchema.nullish(),
      extra_usage: z
        .object({
          is_enabled: z.boolean(),
          monthly_limit: z.number().nullable(),
          used_credits: z.number().nullable(),
          utilization: z.number().nullable(),
          currency: z.string().nullish(),
          disabled_reason: z.string().nullish(),
        })
        .passthrough()
        .nullish(),
      limits: z
        .array(
          z
            .object({
              kind: z.string(),
              group: z.string(),
              percent: z.number(),
              resets_at: z.string().nullable(),
              scope: z
                .object({
                  model: z
                    .object({ display_name: z.string() })
                    .passthrough()
                    .nullish(),
                  surface: z
                    .object({ display_name: z.string() })
                    .passthrough()
                    .nullish(),
                })
                .passthrough()
                .nullish(),
            })
            .passthrough(),
        )
        .nullish(),
    })
    .passthrough(),
})

function headerWindowToUsage(window: {
  utilization: number
  resets_at: number
}): RateLimit {
  return {
    utilization: window.utilization * 100,
    resets_at: new Date(window.resets_at * 1000).toISOString(),
  }
}

export function usageBodyHasPersistFields(body: unknown): body is Utilization {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    USAGE_PERSIST_BODY_FIELDS.some(key => key in body)
  )
}

/**
 * Official `K0a` / `Gna` / `I` — last-known `/usage` snapshot on global
 * config. `storageV5` is the official persist handle (`gi`/`ps` 2nd arg).
 */
export function readPersistedUsageSeed(
  _storageV5?: unknown,
): PersistedUsageSeed | null {
  const cached = getGlobalConfig().cachedUsageUtilization
  if (!cached) return null
  const parsed = cachedUsageUtilizationSchema.safeParse(cached)
  if (!parsed.success) return null
  if (parsed.data.accountUuid !== getOauthAccountInfo()?.accountUuid) {
    saveGlobalConfig(
      current => ({ ...current, cachedUsageUtilization: undefined }),
      _storageV5,
    )
    return null
  }
  const ageMs = Date.now() - parsed.data.fetchedAtMs
  if (ageMs < 0 || ageMs > USAGE_PERSIST_READ_TTL_MS) return null
  return {
    utilization: parsed.data.utilization as Utilization,
    fetchedAtMs: parsed.data.fetchedAtMs,
  }
}

/**
 * Official `V0a` / `Fna` / `x` — write last-known usage. No-op when the
 * passed account is not the current OAuth account, or when a same-account
 * snapshot is newer than `UNo` (5 minutes).
 */
export function persistUsageSeed(
  utilization: Utilization,
  accountUuid: string | undefined,
  _storageV5?: unknown,
): void {
  const currentUuid = getOauthAccountInfo()?.accountUuid
  if (currentUuid !== accountUuid) return
  const existing = getGlobalConfig().cachedUsageUtilization
  const ageMs =
    existing && existing.accountUuid === currentUuid
      ? Date.now() - existing.fetchedAtMs
      : Number.POSITIVE_INFINITY
  if (ageMs >= 0 && ageMs < USAGE_PERSIST_WRITE_DEBOUNCE_MS) return
  saveGlobalConfig(
    current => ({
      ...current,
      cachedUsageUtilization: {
        fetchedAtMs: Date.now(),
        ...(currentUuid !== undefined && { accountUuid: currentUuid }),
        utilization,
      },
    }),
    _storageV5,
  )
}

/**
 * Official `y` — seed `/usage` from Y0a-filtered headers (`M()`), else persist
 * `I(storageV5)`. Live `/api/oauth/usage` is a separate refresh (`P()`/`J()`),
 * not an ISO-window filter on the response body.
 */
export function seedUtilizationFromOpenHeaders(
  _storageV5?: unknown,
): UsageSeed | null {
  const open = getRawUtilization()
  if (!open.five_hour && !open.seven_day) {
    const persisted = readPersistedUsageSeed(_storageV5)
    return persisted
      ? {
          utilization: persisted.utilization,
          source: 'persisted',
          fetchedAtMs: persisted.fetchedAtMs,
        }
      : null
  }
  return {
    utilization: {
      five_hour: open.five_hour
        ? headerWindowToUsage(open.five_hour)
        : undefined,
      seven_day: open.seven_day
        ? headerWindowToUsage(open.seven_day)
        : undefined,
    },
    source: 'headers',
  }
}

export async function fetchUtilization(): Promise<Utilization | null> {
  if (!isClaudeAISubscriber() || !hasProfileScope()) {
    return {}
  }

  // Skip API call if OAuth token is expired to avoid 401 errors
  const tokens = getClaudeAIOAuthTokens()
  if (tokens && isOAuthTokenExpired(tokens.expiresAt)) {
    return null
  }

  const authResult = getAuthHeaders()
  if (authResult.error) {
    throw new Error(`Auth error: ${authResult.error}`)
  }

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': getClaudeCodeUserAgent(),
    ...authResult.headers,
  }

  const url = `${getOauthConfig().BASE_API_URL}/api/oauth/usage`

  const response = await axios.get<Utilization>(url, {
    headers,
    timeout: 5000, // 5 second timeout
  })

  if (usageBodyHasPersistFields(response.data)) {
    persistUsageSeed(response.data, getOauthAccountInfo()?.accountUuid)
  }
  return response.data
}
