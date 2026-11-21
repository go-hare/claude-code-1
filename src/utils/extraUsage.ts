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
 *   zpt() `seatTier==="enterprise_usage_based"` → false (no seatTier in CLI)
 *   tEn()/MHs host latch via n().host.accountCreditLatches.fableCreditsRequired()
 */
import {
  type FeatureValueSource,
  getFeatureValue_CACHED_MAY_BE_STALE,
  getFeatureValueWithSource,
} from '../services/analytics/growthbook.js'
import {
  getRateLimitTier,
  getSubscriptionType,
  isClaudeAISubscriber,
} from './auth.js'
import { is1mContextDisabled } from './context.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getDefaultMainLoopModelSetting,
  getUserSpecifiedModelSetting,
  isOpus1mMergeEnabled,
  parseUserSpecifiedModel,
  type ModelSetting,
} from './model/model.js'
import { modelHasCatalogCapability } from './model/modelCatalogCapabilities.js'
import { getAPIProvider } from './model/providers.js'
import { getBootstrapSessionHost } from './sessionHost.js'

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

type ParsedSaffronLattice = {
  enabled?: boolean
  overageConsentRequired?: boolean
  planLimitsEndDate?: string
  billsFrom?: string
  perModel?: Map<string, { enabled: boolean }>
}

function canonicalSaffronModelKey(model: string): string {
  return stripTrailing1m(model.trim().toLowerCase()).replace(/-\d{8}$/, '')
}

function parsePerModelLattice(
  raw: unknown,
): Map<string, { enabled: boolean }> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const map = new Map<string, { enabled: boolean }>()
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (
      !val ||
      typeof val !== 'object' ||
      typeof (val as { enabled?: unknown }).enabled !== 'boolean'
    ) {
      continue
    }
    const enabled = (val as { enabled: boolean }).enabled
    const canonical = canonicalSaffronModelKey(key)
    const existing = map.get(canonical)
    if (existing !== undefined && existing.enabled !== enabled) {
      map.set(canonical, { enabled: true })
      continue
    }
    map.set(canonical, { enabled })
  }
  return map.size > 0 ? map : undefined
}

function parseSaffronLattice(raw: unknown): ParsedSaffronLattice {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const obj = raw as Record<string, unknown>
  return {
    ...(typeof obj.enabled === 'boolean' ? { enabled: obj.enabled } : {}),
    ...(typeof obj.overageConsentRequired === 'boolean'
      ? { overageConsentRequired: obj.overageConsentRequired }
      : {}),
    ...(typeof obj.planLimitsEndDate === 'string'
      ? { planLimitsEndDate: obj.planLimitsEndDate }
      : {}),
    ...(typeof obj.billsFrom === 'string' ? { billsFrom: obj.billsFrom } : {}),
    perModel: parsePerModelLattice(obj.perModel),
  }
}

function getParsedSaffronLattice(): ParsedSaffronLattice {
  return parseSaffronLattice(
    getFeatureValue_CACHED_MAY_BE_STALE<unknown>('tengu_saffron_lattice', {}),
  )
}

function getPerModelEntry(
  lattice: ParsedSaffronLattice,
  model: string | undefined,
): { enabled: boolean } | undefined {
  if (lattice.perModel === undefined || model === undefined) {
    return undefined
  }
  return lattice.perModel.get(canonicalSaffronModelKey(model))
}

/** Official `Ff(e)` (chunk@289476641.js @185400) — lattice billing gate. */
function isSaffronLatticeBilled(
  model: string | undefined,
  lattice: ParsedSaffronLattice = getParsedSaffronLattice(),
): boolean {
  const perModel = getPerModelEntry(lattice, model)
  if (perModel !== undefined) {
    return perModel.enabled
  }
  if (lattice.enabled === false) {
    return false
  }
  return (
    lattice.overageConsentRequired === true ||
    lattice.planLimitsEndDate !== undefined
  )
}

/** Official `Ep(source)` — whether a GrowthBook source is authoritative (not stale disk). */
function isAuthoritativeGrowthBookSource(source: FeatureValueSource): boolean {
  return source === 'payload' || source === 'override' || source === 'disabled'
}

/** Official `sci(e)` — true when server-evaluated `tengu_saffron_lattice` explicitly disables billing. */
function isSaffronLatticeExplicitlyDisabled(
  model: string | undefined,
): boolean {
  const { value, source } = getFeatureValueWithSource<unknown>(
    'tengu_saffron_lattice',
    {},
  )
  if (!isAuthoritativeGrowthBookSource(source)) {
    return false
  }
  const lattice = parseSaffronLattice(value)
  const perModel = getPerModelEntry(lattice, model)
  if (perModel !== undefined) {
    return !perModel.enabled
  }
  return lattice.enabled === false
}

/** Official `oS()` — Max plan or Team max_5x tier. */
function isMaxOrTeam5xPlan(): boolean {
  const sub = getSubscriptionType()
  return (
    sub === 'max' ||
    (sub === 'team' && getRateLimitTier() === 'default_claude_max_5x')
  )
}

/** Official `nQr()` — Pro plan or non-max_5x Team tier. */
function isProOrStandardTeamPlan(): boolean {
  const sub = getSubscriptionType()
  if (sub === 'team') {
    const tier = getRateLimitTier()
    return tier !== null && tier !== 'default_claude_max_5x'
  }
  return sub === 'pro'
}

/** Official `Aor()` (chunk@289476641.js @186547). */
function isHazyHorizonEnabled(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
      'tengu_hazy_horizon',
      false,
    ) === true
  )
}

/**
 * Official `fW()` (chunk@289476641.js @186547): checks `tengu_magical_clock`
 * entrypoint allowlist + non-enterprise + `tengu_hazy_horizon`.
 */
export function isMagicalClockActive(): boolean {
  const clock = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_magical_clock',
    null,
  )
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT || 'cli'
  return (
    Array.isArray(clock) &&
    clock.includes(entrypoint) &&
    getSubscriptionType() !== 'enterprise' &&
    isHazyHorizonEnabled()
  )
}

/** Official `RFe(e)` (chunk@289476641.js @185600). */
function isSaffronCreditsRequiredForModel(
  model: string | undefined,
  nowMs: number = Date.now(),
): boolean {
  const lattice = getParsedSaffronLattice()
  const baseBilled = isSaffronLatticeBilled(model, lattice)
  if (model === undefined || !isMagicalClockActive()) {
    return baseBilled
  }
  const perModel = getPerModelEntry(lattice, model)
  if (isMaxOrTeam5xPlan()) {
    return baseBilled && perModel !== undefined
  }
  const latch =
    getBootstrapSessionHost().accountCreditLatches.fableCreditsRequired()
  return (
    baseBilled ||
    latch ||
    (isProOrStandardTeamPlan() &&
      perModel === undefined &&
      isSaffronLatticeExplicitlyDisabled(model) &&
      Date.parse(lattice.billsFrom ?? '') <= nowMs)
  )
}

/**
 * Official 2.1.328 `rQr(e)` (chunk@289476641.js @186547 / @189016):
 * `RFe(e) || (abo() && !fW())`, combining `tengu_saffron_lattice`,
 * `tengu_hazy_horizon`, `tengu_magical_clock`, and the account credits latch.
 */
export function isFableModelBilledToCredits(
  model?: string,
  nowMs: number = Date.now(),
): boolean {
  return (
    isSaffronCreditsRequiredForModel(model, nowMs) ||
    (getBootstrapSessionHost().accountCreditLatches.fableCreditsRequired() &&
      !isMagicalClockActive())
  )
}

/** Official `fAn()` (chunk@289476641.js @187100) — admin-billed tier gate. */
function isAdminBilledCreditsOnlyTier(): boolean {
  const sub = getSubscriptionType()
  if (sub === 'enterprise') {
    return true
  }
  if (sub === null) {
    return false
  }
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_saffron_credits_only_tiers',
    ['enterprise'],
  )
  const tiers = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string')
    : ['enterprise']
  return (
    tiers.includes(sub) &&
    !(isProOrStandardTeamPlan() && isMagicalClockActive())
  )
}

/**
 * Official 2.1.328 `I(e)` + `rQr(e)` (chunk@311071246.js @1647 &
 * chunk@289476641.js @186547): determine whether Fable requires usage credits.
 */
export function isKSlFableCreditsRequired(opts?: {
  model?: string
  nowMs?: number
  planStatus?:
    | 'included_in_plan'
    | 'pay_per_request'
    | 'admin_billed'
    | 'needs_consent'
    | 'needs_credits'
    | 'out_of_credits'
    | 'consented'
}): boolean {
  if (
    opts?.planStatus === 'included_in_plan' ||
    opts?.planStatus === 'pay_per_request'
  ) {
    return false
  }
  const billedByRQr = isFableModelBilledToCredits(opts?.model, opts?.nowMs)
  if (
    opts?.planStatus === 'admin_billed' ||
    (opts?.planStatus === undefined && isAdminBilledCreditsOnlyTier())
  ) {
    return billedByRQr || !isSaffronLatticeExplicitlyDisabled(opts?.model)
  }
  return billedByRQr
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
  const fableRequired =
    env?.fableCreditsRequired ?? isKSlFableCreditsRequired({ model: resolved })
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
