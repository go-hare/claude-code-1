export type ChatGPTCodexModelOption = {
  value: string
  label: string
  description: string
}

/** Default ChatGPT/Codex model (newest frontier). */
export const CHATGPT_CODEX_DEFAULT_MODEL = 'gpt-5.6-sol'
/** Fast/small default for lighter tasks. */
export const CHATGPT_CODEX_FAST_MODEL = 'gpt-5.6-luna'

/**
 * ChatGPT OAuth / Codex subscription practical context window.
 * Codex with ChatGPT login is product-limited to ~272k (not the full API 1.05M).
 */
export const CHATGPT_OAUTH_CONTEXT_WINDOW = 272_000

/**
 * GPT-5.6 / GPT-5.4 family context window on the OpenAI API model card
 * (API key path). Long-context pricing applies above 272k input tokens.
 */
export const CHATGPT_API_CONTEXT_WINDOW = 1_050_000

/**
 * GPT-5.5 in Codex (ChatGPT login). Official introducing post: 400K.
 * https://openai.com/index/introducing-gpt-5-5
 */
export const CHATGPT_GPT55_OAUTH_CONTEXT_WINDOW = 400_000

/**
 * GPT-5.5 API context window. Official introducing post: 1M
 * (not the 1.05M card used by GPT-5.6 / GPT-5.4).
 */
export const CHATGPT_GPT55_API_CONTEXT_WINDOW = 1_000_000

/** @deprecated Use CHATGPT_OAUTH_CONTEXT_WINDOW or CHATGPT_API_CONTEXT_WINDOW. */
export const CHATGPT_CODEX_CONTEXT_WINDOW = CHATGPT_OAUTH_CONTEXT_WINDOW

/** Official GPT-5.6 family max output tokens (OpenAI model card). */
export const CHATGPT_CODEX_MAX_OUTPUT_TOKENS = 128_000

/**
 * ChatGPT OAuth / Codex model picker options.
 * Newest GPT-5.6 family first; previous generation models retained for
 * users still on those ids.
 */
export const CHATGPT_CODEX_MODEL_OPTIONS: ChatGPTCodexModelOption[] = [
  {
    value: 'gpt-5.6-sol',
    label: 'gpt-5.6-sol',
    description:
      'Frontier model for complex coding, research, and real-world work',
  },
  {
    value: 'gpt-5.6-terra',
    label: 'gpt-5.6-terra',
    description: 'Strong model for everyday coding',
  },
  {
    value: 'gpt-5.6-luna',
    label: 'gpt-5.6-luna',
    description:
      'Small, fast, and cost-efficient model for simpler coding tasks',
  },
  {
    value: 'gpt-5.5',
    label: 'GPT-5.5',
    description:
      'Frontier model for complex coding, research, and real-world work',
  },
  {
    value: 'gpt-5.4',
    label: 'GPT-5.4',
    description: 'Strong model for everyday coding',
  },
  {
    value: 'gpt-5.4-mini',
    label: 'GPT-5.4-Mini',
    description:
      'Small, fast, and cost-efficient model for simpler coding tasks',
  },
  {
    value: 'gpt-5.3-codex',
    label: 'GPT-5.3-Codex',
    description: 'Coding-optimized model',
  },
  {
    value: 'gpt-5.3-codex-spark',
    label: 'GPT-5.3-Codex-Spark',
    description: 'Ultra-fast coding model',
  },
  {
    value: 'gpt-5.2',
    label: 'GPT-5.2',
    description: 'Optimized for professional work and long-running agents',
  },
]

export function isChatGPTAuthMode(): boolean {
  return process.env.OPENAI_AUTH_MODE === 'chatgpt'
}

function normalizeChatGPTModelId(model: string): string {
  const raw = model
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/i, '')
  const slash = raw.lastIndexOf('/')
  return slash === -1 ? raw : raw.slice(slash + 1)
}

/**
 * Version-boundary match: `gpt-5.5` matches `gpt-5.5-pro`, but not `gpt-5.50`.
 * Same rule as grokModels / effortCatalog.
 */
function matchesGptVersion(id: string, version: string): boolean {
  return id === version || id.startsWith(`${version}-`)
}

/**
 * Whether this is a GPT-5.6 family model id (Sol/Terra/Luna or bare `gpt-5.6`).
 */
export function isGpt56FamilyModel(model: string): boolean {
  return matchesGptVersion(normalizeChatGPTModelId(model), 'gpt-5.6')
}

/**
 * GPT-5.5 family (bare `gpt-5.5` + `gpt-5.5-pro`). Official:
 * - API: 1M — https://openai.com/index/introducing-gpt-5-5
 * - Codex: 400K — same post
 */
export function isGpt55FamilyModel(model: string): boolean {
  return matchesGptVersion(normalizeChatGPTModelId(model), 'gpt-5.5')
}

/**
 * GPT-5.4 / GPT-5.4-pro only. Official API window 1.05M
 * (https://platform.openai.com/docs/models/gpt-5.4).
 *
 * Do not include `gpt-5.4-mini`: the mini model card does not pin a window.
 */
export function isGpt54WindowModel(model: string): boolean {
  const id = normalizeChatGPTModelId(model)
  if (id === 'gpt-5.4-mini' || id.startsWith('gpt-5.4-mini-')) {
    return false
  }
  return id === 'gpt-5.4' || matchesGptVersion(id, 'gpt-5.4-pro')
}

export function isChatGPTCodexReasoningModel(model: string): boolean {
  const normalized = normalizeChatGPTModelId(model)
  return (
    isGpt56FamilyModel(model) ||
    CHATGPT_CODEX_MODEL_OPTIONS.some(
      option => option.value.toLowerCase() === normalized,
    )
  )
}

/**
 * Context window for effortCatalog GPT-5.x ids used by CCB for local
 * budgeting (status bar %, auto-compact thresholds). Not sent as a
 * request field.
 *
 * Per-model rows — do not invent a window for gpt-5.4-mini / gpt-5.3-* /
 * gpt-5.2-* (no first-party card number pinned 2026-08-31).
 *
 * - GPT-5.6: OAuth/Codex 272k; API 1.05M (model card)
 * - GPT-5.5: Codex 400K; API 1M (introducing post)
 * - GPT-5.4 / GPT-5.4-pro: OAuth/Codex default 272k; API 1.05M (model card)
 */
export function getChatGPTModelContextWindow(
  model: string,
): number | undefined {
  if (isGpt56FamilyModel(model)) {
    return isChatGPTAuthMode()
      ? CHATGPT_OAUTH_CONTEXT_WINDOW
      : CHATGPT_API_CONTEXT_WINDOW
  }
  if (isGpt55FamilyModel(model)) {
    return isChatGPTAuthMode()
      ? CHATGPT_GPT55_OAUTH_CONTEXT_WINDOW
      : CHATGPT_GPT55_API_CONTEXT_WINDOW
  }
  if (isGpt54WindowModel(model)) {
    return isChatGPTAuthMode()
      ? CHATGPT_OAUTH_CONTEXT_WINDOW
      : CHATGPT_API_CONTEXT_WINDOW
  }
  return undefined
}
