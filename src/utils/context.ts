// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { CONTEXT_1M_BETA_HEADER } from '../constants/betas.js'
import { getGlobalConfig } from './config.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { getCanonicalName } from './model/model.js'
import { resolveAntModel } from './model/antModels.js'
import {
  CHATGPT_CODEX_MAX_OUTPUT_TOKENS,
  getChatGPTModelContextWindow,
} from './model/chatgptModels.js'
import { getModelCapability } from './model/modelCapabilities.js'

// Model context window size (200k tokens for all models right now)
export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000

// Maximum output tokens for compact operations
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000

// Default max output tokens
const MAX_OUTPUT_TOKENS_DEFAULT = 32_000
const MAX_OUTPUT_TOKENS_UPPER_LIMIT = 64_000

// Capped default for slot-reservation optimization. BQ p99 output = 4,911
// tokens, so 32k/64k defaults over-reserve 8-16× slot capacity. With the cap
// enabled, <1% of requests hit the limit; those get one clean retry at 64k
// (see query.ts max_output_tokens_escalate). Cap is applied in
// claude.ts:getMaxOutputTokensForModel to avoid the growthbook→betas→context
// import cycle.
export const CAPPED_DEFAULT_MAX_TOKENS = 8_000
export const ESCALATED_MAX_TOKENS = 64_000

/**
 * Check if 1M context is disabled via environment variable.
 * Used by C4E admins to disable 1M context for HIPAA compliance.
 */
export function is1mContextDisabled(): boolean {
  // Official DISABLE_1M_CONTEXT densable.
  try {
    const { is1mContextEnvDisabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    return is1mContextEnvDisabled()
  } catch {
    return isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT)
  }
}

/**
 * densable 2.1.223 #17 — CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT.
 */
export function isUnknownModelWindowEnforcementDisabled(): boolean {
  try {
    const { isUnknownModelWindowEnforcementDisabled: gate } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    return gate()
  } catch {
    return isEnvTruthy(
      process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT,
    )
  }
}

export function has1mContext(model: string): boolean {
  if (is1mContextDisabled()) {
    return false
  }
  return /\[1m\]/i.test(model)
}

// @[MODEL LAUNCH]: Update this pattern if the new model supports 1M context
// densable $q / supports_1m_beta catalog: opus-4-6/4-7/4-8 + sonnet 4/5 family
// densable 2.1.223 #16: not only this list — capability / [1m] / ant windows
// also clamp under DISABLE_1M via getContextWindowForModel final clamp.
export function modelSupports1M(model: string): boolean {
  if (is1mContextDisabled()) {
    return false
  }
  const canonical = getCanonicalName(model)
  return (
    canonical.includes('claude-sonnet-5') ||
    canonical.includes('claude-sonnet-4') ||
    canonical.includes('opus-4-6') ||
    canonical.includes('opus-4-7') ||
    canonical.includes('opus-4-8') ||
    // densable 2.1.223 #16 — newer native 1M Claude families beyond fixed 4.x list
    canonical.includes('opus-5') ||
    canonical.includes('fable')
  )
}

/**
 * densable 2.1.223 #17 — model id recognized for local window assumptions.
 * Provider-prefixed Claude/Anthropic ids count (gateway discovery parity).
 */
export function isRecognizedModelForWindowEnforcement(model: string): boolean {
  const raw = model.trim()
  if (!raw) return false
  // Explicit [1m] opt-in is always recognized as a Claude window request
  if (/\[1m\]/i.test(raw)) return true
  // ChatGPT/Codex family has its own window table
  if (getChatGPTModelContextWindow(raw) !== undefined) return true
  // Capability cache hit = /v1/models recognized this id
  if (getModelCapability(raw)) return true
  // densable gateway filter + Anthropic family markers
  if (/(claude|anthropic)/i.test(raw)) return true
  // Alias / marketing short names
  const lower = raw.toLowerCase()
  if (
    lower === 'opus' ||
    lower === 'sonnet' ||
    lower === 'haiku' ||
    lower === 'fable' ||
    lower === 'best' ||
    lower === 'opusplan' ||
    lower.endsWith('[1m]')
  ) {
    return true
  }
  if (process.env.USER_TYPE === 'ant') {
    const antModel = resolveAntModel(raw)
    if (antModel) return true
  }
  return false
}

/**
 * densable 2.1.223 #16 gold — warn when DISABLE_1M is set but resolved window > 200K.
 * Call once at session start with the main-loop model.
 */
export function getDisable1mContextNotEnforcedWarning(
  model: string,
): string | null {
  if (!is1mContextDisabled()) return null
  // Resolve WITHOUT the disable env so we can detect native >200K windows
  // that would escape auto-compact if not clamped. Use resolved window after
  // clamp: if still > 200K, clamp path failed (e.g. ant override).
  const window = getContextWindowForModel(model)
  if (window <= MODEL_CONTEXT_WINDOW_DEFAULT) return null
  try {
    const { formatDisable1mContextNotEnforcedWarning } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    return formatDisable1mContextNotEnforcedWarning(
      model,
      MODEL_CONTEXT_WINDOW_DEFAULT,
    )
  } catch {
    const k = MODEL_CONTEXT_WINDOW_DEFAULT / 1000
    return `CLAUDE_CODE_DISABLE_1M_CONTEXT is set, but the ${k}K limit isn't enforced for ${model}, so this session can grow past it. To enforce it, set CLAUDE_CODE_AUTO_COMPACT_WINDOW=${MODEL_CONTEXT_WINDOW_DEFAULT} (or the autoCompactWindow setting)`
  }
}

/**
 * densable 2.1.223 #17 gold — notice when unknown id is held to assumed window.
 */
export function getUnknownModelWindowEnforcementNotice(
  model: string,
): string | null {
  if (isUnknownModelWindowEnforcementDisabled()) return null
  if (isRecognizedModelForWindowEnforcement(model)) return null
  try {
    const { formatUnknownModelWindowEnforcementNotice } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    return formatUnknownModelWindowEnforcementNotice(
      model,
      MODEL_CONTEXT_WINDOW_DEFAULT,
    )
  } catch {
    return `"${model}" is not a model this version of Claude Code recognizes, so auto-compact will keep this session within ${MODEL_CONTEXT_WINDOW_DEFAULT} tokens (the context window it assumes). map it in the modelOverrides setting or update Claude Code; CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1 restores the previous wait-for-the-API behavior.`
  }
}

/**
 * densable 2.1.223 #16/#17 — log startup notices once per process for the session model.
 */
let contextWindowEnforcementNoticesLogged = false

export function logContextWindowEnforcementStartupNotices(model: string): void {
  if (contextWindowEnforcementNoticesLogged) return
  contextWindowEnforcementNoticesLogged = true
  const disable1m = getDisable1mContextNotEnforcedWarning(model)
  if (disable1m) {
    logForDebugging(disable1m, { level: 'warn' })
  }
  const unknown = getUnknownModelWindowEnforcementNotice(model)
  if (unknown) {
    logForDebugging(unknown, { level: 'warn' })
  }
}

/** Test helper — reset one-shot startup notice latch. */
export function clearContextWindowEnforcementNoticesLatchForTests(): void {
  contextWindowEnforcementNoticesLogged = false
}

export function getContextWindowForModel(
  model: string,
  betas?: string[],
): number {
  // Allow override via environment variable (ant-only)
  // This takes precedence over all other context window resolution, including 1M detection,
  // so users can cap the effective context window for local decisions (auto-compact, etc.)
  // while still using a 1M-capable endpoint.
  // Official MAX_CONTEXT_TOKENS densable — ant-only override.
  if (process.env.USER_TYPE === 'ant') {
    try {
      const { resolveMaxContextTokensOverride } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
      const override = resolveMaxContextTokensOverride()
      if (override !== null) return override
    } catch {
      if (process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS) {
        const override = parseInt(
          process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,
          10,
        )
        if (!isNaN(override) && override > 0) return override
      }
    }
  }

  // densable 2.1.223 #17 — unrecognized model IDs: enforce assumed 200K unless
  // CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT restores wait-for-API.
  if (!isRecognizedModelForWindowEnforcement(model)) {
    if (isUnknownModelWindowEnforcementDisabled()) {
      try {
        const { UNKNOWN_MODEL_WAIT_FOR_API_WINDOW } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
        return UNKNOWN_MODEL_WAIT_FOR_API_WINDOW
      } catch {
        return 100_000_000
      }
    }
    return MODEL_CONTEXT_WINDOW_DEFAULT
  }

  // [1m] suffix — explicit client-side opt-in, respected over all detection
  if (has1mContext(model)) {
    return applyDisable1mClamp(1_000_000)
  }

  // GPT-5.6 family: OAuth/Codex ≈ 272k; API key path ≈ 1.05M (model card).
  // Used for UI %, auto-compact thresholds, and local budgeting — not sent
  // as a request field (Codex Responses does not take max_input_tokens).
  const chatgptContextWindow = getChatGPTModelContextWindow(model)
  if (chatgptContextWindow !== undefined) {
    return applyDisable1mClamp(chatgptContextWindow)
  }

  const cap = getModelCapability(model)
  if (cap?.max_input_tokens && cap.max_input_tokens >= 100_000) {
    return applyDisable1mClamp(cap.max_input_tokens)
  }

  // densable 2.1.223 #16 — native 1M via beta: modelSupports1M OR capability
  // already handled; also honor [1m]-less models that still carry the beta
  // when DISABLE_1M is off (catalog + any claude id with beta is not enough —
  // keep catalog for beta path, but final clamp covers all >200K).
  if (betas?.includes(CONTEXT_1M_BETA_HEADER) && modelSupports1M(model)) {
    return applyDisable1mClamp(1_000_000)
  }
  // Beta present on any recognized Claude model under densable "every native 1M":
  // if capability said so we'd have returned; for fixed-list miss with beta,
  // still treat as 1M when DISABLE_1M is off and id looks Claude-family.
  if (
    betas?.includes(CONTEXT_1M_BETA_HEADER) &&
    !is1mContextDisabled() &&
    /(claude|anthropic)/i.test(model)
  ) {
    return 1_000_000
  }
  if (getSonnet1mExpTreatmentEnabled(model)) {
    return applyDisable1mClamp(1_000_000)
  }
  if (process.env.USER_TYPE === 'ant') {
    const antModel = resolveAntModel(model)
    if (antModel?.contextWindow) {
      return applyDisable1mClamp(antModel.contextWindow)
    }
  }
  return MODEL_CONTEXT_WINDOW_DEFAULT
}

/**
 * densable 2.1.223 #16 — hold every native >200K window to 200K when
 * CLAUDE_CODE_DISABLE_1M_CONTEXT is set (not just the fixed modelSupports1M list).
 */
function applyDisable1mClamp(window: number): number {
  if (is1mContextDisabled() && window > MODEL_CONTEXT_WINDOW_DEFAULT) {
    return MODEL_CONTEXT_WINDOW_DEFAULT
  }
  return window
}

export function getSonnet1mExpTreatmentEnabled(model: string): boolean {
  if (is1mContextDisabled()) {
    return false
  }
  // Only applies to sonnet 4.6 without an explicit [1m] suffix
  if (has1mContext(model)) {
    return false
  }
  if (!getCanonicalName(model).includes('sonnet-4-6')) {
    return false
  }
  return getGlobalConfig().clientDataCache?.['coral_reef_sonnet'] === 'true'
}

/**
 * Calculate context window usage percentage from token usage data.
 * Returns used and remaining percentages, or null values if no usage data.
 */
export function calculateContextPercentages(
  currentUsage: {
    input_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null,
  contextWindowSize: number,
): { used: number | null; remaining: number | null } {
  if (!currentUsage) {
    return { used: null, remaining: null }
  }

  const totalInputTokens =
    currentUsage.input_tokens +
    currentUsage.cache_creation_input_tokens +
    currentUsage.cache_read_input_tokens

  // Treat zero input tokens the same as no usage data — avoids flashing
  // "ctx:0%" when a third-party API omits usage from message_start.
  if (totalInputTokens === 0) {
    return { used: null, remaining: null }
  }

  const usedPercentage = Math.round(
    (totalInputTokens / contextWindowSize) * 100,
  )
  const clampedUsed = Math.min(100, Math.max(0, usedPercentage))

  return {
    used: clampedUsed,
    remaining: 100 - clampedUsed,
  }
}

/**
 * Returns the model's default and upper limit for max output tokens.
 */
export function getModelMaxOutputTokens(model: string): {
  default: number
  upperLimit: number
} {
  let defaultTokens: number
  let upperLimit: number

  if (process.env.USER_TYPE === 'ant') {
    const antModel = resolveAntModel(model.toLowerCase())
    if (antModel) {
      defaultTokens = antModel.defaultMaxTokens ?? MAX_OUTPUT_TOKENS_DEFAULT
      upperLimit = antModel.upperMaxTokensLimit ?? MAX_OUTPUT_TOKENS_UPPER_LIMIT
      return { default: defaultTokens, upperLimit }
    }
  }

  const m = getCanonicalName(model)

  // GPT-5.6 family: official 128k max output (OpenAI model card).
  if (getChatGPTModelContextWindow(model) !== undefined) {
    defaultTokens = 32_000
    upperLimit = CHATGPT_CODEX_MAX_OUTPUT_TOKENS
  } else if (m.includes('opus-4-8') || m.includes('opus-4-7')) {
    // densable catalog opus-4-7/4-8: default 64000 / upper 128000
    defaultTokens = 64_000
    upperLimit = 128_000
  } else if (m.includes('opus-4-6')) {
    defaultTokens = 64_000
    upperLimit = 128_000
  } else if (m.includes('sonnet-4-6')) {
    defaultTokens = 32_000
    upperLimit = 128_000
  } else if (
    m.includes('opus-4-5') ||
    m.includes('sonnet-4') ||
    m.includes('haiku-4')
  ) {
    defaultTokens = 32_000
    upperLimit = 64_000
  } else if (m.includes('opus-4-1') || m.includes('opus-4')) {
    defaultTokens = 32_000
    upperLimit = 32_000
  } else if (m.includes('claude-3-opus')) {
    defaultTokens = 4_096
    upperLimit = 4_096
  } else if (m.includes('claude-3-sonnet')) {
    defaultTokens = 8_192
    upperLimit = 8_192
  } else if (m.includes('claude-3-haiku')) {
    defaultTokens = 4_096
    upperLimit = 4_096
  } else if (m.includes('3-5-sonnet') || m.includes('3-5-haiku')) {
    defaultTokens = 8_192
    upperLimit = 8_192
  } else if (m.includes('3-7-sonnet')) {
    defaultTokens = 32_000
    upperLimit = 64_000
  } else {
    defaultTokens = MAX_OUTPUT_TOKENS_DEFAULT
    upperLimit = MAX_OUTPUT_TOKENS_UPPER_LIMIT
  }

  const cap = getModelCapability(model)
  if (cap?.max_tokens && cap.max_tokens >= 4_096) {
    upperLimit = cap.max_tokens
    defaultTokens = Math.min(defaultTokens, upperLimit)
  }

  return { default: defaultTokens, upperLimit }
}

/**
 * Returns the max thinking budget tokens for a given model. The max
 * thinking tokens should be strictly less than the max output tokens.
 *
 * Deprecated since newer models use adaptive thinking rather than a
 * strict thinking token budget.
 */
export function getMaxThinkingTokensForModel(model: string): number {
  return getModelMaxOutputTokens(model).upperLimit - 1
}
