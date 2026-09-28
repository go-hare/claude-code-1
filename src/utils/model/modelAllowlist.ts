import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from '../settings/settings.js'
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
  // densable Vr: deniedModels always win, even when availableModels allows.
  if (isModelDeniedByPolicy(model)) {
    return false
  }
  const settings = getSettings_DEPRECATED() || {}
  const { availableModels } = settings
  if (!availableModels) {
    return true // No restrictions
  }
  if (availableModels.length === 0) {
    return false // Empty allowlist blocks all user-specified models
  }
  // densable Vr exact: ignored-only list leaves no usable entries → deny all
  if (isAvailableModelsExactMatch()) {
    const usable = availableModels.filter(
      s => parsePolicyModelEntry(s).kind !== 'ignored',
    )
    if (usable.length === 0) {
      return false
    }
  }
  // densable h_: exact-match list that names at least one non-ignored entry
  // rejects models that miss the list (prefix wildcards still apply to family).
  if (isBlockedByExactAllowlist(model)) {
    return false
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
  // "claude-opus-4-5-20251101" at a segment boundary.
  // densable exact: same version (canonical) only — "claude-opus-5" does not
  // allow "claude-opus-5-5".
  const exact = isAvailableModelsExactMatch()
  for (const entry of normalizedAllowlist) {
    if (!isModelFamilyAlias(entry) && !isModelAlias(entry)) {
      if (exact) {
        if (modelMatchesExactAllowlistEntry(normalizedModel, entry)) {
          return true
        }
      } else if (modelMatchesVersionPrefix(normalizedModel, entry)) {
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

const POLICY_FAMILY_ALIASES = ['sonnet', 'opus', 'haiku', 'fable'] as const

const POLICY_IGNORED_ALIASES = new Set([
  'best',
  'opusplan',
  'sonnet[1m]',
  'opus[1m]',
  'fable[1m]',
])

const BEDROCK_REGION_PREFIXES = [
  'us',
  'eu',
  'apac',
  'jp',
  'au',
  'us-gov',
  'global',
] as const

const BARE_TRAILER_OK =
  /^(?:-fast|-latest)?(?:-v\d{1,3}@\d{8}|[-@]\d{8})?(?:-v\d{1,3}(?::\d{1,3})?)?$/

function stripContextSizeTag(value: string): string {
  return value.replace(/\[(1|2)m\]/gi, '')
}

/** densable Qt — strip a trailing [1m] tag only (Y1t / Bx). */
function stripTrailingOneM(value: string): string {
  return value.replace(/\[1m\]$/i, '')
}

export type PolicyModelIdentity = {
  family: string
  major: number
  minor?: number
  legacyVersionFirst: boolean
  base: string
  trailer?: string
  date?: string
}

/**
 * densable Af / d — parse a Claude model spelling into family/major/minor +
 * trailer. Used by Y1t latest/spelling and e$o prefix deny.
 */
export function parseClaudeModelIdentity(
  raw: string,
): PolicyModelIdentity | null {
  let n = raw.trim().toLowerCase()
  if (n === '' || /\s/.test(n)) return null
  n = n.replace(/\[[12]m\]$/, '')
  const slash = n.lastIndexOf('/')
  if (slash !== -1) n = n.slice(slash + 1)
  const region = /^(?:([a-z-]+)\.)?anthropic\.(claude-.*)$/.exec(n)
  if (region) {
    const prefix = region[1]
    const rest = region[2] ?? ''
    if (
      prefix !== undefined &&
      !(BEDROCK_REGION_PREFIXES as readonly string[]).includes(prefix)
    ) {
      return null
    }
    n = rest
  }
  const parsed = parseClaudeVersionBase(n)
  if (!parsed) return null
  const rest = n.slice(parsed.base.length)
  if (rest !== '' && !/^[-@]/.test(rest)) return null
  const identity: PolicyModelIdentity = {
    family: parsed.family,
    major: parsed.major,
    legacyVersionFirst: parsed.legacyVersionFirst,
    base: parsed.base,
  }
  if (parsed.minor !== undefined) identity.minor = parsed.minor
  if (!BARE_TRAILER_OK.test(rest)) {
    identity.trailer = rest
  } else {
    const date = /(?:-v\d+@|[-@])(\d{8})/.exec(rest)?.[1]
    if (date !== undefined) identity.date = date
  }
  return identity
}

function parseClaudeVersionBase(n: string): {
  family: string
  major: number
  minor?: number
  legacyVersionFirst: boolean
  base: string
} | null {
  const modern = /^claude-([a-z]+)-(\d{1,2})(?!\d)(?:-(\d{1,2})(?!\d))?/.exec(n)
  if (modern) {
    const [base, family = '', major = '', minor] = modern
    return {
      family,
      major: Number(major),
      minor: minor === undefined ? undefined : Number(minor),
      legacyVersionFirst: false,
      base,
    }
  }
  const legacy = /^claude-(\d{1,2})(?!\d)(?:-(\d{1,2})(?!\d))?-([a-z]+)/.exec(n)
  if (legacy) {
    const [base, major = '', minor, family = ''] = legacy
    return {
      family,
      major: Number(major),
      minor: minor === undefined ? undefined : Number(minor),
      legacyVersionFirst: true,
      base,
    }
  }
  return null
}

/** densable w2r — spelling ends in -latest after the version base. */
function isLatestSpelling(
  spelling: string,
  identity: PolicyModelIdentity,
): boolean {
  if (identity.trailer !== undefined) return false
  const idx = spelling.toLowerCase().lastIndexOf(identity.base)
  if (idx === -1) return false
  return spelling
    .toLowerCase()
    .slice(idx + identity.base.length)
    .startsWith('-latest')
}

/**
 * densable e$o — denied model identity matches a candidate, including
 * unsuffixed major blocking later minors (opus-5 → opus-5-5).
 */
function deniedIdentityMatches(
  denied: PolicyModelIdentity,
  candidate: PolicyModelIdentity,
): boolean {
  if (denied.family !== candidate.family || denied.major !== candidate.major) {
    return false
  }
  if (denied.minor !== undefined && (candidate.minor ?? 0) !== denied.minor) {
    return false
  }
  if (denied.trailer === undefined) return true
  const t = candidate.trailer ?? ''
  return t === denied.trailer || t.startsWith(`${denied.trailer}-`)
}

type PolicyListEntry =
  | { kind: 'ignored' }
  | { kind: 'family'; family: string }
  | { kind: 'literal'; value: string }
  | {
      kind: 'model'
      id: PolicyModelIdentity
      latest: boolean
      spelling: string
    }

/**
 * densable n$o — exact availableModelsMatch: same version (Z9e) + same
 * trailer, and a -latest spelling only matches a latest entry.
 */
function exactPolicyModelMatches(
  entry: Extract<PolicyListEntry, { kind: 'model' }>,
  candidate: PolicyModelIdentity,
  spelling: string,
): boolean {
  if (entry.id.family !== candidate.family) return false
  if (entry.id.legacyVersionFirst !== candidate.legacyVersionFirst) {
    return false
  }
  if (entry.id.major !== candidate.major) return false
  if ((entry.id.minor ?? 0) !== (candidate.minor ?? 0)) return false
  if ((entry.id.trailer ?? '') !== (candidate.trailer ?? '')) return false
  const candidateLatest = isLatestSpelling(spelling, candidate)
  if (candidateLatest && !entry.latest) return false
  return true
}

function policySettings() {
  try {
    return getSettingsForSource('policySettings')
  } catch {
    return null
  }
}

/** densable xO — managed availableModelsMatch === "exact". */
export function isAvailableModelsExactMatch(): boolean {
  return policySettings()?.availableModelsMatch === 'exact'
}

function isPolicyFamilyAlias(value: string): boolean {
  return (POLICY_FAMILY_ALIASES as readonly string[]).includes(value)
}

/**
 * densable Y1t — classify an availableModels / deniedModels spelling.
 * Empty ignored; family aliases; default/ug ignored; else model with
 * identity + latest + spelling.
 */
export function parsePolicyModelEntry(raw: string): PolicyListEntry {
  const n = stripTrailingOneM(raw.trim().toLowerCase())
  if (n === '') return { kind: 'ignored' }
  if (isPolicyFamilyAlias(n)) return { kind: 'family', family: n }
  const stripped = n.startsWith('claude-') ? n.slice(7) : ''
  if (isPolicyFamilyAlias(stripped)) {
    return { kind: 'family', family: stripped }
  }
  if (isModelAlias(n) || POLICY_IGNORED_ALIASES.has(n) || n === 'default') {
    return { kind: 'ignored' }
  }
  const spelling =
    parseClaudeModelIdentity(n) !== null || n.startsWith('claude-')
      ? n
      : `claude-${n}`
  const identity = parseClaudeModelIdentity(spelling)
  if (identity !== null) {
    return {
      kind: 'model',
      id: identity,
      latest: isLatestSpelling(spelling, identity),
      spelling,
    }
  }
  return { kind: 'literal', value: n }
}

function modelMatchesExactAllowlistEntry(
  model: string,
  entry: string,
): boolean {
  const parsed = parsePolicyModelEntry(entry)
  if (parsed.kind === 'ignored') return false
  if (parsed.kind === 'family') {
    return modelBelongsToFamily(model, parsed.family)
  }
  if (parsed.kind === 'literal') {
    return stripContextSizeTag(model.trim().toLowerCase()) === parsed.value
  }
  const spelling = stripTrailingOneM(model.trim().toLowerCase())
  const candidate =
    parseClaudeModelIdentity(spelling) ??
    (spelling.startsWith('claude-')
      ? null
      : parseClaudeModelIdentity(`claude-${spelling}`))
  if (candidate === null) return false
  return exactPolicyModelMatches(parsed, candidate, spelling)
}

function deniedEntryMatches(
  entry: PolicyListEntry,
  model: string,
  familyHint: string | undefined,
): boolean {
  switch (entry.kind) {
    case 'ignored':
      return false
    case 'literal':
      return stripContextSizeTag(model.trim().toLowerCase()) === entry.value
    case 'family':
      return (
        familyHint === entry.family ||
        familyTokenAtBoundary(model, entry.family)
      )
    case 'model': {
      const candidate = parseClaudeModelIdentity(model)
      if (candidate === null) return false
      return deniedIdentityMatches(entry.id, candidate)
    }
  }
}

type DeniedPolicy = {
  entries: PolicyListEntry[]
  overrideMaps: Array<Record<string, string>>
}

const EMPTY_DENIED: DeniedPolicy = { entries: [], overrideMaps: [] }

function loadDeniedModelsPolicy(): DeniedPolicy {
  const policy = policySettings()
  const denied = policy?.deniedModels
  if (denied === undefined || denied.length === 0) {
    return EMPTY_DENIED
  }
  const entries = denied
    .map(parsePolicyModelEntry)
    .filter((e): e is Exclude<PolicyListEntry, { kind: 'ignored' }> => {
      return e.kind !== 'ignored'
    })
  const overrideMaps = [policy?.modelOverrides].filter(
    (m): m is Record<string, string> => m !== undefined,
  )
  return { entries, overrideMaps }
}

/**
 * densable Zhe — deniedModels blocks this model (managed policySettings).
 */
export function isModelDeniedByPolicy(model: string): boolean {
  const { entries, overrideMaps } = loadDeniedModelsPolicy()
  if (entries.length === 0) return false
  const stripped = stripContextSizeTag(model.trim())
  const resolved = resolveOverriddenModel(stripped)
  const names = new Set([stripped.toLowerCase(), resolved.trim().toLowerCase()])
  for (const map of overrideMaps) {
    for (const [from, to] of Object.entries(map)) {
      for (const n of names) {
        if (to.toLowerCase() === n || familyTokenAtBoundary(to, n)) {
          names.add(from.trim().toLowerCase())
        }
      }
    }
  }
  for (const name of names) {
    const canonical = getCanonicalName(name)
    const family = pickerFamilyFromCanonical(canonical)
    if (entries.some(e => deniedEntryMatches(e, name, family))) {
      return true
    }
  }
  return false
}

function pickerFamilyFromCanonical(canonical: string): string | undefined {
  const t = canonical.toLowerCase()
  if (t.includes('fable')) return 'fable'
  if (t.includes('mythos')) return 'mythos'
  if (t.includes('opus')) return 'opus'
  if (t.includes('sonnet')) return 'sonnet'
  if (t.includes('haiku')) return 'haiku'
  return undefined
}

/**
 * densable h_ — exact availableModels list misses this model.
 */
export function isBlockedByExactAllowlist(model: string): boolean {
  const policy = policySettings()
  if (policy?.availableModelsMatch !== 'exact') return false
  const list = policy.availableModels
  if (
    list === undefined ||
    list.every(s => parsePolicyModelEntry(s).kind === 'ignored')
  ) {
    return false
  }
  return !isModelAllowedIgnoringExactGate(model, list)
}

function isModelAllowedIgnoringExactGate(
  model: string,
  allowlist: string[],
): boolean {
  const resolvedModel = resolveOverriddenModel(model)
  const normalizedModel = resolvedModel.trim().toLowerCase()
  const normalizedAllowlist = allowlist.map(m => m.trim().toLowerCase())
  if (normalizedAllowlist.includes(normalizedModel)) {
    if (
      !isModelFamilyAlias(normalizedModel) ||
      !familyHasSpecificEntries(normalizedModel, normalizedAllowlist)
    ) {
      return true
    }
  }
  for (const entry of normalizedAllowlist) {
    if (
      isModelFamilyAlias(entry) &&
      !familyHasSpecificEntries(entry, normalizedAllowlist) &&
      modelBelongsToFamily(normalizedModel, entry)
    ) {
      return true
    }
  }
  if (isModelAlias(normalizedModel)) {
    const resolved = parseUserSpecifiedModel(normalizedModel).toLowerCase()
    if (normalizedAllowlist.includes(resolved)) return true
  }
  for (const entry of normalizedAllowlist) {
    if (!isModelFamilyAlias(entry) && isModelAlias(entry)) {
      const resolved = parseUserSpecifiedModel(entry).toLowerCase()
      if (resolved === normalizedModel) return true
    }
  }
  for (const entry of normalizedAllowlist) {
    if (!isModelFamilyAlias(entry) && !isModelAlias(entry)) {
      if (modelMatchesExactAllowlistEntry(normalizedModel, entry)) {
        return true
      }
    }
  }
  return false
}

/** densable y_ — denied OR exact-allow miss. */
export function isModelBlockedByPolicy(model: string): boolean {
  return isModelDeniedByPolicy(model) || isBlockedByExactAllowlist(model)
}

/**
 * densable ZO — first availableModels entry that can serve as a default
 * after family walk in Gu fails. Family aliases pick newestAllowedModelInFamily;
 * ignored aliases are skipped; concrete spellings must pass isModelAllowed.
 */
export function firstAllowedPolicyListedModel(
  isAllowed: (model: string) => boolean = isModelAllowed,
): string | null {
  let available: string[] | undefined
  let exact = false
  try {
    const policy = policySettings()
    available = policy?.availableModels
    exact = policy?.availableModelsMatch === 'exact'
  } catch {
    return null
  }
  for (const raw of available ?? []) {
    const n = raw.trim().toLowerCase()
    if (n === '') continue
    const parsed = parsePolicyModelEntry(raw)
    if (parsed.kind === 'family') {
      const newest = newestAllowedModelInFamily(parsed.family, isAllowed)
      if (newest !== null) return newest
      continue
    }
    if (parsed.kind === 'ignored') continue
    const stripped = n.replace(/^claude-/, '')
    if (
      exact &&
      parsed.kind === 'literal' &&
      isPolicyFamilyAlias(stripped)
    ) {
      const newest = newestAllowedModelInFamily(stripped, isAllowed)
      if (newest !== null) return newest
      continue
    }
    const spelling =
      parsed.kind === 'model'
        ? parsed.spelling
        : parsed.kind === 'literal'
          ? parsed.value
          : n
    if (isAllowed(spelling)) return spelling
  }
  return null
}

function isPolicyBlockedDefault(setting: string): boolean {
  try {
    return isModelBlockedByPolicy(setting)
  } catch {
    // densable gs: unreadable policy treats the default as blocked
    return true
  }
}

function isEntitlementDeniedDefault(setting: string): boolean {
  try {
    const { isModelDenied } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./entitlementOverlay.js') as typeof import('./entitlementOverlay.js')
    return isModelDenied(setting)
  } catch {
    return false
  }
}

/**
 * densable Gu — when the resolved default is entitlement-denied or
 * policy-blocked, walk opus → sonnet → haiku from the current family
 * (fable starts at opus; unknown starts at sonnet). Then ZO.
 * Returns null when no substitute exists (RH then fatals at bootstrap).
 */
export function stepDownBlockedDefaultModel(
  setting: string,
  isAllowed: (model: string) => boolean = isModelAllowed,
): string | null {
  const entitlementDenied = isEntitlementDeniedDefault(setting)
  const policyBlocked = isPolicyBlockedDefault(setting)
  if (!entitlementDenied && !policyBlocked) return null

  const {
    getCanonicalName,
    getDefaultHaikuModel,
    getDefaultOpusModel,
    getDefaultSonnetModel,
    parseUserSpecifiedModel,
  } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./model.js') as typeof import('./model.js')

  const families = [
    { family: 'opus', model: getDefaultOpusModel() },
    { family: 'sonnet', model: getDefaultSonnetModel() },
    { family: 'haiku', model: getDefaultHaikuModel() },
  ] as const
  const canonical = getCanonicalName(
    parseUserSpecifiedModel(setting),
  ).toLowerCase()
  let start = families.findIndex(f => canonical.includes(f.family))
  if (start === -1) {
    // densable ih(At(e)) — fable (not in the walk) starts at opus; else sonnet
    start = canonical.startsWith('claude-fable-') ? 0 : 1
  }
  for (const { family, model } of families.slice(start)) {
    if (isAllowed(model)) return model
    const newest = newestAllowedModelInFamily(family, isAllowed)
    if (newest !== null) return newest
  }
  if (!policyBlocked) return null
  const listed = firstAllowedPolicyListedModel(isAllowed)
  if (listed === null) {
    try {
      const { logForDebugging } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../debug.js') as typeof import('../debug.js')
      logForDebugging(
        `managed settings (deniedModels or an exact-match availableModels) block the default model ${setting} and every model it could fall back to`,
        { level: 'warn' },
      )
    } catch {
      // debug import is optional in tests
    }
  }
  return listed
}

/**
 * densable RH — start/switch copy when org policy blocks the default and
 * there is no allowed substitute.
 */
export function formatDeniedModelsBlockMessage(
  model: string,
  phase: 'start' | 'switch' = 'start',
): string | null {
  let denied: boolean
  let exactMiss: boolean
  try {
    denied = isModelDeniedByPolicy(model)
    exactMiss = !denied && isBlockedByExactAllowlist(model)
  } catch {
    return phase === 'start'
      ? null
      : "Can't switch to the default model: Claude Code couldn't read your organization's managed settings to check which models they allow. Restart Claude Code; if this keeps happening, ask your administrator to check the managed settings."
  }
  const shown = stripContextSizeTag(model.trim())
  if (exactMiss) {
    return `${phase === 'start' ? "Claude Code can't start" : "Can't switch to the default model"}: your organization allows only the models listed in "availableModels", and none of them can be used as the default model (${shown} isn't listed). Ask your administrator to update "availableModels".`
  }
  if (!denied) return null
  return `${
    phase === 'start'
      ? `Claude Code can't start: your organization's managed settings block the default model (${shown}) in "deniedModels"`
      : `Can't switch to the default model: your organization's managed settings block it (${shown}) in "deniedModels"`
  }, and none of the models they allow can be used as the default instead. Ask your administrator to update "deniedModels" or "availableModels".`
}

/**
 * densable dTe — helper/side-query model remapped when denied.
 * Callers that already have a fallback should pass it; otherwise the
 * request model is returned unchanged when not denied.
 */
export function remapDeniedHelperModel(
  model: string,
  fallback: string,
): string {
  if (!isModelDeniedByPolicy(model)) return model
  return fallback
}
