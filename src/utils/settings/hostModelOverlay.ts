/**
 * densable 2.1.222 #16 — host model-selection precedence over stale
 * on-disk managed-settings.json when CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST.
 *
 * densable anchors:
 * - Gfg(parentManaged, hostManagedProvider) → hostModelOverlay
 * - b6i(settings) strip model/fallbackModel/modelOverrides + Wfg env keys
 * - nfc policy load: clone + b6i + Object.assign(hostModelOverlay)
 *
 * Wfg = p9r (model default env keys, minus ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION)
 *     ∪ f9r (custom model option keys)
 *     ∪ CLAUDE_CODE_AUTO_MODE_MODEL / CLAUDE_CODE_BG_CLASSIFIER_MODEL
 *       / CLAUDE_CONTEXT_COLLAPSE_MODEL
 */

import type { SettingsJson } from './types.js'

/**
 * densable p9r (model-default env keys) minus ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION
 * for Wfg strip under host-managed policy settings.env.
 */
const HOST_MODEL_POLICY_ENV_P9R = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_SMALL_FAST_MODEL',
  // densable Wfg intentionally excludes ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_3P_PROBE_WROTE_SONNET_DEFAULT',
  'CLAUDE_CODE_3P_PROBE_WROTE_OPUS_DEFAULT',
] as const

/** densable f9r — custom model option env keys */
const HOST_MODEL_POLICY_ENV_F9R = [
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES',
] as const

/**
 * densable Wfg — policy settings.env keys stripped by b6i under host-managed.
 * Exported for tests.
 */
export const HOST_MODEL_POLICY_STRIP_ENV_KEYS = new Set<string>([
  ...HOST_MODEL_POLICY_ENV_P9R,
  ...HOST_MODEL_POLICY_ENV_F9R,
  'CLAUDE_CODE_AUTO_MODE_MODEL',
  'CLAUDE_CODE_BG_CLASSIFIER_MODEL',
  'CLAUDE_CONTEXT_COLLAPSE_MODEL',
])

/** densable host model-selection keys carried by Gfg overlay */
export type HostModelOverlay = Pick<
  SettingsJson,
  'model' | 'availableModels' | 'enforceAvailableModels' | 'fallbackModel'
>

/**
 * densable Gfg(parentManaged, hostManagedProvider) → hostModelOverlay | null
 *
 * When the host owns provider routing, copy model-selection keys from the
 * parent-managed settings tier so they beat a stale on-disk managed-settings.json.
 */
export function buildHostModelOverlay(
  parentManaged: SettingsJson | null | undefined,
  hostManagedProvider: boolean,
): HostModelOverlay | null {
  if (!hostManagedProvider || !parentManaged) return null
  const overlay: HostModelOverlay = {}
  if (parentManaged.model !== undefined) {
    overlay.model = parentManaged.model
  }
  if (parentManaged.availableModels !== undefined) {
    overlay.availableModels = parentManaged.availableModels
  }
  if (parentManaged.enforceAvailableModels !== undefined) {
    overlay.enforceAvailableModels = parentManaged.enforceAvailableModels
  }
  if (parentManaged.fallbackModel !== undefined) {
    overlay.fallbackModel = parentManaged.fallbackModel
  }
  return Object.keys(overlay).length > 0 ? overlay : null
}

/**
 * densable b6i — mutate settings in place: drop model / fallbackModel /
 * modelOverrides, and filter settings.env against Wfg.
 */
export function stripHostManagedPolicyModelKeys(
  settings: SettingsJson,
): SettingsJson {
  delete settings.model
  delete settings.fallbackModel
  delete settings.modelOverrides
  if (settings.env) {
    const kept: Record<string, string> = {}
    for (const [key, value] of Object.entries(settings.env)) {
      if (!HOST_MODEL_POLICY_STRIP_ENV_KEYS.has(key.toUpperCase())) {
        kept[key] = value
      }
    }
    settings.env = kept
  }
  return settings
}

/**
 * densable nfc host-managed finish step: clone → b6i → Object.assign(overlay).
 * Pure; does not mutate the input admin/hkcu object.
 */
export function applyHostManagedPolicyModelPrecedence(
  policySettings: SettingsJson | null,
  hostModelOverlay: HostModelOverlay | null,
  hostManagedProvider: boolean,
): SettingsJson | null {
  if (!hostManagedProvider) {
    return policySettings
  }
  if (!policySettings && !hostModelOverlay) {
    return null
  }
  const next: SettingsJson = policySettings
    ? ({ ...policySettings } as SettingsJson)
    : ({} as SettingsJson)
  if (policySettings?.env) {
    next.env = { ...policySettings.env }
  }
  stripHostManagedPolicyModelKeys(next)
  if (hostModelOverlay) {
    Object.assign(next, hostModelOverlay)
  }
  return next
}
