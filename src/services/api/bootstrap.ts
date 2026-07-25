import axios from 'axios'
import isEqual from 'lodash-es/isEqual.js'
import {
  getAnthropicApiKey,
  getClaudeAIOAuthTokens,
  hasProfileScope,
} from 'src/utils/auth.js'
import { z } from 'zod'
import { getOauthConfig, OAUTH_BETA_HEADER } from '../../constants/oauth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { withOAuth401Retry } from '../../utils/http.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'

const bootstrapResponseSchema = lazySchema(() =>
  z.object({
    client_data: z.record(z.string(), z.unknown()).nullish(),
    additional_model_options: z
      .array(
        z
          .object({
            model: z.string(),
            name: z.string(),
            description: z.string(),
          })
          .transform(({ model, name, description }) => ({
            value: model,
            label: name,
            description,
          })),
      )
      .nullish(),
    // Official 2.1.196 org default model (org console).
    org_model_default: z
      .object({
        name: z.string(),
        updated_at: z.string(),
        data_source: z.string(),
        override_user_selection: z.boolean(),
      })
      .nullish(),
    // densable model_access → modelAccessCache (S8t maxEffortLevel).
    model_access: z
      .array(
        z
          .object({
            api_name: z.string(),
            entitled: z.boolean(),
            max_effort_level: z.string().nullish(),
          })
          .transform(({ api_name, entitled, max_effort_level }) => ({
            apiName: api_name,
            entitled,
            ...(max_effort_level != null
              ? { maxEffortLevel: max_effort_level }
              : {}),
          })),
      )
      .nullish(),
    oauth_account: z
      .object({
        account_uuid: z.string().nullish(),
        organization_uuid: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
  }),
)

type BootstrapResponse = z.infer<ReturnType<typeof bootstrapResponseSchema>>

async function fetchBootstrapAPI(): Promise<BootstrapResponse | null> {
  if (isEssentialTrafficOnly()) {
    logForDebugging('[Bootstrap] Skipped: Nonessential traffic disabled')
    return null
  }

  if (getAPIProvider() !== 'firstParty') {
    logForDebugging('[Bootstrap] Skipped: 3P provider')
    return null
  }

  // OAuth preferred (requires user:profile scope — service-key OAuth tokens
  // lack it and would 403). Fall back to API key auth for console users.
  const apiKey = getAnthropicApiKey()
  const hasUsableOAuth =
    getClaudeAIOAuthTokens()?.accessToken && hasProfileScope()
  if (!hasUsableOAuth && !apiKey) {
    logForDebugging('[Bootstrap] Skipped: no usable OAuth or API key')
    return null
  }

  const endpoint = `${getOauthConfig().BASE_API_URL}/api/claude_cli/bootstrap`

  // withOAuth401Retry handles the refresh-and-retry. API key users fail
  // through on 401 (no refresh mechanism — no OAuth token to pass).
  try {
    return await withOAuth401Retry(async () => {
      // Re-read OAuth each call so the retry picks up the refreshed token.
      const token = getClaudeAIOAuthTokens()?.accessToken
      let authHeaders: Record<string, string>
      if (token && hasProfileScope()) {
        authHeaders = {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': OAUTH_BETA_HEADER,
        }
      } else if (apiKey) {
        authHeaders = { 'x-api-key': apiKey }
      } else {
        logForDebugging('[Bootstrap] No auth available on retry, aborting')
        return null
      }

      logForDebugging('[Bootstrap] Fetching')
      const response = await axios.get<unknown>(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': getClaudeCodeUserAgent(),
          ...authHeaders,
        },
        timeout: 5000,
      })
      const parsed = bootstrapResponseSchema().safeParse(response.data)
      if (!parsed.success) {
        logForDebugging(
          `[Bootstrap] Response failed validation: ${parsed.error.message}`,
        )
        return null
      }
      logForDebugging('[Bootstrap] Fetch ok')
      return parsed.data
    })
  } catch (error) {
    logForDebugging(
      `[Bootstrap] Fetch failed: ${axios.isAxiosError(error) ? (error.response?.status ?? error.code) : 'unknown'}`,
    )
    throw error
  }
}

/**
 * Fetch bootstrap data from the API and persist to disk cache.
 */
export async function fetchBootstrapData(): Promise<void> {
  try {
    const response = await fetchBootstrapAPI()
    if (!response) return

    const clientData = response.client_data ?? null
    const additionalModelOptions = response.additional_model_options ?? []
    // densable model_access → modelAccessCache (S8t). Absent field leaves
    // prior cache; null/[] clears. Validate maxEffortLevel against EffortLevel.
    type EffortLevelStr = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    const asEffortLevel = (
      level: string | undefined,
    ): EffortLevelStr | undefined =>
      level === 'low' ||
      level === 'medium' ||
      level === 'high' ||
      level === 'xhigh' ||
      level === 'max'
        ? level
        : undefined
    const modelAccessUpdate:
      | Array<{
          apiName: string
          entitled: boolean
          maxEffortLevel?: EffortLevelStr
        }>
      | undefined =
      response.model_access === undefined
        ? undefined
        : (response.model_access ?? []).map(row => {
            const maxEffortLevel = asEffortLevel(row.maxEffortLevel)
            return {
              apiName: row.apiName,
              entitled: row.entitled,
              ...(maxEffortLevel !== undefined ? { maxEffortLevel } : {}),
            }
          })
    const orgUuid =
      response.oauth_account?.organization_uuid ??
      getGlobalConfig().oauthAccount?.organizationUuid
    // Only update org default when the field is present. Omitting it on a
    // partial bootstrap response must not wipe a previously good disk cache.
    const orgModelDefaultUpdate =
      response.org_model_default != null
        ? {
            ...response.org_model_default,
            ...(orgUuid ? { orgUuid } : {}),
          }
        : response.org_model_default === null
          ? null
          : undefined

    // Only persist if data actually changed — avoids a config write on every startup.
    const config = getGlobalConfig()
    if (
      isEqual(config.clientDataCache, clientData) &&
      isEqual(config.additionalModelOptionsCache, additionalModelOptions) &&
      (modelAccessUpdate === undefined ||
        isEqual(config.modelAccessCache ?? [], modelAccessUpdate)) &&
      (orgModelDefaultUpdate === undefined ||
        isEqual(config.orgModelDefaultCache ?? null, orgModelDefaultUpdate))
    ) {
      logForDebugging('[Bootstrap] Cache unchanged, skipping write')
      return
    }

    logForDebugging('[Bootstrap] Cache updated, persisting to disk')
    saveGlobalConfig(current => ({
      ...current,
      clientDataCache: clientData,
      additionalModelOptionsCache: additionalModelOptions,
      ...(modelAccessUpdate !== undefined
        ? { modelAccessCache: modelAccessUpdate }
        : {}),
      ...(orgModelDefaultUpdate !== undefined
        ? { orgModelDefaultCache: orgModelDefaultUpdate }
        : {}),
    }))
    // Invalidate session-level org default so the next resolve re-reads cache.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { setResolvedOrgDefault } =
        require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
      setResolvedOrgDefault(undefined)
    } catch {
      // bootstrap isolation — optional
    }
  } catch (error) {
    logError(error)
  }

  // Official q5l densable — gateway /v1/models → gateway-models.json when $5l.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fetchAndCacheGatewayModels } =
      require('../../utils/residualMoreEnvGates.js') as typeof import('../../utils/residualMoreEnvGates.js')
    const result = await fetchAndCacheGatewayModels()
    if (result.ok) {
      logForDebugging(
        `[Bootstrap] Gateway models cached (${result.modelCount}) → ${result.path}`,
      )
    } else {
      logForDebugging(`[Bootstrap] Gateway models skip: ${result.reason}`)
    }
  } catch {
    // densable optional
  }
}
