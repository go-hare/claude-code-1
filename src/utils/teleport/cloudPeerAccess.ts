/**
 * densable 2.1.234 #34 — hasCloudPeerAccess (R5v) + harbor kite gate (yg).
 *
 * SEA:
 *   yg(): CLAUDE_CODE_HARBOR_KITE || (!windows||tengu_harbor_kite_win) && tengu_harbor_kite
 *   R5v(): yg() && firstParty && !ia() && allow_remote_sessions && Yi() && orgUUID
 *          && (CLAUDE_CODE_HARBOR_KITE_CLOUD || tengu_harbor_kite_cloud)
 *
 * Local: ia() ≈ essential-traffic-only / privacy hard-off is not mirrored here;
 * keep peel gates that already exist in-repo.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isPolicyAllowed } from '../../services/policyLimits/index.js'
import { getOrganizationUUID } from '../../services/oauth/client.js'
import { getOauthAccountInfo, isClaudeAISubscriber } from '../auth.js'
import { isEnvTruthy } from '../envUtils.js'
import { getAPIProvider } from '../model/providers.js'
import { getPlatform } from '../platform.js'

/**
 * densable yg — cross-session / ListAgents remote peer surface gate.
 * Local ListAgents remains UDS_INBOX-gated at the tool; this gates cloud/CCR walks.
 */
export function isHarborKiteEnabled(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_HARBOR_KITE)) return true
  if (
    getPlatform() === 'windows' &&
    !getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite_win', false)
  ) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite', false)
}

function hasOrgUuidHint(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_ORGANIZATION_UUID)) return true
  if (getOauthAccountInfo()?.organizationUuid) return true
  return false
}

/**
 * densable R5v / hasCloudPeerAccess — may walk CCR /v1/code/sessions for peers.
 * Sync gate (org UUID hint); walker still calls prepareApiRequest for token.
 */
export function hasCloudPeerAccess(): boolean {
  if (!isHarborKiteEnabled()) return false
  if (getAPIProvider() !== 'firstParty') return false
  if (!isPolicyAllowed('allow_remote_sessions')) return false
  if (!isClaudeAISubscriber()) return false
  if (!hasOrgUuidHint()) return false
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_HARBOR_KITE_CLOUD) ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite_cloud', false)
  )
}

/** Async org check used by walkers that need a definitive org UUID. */
export async function hasCloudPeerAccessAsync(): Promise<boolean> {
  if (!isHarborKiteEnabled()) return false
  if (getAPIProvider() !== 'firstParty') return false
  if (!isPolicyAllowed('allow_remote_sessions')) return false
  if (!isClaudeAISubscriber()) return false
  const org = await getOrganizationUUID()
  if (!org && !hasOrgUuidHint()) return false
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_HARBOR_KITE_CLOUD) ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite_cloud', false)
  )
}
