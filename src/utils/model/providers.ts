import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { getGatewayAuth } from '../gatewayEnv.js'
import {
  isAnthropicAwsProviderEnabled,
  isMantleProviderEnabled,
  isUseBedrockEnvEnabled,
  isUseFoundryEnvEnabled,
  isUseGeminiEnvEnabled,
  isUseGrokEnvEnabled,
  isUseOpenAIEnvEnabled,
  isUseVertexEnvEnabled,
} from '../residualFinalEnvGates.js'
import { getInitialSettings } from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'

export type APIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'anthropicAws'
  | 'mantle'
  | 'gateway'
  | 'openai'
  | 'gemini'
  | 'grok'

export function getAPIProvider(
  settings: Pick<SettingsJson, 'modelType'> = getInitialSettings(),
): APIProvider {
  const modelType = settings.modelType
  if (modelType === 'openai') return 'openai'
  if (modelType === 'gemini') return 'gemini'
  if (modelType === 'grok') return 'grok'

  // Official xn(): if (o_()) return "gateway" — pinned gatewayAuth session wins.
  if (getGatewayAuth()) return 'gateway'

  // Official xn() order: bedrock → foundry → anthropicAws → mantle → vertex → firstParty
  // Official USE_* densables for provider env selection.
  if (isUseBedrockEnvEnabled()) return 'bedrock'
  if (isUseFoundryEnvEnabled()) return 'foundry'
  if (isAnthropicAwsProviderEnabled()) {
    return 'anthropicAws'
  }
  if (isMantleProviderEnabled()) return 'mantle'
  if (isUseVertexEnvEnabled()) return 'vertex'

  if (isUseOpenAIEnvEnabled()) return 'openai'
  if (isUseGeminiEnvEnabled()) return 'gemini'
  if (isUseGrokEnvEnabled()) return 'grok'

  return 'firstParty'
}

/**
 * Official rm densable — firstParty / anthropicAws / gateway share Anthropic-style API.
 */
export function isAnthropicStyleApiProvider(
  provider: APIProvider = getAPIProvider(),
): boolean {
  return (
    provider === 'firstParty' ||
    provider === 'anthropicAws' ||
    provider === 'gateway'
  )
}

/**
 * Official Cxr densable — when bedrock is selected and USE_MANTLE is also
 * on, some model IDs route via mantle. Full model-map rematerialization denser.
 */
export function getBedrockMantleOverrideProvider(
  env: NodeJS.ProcessEnv = process.env,
): 'mantle' | null {
  if (!isUseBedrockEnvEnabled(env)) return null
  if (!isMantleProviderEnabled(env)) return null
  return 'mantle'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Official `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL` — force first-party base
 * semantics (Gd short-circuit) even when ANTHROPIC_BASE_URL is a custom host.
 */
export const ASSUME_FIRST_PARTY_BASE_URL_ENV_KEY =
  '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL'

/**
 * Official Gd assume branch: any non-empty env value forces true
 * (`if (be._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL) return true`).
 */
export function isAssumeFirstPartyBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[ASSUME_FIRST_PARTY_BASE_URL_ENV_KEY]
  return typeof raw === 'string' ? raw.length > 0 : Boolean(raw)
}

/**
 * Official Gd / hDn / _Ie — first-party Anthropic API base URL.
 * Returns true when:
 * - `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL` is set (any non-empty), or
 * - ANTHROPIC_BASE_URL is unset (default API), or
 * - host is api.anthropic.com (api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Official Gd()
  if (isAssumeFirstPartyBaseUrl(env)) {
    return true
  }
  const baseUrl = env.ANTHROPIC_BASE_URL
  // TODO: 这里会有问题, 只配置了 openai 协议的用户, 按理说会为 true 导致问题
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    // Local ant staging extension (official _Ie only allows api.anthropic.com)
    if (env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}

/**
 * Official Rpe densable — firstParty provider AND first-party base (Gd).
 * Used for model-id rewrites that only apply on real Anthropic first-party.
 */
export function isFirstPartyProviderWithFirstPartyBase(
  provider: APIProvider = getAPIProvider(),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return provider === 'firstParty' && isFirstPartyAnthropicBaseUrl(env)
}
