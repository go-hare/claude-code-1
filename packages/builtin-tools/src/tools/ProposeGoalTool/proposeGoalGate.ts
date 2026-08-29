/**
 * densable 2.1.239 ProposeGoal gates — b4i / Ktr / sna / okw / As.
 *
 * sna gold has an Xtr "absent" branch tip has no analog — skip. sna ≈ async Ktr.
 */

import {
  getIsNonInteractiveSession,
  getIsRemoteMode,
} from 'src/bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js'
import { getSecuritySensitiveSetting } from 'src/utils/settings/settings.js'
import { PROPOSE_GOAL_GB_FLAG } from './constants.js'

export type ModelProposedGoalsSetting = 'auto' | 'alwaysAsk' | 'disabled'

/** densable As — SESSION_KIND === "bg" only (KWe may return daemon*, As does not). */
export function isBgSessionKind(): boolean {
  return process.env.CLAUDE_CODE_SESSION_KIND === 'bg'
}

/** densable b4i — GB default false. Do not add to LOCAL_GATE_DEFAULTS. */
export function isProposeGoalGrowthBookEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(PROPOSE_GOAL_GB_FLAG, false)
}

/** densable Ktr = vCe(...)[0] ?? "auto" */
export function getModelProposedGoalsSetting(): ModelProposedGoalsSetting {
  return getSecuritySensitiveSetting('modelProposedGoals')[0] ?? 'auto'
}

/** densable sna — first-defined vCe; no Xtr walker. */
export async function getModelProposedGoalsSettingAsync(): Promise<ModelProposedGoalsSetting> {
  return getModelProposedGoalsSetting()
}

let loggedProposalAvailable = false

/** densable okw / vGs / SGs — once-per-session tengu_goal_proposal_available. */
export function logGoalProposalAvailableOnce(
  setting: ModelProposedGoalsSetting,
): void {
  if (loggedProposalAvailable) return
  loggedProposalAvailable = true
  logEvent('tengu_goal_proposal_available', {
    setting:
      setting as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/** Test-only: reset the once-log latch. */
export function resetGoalProposalAvailableLatchForTests(): void {
  loggedProposalAvailable = false
}

/**
 * densable isEnabled:
 * jn() || Jl() → false; As() → false; !b4i() → false; Ktr()==="disabled" → false;
 * else okw(e), true.
 */
export function isProposeGoalEnabled(): boolean {
  if (getIsNonInteractiveSession() || getIsRemoteMode()) return false
  if (isBgSessionKind()) return false
  if (!isProposeGoalGrowthBookEnabled()) return false
  const setting = getModelProposedGoalsSetting()
  if (setting === 'disabled') return false
  logGoalProposalAvailableOnce(setting)
  return true
}
