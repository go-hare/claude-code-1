/**
 * densable 2.1.214 #15 — GrowthBook null / malformed payload must not crash
 * or wipe cached feature flags.
 *
 * densable RUc (processRemoteEvalPayload):
 *   - empty features → false (no wipe)
 *   - skip null / non-object feature defs (log once)
 *   - skip malformed experiment entries (log once)
 *   - skip value-less (undefined) entries (log once)
 *   - if no values remain → false (no wipe)
 *   - only then replace in-memory maps
 *
 * densable nji:
 *   e === null ? defaultValue : e
 *   (explicit null feature value falls back to caller default)
 */

export type RemoteEvalFeatureDef = {
  value?: unknown
  defaultValue?: unknown
  source?: string
  experimentResult?: { variationId?: number }
  experiment?: { key?: string }
  [key: string]: unknown
}

export type ProcessedExperiment = {
  experimentId: string
  variationId: number
}

export type ProcessRemoteEvalFeaturesResult =
  | { ok: false; reason: 'empty_payload' | 'no_values' }
  | {
      ok: true
      features: Record<string, RemoteEvalFeatureDef>
      values: Map<string, unknown>
      experiments: Map<string, ProcessedExperiment>
      nonDefaultKeys: Set<string>
      skippedNonObject: string[]
      skippedMalformedExperiment: string[]
      skippedValueLess: string[]
    }

/**
 * densable nji(e,t){return e===null?t:e}
 */
export function coalesceNullFeatureValue<T>(
  value: unknown,
  defaultValue: T,
): T {
  return value === null ? defaultValue : (value as T)
}

/**
 * Pure densable RUc feature-object processing (before setPayload / map swap).
 */
export function processRemoteEvalFeatures(
  features: Record<string, unknown> | null | undefined,
): ProcessRemoteEvalFeaturesResult {
  if (!features || Object.keys(features).length === 0) {
    return { ok: false, reason: 'empty_payload' }
  }

  const transformed: Record<string, RemoteEvalFeatureDef> = {}
  const experiments = new Map<string, ProcessedExperiment>()
  const nonDefaultKeys = new Set<string>()
  const skippedNonObject: string[] = []
  const skippedMalformedExperiment: string[] = []

  for (const [key, raw] of Object.entries(features)) {
    // densable: if (d===null||typeof d!=="object") { i.push(...); continue }
    if (raw === null || typeof raw !== 'object') {
      skippedNonObject.push(`${key}:${raw === null ? 'null' : typeof raw}`)
      continue
    }
    const d = raw as RemoteEvalFeatureDef
    if ('value' in d && !('defaultValue' in d)) {
      transformed[key] = { ...d, defaultValue: d.value }
    } else {
      transformed[key] = d
    }

    if (d.source === 'experiment' && d.experimentResult) {
      const expResult = d.experimentResult
      const exp = d.experiment
      if (
        typeof exp?.key === 'string' &&
        typeof expResult.variationId === 'number'
      ) {
        experiments.set(key, {
          experimentId: exp.key,
          variationId: expResult.variationId,
        })
      } else {
        skippedMalformedExperiment.push(
          `${key}:key=${typeof exp?.key},variationId=${typeof expResult.variationId}`,
        )
      }
    }
    // densable G8n: source not defaultValue/unknownFeature/undefined
    if (
      d.source !== undefined &&
      d.source !== 'defaultValue' &&
      d.source !== 'unknownFeature'
    ) {
      nonDefaultKeys.add(key)
    }
  }

  const values = new Map<string, unknown>()
  const skippedValueLess: string[] = []
  for (const [key, u] of Object.entries(transformed)) {
    const v = 'value' in u ? u.value : u.defaultValue
    if (v !== undefined) {
      values.set(key, v)
    } else {
      experiments.delete(key)
      nonDefaultKeys.delete(key)
      delete transformed[key]
      skippedValueLess.push(key)
    }
  }

  // densable: if (a.size===0) return !1  — do not wipe prior cache
  if (values.size === 0) {
    return { ok: false, reason: 'no_values' }
  }

  return {
    ok: true,
    features: transformed,
    values,
    experiments,
    nonDefaultKeys,
    skippedNonObject,
    skippedMalformedExperiment,
    skippedValueLess,
  }
}
