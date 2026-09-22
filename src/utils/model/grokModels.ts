/**
 * xAI Grok context windows used by CCB for local budgeting
 * (status bar %, auto-compact thresholds). Not sent as a request field.
 *
 * Per-model rows — do not invent a vendor heuristic. Unknown grok-* ids
 * stay unrecognized and fall through to MODEL_CONTEXT_WINDOW_DEFAULT.
 *
 * Official windows (checked 2026-09-22):
 * - grok-4.7: 500k — https://docs.x.ai/developers/grok-4-7
 *   and https://docs.x.ai/developers/models/grok-4.7
 * - grok-4.6: 500k — https://docs.x.ai/developers/grok-4-6
 * - grok-4.5: 500k — https://docs.x.ai/developers/models/grok-4.5
 *   and https://x.ai/api
 * - grok-4.20 family: 1M — https://docs.x.ai/developers/models/grok-4.20
 *   (grok-4.20-0309-reasoning / non-reasoning / multi-agent)
 * - grok-4.3: 1M — https://docs.x.ai/developers/models/grok-4.3
 *
 * Do not add a bare `grok-4` or `grok-3` row: those are not current
 * flagship ids on the models page, and we have no official window to pin.
 */

/** Grok 4.7 / 4.6 / 4.5 API context window (xAI model card). */
export const GROK_500K_CONTEXT_WINDOW = 500_000

/** Grok 4.20 family / Grok 4.3 API context window (xAI model card). */
export const GROK_1M_CONTEXT_WINDOW = 1_000_000

export type GrokModelOption = {
  value: string
  label: string
  description: string
}

/**
 * `/model` rows when the Grok provider is active.
 * Current-spec public API ids only — no grok-3 / bare grok-4 / grok-4.7-fast
 * (fast is Cursor/Grok Build only, not the public xAI API).
 */
export const GROK_MODEL_OPTIONS: GrokModelOption[] = [
  {
    value: 'grok-4.7',
    label: 'Grok 4.7',
    description: 'Frontier model for coding, agents, and knowledge work · 500k',
  },
  {
    value: 'grok-4.6',
    label: 'Grok 4.6',
    description: 'Previous frontier · 500k',
  },
  {
    value: 'grok-4.5',
    label: 'Grok 4.5',
    description: 'Previous generation · 500k',
  },
  {
    value: 'grok-4.20-reasoning',
    label: 'Grok 4.20 Reasoning',
    description: 'Long-context reasoning · 1M',
  },
  {
    value: 'grok-4.20-multi-agent',
    label: 'Grok 4.20 Multi-agent',
    description: 'Multi-agent · 1M',
  },
  {
    value: 'grok-4.3',
    label: 'Grok 4.3',
    description: 'Long-context · 1M',
  },
]

function normalizeGrokModelId(model: string): string {
  const raw = model
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/i, '')
  const slash = raw.lastIndexOf('/')
  return slash === -1 ? raw : raw.slice(slash + 1)
}

/**
 * Version-boundary match: `grok-4.6` matches itself and `grok-4.6-fast`,
 * but not `grok-4.60`. Same rule as effortCatalog's "add a row, do not
 * invent a vendor heuristic".
 */
function matchesGrokVersion(id: string, version: string): boolean {
  return id === version || id.startsWith(`${version}-`)
}

/**
 * Context window for current-spec Grok model ids.
 * Returns undefined for unrecognized grok-* (e.g. grok-3-mini-fast).
 */
export function getGrokModelContextWindow(model: string): number | undefined {
  const id = normalizeGrokModelId(model)
  if (!id.startsWith('grok-')) return undefined

  // Longest / more specific versions first so grok-4.20 beats grok-4.2
  // if a 4.2 row is ever added.
  if (matchesGrokVersion(id, 'grok-4.20')) {
    return GROK_1M_CONTEXT_WINDOW
  }
  if (matchesGrokVersion(id, 'grok-4.7')) {
    return GROK_500K_CONTEXT_WINDOW
  }
  if (matchesGrokVersion(id, 'grok-4.6')) {
    return GROK_500K_CONTEXT_WINDOW
  }
  if (matchesGrokVersion(id, 'grok-4.5')) {
    return GROK_500K_CONTEXT_WINDOW
  }
  if (matchesGrokVersion(id, 'grok-4.3')) {
    return GROK_1M_CONTEXT_WINDOW
  }
  return undefined
}
