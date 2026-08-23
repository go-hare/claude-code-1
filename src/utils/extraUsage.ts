/**
 * densable 2.1.238 `KSl(e,t,r)` — extra-usage / credits billing probe.
 *
 * Gold:
 *   if (!gs()) return false
 *   n = e!==null ? Ss(e) : CE()
 *   o = n.toLowerCase()
 *   i = o.includes("opus") || o.includes("fable")
 *   s = o.includes("opus-4-6")
 *   a = o.includes("sonnet-4-6")
 *   if (t && DA(e)) return true
 *   if ((o.includes("fable") || Vpe(n)) && !sSe() && (amt() || BXe())) return true
 *   if (!kE(o)) return false
 *   if (i && r) return false
 *   return s || a
 *
 * CLI-absent gold callees fail closed (not invented):
 *   MHs() host `accountCreditLatches.fableCreditsRequired` → false
 *   zpt() `seatTier==="enterprise_usage_based"` → false (no seatTier in CLI)
 */
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  getRateLimitTier,
  getSubscriptionType,
  isClaudeAISubscriber,
} from './auth.js'
import { is1mContextDisabled } from './context.js'
import { isEnvTruthy } from './envUtils.js'
import { isOverageConsentRequiredGate } from './model/fableCreditsLabel.js'
import {
  getDefaultMainLoopModelSetting,
  getUserSpecifiedModelSetting,
  isOpus1mMergeEnabled,
  parseUserSpecifiedModel,
  type ModelSetting,
} from './model/model.js'
import { modelHasCatalogCapability } from './model/modelCatalogCapabilities.js'
import { getAPIProvider } from './model/providers.js'

/** densable ASm / qjt billing fragment. */
export const DRAWS_FROM_USAGE_CREDITS_SUFFIX = ' · Draws from usage credits'

/**
 * Optional test bag — production callers omit this and hit live gold helpers.
 * Keys map 1:1 onto KSl callees, not a parallel billing policy.
 */
export type DrawsFromUsageCreditsEnv = {
  subscriber?: boolean
  /** densable `DA(e)` result. */
  fastModeSupported?: boolean
  /** densable `l3()` / 3rd arg. */
  opus1mMerged?: boolean
  /** densable `Gpe()` + skip `[1m]` regex. */
  disable1m?: boolean
  /** densable `ANTHROPIC_DEFAULT_FABLE_MODEL` for `Vpe`. */
  defaultFableModel?: string
  /** densable `sSe()`. */
  creditsExempt?: boolean
  /** densable `amt() || BXe()`. */
  fableCreditsRequired?: boolean
  /** Skip `Ss`/`CE` and use this resolved id. */
  resolved?: string
}

function stripTrailing1m(value: string): string {
  return value.replace(/\[1m\]$/i, '')
}

/** densable `Ss(e)` / `CE()` for the KSl model arm. */
export function resolveKSlModel(model: string | null): string {
  const source: ModelSetting | undefined =
    model !== null
      ? model
      : (getUserSpecifiedModelSetting() ?? getDefaultMainLoopModelSetting())
  if (source === null || source === undefined) return ''
  return parseUserSpecifiedModel(source)
}

/**
 * densable `DA(e)` — fast-mode supported for the credits short-circuit.
 * `qu()` (firstParty && !DISABLE_FAST_MODE) then catalog `fast_mode` or
 * opus-4-8 / opus-5. Does **not** import `fastMode.ts` (cycle).
 */
export function isKSlFastModeSupported(model: string | null): boolean {
  if (getAPIProvider() !== 'firstParty') return false
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FAST_MODE)) return false
  const resolved = resolveKSlModel(model)
  if (modelHasCatalogCapability(resolved, 'fast_mode') === true) return true
  const n = resolved.toLowerCase()
  return n.includes('opus-4-8') || n.includes('opus-5')
}

/** densable `sSe()` minus `zpt()` (no CLI seatTier). */
export function isKSlCreditsExemptPlan(): boolean {
  if (getAPIProvider() !== 'firstParty') return true
  if (!isClaudeAISubscriber()) return true
  if (getRateLimitTier() === 'default_claude_zero') return true
  return false
}

/**
 * densable `amt() || BXe()`.
 * `amt` = `KLe()` (`tengu_saffron_lattice`) || `MHs()` (absent → false).
 * `BXe` = enterprise (KKb, zpt false) or subscriptionType ∈ GB
 * `tengu_saffron_credits_only_tiers` default `["enterprise"]`.
 */
export function isKSlFableCreditsRequired(): boolean {
  if (isOverageConsentRequiredGate()) return true
  const sub = getSubscriptionType()
  if (sub === 'enterprise') return true
  if (sub === null) return false
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_saffron_credits_only_tiers',
    ['enterprise'],
  )
  const tiers = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string')
    : ['enterprise']
  return tiers.includes(sub)
}

/** densable `Vpe(n)` — default fable env matches resolved (strip trailing `[1m]`). */
export function isKSlDefaultFableEnv(
  resolved: string,
  envValue: string | undefined = process.env.ANTHROPIC_DEFAULT_FABLE_MODEL,
): boolean {
  if (!envValue) return false
  return stripTrailing1m(resolved) === stripTrailing1m(envValue)
}

/**
 * densable `KSl(e, t, r)`.
 * `r` defaults to live `l3()` ≈ `isOpus1mMergeEnabled()`.
 */
export function drawsFromUsageCredits(
  model: string | null,
  isFastMode: boolean,
  isOpus1mMerged?: boolean,
  env?: DrawsFromUsageCreditsEnv,
): boolean {
  const subscriber = env?.subscriber ?? isClaudeAISubscriber()
  if (!subscriber) return false

  const resolved = env?.resolved ?? resolveKSlModel(model)
  const o = resolved.toLowerCase()
  const isOpusOrFable = o.includes('opus') || o.includes('fable')
  const isOpus46 = o.includes('opus-4-6')
  const isSonnet46 = o.includes('sonnet-4-6')

  const fastSupported = env?.fastModeSupported ?? isKSlFastModeSupported(model)
  if (isFastMode && fastSupported) return true

  const defaultFable = isKSlDefaultFableEnv(
    resolved,
    env?.defaultFableModel ?? process.env.ANTHROPIC_DEFAULT_FABLE_MODEL,
  )
  const exempt = env?.creditsExempt ?? isKSlCreditsExemptPlan()
  const fableRequired = env?.fableCreditsRequired ?? isKSlFableCreditsRequired()
  if ((o.includes('fable') || defaultFable) && !exempt && fableRequired) {
    return true
  }

  const disable1m = env?.disable1m ?? is1mContextDisabled()
  if (disable1m || !/\[1m\]/i.test(o)) return false

  const merged = env?.opus1mMerged ?? isOpus1mMerged ?? isOpus1mMergeEnabled()
  if (isOpusOrFable && merged) return false
  return isOpus46 || isSonnet46
}

/** Back-compat alias — same 3-arg contract as pre-238 callers. */
export function isBilledAsExtraUsage(
  model: string | null,
  isFastMode: boolean,
  isOpus1mMerged: boolean,
): boolean {
  return drawsFromUsageCredits(model, isFastMode, isOpus1mMerged)
}
