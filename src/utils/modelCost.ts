import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js'
import { logEvent } from 'src/services/analytics/index.js'
import { setHasUnknownModelCost } from '../bootstrap/state.js'
import { isFastModeEnabled } from './fastMode.js'
import {
  CLAUDE_3_5_HAIKU_CONFIG,
  CLAUDE_3_5_V2_SONNET_CONFIG,
  CLAUDE_3_7_SONNET_CONFIG,
  CLAUDE_HAIKU_4_5_CONFIG,
  CLAUDE_HAIKU_5_5_CONFIG,
  CLAUDE_OPUS_4_1_CONFIG,
  CLAUDE_OPUS_4_5_CONFIG,
  CLAUDE_OPUS_4_6_CONFIG,
  CLAUDE_OPUS_4_7_CONFIG,
  CLAUDE_OPUS_4_8_CONFIG,
  CLAUDE_OPUS_4_CONFIG,
  CLAUDE_OPUS_5_CONFIG,
  CLAUDE_OPUS_5_5_CONFIG,
  CLAUDE_SONNET_4_5_CONFIG,
  CLAUDE_SONNET_4_6_CONFIG,
  CLAUDE_SONNET_4_CONFIG,
  CLAUDE_SONNET_5_CONFIG,
  CLAUDE_SONNET_5_5_CONFIG,
} from './model/configs.js'
import {
  expandTigModelCosts,
  DENSABLE_PRICING_TIERS_FROM_CATALOG,
} from './model/modelCatalogCapabilities.js'
import { firstPartyNameToCanonical } from './model/canonicalName.js'
import {
  getCanonicalName,
  getDefaultMainLoopModelSetting,
  type ModelShortName,
} from './model/model.js'

/**
 * densable QO-shaped short name for cost tables / GHt / Pji.
 * densable `lo(e)` applies model-overrides then `QO`; stream billing passes
 * resolved full model ids (not bare `opus` aliases). Strip densable `[1m]`
 * suffix before canonicalization so `claude-opus-5[1m]` still hits MODEL_COSTS.
 */
function toCostCanonical(model: string): ModelShortName {
  return getCanonicalName(model.replace(/\[1m\]/gi, '').trim())
}

// densable 2.1.219 model catalog `pricing_tiers` + NIc field mapping:
//   input → inputTokens
//   output → outputTokens
//   cache_write_5m → promptCacheWriteTokens
//   cache_write_1h → promptCacheWrite1hTokens  (optional in NIc; all tiers set)
//   cache_read → promptCacheReadTokens
//   web_search → webSearchRequests
// Extracted from official-219 claude.exe (not guessed / not "official docs only").
export type ModelCosts = {
  inputTokens: number
  outputTokens: number
  promptCacheWriteTokens: number
  /**
   * densable `promptCacheWrite1hTokens` / catalog `cache_write_1h`.
   * densable `Cig` bills `cache_creation.ephemeral_1h_input_tokens` at this rate
   * and the remainder of `cache_creation_input_tokens` at `promptCacheWriteTokens`.
   */
  promptCacheWrite1hTokens?: number
  promptCacheReadTokens: number
  webSearchRequests: number
  /** Official 2.1.293 #285: long-prompt tier (e.g. Haiku 5.5 > 100K tokens). */
  longPrompt?: {
    abovePromptTokens: number
    inputTokens: number
    outputTokens: number
    promptCacheWriteTokens: number
    promptCacheWrite1hTokens?: number
    promptCacheReadTokens: number
    webSearchRequests: number
  }
}

/**
 * densable catalog `pricing_tiers` (2.1.219) — from full EHl bake via NIc map.
 * Source of truth: densableEhlCatalog.219.ts (not hand-copied numbers).
 */
export const DENSABLE_PRICING_TIERS: Readonly<Record<string, ModelCosts>> =
  DENSABLE_PRICING_TIERS_FROM_CATALOG

// Local aliases (= densable pricing_tiers keys / vig·u7n hardcodes).
function requireTier(key: string): ModelCosts {
  const t = DENSABLE_PRICING_TIERS[key]
  if (!t) {
    throw new Error(`densable pricing_tiers missing key: ${key}`)
  }
  return t
}

/**
 * densable 2.1.243 #52 `tier_2_10` — Sonnet 5 standard list ($2/$10).
 * Official-243 catalog bake (not in the 219 extract). Same NIc ratios as
 * other tiers: write 5m = 1.25×, write 1h = 2×, read = 0.1×.
 */
export const COST_TIER_2_10 = {
  inputTokens: 2,
  outputTokens: 10,
  promptCacheWriteTokens: 2.5,
  promptCacheWrite1hTokens: 4,
  promptCacheReadTokens: 0.2,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

/**
 * Official 2.1.296 #544 `tier_2_10_cache_read_0_10` — Sonnet 5.5 cache read at $0.10/Mtok.
 */
export const COST_TIER_2_10_CACHE_READ_0_10 = {
  inputTokens: 2,
  outputTokens: 10,
  promptCacheWriteTokens: 2.5,
  promptCacheWrite1hTokens: 4,
  promptCacheReadTokens: 0.1,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

/** densable tier_3_15 — Sonnet 3.5/3.7/4/4.5/4.6 list */
export const COST_TIER_3_15 = requireTier('tier_3_15')
/** densable tier_15_75 — Opus 4 / 4.1 list */
export const COST_TIER_15_75 = requireTier('tier_15_75')
/** densable tier_5_25 / vig — current Opus list ($5/$25) */
export const COST_TIER_5_25 = requireTier('tier_5_25')
/** densable tier_10_50 / u7n — Opus 5·4.8 fast + catalog fable/mythos list */
export const COST_TIER_10_50 = requireTier('tier_10_50')
/** densable haiku_35 */
export const COST_HAIKU_35 = requireTier('haiku_35')
/** densable haiku_45 */
export const COST_HAIKU_45 = requireTier('haiku_45')
/** Official 2.1.293 #285 `haiku_55` ($0.10/$0.50; >100K: $0.50/$2.50) */
export const COST_HAIKU_55: ModelCosts = {
  inputTokens: 0.1,
  outputTokens: 0.5,
  promptCacheWriteTokens: 0.125,
  promptCacheWrite1hTokens: 0.2,
  promptCacheReadTokens: 0.01,
  webSearchRequests: 0.01,
  longPrompt: {
    abovePromptTokens: 100_000,
    inputTokens: 0.5,
    outputTokens: 2.5,
    promptCacheWriteTokens: 0.625,
    promptCacheWrite1hTokens: 1,
    promptCacheReadTokens: 0.05,
    webSearchRequests: 0.01,
  },
}

/**
 * densable LIc — NOT in catalog pricing_tiers; runtime hardcode for GHt fallthrough
 * and Pji speed=fast on opus-4-6|4-7 ($30/$150, 1h write 60).
 */
export const COST_TIER_30_150 = {
  inputTokens: 30,
  outputTokens: 150,
  promptCacheWriteTokens: 37.5,
  promptCacheWrite1hTokens: 60,
  promptCacheReadTokens: 3,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

/**
 * Official 2.1.328 HK — fast-mode pricing for claude-opus-5-5 ($8/$40,
 * 5m write $10, 1h write $16, cache read $0.40).
 */
export const COST_TIER_8_40 = {
  inputTokens: 8,
  outputTokens: 40,
  promptCacheWriteTokens: 10,
  promptCacheWrite1hTokens: 16,
  promptCacheReadTokens: 0.4,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

/**
 * Official 2.1.328 GK — fast-mode pricing for claude-fable-5-2 and
 * claude-mythos-5-2 ($16/$80, 5m write $20, 1h write $32, cache read $0.40).
 */
export const COST_TIER_16_80 = {
  inputTokens: 16,
  outputTokens: 80,
  promptCacheWriteTokens: 20,
  promptCacheWrite1hTokens: 32,
  promptCacheReadTokens: 0.4,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

const DEFAULT_UNKNOWN_MODEL_COST = COST_TIER_5_25

/**
 * Official 2.1.328 Yv(e) — fast-mode cost tier lookup by canonical model name.
 */
function getFastModeCostTier(
  shortName: ModelShortName,
): ModelCosts | undefined {
  if (
    shortName === firstPartyNameToCanonical('claude-fable-5-2') ||
    shortName === firstPartyNameToCanonical('claude-mythos-5-2')
  ) {
    return COST_TIER_16_80
  }
  if (
    shortName === firstPartyNameToCanonical(CLAUDE_OPUS_5_5_CONFIG.firstParty)
  ) {
    return COST_TIER_8_40
  }
  if (
    shortName ===
      firstPartyNameToCanonical(CLAUDE_OPUS_4_8_CONFIG.firstParty) ||
    shortName === firstPartyNameToCanonical(CLAUDE_OPUS_5_CONFIG.firstParty)
  ) {
    return COST_TIER_10_50
  }
  if (
    shortName ===
      firstPartyNameToCanonical(CLAUDE_OPUS_4_6_CONFIG.firstParty) ||
    shortName === firstPartyNameToCanonical(CLAUDE_OPUS_4_7_CONFIG.firstParty)
  ) {
    return COST_TIER_30_150
  }
  return undefined
}

/**
 * Official 2.1.328 els(e) / GHt(e) — picker pricing when fast mode is enabled.
 *   fable-5-2 | mythos-5-2 → GK ($16/$80)
 *   opus-5-5 → HK ($8/$40)
 *   opus-5 | opus-4-8 → V_ ($10/$50)
 *   else → Kv ($30/$150)
 * When fast is off / disabled, returns MODEL_COSTS[model] ?? COST_TIER_5_25
 * (e.g. $4/$20 for claude-opus-5-5, $5/$25 for opus-5/4.7/4.8).
 *
 * @param model Canonical or full model id for the picker row.
 * @param fastMode Whether this row is showing the fast-mode price column.
 */
export function getOpus46CostTier(
  fastMode: boolean,
  model?: string,
): ModelCosts {
  if (!(isFastModeEnabled() && fastMode)) {
    if (model) {
      return MODEL_COSTS[toCostCanonical(model)] ?? COST_TIER_5_25
    }
    return COST_TIER_5_25
  }
  // When model omitted (e.g. /fast UI defaulting to Opus 5), keep COST_TIER_10_50.
  if (!model) {
    return COST_TIER_10_50
  }
  const shortName = toCostCanonical(model)
  return getFastModeCostTier(shortName) ?? COST_TIER_30_150
}

// @[MODEL LAUNCH]: Add a pricing entry for the new model below.
// densable Uot base ≈ Tig(): each catalog model.pricing → pricing_tiers[key] via NIc.
// Fast overrides (Pji/GHt) apply on top in getModelCosts / getOpus46CostTier.
// Web search: densable web_search 0.01 (= $10 / 1000 requests).
//
// densable:
//   Tig() expands SQ().models → { [id]: NIc(id, $Ti(model)) }
//   Uot = { [QO(fable5)]: u7n, [QO(mythos5)]: u7n, ...Tig() }
// fable/mythos catalog pricing is already tier_10_50 (=u7n), so Tig alone
// covers them; hardcode keys remain for QO short-name lookup parity.

/** densable Tig() — catalog id → list ModelCosts from SQ().models + pricing_tiers. */
export const TIG_MODEL_COSTS: Readonly<Record<string, ModelCosts>> =
  expandTigModelCosts()

export const MODEL_COSTS: Record<ModelShortName, ModelCosts> = {
  // densable Tig() entries (catalog ids). Also keyed by firstParty canonical
  // names where they differ from catalog id (e.g. claude-opus-4 vs 4-0).
  ...Object.fromEntries(
    Object.entries(TIG_MODEL_COSTS).map(([id, cost]) => [
      firstPartyNameToCanonical(id),
      cost,
    ]),
  ),
  // densable models[].pricing: "haiku_35" / "haiku_45"
  [firstPartyNameToCanonical(CLAUDE_3_5_HAIKU_CONFIG.firstParty)]:
    COST_HAIKU_35,
  [firstPartyNameToCanonical(CLAUDE_HAIKU_4_5_CONFIG.firstParty)]:
    COST_HAIKU_45,
  [firstPartyNameToCanonical(CLAUDE_HAIKU_5_5_CONFIG.firstParty)]:
    COST_HAIKU_55,
  // densable: sonnet 3.5/3.7/4/4.5/4.6 → "tier_3_15"
  [firstPartyNameToCanonical(CLAUDE_3_5_V2_SONNET_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_3_7_SONNET_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_SONNET_4_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_SONNET_4_5_CONFIG.firstParty)]:
    COST_TIER_3_15,
  [firstPartyNameToCanonical(CLAUDE_SONNET_4_6_CONFIG.firstParty)]:
    COST_TIER_3_15,
  // densable 2.1.243 #52: sonnet-5 list = tier_2_10 ($2/$10 standard, not promo).
  [firstPartyNameToCanonical(CLAUDE_SONNET_5_CONFIG.firstParty)]:
    COST_TIER_2_10,
  // Official 2.1.296 #544: sonnet-5-5 = tier_2_10_cache_read_0_10 ($0.10/Mtok cache read).
  [firstPartyNameToCanonical(CLAUDE_SONNET_5_5_CONFIG.firstParty)]:
    COST_TIER_2_10_CACHE_READ_0_10,
  // densable: opus-4-0 / 4-1 → "tier_15_75"
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_CONFIG.firstParty)]: COST_TIER_15_75,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_1_CONFIG.firstParty)]:
    COST_TIER_15_75,
  // densable: opus-4-5/4-6/4-7/4-8/5 → "tier_5_25" (list); fast via GHt/Pji
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_5_CONFIG.firstParty)]:
    COST_TIER_5_25,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_6_CONFIG.firstParty)]:
    COST_TIER_5_25,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_7_CONFIG.firstParty)]:
    COST_TIER_5_25,
  [firstPartyNameToCanonical(CLAUDE_OPUS_4_8_CONFIG.firstParty)]:
    COST_TIER_5_25,
  [firstPartyNameToCanonical(CLAUDE_OPUS_5_CONFIG.firstParty)]: COST_TIER_5_25,
  // densable Uot hardcode before Tig(): QO(kot.fable5)/QO(dbc.mythos5) → u7n
  // catalog pricing for both is also tier_10_50 (same numbers).
  [firstPartyNameToCanonical('claude-fable-5')]: COST_TIER_10_50,
  [firstPartyNameToCanonical('claude-mythos-5')]: COST_TIER_10_50,
}

/**
 * densable Cig(e,t) — split cache-write cost between 1h and 5m rates.
 */
function cacheCreationUSDCost(modelCosts: ModelCosts, usage: Usage): number {
  const totalWrite = usage.cache_creation_input_tokens ?? 0
  const oneHourRate = modelCosts.promptCacheWrite1hTokens
  const oneHourTokens = Math.min(
    usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    totalWrite,
  )
  if (oneHourRate === undefined || oneHourTokens <= 0) {
    return (totalWrite / 1_000_000) * modelCosts.promptCacheWriteTokens
  }
  return (
    (oneHourTokens / 1_000_000) * oneHourRate +
    ((totalWrite - oneHourTokens) / 1_000_000) *
      modelCosts.promptCacheWriteTokens
  )
}

/** densable eWb — US-only-inference premium (data-residency). */
export const US_ONLY_INFERENCE_PREMIUM = 1.1

/**
 * densable tWb(e) — 1.1× when usage.inference_geo === "us", else 1.
 */
function usOnlyInferenceMultiplier(usage: Usage): number {
  return usage.inference_geo === 'us' ? US_ONLY_INFERENCE_PREMIUM : 1
}

/** Official i$(e, n) — switch to longPrompt tier when total prompt tokens exceed abovePromptTokens. */
function resolveLongPromptCosts(
  modelCosts: ModelCosts,
  usage: Usage,
): ModelCosts {
  const longPrompt = modelCosts.longPrompt
  if (longPrompt === undefined) {
    return modelCosts
  }
  const totalPromptTokens =
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  return totalPromptTokens > longPrompt.abovePromptTokens
    ? longPrompt
    : modelCosts
}

/**
 * densable ima(e,t) — token USD * tWb(usage) + web search.
 * Web search is not multiplied (official `r*tWb(t)+n`).
 */
function tokensToUSDCost(modelCosts: ModelCosts, usage: Usage): number {
  const effective = resolveLongPromptCosts(modelCosts, usage)
  const tokenCost =
    (usage.input_tokens / 1_000_000) * effective.inputTokens +
    (usage.output_tokens / 1_000_000) * effective.outputTokens +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
      effective.promptCacheReadTokens +
    cacheCreationUSDCost(effective, usage)
  const webSearch =
    (usage.server_tool_use?.web_search_requests ?? 0) *
    effective.webSearchRequests
  return tokenCost * usOnlyInferenceMultiplier(usage) + webSearch
}

/**
 * densable Pji(e,t) — usage billing tier from model + usage.speed.
 *   speed===fast:
 *     opus-5 | opus-4-8 → u7n
 *     opus-4-6 | opus-4-7 → LIc
 *     else → Uot table (not LIc — GHt is picker-only)
 *   else → Uot / MODEL_COSTS
 */
export function getModelCosts(model: string, usage: Usage): ModelCosts {
  // Official 2.1.328 Pji / Yv: resolve short name, apply fast-mode tier override.
  const shortName = toCostCanonical(model)
  const isFast = usage.speed === 'fast'

  if (isFast) {
    const fastTier = getFastModeCostTier(shortName)
    if (fastTier) {
      return fastTier
    }
  }

  const costs = MODEL_COSTS[shortName]
  if (!costs) {
    trackUnknownModelCost(model, shortName)
    try {
      return (
        MODEL_COSTS[
          toCostCanonical(String(getDefaultMainLoopModelSetting() ?? ''))
        ] ?? DEFAULT_UNKNOWN_MODEL_COST
      )
    } catch {
      return DEFAULT_UNKNOWN_MODEL_COST
    }
  }
  return costs
}

function trackUnknownModelCost(model: string, shortName: ModelShortName): void {
  logEvent('tengu_unknown_model_cost', {
    model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    shortName:
      shortName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  setHasUnknownModelCost()
}

// Calculate the cost of a query in US dollars.
// If the model's costs are not found, use the default model's costs.
export function calculateUSDCost(resolvedModel: string, usage: Usage): number {
  // densable 2.1.243 `Px` — managed modelPricing * multiplier when trusted.
  const { getCompiledOrgPricing, lookupOrgModelCosts } =
    require('./modelPricing.js') as typeof import('./modelPricing.js')
  const compiled = getCompiledOrgPricing()
  if (!compiled) {
    return tokensToUSDCost(getModelCosts(resolvedModel, usage), usage)
  }
  const override = lookupOrgModelCosts(compiled, resolvedModel)
  const billedUsage = override
    ? ({ ...usage, inference_geo: null } as Usage)
    : usage
  const costs = override ?? getModelCosts(resolvedModel, billedUsage)
  return tokensToUSDCost(costs, billedUsage) * compiled.multiplier
}

/**
 * Calculate cost from raw token counts without requiring a full BetaUsage object.
 * Useful for side queries (e.g. classifier) that track token counts independently.
 */
export function calculateCostFromTokens(
  model: string,
  tokens: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
    /** densable ephemeral_1h_input_tokens subset of cache creation */
    cacheCreation1hInputTokens?: number
  },
): number {
  const usage: Usage = {
    input_tokens: tokens.inputTokens,
    output_tokens: tokens.outputTokens,
    cache_read_input_tokens: tokens.cacheReadInputTokens,
    cache_creation_input_tokens: tokens.cacheCreationInputTokens,
    cache_creation:
      tokens.cacheCreation1hInputTokens !== undefined
        ? {
            ephemeral_1h_input_tokens: tokens.cacheCreation1hInputTokens,
            ephemeral_5m_input_tokens: Math.max(
              0,
              tokens.cacheCreationInputTokens -
                tokens.cacheCreation1hInputTokens,
            ),
          }
        : null,
  } as Usage
  return calculateUSDCost(model, usage)
}

function formatPrice(price: number): string {
  // Format price: integers without decimals, others with 2 decimal places
  // e.g., 3 -> "$3", 0.8 -> "$0.80", 22.5 -> "$22.50"
  if (Number.isInteger(price)) {
    return `$${price}`
  }
  return `$${price.toFixed(2)}`
}

/**
 * Format model costs as a pricing string for display
 * e.g., "$3/$15 per Mtok"
 */
export function formatModelPricing(costs: ModelCosts): string {
  return `${formatPrice(costs.inputTokens)}/${formatPrice(costs.outputTokens)} per Mtok`
}

/**
 * Get formatted pricing string for a model
 * Accepts either a short name or full model name
 * Returns undefined if model is not found
 */
export function getModelPricingString(model: string): string | undefined {
  const shortName = toCostCanonical(model)
  const costs = MODEL_COSTS[shortName]
  if (!costs) return undefined
  return formatModelPricing(costs)
}
