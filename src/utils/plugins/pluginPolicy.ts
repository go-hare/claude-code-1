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
