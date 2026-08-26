import type {
  EditableSettingSource,
  SettingSource,
} from '../settings/constants.js'
import {
  ALLOWED_OFFICIAL_MARKETPLACE_NAMES,
  type PluginScope,
} from './schemas.js'

/**
 * Extended scope type that includes 'flag' for session-only plugins.
 * 'flag' scope is NOT persisted to installed_plugins.json.
 */
export type ExtendedPluginScope = PluginScope | 'flag'

/**
 * Scopes that are persisted to installed_plugins.json.
 * Excludes 'flag' which is session-only.
 */
export type PersistablePluginScope = Exclude<ExtendedPluginScope, 'flag'>

/**
 * Map from SettingSource to plugin scope.
 * Note: flagSettings maps to 'flag' which is session-only and not persisted.
 */
export const SETTING_SOURCE_TO_SCOPE = {
  policySettings: 'managed',
  userSettings: 'user',
  projectSettings: 'project',
  localSettings: 'local',
  flagSettings: 'flag',
} as const satisfies Record<SettingSource, ExtendedPluginScope>

/**
 * Parsed plugin identifier with name and optional marketplace
 */
export type ParsedPluginIdentifier = {
  name: string
  marketplace?: string
}

/**
 * Parse a plugin identifier string into name and marketplace components
 * @param plugin The plugin identifier (name or name@marketplace)
 * @returns Parsed plugin name and optional marketplace
 *
 * Note: Only the first '@' is used as separator. If the input contains multiple '@' symbols
 * (e.g., "plugin@market@place"), everything after the second '@' is ignored.
 * This is intentional as marketplace names should not contain '@'.
 */
export function parsePluginIdentifier(plugin: string): ParsedPluginIdentifier {
  // densable hi — first '@' splits name/marketplace (marketplace must not contain @)
  if (plugin.includes('@')) {
    const parts = plugin.split('@')
    return { name: parts[0] || '', marketplace: parts[1] }
  }
  return { name: plugin }
}

/**
 * densable Lwe — case-insensitive plugin id/name equality.
 */
export function pluginIdEquals(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase()
}

/**
 * densable are — find key in list with exact match first, then Lwe.
 */
export function findPluginKeyCaseInsensitive(
  keys: readonly string[],
  target: string,
): string | undefined {
  return (
    keys.find(k => k === target) ?? keys.find(k => pluginIdEquals(k, target))
  )
}

/**
 * Build a plugin ID from name and marketplace
 * @param name The plugin name
 * @param marketplace Optional marketplace name
 * @returns Plugin ID in format "name" or "name@marketplace"
 */
export function buildPluginId(name: string, marketplace?: string): string {
  return marketplace ? `${name}@${marketplace}` : name
}

/**
 * densable `iN` — sentinel marketplace for plugins synced from claude.ai.
 * Display / enable / disable use `{name}@synced`. Not a real marketplace.
 */
export const SYNCED_MARKETPLACE_NAME = 'synced'

/** densable `pluginId.endsWith('@'+iN)`. */
export function isSyncedPluginId(pluginId: string): boolean {
  return pluginId.endsWith(`@${SYNCED_MARKETPLACE_NAME}`)
}

/**
 * densable `G$` — marketplace suffix after the **last** `@`.
 * Empty suffix is treated as missing (same as no `@`).
 */
export function marketplaceSuffixFromSource(
  source: string,
): string | undefined {
  const at = source.lastIndexOf('@')
  if (at < 0) {
    return undefined
  }
  const suffix = source.slice(at + 1)
  return suffix === '' ? undefined : suffix
}

/** densable `zD` — NFC-fold + lowercase for synced name matching. */
export function foldPluginName(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

/**
 * densable `I9a` — enabled local (non-`@synced`) copy of the same folded name.
 * Disabled locals do not shadow.
 */
export function localCopyShadowingSynced<
  T extends { name: string; source: string; enabled?: boolean },
>(name: string, plugins: readonly T[]): T | undefined {
  const folded = foldPluginName(name)
  return plugins.find(
    plugin =>
      plugin.enabled !== false &&
      marketplaceSuffixFromSource(plugin.source) !== SYNCED_MARKETPLACE_NAME &&
      foldPluginName(plugin.name) === folded,
  )
}

/**
 * densable `f3a` for `@synced`: no settings row → `defaultEnabled !== false`;
 * a present row is opt-in (`=== true`, official `AKp` for `iN`).
 */
export function isSyncedPluginEnabled(
  pluginId: string,
  defaultEnabled: boolean | undefined,
  // Settings schema allows string[] values (per-marketplace lists); only
  // `=== true` opts in, so wider values are safely treated as not opted in.
  enabledPlugins: Record<string, boolean | string[] | undefined> | undefined,
): boolean {
  const setting = enabledPlugins?.[pluginId]
  if (setting === undefined) {
    return defaultEnabled !== false
  }
  return setting === true
}

/**
 * Check if a marketplace name is an official (Anthropic-controlled) marketplace.
 * Used for telemetry redaction — official plugin identifiers are safe to log to
 * general-access additional_metadata; third-party identifiers go only to the
 * PII-tagged _PROTO_* BQ columns.
 */
export function isOfficialMarketplaceName(
  marketplace: string | undefined,
): boolean {
  return (
    marketplace !== undefined &&
    ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(marketplace.toLowerCase())
  )
}

/**
 * Map from installable plugin scope to editable setting source.
 * This is the inverse of SETTING_SOURCE_TO_SCOPE for editable scopes only.
 * Note: 'managed' scope cannot be installed to, so it's not included here.
 */
const SCOPE_TO_EDITABLE_SOURCE: Record<
  Exclude<PluginScope, 'managed'>,
  EditableSettingSource
> = {
  user: 'userSettings',
  project: 'projectSettings',
  local: 'localSettings',
}

/**
 * Convert a plugin scope to its corresponding editable setting source
 * @param scope The plugin installation scope
 * @returns The corresponding setting source for reading/writing settings
 * @throws Error if scope is 'managed' (cannot install plugins to managed scope)
 */
export function scopeToSettingSource(
  scope: PluginScope,
): EditableSettingSource {
  if (scope === 'managed') {
    throw new Error('Cannot install plugins to managed scope')
  }
  return SCOPE_TO_EDITABLE_SOURCE[scope]
}

/**
 * Convert an editable setting source to its corresponding plugin scope.
 * Derived from SETTING_SOURCE_TO_SCOPE to maintain a single source of truth.
 * @param source The setting source
 * @returns The corresponding plugin scope
 */
export function settingSourceToScope(
  source: EditableSettingSource,
): Exclude<PluginScope, 'managed'> {
  return SETTING_SOURCE_TO_SCOPE[source] as Exclude<PluginScope, 'managed'>
}
