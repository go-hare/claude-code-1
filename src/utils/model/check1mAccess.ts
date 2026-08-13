import type { OverageDisabledReason } from 'src/services/claudeAiLimits.js'
import { isClaudeAISubscriber } from '../auth.js'
import { getGlobalConfig } from '../config.js'
import { is1mContextDisabled } from '../context.js'
import { isFirstPartyAnthropicBaseUrl } from './providers.js'

/**
 * Check if extra usage is enabled based on the cached disabled reason.
 * Extra usage is considered enabled if there's no disabled reason,
 * or if the disabled reason indicates it's provisioned but temporarily unavailable.
 */
function isExtraUsageEnabled(): boolean {
  const reason = getGlobalConfig().cachedExtraUsageDisabledReason
  // undefined = no cache yet, treat as not enabled (conservative)
  if (reason === undefined) {
    return false
  }
  // null = no disabled reason from API, extra usage is enabled
  if (reason === null) {
    return true
  }
  // Check which disabled reasons still mean "provisioned"
  switch (reason as OverageDisabledReason) {
    // Provisioned but credits depleted — still counts as enabled
    case 'out_of_credits':
      return true
    // Not provisioned or actively disabled
    case 'overage_not_provisioned':
    case 'org_level_disabled':
    case 'org_level_disabled_until':
    case 'seat_tier_level_disabled':
    case 'member_level_disabled':
    case 'seat_tier_zero_credit_limit':
    case 'group_zero_credit_limit':
    case 'member_zero_credit_limit':
    case 'org_service_level_disabled':
    case 'org_service_zero_credit_limit':
    case 'no_limits_configured':
    case 'unknown':
      return false
    default:
      return false
  }
}

/**
 * densable 2.1.229 RAu — subscriber on first-party Anthropic path (or unix socket).
 * Custom ANTHROPIC_BASE_URL gateways are NOT first-party: they must not require
 * claude.ai extra-usage for Sonnet/Opus 1M (fixes /model reject bug).
 */
export function isFirstPartySubscriberFor1mAccess(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isClaudeAISubscriber() &&
    (!!env.ANTHROPIC_UNIX_SOCKET || isFirstPartyAnthropicBaseUrl(env))
  )
}

// @[MODEL LAUNCH]: Add check if the new model supports 1M context
/** densable Hte — Opus 1M access */
export function checkOpus1mAccess(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (is1mContextDisabled()) {
    return false
  }

  // densable RAu → kAu (extra usage); else allow (PAYG / custom gateway)
  if (isFirstPartySubscriberFor1mAccess(env)) {
    return isExtraUsageEnabled()
  }

  return true
}

/** densable ufe — Sonnet 1M access */
export function checkSonnet1mAccess(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (is1mContextDisabled()) {
    return false
  }

  if (isFirstPartySubscriberFor1mAccess(env)) {
    return isExtraUsageEnabled()
  }

  return true
}
