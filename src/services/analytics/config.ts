/**
 * Shared analytics configuration
 *
 * Common logic for determining when analytics should be disabled
 * across all analytics systems (Datadog, 1P)
 */

import { isEnvTruthy } from '../../utils/envUtils.js'
import { isTelemetryDisabled } from '../../utils/privacyLevel.js'
import { isFeedbackSurveyForOtelEnabled } from '../../utils/residualFinalEnvGates.js'

/**
 * densable 2.1.247 IP — custom OAuth URL forces analytics off from startup.
 */
export function isCustomOAuthAnalyticsOff(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.CLAUDE_CODE_CUSTOM_OAUTH_URL !== undefined
}

/**
 * densable 2.1.247 Gd — managed settings forceLoginMethod==="gateway".
 * 2.1.251 `Kh` does not call this. Analytics use `gatewayAuth()` instead.
 */
export function isManagedGatewayAnalyticsOff(
  origin:
    | ReturnType<
        typeof import('../../utils/settings/settings.js').getPolicySettingsOrigin
      >
    | 'helper'
    | null,
  forceLoginMethod: string | undefined,
): boolean {
  // densable h5t — do not import forceLoginMethod (analytics cycle).
  const adminManaged =
    origin === 'helper' ||
    origin === 'plist' ||
    origin === 'hklm' ||
    origin === 'file'
  return adminManaged && forceLoginMethod === 'gateway'
}

/**
 * Official pOt() + s6e() / M8e() @278147475 / @278147630:
 * True when running as a gateway server process or when managed/initial policy
 * requires Cloud gateway login (and no 3P provider env var overrides it).
 */
export function isGatewayPolicyOrServerProcess(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isEnvTruthy(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)) return false
  try {
    const { getBootstrapSessionHost } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/sessionRoot.js') as typeof import('../../utils/sessionRoot.js')
    if (getBootstrapSessionHost().credentialSlots.gatewayServerProcess()) {
      return true
    }
  } catch {
    // ignore bootstrap cycle during early test load
  }
  const hasThirdPartyEnv = Boolean(
    env.CLAUDE_CODE_USE_BEDROCK ||
      env.CLAUDE_CODE_USE_FOUNDRY ||
      env.CLAUDE_CODE_USE_ANTHROPIC_AWS ||
      env.CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD ||
      env.CLAUDE_CODE_USE_MANTLE ||
      env.CLAUDE_CODE_USE_VERTEX,
  )
  if (hasThirdPartyEnv) return false
  try {
    const { getInitialSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/settings/settings.js') as typeof import('../../utils/settings/settings.js')
    const settings = getInitialSettings()
    return (
      settings?.forceLoginMethod === 'gateway' ||
      settings?.forceLoginGatewayUrl !== undefined
    )
  } catch {
    return false
  }
}

/**
 * densable Zq — non-firstParty analytics off unless the host owns routing.
 * firstParty stays on. Do not list a fourth cloud here; Zq is !dr().
 */
export function isNonFirstPartyAnalyticsOff(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isEnvTruthy(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)) return false
  if (isGatewayPolicyOrServerProcess(env)) return true
  try {
    const { getAPIProvider } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/model/providers.js') as typeof import('../../utils/model/providers.js')
    return getAPIProvider() !== 'firstParty'
  } catch {
    return false
  }
}

/**
 * densable Kh: Zq() || gi()!==null || bW() || e2().
 * Gold Zq has no NODE_ENV==='test' arm — bun test still reaches later gates.
 */
export function isAnalyticsDisabled(): boolean {
  // densable gi() !== null — the credential slot, not the managed login pin.
  let gatewayAuthSet = false
  try {
    const { getGatewayAuth } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/gatewayEnv.js') as typeof import('../../utils/gatewayEnv.js')
    gatewayAuthSet = getGatewayAuth() != null
  } catch {
    gatewayAuthSet = false
  }
  return (
    isNonFirstPartyAnalyticsOff() ||
    isTelemetryDisabled() ||
    isCustomOAuthAnalyticsOff() ||
    gatewayAuthSet
  )
}

/**
 * Official WW / IIe — suppress feedback survey under telemetry privacy
 * unless CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL is set (enterprise
 * OTEL capture path). Unlike isAnalyticsDisabled(), this does NOT block
 * on 3P providers (Bedrock/Vertex/Foundry). NODE_ENV=test still suppresses.
 */
export function isFeedbackSurveyDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV === 'test') return true
  // Official IIe: force survey not-disabled by telemetry when set.
  if (isFeedbackSurveyForOtelEnabled(env)) return false
  return isTelemetryDisabled()
}
