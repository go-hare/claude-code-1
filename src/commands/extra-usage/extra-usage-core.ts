import {
  checkAdminRequestEligibility,
  createAdminRequest,
  getMyAdminRequests,
} from '../../services/api/adminRequests.js'
import { invalidateOverageCreditGrantCache } from '../../services/api/overageCreditGrant.js'
import { type ExtraUsage, fetchUtilization } from '../../services/api/usage.js'
import {
  getUsageCreditsAskAdminHint,
  isCloudOrRemoteControlSession,
} from '../../services/rateLimitMessages.js'
import { getSubscriptionType } from '../../utils/auth.js'
import { hasClaudeAiBillingAccess } from '../../utils/billing.js'
import { openBrowser } from '../../utils/browser.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { formatResetTime } from '../../utils/format.js'
import { logError } from '../../utils/log.js'

/**
 * densable 2.1.222 #3 / BTr result surface for Team/Enterprise without billing.
 * Interactive path returns `confirm-admin-request` ($$n) instead of auto-create.
 */
export type ExtraUsageResult =
  | { type: 'message'; value: string }
  | { type: 'browser-opened'; url: string; opened: boolean }
  | { type: 'confirm-admin-request'; extraUsage: ExtraUsage | null | undefined }

/** densable UTr — noninteractive confirm deferral copy. */
export const USAGE_CREDITS_ADMIN_REQUEST_INTERACTIVE_HINT =
  'Requesting usage credits notifies your organization admins. To review and send the request, run /usage-credits in an interactive Claude Code session.'

/**
 * densable pure gate: only **pending** blocks a new request.
 * Dismissed / approved must NOT block (2.1.222 #3).
 */
export function hasBlockingPendingAdminRequest(
  requests: Array<{ status?: string }> | null | undefined,
): boolean {
  if (!requests || requests.length === 0) return false
  return requests.some(r => r.status === 'pending')
}

/**
 * densable uen @184961866 — member_* / group_zero_credit_limit copy + mhe().
 * These are NOT spend-cap (`hqe`). Other uen overage arms
 * (out_of_credits / inner hqe / seat_tier_* / org_service_level_disabled /
 * den / Gj / wb progressSavedSuffix) live in rateLimitMessages
 * `getLimitReachedText`. Do not invent BTr arms gold doesn't have.
 */
/**
 * Official 2.1.326 (#264) `Z7s`: format the reset-time suffix for a pooled
 * group budget (`overageScope === 'group_pool'`) when `overageResetsAt` is in
 * the future and the rate limit is overage/unset.
 */
export function formatGroupPoolBudgetResetSuffix(
  info: {
    overageScope?: string
    rateLimitType?: string
    overageResetsAt?: number
  },
  nowMs: number = Date.now(),
): string {
  if (info.overageScope !== 'group_pool') return ''
  if (info.rateLimitType && info.rateLimitType !== 'overage') return ''
  if (
    typeof info.overageResetsAt !== 'number' ||
    !Number.isFinite(info.overageResetsAt) ||
    info.overageResetsAt * 1000 <= nowMs
  ) {
    return ''
  }
  const formatted = formatResetTime(info.overageResetsAt, false)
  return formatted ? ` · resets ${formatted}` : ''
}

export function getUsageCreditsZeroLimitCopy(
  reason: string | null | undefined,
): string | null {
  if (
    reason === 'member_level_disabled' ||
    reason === 'member_zero_credit_limit'
  ) {
    return `Your usage allocation has been disabled by your admin${getUsageCreditsAskAdminHint()}`
  }
  if (reason === 'group_zero_credit_limit') {
    return `Your group's usage limit is set to $0${getUsageCreditsAskAdminHint()}`
  }
  return null
}

const USAGE_SETTINGS_ADMIN_URL = 'https://claude.ai/admin-settings/usage'

function extractAdminRequestErrorInfo(error: unknown): {
  status?: number
  code?: string
  message?: string
} {
  if (!error || typeof error !== 'object') return {}
  const ax = error as {
    status?: number
    response?: { status?: number; data?: unknown }
  }
  const status = ax.response?.status ?? ax.status
  const data = ax.response?.data
  if (!data || typeof data !== 'object') {
    return { status }
  }
  const rec = data as Record<string, unknown>
  const errObj =
    rec.error && typeof rec.error === 'object'
      ? (rec.error as Record<string, unknown>)
      : undefined
  const code =
    (typeof errObj?.code === 'string' ? errObj.code : undefined) ??
    (typeof errObj?.type === 'string' ? errObj.type : undefined) ??
    (typeof rec.code === 'string' ? rec.code : undefined)
  let message: string | undefined
  if (typeof errObj?.message === 'string' && errObj.message.length > 0) {
    message = errObj.message
  } else {
    for (const key of ['message', 'detail'] as const) {
      const v = rec[key]
      if (typeof v === 'string' && v.length > 0) {
        message = v
        break
      }
    }
  }
  return { status, code, message }
}

/**
 * Official 2.1.326 (#178) `dLe`: format an admin usage-credit request refusal,
 * explicitly guiding admins who already have billing access to the usage
 * settings page rather than saying "Request sent to your admin".
 */
export function formatAdminUsageCreditRequestError(
  error: unknown,
  isDesktop = process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop' ||
    process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop-3p',
): string {
  const { status, code, message } = extractAdminRequestErrorInfo(error)
  if (code === 'admin_request_admin_can_act') {
    return isDesktop || isCloudOrRemoteControlSession()
      ? 'No request sent, because you have billing access. Manage usage credits in admin settings on the web.'
      : `No request sent, because you have billing access. Visit ${USAGE_SETTINGS_ADMIN_URL} to manage usage credits for your organization.`
  }
  if ((status === undefined || status < 500) && message) {
    return message
  }
  return "Couldn't send your request. Try again later."
}

/**
 * densable iea + Official 2.1.326 (#178) `dLe`: create limit_increase after user confirms.
 */
export async function submitAdminUsageCreditRequest(
  extraUsage: ExtraUsage | null | undefined,
): Promise<ExtraUsageResult> {
  try {
    const created = await createAdminRequest({
      request_type: 'limit_increase',
      details: null,
    })
    // Guard against non-2xx or empty responses that didn't throw
    const maybeStatus = (created as unknown as { status?: unknown })?.status
    if (
      !created ||
      (typeof maybeStatus === 'number' &&
        (maybeStatus < 200 || maybeStatus >= 300))
    ) {
      return {
        type: 'message',
        value: formatAdminUsageCreditRequestError(created),
      }
    }
    if (extraUsage == null) {
      return {
        type: 'message',
        value: 'Request sent to your admin for usage credits.',
      }
    }
    if (extraUsage.is_enabled) {
      return {
        type: 'message',
        value:
          'Request sent to your admin to increase your usage credit limit.',
      }
    }
    return {
      type: 'message',
      value: 'Request sent to your admin to turn on usage credits.',
    }
  } catch (error) {
    logError(error as Error)
    return {
      type: 'message',
      value: formatAdminUsageCreditRequestError(error),
    }
  }
}

/** densable pyp — surface 4xx API message when present. */
export function extractAdminRequestErrorMessage(error: unknown): string | null {
  const { status, message } = extractAdminRequestErrorInfo(error)
  if (typeof status === 'number' && status >= 500) return null
  return message ?? null
}

/**
 * densable BTr — `/usage-credits` core routing.
 *
 * Team/Enterprise without billing:
 * 1. disabled_reason early messages
 * 2. unlimited → no request
 * 3. eligibility false → contact admin
 * 4. **pending only** already-sent (NOT dismissed) — densable 2.1.222 #3
 * 5. else `confirm-admin-request` (interactive confirms via $$n / iea)
 */
export async function runExtraUsage(
  opts: { openInBrowser?: boolean } = {},
): Promise<ExtraUsageResult> {
  const openInBrowser = opts.openInBrowser !== false

  if (!getGlobalConfig().hasVisitedExtraUsage) {
    saveGlobalConfig(prev => ({ ...prev, hasVisitedExtraUsage: true }))
  }
  // Invalidate only the current org's entry so a follow-up read refetches
  // the granted state. Separate from the visited flag since users may run
  // /extra-usage more than once while iterating on the claim flow.
  invalidateOverageCreditGrantCache()

  const subscriptionType = getSubscriptionType()
  const isTeamOrEnterprise =
    subscriptionType === 'team' || subscriptionType === 'enterprise'
  const hasBillingAccess = hasClaudeAiBillingAccess()

  if (!hasBillingAccess && isTeamOrEnterprise) {
    let extraUsage: ExtraUsage | null | undefined
    try {
      const utilization = await fetchUtilization()
      extraUsage = utilization?.extra_usage
    } catch (error) {
      logError(error as Error)
    }

    // densable BTr switch(disabled_reason)
    const disabledReason = (
      extraUsage as ExtraUsage & { disabled_reason?: string | null }
    )?.disabled_reason
    if (disabledReason === 'out_of_credits') {
      return {
        type: 'message',
        value:
          'Your organization is out of usage credits. Contact your admin to add more.',
      }
    }
    if (
      disabledReason === 'org_level_disabled_until' ||
      disabledReason === 'org_spend_cap_reached'
    ) {
      return {
        type: 'message',
        value:
          "Your organization's usage credit cap is reached for this period. Contact your admin to raise it.",
      }
    }
    const zeroLimitCopy = getUsageCreditsZeroLimitCopy(disabledReason)
    if (zeroLimitCopy) {
      return { type: 'message', value: zeroLimitCopy }
    }

    if (extraUsage?.is_enabled && extraUsage.monthly_limit === null) {
      return {
        type: 'message',
        value:
          'Your organization already has unlimited usage credits. No request needed.',
      }
    }

    try {
      const eligibility = await checkAdminRequestEligibility('limit_increase')
      if (eligibility?.is_allowed === false) {
        return {
          type: 'message',
          value: 'Contact your admin to manage usage credit settings.',
        }
      }
    } catch (error) {
      logError(error as Error)
      // If eligibility check fails, continue — the create endpoint will enforce if necessary
    }

    try {
      // densable cyp("limit_increase", ["pending"]) — dismissed must not block (#3)
      const pendingRequests = await getMyAdminRequests('limit_increase', [
        'pending',
      ])
      if (hasBlockingPendingAdminRequest(pendingRequests)) {
        return {
          type: 'message',
          value: "You've already sent a usage credit request to your admin.",
        }
      }
    } catch (error) {
      logError(error as Error)
      // Fall through to confirm / create path below
    }

    // densable: return confirm surface; do NOT auto-create here.
    return { type: 'confirm-admin-request', extraUsage }
  }

  // Official 2.1.323 (#2204): in cloud sessions and under Remote Control,
  // `/usage-credits` no longer prints a web address.
  if (isCloudOrRemoteControlSession()) {
    return {
      type: 'message',
      value: isTeamOrEnterprise
        ? 'Manage usage credits in your organization admin settings.'
        : 'Manage usage credits in your Claude account settings.',
    }
  }

  const url = isTeamOrEnterprise
    ? 'https://claude.ai/admin-settings/usage'
    : 'https://claude.ai/settings/usage'

  if (!openInBrowser) {
    return { type: 'browser-opened', url, opened: false }
  }

  try {
    const opened = await openBrowser(url)
    return { type: 'browser-opened', url, opened }
  } catch (error) {
    logError(error as Error)
    return {
      type: 'message',
      value: `Couldn't open your browser. Visit ${url} to manage usage credits.`,
    }
  }
}
