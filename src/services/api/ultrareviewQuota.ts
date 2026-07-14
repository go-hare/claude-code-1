import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import { isClaudeAISubscriber } from '../../utils/auth.js'
import { logForDebugging } from '../../utils/debug.js'
import { getOAuthHeaders, prepareApiRequest } from '../../utils/teleport/api.js'
import type { UltrareviewPreflightFixture } from '../../utils/residualFinalEnvGates.js'

export type UltrareviewQuotaResponse = {
  reviews_used: number
  reviews_limit: number
  reviews_remaining: number
  is_overage: boolean
}

/**
 * Peek the ultrareview quota for display and nudge decisions. Consume
 * happens server-side at session creation. Null when not a subscriber or
 * the endpoint errors.
 */
export async function fetchUltrareviewQuota(): Promise<UltrareviewQuotaResponse | null> {
  if (!isClaudeAISubscriber()) return null
  try {
    const { accessToken, orgUUID } = await prepareApiRequest()
    const response = await axios.get<UltrareviewQuotaResponse>(
      `${getOauthConfig().BASE_API_URL}/v1/ultrareview/quota`,
      {
        headers: {
          ...getOAuthHeaders(accessToken),
          'x-organization-uuid': orgUUID,
        },
        timeout: 5000,
      },
    )
    return response.data
  } catch (error) {
    logForDebugging(`fetchUltrareviewQuota failed: ${error}`)
    return null
  }
}

/**
 * Official zko densable — GET /v1/ultrareview/preflight.
 * Returns the server gate action (proceed / confirm / blocked) when the
 * endpoint is available; null when not a subscriber, fixture should be used,
 * or the request fails (callers fall through to quota/utilization).
 *
 * Injectable `get` for tests; production uses oauth-authenticated axios.
 */
export async function fetchUltrareviewPreflight(input?: {
  get?: (url: string, headers: Record<string, string>) => Promise<unknown>
  isSubscriber?: () => boolean
  prepare?: () => Promise<{ accessToken: string; orgUUID: string }>
  baseUrl?: string
}): Promise<UltrareviewPreflightFixture | null> {
  const isSubscriber = input?.isSubscriber ?? isClaudeAISubscriber
  if (!isSubscriber()) return null
  try {
    const prepare =
      input?.prepare ??
      (async () => {
        const { accessToken, orgUUID } = await prepareApiRequest()
        return { accessToken, orgUUID }
      })
    const { accessToken, orgUUID } = await prepare()
    const base = input?.baseUrl ?? getOauthConfig().BASE_API_URL
    const url = `${base}/v1/ultrareview/preflight`
    const headers = {
      ...getOAuthHeaders(accessToken),
      'x-organization-uuid': orgUUID,
    }
    let data: unknown
    if (input?.get) {
      data = await input.get(url, headers)
    } else {
      const response = await axios.get(url, {
        headers,
        timeout: 5000,
      })
      data = response.data
    }
    // Reuse typed fixture parse (same shape as CLAUDE_CODE_ULTRAREVIEW_PREFLIGHT_FIXTURE).
    const { parseUltrareviewPreflightFixtureTyped } = await import(
      '../../utils/residualFinalEnvGates.js'
    )
    return parseUltrareviewPreflightFixtureTyped({
      raw: JSON.stringify(data ?? null),
    })
  } catch (error) {
    logForDebugging(`fetchUltrareviewPreflight failed: ${error}`)
    return null
  }
}
