/**
 * densable 2.1.289 yfe `cc-plugin-sec-default` (`ge` / `qjr` / `VG` / `ZEn` / `MEt`).
 */
import { join } from 'path'
import { getSubscriptionType } from '../../utils/auth.js'
import { leftoverFu } from '../../utils/plugins/functionHooksModules.js'
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
 * densable `iF()` / `aF()` — plugin IDs enabled (`=== true`) in `policySettings.enabledPlugins`.
 */
export function getManagedEnabledPluginIds(): Set<string> | null {
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
