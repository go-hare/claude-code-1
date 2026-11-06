/**
 * densable 2.1.289 yfe `cc-plugin-sec-default` (`ge` / `qjr` / `VG` / `ZEn` / `MEt`).
 */
import { join } from 'path'
import type { LoadedPlugin } from '../../types/plugin.js'
import { getSubscriptionType } from '../../utils/auth.js'
import { logForDebugging } from '../../utils/debug.js'
import { leftoverFu } from '../../utils/plugins/functionHooksModules.js'
import {
  foldPluginName,
  marketplaceSuffixFromSource,
} from '../../utils/plugins/pluginIdentifier.js'
import { isMarketplaceSourceDeclaredInManagedSettings } from '../../utils/plugins/marketplaceHelpers.js'
import { ALLOWED_OFFICIAL_MARKETPLACE_NAMES } from '../../utils/plugins/schemas.js'
import { getEnabledSettingSources } from '../../utils/settings/constants.js'
import {
  getSettingsForSource,
  getSettingsWithErrors,
} from '../../utils/settings/settings.js'
import {
  BUILTIN_MARKETPLACE_NAME,
  getBuiltinPluginDefinition,
  isBuiltinPluginId,
  normalizeCanonicalBuiltinPluginId,
  registerBuiltinPlugin,
} from '../builtinPlugins.js'

export const SEC_DEFAULT_MOD_FOLDER = 'sec-default'
export const SEC_DEFAULT_PLUGIN_NAME = 'cc-plugin-sec-default'
export const SEC_DEFAULT_PLUGIN_ID = `${SEC_DEFAULT_PLUGIN_NAME}@${BUILTIN_MARKETPLACE_NAME}`
export const SEC_DEFAULT_PLUGIN_DESCRIPTION =
  "Security default: seated outermost on a machine with managed settings and for Team and Enterprise organizations unless managed prependPlugins is set, in which case the organization lists cc-plugin-sec-default@builtin there or not; keeps the organization's classic hooks, prompt content, settings and tool policy out of reach of the plugins a person installs, and adds no policy of its own"

const PLUGIN_HOOK_TIERS = [
  'prepend',
  'user',
  'append',
  'builtin',
  'core',
] as const

export type PluginHookTier = (typeof PLUGIN_HOOK_TIERS)[number]
export type AssignedPluginHookTier = 'prepend' | 'user' | 'append' | 'builtin'
export type PluginHookTierSource = 'none' | 'policy' | 'user'
export type PluginHookTierSettingKey = 'prependPlugins' | 'appendPlugins'

export type PluginHookTierOrder = {
  prepend: string[]
  append: string[]
  from: {
    prepend: PluginHookTierSource
    append: PluginHookTierSource
  }
  shadowed: PluginHookTierSettingKey[]
  shadowedBy?: 'seat'
  outermost: string[]
  seat: string
}

function foldPluginId(pluginId: string): string {
  return pluginId.trim().normalize('NFC').toLowerCase()
}

function foldCanonicalPluginId(pluginId: string): string {
  return normalizeCanonicalBuiltinPluginId(foldPluginId(pluginId))
}

function pluginHookTierIndex(tier: PluginHookTier): number {
  return PLUGIN_HOOK_TIERS.indexOf(tier)
}

function isTrustedSettingsOnlyBuiltinPluginId(pluginId: string): boolean {
  const folded = foldCanonicalPluginId(pluginId)
  if (!isBuiltinPluginId(folded)) return false
  const suffix = `@${BUILTIN_MARKETPLACE_NAME}`
  const name = folded.slice(0, -suffix.length)
  const definition = getBuiltinPluginDefinition(name)
  return definition?.enabledFromTrustedSettingsOnly === true
}

function hasManagedSettingsOnMachine(): boolean {
  const policy = getSettingsForSource('policySettings')
  if (policy !== null && Object.keys(policy).length > 0) return true
  try {
    const { errors } = getSettingsWithErrors()
    return errors.some(err => {
      const rec = err as unknown as Record<string, unknown>
      return (
        rec.source === 'policySettings' &&
        rec.userWritable !== true &&
        rec.wslIgnored !== true
      )
    })
  } catch {
    return false
  }
}

/**
 * densable `ASt` / `Rtr` — empty slot. `Ejo` writes `{managedIds, order}`
 * after it vouches managed plugins; `iF` / `aF` / `VG` return the slot
 * instead of recomputing. Cleared when policy settings change.
 */
type VouchedTierCache = {
  managedIds: Set<string>
  order: PluginHookTierOrder
}
let vouchedTierCache: VouchedTierCache | undefined

/** densable `ASt()`. */
function readVouchedTierCache(): VouchedTierCache | undefined {
  return vouchedTierCache
}

/** densable `Rtr.set`. `undefined` clears the slot. */
export function setVouchedTierCache(next: VouchedTierCache | undefined): void {
  vouchedTierCache = next
}

/**
 * densable `iF()` — plugin IDs enabled (`=== true`) in
 * `policySettings.enabledPlugins`. A VG-cache hit returns `managedIds`.
 */
function collectManagedEnabledPluginIds(): Set<string> | null {
  const cached = readVouchedTierCache()
  if (cached) return new Set(cached.managedIds)
  const enabledPlugins = getSettingsForSource('policySettings')?.enabledPlugins
  if (!enabledPlugins) return null
  const ids = new Set<string>()
  for (const [key, value] of Object.entries(enabledPlugins)) {
    if (value === true && key.includes('@')) {
      ids.add(normalizeCanonicalBuiltinPluginId(key))
    }
  }
  return ids.size > 0 ? ids : null
}

/**
 * densable `dt().vouchedManagedPluginIds`. `Ejo` fills this with the managed
 * plugins it seated (read in place from a declared marketplace source).
 */
const vouchedManagedPluginIds = new Set<string>()

/**
 * densable `aF()` — `iF`, then keep `@builtin` or vouched ids. A VG-cache
 * hit (`e===null||ASt()`) returns `iF` unfiltered.
 */
export function getManagedEnabledPluginIds(): Set<string> | null {
  const managed = collectManagedEnabledPluginIds()
  if (managed === null || readVouchedTierCache() !== undefined) return managed
  const filtered = [...managed].filter(
    id =>
      marketplaceSuffixFromSource(id) === BUILTIN_MARKETPLACE_NAME ||
      vouchedManagedPluginIds.has(foldPluginName(id)),
  )
  return filtered.length > 0 ? new Set(filtered) : null
}

const MANAGED_NOT_NAMED =
  "is enabled by managed settings, but managed settings do not name the source its marketplace is registered from, so it is not treated as the organization's: its hooks module runs in the user tier. It is seated when the marketplace is registered from the source that managed settings declare for it under extraKnownMarketplaces."
const MANAGED_NOT_IN_PLACE =
  "is enabled by managed settings, but it is not read in place from a local folder its marketplace is registered from: it loads from a copy (the plugin cache, an archive or a seed directory), or that marketplace has no folder of its own. Nothing yet records which source a copy was taken from, so it is not treated as the organization's: its hooks module runs in the user tier, and does not load where only managed hooks may. It is seated when managed settings declare its marketplace under extraKnownMarketplaces as a local directory and that marketplace lists it by a relative path. A plugin delivered from a remote source gains the tier in a later release."

/** densable `P` — seated when read in place from a declared marketplace. */
function pluginSeatedFromDeclaredMarketplace(plugin: LoadedPlugin): boolean {
  const marketplace = marketplaceSuffixFromSource(plugin.source)
  const source = plugin.marketplaceSource
  if (
    marketplace === undefined ||
    source === undefined ||
    plugin.readInPlace !== true ||
    ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(marketplace.toLowerCase())
  ) {
    return false
  }
  return isMarketplaceSourceDeclaredInManagedSettings(marketplace, source)
}

/**
 * densable `Ejo` — warn for managed plugins that are not seated, then fill
 * `vouchedManagedPluginIds`. `aF` keeps `@builtin` and these vouched ids.
 */
export function seatManagedPlugins(plugins: readonly LoadedPlugin[]): void {
  const managed = new Set(
    [...(collectManagedEnabledPluginIds() ?? [])].map(foldPluginName),
  )
  const enabled = plugins.filter(plugin =>
    managed.has(foldPluginName(plugin.source)),
  )
  const unseated = enabled.filter(
    plugin =>
      marketplaceSuffixFromSource(plugin.source) !== BUILTIN_MARKETPLACE_NAME &&
      !pluginSeatedFromDeclaredMarketplace(plugin),
  )
  for (const plugin of unseated) {
    if (plugin.modulePath === undefined) continue
    const label =
      plugin.source.length > 300
        ? `…${plugin.source.slice(-299)}`
        : plugin.source
    logForDebugging(
      `${label} ${plugin.readInPlace === true ? MANAGED_NOT_NAMED : MANAGED_NOT_IN_PLACE}`,
      { level: 'warn' },
    )
  }
  const unseatedIds = new Set(
    unseated.map(plugin => foldPluginName(plugin.source)),
  )
  vouchedManagedPluginIds.clear()
  for (const plugin of enabled) {
    const id = foldPluginName(plugin.source)
    if (!unseatedIds.has(id)) vouchedManagedPluginIds.add(id)
  }
}

function safeGetSubscriptionType():
  | ReturnType<typeof getSubscriptionType>
  | undefined {
  try {
    return getSubscriptionType()
  } catch {
    return undefined
  }
}

/**
 * densable `qjr(e)` — compute `{ outermost, seat }` for `cc-plugin-sec-default@builtin`.
 */
export function seatSecDefaultPlugin(prependIds?: readonly string[]): {
  outermost: string[]
  seat: string
} {
  const normalized = prependIds?.map(foldCanonicalPluginId)
  const hasList = normalized !== undefined
  const index = normalized?.indexOf(SEC_DEFAULT_PLUGIN_ID) ?? -1
  const inList = index !== -1
  const hasManaged = hasManagedSettingsOnMachine()
  const sub = hasList || hasManaged ? undefined : safeGetSubscriptionType()
  const isOrgTier = sub === 'team' || sub === 'enterprise'
  const isSeated = hasList ? inList : hasManaged || isOrgTier
  const reason = hasList
    ? inList
      ? `seated by managed prependPlugins at position ${index + 1}`
      : 'not seated: managed prependPlugins does not list it'
    : hasManaged
      ? 'seated outermost: this machine has managed settings'
      : isOrgTier
        ? `seated outermost: the organization is ${sub}`
        : `not seated: no managed settings and not a Team or Enterprise organization (${sub ?? 'none'})`
  return {
    outermost: isSeated ? [SEC_DEFAULT_PLUGIN_ID] : [],
    seat: `${SEC_DEFAULT_PLUGIN_ID} ${reason}`,
  }
}

/**
 * densable `VG()` — resolve `prependPlugins` / `appendPlugins` tier order and `sec-default` seat.
 */
export function resolvePluginHookTierOrder(): PluginHookTierOrder {
  const cached = readVouchedTierCache()
  if (cached) return cached.order
  const hasManaged = hasManagedSettingsOnMachine()
  const userSettings = getEnabledSettingSources().includes('userSettings')
    ? getSettingsForSource('userSettings')
    : null
  const unseated = hasManaged ? undefined : seatSecDefaultPlugin()
  const seatedWithoutList =
    unseated !== undefined && unseated.outermost.length > 0
  const allowUserTierKeys = !hasManaged && !seatedWithoutList
  const activeSource = hasManaged
    ? getSettingsForSource('policySettings')
    : allowUserTierKeys
      ? userSettings
      : null
  const keys: readonly PluginHookTierSettingKey[] = [
    'prependPlugins',
    'appendPlugins',
  ]
  const [prependResolved, appendResolved] = keys.map(key => {
    const raw = activeSource?.[key]
    const ids = Array.isArray(raw)
      ? raw
          .filter((item): item is string => typeof item === 'string')
          .map(foldCanonicalPluginId)
      : undefined
    const from: PluginHookTierSource =
      ids === undefined ? 'none' : hasManaged ? 'policy' : 'user'
    const shadowed = !allowUserTierKeys && userSettings?.[key] !== undefined
    return { ids, from, shadowed }
  }) as [
    {
      ids: string[] | undefined
      from: PluginHookTierSource
      shadowed: boolean
    },
    {
      ids: string[] | undefined
      from: PluginHookTierSource
      shadowed: boolean
    },
  ]
  const seatResult = unseated ?? seatSecDefaultPlugin(prependResolved.ids)
  const resolvedPair = [prependResolved, appendResolved] as const
  return {
    prepend: prependResolved.ids ?? [],
    append: appendResolved.ids ?? [],
    from: {
      prepend: prependResolved.from,
      append: appendResolved.from,
    },
    shadowed: keys.filter((_, idx) => resolvedPair[idx]?.shadowed === true),
    ...(seatedWithoutList && { shadowedBy: 'seat' as const }),
    ...seatResult,
  }
}

/**
 * densable `ZEn(pluginId, managedIds, order)` — assign hook module tier.
 */
export function computePluginHookTier(
  pluginId: string,
  managedIds: Iterable<string> | null | undefined,
  order: Pick<PluginHookTierOrder, 'prepend' | 'append' | 'from' | 'outermost'>,
): AssignedPluginHookTier {
  const folded = foldCanonicalPluginId(pluginId)
  if (isBuiltinPluginId(folded)) {
    return order.outermost.includes(folded) ? 'prepend' : 'builtin'
  }
  const isManaged = [...(managedIds ?? [])].some(candidate => {
    const foldedCandidate = foldCanonicalPluginId(candidate)
    return !isBuiltinPluginId(foldedCandidate) && foldedCandidate === folded
  })
  const matchesList = (slot: 'prepend' | 'append'): boolean =>
    order[slot].includes(folded) &&
    (order.from[slot] === 'user' ? !isManaged : isManaged)
  const defaultTier: AssignedPluginHookTier = isManaged ? 'prepend' : 'user'
  const listedTier: AssignedPluginHookTier = matchesList('prepend')
    ? 'prepend'
    : 'append'
  return matchesList('prepend') || matchesList('append')
    ? listedTier
    : defaultTier
}

/**
 * densable `MEt(pluginId, managedIds, order)` — compute numeric hook module sort rank.
 */
export function computePluginHookOrderRank(
  pluginId: string,
  managedIds: Iterable<string> | null | undefined,
  order: Pick<PluginHookTierOrder, 'prepend' | 'append' | 'from' | 'outermost'>,
): number {
  const stride =
    order.outermost.length + order.prepend.length + order.append.length + 1
  const tier = computePluginHookTier(pluginId, managedIds, order)
  const empty: readonly string[] = []
  const isPolicyListedPrepend = (id: string): boolean =>
    order.from.prepend === 'policy' && order.prepend.includes(id)
  const folded = foldCanonicalPluginId(pluginId)
  const orderedIdsByTier: Record<AssignedPluginHookTier, readonly string[]> = {
    prepend: [
      ...order.outermost.filter(id => !isPolicyListedPrepend(id)),
      ...order.prepend,
    ],
    append: order.append,
    user: empty,
    builtin: empty,
  }
  const listIndex = orderedIdsByTier[tier].indexOf(folded)
  const subBucket =
    (tier === 'prepend' && listIndex === -1) ||
    (tier === 'builtin' && isTrustedSettingsOnlyBuiltinPluginId(pluginId))
      ? 1
      : 0
  return (
    (pluginHookTierIndex(tier) * 2 + subBucket) * stride +
    Math.max(listIndex, 0)
  )
}

/**
 * densable `y` — `VG().outermost.includes(fgt)`.
 */
function leftoverSecDefaultSeated(): boolean {
  return resolvePluginHookTierOrder().outermost.includes(SEC_DEFAULT_PLUGIN_ID)
}

export function isSecDefaultPluginAvailable(): boolean {
  return leftoverSecDefaultSeated()
}

export function registerSecDefaultBuiltinPlugin(): void {
  registerBuiltinPlugin({
    name: SEC_DEFAULT_PLUGIN_NAME,
    description: SEC_DEFAULT_PLUGIN_DESCRIPTION,
    enabledFromTrustedSettingsOnly: true,
    enabledFromPolicyOnly: true,
    isAvailable: isSecDefaultPluginAvailable,
    hooksModule: leftoverFu(
      join(
        import.meta.dir,
        '../../../vendor/claude-code-mods/mods/sec-default',
      ),
      {
        register: (...args: unknown[]) => {
          const mod =
            require('../../../vendor/claude-code-mods/mods/sec-default/hooks/register.ts') as {
              register?: (...inner: unknown[]) => unknown
            }
          return mod.register?.(...args)
        },
      },
      () => ({
        scan: {
          hooks: [
            'classic.*',
            'prompt.section',
            'prompt.context',
            'prompt.compose',
            'skill.prompt',
            'attribution.text',
            'settings.read',
            'tool.describe',
            'command.describe',
            'agent.offer',
            'agent.spawn',
            'tool.register',
            'tool.list',
            'tool.check',
            'plugin.register',
          ],
          calls: ['settings.read', 'ui.log'],
          nextTo: ['append'],
        },
        files: {},
      }),
    ),
  })
}
