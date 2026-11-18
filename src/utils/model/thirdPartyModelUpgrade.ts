/**
 * Official 2.1.325 (#1370 & #1295): Bedrock / Vertex model upgrade detection,
 * managed-pinned model skip check (`H2n`), and 3P published catalog startup.
 */

import { logEvent } from '../../services/analytics/index.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import type { EditableSettingSource } from '../settings/constants.js'
import {
  ensurePublishedModelCatalogLoaded,
  getDensableModelCatalog,
  type DensableModelCatalog,
} from './modelCatalogCapabilities.js'
import { getAPIProvider } from './providers.js'

export type ThirdPartyModelTier = 'opus' | 'sonnet' | 'haiku'

export type ThirdPartyTierConfig = {
  tier: ThirdPartyModelTier
  envVarPriority: readonly string[]
  defaultKey: string
}

export type StalePinnedModelTier = {
  tier: ThirdPartyModelTier
  envVar: string
  pinnedKey: string
  defaultKey: string
}

export type ThirdPartyUpgradeCandidate = {
  tier: ThirdPartyModelTier
  envVar: string
  fromKey: string
  fromMarketingName: string
  toKey: string
  toMarketingName: string
  toModelId: string
}

export function formatUpgradeKey(candidate: {
  fromKey: string
  toKey: string
}): string {
  return `${candidate.fromKey}-to-${candidate.toKey}`
}

/**
 * Official `H2n` (#1370) — find tiers whose env var is pinned to an older
 * model than `defaultKey`, skipping any tier pinned in `policySettings.env`
 * (managed settings) or excluded by `excludeValue`.
 */
export function findStalePinnedModelTiers(
  tierConfigs: Readonly<Record<string, ThirdPartyTierConfig>>,
  opts?: {
    policySettingsEnv?: Record<string, string | undefined>
    env?: NodeJS.ProcessEnv
    orderedModelKeys?: readonly string[]
    resolveModelKey?: (modelId: string) => string | undefined
    resolveTierForKey?: (modelKey: string) => ThirdPartyModelTier | undefined
    isTierManagedPinned?: (envVar: string) => boolean
    excludeValue?: (value: string) => boolean
  },
): StalePinnedModelTier[] {
  const env = opts?.env ?? process.env
  const policyEnv =
    opts?.policySettingsEnv ?? getSettingsForSource('policySettings')?.env ?? {}
  const resolveKey =
    opts?.resolveModelKey ??
    ((val: string) => {
      const catalog = getDensableModelCatalog()
      const lower = val.toLowerCase()
      for (const m of catalog.models) {
        if (m.id.toLowerCase() === lower) return m.id
        for (const pid of Object.values(m.provider_ids)) {
          if (typeof pid === 'string' && pid.toLowerCase() === lower) {
            return m.id
          }
        }
      }
      return undefined
    })
  const resolveTier =
    opts?.resolveTierForKey ??
    ((key: string): ThirdPartyModelTier | undefined => {
      const lower = key.toLowerCase()
      if (lower.includes('opus')) return 'opus'
      if (lower.includes('sonnet')) return 'sonnet'
      if (lower.includes('haiku')) return 'haiku'
      return undefined
    })
  const orderedKeys =
    opts?.orderedModelKeys ?? getDensableModelCatalog().models.map(m => m.id)

  const results: StalePinnedModelTier[] = []
  for (const tierName of Object.keys(tierConfigs)) {
    const config = tierConfigs[tierName]
    if (!config) continue
    let foundEnvVar: string | undefined
    let foundKey: string | undefined
    for (const envVar of config.envVarPriority) {
      const raw = env[envVar]?.trim()
      if (!raw) continue
      // Skip tiers pinned by managed policySettings.env (#1370)
      if (Object.hasOwn(policyEnv, envVar)) break
      if (opts?.isTierManagedPinned?.(envVar)) continue
      if (opts?.excludeValue?.(raw)) continue
      const key = resolveKey(raw)
      if (
        !key ||
        resolveTier(key) !== config.tier ||
        key === config.defaultKey
      ) {
        continue
      }
      foundEnvVar = envVar
      foundKey = key
      break
    }
    if (!foundEnvVar || !foundKey) continue
    const pinnedIdx = orderedKeys.indexOf(foundKey)
    const defaultIdx = orderedKeys.indexOf(config.defaultKey)
    if (pinnedIdx === -1 || defaultIdx === -1 || pinnedIdx >= defaultIdx) {
      continue
    }
    results.push({
      tier: config.tier,
      envVar: foundEnvVar,
      pinnedKey: foundKey,
      defaultKey: config.defaultKey,
    })
  }
  return results
}

function defaultTierConfigsForProvider(
  provider: 'bedrock' | 'vertex',
): Record<ThirdPartyModelTier, ThirdPartyTierConfig> {
  const catalog = getDensableModelCatalog()
  const findDefault = (family: ThirdPartyModelTier, fallback: string) =>
    catalog.latest_per_family?.[family] ??
    catalog.defaults?.[family] ??
    fallback
  return {
    opus: {
      tier: 'opus',
      envVarPriority: ['ANTHROPIC_DEFAULT_OPUS_MODEL'],
      defaultKey: findDefault('opus', 'claude-opus-4-6'),
    },
    sonnet: {
      tier: 'sonnet',
      envVarPriority: ['ANTHROPIC_DEFAULT_SONNET_MODEL'],
      defaultKey: findDefault('sonnet', 'claude-sonnet-4-6'),
    },
    haiku: {
      tier: 'haiku',
      envVarPriority: [
        'ANTHROPIC_DEFAULT_HAIKU_MODEL',
        'ANTHROPIC_SMALL_FAST_MODEL',
      ],
      defaultKey: findDefault('haiku', 'claude-haiku-4-5'),
    },
  }
}

async function findProviderUpgradeCandidates(
  provider: 'bedrock' | 'vertex',
  opts?: {
    env?: NodeJS.ProcessEnv
    policySettingsEnv?: Record<string, string | undefined>
    probeModel?: (
      modelId: string,
      tier: ThirdPartyModelTier,
    ) => Promise<boolean>
    isModelDenied?: (modelId: string) => boolean
    resolveProviderModelId?: (catalogKey: string) => string | undefined
  },
): Promise<ThirdPartyUpgradeCandidate[]> {
  const env = opts?.env ?? process.env
  if (getAPIProvider() !== provider) return []
  if (isEnvTruthy(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)) return []

  const staleTiers = findStalePinnedModelTiers(
    defaultTierConfigsForProvider(provider),
    {
      env,
      policySettingsEnv: opts?.policySettingsEnv,
      excludeValue:
        provider === 'bedrock'
          ? v => v.includes('application-inference-profile')
          : undefined,
    },
  )
  if (staleTiers.length === 0) return []

  logEvent(
    provider === 'bedrock'
      ? 'tengu_bedrock_upgrade_check'
      : 'tengu_vertex_upgrade_check',
    { stale_tiers: staleTiers.length },
  )

  const catalog = getDensableModelCatalog()
  const resolveModelId =
    opts?.resolveProviderModelId ??
    ((key: string) => {
      const entry = catalog.models.find(m => m.id === key)
      return entry?.provider_ids[provider] ?? undefined
    })

  const candidates: ThirdPartyUpgradeCandidate[] = []
  for (const stale of staleTiers) {
    const toModelId = resolveModelId(stale.defaultKey)
    if (!toModelId) continue
    if (opts?.isModelDenied?.(toModelId)) {
      logForDebugging(
        `[${provider}-upgrade] ${stale.tier}: not offering an upgrade to ${toModelId} because managed settings do not allow this id`,
      )
      continue
    }
    const fromEntry = catalog.models.find(m => m.id === stale.pinnedKey)
    const toEntry = catalog.models.find(m => m.id === stale.defaultKey)
    candidates.push({
      tier: stale.tier,
      envVar: stale.envVar,
      fromKey: stale.pinnedKey,
      fromMarketingName: fromEntry?.display_name ?? stale.pinnedKey,
      toKey: stale.defaultKey,
      toMarketingName: toEntry?.display_name ?? stale.defaultKey,
      toModelId,
    })
  }

  if (!opts?.probeModel) {
    return candidates
  }

  const probed = await Promise.all(
    candidates.map(async c => {
      const accessible = await opts.probeModel!(c.toModelId, c.tier)
      logEvent(
        provider === 'bedrock'
          ? 'tengu_bedrock_probe_result'
          : 'tengu_vertex_probe_result',
        { tier: c.tier, accessible },
      )
      return accessible ? c : null
    }),
  )
  return probed.filter((c): c is ThirdPartyUpgradeCandidate => c !== null)
}

export async function findBedrockUpgradeCandidates(opts?: {
  env?: NodeJS.ProcessEnv
  policySettingsEnv?: Record<string, string | undefined>
  probeModel?: (modelId: string, tier: ThirdPartyModelTier) => Promise<boolean>
  isModelDenied?: (modelId: string) => boolean
  resolveProviderModelId?: (catalogKey: string) => string | undefined
}): Promise<ThirdPartyUpgradeCandidate[]> {
  return findProviderUpgradeCandidates('bedrock', opts)
}

export async function findVertexUpgradeCandidates(opts?: {
  env?: NodeJS.ProcessEnv
  policySettingsEnv?: Record<string, string | undefined>
  probeModel?: (modelId: string, tier: ThirdPartyModelTier) => Promise<boolean>
  isModelDenied?: (modelId: string) => boolean
  resolveProviderModelId?: (catalogKey: string) => string | undefined
}): Promise<ThirdPartyUpgradeCandidate[]> {
  return findProviderUpgradeCandidates('vertex', opts)
}

/**
 * Filter upgrade candidates against previously declined upgrades in userSettings
 * and return actions to accept (update settings + process.env) or decline.
 */
export function filterUndecidedUpgradeCandidates(
  provider: 'bedrock' | 'vertex',
  candidates: readonly ThirdPartyUpgradeCandidate[],
  userSettings: {
    bedrockDeclinedUpgrades?: Record<string, string>
    vertexDeclinedUpgrades?: Record<string, string>
  } = getSettingsForSource('userSettings') ?? {},
): ThirdPartyUpgradeCandidate[] {
  const declined =
    (provider === 'bedrock'
      ? userSettings.bedrockDeclinedUpgrades
      : userSettings.vertexDeclinedUpgrades) ?? {}
  return candidates.filter(c => declined[c.tier] !== formatUpgradeKey(c))
}

export function applyThirdPartyUpgradeChoice(
  provider: 'bedrock' | 'vertex',
  candidate: ThirdPartyUpgradeCandidate,
  accepted: boolean,
  source: EditableSettingSource = 'userSettings',
): void {
  if (!accepted) {
    const field =
      provider === 'bedrock'
        ? 'bedrockDeclinedUpgrades'
        : 'vertexDeclinedUpgrades'
    const current = getSettingsForSource(source) ?? {}
    updateSettingsForSource(source, {
      [field]: {
        ...(current[field] ?? {}),
        [candidate.tier]: formatUpgradeKey(candidate),
      },
    })
    return
  }
  const envPatch: Record<string, string> =
    candidate.tier === 'haiku'
      ? {
          ANTHROPIC_DEFAULT_HAIKU_MODEL: candidate.toModelId,
          ...(candidate.envVar === 'ANTHROPIC_SMALL_FAST_MODEL' && {
            ANTHROPIC_SMALL_FAST_MODEL: candidate.toModelId,
          }),
        }
      : { [candidate.envVar]: candidate.toModelId }
  for (const [k, v] of Object.entries(envPatch)) {
    process.env[k] = v
  }
  const current = getSettingsForSource(source) ?? {}
  updateSettingsForSource(source, {
    env: {
      ...(current.env ?? {}),
      ...envPatch,
    },
  })
}

/**
 * Official 2.1.325 (#1295): load & verify published model catalog during
 * Bedrock / Mantle / Vertex / Foundry startup before resolving 3P defaults.
 */
export async function initThirdPartyModelCatalogStartup(opts?: {
  headless?: boolean
  env?: NodeJS.ProcessEnv
  managedUrl?: string
  managedPublicKeyPem?: string
}): Promise<DensableModelCatalog> {
  return ensurePublishedModelCatalogLoaded(opts)
}
