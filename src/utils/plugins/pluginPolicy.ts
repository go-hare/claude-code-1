/**
 * Plugin policy checks backed by managed settings (policySettings).
 *
 * Kept as a leaf module (only imports settings + marketplaceHelpers equality
 * helpers) to avoid circular dependencies — marketplaceHelpers.ts imports
 * marketplaceManager.ts which transitively reaches most of the plugin subsystem.
 */

import { isRemoteManagedPolicyConsented } from '../../services/remoteManagedSettings/syncCacheState.js'
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

// densable psr = Z_e()!=="remote" || Qxn() — imported from the leaf
// syncCacheState (not syncCache) to avoid the auth SCC. No env stand-in.

/**
 * densable `JLa`-style structural equality for policy declaration matching.
 * Mirrors marketplaceHelpers `areSourcesEqual` without importing that module
 * (circular risk via marketplaceManager).
 */
function policySourcesEqual(
  a: MarketplaceSource,
  b: MarketplaceSource,
): boolean {
  if (a.source !== b.source) return false
  switch (a.source) {
    case 'url':
      return a.url === (b as typeof a).url
    case 'github': {
      const other = b as typeof a
      return (
        a.repo === other.repo &&
        (a.ref || undefined) === (other.ref || undefined) &&
        (a.path || undefined) === (other.path || undefined)
      )
    }
    case 'git': {
      const other = b as typeof a
      return (
        a.url === other.url &&
        (a.ref || undefined) === (other.ref || undefined) &&
        (a.path || undefined) === (other.path || undefined)
      )
    }
    case 'npm':
      return a.package === (b as typeof a).package
    case 'file':
    case 'directory':
      return a.path === (b as typeof a).path
    case 'settings':
      return a.name === (b as typeof a).name
    case 'hostPattern':
    case 'pathPattern':
      return false
    default:
      return false
  }
}

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
  if (!isRemoteManagedPolicyConsented()) {
    return 'remote_policy_unconsented'
  }
  const policy = getSettingsForSource('policySettings')
  const extra = policy?.extraKnownMarketplaces ?? {}
  if (source.source === 'settings' && marketplaceName !== undefined) {
    const declared = Object.hasOwn(extra, marketplaceName)
      ? extra[marketplaceName]
      : undefined
    const declaredSource = declared?.source as MarketplaceSource | undefined
    if (declaredSource?.source !== 'settings') {
      return 'lockdown'
    }
    return null
  }
  const allowed = Object.values(extra).some(entry => {
    const declared = entry?.source as MarketplaceSource | undefined
    return declared !== undefined && policySourcesEqual(source, declared)
  })
  return allowed ? null : 'lockdown'
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
