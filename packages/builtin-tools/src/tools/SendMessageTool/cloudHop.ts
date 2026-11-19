import {
  getAnthropicApiKeyWithSource,
  getAuthTokenSource,
  getClaudeAIOAuthTokens,
  getConfiguredApiKeyHelper,
  isClaudeAISubscriber,
} from 'src/utils/auth.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { isEssentialTrafficOnly } from 'src/utils/privacyLevel.js'

/**
 * densable h0m — official copy for !g0m() on bridge / cloud-session send.
 */
export const CROSS_MACHINE_MESSAGING_UNAVAILABLE =
  'Cross-machine messaging is unavailable: it sends the message through Anthropic servers, which is not allowed on a third-party provider or with nonessential traffic disabled. Messages to sessions on this machine still work.'

/**
 * Official 2.1.326 #334 (`gxi` / `_xi`): refusal when sending to a session on
 * another machine while this session signs in with an API key, auth token,
 * profile, or workload identity beside a saved claude.ai login.
 */
export const CROSS_MACHINE_CREDENTIAL_ISOLATION_MESSAGE =
  'Cross-machine messaging would run on your saved claude.ai login, but this session signs in another way, such as an API key, a token, a profile, or workload identity. Refused; messages to sessions on this machine still work.'

export type CrossMachineCredentialCheckDeps = {
  hasSavedClaudeAiLogin?: () => boolean
  isUsingSavedClaudeAiLogin?: () => boolean
  env?: NodeJS.ProcessEnv
  hasApiKeyHelper?: () => boolean
  apiKeySource?: () => string
  authTokenSource?: () => string
}

/**
 * Official 2.1.326 #334: returns an error message when this session has a saved
 * claude.ai login on disk/keychain yet authenticates via an alternate
 * credential (API key, auth token, profile, workload identity, or helper), so
 * SendMessage does not silently hop across machines using the saved claude.ai
 * credentials. Returns `undefined` when sending is allowed.
 */
export function checkCrossMachineCredentialIsolation(
  deps: CrossMachineCredentialCheckDeps = {},
): string | undefined {
  const env = deps.env ?? process.env
  const hasSavedLogin =
    deps.hasSavedClaudeAiLogin?.() ??
    Boolean(getClaudeAIOAuthTokens()?.accessToken)
  if (!hasSavedLogin) {
    return undefined
  }

  const hasNonClaudeAiEnvAuth = Boolean(
    env.ANTHROPIC_API_KEY?.trim() ||
      env.ANTHROPIC_AUTH_TOKEN?.trim() ||
      env.CLAUDE_CODE_OAUTH_TOKEN?.trim() ||
      env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR?.trim() ||
      env.ANTHROPIC_PROFILE?.trim() ||
      env.ANTHROPIC_FEDERATION_RULE_ID?.trim(),
  )
  const hasApiKeyHelper =
    deps.hasApiKeyHelper?.() ?? Boolean(getConfiguredApiKeyHelper())
  const apiKeySrc =
    deps.apiKeySource?.() ?? getAnthropicApiKeyWithSource().source
  const authTokenSrc = deps.authTokenSource?.() ?? getAuthTokenSource().source
  const hasAlternateActiveAuth =
    hasNonClaudeAiEnvAuth ||
    hasApiKeyHelper ||
    apiKeySrc !== 'none' ||
    authTokenSrc !== 'none'

  const usingSavedLogin =
    deps.isUsingSavedClaudeAiLogin?.() ??
    (isClaudeAISubscriber() && !hasAlternateActiveAuth)

  if (!usingSavedLogin) {
    return CROSS_MACHINE_CREDENTIAL_ISOLATION_MESSAGE
  }
  return undefined
}

/**
 * densable g0m — `ao()==="firstParty"&&!fa()`.
 * Official uses this in SendMessage `call()` before posting a bridge hop
 * (explicit `bridge:` and resolved cloud/RC session). Do not invent a
 * separate cloud relay.
 */
export function isCrossMachineMessagingAvailable(): boolean {
  return getAPIProvider() === 'firstParty' && !isEssentialTrafficOnly()
}
