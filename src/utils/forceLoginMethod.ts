/**
 * densable 2.1.212 #43 — Enterprise forceLoginMethod expansion.
 *
 * densable symbols:
 * - A9t ≈ resolveEffectiveForceLoginMethod
 * - Stt ≈ validateForcedLoginMethod (claudeai/console pin + gateway reject off-interactive)
 * - h5t ≈ isAdminManagedPolicyOrigin (helper|plist|hklm|file)
 * - _ae ≈ getSettingSourceForKey (highest-priority source that defines a key)
 *
 * Gateway interactive OIDC device flow (gateway_setup UI) is a separate surface;
 * this module covers schema + multi-surface enforcement used by setup-token,
 * install-github-app, SDK claude_authenticate, and CLI auth login.
 */

import { isHostManagedProviderAuth } from './aws.js'
import { logEvent } from '../services/analytics/index.js'
import {
  getEnabledSettingSources,
  type SettingSource,
} from './settings/constants.js'
import {
  getInitialSettings,
  getPolicySettingsOrigin,
  getSettingsForSource,
} from './settings/settings.js'
import type { SettingsJson } from './settings/types.js'

export type ForceLoginMethod = 'claudeai' | 'console' | 'gateway'

export type ForceLoginValidationResult =
  | { valid: true }
  | { valid: false; message: string }

/**
 * densable h5t — admin-managed policy origins that may pin forceLoginMethod
 * to "gateway" (user/hkcu alone cannot force gateway).
 */
export function isAdminManagedPolicyOrigin(
  origin: ReturnType<typeof getPolicySettingsOrigin> | 'helper' | null,
): boolean {
  return (
    origin === 'helper' ||
    origin === 'plist' ||
    origin === 'hklm' ||
    origin === 'file'
  )
}

/**
 * densable _ae — highest-priority enabled source that defines `key`.
 * Walks getEnabledSettingSources() high→low (array is low→high merge order).
 */
export function getSettingSourceForKey(
  key: keyof SettingsJson,
): SettingSource | null {
  const sources = getEnabledSettingSources()
  for (let i = sources.length - 1; i >= 0; i--) {
    const source = sources[i]!
    const settings = getSettingsForSource(source)
    if (settings && settings[key] !== undefined) {
      return source
    }
  }
  return null
}

/**
 * densable A9t — effective forceLoginMethod for non-interactive enforcement.
 *
 * - Admin-managed policy with forceLoginMethod:"gateway" → "gateway"
 * - Merged settings forceLoginMethod "gateway" without admin origin → stripped
 *   (void 0) so user-tier cannot pin gateway
 * - Otherwise returns claudeai | console | undefined
 */
export function resolveEffectiveForceLoginMethod():
  | ForceLoginMethod
  | undefined {
  const origin = getPolicySettingsOrigin()
  const policy = getSettingsForSource('policySettings')
  if (
    isAdminManagedPolicyOrigin(origin) &&
    policy?.forceLoginMethod === 'gateway'
  ) {
    return 'gateway'
  }
  const method = getInitialSettings().forceLoginMethod
  if (method === 'gateway') {
    return undefined
  }
  if (method === 'claudeai' || method === 'console') {
    return method
  }
  return undefined
}

/**
 * densable Stt(loginWithClaudeAi) — validate a requested login method against
 * enterprise forceLoginMethod pin.
 *
 * @param loginWithClaudeAi true → claude.ai / subscription path (setup-token,
 *   install-github-app always pass true); false → Console billing.
 */
export function validateForcedLoginMethod(
  loginWithClaudeAi: boolean,
): ForceLoginValidationResult {
  // densable: host-managed provider skips method pin (desktop injects creds)
  if (isHostManagedProviderAuth()) {
    if (resolveEffectiveForceLoginMethod() !== undefined) {
      logEvent('tengu_auth_force_login_org', {
        reason: 'managed_by_host_under_method_pin' as never,
      })
    }
    return { valid: true }
  }

  const forced = resolveEffectiveForceLoginMethod()
  if (forced === undefined) {
    return { valid: true }
  }

  if (forced === 'gateway') {
    return {
      valid: false,
      message:
        "forceLoginMethod is 'gateway' in managed settings; run /login from an interactive terminal to authenticate.",
    }
  }

  if (loginWithClaudeAi === (forced === 'claudeai')) {
    return { valid: true }
  }

  const source = getSettingSourceForKey('forceLoginMethod')
  const where = source === 'policySettings' ? 'managed settings' : 'settings'
  return {
    valid: false,
    message:
      forced === 'claudeai'
        ? `forceLoginMethod is 'claudeai' in ${where}; log in with a Claude.ai subscription account instead.`
        : `forceLoginMethod is 'console' in ${where}; log in with an Anthropic Console account instead.`,
  }
}

/**
 * densable authLogin gateway reject copy (CLI non-interactive path).
 */
export const FORCE_LOGIN_GATEWAY_CLI_MESSAGE =
  "forceLoginMethod is 'gateway' in managed settings; run interactive /login to authenticate."

/**
 * densable setup-token refusal suffix after Stt message.
 */
export const SETUP_TOKEN_FORCE_LOGIN_REFUSED_SUFFIX =
  'setup-token creates a long-lived Claude.ai subscription token, which this policy does not permit.'

/**
 * densable install-github-app OAuth refusal suffix after Stt message.
 */
export const INSTALL_GITHUB_APP_FORCE_LOGIN_REFUSED_SUFFIX =
  'This step creates a long-lived Claude.ai subscription token, which this policy does not permit — use an API key instead.'

/**
 * densable ConsoleOAuthFlow forceLoginMethod resolution for interactive UI.
 *
 * Admin gateway pin + forceLoginGatewayUrl only when origin is admin-managed.
 * Non-admin merged "gateway" is stripped (same as A9t).
 */
export function resolveInteractiveForceLoginMethod(
  forceLoginMethodProp?: ForceLoginMethod,
): {
  forceLoginMethod: ForceLoginMethod | undefined
  forceLoginGatewayUrl: string | undefined
  gatewayForced: boolean
} {
  const origin = getPolicySettingsOrigin()
  const policy = getSettingsForSource('policySettings')
  const adminGateway =
    isAdminManagedPolicyOrigin(origin) && policy?.forceLoginMethod === 'gateway'
  const forceLoginGatewayUrl = adminGateway
    ? policy?.forceLoginGatewayUrl
    : undefined

  const settings = getInitialSettings()
  const fromSettings: ForceLoginMethod | undefined =
    settings.forceLoginMethod === 'gateway' && !adminGateway
      ? undefined
      : settings.forceLoginMethod === 'claudeai' ||
          settings.forceLoginMethod === 'console' ||
          settings.forceLoginMethod === 'gateway'
        ? settings.forceLoginMethod
        : undefined

  const forceLoginMethod = forceLoginMethodProp ?? fromSettings
  const gatewayForced =
    forceLoginMethod === 'gateway' || forceLoginGatewayUrl !== undefined

  return { forceLoginMethod, forceLoginGatewayUrl, gatewayForced }
}
