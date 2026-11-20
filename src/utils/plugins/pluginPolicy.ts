/**
 * Plugin policy checks backed by managed settings (policySettings).
 *
 * Kept as a leaf module (only imports settings + marketplaceHelpers equality
 * helpers) to avoid circular dependencies — marketplaceHelpers.ts imports
 * marketplaceManager.ts which transitively reaches most of the plugin subsystem.
 */

import { getSettingsForSource } from '../settings/settings.js'
import type { MarketplaceSource } from './schemas.js'

/**
 * Check if a plugin is force-disabled by org policy (managed-settings.json).
 * Policy-blocked plugins cannot be installed or enabled by the user at any
 * scope. Used as the single source of truth for policy blocking across the
 * install chokepoint, enable op, and UI filters.
 */
export function isPluginBlockedByPolicy(pluginId: string): boolean {
  const policyEnabled = getSettingsForSource('policySettings')?.enabledPlugins
  return policyEnabled?.[pluginId] === false
}

/**
 * densable `q9` — same gate as `areCommandPluginSourcesDisabledByPolicy`:
 * `policySettings.disableCommandPluginSources` wins; else `allowManagedHooksOnly`.
 */
export function areHeadersHelperCommandsDisabledByPolicy(): boolean {
  const policy = getSettingsForSource('policySettings') as
    | {
        disableCommandPluginSources?: boolean
        allowManagedHooksOnly?: boolean
      }
    | null
    | undefined
  if (policy?.disableCommandPluginSources !== undefined) {
    return policy.disableCommandPluginSources === true
  }
  return policy?.allowManagedHooksOnly === true
}

export type HeadersHelperPolicyRefusal =
  | 'lockdown'
  | 'remote_policy_unconsented'

/**
 * densable `fgt` / `headersHelperPolicyRefusal`.
 * Returns null when helper may run; otherwise refusal kind.
 */
export function headersHelperPolicyRefusal(
  source: MarketplaceSource | undefined,
  marketplaceName?: string,
): HeadersHelperPolicyRefusal | null {
  if (!areHeadersHelperCommandsDisabledByPolicy()) {
    return null
  }
  if (source === undefined) {
    return 'lockdown'
  }
  // densable fgt: when command sources are disabled, a concrete marketplace
  // source is remote-policy-unconsented (extraKnownMarketplaces compare is
  // unreachable after Anthropic remote consent was product-cut).
  return 'remote_policy_unconsented'
}

/**
 * densable `YLa` / `isHeadersHelperDisabledByPolicy`.
 */
export function isHeadersHelperDisabledByPolicy(
  source: MarketplaceSource | undefined,
  marketplaceName?: string,
): boolean {
  return headersHelperPolicyRefusal(source, marketplaceName) !== null
}

/**
 * Official 2.1.328 (#546) — host-overlay support for apps that embed Claude
 * Code to switch on the policy plugin's `allowManagedModsOnly` option while
 * ensuring an admin's managed settings still win (`bbt` / `Yyr` / `xr`).
 */
export const POLICY_MOD_PLUGIN_ID = 'policy@builtin'
export const LEGACY_POLICY_MOD_PLUGIN_IDS = ['sec-default@builtin'] as const

export const HOST_OVERLAY_MANAGED_SETTINGS = Object.freeze([
  'allowManagedHooksOnly',
  'disableAllHooks',
  'disableCommandPluginSources',
] as const)

export const HOST_OVERLAY_POLICY_MOD_OPTIONS = Object.freeze([
  'allowManagedModsOnly',
  'forceHotReloadPrompt',
] as const)

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidPolicyModOptionValue(value: unknown): boolean {
  return (
    value !== false &&
    (['string', 'number', 'boolean'].includes(typeof value) ||
      (Array.isArray(value) && value.every(item => typeof item === 'string')))
  )
}

function getNestedValue(
  root: Record<string, unknown> | null | undefined,
  path: readonly string[],
): unknown {
  let cur: unknown = root
  for (const key of path) {
    if (!isPlainRecord(cur)) return undefined
    cur = cur[key]
  }
  return cur
}

function setNestedValue(
  root: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  let cur: Record<string, unknown> = root
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!
    const existing = cur[key]
    const next: Record<string, unknown> = isPlainRecord(existing)
      ? { ...existing }
      : {}
    cur[key] = next
    cur = next
  }
  cur[path[path.length - 1]!] = value
}

/**
 * Official `bbt` — extract allowed policy-plugin options (`allowManagedModsOnly`,
 * `forceHotReloadPrompt`) from an embedding host's overlay settings, honoring
 * legacy `sec-default@builtin` and canonical `policy@builtin` (canonical wins).
 */
export function extractHostOverlayPolicyModConfigs(
  hostSettings: Record<string, unknown> | null | undefined,
): Record<string, { options: Record<string, unknown> }> | undefined {
  if (!isPlainRecord(hostSettings)) return undefined
  const merged = new Map<string, unknown>()
  for (const pluginId of [
    ...LEGACY_POLICY_MOD_PLUGIN_IDS,
    POLICY_MOD_PLUGIN_ID,
  ]) {
    const opts = getNestedValue(hostSettings, [
      'pluginConfigs',
      pluginId,
      'options',
    ])
    if (!isPlainRecord(opts)) continue
    for (const [key, val] of Object.entries(opts)) {
      if (val === false || isValidPolicyModOptionValue(val)) {
        merged.set(key, val)
      }
    }
  }
  const options: Record<string, unknown> = {}
  for (const key of HOST_OVERLAY_POLICY_MOD_OPTIONS) {
    const val = merged.get(key)
    if (isValidPolicyModOptionValue(val)) {
      options[key] = val
    }
  }
  return Object.keys(options).length > 0
    ? { [POLICY_MOD_PLUGIN_ID]: { options } }
    : undefined
}

/**
 * Official `Yyr` — build the managed-settings overlay contributed by an
 * embedding host app (`allowManagedHooksOnly`, `disableAllHooks`,
 * `disableCommandPluginSources`, plus `pluginConfigs['policy@builtin'].options`).
 */
export function buildHostOverlayManagedSettings(
  hostSettings: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!isPlainRecord(hostSettings)) return {}
  const out: Record<string, unknown> = {}
  for (const key of HOST_OVERLAY_MANAGED_SETTINGS) {
    if (hostSettings[key] === true) {
      out[key] = true
    }
  }
  const pluginConfigs = extractHostOverlayPolicyModConfigs(hostSettings)
  if (pluginConfigs !== undefined) {
    out.pluginConfigs = pluginConfigs
  }
  return Object.keys(out).length > 0
    ? { ...out, managedSourcesBehavior: 'merge' }
    : {}
}

/**
 * Official `xr` — apply an embedding host's managed-settings overlay onto
 * admin managed settings. Any option explicitly configured by the admin's
 * managed settings still wins (including an admin setting
 * `allowManagedModsOnly: false` to override a host overlay's `true`).
 */
export function mergeManagedSettingsWithHostOverlay(
  adminManagedSettings: Record<string, unknown> | null | undefined,
  hostOverlaySettings: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const admin = isPlainRecord(adminManagedSettings) ? adminManagedSettings : {}
  const host = buildHostOverlayManagedSettings(hostOverlaySettings)
  if (Object.keys(host).length === 0) return admin

  const result: Record<string, unknown> = { ...admin }
  let appliedAny = false

  for (const key of HOST_OVERLAY_MANAGED_SETTINGS) {
    if (host[key] === true && admin[key] === undefined) {
      result[key] = true
      appliedAny = true
    }
  }

  for (const key of HOST_OVERLAY_POLICY_MOD_OPTIONS) {
    const hostVal = getNestedValue(host, [
      'pluginConfigs',
      POLICY_MOD_PLUGIN_ID,
      'options',
      key,
    ])
    if (!isValidPolicyModOptionValue(hostVal)) continue
    const adminVal =
      getNestedValue(admin, [
        'pluginConfigs',
        POLICY_MOD_PLUGIN_ID,
        'options',
        key,
      ]) ??
      getNestedValue(admin, [
        'pluginConfigs',
        LEGACY_POLICY_MOD_PLUGIN_IDS[0],
        'options',
        key,
      ])
    // Admin's explicit managed setting (true or false) always wins over host overlay
    if (adminVal === undefined) {
      setNestedValue(
        result,
        ['pluginConfigs', POLICY_MOD_PLUGIN_ID, 'options', key],
        hostVal,
      )
      appliedAny = true
    }
  }

  if (appliedAny) {
    result.managedSourcesBehavior = 'merge'
  }
  return result
}

/**
 * Resolve the effective `allowManagedModsOnly` boolean given admin managed
 * settings and an optional embedding host overlay (admin always wins).
 */
export function isAllowManagedModsOnlyEffective(
  adminManagedSettings?: Record<string, unknown> | null,
  hostOverlaySettings?: Record<string, unknown> | null,
): boolean {
  const effectiveAdmin =
    adminManagedSettings !== undefined
      ? adminManagedSettings
      : (getSettingsForSource('policySettings') as Record<
          string,
          unknown
        > | null)
  const merged = mergeManagedSettingsWithHostOverlay(
    effectiveAdmin,
    hostOverlaySettings,
  )
  const val =
    getNestedValue(merged, [
      'pluginConfigs',
      POLICY_MOD_PLUGIN_ID,
      'options',
      'allowManagedModsOnly',
    ]) ??
    getNestedValue(merged, [
      'pluginConfigs',
      LEGACY_POLICY_MOD_PLUGIN_IDS[0],
      'options',
      'allowManagedModsOnly',
    ])
  return val === true
}
