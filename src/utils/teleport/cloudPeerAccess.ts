/**
 * densable 2.1.248 Po() same-machine harbor kite + leftover R5v cloud walk.
 *
 * SEA Po @180993160:
 *   if CLAUDE_CODE_HARBOR_KITE !== undefined → Me(e)
 *   windows && !R("tengu_harbor_kite_win", !0) → false
 *   else R("tengu_harbor_kite", !0)
 *
 * R5v / hasCloudPeerAccess still layers firstParty + cloud GB leftover.
 * Do not fold Ye() / cloud hop into Po.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isRemotePolicyAllowed } from '../../services/policyLimits/index.js'
import { getOrganizationUUID } from '../../services/oauth/client.js'
import { getOauthAccountInfo, isClaudeAISubscriber } from '../auth.js'
import { isEnvTruthy } from '../envUtils.js'
import { getAPIProvider } from '../model/providers.js'
import { getPlatform } from '../platform.js'

/**
 * densable Po() — same-machine SendMessage/ListAgents gate.
 * GB default ON. Env defined (including explicit off) wins via Me/isEnvTruthy.
 */
export function isHarborKiteEnabled(): boolean {
  const e = process.env.CLAUDE_CODE_HARBOR_KITE
  if (e !== undefined) return isEnvTruthy(e)
  if (
    getPlatform() === 'windows' &&
    !getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite_win', true)
  ) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite', true)
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
  if (!isRemotePolicyAllowed('allow_remote_sessions')) return false
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
  if (!isRemotePolicyAllowed('allow_remote_sessions')) return false
  if (!isClaudeAISubscriber()) return false
  const org = await getOrganizationUUID()
  if (!org && !hasOrgUuidHint()) return false
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_HARBOR_KITE_CLOUD) ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite_cloud', false)
  )
}
