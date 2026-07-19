/**
 * densable bqr / nXi residual — precompute compaction gates.
 *
 * densable:
 *   bqr() = Yk() auto-compact on
 *         && zge() remote reactive ok
 *         && et("tengu_sepia_moth", false)
 *         && xc("precomputeCompactionEnabled", true).value
 *   nXi() = et("tengu_amber_packet", false) && !B2()
 *
 * Full precompute pipeline (Tvu/fvu sidecar) remains denser; these are the
 * pure / portable gate helpers + setting default.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getGlobalConfig } from './config.js'
import { isEnvTruthy } from './envUtils.js'

/** densable tengu_sepia_moth (default false) — surfaces precompute setting. */
export function isSepiaMothEnabled(
  input: { gbValue?: boolean } = {},
): boolean {
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_sepia_moth', false)
}

/**
 * densable nXi — amber_packet on AND session persistence not skipped.
 *
 * densable B2 is a compound skip (test env, AZ, SKIP_PROMPT_HISTORY, USt).
 * Callers pass skipSessionPersistence when those branches are already known.
 */
export function isAmberPacketEnabled(
  input: {
    gbValue?: boolean
    /** densable !B2 — when true, nXi is false. */
    skipSessionPersistence?: boolean
  } = {},
): boolean {
  if (input.skipSessionPersistence === true) return false
  const gb =
    input.gbValue !== undefined
      ? input.gbValue
      : getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_packet', false)
  return gb === true
}

/**
 * densable zge remote branch — CLAUDE_CODE_REMOTE requires
 * tengu_reactive_compact_remote (default false); local always ok.
 */
export function isReactiveCompactRemoteOk(
  env: NodeJS.ProcessEnv = process.env,
  remoteGb?: boolean,
): boolean {
  if (!isEnvTruthy(env.CLAUDE_CODE_REMOTE)) return true
  if (remoteGb !== undefined) return remoteGb
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_reactive_compact_remote',
    false,
  )
}

/**
 * densable bqr pure — precompute compaction may run.
 *
 * Defaults: precompute setting true when unset (matches densable xc default).
 */
export function isPrecomputeCompactionEnabled(input: {
  autoCompactEnabled: boolean
  remoteOk?: boolean
  sepiaMoth?: boolean
  /** User setting; undefined → default true. */
  precomputeCompactionEnabled?: boolean | null
  env?: NodeJS.ProcessEnv
}): boolean {
  if (!input.autoCompactEnabled) return false
  const env = input.env ?? process.env
  const remoteOk =
    input.remoteOk !== undefined
      ? input.remoteOk
      : isReactiveCompactRemoteOk(env)
  if (!remoteOk) return false
  const sepia =
    input.sepiaMoth !== undefined ? input.sepiaMoth : isSepiaMothEnabled()
  if (!sepia) return false
  if (input.precomputeCompactionEnabled === false) return false
  // undefined / null / true → on (densable xc default true)
  return true
}

/**
 * Live reader: autoCompact + global precompute setting + GB sepia_moth.
 * Does not resolve skip-session-persistence (B2) — that is amber_packet only.
 */
export function isPrecomputeCompactionEnabledLive(): boolean {
  const cfg = getGlobalConfig()
  return isPrecomputeCompactionEnabled({
    autoCompactEnabled: cfg.autoCompactEnabled !== false,
    precomputeCompactionEnabled: cfg.precomputeCompactionEnabled,
  })
}
