import { isEnvTruthy } from './envUtils.js'

/**
 * Privacy level controls how much nonessential network traffic and telemetry
 * Claude Code generates.
 *
 * Levels are ordered by restrictiveness:
 *   default < no-telemetry < essential-traffic
 *
 * - default:            Everything enabled.
 * - no-telemetry:       Analytics/telemetry disabled (Datadog, 1P events, feedback survey).
 * - essential-traffic:  ALL nonessential network traffic disabled
 *                       (telemetry + auto-updates, grove, release notes, model capabilities, etc.).
 *
 * The resolved level is densable 2.1.289 `Ivt` / `Wlr` (truthy env string,
 * not isEnvDefinedFalsy):
 *   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC set  →  essential-traffic
 *   DISABLE_TELEMETRY set (any non-empty string, including "0")  →  no-telemetry
 *   DO_NOT_TRACK truthy (`Le`)                    →  no-telemetry
 *   unset                                         →  default (telemetry on)
 *
 * Pipeline bodies stay. Never invent isAnthropicTelemetrySendEnabled.
 */

type PrivacyLevel = 'default' | 'no-telemetry' | 'essential-traffic'

export function getPrivacyLevel(): PrivacyLevel {
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) {
    return 'essential-traffic'
  }
  // densable Ivt: any non-empty DISABLE_TELEMETRY, including "0".
  if (process.env.DISABLE_TELEMETRY) {
    return 'no-telemetry'
  }
  // densable Le(DO_NOT_TRACK)
  if (isEnvTruthy(process.env.DO_NOT_TRACK)) {
    return 'no-telemetry'
  }
  return 'default'
}

/**
 * True when all nonessential network traffic should be suppressed.
 * Equivalent to the old `process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` check.
 */
export function isEssentialTrafficOnly(): boolean {
  return getPrivacyLevel() === 'essential-traffic'
}

/**
 * True when telemetry/analytics should be suppressed.
 * True at both `no-telemetry` and `essential-traffic` levels.
 */
export function isTelemetryDisabled(): boolean {
  return getPrivacyLevel() !== 'default'
}

/**
 * Returns the env var name responsible for the current essential-traffic restriction,
 * or null if unrestricted. Used for user-facing "unset X to re-enable" messages.
 */
export function getEssentialTrafficOnlyReason(): string | null {
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) {
    return 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'
  }
  return null
}

/**
 * densable IOo — env var responsible for any non-default privacy level, or null.
 * Covers essential-traffic and no-telemetry (DISABLE_TELEMETRY / DO_NOT_TRACK).
 */
export function getPrivacyDisableReason(): string | null {
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) {
    return 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'
  }
  if (process.env.DISABLE_TELEMETRY) {
    return 'DISABLE_TELEMETRY'
  }
  if (isEnvTruthy(process.env.DO_NOT_TRACK)) {
    return 'DO_NOT_TRACK'
  }
  return null
}
