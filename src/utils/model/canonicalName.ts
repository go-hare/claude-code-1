/**
 * Pure leaf module for canonicalizing first-party / provider Claude model names.
 * Kept import-free to avoid ESM circular TDZ cycles between
 * modelCatalogCapabilities.ts -> model.ts -> modelCost.ts -> modelCatalogCapabilities.ts.
 */

/**
 * densable 2.1.314 uer — normalize dot-spelled model versions like
 * `claude-opus-4.8` to `claude-opus-4-8` before canonical matching.
 */
export function normalizeDotVersionedModelName(name: string): string {
  return name.replace(/(claude-(?:[a-z]+-)?\d{1,2})\.(?=\d)/g, '$1-')
}

// @[MODEL LAUNCH]: Add a canonical name mapping for the new model below.
/**
 * Pure string-match that strips date/provider suffixes from a first-party model
 * name. Input must already be a 1P-format ID (e.g. 'claude-3-7-sonnet-20250219',
 * 'us.anthropic.claude-opus-4-6-v1:0'). Does not touch settings, so safe at
 * module top-level (see MODEL_COSTS in modelCost.ts).
 */
export function firstPartyNameToCanonical(name: string): string {
  name = normalizeDotVersionedModelName(name.toLowerCase())
  // densable ix(e): more-specific 5-2/5-1/5-5 before unsuffixed family (#1845)
  if (name.includes('claude-fable-5-2')) {
    return 'claude-fable-5-2'
  }
  if (name.includes('claude-fable-5-1')) {
    return 'claude-fable-5-1'
  }
  if (name.includes('claude-fable-5')) {
    return 'claude-fable-5'
  }
  if (name.includes('claude-mythos-5-2')) {
    return 'claude-mythos-5-2'
  }
  if (name.includes('claude-mythos-5-1')) {
    return 'claude-mythos-5-1'
  }
  if (name.includes('claude-mythos-5')) {
    return 'claude-mythos-5'
  }
  // Special cases for Claude 4+ models to differentiate versions
  // Order matters: check more specific versions first (5-5 before 5, 4-8 before 4)
  if (name.includes('claude-opus-5-5')) {
    return 'claude-opus-5-5'
  }
  if (name.includes('claude-opus-5')) {
    return 'claude-opus-5'
  }
  // densable 2.1.217: claude-opus-4-8 must not fall through to 'claude-opus-4'
  // (Bedrock us.anthropic.claude-opus-4-8 includes "claude-opus-4").
  if (name.includes('claude-opus-4-8')) {
    return 'claude-opus-4-8'
  }
  if (name.includes('claude-opus-4-7')) {
    return 'claude-opus-4-7'
  }
  if (name.includes('claude-opus-4-6')) {
    return 'claude-opus-4-6'
  }
  if (name.includes('claude-opus-4-5')) {
    return 'claude-opus-4-5'
  }
  if (name.includes('claude-opus-4-1')) {
    return 'claude-opus-4-1'
  }
  // densable QO: exact catalog id claude-opus-4-0 before bare-4 regex
  // (regex /claude-opus-4(?!-\d(?!\d))/ does NOT match "...-4-0")
  if (name.includes('claude-opus-4-0')) {
    return 'claude-opus-4-0'
  }
  // densable QO: bare/dated opus-4 → claude-opus-4-0
  if (/claude-opus-4(?!-\d(?!\d))/.test(name)) {
    return 'claude-opus-4-0'
  }
  // densable QO / 2.1.289: 5-5 before bare sonnet-5 (includes would mis-hit)
  if (name.includes('claude-sonnet-5-5')) {
    return 'claude-sonnet-5-5'
  }
  if (name.includes('claude-sonnet-5')) {
    return 'claude-sonnet-5'
  }
  if (name.includes('claude-sonnet-4-6')) {
    return 'claude-sonnet-4-6'
  }
  if (name.includes('claude-sonnet-4-5')) {
    return 'claude-sonnet-4-5'
  }
  if (name.includes('claude-sonnet-4-0')) {
    return 'claude-sonnet-4-0'
  }
  // densable QO: bare/dated sonnet-4 → claude-sonnet-4-0
  if (/claude-sonnet-4(?!-\d(?!\d))/.test(name)) {
    return 'claude-sonnet-4-0'
  }
  if (name.includes('claude-haiku-5-5')) {
    return 'claude-haiku-5-5'
  }
  if (name.includes('claude-haiku-4-5')) {
    return 'claude-haiku-4-5'
  }
  // Claude 3.x models use a different naming scheme (claude-3-{family})
  if (name.includes('claude-3-7-sonnet')) {
    return 'claude-3-7-sonnet'
  }
  if (name.includes('claude-3-5-sonnet')) {
    return 'claude-3-5-sonnet'
  }
  if (name.includes('claude-3-5-haiku')) {
    return 'claude-3-5-haiku'
  }
  if (name.includes('claude-3-opus')) {
    return 'claude-3-opus'
  }
  if (name.includes('claude-3-sonnet')) {
    return 'claude-3-sonnet'
  }
  if (name.includes('claude-3-haiku')) {
    return 'claude-3-haiku'
  }
  // densable QO final: strip trailing -YYYYMMDD date suffix, else identity
  return name.replace(/-\d{8}$/, '')
}
