import { getParentManagedSettings } from '../../bootstrap/state.js'
import { getRemoteManagedSettingsSyncFromCache } from '../../services/remoteManagedSettings/syncCacheState.js'
import { getOauthAccountInfo, getSubscriptionType } from '../auth.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { buildHostModelOverlay } from '../settings/hostModelOverlay.js'
import { getHkcuSettings, getMdmSettings } from '../settings/mdm/settings.js'
import { getSettingsOwner } from '../settings/settingsCache.js'
import {
  getAdminManagedPolicyLoadErrors,
  getPolicySettingsOrigin,
  getSettings_DEPRECATED,
  getSettingsForSource,
  loadManagedFileSettings,
} from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'
import { resolveCatalogFamilyModelString } from './catalogFamilyDefault.js'
import { getModelStrings } from './modelStrings.js'
import { getAPIProvider } from './providers.js'

/**
 * densable 2.1.251 #60 Xbt enterprise arms.
 * Max and team `default_claude_max_5x` stay in getDefaultMainLoopModelSetting.
 */
export type EnterpriseOpusDefaultInput = {
  subscriptionType: string | null
  /** densable pbr — seatTier only. Usage-based is enterprise_usage_based. */
  seatOrBilling: string | null
  catalogHasSonnet: boolean
  catalogHasOpus: boolean
  enforceAvailableModels: boolean
}

/**
 * True when this enterprise seat should take the opus default (bl / opus5).
 * Usage-based enterprise always does. Other enterprise does unless rw():
 * the catalog has sonnet, lacks opus, and available-models enforcement is off.
 */
export function enterpriseTierPrefersOpus5(
  input: EnterpriseOpusDefaultInput,
): boolean {
  if (input.subscriptionType !== 'enterprise') return false
  if (input.seatOrBilling === 'enterprise_usage_based') return true
  const sonnetOnlyUnenforced =
    input.catalogHasSonnet &&
    !input.catalogHasOpus &&
    input.enforceAvailableModels !== true
  return !sonnetOnlyUnenforced
}

/**
 * densable pbr — `Dn()?.seatTier ?? null`.
 */
export function enterpriseSeatTier(
  account:
    | {
        seatTier?: string | null
      }
    | null
    | undefined,
): string | null {
  return account?.seatTier ?? null
}

export type AvailableModelsEnforcementState =
  | { state: 'refused' }
  | { state: 'inactive'; cascadeTrusted: boolean }
  | {
      state: 'active'
      allowlist: string[]
      overridesMap: Record<string, string>
    }

const availableModelsWarnOnce = new Set<string>()

function warnOnceAvailableModels(message: string): void {
  if (availableModelsWarnOnce.has(message)) return
  availableModelsWarnOnce.add(message)
  logForDebugging(message, { level: 'warn' })
}

function policySourcesPresent(): boolean {
  try {
    const { getRemoteManagedSettingsSyncFromCache } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../services/remoteManagedSettings/syncCacheState.js') as typeof import('../../services/remoteManagedSettings/syncCacheState.js')
    const remote = getRemoteManagedSettingsSyncFromCache()
    if (remote && Object.keys(remote).length > 0) return true
  } catch {
    // keep machine-local sources
  }
  if (Object.keys(getMdmSettings().settings).length > 0) return true
  if (getMdmSettings().errors.length > 0) return true
  const file = loadManagedFileSettings()
  if (file.settings) return true
  if (file.errors.length > 0) return true
  if (Object.keys(getHkcuSettings().settings).length > 0) return true
  if (getHkcuSettings().errors.length > 0) return true
  return false
}

function policySourcesFullyLoaded(): boolean {
  if (getAdminManagedPolicyLoadErrors().length > 0) return false
  if (getHkcuSettings().errors.length > 0) return false
  return true
}

function isHostManagedProviderFlag(): boolean {
  let hostManaged = isEnvTruthy(
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST,
  )
  try {
    const { isProviderManagedByHostEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../residualFinalEnvGates.js') as typeof import('../residualFinalEnvGates.js')
    hostManaged = isProviderManagedByHostEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  return hostManaged
}

/**
 * densable admin tier `i` for the paired-overrides formula — first
 * policy source that carries settings (remote > MDM > file > HKCU).
 */
function firstAdminPolicyTierSettings(): SettingsJson | null {
  const remote = getRemoteManagedSettingsSyncFromCache()
  if (remote && Object.keys(remote).length > 0) {
    return remote as SettingsJson
  }
  const mdm = getMdmSettings().settings
  if (Object.keys(mdm).length > 0) return mdm
  const file = loadManagedFileSettings().settings
  if (file) return file
  const hkcu = getHkcuSettings().settings
  if (Object.keys(hkcu).length > 0) return hkcu
  return null
}

/**
 * densable pairedModelOverrides assignment on the main admin branch:
 * hostManaged && admin.availableModels !== undefined &&
 * admin.modelOverrides !== undefined &&
 * overlay?.availableModels === undefined
 *   ? admin.modelOverrides
 *   : undefined
 */
function computePairedPolicyModelOverrides():
  | Record<string, string>
  | undefined {
  if (!isHostManagedProviderFlag()) return undefined
  const admin = firstAdminPolicyTierSettings()
  if (
    admin?.availableModels === undefined ||
    admin.modelOverrides === undefined
  ) {
    return undefined
  }
  const rawParent = getParentManagedSettings()
  const parent =
    rawParent && typeof rawParent === 'object'
      ? (rawParent as SettingsJson)
      : null
  const overlay = buildHostModelOverlay(parent, true)
  if (overlay?.availableModels !== undefined) return undefined
  return admin.modelOverrides as Record<string, string>
}

/**
 * densable UJ — `return Tor(L())`.
 * Tor reads `store.policy.pairedModelOverrides`; if unset, loads
 * policySettings then re-reads. Local recomputes the gold assignment
 * formula when the cache slot is empty (settings finish does not yet
 * write the pair).
 */
export function UJ(): Record<string, string> | undefined {
  const owner = getSettingsOwner()
  const cached = owner.policy.pairedModelOverrides as
    | { value: Record<string, string> | undefined }
    | undefined
  if (cached !== undefined) return cached.value
  try {
    getSettingsForSource('policySettings')
  } catch {
    // densable Tor swallows nEt failure then re-reads
  }
  const afterLoad = owner.policy.pairedModelOverrides as
    | { value: Record<string, string> | undefined }
    | undefined
  if (afterLoad !== undefined) return afterLoad.value
  const value = computePairedPolicyModelOverrides()
  owner.policy.pairedModelOverrides = { value }
  return value
}

/**
 * densable wo — available-models enforcement state:
 * refused / inactive / active.
 */
export function getAvailableModelsEnforcementState(): AvailableModelsEnforcementState {
  try {
    const sourcesExist = policySourcesPresent()
    const policy = getSettingsForSource('policySettings')
    const warnFailed = (survivingHasPolicy: boolean): void => {
      if (!policy || !sourcesExist) return
      const message = survivingHasPolicy
        ? 'enforceAvailableModels: an admin policy source failed to load; enforcing the surviving admin tier (the failed source may carry a different policy — fix it to restore full coverage)'
        : 'enforceAvailableModels: an admin policy source failed to load and the surviving admin tier carries no model policy — model enforcement is OFF; the failed source may have carried it'
      warnOnceAvailableModels(message)
    }

    if (sourcesExist && !policySourcesFullyLoaded()) {
      warnOnceAvailableModels(
        'enforceAvailableModels: a policy source exists but failed to load; refusing cascade-trust mode (model enforcement from user/project settings is disabled until the policy source is fixed)',
      )
      return { state: 'refused' }
    }
    if (!policy) {
      return { state: 'inactive', cascadeTrusted: true }
    }

    const { availableModels, enforceAvailableModels, modelOverrides } = policy
    const origin = getPolicySettingsOrigin()
    if (
      !sourcesExist &&
      availableModels === undefined &&
      enforceAvailableModels === undefined &&
      modelOverrides === undefined &&
      (origin === 'hkcu' || origin === 'parent')
    ) {
      return { state: 'inactive', cascadeTrusted: true }
    }
    if (enforceAvailableModels && availableModels === undefined) {
      warnOnceAvailableModels(
        'enforceAvailableModels: the policy view sets the enforce flag but not availableModels; enforcement is disabled (the flag requires a policy-owned allowlist)',
      )
      warnFailed(false)
      return { state: 'inactive', cascadeTrusted: false }
    }
    if (
      enforceAvailableModels !== true ||
      availableModels === undefined ||
      availableModels.length === 0
    ) {
      warnFailed(false)
      return { state: 'inactive', cascadeTrusted: false }
    }
    warnFailed(true)
    return {
      state: 'active',
      allowlist: availableModels,
      // densable wo: d ?? UJ() ?? {}
      overridesMap: modelOverrides ?? UJ() ?? {},
    }
  } catch (error) {
    const message = `enforceAvailableModels: policy-tier settings read failed; refusing cascade-trust mode: ${error instanceof Error ? error.message : String(error)}`
    warnOnceAvailableModels(message)
    return { state: 'refused' }
  }
}

/**
 * densable rw — sonnet-only catalog and enforcement off
 * (`wo().state === "inactive"` and merged enforce flag is not true).
 */
export function isSonnetOnlyUnenforcedCatalog(): boolean {
  const settings = getSettings_DEPRECATED() || {}
  const enforcementOn =
    getAvailableModelsEnforcementState().state !== 'inactive' ||
    settings.enforceAvailableModels === true
  return (
    catalogHasFamily('sonnet') && !catalogHasFamily('opus') && !enforcementOn
  )
}

function catalogHasFamily(alias: 'opus' | 'sonnet'): boolean {
  return (
    resolveCatalogFamilyModelString(
      alias,
      getModelStrings(),
      getAPIProvider(),
    ) !== undefined
  )
}

/** Live Xbt enterprise arm. False for max, team, pro, and API users. */
export function isEnterpriseOpusDefault(): boolean {
  const settings = getSettings_DEPRECATED() || {}
  const enforcementOn =
    getAvailableModelsEnforcementState().state !== 'inactive' ||
    settings.enforceAvailableModels === true
  return enterpriseTierPrefersOpus5({
    subscriptionType: getSubscriptionType(),
    seatOrBilling: enterpriseSeatTier(getOauthAccountInfo()),
    catalogHasSonnet: catalogHasFamily('sonnet'),
    catalogHasOpus: catalogHasFamily('opus'),
    enforceAvailableModels: enforcementOn,
  })
}
