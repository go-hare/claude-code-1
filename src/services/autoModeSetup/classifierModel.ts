/**
 * densable _Et().value — classifier model for auto-mode-setup propose.
 * Delegates to getClassifierModel() (BFn().value); empty string disables KHl.
 */
import { resolveTenguAutoModeConfig } from '../../utils/permissions/autoModeFlags.js'
import { getClassifierModel } from '../../utils/permissions/yoloClassifier.js'

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
 * densable _Et / $yt — returns BFn().value or "".
 */
export function resolveAutoModeSetupClassifierModel(): string {
  return getClassifierModel() || ''
}
