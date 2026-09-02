/**
 * DeepSeek V4 context windows used by CCB for local budgeting
 * (status bar %, auto-compact thresholds). Not sent as a request field.
 *
 * Per-model rows — do not invent a vendor heuristic. Unknown deepseek-* ids
 * stay unrecognized and fall through to MODEL_CONTEXT_WINDOW_DEFAULT.
 *
 * Official windows (checked 2026-08-31):
 * - deepseek-v4-pro / deepseek-v4-flash / deepseek-v4-flash-vision-exp: 1M
 *   — https://api-docs.deepseek.com/quick_start/pricing
 *     (CONTEXT LENGTH row: 1M for all listed V4 models)
 * - bare deepseek-v4: same 1M family window (effortCatalog row)
 *
 * Do not add deepseek-chat / deepseek-reasoner: those are legacy aliases,
 * not current-spec ids in effortCatalog.
 */

/** DeepSeek V4 family API context window (official pricing table: 1M). */
export const DEEPSEEK_V4_CONTEXT_WINDOW = 1_000_000

function normalizeDeepSeekModelId(model: string): string {
  const raw = model
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/i, '')
  const slash = raw.lastIndexOf('/')
  return slash === -1 ? raw : raw.slice(slash + 1)
}

/**
 * Version-boundary match: `deepseek-v4` matches `deepseek-v4-pro`,
 * but not `deepseek-v40`. Same rule as grokModels / effortCatalog.
 */
function matchesDeepSeekVersion(id: string, version: string): boolean {
  return id === version || id.startsWith(`${version}-`)
}

/**
 * Context window for current-spec DeepSeek V4 ids listed in effortCatalog.
 * Returns undefined for unrecognized deepseek-* (e.g. deepseek-chat).
 */
export function getDeepSeekModelContextWindow(
  model: string,
): number | undefined {
  const id = normalizeDeepSeekModelId(model)
  if (!id.startsWith('deepseek-')) return undefined

  if (matchesDeepSeekVersion(id, 'deepseek-v4')) {
    return DEEPSEEK_V4_CONTEXT_WINDOW
  }
  return undefined
}
