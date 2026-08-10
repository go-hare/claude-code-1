import { getSettings_DEPRECATED } from '../settings/settings.js'
import { isModelAlias, isModelFamilyAlias } from './aliases.js'
import { ALL_MODEL_CONFIGS, type ModelKey } from './configs.js'
import { getCanonicalName, parseUserSpecifiedModel } from './model.js'
import { resolveOverriddenModel } from './modelStrings.js'

/**
 * Check if a model belongs to a given family by checking if its name
 * (or resolved name) contains the family identifier.
 */
function modelBelongsToFamily(model: string, family: string): boolean {
  if (model.includes(family)) {
    return true
  }
  // Resolve aliases like "best" → "claude-opus-4-6" to check family membership
  if (isModelAlias(model)) {
    const resolved = parseUserSpecifiedModel(model).toLowerCase()
    return resolved.includes(family)
  }
  return false
}

/**
 * Check if a model name starts with a prefix at a segment boundary.
 * The prefix must match up to the end of the name or a "-" separator.
 * e.g. "claude-opus-4-5" matches "claude-opus-4-5-20251101" but not "claude-opus-4-50".
 */
function prefixMatchesModel(modelName: string, prefix: string): boolean {
  if (!modelName.startsWith(prefix)) {
    return false
  }
  return modelName.length === prefix.length || modelName[prefix.length] === '-'
}

/**
 * Check if a model matches a version-prefix entry in the allowlist.
 * Supports shorthand like "opus-4-5" (mapped to "claude-opus-4-5") and
 * full prefixes like "claude-opus-4-5". Resolves input aliases before matching.
 */
function modelMatchesVersionPrefix(model: string, entry: string): boolean {
  // Resolve the input model to a full name if it's an alias
  const resolvedModel = isModelAlias(model)
    ? parseUserSpecifiedModel(model).toLowerCase()
    : model

  // Try the entry as-is (e.g. "claude-opus-4-5")
  if (prefixMatchesModel(resolvedModel, entry)) {
    return true
  }
  // Try with "claude-" prefix (e.g. "opus-4-5" → "claude-opus-4-5")
  if (
    !entry.startsWith('claude-') &&
    prefixMatchesModel(resolvedModel, `claude-${entry}`)
  ) {
    return true
  }
  return false
}

/**
 * Check if a family alias is narrowed by more specific entries in the allowlist.
 * When the allowlist contains both "opus" and "opus-4-5", the specific entry
 * takes precedence — "opus" alone would be a wildcard, but "opus-4-5" narrows
 * it to only that version.
 */
function familyHasSpecificEntries(
  family: string,
  allowlist: string[],
): boolean {
  for (const entry of allowlist) {
    if (isModelFamilyAlias(entry)) {
      continue
    }
    // Check if entry is a version-qualified variant of this family
    // e.g., "opus-4-5" or "claude-opus-4-5-20251101" for the "opus" family
    // Must match at a segment boundary (followed by '-' or end) to avoid
    // false positives like "opusplan" matching "opus"
    const idx = entry.indexOf(family)
    if (idx === -1) {
      continue
    }
    const afterFamily = idx + family.length
    if (afterFamily === entry.length || entry[afterFamily] === '-') {
      return true
    }
  }
  return false
}

/**
 * Check if a model is allowed by the availableModels allowlist in settings.
 * If availableModels is not set, all models are allowed.
 *
 * Matching tiers:
 * 1. Family aliases ("opus", "sonnet", "haiku") — wildcard for the entire family,
 *    UNLESS more specific entries for that family also exist (e.g., "opus-4-5").
 *    In that case, the family wildcard is ignored and only the specific entries apply.
 * 2. Version prefixes ("opus-4-5", "claude-opus-4-5") — any build of that version
 * 3. Full model IDs ("claude-opus-4-5-20251101") — exact match only
 */
export function isModelAllowed(model: string): boolean {
  const settings = getSettings_DEPRECATED() || {}
  const { availableModels } = settings
  if (!availableModels) {
    return true // No restrictions
  }
  if (availableModels.length === 0) {
    return false // Empty allowlist blocks all user-specified models
  }

  const resolvedModel = resolveOverriddenModel(model)
  const normalizedModel = resolvedModel.trim().toLowerCase()
  const normalizedAllowlist = availableModels.map(m => m.trim().toLowerCase())

  // Direct match (alias-to-alias or full-name-to-full-name)
  // Skip family aliases that have been narrowed by specific entries —
  // e.g., "opus" in ["opus", "opus-4-5"] should NOT directly match,
  // because the admin intends to restrict to opus 4.5 only.
  if (normalizedAllowlist.includes(normalizedModel)) {
    if (
      !isModelFamilyAlias(normalizedModel) ||
      !familyHasSpecificEntries(normalizedModel, normalizedAllowlist)
    ) {
      return true
    }
  }

  // Family-level aliases in the allowlist match any model in that family,
  // but only if no more specific entries exist for that family.
  // e.g., ["opus"] allows all opus, but ["opus", "opus-4-5"] only allows opus 4.5.
  for (const entry of normalizedAllowlist) {
    if (
      isModelFamilyAlias(entry) &&
      !familyHasSpecificEntries(entry, normalizedAllowlist) &&
      modelBelongsToFamily(normalizedModel, entry)
    ) {
      return true
    }
  }

  // For non-family entries, do bidirectional alias resolution
  // If model is an alias, resolve it and check if the resolved name is in the list
  if (isModelAlias(normalizedModel)) {
    const resolved = parseUserSpecifiedModel(normalizedModel).toLowerCase()
    if (normalizedAllowlist.includes(resolved)) {
      return true
    }
  }

  // If any non-family alias in the allowlist resolves to the input model
  for (const entry of normalizedAllowlist) {
    if (!isModelFamilyAlias(entry) && isModelAlias(entry)) {
      const resolved = parseUserSpecifiedModel(entry).toLowerCase()
      if (resolved === normalizedModel) {
        return true
      }
    }
  }

  // Version-prefix matching: "opus-4-5" or "claude-opus-4-5" matches
  // "claude-opus-4-5-20251101" at a segment boundary
  for (const entry of normalizedAllowlist) {
    if (!isModelFamilyAlias(entry) && !isModelAlias(entry)) {
      if (modelMatchesVersionPrefix(normalizedModel, entry)) {
        return true
      }
    }
  }

  return false
}

/**
 * densable Lts — family token match at non-alnum boundaries
 * (avoids "opus" matching inside "opusplan").
 */
export function familyTokenAtBoundary(
  haystack: string,
  family: string,
): boolean {
  const h = haystack.toLowerCase()
  const f = family.toLowerCase()
  let from = 0
  while (from <= h.length) {
    const idx = h.indexOf(f, from)
    if (idx === -1) return false
    const beforeOk = idx === 0 || !/[a-z0-9]/i.test(h[idx - 1] ?? '')
    const after = idx + f.length
    const afterOk = after === h.length || !/[a-z0-9]/i.test(h[after] ?? '')
    if (beforeOk && afterOk) return true
    from = idx + 1
  }
  return false
}

/**
 * densable K7r — newest firstParty catalog model in family that passes isAllowed.
 * Walks ALL_MODEL_CONFIGS keys reverse (newest registered last).
 */
export function newestAllowedModelInFamily(
  family: string,
  isAllowed: (model: string) => boolean = isModelAllowed,
): string | null {
  const keys = Object.keys(ALL_MODEL_CONFIGS) as ModelKey[]
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i]
    if (key === undefined) continue
    const firstParty = ALL_MODEL_CONFIGS[key].firstParty
    if (
      familyTokenAtBoundary(getCanonicalName(firstParty), family) &&
      isAllowed(firstParty)
    ) {
      return firstParty
    }
  }
  return null
}

/**
 * densable a$ / stepDownRestrictedFamilyAliasPick.
 * When org availableModels restricts models, bare family aliases step down to
 * the newest allowlisted model in that family (not parent inherit).
 * Returns null when no restriction applies or no family member is allowed.
 */
export function stepDownRestrictedFamilyAliasPick(
  alias: string,
  isAllowed: (model: string) => boolean = isModelAllowed,
): string | null {
  const trimmed = alias.trim().toLowerCase()
  const bare = trimmed.replace(/\[1m\]$/i, '').trim()
  if (!isModelFamilyAlias(bare)) return null

  const settings = getSettings_DEPRECATED() || {}
  // densable: if no availableModels and empty entitlement deny set → null
  if (!settings.availableModels) return null

  const newest = newestAllowedModelInFamily(bare, isAllowed)
  if (newest === null || !isAllowed(newest)) return null

  // densable: bare alias (no [1m]) returns model as-is
  if (bare === trimmed) return newest
  // With [1m] tag: keep suffix on eligible families (opus/sonnet)
  if (bare === 'haiku') return newest
  return `${newest}[1m]`
}
