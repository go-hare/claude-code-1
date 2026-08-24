/**
 * Effort catalog: one row per model (or specific family id).
 *
 * densable 2.1.211 Claude slice (R0.default_effort + capabilities) plus
 * fork-only OpenAI / Grok / Kimi / DeepSeek rows. Matching is longest-substring
 * on canonical name and raw model id — not by provider.
 *
 * Add a model = add a row. Do not invent global heuristics per vendor.
 * Unknown models fall through to providerDefaultsEffortSupport + default "high".
 */

import type { EffortLevel } from 'src/entrypoints/sdk/runtimeTypes.js'
import { getCanonicalName } from './model.js'
import { getAPIProvider } from './providers.js'

export type EffortCatalogEntry = {
  /** Catalog default when user has no session/env override. */
  defaultEffort: EffortLevel
  /** false = model does not take effort / reasoning_effort */
  effort: boolean
  maxEffort: boolean
  xhighEffort: boolean
  /**
   * Exclusive supported ladder (subset of EffortLevel), ordered low→max.
   * When set, UI/API clamp use this list instead of densable
   * low/medium/high + max/xhigh flags.
   * Use for non-Claude ladders (Grok 3-tier, Kimi low/high/max, DeepSeek high/max).
   */
  levels?: readonly EffortLevel[]
}

/**
 * Per-model rules. Prefer more specific match strings (longer wins).
 * Example: `gpt-5.6-sol` beats bare `gpt-5.6`.
 */
const CATALOG: Array<{ match: string; entry: EffortCatalogEntry }> = [
  // ── densable Claude ───────────────────────────────────────────────────
  {
    match: 'claude-sonnet-4-6',
    entry: {
      defaultEffort: 'high',
      effort: true,
      maxEffort: true,
      xhighEffort: false,
    },
  },
  {
    match: 'claude-sonnet-5',
    entry: {
      defaultEffort: 'high',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    match: 'claude-opus-4-6',
    entry: {
      // densable R0 omits default_effort → LQe "high"; xhigh denylisted.
      defaultEffort: 'high',
      effort: true,
      maxEffort: true,
      xhighEffort: false,
    },
  },
  {
    match: 'claude-opus-4-7',
    entry: {
      defaultEffort: 'xhigh',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    match: 'claude-opus-4-8',
    entry: {
      defaultEffort: 'high',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  // densable EHl 2.1.219: claude-opus-5 default_effort high + effort/max/xhigh
  // (Ave launch pin remains 4-7 / 4-8 / fable-5 only — not opus-5)
  {
    match: 'claude-opus-5',
    entry: {
      defaultEffort: 'high',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    match: 'claude-fable-5',
    entry: {
      defaultEffort: 'high',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    match: 'claude-mythos-5',
    entry: {
      defaultEffort: 'high',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },

  // ── OpenAI GPT-5.x (API: model-dependent none…max; our EffortLevel omits none) ──
  // Product ultra multi-agent is NOT an EffortLevel.
  {
    match: 'gpt-5.6-sol',
    entry: {
      defaultEffort: 'medium',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    match: 'gpt-5.6-terra',
    entry: {
      defaultEffort: 'medium',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    match: 'gpt-5.6-luna',
    entry: {
      defaultEffort: 'medium',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    // bare gpt-5.6 (no -sol/-terra/-luna) — only if no more specific row matched
    match: 'gpt-5.6',
    entry: {
      defaultEffort: 'medium',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    match: 'gpt-5.5',
    entry: {
      // Official default medium; max/xhigh treated as available until model card narrows.
      defaultEffort: 'medium',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    match: 'gpt-5.4-mini',
    entry: {
      defaultEffort: 'medium',
      effort: true,
      maxEffort: false,
      xhighEffort: true,
    },
  },
  {
    match: 'gpt-5.4-pro',
    entry: {
      defaultEffort: 'medium',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    match: 'gpt-5.4',
    entry: {
      defaultEffort: 'medium',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    match: 'gpt-5.3-codex-spark',
    entry: {
      defaultEffort: 'medium',
      effort: true,
      maxEffort: false,
      xhighEffort: true,
    },
  },
  {
    match: 'gpt-5.3-codex',
    entry: {
      defaultEffort: 'medium',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    match: 'gpt-5.2-pro',
    entry: {
      defaultEffort: 'medium',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    match: 'gpt-5.2-codex',
    entry: {
      defaultEffort: 'medium',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },
  {
    match: 'gpt-5.2',
    entry: {
      defaultEffort: 'medium',
      effort: true,
      maxEffort: true,
      xhighEffort: true,
    },
  },

  // ── xAI Grok ──────────────────────────────────────────────────────────
  // https://docs.x.ai/developers/model-capabilities/text/reasoning
  // Per-model rows (longest-substring on id). grok-4.6 does not contain
  // "grok-4.5" — add a row, do not invent a vendor heuristic.
  // Official 2026-08-12: grok-4.6 low|medium|high|xhigh (default high);
  // grok-4.5 stays 3-tier (xhigh treated as high by xAI). Cannot disable.
  // Do not add a bare `grok-4` or `grok-4.20` row: `grok-4.20-multi-agent`
  // has xhigh (agent-count, not depth).
  {
    match: 'grok-4.20-multi-agent',
    entry: {
      defaultEffort: 'high',
      effort: true,
      maxEffort: false,
      xhighEffort: true,
      levels: ['low', 'medium', 'high', 'xhigh'],
    },
  },
  {
    match: 'grok-4.20-reasoning',
    entry: {
      defaultEffort: 'high',
      effort: true,
      maxEffort: false,
      xhighEffort: false,
      levels: ['low', 'medium', 'high'],
    },
  },
  {
    match: 'grok-4.6',
    entry: {
      defaultEffort: 'high',
      effort: true,
      maxEffort: false,
      xhighEffort: true,
      levels: ['low', 'medium', 'high', 'xhigh'],
    },
  },
  {
    match: 'grok-4.5',
    entry: {
      defaultEffort: 'high',
      effort: true,
      maxEffort: false,
      xhighEffort: false,
      levels: ['low', 'medium', 'high'],
    },
  },

  // ── Moonshot Kimi ─────────────────────────────────────────────────────
  // K3: reasoning_effort low | high | max; default max.
  // https://platform.kimi.ai/docs/guide/kimi-k3-quickstart
  {
    match: 'kimi-k3',
    entry: {
      defaultEffort: 'max',
      effort: true,
      maxEffort: true,
      xhighEffort: false,
      levels: ['low', 'high', 'max'],
    },
  },
  // K2.7 Code: thinking always on, no graded effort.
  // https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart
  {
    match: 'kimi-k2.7',
    entry: {
      defaultEffort: 'high',
      effort: false,
      maxEffort: false,
      xhighEffort: false,
    },
  },

  // ── DeepSeek V4 ───────────────────────────────────────────────────────
  // True API values: high | max (default high). low/medium→high, xhigh→max.
  // https://api-docs.deepseek.com/guides/thinking_mode
  {
    match: 'deepseek-v4-pro',
    entry: {
      defaultEffort: 'high',
      effort: true,
      maxEffort: true,
      xhighEffort: false,
      levels: ['high', 'max'],
    },
  },
  {
    match: 'deepseek-v4-flash',
    entry: {
      defaultEffort: 'high',
      effort: true,
      maxEffort: true,
      xhighEffort: false,
      levels: ['high', 'max'],
    },
  },
  {
    // bare deepseek-v4 → same ladder as pro family
    match: 'deepseek-v4',
    entry: {
      defaultEffort: 'high',
      effort: true,
      maxEffort: true,
      xhighEffort: false,
      levels: ['high', 'max'],
    },
  },
]

/**
 * densable kk denylist — no effort param.
 *
 * densable patterns use `claude-*-4-0`; our `getCanonicalName` collapses
 * bare/dated 4.0 → `claude-opus-4` / `claude-sonnet-4` (no `-0`). Those
 * bare canonicals must match **exactly** — never via includes(), or
 * `claude-opus-4` would also deny `claude-opus-4-6` / `4-7`.
 */
const EFFORT_DENY_EXACT = ['claude-opus-4', 'claude-sonnet-4'] as const
const EFFORT_DENY_INCLUDES = [
  'claude-3-',
  'claude-opus-4-0',
  'claude-opus-4-1',
  'claude-sonnet-4-0',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
] as const

/** densable h4e denylist — no max */
const MAX_DENY_EXACT = ['claude-opus-4', 'claude-sonnet-4'] as const
const MAX_DENY_INCLUDES = [
  'claude-3-',
  'claude-opus-4-0',
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-sonnet-4-0',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
] as const

/** densable ume denylist — no xhigh */
const XHIGH_DENY_EXACT = ['claude-opus-4', 'claude-sonnet-4'] as const
const XHIGH_DENY_INCLUDES = [
  'claude-3-',
  'claude-opus-4-0',
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-sonnet-4-0',
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const

function matchesDenyList(
  id: string,
  exact: readonly string[],
  includes: readonly string[],
): boolean {
  if ((exact as readonly string[]).includes(id)) return true
  return includes.some(p => id.includes(p) || id === p)
}

/**
 * Longest-match lookup on one or more id strings (canonical + raw).
 * Example: raw `gpt-5.6-sol` matches sol row even if canonical is odd.
 */
function lookupCatalogFromIds(
  ids: readonly string[],
): EffortCatalogEntry | undefined {
  let best: EffortCatalogEntry | undefined
  let bestLen = -1
  for (const id of ids) {
    if (!id) continue
    for (const row of CATALOG) {
      if (
        (id.includes(row.match) || id === row.match) &&
        row.match.length > bestLen
      ) {
        best = row.entry
        bestLen = row.match.length
      }
    }
  }
  return best
}

export function getEffortCanonical(model: string): string {
  try {
    return getCanonicalName(model).toLowerCase()
  } catch {
    return model.toLowerCase()
  }
}

function catalogIdsFor(model: string): string[] {
  const raw = model.toLowerCase().replace(/\[1m\]$/i, '')
  const canonical = getEffortCanonical(model)
  // unique, prefer both so OpenAI ids match even if canonical is Claude-shaped
  return raw === canonical ? [raw] : [raw, canonical]
}

export function lookupEffortCatalog(
  model: string,
): EffortCatalogEntry | undefined {
  return lookupCatalogFromIds(catalogIdsFor(model))
}

/**
 * densable LQe — catalog default_effort ?? "high"
 * Call only after modelSupportsEffort (cme gates on kk first).
 */
export function getCatalogDefaultEffort(model: string): EffortLevel {
  return lookupEffortCatalog(model)?.defaultEffort ?? 'high'
}

export function catalogHasEffort(model: string): boolean | undefined {
  const entry = lookupEffortCatalog(model)
  if (!entry) return undefined
  return entry.effort
}

export function catalogHasMaxEffort(model: string): boolean | undefined {
  const entry = lookupEffortCatalog(model)
  if (!entry) return undefined
  if (entry.levels) return entry.levels.includes('max')
  return entry.maxEffort
}

export function catalogHasXhighEffort(model: string): boolean | undefined {
  const entry = lookupEffortCatalog(model)
  if (!entry) return undefined
  if (entry.levels) return entry.levels.includes('xhigh')
  return entry.xhighEffort
}

/**
 * Explicit ladder from catalog when the model has a row.
 * - effort:false → []
 * - levels set → that list
 * - else densable-style low/medium/high + optional xhigh/max flags
 * - no row → undefined (caller uses denylist + provider defaults)
 */
export function catalogSupportedLevels(
  model: string,
): EffortLevel[] | undefined {
  const entry = lookupEffortCatalog(model)
  if (!entry) return undefined
  if (!entry.effort) return []
  if (entry.levels) return [...entry.levels]
  const levels: EffortLevel[] = ['low', 'medium', 'high']
  if (entry.xhighEffort) levels.push('xhigh')
  if (entry.maxEffort) levels.push('max')
  return levels
}

export function isEffortDenyListed(model: string): boolean {
  // Check both raw + canonical so densable `*-4-0` patterns and collapsed
  // bare `claude-*-4` (dated 4.0) both hit without over-matching `*-4-6`.
  const ids = catalogIdsFor(model)
  return ids.some(id =>
    matchesDenyList(id, EFFORT_DENY_EXACT, EFFORT_DENY_INCLUDES),
  )
}

export function isMaxEffortDenyListed(model: string): boolean {
  const ids = catalogIdsFor(model)
  return ids.some(id => matchesDenyList(id, MAX_DENY_EXACT, MAX_DENY_INCLUDES))
}

export function isXhighEffortDenyListed(model: string): boolean {
  const ids = catalogIdsFor(model)
  return ids.some(id =>
    matchesDenyList(id, XHIGH_DENY_EXACT, XHIGH_DENY_INCLUDES),
  )
}

/**
 * densable Uq(Nb(model)) — Anthropic-style providers default true for unknown.
 */
export function providerDefaultsEffortSupport(
  provider = getAPIProvider(),
): boolean {
  return (
    provider === 'firstParty' ||
    provider === 'anthropicAws' ||
    provider === 'foundry' ||
    provider === 'mantle'
  )
}

// ─── Launch pin (densable Ave / N9 via St/pr → GlobalConfig) ────────────────
// densable stores unpin* on global config (St()/pr()), not React AppState and
// not a process-only module variable. Once N9 runs, pins stay released across
// CLI restarts until config is cleared/reset.

function readLaunchPinFlags(): {
  unpinOpus47LaunchEffort: boolean
  unpinOpus48LaunchEffort: boolean
  unpinFable5LaunchEffort: boolean
} {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getGlobalConfig } =
      require('../config.js') as typeof import('../config.js')
    const c = getGlobalConfig()
    return {
      unpinOpus47LaunchEffort: c.unpinOpus47LaunchEffort === true,
      unpinOpus48LaunchEffort: c.unpinOpus48LaunchEffort === true,
      unpinFable5LaunchEffort: c.unpinFable5LaunchEffort === true,
    }
  } catch {
    return {
      unpinOpus47LaunchEffort: false,
      unpinOpus48LaunchEffort: false,
      unpinFable5LaunchEffort: false,
    }
  }
}

/** densable Ave — true while launch default is pinned for this model family. */
export function isEffortLaunchPinned(model: string): boolean {
  const flags = readLaunchPinFlags()
  const c = getEffortCanonical(model)
  if (c.includes('opus-4-7')) return !flags.unpinOpus47LaunchEffort
  if (c.includes('opus-4-8')) return !flags.unpinOpus48LaunchEffort
  if (c.includes('fable-5')) return !flags.unpinFable5LaunchEffort
  return false
}

/**
 * densable pGo — all three unpin* launch pins are true (user has released
 * launch defaults). /tui nMr only carries `--effort` when this is true.
 */
export function areAllEffortLaunchPinsUnpinned(): boolean {
  const flags = readLaunchPinFlags()
  return (
    flags.unpinOpus47LaunchEffort &&
    flags.unpinOpus48LaunchEffort &&
    flags.unpinFable5LaunchEffort
  )
}

/** densable N9 — user changed effort; unpin all launch defaults (persisted). */
export function unpinAllEffortLaunchPins(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { saveGlobalConfig } =
      require('../config.js') as typeof import('../config.js')
    saveGlobalConfig(e => {
      if (
        e.unpinOpus47LaunchEffort === true &&
        e.unpinOpus48LaunchEffort === true &&
        e.unpinFable5LaunchEffort === true
      ) {
        return e
      }
      return {
        ...e,
        unpinOpus47LaunchEffort: true,
        unpinOpus48LaunchEffort: true,
        unpinFable5LaunchEffort: true,
      }
    })
  } catch {
    // isolated tests / early bootstrap without config
  }
}

/** Test-only: restore densable p0e defaults (all pins active). */
export function resetEffortLaunchPinsForTests(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { saveGlobalConfig } =
      require('../config.js') as typeof import('../config.js')
    saveGlobalConfig(e => ({
      ...e,
      unpinOpus47LaunchEffort: false,
      unpinOpus48LaunchEffort: false,
      unpinFable5LaunchEffort: false,
    }))
  } catch {
    // isolated tests without config
  }
}

// ─── Org maxEffortLevel (densable S8t / wve / qOr) ──────────────────────────

export type ModelAccessCacheEntry = {
  apiName: string
  entitled: boolean
  maxEffortLevel?: EffortLevel
}

/**
 * densable qOr — bootstrap model_access cache (firstParty/gateway org allowlist).
 * Filters invalid rows; only string apiName + boolean entitled.
 */
export function getModelAccessCache(): ModelAccessCacheEntry[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getGlobalConfig } =
      require('../config.js') as typeof import('../config.js')
    const raw = getGlobalConfig().modelAccessCache
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (t): t is ModelAccessCacheEntry =>
        t != null &&
        typeof t === 'object' &&
        typeof (t as ModelAccessCacheEntry).apiName === 'string' &&
        typeof (t as ModelAccessCacheEntry).entitled === 'boolean',
    )
  } catch {
    return []
  }
}

/**
 * densable S8t — org maxEffortLevel for model, only firstParty/gateway.
 * Match densable: canonical(See(model)) === canonical(See(apiName)).
 */
export function getOrgMaxEffortLevel(model: string): EffortLevel | null {
  const provider = getAPIProvider()
  if (provider !== 'firstParty' && provider !== 'gateway') {
    return null
  }
  const target = getCanonicalName(model.trim().toLowerCase())
  const row = getModelAccessCache().find(
    o => getCanonicalName(o.apiName.trim().toLowerCase()) === target,
  )
  const n = row?.maxEffortLevel
  if (
    n === 'low' ||
    n === 'medium' ||
    n === 'high' ||
    n === 'xhigh' ||
    n === 'max'
  ) {
    return n
  }
  return null
}

/**
 * densable HQe — ladder rank for org clamp (cH order).
 */
export function effortLadderRank(level: EffortLevel): number {
  return (['low', 'medium', 'high', 'xhigh', 'max'] as const).indexOf(level)
}

/**
 * densable g4e — level is within org maxEffortLevel (or no org cap).
 */
export function isEffortWithinOrgLimit(
  level: EffortLevel,
  model: string,
): boolean {
  const cap = getOrgMaxEffortLevel(model)
  if (cap === null) return true
  return effortLadderRank(level) <= effortLadderRank(cap)
}

/**
 * densable MDe-shaped filter: keep levels ≤ org maxEffortLevel.
 * densable MDe filters full cH; callers pass capability-supported levels.
 */
export function filterEffortLevelsByOrgLimit(
  levels: readonly EffortLevel[],
  model: string,
): EffortLevel[] {
  return levels.filter(level => isEffortWithinOrgLimit(level, model))
}

/**
 * densable S8t / wve — org maxEffortLevel clamp.
 * When org sets maxEffortLevel for this model (firstParty/gateway), clamp
 * higher levels down to that cap. No cache / non-Anthropic provider → no-op.
 */
export function clampEffortToOrgLimit(
  level: EffortLevel,
  model: string,
): EffortLevel {
  const cap = getOrgMaxEffortLevel(model)
  if (cap === null) return level
  if (effortLadderRank(level) > effortLadderRank(cap)) {
    return cap
  }
  return level
}
