import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getRemoteManagedSettingsSyncFromCache } from '../services/remoteManagedSettings/syncCacheState.js'
import { logForDebugging } from './debug.js'
import type { ModelCosts } from './modelCost.js'
import {
  getPolicySettingsOrigin,
  getSettingsForSource,
} from './settings/settings.js'

function toBuiltinKey(model: string): string | null {
  // Lazy to avoid model.ts ↔ modelCost import cycle.
  const { getCanonicalName } =
    require('./model/model.js') as typeof import('./model/model.js')
  const name = getCanonicalName(model)
  return name || null
}

const DEFAULT_WEB_SEARCH = 0.01

export type CompiledOrgPricing = {
  multiplier: number
  exact: Map<string, ModelCosts>
  builtin: Map<string, ModelCosts>
}

type ModelPricingSetting = {
  multiplier?: number
  overrides?: Record<
    string,
    {
      input: number
      output: number
      cacheRead?: number
      cacheWrite?: number
    }
  >
}

let cachedOrgPricing: { value: CompiledOrgPricing | undefined } | undefined

export function resetOrgPricingCache(): void {
  cachedOrgPricing = undefined
}

/**
 * densable `ou` analog — machine-admin origins are trusted. Remote is trusted
 * only when the verified remote-managed cache is present (`J_ || Q_`).
 */
function isModelPricingOriginTrusted(
  origin: ReturnType<typeof getPolicySettingsOrigin>,
): boolean {
  if (origin === 'file' || origin === 'plist' || origin === 'hklm') {
    return true
  }
  if (origin === 'remote') {
    const remote = getRemoteManagedSettingsSyncFromCache()
    return remote !== null && Object.keys(remote).length > 0
  }
  return false
}

/** densable `Rx(e, t)` — compile managed modelPricing overrides. */
export function compileModelPricing(
  setting: ModelPricingSetting,
): CompiledOrgPricing | undefined {
  const exact = new Map<string, ModelCosts>()
  const builtin = new Map<string, ModelCosts>()

  for (const [rawKey, row] of Object.entries(setting.overrides ?? {})) {
    const costs: ModelCosts = {
      inputTokens: row.input,
      outputTokens: row.output,
      promptCacheReadTokens: row.cacheRead ?? 0,
      promptCacheWriteTokens: row.cacheWrite ?? 0,
      webSearchRequests: DEFAULT_WEB_SEARCH,
    }
    const exactKey = rawKey.trim().toLowerCase()
    if (exact.has(exactKey)) {
      logForDebugging(
        `modelPricing: override '${rawKey}' repeats an earlier row's key; the earlier row is used`,
        { level: 'warn' },
      )
      continue
    }
    exact.set(exactKey, costs)

    const builtinKey = toBuiltinKey(exactKey)
    if (!builtinKey) continue
    if (builtin.has(builtinKey)) {
      logForDebugging(
        `modelPricing: override '${rawKey}' spells the same built-in model as an earlier row; it prices only its exact spelling, other spellings use the earlier row`,
        { level: 'warn' },
      )
      continue
    }
    builtin.set(builtinKey, costs)
  }

  const multiplier = setting.multiplier ?? 1
  if (exact.size === 0 && multiplier === 1) {
    return undefined
  }
  return { multiplier, exact, builtin }
}

/** densable `xx(e, t)` — exact spelling first, then builtin canonical. */
export function lookupOrgModelCosts(
  compiled: CompiledOrgPricing,
  model: string,
): ModelCosts | undefined {
  const exact = compiled.exact.get(model.trim().toLowerCase())
  if (exact) return exact
  if (compiled.builtin.size === 0) return undefined
  return compiled.builtin.get(toBuiltinKey(model) ?? '')
}

/**
 * densable `sy()` — latch compiled org pricing on policy settings.
 */
export function getCompiledOrgPricing(): CompiledOrgPricing | undefined {
  if (cachedOrgPricing !== undefined) {
    return cachedOrgPricing.value
  }

  cachedOrgPricing = { value: undefined }
  try {
    const origin = getPolicySettingsOrigin()
    const policy = getSettingsForSource('policySettings')
    const trusted = isModelPricingOriginTrusted(origin)
    const raw = trusted ? policy?.modelPricing : undefined
    const compiled = raw ? compileModelPricing(raw) : undefined
    cachedOrgPricing.value = compiled
    if (compiled) {
      logEvent('settings_model_pricing', {
        rows: compiled.exact.size,
        multiplier: compiled.multiplier,
      })
    } else if (!trusted && policy?.modelPricing) {
      logEvent('settings_model_pricing', {
        reason: (origin === 'remote'
          ? 'unverified_remote_cache'
          : 'untrusted_origin') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    return compiled
  } catch (error) {
    logForDebugging(
      `modelPricing: ${error instanceof Error ? error.message : String(error)}; pricing at list`,
      { level: 'error' },
    )
    logEvent('settings_model_pricing', {
      reason:
        'compile_threw' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return undefined
  }
}
