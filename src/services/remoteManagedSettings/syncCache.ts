/**
 * Eligibility check for remote managed settings.
 *
 * The cache state itself lives in syncCacheState.ts (a leaf, no auth import).
 * This file keeps isRemoteManagedSettingsEligible — the one function that
 * needs auth.ts — plus resetSyncCache wrapped to clear the local eligibility
 * mirror alongside the leaf's state.
 */

import {
  getAnthropicApiKeyWithSource,
  getClaudeAIOAuthTokens,
} from '../../utils/auth.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../../utils/model/providers.js'

import { isGatewayAuthPinned } from '../../utils/gatewayEnv.js'
import {
  recordEligibility,
  resetRemoteManagedSettingsLoadStatus,
} from './loadStatus.js'
import {
  resetSyncCache as resetLeafCache,
  setEligibility,
} from './syncCacheState.js'

let cached: boolean | undefined

export function resetSyncCache(): void {
  cached = undefined
  resetLeafCache()
  resetRemoteManagedSettingsLoadStatus()
}

function memoEligibility(
  eligible: boolean,
  reason?: Parameters<typeof recordEligibility>[1],
): boolean {
  recordEligibility(eligible, reason)
  return (cached = setEligibility(eligible))
}

/**
 * Check if the current user is eligible for remote managed settings
 *
 * Eligibility:
 * - Console users (API key): All eligible (must have actual key, not just apiKeyHelper)
 * - OAuth users with known subscriptionType: Only Enterprise/C4E and Team
 * - OAuth users with subscriptionType === null (externally-injected tokens via
 *   CLAUDE_CODE_OAUTH_TOKEN / FD, or keychain tokens missing metadata): Eligible —
 *   the API returns empty settings for ineligible orgs, so the cost of a false
 *   positive is one round-trip
 *
 * This is a pre-check to determine if we should query the API.
 * The API will return empty settings for users without managed settings.
 *
 * IMPORTANT: This function must NOT call getSettings() or any function that calls
 * getSettings() to avoid circular dependencies during settings loading.
 */
export function isRemoteManagedSettingsEligible(): boolean {
  if (cached !== undefined) return cached

  // Official CLAUDE_CODE_MOCK_REMOTE_SETTINGS densable — force-eligible for tests.
  try {
    const { isMockRemoteSettingsEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    if (isMockRemoteSettingsEnabled()) {
      return memoEligibility(true)
    }
  } catch {
    // densable optional
  }

  // _P: gateway pin before 3p. Unpinned → ineligible (r: unpinned_gateway).
  if (getAPIProvider() === 'gateway') {
    const pinned = isGatewayAuthPinned()
    return memoEligibility(pinned, pinned ? undefined : 'unpinned_gateway')
  }

  // 3p provider users should not hit the settings endpoint
  if (getAPIProvider() !== 'firstParty') {
    return memoEligibility(false, 'third_party_provider')
  }

  // Custom base URL users should not hit the settings endpoint
  if (!isFirstPartyAnthropicBaseUrl()) {
    return memoEligibility(false, 'custom_base_url')
  }

  // _P sandboxed_entrypoint: local-agent / remote_cowork / claude-coworker*
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  if (
    entrypoint === 'local-agent' ||
    entrypoint === 'remote_cowork' ||
    entrypoint?.startsWith('claude-coworker')
  ) {
    return memoEligibility(false, 'sandboxed_entrypoint')
  }

  // Check OAuth first: most Claude.ai users have no API key in the keychain.
  // The API key check spawns `security find-generic-password` (~20-50ms) which
  // returns null for OAuth-only users. Checking OAuth first short-circuits
  // that subprocess for the common case.
  const tokens = getClaudeAIOAuthTokens()

  // Externally-injected tokens (CCD via CLAUDE_CODE_OAUTH_TOKEN, CCR via
  // CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR, Agent SDK, CI) carry no
  // subscriptionType metadata — getClaudeAIOAuthTokens() constructs them with
  // subscriptionType: null. The token itself is valid; let the API decide.
  // fetchRemoteManagedSettings handles 204/404 gracefully (returns {}), and
  // settings.ts falls through to MDM/file when remote is empty, so ineligible
  // orgs pay one round-trip and nothing else changes.
  if (tokens?.accessToken && tokens.subscriptionType === null) {
    return memoEligibility(true)
  }

  // _P: enterprise/team oauth is eligible (scope check is ISe-only).
  if (
    tokens?.accessToken &&
    (tokens.subscriptionType === 'enterprise' ||
      tokens.subscriptionType === 'team')
  ) {
    return memoEligibility(true)
  }

  // Console users (API key) are eligible if we can get the actual key
  // Skip apiKeyHelper to avoid circular dependency with getSettings()
  // Wrap in try-catch because getAnthropicApiKeyWithSource throws in CI/test environments
  // when no API key is available
  try {
    const { key: apiKey } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    if (apiKey) {
      return memoEligibility(true)
    }
  } catch {
    // No API key available (e.g., CI/test environment)
  }

  return memoEligibility(
    false,
    tokens?.accessToken ? 'unsupported_subscription' : 'no_auth',
  )
}
