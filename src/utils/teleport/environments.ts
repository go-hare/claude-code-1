import axios from 'axios'
import { z } from 'zod'
import { getOauthConfig } from 'src/constants/oauth.js'
import { getOrganizationUUID } from 'src/services/oauth/client.js'
import { getClaudeAIOAuthTokens } from '../auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { toError } from '../errors.js'
import { logError } from '../log.js'
import { getOAuthHeaders } from './api.js'

export type EnvironmentKind = 'anthropic_cloud' | 'byoc' | 'bridge'
export type EnvironmentState = 'active'

export type EnvironmentResource = {
  kind: EnvironmentKind
  environment_id: string
  name: string
  created_at: string
  state: EnvironmentState
}

export type EnvironmentListResponse = {
  environments: EnvironmentResource[]
  has_more: boolean
  first_id: string | null
  last_id: string | null
}

/**
 * densable DIS — loose list envelope only:
 * `{ environments: array of non-null plain objects }`.
 * Do not invent a full EnvironmentResource schema here.
 */
const environmentsListSchema = z.object({
  environments: z.array(z.object({}).passthrough()),
})

const MALFORMED_DETAIL_PREFIX = 'fetchEnvironments:'

/**
 * densable MIS — map empty / non-JSON / unusable HTTP 200 bodies to clear errors.
 * User-facing message is Error.message; detail is attached for diagnostics.
 */
export function mapMalformedEnvironmentsResponse(data: unknown): Error {
  let message: string
  let detail: string
  if (typeof data === 'string' && data.trim().length === 0) {
    message =
      'The cloud environments service returned an empty response (HTTP 200 with no body). This is usually temporary — try again in a moment.'
    detail = 'fetchEnvironments: HTTP 200 with an empty body'
  } else if (typeof data === 'string') {
    message =
      'The cloud environments service returned a response in an unexpected format (HTTP 200 with a non-JSON body). This is usually temporary — try again in a moment.'
    detail = 'fetchEnvironments: HTTP 200 with a non-JSON body'
  } else {
    message =
      'The cloud environments service returned a response in an unexpected format (HTTP 200 without a usable environments list). This is usually temporary — try again in a moment.'
    detail =
      'fetchEnvironments: HTTP 200 JSON body without a valid environments array'
  }
  const err = new Error(message) as Error & { detail: string }
  err.detail = detail
  return err
}

function isMalformedEnvironmentsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'detail' in error &&
    typeof (error as { detail: unknown }).detail === 'string' &&
    (error as { detail: string }).detail.startsWith(MALFORMED_DETAIL_PREFIX)
  )
}

/**
 * Fetches the list of available environments from the Environment API
 * @returns Promise<EnvironmentResource[]> Array of available environments
 * @throws Error if the API request fails or no access token is available
 */
export async function fetchEnvironments(): Promise<EnvironmentResource[]> {
  const accessToken = getClaudeAIOAuthTokens()?.accessToken
  if (!accessToken) {
    throw new Error(
      'Claude Code web sessions require authentication with a Claude.ai account. API key authentication is not sufficient. Please run /login to authenticate, or check your authentication status with /status.',
    )
  }

  const orgUUID = await getOrganizationUUID()
  if (!orgUUID) {
    throw new Error('Unable to get organization UUID')
  }

  const url = `${getOauthConfig().BASE_API_URL}/v1/environment_providers`

  try {
    const headers = {
      ...getOAuthHeaders(accessToken),
      'x-organization-uuid': orgUUID,
    }

    const response = await axios.get(url, {
      headers,
      timeout: 15000,
    })

    if (response.status !== 200) {
      throw new Error(
        `Failed to fetch environments: ${response.status} ${response.statusText}`,
      )
    }

    const parsed = environmentsListSchema.safeParse(response.data)
    if (!parsed.success) {
      throw mapMalformedEnvironmentsResponse(response.data)
    }

    // densable Nye: sync hasRemoteEnvironment = environments.length > 0
    const environments = parsed.data.environments as EnvironmentResource[]
    const hasAny = environments.length > 0
    if (getGlobalConfig().hasRemoteEnvironment !== hasAny) {
      saveGlobalConfig(s =>
        s.hasRemoteEnvironment === hasAny
          ? s
          : { ...s, hasRemoteEnvironment: hasAny },
      )
    }

    return environments
  } catch (error) {
    const err = toError(error)
    logError(err)
    // densable MIS: preserve clear malformed messages (do not wrap)
    if (isMalformedEnvironmentsError(error)) {
      throw err
    }
    throw new Error(`Failed to fetch environments: ${err.message}`)
  }
}

/**
 * Creates a default anthropic_cloud environment for users who have none.
 * Uses the public environment_providers route (same auth as fetchEnvironments).
 */
export async function createDefaultCloudEnvironment(
  name: string,
): Promise<EnvironmentResource> {
  const accessToken = getClaudeAIOAuthTokens()?.accessToken
  if (!accessToken) {
    throw new Error('No access token available')
  }
  const orgUUID = await getOrganizationUUID()
  if (!orgUUID) {
    throw new Error('Unable to get organization UUID')
  }

  const url = `${getOauthConfig().BASE_API_URL}/v1/environment_providers/cloud/create`
  const response = await axios.post<EnvironmentResource>(
    url,
    {
      name,
      kind: 'anthropic_cloud',
      // densable Qht (#13): SEA uses trusted-network copy (tip previously '')
      description: 'Default - trusted network access',
      config: {
        environment_type: 'anthropic',
        cwd: '/home/user',
        init_script: null,
        environment: {},
        languages: [
          { name: 'python', version: '3.11' },
          { name: 'node', version: '20' },
        ],
        network_config: {
          allowed_hosts: [],
          allow_default_hosts: true,
        },
      },
    },
    {
      headers: {
        ...getOAuthHeaders(accessToken),
        'anthropic-beta': 'ccr-byoc-2025-07-29',
        'x-organization-uuid': orgUUID,
      },
      timeout: 15000,
    },
  )
  return response.data
}
