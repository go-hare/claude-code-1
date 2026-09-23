import { getOauthAccountInfo, getSubscriptionType } from '../auth.js'
import { logForDebugging } from '../debug.js'
import { getHkcuSettings, getMdmSettings } from '../settings/mdm/settings.js'
import {
  getAdminManagedPolicyLoadErrors,
  getPolicySettingsOrigin,
  getSettings_DEPRECATED,
  getSettingsForSource,
  loadManagedFileSettings,
} from '../settings/settings.js'
import { resolveCatalogFamilyModelString } from './catalogFamilyDefault.js'
import { getModelStrings } from './modelStrings.js'
import { getAPIProvider } from './providers.js'

/**
 * densable 2.1.251 #60 Xbt enterprise arms.
 * Max and team `default_claude_max_5x` stay in getDefaultMainLoopModelSetting.
 */
export type EnterpriseOpusDefaultInput = {
  subscriptionType: string | null
  /**
   * seatTier when set, otherwise billingType.
   * Usage-based enterprise is the string enterprise_usage_based.
   */
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

/**
 * densable RYe reads pbr() (seatTier). When seatTier is unset, billingType
 * carries the same enterprise_usage_based token.
 */
export function enterpriseSeatOrBillingValue(
  account:
    | {
        seatTier?: string | null
        billingType?: unknown
      }
    | null
    | undefined,
): string | null {
  if (!account) return null
  const seat = enterpriseSeatTier(account)
  if (seat !== null && seat.length > 0) {
    return seat
  }
  if (
    typeof account.billingType === 'string' &&
    account.billingType.length > 0
  ) {
    return account.billingType
  }
  return null
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
      overridesMap: modelOverrides ?? {},
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
    seatOrBilling: enterpriseSeatOrBillingValue(getOauthAccountInfo()),
    catalogHasSonnet: catalogHasFamily('sonnet'),
    catalogHasOpus: catalogHasFamily('opus'),
    enforceAvailableModels: enforcementOn,
  })
}
