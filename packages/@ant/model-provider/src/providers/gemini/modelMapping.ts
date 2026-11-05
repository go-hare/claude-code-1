/**
 * Default mapping from Anthropic model names to Gemini model names.
 *
 * Users can override per-family via GEMINI_DEFAULT_{FAMILY}_MODEL env vars,
 * or override the entire mapping via GEMINI_MODEL_MAP env var (JSON string).
 */

const DEFAULT_FAMILY_MAP: Record<string, string> = {
  opus: 'gemini-4-argon',
  sonnet: 'gemini-3.8-flash',
  haiku: 'gemini-3.8-flash',
}

function getModelFamily(model: string): 'haiku' | 'sonnet' | 'opus' | null {
  if (/haiku/i.test(model)) return 'haiku'
  if (/opus/i.test(model) || /fable/i.test(model)) return 'opus'
  if (/sonnet/i.test(model)) return 'sonnet'
  return null
}

function getUserModelMap(): Record<string, string> | null {
  const raw = process.env.GEMINI_MODEL_MAP
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>
    }
  } catch {
    // ignore invalid JSON
  }
  return null
}

/**
 * Resolve the Gemini model name for a given Anthropic model.
 *
 * Precedence:
 * 1. Exact `GEMINI_MODEL_MAP[cleanModel]` override
 * 2. Raw non-Claude / Gemini IDs pass through unchanged
 * 3. For Claude family aliases/IDs: `GEMINI_MODEL` -> `GEMINI_MODEL_MAP[family]`
 *    -> `GEMINI_DEFAULT_*_MODEL` -> `ANTHROPIC_DEFAULT_*_MODEL` -> default family map
 */
export function resolveGeminiModel(anthropicModel: string): string {
  const cleanModel = anthropicModel.trim().replace(/\[1m\]$/i, '')
  const family = getModelFamily(cleanModel)
  const userMap = getUserModelMap()

  if (
    userMap &&
    cleanModel.toLowerCase() !== family &&
    Object.hasOwn(userMap, cleanModel) &&
    typeof userMap[cleanModel] === 'string' &&
    userMap[cleanModel]
  ) {
    return userMap[cleanModel]
  }

  if (!family) {
    return cleanModel
  }

  if (process.env.GEMINI_MODEL) {
    return process.env.GEMINI_MODEL
  }

  if (
    userMap &&
    Object.hasOwn(userMap, family) &&
    typeof userMap[family] === 'string' &&
    userMap[family]
  ) {
    return userMap[family]
  }

  const geminiEnvVar = `GEMINI_DEFAULT_${family.toUpperCase()}_MODEL`
  const geminiModel = process.env[geminiEnvVar]
  if (geminiModel) {
    return geminiModel
  }

  const sharedEnvVar = `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`
  const resolvedModel = process.env[sharedEnvVar]
  if (resolvedModel) {
    return resolvedModel
  }

  return DEFAULT_FAMILY_MAP[family] ?? cleanModel
}
