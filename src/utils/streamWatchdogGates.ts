/**
 * Official 2.1.207 stream / byte idle watchdog densables.
 *
 * Two layers:
 * 1. Stream-loop idle watchdog (for-await): CLAUDE_ENABLE_STREAM_WATCHDOG
 *    default ON (`va = env ?? true`); timeout floor IAi ≥ 300_000ms.
 * 2. Byte-body idle watchdog (fetch body): Zgc + k_h provider gate + HAi timeout.
 *    Zgc: ou(BYTE) disable; ct(BYTE) enable; else GB tengu_stream_watchdog_default_on
 *    (default true). k_h requires Zgc && provider eligible && current provider eligible.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

/** Official IAi floor — 5 minutes. */
export const STREAM_IDLE_TIMEOUT_FLOOR_MS = 300_000

/** Official A_h — first-party byte-stream default (3 min). */
export const BYTE_STREAM_IDLE_TIMEOUT_FIRST_PARTY_MS = 180_000

/** Official C_h / w_h clamp for HAi. */
export const BYTE_STREAM_IDLE_TIMEOUT_MIN_MS = 1
export const BYTE_STREAM_IDLE_TIMEOUT_MAX_MS = 1_800_000

/**
 * Official stream-loop enable (va): CLAUDE_ENABLE_STREAM_WATCHDOG default ON.
 * Explicit falsy disables (ou polarity via isEnvDefinedFalsy).
 */
export function isStreamWatchdogEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !isEnvDefinedFalsy(env.CLAUDE_ENABLE_STREAM_WATCHDOG)
}

/**
 * Official IAi — max(env STREAM_IDLE_TIMEOUT_MS, 300_000).
 */
export function resolveStreamIdleTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(env.CLAUDE_STREAM_IDLE_TIMEOUT_MS)
  const parsed = Number.isFinite(n) && n > 0 ? n : 0
  return Math.max(parsed, STREAM_IDLE_TIMEOUT_FLOOR_MS)
}

/**
 * Official Zgc densable — byte-body watchdog master switch.
 * - ou(CLAUDE_ENABLE_BYTE_WATCHDOG) → false
 * - truthy BYTE → true
 * - else GB tengu_stream_watchdog_default_on (default true)
 */
export function isByteWatchdogEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbDefaultOn?: boolean
}): boolean {
  const env = input?.env ?? process.env
  if (isEnvDefinedFalsy(env.CLAUDE_ENABLE_BYTE_WATCHDOG)) return false
  if (isEnvTruthy(env.CLAUDE_ENABLE_BYTE_WATCHDOG)) return true
  if (input?.gbDefaultOn !== undefined) return input.gbDefaultOn
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_stream_watchdog_default_on',
    true,
  )
}

/**
 * Official eyc — firstParty always; anthropicAws only without custom base URL.
 */
export function isByteWatchdogProviderEligible(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (provider === 'firstParty') return true
  if (provider === 'anthropicAws') {
    return !env.ANTHROPIC_AWS_BASE_URL
  }
  return false
}

/**
 * Official tyc — bedrock opt-in via CLAUDE_ENABLE_BYTE_WATCHDOG_BEDROCK.
 */
export function isByteWatchdogBedrockEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_ENABLE_BYTE_WATCHDOG_BEDROCK)
}

/**
 * Official Jgc — provider eligible for body idle watchdog.
 */
export function isByteWatchdogProviderSupported(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isByteWatchdogProviderEligible(provider, env)) return true
  if (provider === 'bedrock') return isByteWatchdogBedrockEnabled(env)
  return false
}

/**
 * Official k_h — body idle watchdog active for this request provider when
 * master switch is on and both request provider and current session provider
 * are supported.
 */
export function shouldEnableBodyIdleWatchdog(input: {
  requestProvider: string
  currentProvider: string
  env?: NodeJS.ProcessEnv
  gbDefaultOn?: boolean
}): boolean {
  if (
    !isByteWatchdogEnabled({
      env: input.env,
      gbDefaultOn: input.gbDefaultOn,
    })
  ) {
    return false
  }
  const env = input.env ?? process.env
  return (
    isByteWatchdogProviderSupported(input.requestProvider, env) &&
    isByteWatchdogProviderSupported(input.currentProvider, env)
  )
}

/**
 * Official HAi — resolve byte-stream idle timeout ms for a provider.
 *
 * Priority:
 * 1. CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS if finite > 0
 * 2. else if STREAM_IDLE was not explicitly set: firstParty default 180s
 *    (or stream floor for others), overridden by GB tengu_byte_stream_idle_timeout_ms
 * 3. else stream idle floor (IAi)
 * Clamped to [1, 1_800_000].
 */
export function resolveByteStreamIdleTimeoutMs(input: {
  provider: string
  env?: NodeJS.ProcessEnv
  gbTimeoutMs?: number | null
}): number {
  const env = input.env ?? process.env
  const streamFloor = resolveStreamIdleTimeoutMs(env)
  const firstPartyDefault =
    input.provider === 'firstParty'
      ? BYTE_STREAM_IDLE_TIMEOUT_FIRST_PARTY_MS
      : streamFloor

  let chosen = streamFloor
  const byteRaw = Number(env.CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS)
  const streamExplicit = Number(env.CLAUDE_STREAM_IDLE_TIMEOUT_MS) > 0

  if (Number.isFinite(byteRaw) && byteRaw > 0) {
    chosen = byteRaw
  } else if (!streamExplicit) {
    chosen = firstPartyDefault
    const gb =
      input.gbTimeoutMs !== undefined
        ? input.gbTimeoutMs
        : getFeatureValue_CACHED_MAY_BE_STALE<number | null>(
            'tengu_byte_stream_idle_timeout_ms',
            firstPartyDefault,
          )
    if (typeof gb === 'number' && Number.isFinite(gb) && gb > 0) {
      chosen = gb
    }
  }

  return Math.min(
    Math.max(chosen, BYTE_STREAM_IDLE_TIMEOUT_MIN_MS),
    BYTE_STREAM_IDLE_TIMEOUT_MAX_MS,
  )
}
