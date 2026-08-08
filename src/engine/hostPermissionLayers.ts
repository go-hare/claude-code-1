/**
 * densable 2.1.218 #11 S8o sticky → permissionLayers (Me turn apply).
 *
 * densable (SEA ~239140592):
 *   U = pending model
 *   W = pending permission mode (skipped when hostOwnsPermissionMode / D)
 *   $ = pending max_thinking_tokens
 *   G = pending flag_settings
 *   se = seed_read_state Map<path, seed>
 *
 * On each turn, after queryParams builder:
 *   permissionLayers =
 *     sticky present
 *       ? [...existing, model?, permission_mode?, max_thinking_tokens?, flag_settings?]
 *       : existing
 *   seed map merges into toolUseContext.readFileState (newer timestamp wins)
 */

export type HostPermissionLayer =
  | { kind: 'model'; mainLoopModel: string }
  | { kind: 'permission_mode'; mode: string }
  | {
      kind: 'max_thinking_tokens'
      maxThinkingTokens: number | null | undefined
    }
  | { kind: 'flag_settings'; settings: Record<string, unknown> }
  | { kind: 'effort'; effort: unknown }
  | { kind: 'working_directory'; directory: string }
  | { kind: 'allowed_tools'; allowedTools: unknown }
  /** densable bn also walks these; sticky Me does not emit them */
  | { kind: 'disallowed_tools'; disallowedTools: unknown }
  | { kind: 'avoid_prompts' }

export type HostStickyControlState = {
  model: string | null
  permissionMode: string | null
  maxThinkingTokens: number | null | undefined
  flagSettings: Record<string, unknown> | null
}

export type BuildHostPermissionLayersInput = {
  sticky: HostStickyControlState
  /** densable D / hostOwnsPermissionMode — when true, omit permission_mode layer */
  hostOwnsPermissionMode?: boolean
}

/** densable sticky → layer array (empty when nothing latched). */
export function buildHostPermissionLayers(
  input: BuildHostPermissionLayersInput,
): HostPermissionLayer[] {
  const { sticky, hostOwnsPermissionMode = false } = input
  const layers: HostPermissionLayer[] = []
  if (sticky.model !== null) {
    layers.push({ kind: 'model', mainLoopModel: sticky.model })
  }
  if (!hostOwnsPermissionMode && sticky.permissionMode !== null) {
    layers.push({ kind: 'permission_mode', mode: sticky.permissionMode })
  }
  // densable: $!==null ? layer : [] — only numeric (incl. 0) latches a layer
  if (typeof sticky.maxThinkingTokens === 'number') {
    layers.push({
      kind: 'max_thinking_tokens',
      maxThinkingTokens: sticky.maxThinkingTokens,
    })
  }
  if (sticky.flagSettings !== null) {
    layers.push({ kind: 'flag_settings', settings: sticky.flagSettings })
  }
  return layers
}

export function hasStickyPermissionLayers(
  sticky: HostStickyControlState,
  hostOwnsPermissionMode = false,
): boolean {
  return (
    buildHostPermissionLayers({ sticky, hostOwnsPermissionMode }).length > 0
  )
}

/**
 * densable yor-like append: existing layers + sticky layers.
 * Returns undefined when both empty so callers can leave field unset.
 */
export function mergePermissionLayers(
  existing: HostPermissionLayer[] | undefined,
  stickyLayers: HostPermissionLayer[],
): HostPermissionLayer[] | undefined {
  if (stickyLayers.length === 0) {
    return existing && existing.length > 0 ? existing : undefined
  }
  return [...(existing ?? []), ...stickyLayers]
}

export type SeedReadEntry = {
  content?: string
  timestamp?: number
  offset?: number | null
  limit?: number | null
  [key: string]: unknown
}

/**
 * densable se → readFileState merge: set when missing or seed timestamp newer.
 * Mutates `readFileState` if it exposes Map-like get/set.
 */
export function applySeedReadStateMap(
  readFileState:
    | {
        get: (path: string) => SeedReadEntry | undefined
        set: (path: string, value: SeedReadEntry) => void
      }
    | null
    | undefined,
  seeds: ReadonlyMap<string, unknown>,
): void {
  if (!readFileState || seeds.size === 0) return
  for (const [path, seed] of seeds.entries()) {
    if (!seed || typeof seed !== 'object') continue
    const next = seed as SeedReadEntry
    const prev = readFileState.get(path)
    const nextTs =
      typeof next.timestamp === 'number'
        ? next.timestamp
        : Number.POSITIVE_INFINITY
    const prevTs =
      prev && typeof prev.timestamp === 'number'
        ? prev.timestamp
        : Number.NEGATIVE_INFINITY
    if (!prev || nextTs > prevTs) {
      readFileState.set(path, next)
    }
  }
}

/**
 * densable Me apply: clone prepared with toolUseContext.permissionLayers + seeds.
 * Duck-typed so hostEngine stays free of QueryParams import cycles.
 */
export function applyHostStickyToPrepared<T>(
  prepared: T,
  sticky: HostStickyControlState,
  seeds: ReadonlyMap<string, unknown>,
  hostOwnsPermissionMode = false,
): T {
  if (!prepared || typeof prepared !== 'object') return prepared
  const rec = prepared as Record<string, unknown>
  const tuc = rec.toolUseContext
  if (!tuc || typeof tuc !== 'object') return prepared

  const toolUseContext = { ...(tuc as Record<string, unknown>) }
  const stickyLayers = buildHostPermissionLayers({
    sticky,
    hostOwnsPermissionMode,
  })
  const existing = toolUseContext.permissionLayers as
    | HostPermissionLayer[]
    | undefined
  const merged = mergePermissionLayers(existing, stickyLayers)
  if (merged !== undefined) {
    toolUseContext.permissionLayers = merged
  }

  const rfs = toolUseContext.readFileState as
    | {
        get: (path: string) => SeedReadEntry | undefined
        set: (path: string, value: SeedReadEntry) => void
      }
    | undefined
  if (rfs && seeds.size > 0) {
    applySeedReadStateMap(rfs, seeds)
  }

  // densable yor: project last model + max_thinking_tokens into options
  // (from stickyLayers being applied this turn — last-wins within that set)
  const options = toolUseContext.options
  if (options && typeof options === 'object' && stickyLayers.length > 0) {
    const nextOptions = { ...(options as Record<string, unknown>) }
    let optionsTouched = false
    for (let i = stickyLayers.length - 1; i >= 0; i--) {
      const layer = stickyLayers[i]!
      if (layer.kind === 'model') {
        nextOptions.mainLoopModel = layer.mainLoopModel
        optionsTouched = true
        break
      }
    }
    for (let i = stickyLayers.length - 1; i >= 0; i--) {
      const layer = stickyLayers[i]!
      if (layer.kind === 'max_thinking_tokens') {
        // densable YDu: 0 → disabled; positive → enabled budgetTokens
        const mtt = layer.maxThinkingTokens
        nextOptions.thinkingConfig =
          mtt === 0
            ? { type: 'disabled' }
            : typeof mtt === 'number'
              ? { type: 'enabled', budgetTokens: mtt }
              : { type: 'disabled' }
        optionsTouched = true
        break
      }
    }
    if (optionsTouched) {
      toolUseContext.options = nextOptions
    }
  }

  return {
    ...rec,
    toolUseContext,
  } as T
}
