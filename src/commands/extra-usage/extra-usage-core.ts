import {
  checkAdminRequestEligibility,
  createAdminRequest,
  getMyAdminRequests,
} from '../../services/api/adminRequests.js'
import { invalidateOverageCreditGrantCache } from '../../services/api/overageCreditGrant.js'
import { type ExtraUsage, fetchUtilization } from '../../services/api/usage.js'
import { getSubscriptionType } from '../../utils/auth.js'
import { hasClaudeAiBillingAccess } from '../../utils/billing.js'
import { openBrowser } from '../../utils/browser.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
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
 * densable iea — create limit_increase after user confirms.
 */
export async function submitAdminUsageCreditRequest(
  extraUsage: ExtraUsage | null | undefined,
): Promise<ExtraUsageResult> {
  try {
    await createAdminRequest({
      request_type: 'limit_increase',
      details: null,
    })
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
    const apiMessage = extractAdminRequestErrorMessage(error)
    if (apiMessage) {
      logError(error as Error)
      return { type: 'message', value: apiMessage }
    }
    logError(error as Error)
    return {
      type: 'message',
      value: 'Contact your admin to manage usage credit settings.',
    }
  }
}

/** densable pyp — surface 4xx API message when present. */
export function extractAdminRequestErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const ax = error as {
    isAxiosError?: boolean
    response?: { status?: number; data?: unknown }
  }
  // axios errors expose isAxiosError; also accept response-shaped errors in tests
  const status = ax.response?.status
  if (typeof status === 'number' && status >= 500) return null
  const data = ax.response?.data
  if (!data || typeof data !== 'object') return null
  const rec = data as Record<string, unknown>
  const errObj = rec.error
  if (errObj && typeof errObj === 'object') {
    const msg = (errObj as { message?: unknown }).message
    if (typeof msg === 'string' && msg.length > 0) return msg
  }
  for (const key of ['message', 'detail'] as const) {
    const v = rec[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
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
