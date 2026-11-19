import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import {
  isEnterpriseSubscriber,
  isMaxSubscriber,
  isProSubscriber,
  isTeamSubscriber,
} from '../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { isModelAllowed } from '../utils/model/modelAllowlist.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../utils/model/providers.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

const FABLE51_ORG_WAIT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000 // 14 days (official Xp = 1209600000)
const FABLE51_MIGRATION_CUTOFF_MS = Date.UTC(2026, 11, 15) // official Jp = Date.UTC(2026, 11, 15)

function readSavedFable51Model():
  | 'claude-fable-5-1'
  | 'claude-fable-5-1[1m]'
  | null {
  const model = getSettingsForSource('userSettings')?.model
  if (model === 'claude-fable-5-1' || model === 'claude-fable-5-1[1m]') {
    return model
  }
  return null
}

/**
 * Official 2.1.321 (#1940): Migrate saved `claude-fable-5-1` / `claude-fable-5-1[1m]`
 * user settings picks to `fable` / `fable[1m]` (which now resolves to Fable 5.2):
 * - On Pro and Max plans: immediately on startup.
 * - On Team and Enterprise plans: once the organization allows `fable` (tracks
 *   `fable51OrgPickMoveDone` / `fable51OrgPickMoveWaitingSince` in global config).
 * - Users can switch back via `/model claude-fable-5-1`.
 *
 * Returns true if the setting was migrated.
 */
export function migrateFable51ToFable(nowMs: number = Date.now()): boolean {
  if (nowMs >= FABLE51_MIGRATION_CUTOFF_MS) {
    return false
  }
  if (getAPIProvider() !== 'firstParty' || !isFirstPartyAnthropicBaseUrl()) {
    return false
  }
  if (process.env.ANTHROPIC_DEFAULT_FABLE_MODEL !== undefined) {
    return false
  }
  if (getSettingsForSource('policySettings')?.model !== undefined) {
    return false
  }

  const saved = readSavedFable51Model()
  if (saved === null) {
    return false
  }

  const has1m = saved.endsWith('[1m]')
  const target = has1m ? 'fable[1m]' : 'fable'

  const isIndividualPlan = isProSubscriber() || isMaxSubscriber()
  const isOrgPlan = isTeamSubscriber() || isEnterpriseSubscriber()

  if (!isIndividualPlan && !isOrgPlan) {
    return false
  }

  if (isOrgPlan) {
    const config = getGlobalConfig()
    if (config.fable51OrgPickMoveDone === true) {
      return false
    }
    const waitingSince = config.fable51OrgPickMoveWaitingSince
    if (
      waitingSince !== undefined &&
      nowMs - waitingSince > FABLE51_ORG_WAIT_WINDOW_MS
    ) {
      saveGlobalConfig(current => ({
        ...current,
        fable51OrgPickMoveDone: true,
        fable51OrgPickMoveWaitingSince: undefined,
      }))
      return false
    }
    if (!isModelAllowed(target)) {
      if (waitingSince === undefined) {
        saveGlobalConfig(current => ({
          ...current,
          fable51OrgPickMoveWaitingSince: nowMs,
        }))
      }
      return false
    }
    updateSettingsForSource('userSettings', { model: target })
    saveGlobalConfig(current => ({
      ...current,
      fable51OrgPickMoveDone: true,
      fable51OrgPickMoveWaitingSince: undefined,
    }))
    logEvent('tengu_fable51_to_fable_alias_migration', {
      from_model:
        saved as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      has_1m: has1m,
      deferred: true,
    })
    return true
  }

  if (!isModelAllowed(target)) {
    return false
  }

  updateSettingsForSource('userSettings', { model: target })
  logEvent('tengu_fable51_to_fable_alias_migration', {
    from_model:
      saved as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    has_1m: has1m,
    deferred: false,
  })
  return true
}
