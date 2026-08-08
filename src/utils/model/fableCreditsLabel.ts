/**
 * densable 2.1.219 #9 — Fable "Requires usage credits" stale-cache fix.
 *
 * densable symbols:
 * - `P5i = " · Requires usage credits"`
 * - `BUc()` → suffix when plan requires credits entitlement check
 * - `hug(option)` → strip trailing P5i then re-append BUc() for fable rows
 *
 * Bootstrap `additionalModelOptionsCache` can bake the credits suffix into
 * description; without strip/reapply, plans that include Fable keep the stale
 * label after entitlement changes.
 */

import { getRateLimitTier, isClaudeAISubscriber } from '../auth.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isFableModel } from '../fableConsent.js'
import { getAPIProvider } from './providers.js'

/** Minimal option shape — avoid circular import with modelOptions.ts. */
type FableLabelOption = {
  value: string | null
  description: string
  disabled?: boolean
}

/** densable `P5i`. */
export const REQUIRES_USAGE_CREDITS_SUFFIX = ' · Requires usage credits'

export type SaffronLattice = {
  enabled?: boolean
  overageConsentRequired?: boolean
  planLimitsEndDate?: string
}

export type FableCreditsEnv = {
  /** densable `uZ` — true means never show suffix. */
  exempt: boolean
}

/**
 * densable `Y1e` — overage / plan-limits gate from GrowthBook `tengu_saffron_lattice`.
 * True when overage consent is required or planLimitsEndDate has passed.
 */
export function isOverageConsentRequiredGate(
  lattice: SaffronLattice | null | undefined = undefined,
  nowMs: number = Date.now(),
): boolean {
  const resolved =
    lattice !== undefined
      ? lattice
      : getFeatureValue_CACHED_MAY_BE_STALE<SaffronLattice | null>(
          'tengu_saffron_lattice',
          null,
        )
  if (!resolved || typeof resolved !== 'object') return false
  if (resolved.enabled === false) return false
  if (resolved.overageConsentRequired === true) return true
  if (typeof resolved.planLimitsEndDate === 'string') {
    const raw = resolved.planLimitsEndDate
    const t = Date.parse(
      /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
        ? raw
        : raw.includes('T')
          ? `${raw}Z`
          : raw,
    )
    if (!Number.isNaN(t) && nowMs >= t) return true
  }
  return false
}

/**
 * densable `uZ` — plans that do NOT show the credits suffix.
 * true → skip suffix (3P provider, non-subscriber, zero tier).
 * Auth helpers may throw without credentials — treat as exempt.
 */
export function isFableCreditsSuffixExempt(): boolean {
  try {
    if (getAPIProvider() !== 'firstParty') return true
    if (!isClaudeAISubscriber()) return true
    if (getRateLimitTier() === 'default_claude_zero') return true
    return false
  } catch {
    return true
  }
}

/**
 * densable `BUc` — dynamic credits suffix for Fable rows.
 */
export function getFableCreditsSuffix(
  lattice?: SaffronLattice | null,
  nowMs?: number,
  env?: FableCreditsEnv,
): string {
  const exempt = env?.exempt ?? isFableCreditsSuffixExempt()
  if (exempt) return ''
  if (!isOverageConsentRequiredGate(lattice, nowMs)) return ''
  return REQUIRES_USAGE_CREDITS_SUFFIX
}

/**
 * densable `hug` — strip stale P5i then re-apply BUc for fable / fable[1m] options.
 * Non-fable and disabled rows pass through unchanged.
 */
export function applyFableCreditsLabel<T extends FableLabelOption>(
  option: T,
  opts?: {
    lattice?: SaffronLattice | null
    nowMs?: number
    env?: FableCreditsEnv
  },
): T {
  if (option.value === null || typeof option.value !== 'string') {
    return option
  }
  // densable also skips disabled rows.
  if (option.disabled === true) {
    return option
  }
  if (!isFableModel(option.value)) {
    return option
  }
  const stripped = option.description.endsWith(REQUIRES_USAGE_CREDITS_SUFFIX)
    ? option.description.slice(0, -REQUIRES_USAGE_CREDITS_SUFFIX.length)
    : option.description
  const suffix = getFableCreditsSuffix(opts?.lattice, opts?.nowMs, opts?.env)
  return {
    ...option,
    description: `${stripped}${suffix}`,
  }
}
