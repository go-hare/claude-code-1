/**
 * densable amber_redwood2/3 + fJi pure residual — autocompact window string parse.
 *
 * densable:
 *   lto() = et("tengu_amber_redwood2","") || et("tengu_amber_redwood3","")
 *   fJi(s) parses window token strings: "auto" | "200k" | "1m" | bare number
 *   mJi(model) applies redwood only for main-loop model family (denser)
 *   QV priority: env > settings > clientdata > experiment(redwood) > model-default
 *
 * Bounds densable: uto=1e5, pJi=1e6.
 */

/** densable uto — min configured auto-compact window. */
export const AMBER_REDWOOD_WINDOW_MIN = 100_000
/** densable pJi — max configured auto-compact window. */
export const AMBER_REDWOOD_WINDOW_MAX = 1_000_000

export type AmberRedwoodParseResult =
  | { kind: 'auto' }
  | { kind: 'tokens'; tokens: number }
  | { kind: 'invalid' }

/**
 * densable fJi — parse redwood / settings-style window string.
 * - "auto" → auto
 * - ends with m → *1e6
 * - ends with k → *1000
 * - bare number: if 100..1000 treat as thousands, else as tokens
 * - out of [uto, pJi] → invalid
 */
export function parseAmberRedwoodWindowString(
  raw: string,
): AmberRedwoodParseResult {
  const t = raw.trim().toLowerCase()
  if (t === 'auto') return { kind: 'auto' }

  let tokens: number
  if (t.endsWith('m')) {
    tokens = parseFloat(t.slice(0, -1)) * 1e6
  } else if (t.endsWith('k')) {
    tokens = parseFloat(t.slice(0, -1)) * 1000
  } else {
    const n = parseFloat(t)
    if (Number.isNaN(n)) return { kind: 'invalid' }
    // densable: 100..1000 bare → thousands (e.g. 200 → 200_000)
    tokens = n >= 100 && n <= 1000 ? n * 1000 : n
  }

  if (
    !Number.isFinite(tokens) ||
    tokens < AMBER_REDWOOD_WINDOW_MIN ||
    tokens > AMBER_REDWOOD_WINDOW_MAX
  ) {
    return { kind: 'invalid' }
  }
  return { kind: 'tokens', tokens: Math.round(tokens) }
}

/**
 * densable mJi numeric branch pure: only return tokens when parse is number.
 * "auto" / invalid → undefined (caller falls through QV sources).
 */
export function amberRedwoodWindowTokensFromString(
  raw: string | null | undefined,
): number | undefined {
  if (!raw) return undefined
  const parsed = parseAmberRedwoodWindowString(raw)
  if (parsed.kind !== 'tokens') return undefined
  return parsed.tokens
}

/**
 * densable QV pure source priority for configured window (no live deps).
 * Returns first matching source with window capped by modelMax.
 */
export function resolveAutoCompactWindowSource(input: {
  modelMax: number
  envWindow?: number | null
  settingsWindow?: number | null
  clientDataWindow?: number | null
  experimentWindow?: number | null
  modelDefaultWindow?: number | null
}): {
  window: number
  configured: number
  source: 'env' | 'settings' | 'clientdata' | 'experiment' | 'model-default' | 'auto'
} {
  const cap = (configured: number) => Math.min(input.modelMax, configured)

  if (
    typeof input.envWindow === 'number' &&
    Number.isFinite(input.envWindow) &&
    input.envWindow > 0
  ) {
    const configured = Math.max(AMBER_REDWOOD_WINDOW_MIN, input.envWindow)
    return { window: cap(configured), configured, source: 'env' }
  }
  if (
    typeof input.settingsWindow === 'number' &&
    Number.isFinite(input.settingsWindow) &&
    input.settingsWindow > 0
  ) {
    return {
      window: cap(input.settingsWindow),
      configured: input.settingsWindow,
      source: 'settings',
    }
  }
  if (
    typeof input.clientDataWindow === 'number' &&
    Number.isFinite(input.clientDataWindow) &&
    input.clientDataWindow > 0
  ) {
    return {
      window: cap(input.clientDataWindow),
      configured: input.clientDataWindow,
      source: 'clientdata',
    }
  }
  if (
    typeof input.experimentWindow === 'number' &&
    Number.isFinite(input.experimentWindow) &&
    input.experimentWindow > 0
  ) {
    return {
      window: cap(input.experimentWindow),
      configured: input.experimentWindow,
      source: 'experiment',
    }
  }
  if (
    typeof input.modelDefaultWindow === 'number' &&
    Number.isFinite(input.modelDefaultWindow) &&
    input.modelDefaultWindow > 0
  ) {
    return {
      window: cap(input.modelDefaultWindow),
      configured: input.modelDefaultWindow,
      source: 'model-default',
    }
  }
  return {
    window: input.modelMax,
    configured: input.modelMax,
    source: 'auto',
  }
}
