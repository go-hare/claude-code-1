/**
 * Google Gemini context windows used by CCB for local budgeting
 * (status bar %, auto-compact thresholds). Not sent as a request field.
 *
 * Per-model rows — do not invent a vendor heuristic. Unknown gemini-* ids
 * stay unrecognized and fall through to MODEL_CONTEXT_WINDOW_DEFAULT.
 *
 * Official windows (checked 2026-11-05):
 * - gemini-4-argon: 1,048,576 (1M) — https://ai.google.dev/gemini-api/docs/models/gemini-4-argon
 * - gemini-3.8-flash: 1,048,576 (1M) — https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
 *
 * Do not add gemini-3.8-live / gemini-3.8-flash-tts / -lite-tts: those are
 * realtime/speech ids, not chat/text models (excluded below).
 */

/** Gemini chat/text flagship API context window (official model card: 1M). */
export const GEMINI_1M_CONTEXT_WINDOW = 1_048_576

/** Default Gemini Opus-tier frontier model. */
export const GEMINI_DEFAULT_OPUS_MODEL = 'gemini-4-argon'
/** Default Gemini Sonnet-tier main-loop model. */
export const GEMINI_DEFAULT_SONNET_MODEL = 'gemini-3.8-flash'
/** Default Gemini Haiku-tier small/fast model. */
export const GEMINI_DEFAULT_HAIKU_MODEL = 'gemini-3.8-flash'

export type GeminiModelOption = {
  value: string
  label: string
  description: string
}

/**
 * `/model` rows when the Gemini provider is active.
 * Current-spec public API chat/text ids only — no gemini-3.8-live / tts ids,
 * no deprecated gemini-3.7-flash (auto-routed to 3.8-flash).
 */
export const GEMINI_MODEL_OPTIONS: GeminiModelOption[] = [
  {
    value: 'gemini-4-argon',
    label: 'Gemini 4 Argon',
    description: 'Frontier reasoning model · 1M',
  },
  {
    value: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    description: 'Fast coding/agent model · 1M',
  },
]

function normalizeGeminiModelId(model: string): string {
  const raw = model
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/i, '')
  const slash = raw.lastIndexOf('/')
  return slash === -1 ? raw : raw.slice(slash + 1)
}

/**
 * Version-boundary match: `gemini-4-argon` matches itself and
 * `gemini-4-argon-preview`, but not `gemini-4-argon2`. Same rule as
 * grokModels / effortCatalog.
 */
function matchesGeminiVersion(id: string, version: string): boolean {
  return id === version || id.startsWith(`${version}-`)
}

/**
 * Context window for current-spec Gemini chat/text model ids.
 * Returns undefined for unrecognized gemini-* (e.g. gemini-3.8-live,
 * gemini-3.8-flash-tts, gemini-2.5-flash).
 */
export function getGeminiModelContextWindow(model: string): number | undefined {
  const id = normalizeGeminiModelId(model)
  if (!id.startsWith('gemini-')) return undefined

  // Realtime/speech ids are not chat/text models — do not pin the 1M window.
  if (id.includes('-live') || id.includes('-tts')) return undefined

  // Longest / more specific versions first.
  if (matchesGeminiVersion(id, 'gemini-4-argon')) {
    return GEMINI_1M_CONTEXT_WINDOW
  }
  if (matchesGeminiVersion(id, 'gemini-3.8-flash')) {
    return GEMINI_1M_CONTEXT_WINDOW
  }
  return undefined
}
