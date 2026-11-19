import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import {
  isPolicyAllowed,
  isPolicyEnforced,
} from '../../services/policyLimits/index.js'
import { getOauthAccountInfo, getSubscriptionType } from '../auth.js'
import { isFeedbackRefusedByServer } from '../config.js'
import { getAuthHeaders } from '../http.js'
import { isEnvTruthy } from '../envUtils.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../model/providers.js'
import { isEssentialTrafficOnly } from '../privacyLevel.js'
import { isHoverRestOn } from '../storageV5/hoverRestPin.js'
import {
  updateSettingsForSource,
  getSettingsForSource,
} from '../settings/settings.js'
import { SETTING_SOURCES } from '../settings/constants.js'
import {
  FEEDBACK_DRAFTS_DEFAULT,
  FEEDBACK_PROVIDER_LABELS,
  type FeedbackDraftsSetting,
} from './constants.js'

export type FeedbackCommandAvailability =
  | {
      kind: 'disabled'
      reason: string
    }
  | {
      kind: 'bundle'
      cause: 'provider' | 'no_creds'
      label: string
    }
  | { kind: 'post' }

/**
 * densable leftover `zdt("feedbackDrafts")` — high-priority source first.
 */
export function getFeedbackDraftsSettingLayers(): FeedbackDraftsSetting[] {
  const out: FeedbackDraftsSetting[] = []
  for (const source of [...SETTING_SOURCES].reverse()) {
    const value = getSettingsForSource(source)?.feedbackDrafts
    if (value === 'notify' || value === 'quiet' || value === 'off') {
      out.push(value)
    }
  }
  return out
}

/** densable leftover Ffs */
export function getFeedbackDraftsSetting(): FeedbackDraftsSetting {
  return getFeedbackDraftsSettingLayers()[0] ?? FEEDBACK_DRAFTS_DEFAULT
}

/** densable leftover Ns — USER_TYPE ant (local /feedback already gated this). */
function isAntUserType(): boolean {
  return process.env.USER_TYPE === 'ant'
}

/**
 * densable leftover vgr — unique body not in the leftover dump.
 * Leftover-wired as not-blocking so Ufs does not invent an extra disable.
 */
function vgr(): boolean {
  return false
}

function isSendFeedbackEnvDisabled(): boolean {
  const value = process.env.CLAUDE_CODE_SEND_FEEDBACK as
    | string
    | boolean
    | undefined
  return value === false || value === '0' || value === 'false'
}

/** Official 2.1.319 `BNa` (#1729): Anthropic API key format check. */
const ANTHROPIC_API_KEY_RE = /^(sk-ant-|sk-[\w-]{86}$)/

function isLikelyAnthropicApiKey(key: string): boolean {
  return ANTHROPIC_API_KEY_RE.test(key.trim())
}

/**
 * Official 2.1.319 `Jyr()` (#1729): detect whether auth/endpoint indicates a
 * third-party LLM gateway where feedback cannot be sent directly to Anthropic.
 */
export function detectFeedbackGatewayState(): 'gateway' | 'no_creds' | null {
  const isCustomBaseUrl = !isFirstPartyAnthropicBaseUrl()
  let auth: ReturnType<typeof getAuthHeaders>
  try {
    auth = getAuthHeaders()
  } catch {
    return isCustomBaseUrl ? 'gateway' : 'no_creds'
  }
  if (auth.error) {
    return isCustomBaseUrl ? 'gateway' : 'no_creds'
  }
  const apiKey = auth.headers['x-api-key']
  if (apiKey && isCustomBaseUrl && !isLikelyAnthropicApiKey(apiKey)) {
    return 'gateway'
  }
  return null
}

export function getFeedbackRefusalPrincipal(): string | null {
  const oauth = getOauthAccountInfo()
  if (oauth?.organizationUuid) return `org:${oauth.organizationUuid}`
  if (oauth?.accountUuid) return `acct:${oauth.accountUuid}`
  return null
}

/**
 * Official 2.1.323 (#2069): Pro and Max accounts belonging to an organization
 * whose `allow_product_feedback` policy has not been verified as allowed must
 * not be offered feedback drafts that the organization would refuse.
 */
export function isProMaxUnverifiedOrgFeedbackBlocked(): boolean {
  const sub = getSubscriptionType()
  if (sub !== 'pro' && sub !== 'max') return false
  const oauth = getOauthAccountInfo()
  if (!oauth?.organizationUuid) return false
  // If policy limits explicitly enforced allow_product_feedback=true, allow it;
  // otherwise Pro/Max org accounts skip policy fetch at startup and fail closed
  // for automatic feedback drafts so we don't offer drafts the org would refuse.
  return !isPolicyEnforced('allow_product_feedback')
}

/** densable leftover Ufs / `uln` / `yps` (#1728, #1729, #2069) */
export function isSendFeedbackSessionEnabled(): boolean {
  if (getFeedbackCommandDisabledReason() !== null) return false
  if (isAntUserType()) return false
  if (vgr()) return false
  if (getAPIProvider() !== 'firstParty') return false
  if (isSendFeedbackEnvDisabled()) return false
  if (isProMaxUnverifiedOrgFeedbackBlocked()) return false
  return (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_juniper_relay', false) &&
    detectFeedbackGatewayState() !== 'gateway'
  )
}

/** densable leftover aLt */
export function isSendFeedbackEnabled(): boolean {
  return getFeedbackDraftsSetting() !== 'off' && isSendFeedbackSessionEnabled()
}

/**
 * densable leftover `Ht` / `_158` `Ps` in `jr`.
 * Body not peeled. Leftover-wired as not-blocking so `!Ht()` does not invent
 * a disable.
 */
export function isFeedbackCallHt(): boolean {
  return false
}

/** densable leftover Ewc */
export function setFeedbackDraftsSetting(
  value: FeedbackDraftsSetting,
  options: { storageV5?: unknown; via: string },
): { error: Error | null } {
  const result =
    isHoverRestOn() && options.storageV5 !== undefined
      ? updateSettingsForSource(
          'userSettings',
          { feedbackDrafts: value },
          options.storageV5,
        )
      : updateSettingsForSource('userSettings', { feedbackDrafts: value })
  logEvent('tengu_feedback_drafts_setting_changed', {
    value: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    via: options.via as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return result
}

export type FeedbackCommandName = '/feedback' | '/bug' | '/share'

export const FEEDBACK_GITHUB_ISSUES_URL =
  'https://github.com/anthropics/claude-code/issues'
const ORG_POLICY_FEEDBACK_DISABLED_MSG =
  "Feedback submission is disabled by your organization's policy."

/**
 * Official 2.1.302 `BBs` (#929): append GitHub issues guidance unless the org
 * explicitly suppressed it or custom bug-report instructions apply.
 */
export function formatFeedbackWithIssueFallback(
  message: string,
  rawReason?: string,
): string {
  const terminated = /[.!?…]$/.test(message) ? message : `${message}.`
  if (rawReason === ORG_POLICY_FEEDBACK_DISABLED_MSG) {
    return terminated
  }
  return `${terminated} To report a bug, open an issue at ${FEEDBACK_GITHUB_ISSUES_URL}. Issues are public, so leave out anything confidential.`
}

/**
 * densable `TG` — the disabled sentence names the command that was invoked.
 * Default `/feedback` matches `TG()` with no argument.
 */
export function getFeedbackCommandDisabledReason(
  command: FeedbackCommandName = '/feedback',
): string | null {
  if (isEnvTruthy(process.env.DISABLE_FEEDBACK_COMMAND)) {
    return `${command} has been disabled via the DISABLE_FEEDBACK_COMMAND environment variable`
  }
  if (isEnvTruthy(process.env.DISABLE_BUG_COMMAND)) {
    return `${command} has been disabled via the DISABLE_BUG_COMMAND environment variable`
  }
  if (isEssentialTrafficOnly()) {
    return `${command} has been disabled via the CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC environment variable`
  }
  if (
    !isPolicyAllowed('allow_product_feedback') ||
    (getAPIProvider() === 'firstParty' &&
      isFeedbackRefusedByServer(getFeedbackRefusalPrincipal()))
  ) {
    return formatFeedbackWithIssueFallback(
      `${command} is disabled by your organization's policy.`,
    )
  }
  return null
}

/** densable leftover Ps */
export function getFeedbackCommandAvailability(
  command: FeedbackCommandName = '/feedback',
): FeedbackCommandAvailability {
  const disabled = getFeedbackCommandDisabledReason(command)
  if (disabled !== null) {
    return { kind: 'disabled', reason: disabled }
  }
  const provider = getAPIProvider()
  if (provider !== 'firstParty') {
    return {
      kind: 'bundle',
      cause: 'provider',
      label: FEEDBACK_PROVIDER_LABELS[provider] ?? provider,
    }
  }
  if (getAuthHeaders().error) {
    return {
      kind: 'bundle',
      cause: 'no_creds',
      label: 'no Anthropic credentials',
    }
  }
  return { kind: 'post' }
}
