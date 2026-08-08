/**
 * densable 2.1.219 #16 — Remote Control "only via api.anthropic.com" reason
 * that names the specific provider env / ANTHROPIC_BASE_URL setting.
 *
 * densable symbols:
 * - `cbr` / `zlp` / `Klp` copy constants
 * - `x4_()` provider/base-url diagnostic
 * - `dWr()` / `A1e()` first-party base host check (RC ignores assume-first-party)
 * - `nY` provider display names / `lJt` provider env names
 * - `YBo` early-returns `x4_()` when `!L8e()` (not firstParty+api.anthropic.com)
 */

import { getGatewayAuth } from '../utils/gatewayEnv.js'
import { isMantleProviderEnabled } from '../utils/residualFinalEnvGates.js'
import {
  ASSUME_FIRST_PARTY_BASE_URL_ENV_KEY,
  getAPIProvider,
  type APIProvider,
} from '../utils/model/providers.js'
import { isEnvTruthy } from '../utils/envUtils.js'

/** densable `cbr`. */
export const RC_ONLY_API_ANTHROPIC_PREFIX =
  'Remote Control is only available when using Claude via api.anthropic.com.'

/** densable `zlp` — singular unset hint. */
export const RC_UNSET_IT_SUFFIX =
  'unset it (or run in a shell without it) to use Remote Control.'

/** densable `Klp` — plural unset hint. */
export const RC_UNSET_THEM_SUFFIX =
  'unset them (or run in a shell without them) to use Remote Control.'

/**
 * densable `nY` — human provider labels used in x4_ copy.
 * Local go-hare also has openai/gemini/grok; map those with env names below.
 */
export const RC_PROVIDER_DISPLAY_NAMES: Partial<Record<APIProvider, string>> = {
  bedrock: 'Amazon Bedrock',
  vertex: 'Google Vertex AI',
  foundry: 'Microsoft Foundry',
  anthropicAws: 'Claude Platform on AWS',
  mantle: 'Amazon Bedrock (Mantle)',
  gateway: 'Cloud gateway',
  openai: 'OpenAI-compatible API',
  gemini: 'Google Gemini',
  grok: 'xAI Grok',
}

/**
 * densable `lJt` — env var name that selected the provider.
 */
export const RC_PROVIDER_ENV_NAMES: Partial<Record<APIProvider, string>> = {
  bedrock: 'CLAUDE_CODE_USE_BEDROCK',
  foundry: 'CLAUDE_CODE_USE_FOUNDRY',
  anthropicAws: 'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  mantle: 'CLAUDE_CODE_USE_MANTLE',
  vertex: 'CLAUDE_CODE_USE_VERTEX',
  gateway: 'CLAUDE_CODE_USE_GATEWAY',
  openai: 'CLAUDE_CODE_USE_OPENAI',
  gemini: 'CLAUDE_CODE_USE_GEMINI',
  grok: 'CLAUDE_CODE_USE_GROK',
}

/**
 * densable `dWr` for RC eligibility — host must be api.anthropic.com.
 * Unlike `isFirstPartyAnthropicBaseUrl`, RC does NOT honor
 * `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL` (densable notes this in x4_).
 */
export function isRemoteControlFirstPartyBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const baseUrl = env.ANTHROPIC_BASE_URL
  if (!baseUrl) return true
  try {
    const host = new URL(baseUrl).host
    return host === 'api.anthropic.com'
  } catch {
    return false
  }
}

/**
 * densable `L8e` subset used by YBo first gate: firstParty provider +
 * (unix socket OR first-party base). Local self-hosted bridge bypasses this
 * path entirely in getBridgeDisabledReason.
 */
export function isRemoteControlApiEndpointOk(
  env: NodeJS.ProcessEnv = process.env,
  provider: APIProvider = getAPIProvider(),
): boolean {
  if (provider !== 'firstParty') return false
  if (isEnvTruthy(env.ANTHROPIC_UNIX_SOCKET)) return true
  return isRemoteControlFirstPartyBaseUrl(env)
}

function isEnterpriseGatewaySession(): boolean {
  try {
    const session = getGatewayAuth()
    // densable BGe(wy()): enterprise login session (not env-unpinned gateway).
    return Boolean(session && session.unpinned !== true)
  } catch {
    return false
  }
}

/**
 * densable `x4_` — actionable reason when Remote Control is blocked because
 * the session is not on api.anthropic.com first-party.
 */
export function getRemoteControlEndpointDisabledReason(
  env: NodeJS.ProcessEnv = process.env,
  provider: APIProvider = getAPIProvider(),
): string {
  const prefix = RC_ONLY_API_ANTHROPIC_PREFIX
  if (provider !== 'firstParty') {
    if (provider === 'gateway') {
      if (isEnterpriseGatewaySession()) {
        return `${prefix} This session is connected through an enterprise cloud gateway (set up via /login), which does not support Remote Control.`
      }
      return `${prefix} CLAUDE_CODE_USE_GATEWAY is set (the gateway on-ramp also requires ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN), so this session is routed through a cloud gateway — ${RC_UNSET_THEM_SUFFIX}`
    }
    // densable: kn()==="bedrock" && pHt()==="mantle" (USE_BEDROCK + USE_MANTLE)
    if (provider === 'bedrock' && isMantleProviderEnabled(env)) {
      return `${prefix} ${RC_PROVIDER_ENV_NAMES.bedrock} and ${RC_PROVIDER_ENV_NAMES.mantle} are set, so this session is using ${RC_PROVIDER_DISPLAY_NAMES.bedrock} + ${RC_PROVIDER_DISPLAY_NAMES.mantle} — ${RC_UNSET_THEM_SUFFIX}`
    }
    const envName = RC_PROVIDER_ENV_NAMES[provider]
    const display = RC_PROVIDER_DISPLAY_NAMES[provider] ?? provider
    if (envName) {
      return `${prefix} ${envName} is set, so this session is using ${display} — ${RC_UNSET_IT_SUFFIX}`
    }
    // settings.modelType openai/gemini/grok without USE_* env
    return `${prefix} This session is using ${display} — switch to Claude via api.anthropic.com to use Remote Control.`
  }
  if (!isRemoteControlFirstPartyBaseUrl(env)) {
    const assumeNote = env[ASSUME_FIRST_PARTY_BASE_URL_ENV_KEY]
      ? ` (${ASSUME_FIRST_PARTY_BASE_URL_ENV_KEY} does not apply to Remote Control.)`
      : ''
    return `${prefix} ANTHROPIC_BASE_URL is set and does not point at api.anthropic.com, so this session is using a custom endpoint — ${RC_UNSET_IT_SUFFIX}${assumeNote}`
  }
  // densable falls through to bare cbr (should be rare when L8e is false)
  return prefix
}

/**
 * True when endpoint gate alone blocks RC (before subscription/scope checks).
 */
export function isRemoteControlBlockedByEndpoint(
  env: NodeJS.ProcessEnv = process.env,
  provider: APIProvider = getAPIProvider(),
): boolean {
  return !isRemoteControlApiEndpointOk(env, provider)
}
