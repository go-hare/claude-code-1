import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import {
  getClaudeAIOAuthTokens,
  hasProfileScope,
  isClaudeAISubscriber,
} from '../../utils/auth.js'
import { getAuthHeaders } from '../../utils/http.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import { isOAuthTokenExpired } from '../oauth/client.js'

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

export type Utilization = {
  five_hour?: RateLimit | null
  seven_day?: RateLimit | null
  seven_day_oauth_apps?: RateLimit | null
  seven_day_opus?: RateLimit | null
  seven_day_sonnet?: RateLimit | null
  extra_usage?: ExtraUsage | null
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

  return response.data
}
