/**
 * densable 2.1.219 model catalog runtime (SQ / Lqm / Aw / ON / $Ti / Tig / AHl).
 *
 * Full EHl bake lives in densableEhlCatalog.219.ts (extract-ehl-219.py).
 *
 * densable:
 *   SQ = safeParse(EHl) memo → catalog
 *   Lqm = Map(id → model) from SQ().models
 *   Oqm = Map(providerId.lower → catalog id)
 *   Aw(e) = Lqm.get(e)                 // exact catalog id
 *   RFr(e) = Oqm.get(e.toLowerCase())  // provider id → catalog id
 *   ON(e,t) {
 *     r = e.replace(/\[1m\]/gi,"")
 *     n = Aw(r)
 *     if (n !== undefined) return n.capabilities.includes(t) ? true : undefined
 *     return Nqm?.(r,t)                // Nqm never assigned in 2.1.219
 *   }
 *   $Ti(model) = pricing object | pricing_tiers[model.pricing]
 *   Tig() = { [id]: NIc(id, $Ti(model)) for model in SQ().models }
 *   AHl(alias, provider) = aliases[alias].per_provider[provider] ?? default
 *
 * ON returns true | undefined (never false).
 */

import { DENSABLE_EHL_CATALOG } from './densableEhlCatalog.219.js'
import { firstPartyNameToCanonical } from './model.js'

export type DensablePricingTierRaw = {
  readonly input: number
  readonly output: number
  readonly cache_write_5m?: number
  readonly cache_write_1h?: number
  readonly cache_read?: number
  readonly web_search?: number
}

export type DensableProviderIds = {
  readonly first_party: string
  readonly bedrock?: string | null
  readonly vertex?: string | null
  readonly foundry?: string | null
  readonly anthropic_aws?: string | null
  readonly anthropic_google_cloud?: string | null
  readonly mantle?: string | null
  readonly gateway?: string | null
}

export type DensableCatalogModel = {
  readonly id: string
  readonly family: string
  readonly display_name: string
  readonly slogan?: string
  readonly knowledge_cutoff?: string
  readonly provider_ids: DensableProviderIds
  readonly eager_input_streaming?: {
    readonly bedrock?: true
    readonly vertex?: true
  }
  readonly vertex_region_env_var?: string
  readonly fallback_3p?: string
  readonly context?: {
    readonly window: number
    readonly native_1m?: boolean
    readonly native_1m_3p?: {
      readonly bedrock?: true
      readonly vertex?: true
      readonly foundry?: true
    }
    readonly supports_1m_beta?: boolean
    readonly supports_1m_suffix?: boolean
  }
  readonly max_output_tokens?: {
    readonly default: number
    readonly upper: number
  }
  readonly pricing?: string | DensablePricingTierRaw
  readonly capabilities: readonly string[]
  readonly default_effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  readonly image_limits?: {
    readonly maxWidth?: number
    readonly maxHeight?: number
    readonly maxBase64Size?: number
  }
  readonly advisor_rank?: number
  readonly fallback_chain?: readonly string[]
  readonly picker?: {
    readonly section?: 'main' | 'overflow' | 'deprecated'
    readonly badge?: string
    readonly disabled_reason?: string
    readonly tiers?: readonly string[]
  }
  readonly deprecation?: {
    readonly retirement_dates?: Readonly<Record<string, string>>
    readonly remapped_to?: string
  }
  readonly min_cli_version?: string
}

export type DensableModelCatalog = {
  readonly schema_version: number
  readonly pricing_tiers: Readonly<Record<string, DensablePricingTierRaw>>
  readonly models: readonly DensableCatalogModel[]
  readonly aliases: Readonly<
    Record<
      string,
      {
        readonly default: string
        readonly per_provider?: Readonly<Record<string, string>>
      }
    >
  >
  readonly defaults: Readonly<Record<string, string>>
  readonly best?: string
  readonly latest_per_family: Readonly<Record<string, string>>
  readonly alias_migration: Readonly<Record<string, string>>
}

/** densable SQ() — baked EHl catalog (already schema-validated at extract time). */
export function getDensableModelCatalog(): DensableModelCatalog {
  // Cast: as-const bake is structurally compatible; models[] is readonly tuple.
  return DENSABLE_EHL_CATALOG as unknown as DensableModelCatalog
}

/** densable Lqm — Map(catalog id → model), built once. */
const Lqm: Map<string, DensableCatalogModel> = (() => {
  const m = new Map<string, DensableCatalogModel>()
  for (const model of getDensableModelCatalog().models) {
    m.set(model.id, model)
  }
  return m
})()

/** densable Oqm — Map(provider id lower → catalog id). */
const Oqm: Map<string, string> = (() => {
  const m = new Map<string, string>()
  for (const model of getDensableModelCatalog().models) {
    for (const pid of Object.values(model.provider_ids)) {
      if (typeof pid !== 'string') continue
      const n = pid.toLowerCase()
      const prev = m.get(n)
      if (prev !== undefined && prev !== model.id) {
        throw new Error(
          `model catalog: provider id collision across distinct entries: ${pid}`,
        )
      }
      m.set(n, model.id)
    }
  }
  return m
})()

/** densable Aw(e) — exact catalog id lookup. */
export function getDensableCatalogModel(
  catalogId: string,
): DensableCatalogModel | undefined {
  return Lqm.get(catalogId)
}

/** densable RFr(e) — provider id → catalog id. */
export function resolveCatalogIdFromProviderId(
  providerOrFullId: string,
): string | undefined {
  return Oqm.get(providerOrFullId.toLowerCase())
}

/**
 * densable ON(e, t) — catalog capability probe.
 * Nqm never assigned in 2.1.219 → no runtime override.
 * Accept lo/QO non-canonical inputs via firstPartyNameToCanonical.
 */
export function modelHasCatalogCapability(
  model: string,
  capability: string,
): true | undefined {
  const stripped = model
    .replace(/\[1m\]/gi, '')
    .trim()
    .toLowerCase()
  let entry =
    getDensableCatalogModel(stripped) ??
    getDensableCatalogModel(firstPartyNameToCanonical(stripped))
  if (entry === undefined) {
    // Oqm: full provider id → catalog id (densable RFr used inside QO)
    const viaProvider = resolveCatalogIdFromProviderId(stripped)
    if (viaProvider !== undefined) {
      entry = getDensableCatalogModel(viaProvider)
    }
  }
  if (entry === undefined) return undefined
  return entry.capabilities.includes(capability) ? true : undefined
}

/** densable $Ti(model) — resolve pricing object from tier key or inline. */
export function resolveCatalogModelPricing(
  model: DensableCatalogModel,
): DensablePricingTierRaw | undefined {
  const t = model.pricing
  if (t === undefined) return undefined
  if (typeof t !== 'string') return t
  const tiers = getDensableModelCatalog().pricing_tiers
  return Object.hasOwn(tiers, t) ? tiers[t] : undefined
}

/**
 * densable NIc field mapping → local ModelCosts-shaped numbers
 * (inputTokens / outputTokens / promptCacheWrite* / webSearchRequests).
 */
export type CatalogModelCosts = {
  inputTokens: number
  outputTokens: number
  promptCacheWriteTokens: number
  promptCacheWrite1hTokens?: number
  promptCacheReadTokens: number
  webSearchRequests: number
}

export function nIcFromPricingTier(
  pricing: DensablePricingTierRaw,
): CatalogModelCosts {
  return {
    inputTokens: pricing.input,
    outputTokens: pricing.output,
    promptCacheWriteTokens: pricing.cache_write_5m ?? pricing.input * 1.25,
    promptCacheWrite1hTokens: pricing.cache_write_1h,
    promptCacheReadTokens: pricing.cache_read ?? pricing.input * 0.1,
    webSearchRequests: pricing.web_search ?? 0.01,
  }
}

/**
 * densable Tig() — { [catalogId]: NIc(id, $Ti(model)) } for all models with pricing.
 */
export function expandTigModelCosts(): Record<string, CatalogModelCosts> {
  const out: Record<string, CatalogModelCosts> = {}
  for (const model of getDensableModelCatalog().models) {
    const raw = resolveCatalogModelPricing(model)
    if (raw === undefined) continue
    out[model.id] = nIcFromPricingTier(raw)
  }
  return out
}

/**
 * densable AHl(alias, provider) — family alias → catalog id for provider.
 */
export function resolveCatalogAlias(
  alias: string,
  provider?: string,
): string | undefined {
  const entry = getDensableModelCatalog().aliases[alias]
  if (!entry) return undefined
  if (
    provider &&
    entry.per_provider &&
    Object.hasOwn(entry.per_provider, provider)
  ) {
    return entry.per_provider[provider]
  }
  return entry.default
}

// ── Back-compat views (prior ON-only slice) ──────────────────────────

/** capabilities-only map (id → capabilities[]). */
export const DENSABLE_CATALOG_CAPABILITIES: Readonly<
  Record<string, readonly string[]>
> = Object.fromEntries(
  getDensableModelCatalog().models.map(m => [m.id, m.capabilities]),
)

/** id → { id, capabilities, pricing key } for older Tig helpers. */
export type DensableCatalogEntry = {
  readonly id: string
  readonly capabilities: readonly string[]
  readonly pricing: string
}

export const DENSABLE_CATALOG_MODELS: Readonly<
  Record<string, DensableCatalogEntry>
> = Object.fromEntries(
  getDensableModelCatalog().models.map(m => [
    m.id,
    {
      id: m.id,
      capabilities: m.capabilities,
      pricing: typeof m.pricing === 'string' ? m.pricing : '',
    },
  ]),
)

/**
 * densable pricing_tiers as local ModelCosts field names (NIc-mapped).
 * Source: EHl.pricing_tiers — same numbers as prior hand-copy.
 */
export const DENSABLE_PRICING_TIERS_FROM_CATALOG: Readonly<
  Record<string, CatalogModelCosts>
> = Object.fromEntries(
  Object.entries(getDensableModelCatalog().pricing_tiers).map(([k, v]) => [
    k,
    nIcFromPricingTier(v),
  ]),
)
