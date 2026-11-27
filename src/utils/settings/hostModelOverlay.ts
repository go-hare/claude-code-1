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

import { isEnvTruthy } from '../envUtils.js'
import * as pluginPolicyModule from '../plugins/pluginPolicy.js'
import type { SettingsJson } from './types.js'

/**
 * Official 2.1.326 (#21) `Spl`: subagent model env keys that managed settings
 * may set for Claude Desktop Code tab sessions unless the same settings `env`
 * also selects a third-party provider or gateway.
 */
export const MANAGED_SUBAGENT_MODEL_ENV_KEYS = new Set<string>([
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL_FORCE',
  'CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL',
])

const PROVIDER_OR_GATEWAY_BOOL_ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_GATEWAY',
] as const

const PROVIDER_ENDPOINT_ENV_KEYS = [
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'CLOUD_ML_REGION',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLAUDE_CODE_GATEWAY_URL',
] as const

/**
 * Official 2.1.326 (#21) `Jns(env)`: returns true when a settings `env` block
 * selects a third-party provider, custom gateway, or non-Anthropic base URL.
 */
export function envSelectsProviderOrGateway(
  env: Record<string, string> | undefined,
): boolean {
  if (!env) return false
  for (const [rawKey, rawVal] of Object.entries(env)) {
    const key = rawKey.toUpperCase()
    if (
      (PROVIDER_OR_GATEWAY_BOOL_ENV_KEYS as readonly string[]).includes(key) &&
      isEnvTruthy(rawVal)
    ) {
      return true
    }
    if (
      (PROVIDER_ENDPOINT_ENV_KEYS as readonly string[]).includes(key) &&
      rawVal.trim().length > 0
    ) {
      return true
    }
    if (key === 'ANTHROPIC_BASE_URL' && rawVal.trim().length > 0) {
      try {
        const host = new URL(rawVal.trim()).hostname.toLowerCase()
        if (host !== 'api.anthropic.com' && !host.endsWith('.anthropic.com')) {
          return true
        }
      } catch {
        return true
      }
    }
  }
  return false
}

/**
 * Official 2.1.326 (#21) `Le`: true for Claude Desktop Code tab sessions where
 * managed `CLAUDE_CODE_SUBAGENT_MODEL*` should be preserved unless the same
 * managed settings `env` selects a provider or gateway.
 */
export function isDesktopCodeTabSession(): boolean {
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  return (
    !isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
    !isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK) &&
    (entrypoint === 'claude-desktop' || entrypoint === 'claude-desktop-3p')
  )
}

/**
 * Official 2.1.323 (#1968) `Z7r`: true for Claude Desktop sessions on
 * third-party providers (host-managed provider, local, non-cowork,
 * `claude-desktop-3p` or `local-agent` without desktop app version).
 * In these sessions, managed settings `CLAUDE_CODE_AUTO_MODE_MODEL` is preserved.
 */
export function isLocalThirdPartyDesktopManagedSession(): boolean {
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST) &&
    !isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
    !isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK) &&
    (entrypoint === 'claude-desktop-3p' ||
      (entrypoint === 'local-agent' &&
        (process.env.CLAUDE_CODE_DESKTOP_APP_VERSION ?? '') === ''))
  )
}

/** Official 2.1.323 (#2120) `Ls` — boolean disable switches from parent/SDK managedSettings. */
export const PARENT_MANAGED_DISABLE_SWITCHES = [
  'disableRemoteControl',
  'disableAgentView',
  'disableWorkflows',
  'disableArtifact',
] as const

/** Official 2.1.323 (#2120) `zs` — boolean enable off-switches from parent/SDK managedSettings. */
export const PARENT_MANAGED_ENABLE_OFF_SWITCHES = [
  'enableWorkflows',
  'enableArtifact',
] as const

/**
 * Official 2.1.323 (#2120) `Vsi` subset: extract off switches from Agent SDK /
 * parent `managedSettings` so Remote Control, agent view, Workflows, and
 * Artifact disable/off switches are never ignored.
 */
export function extractParentManagedOffSwitches(
  parentManaged: SettingsJson | null | undefined,
): Partial<SettingsJson> | null {
  if (!parentManaged) return null
  const out: Partial<SettingsJson> = {}
  for (const key of PARENT_MANAGED_DISABLE_SWITCHES) {
    if (parentManaged[key] === true) {
      out[key] = true
    }
  }
  for (const key of PARENT_MANAGED_ENABLE_OFF_SWITCHES) {
    if (parentManaged[key] === false) {
      out[key] = false
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

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
  'CLAUDE_CODE_SUBAGENT_MODEL_FORCE',
  'CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL',
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
 * densable b6i / r4o — mutate settings in place: drop model / fallbackModel /
 * modelOverrides, and filter settings.env against Wfg.
 * Official 2.1.323 (#1968): when `keepAutoModeModel` is true (Claude Desktop
 * sessions on third-party providers), `CLAUDE_CODE_AUTO_MODE_MODEL` is kept.
 * Official 2.1.326 (#21): when `keepSubagentModel` is true (Claude Desktop
 * Code tab) and `settings.env` does NOT choose a provider or gateway,
 * `CLAUDE_CODE_SUBAGENT_MODEL*` keys are preserved.
 */
export function stripHostManagedPolicyModelKeys(
  settings: SettingsJson,
  keepAutoModeModel = false,
  keepSubagentModel = false,
): SettingsJson {
  delete settings.model
  delete settings.fallbackModel
  delete settings.modelOverrides
  if (settings.env) {
    const preserveSubagent =
      keepSubagentModel && !envSelectsProviderOrGateway(settings.env)
    const kept: Record<string, string> = {}
    for (const [key, value] of Object.entries(settings.env)) {
      const upper = key.toUpperCase()
      if (
        !HOST_MODEL_POLICY_STRIP_ENV_KEYS.has(upper) ||
        (keepAutoModeModel && upper === 'CLAUDE_CODE_AUTO_MODE_MODEL') ||
        (preserveSubagent && MANAGED_SUBAGENT_MODEL_ENV_KEYS.has(upper))
      ) {
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
  keepAutoModeModel = isLocalThirdPartyDesktopManagedSession(),
  keepSubagentModel = isDesktopCodeTabSession(),
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
  stripHostManagedPolicyModelKeys(next, keepAutoModeModel, keepSubagentModel)
  if (hostModelOverlay) {
    Object.assign(next, hostModelOverlay)
  }
  return next
}

/**
 * Official 2.1.328 (#546): merge an embedding host's managed-settings overlay
 * (`allowManagedHooksOnly`, `disableAllHooks`, `disableCommandPluginSources`,
 * `pluginConfigs['policy@builtin'].options.allowManagedModsOnly` /
 * `forceHotReloadPrompt`) onto admin managed settings while ensuring admin's
 * explicit settings always win. Uses lazy require to stay cycle-free with
 * `pluginPolicy.ts -> settings.ts -> hostModelOverlay.ts`.
 */
export function applyHostPolicyOverlay(
  adminManagedSettings: SettingsJson | null,
  parentManaged: SettingsJson | null | undefined,
): SettingsJson | null {
  if (!parentManaged) return adminManagedSettings
  try {
    const {
      buildHostOverlayManagedSettings,
      mergeManagedSettingsWithHostOverlay,
    } = pluginPolicyModule
    const hostOverlay = buildHostOverlayManagedSettings(
      parentManaged as Record<string, unknown>,
    )
    if (Object.keys(hostOverlay).length === 0) {
      return adminManagedSettings
    }
    const merged = mergeManagedSettingsWithHostOverlay(
      adminManagedSettings as Record<string, unknown> | null,
      hostOverlay,
    )
    return Object.keys(merged).length > 0
      ? (merged as SettingsJson)
      : adminManagedSettings
  } catch {
    return adminManagedSettings
  }
}
