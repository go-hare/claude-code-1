/**
 * Official K1e /design-sync + design-login enable gate (portable).
 *
 *   !policy allow_design_sync → false
 *   nonessential traffic off → false
 *   firstParty provider → true
 *   else GB tengu_slate_quill (default false)
 *
 * Full /design-sync UI and OAuth remain denser.
 */

import { isEssentialTrafficOnly } from './privacyLevel.js'
import { getAPIProvider } from './model/providers.js'
import { isEnvTruthy } from './envUtils.js'

export function isDesignSyncPolicyAllowed(
  policyAllow?: boolean | null,
): boolean {
  // When policy not injected, treat as allowed (local/open builds).
  if (policyAllow === undefined || policyAllow === null) return true
  return policyAllow === true
}

/**
 * Official K1e densable core.
 */
export function isDesignSyncFeatureEnabled(input?: {
  env?: NodeJS.ProcessEnv
  policyAllow?: boolean | null
  /** Official Hu — firstParty only auto-enables without GB. */
  isFirstParty?: boolean
  /** Official ha — essential-traffic blocks. */
  essentialTrafficOnly?: boolean
  /** GB tengu_slate_quill. */
  slateQuill?: boolean
}): boolean {
  if (!isDesignSyncPolicyAllowed(input?.policyAllow)) return false
  const essential =
    input?.essentialTrafficOnly ?? isEssentialTrafficOnly()
  if (essential) return false
  // Env force-on densable (local residualFinal gate).
  const env = input?.env ?? process.env
  if (isEnvTruthy(env.CLAUDE_CODE_ENABLE_DESIGN_SYNC)) return true
  const firstParty =
    input?.isFirstParty ?? getAPIProvider() === 'firstParty'
  if (firstParty) return true
  return input?.slateQuill === true
}

/**
 * Official ibo — stricter gate requiring firstParty + GB omelette.
 * Used by denser Claude Design list tools.
 */
export function isDesignSyncListToolsEnabled(input?: {
  policyAllow?: boolean | null
  isFirstParty?: boolean
  essentialTrafficOnly?: boolean
  omeletteFouet?: boolean
}): boolean {
  if (!isDesignSyncPolicyAllowed(input?.policyAllow)) return false
  const essential =
    input?.essentialTrafficOnly ?? isEssentialTrafficOnly()
  if (essential) return false
  const firstParty =
    input?.isFirstParty ?? getAPIProvider() === 'firstParty'
  if (!firstParty) return false
  return input?.omeletteFouet === true
}
