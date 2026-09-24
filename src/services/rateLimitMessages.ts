/**
 * Centralized rate limit message generation
 * Single source of truth for all rate limit-related messages
 */

import {
  getOauthAccountInfo,
  getSubscriptionType,
  isOverageProvisioningAllowed,
} from '../utils/auth.js'
import { hasClaudeAiBillingAccess } from '../utils/billing.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { formatResetTime } from '../utils/format.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from './analytics/growthbook.js'
import type { ClaudeAILimits } from './claudeAiLimits.js'

const FEEDBACK_CHANNEL_ANT = '#briarpatch-cc'

/**
 * All possible rate limit error message prefixes
 * Export this to avoid fragile string matching in UI components
 */
export const RATE_LIMIT_ERROR_PREFIXES = [
  "You've hit your",
  "You've used",
  "You're now using extra usage",
  "You're close to",
  "You're out of extra usage",
  "You're out of usage credits",
  'Your org is out of usage',
] as const

/**
 * Check if a message is a rate limit error
 */
export function isRateLimitErrorMessage(text: string): boolean {
  return RATE_LIMIT_ERROR_PREFIXES.some(prefix => text.startsWith(prefix))
}

export type RateLimitMessage = {
  message: string
  severity: 'error' | 'warning'
}

/**
 * Get the appropriate rate limit message based on limit state
 * Returns null if no message should be shown
 */
export function getRateLimitMessage(
  limits: ClaudeAILimits,
  model: string,
): RateLimitMessage | null {
  // Check overage scenarios first (when subscription is rejected but overage is available)
  // getUsingOverageText is rendered separately from warning.
  if (limits.isUsingOverage) {
    // Show warning if approaching overage spending limit
    if (limits.overageStatus === 'allowed_warning') {
      return {
        message: "You're close to your extra usage spending limit",
        severity: 'warning',
      }
    }
    return null
  }

  // ERROR STATES - when limits are rejected
  if (limits.status === 'rejected') {
    return { message: getLimitReachedText(limits, model), severity: 'error' }
  }

  // WARNING STATES - when approaching limits with early warning
  if (limits.status === 'allowed_warning') {
    // Only show warnings when utilization is above threshold (70%)
    // This prevents false warnings after week reset when API may send
    // allowed_warning with stale data at low usage levels
    const WARNING_THRESHOLD = 0.7
    if (
      limits.utilization !== undefined &&
      limits.utilization < WARNING_THRESHOLD
    ) {
      return null
    }

    // Don't warn non-billing Team/Enterprise users about approaching plan limits
    // if overages are enabled - they'll seamlessly roll into overage
    const subscriptionType = getSubscriptionType()
    const isTeamOrEnterprise =
      subscriptionType === 'team' || subscriptionType === 'enterprise'
    const hasExtraUsageEnabled =
      getOauthAccountInfo()?.hasExtraUsageEnabled === true

    if (
      isTeamOrEnterprise &&
      hasExtraUsageEnabled &&
      !hasClaudeAiBillingAccess()
    ) {
      return null
    }

    const text = getEarlyWarningText(limits)
    if (text) {
      return { message: text, severity: 'warning' }
    }
  }

  // No message needed
  return null
}

/**
 * Get error message for API errors (used in errors.ts)
 * Returns the message string or null if no error message should be shown
 */
export function getRateLimitErrorMessage(
  limits: ClaudeAILimits,
  model: string,
): string | null {
  const message = getRateLimitMessage(limits, model)

  // Only return error messages, not warnings
  if (message && message.severity === 'error') {
    return message.message
  }

  return null
}

/**
 * Get warning message for UI footer
 * Returns the warning message string or null if no warning should be shown
 */
export function getRateLimitWarning(
  limits: ClaudeAILimits,
  model: string,
): string | null {
  const message = getRateLimitMessage(limits, model)

  // Only return warnings for the footer - errors are shown in AssistantTextMessages
  if (message && message.severity === 'warning') {
    return message.message
  }

  // Don't show errors in the footer
  return null
}

/**
 * densable 2.1.221 KCs — spend-cap reasons that need individual vs org monthly
 * copy (not a generic "limit"). org_spend_cap_reached → individual spend limit
 * for team/enterprise; org_level_disabled_until → org's monthly spend limit.
 */
const SPEND_CAP_DISABLED_REASONS = new Set([
  'org_level_disabled_until',
  'org_spend_cap_reached',
] as const)

/**
 * densable uen Gj() @184960481 — `I("tengu_vellum_anchor", !1)`.
 * When true, wb()/out_of_credits append " · progress saved".
 */
function isProgressSavedHintEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE<boolean>(
    'tengu_vellum_anchor',
    false,
  )
}

function isUsageBasedBilling(): boolean {
  return getOauthAccountInfo()?.billingType === 'usage_based'
}

const CONSUMER_USAGE_SETTINGS_URL =
  'claude.ai/settings/usage?from=cc_cli_limit_message'

/**
 * densable 2.1.248 v_() — hint gate only. SEA kS() is `return null`;
 * else Zur() = isOverageProvisioningAllowed (DN = #6 allowlist).
 * DISABLE_EXTRA_USAGE_COMMAND must use isEnvTruthy (same as /usage-credits
 * command + official Me()) — bare truthy would hide hints for `=0`/`=false`.
 */
export function isUsageCreditsHintEnabled(): boolean {
  if (isEnvTruthy(process.env.DISABLE_EXTRA_USAGE_COMMAND)) {
    return false
  }
  return isOverageProvisioningAllowed()
}

/**
 * densable 2.1.248 Nde() @184100558 sha=c8ad9d2a1a2d348e
 */
export function getUsageCreditsAskAdminHint(): string {
  return isUsageCreditsHintEnabled()
    ? ' · run /usage-credits to ask your admin for a higher limit'
    : ' · ask your admin for a higher limit'
}

function getUsageCreditsRaiseHint(): string {
  return isUsageCreditsHintEnabled()
    ? ' · run /usage-credits to raise it, or visit claude.ai/admin-settings/usage'
    : ' · visit claude.ai/admin-settings/usage to raise it'
}

/**
 * densable 2.1.239 Kvi — when a monthly spend cap is hit, also say when the
 * current session/weekly (or Opus/Sonnet) window resets. Official returns
 * null for overage / missing resetsAt. seven_day_sonnet uses $Wa(): pro or
 * enterprise → weekly limit, else Sonnet limit.
 */
function formatSessionOrWeeklyResetHint(limits: ClaudeAILimits): string {
  const resetTime = limits.resetsAt
    ? formatResetTime(limits.resetsAt, true)
    : undefined
  if (!resetTime) {
    return ''
  }
  let limitName: string | null = null
  switch (limits.rateLimitType) {
    case 'five_hour':
      limitName = 'session limit'
      break
    case 'seven_day':
      limitName = 'weekly limit'
      break
    case 'seven_day_opus':
      limitName = 'Opus limit'
      break
    case 'seven_day_sonnet': {
      const subscriptionType = getSubscriptionType()
      limitName =
        subscriptionType === 'pro' || subscriptionType === 'enterprise'
          ? 'weekly limit'
          : 'Sonnet limit'
      break
    }
    case 'overage':
    case undefined:
      limitName = null
      break
  }
  return limitName ? ` · your ${limitName} resets ${resetTime}` : ''
}

function getLimitReachedText(limits: ClaudeAILimits, model: string): string {
  const usageBased = isUsageBasedBilling()
  const hasBillingAccess = hasClaudeAiBillingAccess()
  const usageLimitAdminSuffix = hasBillingAccess
    ? ''
    : ' · contact your admin to increase it'
  const resetsAt = limits.resetsAt
  const resetTime = resetsAt ? formatResetTime(resetsAt, true) : undefined
  const overageResetTime = limits.overageResetsAt
    ? formatResetTime(limits.overageResetsAt, true)
    : undefined
  const resetMessage = resetTime ? ` · resets ${resetTime}` : ''

  // densable 2.1.221 / uen: outer hqe spend-cap is `if(!tx() && hqe.has)`.
  // usage_based falls through to the inner hqe arm (individual usage limit).
  const disabledReason = limits.overageDisabledReason
  if (
    !usageBased &&
    disabledReason &&
    (SPEND_CAP_DISABLED_REASONS as Set<string>).has(disabledReason)
  ) {
    const isIndividualSpendCap = disabledReason === 'org_spend_cap_reached'
    const subscriptionType = getSubscriptionType()
    const sessionWeeklyHint = formatSessionOrWeeklyResetHint(limits)
    if (subscriptionType === 'team' || subscriptionType === 'enterprise') {
      const limit = isIndividualSpendCap
        ? 'individual spend limit'
        : "org's monthly spend limit"
      const suffix = hasBillingAccess
        ? getUsageCreditsRaiseHint()
        : getUsageCreditsAskAdminHint()
      return formatLimitReachedText(
        limit,
        `${suffix}${sessionWeeklyHint}`,
        model,
      )
    }
    // Consumer / other: billing access → monthly spend limit + settings URL;
    // otherwise individual (spend cap) vs org monthly (disabled_until).
    const limit = hasBillingAccess
      ? 'monthly spend limit'
      : isIndividualSpendCap
        ? 'individual spend limit'
        : "org's monthly spend limit"
    const suffix = hasBillingAccess
      ? ` · raise it at ${CONSUMER_USAGE_SETTINGS_URL}`
      : ` · ask your admin to raise it at ${CONSUMER_USAGE_SETTINGS_URL}`
    return formatLimitReachedText(limit, `${suffix}${sessionWeeklyHint}`, model)
  }

  // densable uen — $0 / admin-disabled allocation. mhe() is the ask-admin hint.
  // Kept outside overage-rejected so non-overage rejected still surfaces it.
  // Separate from the spend-cap branch above. Do not move/revert.
  if (
    disabledReason === 'member_level_disabled' ||
    disabledReason === 'member_zero_credit_limit'
  ) {
    return `Your usage allocation has been disabled by your admin${getUsageCreditsAskAdminHint()}`
  }
  if (disabledReason === 'group_zero_credit_limit') {
    return `Your group's usage limit is set to $0${getUsageCreditsAskAdminHint()}`
  }

  // if BOTH subscription (checked before this method) and overage are exhausted
  if (limits.overageStatus === 'rejected') {
    // Show the earliest reset time to indicate when user can resume
    let overageResetMessage = ''
    if (resetsAt && limits.overageResetsAt) {
      // Both timestamps present - use the earlier one
      if (resetsAt < limits.overageResetsAt) {
        overageResetMessage = ` · resets ${resetTime}`
      } else {
        overageResetMessage = ` · resets ${overageResetTime}`
      }
    } else if (resetTime) {
      overageResetMessage = ` · resets ${resetTime}`
    } else if (overageResetTime) {
      overageResetMessage = ` · resets ${overageResetTime}`
    }

    if (limits.overageDisabledReason === 'out_of_credits') {
      // densable uen: usage_based → org out-of-usage; else credits + optional Gj.
      if (usageBased) {
        return hasBillingAccess
          ? 'Your org is out of usage · add funds to continue'
          : 'Your org is out of usage · contact your admin'
      }
      const progressSaved =
        overageResetMessage !== '' && isProgressSavedHintEnabled()
          ? ' · progress saved'
          : ''
      return `You're out of usage credits${overageResetMessage}${progressSaved}`
    }

    // densable uen remaining overage arms (inner hqe / seat_tier / org_service).
    if (
      disabledReason &&
      (SPEND_CAP_DISABLED_REASONS as Set<string>).has(disabledReason)
    ) {
      const innerReset = overageResetTime ? ` · resets ${overageResetTime}` : ''
      return formatLimitReachedText(
        disabledReason === 'org_spend_cap_reached'
          ? 'individual usage limit'
          : "org's monthly usage limit",
        innerReset,
        model,
      )
    }

    if (
      disabledReason === 'seat_tier_level_disabled' ||
      disabledReason === 'seat_tier_zero_credit_limit'
    ) {
      return `Your seat type doesn't include ${usageBased ? 'usage' : 'usage credits'}`
    }

    if (disabledReason === 'org_service_level_disabled') {
      return 'This service is disabled for your org'
    }

    // densable uen: if (r) wb("usage limit", u); else wb("limit", B,
    // {progressSavedSuffix: B !== "" && Gj()}).
    if (usageBased) {
      return formatLimitReachedText('usage limit', usageLimitAdminSuffix, model)
    }
    return formatLimitReachedText('limit', overageResetMessage, model, {
      progressSavedSuffix:
        overageResetMessage !== '' && isProgressSavedHintEnabled(),
    })
  }

  // densable uen den(): typed five_hour / seven_day / opus / sonnet (+ Gj).
  const typed = getTypedLimitReachedText(limits, resetMessage, model)
  if (typed !== null) {
    return typed
  }
  // densable uen: if (r) wb("usage limit", u); else
  // wb("usage limit", A, {progressSavedSuffix: A !== "" && Gj()}).
  if (usageBased) {
    return formatLimitReachedText('usage limit', usageLimitAdminSuffix, model)
  }
  return formatLimitReachedText('usage limit', resetMessage, model, {
    progressSavedSuffix: resetMessage !== '' && isProgressSavedHintEnabled(),
  })
}

/**
 * densable uen den() @184964566 / ghe():
 *   seven_day_sonnet → wb(ghe(), t, r, {progressSavedSuffix: Gj()})
 *   five_hour | seven_day | seven_day_opus → wb(Ew[type], t, r, {progressSavedSuffix: Gj()})
 *   seven_day_overage_included (Fable 5) is not in tip RateLimitType — not mapped.
 */
function sonnetOrWeeklyLimitName(): string {
  const subscriptionType = getSubscriptionType()
  return subscriptionType === 'pro' || subscriptionType === 'enterprise'
    ? 'weekly limit'
    : 'Sonnet limit'
}

function getTypedLimitReachedText(
  limits: ClaudeAILimits,
  resetMessage: string,
  model: string,
): string | null {
  const progressSavedSuffix = isProgressSavedHintEnabled()
  switch (limits.rateLimitType) {
    case 'seven_day_sonnet':
      return formatLimitReachedText(
        sonnetOrWeeklyLimitName(),
        resetMessage,
        model,
        { progressSavedSuffix },
      )
    case 'five_hour':
      return formatLimitReachedText('session limit', resetMessage, model, {
        progressSavedSuffix,
      })
    case 'seven_day':
      return formatLimitReachedText('weekly limit', resetMessage, model, {
        progressSavedSuffix,
      })
    case 'seven_day_opus':
      return formatLimitReachedText('Opus limit', resetMessage, model, {
        progressSavedSuffix,
      })
    default:
      return null
  }
}

function getEarlyWarningText(limits: ClaudeAILimits): string | null {
  let limitName: string | null = null
  switch (limits.rateLimitType) {
    case 'seven_day':
      limitName = 'weekly limit'
      break
    case 'five_hour':
      limitName = 'session limit'
      break
    case 'seven_day_opus':
      limitName = 'Opus limit'
      break
    case 'seven_day_sonnet':
      limitName = 'Sonnet limit'
      break
    case 'overage':
      limitName = 'extra usage'
      break
    case undefined:
      return null
  }

  // utilization and resetsAt should be defined since early warning is calculated with them
  const used = limits.utilization
    ? Math.floor(limits.utilization * 100)
    : undefined
  const resetTime = limits.resetsAt
    ? formatResetTime(limits.resetsAt, true)
    : undefined

  // Get upsell command based on subscription type and limit type
  const upsell = getWarningUpsellText(limits.rateLimitType)

  if (used && resetTime) {
    const base = `You've used ${used}% of your ${limitName} · resets ${resetTime}`
    return upsell ? `${base} · ${upsell}` : base
  }

  if (used) {
    const base = `You've used ${used}% of your ${limitName}`
    return upsell ? `${base} · ${upsell}` : base
  }

  if (limits.rateLimitType === 'overage') {
    // For the "Approaching <x>" verbiage, "extra usage limit" makes more sense than "extra usage"
    limitName += ' limit'
  }

  if (resetTime) {
    const base = `Approaching ${limitName} · resets ${resetTime}`
    return upsell ? `${base} · ${upsell}` : base
  }

  const base = `Approaching ${limitName}`
  return upsell ? `${base} · ${upsell}` : base
}

/**
 * Get the upsell command text for warning messages based on subscription and limit type.
 * Returns null if no upsell should be shown.
 * Only used for warnings because actual rate limit hits will see an interactive menu of options.
 */
function getWarningUpsellText(
  rateLimitType: ClaudeAILimits['rateLimitType'],
): string | null {
  const subscriptionType = getSubscriptionType()
  const hasExtraUsageEnabled =
    getOauthAccountInfo()?.hasExtraUsageEnabled === true

  // 5-hour session limit warning
  if (rateLimitType === 'five_hour') {
    // Teams/Enterprise with overages disabled: prompt to request extra usage
    // Only show if Zur() — DN includes marketplace / self-serve / trial
    if (subscriptionType === 'team' || subscriptionType === 'enterprise') {
      if (!hasExtraUsageEnabled && isOverageProvisioningAllowed()) {
        return '/extra-usage to request more'
      }
      // Teams/Enterprise with overages enabled or unsupported billing type don't need upsell
      return null
    }

    // Pro/Max users: prompt to upgrade
    if (subscriptionType === 'pro' || subscriptionType === 'max') {
      return '/upgrade to keep using Claude Code'
    }
  }

  // Overage warning (approaching spending limit)
  if (rateLimitType === 'overage') {
    if (subscriptionType === 'team' || subscriptionType === 'enterprise') {
      if (!hasExtraUsageEnabled && isOverageProvisioningAllowed()) {
        return '/extra-usage to request more'
      }
    }
  }

  // Weekly limit warnings don't show upsell per spec
  return null
}

/**
 * Get notification text for overage mode transitions
 * Used for transient notifications when entering overage mode
 */
export function getUsingOverageText(limits: ClaudeAILimits): string {
  const resetTime = limits.resetsAt
    ? formatResetTime(limits.resetsAt, true)
    : ''

  let limitName = ''
  if (limits.rateLimitType === 'five_hour') {
    limitName = 'session limit'
  } else if (limits.rateLimitType === 'seven_day') {
    limitName = 'weekly limit'
  } else if (limits.rateLimitType === 'seven_day_opus') {
    limitName = 'Opus limit'
  } else if (limits.rateLimitType === 'seven_day_sonnet') {
    const subscriptionType = getSubscriptionType()
    const isProOrEnterprise =
      subscriptionType === 'pro' || subscriptionType === 'enterprise'
    // For pro and enterprise, Sonnet limit is the same as weekly
    limitName = isProOrEnterprise ? 'weekly limit' : 'Sonnet limit'
  }

  if (!limitName) {
    return 'Now using extra usage'
  }

  const resetMessage = resetTime
    ? ` · Your ${limitName} resets ${resetTime}`
    : ''
  return `You're now using extra usage${resetMessage}`
}

function formatLimitReachedText(
  limit: string,
  resetMessage: string,
  _model: string,
  opts?: { progressSavedSuffix?: boolean },
): string {
  // densable uen wb(): o?.progressSavedSuffix ? " · progress saved" : ""
  const progressSaved = opts?.progressSavedSuffix ? ' · progress saved' : ''
  // Enhanced messaging for Ant users
  if (process.env.USER_TYPE === 'ant') {
    return `You've hit your ${limit}${resetMessage}${progressSaved}. If you have feedback about this limit, post in ${FEEDBACK_CHANNEL_ANT}. You can reset your limits with /reset-limits`
  }

  return `You've hit your ${limit}${resetMessage}${progressSaved}`
}
