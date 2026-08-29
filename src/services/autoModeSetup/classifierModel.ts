/**
 * densable _Et().value — classifier model for auto-mode-setup propose.
 * Wraps tip classifier model resolution; empty string disables KHl.
 */
import { getMainLoopModel } from '../../utils/model/model.js'
import { resolveTenguAutoModeConfig } from '../../utils/permissions/autoModeFlags.js'

function resolveMappedModel(
  map: Record<string, string> | undefined,
  main: string,
): string | undefined {
  if (!map || typeof map !== 'object') return undefined
  if (map[main]) return map[main]
  for (const [prefix, model] of Object.entries(map)) {
    if (main.startsWith(prefix)) return model
  }
  return undefined
}

/**
 * densable Z1m(_Et()) — fallbackModelByModel exact key, skip identity mapping.
 * Prefix matching is _Et modelByMainModel only; do not invent it here.
 */
export function resolveAutoModeSetupFallbackModel(
  primary: string,
): string | undefined {
  const map = resolveTenguAutoModeConfig().fallbackModelByModel
  if (map == null || typeof map !== 'object') return undefined
  const mapped = map[primary]
  return mapped && mapped !== primary ? mapped : undefined
}

/**
 * densable _Et — returns model id or "".
 * Prefer CLAUDE_CODE_AUTO_MODE_MODEL / BG_CLASSIFIER_MODEL, then GB, then main.
 */
export function resolveAutoModeSetupClassifierModel(): string {
  const envModel =
    process.env.CLAUDE_CODE_AUTO_MODE_MODEL ||
    process.env.CLAUDE_CODE_BG_CLASSIFIER_MODEL
  if (envModel && envModel.trim() !== '') return envModel.trim()

  const config = resolveTenguAutoModeConfig()
  const main = getMainLoopModel()
  const mapped = resolveMappedModel(config.modelByMainModel, main)
  if (mapped) return mapped
  if (config.model && config.model.trim() !== '') return config.model.trim()
  return main || ''
}
