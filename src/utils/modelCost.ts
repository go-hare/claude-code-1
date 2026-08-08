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
  CLAUDE_OPUS_4_1_CONFIG,
  CLAUDE_OPUS_4_5_CONFIG,
  CLAUDE_OPUS_4_6_CONFIG,
  CLAUDE_OPUS_4_7_CONFIG,
  CLAUDE_OPUS_4_8_CONFIG,
  CLAUDE_OPUS_4_CONFIG,
  CLAUDE_OPUS_5_CONFIG,
  CLAUDE_SONNET_4_5_CONFIG,
  CLAUDE_SONNET_4_6_CONFIG,
  CLAUDE_SONNET_4_CONFIG,
  CLAUDE_SONNET_5_CONFIG,
} from './model/configs.js'
import {
  expandTigModelCosts,
  DENSABLE_PRICING_TIERS_FROM_CATALOG,
} from './model/modelCatalogCapabilities.js'
import {
  firstPartyNameToCanonical,
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

/** densable tier_3_15 — Sonnet list */
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

const DEFAULT_UNKNOWN_MODEL_COST = COST_TIER_5_25

/**
 * densable GHt(e) — picker pricing when fast mode is globally enabled (`vl()`).
 *   opus-5 | opus-4-8 → u7n ($10/$50)
 *   else → LIc ($30/$150)
 * When fast is off / disabled, densable returns Uot[e]??d7n ($5/$25 for current Opus).
 *
 * @param model Canonical or full model id for the picker row (required for correct GHt).
 * @param fastMode Whether this row is showing the fast-mode price column.
 */
export function getOpus46CostTier(
  fastMode: boolean,
  model?: string,
): ModelCosts {
  if (!(isFastModeEnabled() && fastMode)) {
    return COST_TIER_5_25
  }
  // densable GHt(e). When model omitted (e.g. /fast UI defaulting to Opus 5),
  // treat as opus-5 → u7n — densable /fast copy is Opus 5, not LIc fallthrough.
  if (!model) {
    return COST_TIER_10_50
  }
  const shortName = toCostCanonical(model)
  const opus5 = firstPartyNameToCanonical(CLAUDE_OPUS_5_CONFIG.firstParty)
  const opus48 = firstPartyNameToCanonical(CLAUDE_OPUS_4_8_CONFIG.firstParty)
  if (shortName === opus5 || shortName === opus48) {
    return COST_TIER_10_50
  }
  return COST_TIER_30_150
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
  // densable: sonnet 3.5/3.7/4/4.5/4.6/5 → "tier_3_15"
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
  // Sonnet 5 list = tier_3_15; promotional $2/$10 is UI-only (not billing).
  [firstPartyNameToCanonical(CLAUDE_SONNET_5_CONFIG.firstParty)]:
    COST_TIER_3_15,
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

/**
 * densable Dji — USD cost from token usage + model cost configuration.
 */
function tokensToUSDCost(modelCosts: ModelCosts, usage: Usage): number {
  return (
    (usage.input_tokens / 1_000_000) * modelCosts.inputTokens +
    (usage.output_tokens / 1_000_000) * modelCosts.outputTokens +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
      modelCosts.promptCacheReadTokens +
    cacheCreationUSDCost(modelCosts, usage) +
    (usage.server_tool_use?.web_search_requests ?? 0) *
      modelCosts.webSearchRequests
  )
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
  // densable Pji: r=lo(e) — alias/override resolve then QO short name
  const shortName = toCostCanonical(model)
  const isFast = usage.speed === 'fast'

  const opus5 = firstPartyNameToCanonical(CLAUDE_OPUS_5_CONFIG.firstParty)
  const opus48 = firstPartyNameToCanonical(CLAUDE_OPUS_4_8_CONFIG.firstParty)
  const opus46 = firstPartyNameToCanonical(CLAUDE_OPUS_4_6_CONFIG.firstParty)
  const opus47 = firstPartyNameToCanonical(CLAUDE_OPUS_4_7_CONFIG.firstParty)

  if (isFast && (shortName === opus5 || shortName === opus48)) {
    return COST_TIER_10_50
  }
  if (isFast && (shortName === opus46 || shortName === opus47)) {
    return COST_TIER_30_150
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
  const modelCosts = getModelCosts(resolvedModel, usage)
  return tokensToUSDCost(modelCosts, usage)
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
