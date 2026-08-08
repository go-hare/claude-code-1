// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import type { Theme } from './theme.js'
import { feature } from 'bun:bundle'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { resolveAntModel } from './model/antModels.js'
import { modelHasCatalogCapability } from './model/modelCatalogCapabilities.js'
import { firstPartyNameToCanonical } from './model/model.js'
import { get3PModelCapabilityOverride } from './model/modelSupportOverrides.js'
import { getAPIProvider } from './model/providers.js'
import { getSettingsWithErrors } from './settings/settings.js'

export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }

/**
 * Build-time gate (feature) + runtime gate (GrowthBook). The build flag
 * controls code inclusion in external builds; the GB flag controls rollout.
 */
export function isUltrathinkEnabled(): boolean {
  if (!feature('ULTRATHINK')) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_turtle_carbon', true)
}

/**
 * Check if text contains the "ultrathink" keyword.
 */
export function hasUltrathinkKeyword(text: string): boolean {
  return /\bultrathink\b/i.test(text)
}

/**
 * Find positions of "ultrathink" keyword in text (for UI highlighting/notification)
 */
export function findThinkingTriggerPositions(text: string): Array<{
  word: string
  start: number
  end: number
}> {
  const positions: Array<{ word: string; start: number; end: number }> = []
  // Fresh /g literal each call — String.prototype.matchAll copies lastIndex
  // from the source regex, so a shared instance would leak state from
  // hasUltrathinkKeyword's .test() into this call on the next render.
  const matches = text.matchAll(/\bultrathink\b/gi)

  for (const match of matches) {
    if (match.index !== undefined) {
      positions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  return positions
}

const RAINBOW_COLORS: Array<keyof Theme> = [
  'rainbow_red',
  'rainbow_orange',
  'rainbow_yellow',
  'rainbow_green',
  'rainbow_blue',
  'rainbow_indigo',
  'rainbow_violet',
]

const RAINBOW_SHIMMER_COLORS: Array<keyof Theme> = [
  'rainbow_red_shimmer',
  'rainbow_orange_shimmer',
  'rainbow_yellow_shimmer',
  'rainbow_green_shimmer',
  'rainbow_blue_shimmer',
  'rainbow_indigo_shimmer',
  'rainbow_violet_shimmer',
]

export function getRainbowColor(
  charIndex: number,
  shimmer: boolean = false,
): keyof Theme {
  const colors = shimmer ? RAINBOW_SHIMMER_COLORS : RAINBOW_COLORS
  return colors[charIndex % colors.length]!
}

/**
 * densable `lo`/QO short id for capability probes (IQt/HQt/T5i).
 * Prefer firstPartyNameToCanonical so bare/dated ids match EHl catalog ids
 * (e.g. claude-opus-4-… → claude-opus-4-0).
 */
function densableLoCanonical(model: string): string {
  return firstPartyNameToCanonical(
    model
      .replace(/\[1m\]/gi, '')
      .trim()
      .toLowerCase(),
  )
}

/**
 * densable hj(e) — unknown-model capability default.
 * densable: firstParty || anthropicAws || anthropicGoogleCloud || foundry || mantle.
 * Local provider enum has firstParty/foundry (c5/mantle not separate API providers).
 */
function densableUnknownModelCapabilityDefault(): boolean {
  const provider = getAPIProvider()
  return provider === 'firstParty' || provider === 'foundry'
}

// TODO(inigo): add support for probing unknown models via API error detection
// densable T5i(e): Tde(e,"thinking") ?? !lo(e).includes("claude-3-")
export function modelSupportsThinking(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'thinking')
  if (supported3P !== undefined) {
    return supported3P
  }
  if (process.env.USER_TYPE === 'ant') {
    if (resolveAntModel(model.toLowerCase())) {
      return true
    }
  }
  // IMPORTANT: Do not change thinking support without notifying the model
  // launch DRI and research. This can greatly affect model quality and bashing.
  // densable T5i: any non-claude-3 model supports thinking (all providers).
  return !densableLoCanonical(model).includes('claude-3-')
}

/**
 * densable HQt(e) — model rejects disabled thinking (must send thinking).
 * Known Claude catalog ids return false; ON(rejects_disabled_thinking) or
 * unknown → provider default. Only fable-5 has the cap in 2.1.219 EHl.
 */
export function modelRejectsDisabledThinking(model: string): boolean {
  const r = densableLoCanonical(model)
  if (
    r.includes('claude-3-') ||
    r === 'claude-opus-4-0' ||
    r === 'claude-opus-4-1' ||
    r === 'claude-opus-4-5' ||
    r === 'claude-opus-4-6' ||
    r === 'claude-opus-4-7' ||
    r === 'claude-opus-4-8' ||
    r === 'claude-opus-5' ||
    r === 'claude-sonnet-4-0' ||
    r === 'claude-sonnet-4-5' ||
    r === 'claude-sonnet-4-6' ||
    r === 'claude-sonnet-5' ||
    r === 'claude-haiku-4-5'
  ) {
    return false
  }
  if (modelHasCatalogCapability(r, 'rejects_disabled_thinking') === true) {
    return true
  }
  return densableUnknownModelCapabilityDefault()
}

/**
 * densable kQt(e) — [thinkingOverride, budgetHint].
 * HQt → [undefined, 2048]; else [false, 0].
 *
 * Local shape: used by side-query classifiers (yolo auto_mode) that want to
 * disable thinking. Main claude.ts path does not use this tuple — it builds
 * ThinkingConfig → Beta thinking and historically omits the field when off
 * rather than densable's explicit `{type:'disabled'}` firstParty branch.
 */
export function densableThinkingForceParams(
  model: string,
): [boolean | undefined, number] {
  if (modelRejectsDisabledThinking(model)) {
    return [undefined, 2048]
  }
  return [false, 0]
}

/**
 * densable ur for tool_choice demotion:
 *   Bo.type in {enabled,adaptive} || (Bo === undefined && HQt(model))
 *
 * Local: pass assembled wire `thinking` (or undefined). When HQt and the
 * field is omitted, treat as thinking-active so tool_choice:{type:'tool'}
 * is demoted to auto (API rejects tool forcing with thinking).
 */
export function isThinkingActiveForToolChoice(
  thinking: { type?: string } | undefined,
  model: string,
): boolean {
  if (thinking?.type === 'enabled' || thinking?.type === 'adaptive') {
    return true
  }
  return thinking === undefined && modelRejectsDisabledThinking(model)
}

/**
 * Whether callers may send `{ type: 'disabled' }` for this model.
 * densable HQt models reject it (400). Local residual env DISABLE_THINKING
 * is handled by callers separately — this is model capability only.
 */
export function maySendDisabledThinking(model: string): boolean {
  return !modelRejectsDisabledThinking(model)
}

/**
 * densable IQt(e) — adaptive thinking support.
 *   Tde(e,"adaptive_thinking") 3P override
 *   deny: claude-3-* | opus-4-0|4-1|4-5 | sonnet-4-0|4-5 | haiku-4-5
 *   ON(adaptive_thinking) || mythos-5 → true
 *   else hj(ny(e))
 */
export function modelSupportsAdaptiveThinking(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'adaptive_thinking')
  if (supported3P !== undefined) {
    return supported3P
  }
  const r = densableLoCanonical(model)
  if (
    r.includes('claude-3-') ||
    r === 'claude-opus-4-0' ||
    r === 'claude-opus-4-1' ||
    r === 'claude-opus-4-5' ||
    r === 'claude-sonnet-4-0' ||
    r === 'claude-sonnet-4-5' ||
    r === 'claude-haiku-4-5'
  ) {
    return false
  }
  // densable: ON(r,"adaptive_thinking") || r==="claude-mythos-5"
  if (
    modelHasCatalogCapability(r, 'adaptive_thinking') === true ||
    r === 'claude-mythos-5'
  ) {
    return true
  }
  // IMPORTANT: Do not change adaptive thinking support without notifying the
  // model launch DRI and research. densable falls through to hj(ny) for unknown.
  return densableUnknownModelCapabilityDefault()
}

export function shouldEnableThinkingByDefault(): boolean {
  if (process.env.MAX_THINKING_TOKENS) {
    return parseInt(process.env.MAX_THINKING_TOKENS, 10) > 0
  }

  const { settings } = getSettingsWithErrors()
  if (settings.alwaysThinkingEnabled === false) {
    return false
  }

  // IMPORTANT: Do not change default thinking enabled value without notifying
  // the model launch DRI and research. This can greatly affect model quality and
  // bashing.

  // Enable thinking by default unless explicitly disabled.
  return true
}
