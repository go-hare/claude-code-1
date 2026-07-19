/**
 * densable amber_rokovoko / amber_moleskin residual — pure precompute buffer fraction.
 *
 * densable:
 *   lJi = 0.2 default scalar (tengu_amber_rokovoko)
 *   dJi()  — clamp GB scalar ∈ [0, 1)
 *   aEu/Ckg/oEu — parse window-size table from tengu_amber_moleskin
 *   lEu    — exact window match or default entry
 *   hJi    — resolve {fraction, source, matchedWindowKey?}
 *   Hkg    — fraction only
 *   cJi    — precompute arm token threshold from effective window + fraction
 *
 * Full wire into autoCompact threshold remains denser; pure helpers match densable.
 */

/** densable lJi — default precompute buffer fraction. */
export const DEFAULT_PRECOMPUTE_BUFFER_FRACTION = 0.2

/** densable AUTOCOMPACT_BUFFER_TOKENS used by cto (13k). */
export const PRECOMPUTE_AUTOCOMPACT_BUFFER_TOKENS = 13_000

/** densable fEu / warn band offset — compactThreshold - 20k → warn. */
export const CONTEXT_USAGE_WARN_BAND_TOKENS = 20_000

/** densable sEu — default blocking headroom under raw model window (3k). */
export const CONTEXT_USAGE_DEFAULT_BLOCKING_HEADROOM = 3_000

export type PrecomputeSurfaceFractions = {
  repl: number
  sdk: number
}

export type PrecomputeBufferTable = {
  entries: Array<{ windowSize: number } & PrecomputeSurfaceFractions>
  defaultEntry: PrecomputeSurfaceFractions | null
}

export type PrecomputeFractionSource =
  | 'scalar'
  | 'malformed'
  | 'table_no_match'
  | 'table_exact'
  | 'table_default'

export type PrecomputeFractionResolution = {
  fraction: number
  source: PrecomputeFractionSource
  matchedWindowKey?: number
}

/** densable oEu — finite fraction in [0, 1). */
export function parsePrecomputeSurfaceFraction(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  if (raw < 0 || raw >= 1) return null
  return raw
}

/** densable Ckg — {repl, sdk} entry. */
export function parsePrecomputeSurfaceEntry(
  raw: unknown,
): PrecomputeSurfaceFractions | null {
  if (typeof raw !== 'object' || raw === null) return null
  const t = raw as Record<string, unknown>
  const repl = parsePrecomputeSurfaceFraction(t.repl)
  const sdk = parsePrecomputeSurfaceFraction(t.sdk)
  if (repl === null || sdk === null) return null
  return { repl, sdk }
}

/** densable aEu — window table payload (keys: "default" | positive window size). */
export function parsePrecomputeBufferTable(
  raw: unknown,
): PrecomputeBufferTable | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const entries: PrecomputeBufferTable['entries'] = []
  let defaultEntry: PrecomputeSurfaceFractions | null = null
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = parsePrecomputeSurfaceEntry(value)
    if (entry === null) return null
    if (key === 'default') {
      defaultEntry = entry
      continue
    }
    const windowSize = Number(key)
    if (!Number.isSafeInteger(windowSize) || windowSize <= 0) return null
    entries.push({ windowSize, ...entry })
  }
  if (entries.length === 0 && defaultEntry === null) return null
  return { entries, defaultEntry }
}

/** densable lEu — exact window match or default. */
export function matchPrecomputeBufferTableEntry(
  table: PrecomputeBufferTable,
  windowSize: number,
):
  | { kind: 'exact'; entry: PrecomputeSurfaceFractions & { windowSize: number } }
  | { kind: 'default'; entry: PrecomputeSurfaceFractions }
  | null {
  const exact = table.entries.find(e => e.windowSize === windowSize)
  if (exact !== undefined) {
    return { kind: 'exact', entry: exact }
  }
  if (table.defaultEntry === null) return null
  return { kind: 'default', entry: table.defaultEntry }
}

/**
 * densable dJi — clamp scalar GB (amber_rokovoko) to [0, 1); else default 0.2.
 */
export function clampPrecomputeScalarFraction(
  raw: unknown,
  fallback: number = DEFAULT_PRECOMPUTE_BUFFER_FRACTION,
): number {
  if (
    typeof raw === 'number' &&
    Number.isFinite(raw) &&
    raw >= 0 &&
    raw < 1
  ) {
    return raw
  }
  return fallback
}

/**
 * densable hJi pure half — resolve fraction from scalar or moleskin table.
 * Does not read GrowthBook; callers inject gb values.
 */
export function resolvePrecomputeBufferFraction(input: {
  /** tengu_amber_moleskin payload (table or null). */
  moleskin?: unknown
  /** tengu_amber_rokovoko scalar fallback. */
  rokovokoScalar?: unknown
  /** Effective auto-compact window size (tokens). */
  windowSize: number
  /** densable querySource "sdk" → sdk surface; else repl. */
  querySource?: string | null
}): PrecomputeFractionResolution {
  const scalar = clampPrecomputeScalarFraction(input.rokovokoScalar)
  if (input.moleskin === null || input.moleskin === undefined) {
    return { fraction: scalar, source: 'scalar' }
  }
  const table = parsePrecomputeBufferTable(input.moleskin)
  if (table === null) {
    return { fraction: scalar, source: 'malformed' }
  }
  const matched = matchPrecomputeBufferTableEntry(table, input.windowSize)
  if (matched === null) {
    return { fraction: scalar, source: 'table_no_match' }
  }
  const surface = input.querySource === 'sdk' ? 'sdk' : 'repl'
  const fraction = matched.entry[surface]
  if (matched.kind === 'exact') {
    return {
      fraction,
      source: 'table_exact',
      matchedWindowKey: matched.entry.windowSize,
    }
  }
  return { fraction, source: 'table_default' }
}

/**
 * densable cto — autocompact threshold from effective window + optional pct override.
 */
export function autocompactThresholdFromWindow(input: {
  effectiveWindow: number
  testPctOverride?: number
  bufferTokens?: number
}): number {
  const buffer = input.bufferTokens ?? PRECOMPUTE_AUTOCOMPACT_BUFFER_TOKENS
  const base = input.effectiveWindow - buffer
  const n = input.testPctOverride
  if (n !== undefined && !Number.isNaN(n) && n > 0 && n <= 100) {
    return Math.min(Math.floor(input.effectiveWindow * (n / 100)), base)
  }
  return base
}

/**
 * densable cJi — precompute arm threshold: min(window - frac*window, autocompactThreshold).
 */
export function precomputeArmTokenThreshold(input: {
  effectiveWindow: number
  precomputeBufferFraction: number
  testPctOverride?: number
}): number {
  const auto = autocompactThresholdFromWindow({
    effectiveWindow: input.effectiveWindow,
    testPctOverride: input.testPctOverride,
  })
  return Math.min(
    input.effectiveWindow -
      Math.round(input.effectiveWindow * input.precomputeBufferFraction),
    auto,
  )
}

/**
 * densable Hkg / hJi live half — read moleskin + rokovoko GB, resolve fraction.
 * Malformed moleskin logs tengu_precompute_arm_table_malformed once per process
 * (Ikg) when analytics is available.
 */
let precomputeMoleskinMalformedLogged = false

export function resolveLivePrecomputeBufferFraction(input: {
  windowSize: number
  querySource?: string | null
}): PrecomputeFractionResolution {
  let moleskin: unknown = null
  let rokovoko: unknown = DEFAULT_PRECOMPUTE_BUFFER_FRACTION
  try {
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    moleskin = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_amber_moleskin',
      null,
    )
    rokovoko = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_amber_rokovoko',
      DEFAULT_PRECOMPUTE_BUFFER_FRACTION,
    )
  } catch {
    // growthbook unavailable in pure unit tests
  }

  const resolved = resolvePrecomputeBufferFraction({
    moleskin,
    rokovokoScalar: rokovoko,
    windowSize: input.windowSize,
    querySource: input.querySource,
  })

  if (resolved.source === 'malformed' && !precomputeMoleskinMalformedLogged) {
    precomputeMoleskinMalformedLogged = true
    try {
      const { logEvent } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/analytics/index.js') as typeof import('../services/analytics/index.js')
      const payloadType = Array.isArray(moleskin)
        ? 'array'
        : typeof moleskin
      logEvent('tengu_precompute_arm_table_malformed', {
        payloadType:
          payloadType as import('../services/analytics/index.js').AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } catch {
      // analytics optional
    }
  }

  return resolved
}

/** densable Hkg live — fraction only. */
export function livePrecomputeBufferFraction(input: {
  windowSize: number
  querySource?: string | null
}): number {
  return resolveLivePrecomputeBufferFraction(input).fraction
}

/** densable gJi pure half — build arm/threshold options from fraction + env. */
export function buildPrecomputeThresholdOptions(input: {
  windowSize: number
  querySource?: string | null
  autoCompactEnabled: boolean
  env?: NodeJS.ProcessEnv
}): {
  enabled: boolean
  precomputeBufferFraction: number
  testPctOverride?: number
  testBlockingOverride?: number
  fractionSource: PrecomputeFractionSource
  matchedWindowKey?: number
} {
  const env = input.env ?? process.env
  const frac = resolveLivePrecomputeBufferFraction({
    windowSize: input.windowSize,
    querySource: input.querySource,
  })
  const pctRaw = env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  const pct = pctRaw ? parseFloat(pctRaw) : Number.NaN
  const blockRaw = env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE
  const block = blockRaw ? parseInt(blockRaw, 10) : Number.NaN
  return {
    enabled: input.autoCompactEnabled,
    precomputeBufferFraction: frac.fraction,
    fractionSource: frac.source,
    ...(frac.matchedWindowKey !== undefined
      ? { matchedWindowKey: frac.matchedWindowKey }
      : {}),
    ...(!Number.isNaN(pct) && pct > 0 && pct <= 100
      ? { testPctOverride: pct }
      : {}),
    ...(!Number.isNaN(block) && block > 0
      ? { testBlockingOverride: block }
      : {}),
  }
}
