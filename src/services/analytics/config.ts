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
 * Io(Un()) not locked 1:1; admin-managed origin is the existing 212 contract.
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
 * Check if analytics operations should be disabled
 *
 * Analytics is disabled in the following cases:
 * - Test environment (NODE_ENV === 'test')
 * - Third-party cloud providers (Bedrock/Vertex)
 * - Privacy level is no-telemetry or essential-traffic
 */
export function isAnalyticsDisabled(): boolean {
  // Official USE_* densables — analytics off for 3P cloud providers.
  let useBedrock = isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
  let useVertex = isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
  let useFoundry = isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
  try {
    const {
      isUseBedrockEnvEnabled,
      isUseVertexEnvEnabled,
      isUseFoundryEnvEnabled,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    useBedrock = isUseBedrockEnvEnabled()
    useVertex = isUseVertexEnvEnabled()
    useFoundry = isUseFoundryEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  let managedGateway = false
  try {
    const { getPolicySettingsOrigin, getSettingsForSource } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/settings/settings.js') as typeof import('../../utils/settings/settings.js')
    managedGateway = isManagedGatewayAnalyticsOff(
      getPolicySettingsOrigin(),
      getSettingsForSource('policySettings')?.forceLoginMethod,
    )
  } catch {
    managedGateway = false
  }
  return (
    process.env.NODE_ENV === 'test' ||
    useBedrock ||
    useVertex ||
    useFoundry ||
    isTelemetryDisabled() ||
    isCustomOAuthAnalyticsOff() ||
    managedGateway
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
