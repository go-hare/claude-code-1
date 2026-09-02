/**
 * Moonshot Kimi context windows used by CCB for local budgeting
 * (status bar %, auto-compact thresholds). Not sent as a request field.
 *
 * Per-model rows — do not invent a vendor heuristic. Unknown kimi-* ids
 * stay unrecognized and fall through to MODEL_CONTEXT_WINDOW_DEFAULT.
 *
 * Official windows (checked 2026-08-31):
 * - kimi-k3: 1M — https://platform.kimi.ai/docs/guide/kimi-k3-quickstart
 *   and https://platform.kimi.ai/docs/overview
 * - kimi-k2.7 family (kimi-k2.7-code / kimi-k2.7-code-highspeed): 262,144
 *   — https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart
 *   (copy says "256K") and https://www.kimi.ai/resources/kimi-k2-7-code-pricing
 *   (table lists 262,144 tokens)
 *
 * Do not add kimi-k2.6 / kimi-k2.5 rows here unless they also land in
 * effortCatalog — those share 256K on the K2.7 page but are not spec-listed.
 */

/** Kimi K3 API context window (Moonshot K3 guide: 1M-token). */
export const KIMI_K3_CONTEXT_WINDOW = 1_000_000

/** Kimi K2.7 Code API context window (official pricing table). */
export const KIMI_K27_CONTEXT_WINDOW = 262_144

function normalizeKimiModelId(model: string): string {
  const raw = model
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/i, '')
  const slash = raw.lastIndexOf('/')
  return slash === -1 ? raw : raw.slice(slash + 1)
}

/**
 * Version-boundary match: `kimi-k2.7` matches `kimi-k2.7-code`,
 * but not `kimi-k2.70`. Same rule as grokModels / effortCatalog.
 */
function matchesKimiVersion(id: string, version: string): boolean {
  return id === version || id.startsWith(`${version}-`)
}

/**
 * Context window for current-spec Kimi model ids listed in effortCatalog.
 * Returns undefined for unrecognized kimi-* (e.g. kimi-k2.6).
 */
export function getKimiModelContextWindow(model: string): number | undefined {
  const id = normalizeKimiModelId(model)
  if (!id.startsWith('kimi-')) return undefined

  // Longest / more specific versions first.
  if (matchesKimiVersion(id, 'kimi-k3')) {
    // Product SKU `k3-256k` is a different id; if a prefixed
    // `kimi-k3-256k` ever appears, do not pin the 1M flagship window.
    if (id.includes('256k')) return undefined
    return KIMI_K3_CONTEXT_WINDOW
  }
  if (matchesKimiVersion(id, 'kimi-k2.7')) {
    return KIMI_K27_CONTEXT_WINDOW
  }
  return undefined
}
