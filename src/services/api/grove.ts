import axios from 'axios'
import memoize from 'lodash-es/memoize.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getOauthAccountInfo, isConsumerSubscriber } from 'src/utils/auth.js'
import { logForDebugging } from 'src/utils/debug.js'
import { gracefulShutdown } from 'src/utils/gracefulShutdown.js'
import { isEssentialTrafficOnly } from 'src/utils/privacyLevel.js'
import { writeToStderr } from 'src/utils/process.js'
import { getOauthConfig } from '../../constants/oauth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import {
  getAuthHeaders,
  getUserAgent,
  withOAuth401Retry,
} from '../../utils/http.js'
import { logError } from '../../utils/log.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'

// Cache expiration: 24 hours
const GROVE_CACHE_EXPIRATION_MS = 24 * 60 * 60 * 1000

export type AccountSettings = {
  grove_enabled: boolean | null
  grove_notice_viewed_at: string | null
}

export type GroveConfig = {
  grove_enabled: boolean
  domain_excluded: boolean
  notice_is_grace_period: boolean
  notice_reminder_frequency: number | null
  grove_locked_by_claude_science?: boolean
}

/**
 * Result type that distinguishes between API failure and success.
 * - success: true means API call succeeded (data may still contain null fields)
 * - success: false means API call failed after retry
 */
export type ApiResult<T> = { success: true; data: T } | { success: false }

/**
 * Get the current Grove settings for the user account.
 * Returns ApiResult to distinguish between API failure and success.
 * Uses existing OAuth 401 retry, then returns failure if that doesn't help.
 *
 * Memoized for the session to avoid redundant per-render requests.
 * Cache is invalidated in updateGroveSettings() so post-toggle reads are fresh.
 */
export const getGroveSettings = memoize(
  async (): Promise<ApiResult<AccountSettings>> => {
    // Grove is a notification feature; during an outage, skipping it is correct.
    if (isEssentialTrafficOnly()) {
      return { success: false }
    }
    try {
      const response = await withOAuth401Retry(() => {
        const authHeaders = getAuthHeaders()
        if (authHeaders.error) {
          throw new Error(`Failed to get auth headers: ${authHeaders.error}`)
        }
        return axios.get<AccountSettings>(
          `${getOauthConfig().BASE_API_URL}/api/oauth/account/settings`,
          {
            headers: {
              ...authHeaders.headers,
              'User-Agent': getClaudeCodeUserAgent(),
            },
          },
        )
      })
      return { success: true, data: response.data }
    } catch (err) {
      logError(err)
      // Don't cache failures — transient network issues would lock the user
      // out of privacy settings for the entire session (deadlock: dialog needs
      // success to render the toggle, toggle calls updateGroveSettings which
      // is the only other place the cache is cleared).
      getGroveSettings.cache.clear?.()
      return { success: false }
    }
  },
)

/**
 * Mark that the Grove notice has been viewed by the user
 */
export async function markGroveNoticeViewed(): Promise<void> {
  try {
    await withOAuth401Retry(() => {
      const authHeaders = getAuthHeaders()
      if (authHeaders.error) {
        throw new Error(`Failed to get auth headers: ${authHeaders.error}`)
      }
      return axios.post(
        `${getOauthConfig().BASE_API_URL}/api/oauth/account/grove_notice_viewed`,
        {},
        {
          headers: {
            ...authHeaders.headers,
            'User-Agent': getClaudeCodeUserAgent(),
          },
        },
      )
    })
  } catch (err) {
    logError(err)
  } finally {
    // This mutates grove_notice_viewed_at server-side — Grove.tsx reads it
    // to decide whether to show the dialog. Always invalidate on settle so
    // a same-session remount never reads stale viewed_at:null.
    getGroveSettings.cache.clear?.()
  }
}

/**
 * Update Grove settings for the user account.
 * Official 2.1.328 `Wmn`:
 * - Supports `{ onlyIfUnset: true }` which appends `?opt_in_only_if_unset=grove_enabled`
 *   so initial terms ON cannot silently flip an account that is already OFF.
 * - Returns the server's boolean `grove_enabled` when present in the response.
 * - Clears cached `getGroveSettings` in `finally` (both on success and failure).
 * - On error logs and returns `undefined` (official `catch` falls through to
 *   `return`, it does not rethrow) — callers detect failure via `undefined`,
 *   never confuse it with a server `false` (which means `already_off`).
 */
export async function updateGroveSettings(
  groveEnabled: boolean,
  options: { onlyIfUnset?: boolean } = {},
): Promise<boolean | undefined> {
  const { onlyIfUnset = false } = options
  try {
    const response = await withOAuth401Retry(() => {
      const authHeaders = getAuthHeaders()
      if (authHeaders.error) {
        throw new Error(`Failed to get auth headers: ${authHeaders.error}`)
      }
      const path = onlyIfUnset
        ? '/api/oauth/account/settings?opt_in_only_if_unset=grove_enabled'
        : '/api/oauth/account/settings'
      return axios.patch<{ grove_enabled?: unknown }>(
        `${getOauthConfig().BASE_API_URL}${path}`,
        {
          grove_enabled: groveEnabled,
        },
        {
          headers: {
            ...authHeaders.headers,
            'User-Agent': getClaudeCodeUserAgent(),
          },
        },
      )
    })
    const data = response?.data
    return typeof data === 'object' &&
      data !== null &&
      'grove_enabled' in data &&
      typeof data.grove_enabled === 'boolean'
      ? data.grove_enabled
      : undefined
  } catch (err) {
    logError(err)
    return undefined
  } finally {
    // Always invalidate memoized settings so subsequent reads (both after
    // success and after failure) never serve stale cached state.
    getGroveSettings.cache.clear?.()
  }
}

/**
 * Check if user is qualified for Grove (non-blocking, cache-first).
 *
 * This function never blocks on network - it returns cached data immediately
 * and fetches in the background if needed. On cold start (no cache), it returns
 * false and the Grove dialog won't show until the next session.
 */
export async function isQualifiedForGrove(): Promise<boolean> {
  if (!isConsumerSubscriber()) {
    return false
  }

  const accountId = getOauthAccountInfo()?.accountUuid
  if (!accountId) {
    return false
  }

  const globalConfig = getGlobalConfig()
  const cachedEntry = globalConfig.groveConfigCache?.[accountId]
  const now = Date.now()

  // No cache - trigger background fetch and return false (non-blocking)
  // The Grove dialog won't show this session, but will next time if eligible
  if (!cachedEntry) {
    logForDebugging(
      'Grove: No cache, fetching config in background (dialog skipped this session)',
    )
    void fetchAndStoreGroveConfig(accountId)
    return false
  }

  // Cache exists but is stale - return cached value and refresh in background
  if (now - cachedEntry.timestamp > GROVE_CACHE_EXPIRATION_MS) {
    logForDebugging(
      'Grove: Cache stale, returning cached data and refreshing in background',
    )
    void fetchAndStoreGroveConfig(accountId)
    return cachedEntry.grove_enabled
  }

  // Cache is fresh - return it immediately
  logForDebugging('Grove: Using fresh cached config')
  return cachedEntry.grove_enabled
}

/**
 * Fetch Grove config from API and store in cache
 */
async function fetchAndStoreGroveConfig(accountId: string): Promise<void> {
  try {
    const result = await getGroveNoticeConfig()
    if (!result.success) {
      return
    }
    const groveEnabled = result.data.grove_enabled
    const cachedEntry = getGlobalConfig().groveConfigCache?.[accountId]
    if (
      cachedEntry?.grove_enabled === groveEnabled &&
      Date.now() - cachedEntry.timestamp <= GROVE_CACHE_EXPIRATION_MS
    ) {
      return
    }
    saveGlobalConfig(current => ({
      ...current,
      groveConfigCache: {
        ...current.groveConfigCache,
        [accountId]: {
          grove_enabled: groveEnabled,
          timestamp: Date.now(),
        },
      },
    }))
  } catch (err) {
    logForDebugging(`Grove: Failed to fetch and store config: ${err}`)
  }
}

/**
 * Get Grove Statsig configuration from the API.
 * Returns ApiResult to distinguish between API failure and success.
 * Uses existing OAuth 401 retry, then returns failure if that doesn't help.
 */
export const getGroveNoticeConfig = memoize(
  async (): Promise<ApiResult<GroveConfig>> => {
    // Grove is a notification feature; during an outage, skipping it is correct.
    if (isEssentialTrafficOnly()) {
      return { success: false }
    }
    try {
      const response = await withOAuth401Retry(() => {
        const authHeaders = getAuthHeaders()
        if (authHeaders.error) {
          throw new Error(`Failed to get auth headers: ${authHeaders.error}`)
        }
        return axios.get<GroveConfig>(
          `${getOauthConfig().BASE_API_URL}/api/claude_code_grove`,
          {
            headers: {
              ...authHeaders.headers,
              'User-Agent': getUserAgent(),
            },
            timeout: 3000, // Short timeout - if slow, skip Grove dialog
          },
        )
      })

      // Map the API response to the GroveConfig type
      const {
        grove_enabled,
        domain_excluded,
        notice_is_grace_period,
        notice_reminder_frequency,
        grove_locked_by_claude_science,
      } = response.data

      return {
        success: true,
        data: {
          grove_enabled,
          domain_excluded: domain_excluded ?? false,
          notice_is_grace_period: notice_is_grace_period ?? true,
          notice_reminder_frequency,
          grove_locked_by_claude_science:
            grove_locked_by_claude_science === true,
        },
      }
    } catch (err) {
      logForDebugging(`Failed to fetch Grove notice config: ${err}`)
      getGroveNoticeConfig.cache.clear?.()
      return { success: false }
    }
  },
)

/**
 * Determines whether the Grove dialog should be shown.
 * Returns false if either API call failed (after retry) - we hide the dialog on API failure.
 */
export function calculateShouldShowGrove(
  settingsResult: ApiResult<AccountSettings>,
  configResult: ApiResult<GroveConfig>,
  showIfAlreadyViewed: boolean,
): boolean {
  // Hide dialog on API failure (after retry)
  if (!settingsResult.success || !configResult.success) {
    return false
  }

  const settings = settingsResult.data
  const config = configResult.data

  const hasChosen = settings.grove_enabled !== null
  if (hasChosen) {
    return false
  }
  if (showIfAlreadyViewed) {
    return true
  }
  if (!config.notice_is_grace_period) {
    return true
  }
  // Check if we need to remind the user to accept the terms and choose
  // whether to help improve Claude.
  const reminderFrequency = config.notice_reminder_frequency
  if (reminderFrequency !== null && settings.grove_notice_viewed_at) {
    const daysSinceViewed = Math.floor(
      (Date.now() - new Date(settings.grove_notice_viewed_at).getTime()) /
        (1000 * 60 * 60 * 24),
    )
    return daysSinceViewed >= reminderFrequency
  } else {
    // Show if never viewed before
    const viewedAt = settings.grove_notice_viewed_at
    return viewedAt === null || viewedAt === undefined
  }
}

const GROVE_CHOICE_SEEN_TTL_MS = 3_600_000

function isRecentGroveChoiceSeen(timestamp: unknown): boolean {
  if (typeof timestamp !== 'number') return false
  const elapsed = Date.now() - timestamp
  return elapsed >= 0 && elapsed < GROVE_CHOICE_SEEN_TTL_MS
}

function getGroveChoiceSeenMap(
  config: ReturnType<typeof getGlobalConfig>,
): Record<string, number> {
  const raw = (config as { groveChoiceSeenAt?: unknown }).groveChoiceSeenAt
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number') result[k] = v
  }
  return result
}

function getNormalizedGroveAccountKey(): string | undefined {
  const uuid =
    getOauthAccountInfo()?.accountUuid ?? process.env.CLAUDE_CODE_ACCOUNT_UUID
  return uuid?.trim().toLowerCase() || undefined
}

export async function checkGroveForNonInteractive(): Promise<void> {
  const accountKey = getNormalizedGroveAccountKey()
  if (
    accountKey !== undefined &&
    isRecentGroveChoiceSeen(
      getGroveChoiceSeenMap(getGlobalConfig())[accountKey],
    )
  ) {
    logForDebugging(
      'Grove: the server recently confirmed a Consumer Terms answer; not asking again',
    )
    return
  }

  const [settingsResult, configResult] = await Promise.all([
    getGroveSettings(),
    getGroveNoticeConfig(),
  ])

  if (settingsResult.success && accountKey !== undefined) {
    const hasChosen = settingsResult.data.grove_enabled !== null
    const now = Date.now()
    if (
      hasChosen !==
      isRecentGroveChoiceSeen(
        getGroveChoiceSeenMap(getGlobalConfig())[accountKey],
      )
    ) {
      saveGlobalConfig(current => {
        const seen = getGroveChoiceSeenMap(current)
        if (hasChosen === isRecentGroveChoiceSeen(seen[accountKey])) {
          return current
        }
        const pruned = Object.entries(seen).filter(
          ([k, ts]) => k !== accountKey && isRecentGroveChoiceSeen(ts),
        )
        const nextSeen = Object.fromEntries(
          hasChosen ? [...pruned, [accountKey, now]] : pruned,
        )
        return {
          ...current,
          groveChoiceSeenAt: nextSeen,
        } as typeof current
      })
    }
  }

  // Check if user hasn't made a choice yet (returns false on API failure)
  const shouldShowGrove = calculateShouldShowGrove(
    settingsResult,
    configResult,
    false,
  )

  if (shouldShowGrove) {
    // shouldShowGrove is only true if both API calls succeeded
    const config = configResult.success ? configResult.data : null
    logEvent('tengu_grove_print_viewed', {
      dismissable:
        config?.notice_is_grace_period as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (config === null || config.notice_is_grace_period) {
      // Grace period is still active - show informational message and continue
      writeToStderr(
        '\nAn update to our Consumer Terms and Privacy Policy will take effect on October 8, 2025. Run `claude` to review the updated terms.\n\n',
      )
      await markGroveNoticeViewed()
    } else {
      // Grace period has ended - show error message and exit
      writeToStderr(
        '\n[ACTION REQUIRED] An update to our Consumer Terms and Privacy Policy has taken effect on October 8, 2025. You must run `claude` to review the updated terms.\n\n',
      )
      await gracefulShutdown(1)
    }
  }
}
