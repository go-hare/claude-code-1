import axios from 'axios'
import chalk from 'chalk'
import { exec } from 'child_process'
import { execa } from 'execa'
import { mkdir, readdir, rm, stat, unlink } from 'fs/promises'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { CLAUDE_AI_PROFILE_SCOPE, getOauthConfig } from 'src/constants/oauth.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getModelStrings } from 'src/utils/model/modelStrings.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import {
  descriptorAnnouncementConsumed,
  getIsNonInteractiveSession,
  getOauthScopesFromFd,
  isOauthTokenFromBgSnapshot,
  preferThirdPartyAuthentication,
  setGatewayTokenFromDescriptor,
  setOauthScopesFromFd,
  setOauthTokenFromBgSnapshot,
  setOauthTokenFromFd,
} from '../bootstrap/state.js'
import {
  getMockSubscriptionType,
  shouldUseMockSubscription,
} from '../services/mockRateLimits.js'
import {
  isOAuthTokenExpired,
  refreshOAuthToken,
  shouldUseClaudeAIAuth,
} from '../services/oauth/client.js'
import { getOauthProfileFromOauthToken } from '../services/oauth/getOauthProfile.js'
import type { OAuthTokens, SubscriptionType } from '../services/oauth/types.js'
import {
  getApiKeyFromFileDescriptor,
  getOAuthTokenFromFileDescriptor,
  readGatewayTokenFromDescriptor,
  readOAuthTokenFromFileDescriptor,
} from './authFileDescriptor.js'
import { getFsImplementation } from './fsOperations.js'
import {
  evaluateRemoteAuthFailExit,
  resolveApiKeyHelperTtlMs,
  resolveOauth401WaitMsOrDefault,
  waitForRotatedOauthToken,
} from './residualMsEnvGates.js'
import { getSdkOauthTokenRefreshCallback } from './sdkOauthTokenRefresh.js'
import {
  getOAuthRefreshAccountOnHoldUrl,
  isOAuthRefreshAccountOnHoldError,
  isOAuthRefreshDeadInvalidGrant,
  isOAuthRefreshTokenDead,
  isOAuthRefreshTokenKnownDead,
  isOAuthRefreshTokenOnHold,
  isStoredOAuthRefreshTokenCleared,
  markDeadOAuthRefreshToken,
  OAuthRefreshLockTimeoutError,
  rememberOAuthAccountOnHold,
} from './accountOnHold.js'
import { getErrnoCode } from './errors.js'
import {
  maybeRemoveApiKeyFromMacOSKeychainThrows,
  normalizeApiKeyForConfig,
} from './authPortable.js'
import {
  type AwsResolvedCredentials,
  AWS_AUTH_REFRESH_COOLDOWN_MS,
  AWS_CHAIN_INVALIDATE_DEBOUNCE_MS,
  awsCredentialCacheTtlMs,
  checkStsCallerIdentity,
  clearAwsIniCache,
  hostManagedAwsProviderChain,
  hostManagedAwsSdkCredentials,
  hostManagedNoCredsError,
  isHostManagedProviderAuth,
  parseAwsCredentialExport,
  resolveWithStallGuard,
} from './aws.js'
import { AwsAuthStatusManager } from './awsAuthStatusManager.js'
import {
  type DispatcherAccount,
  rateLimitTierFromTokenOrDispatcher,
  subscriptionFromTokenOrDispatcher,
} from './bgDispatcherAccount.js'
import {
  type AccountInfo,
  checkHasTrustDialogAccepted,
  getGlobalConfig,
  readGlobalConfigFromDisk,
  saveGlobalConfig,
} from './config.js'
import { logAntError, logForDebugging } from './debug.js'
import { isDisklessActive, logDisklessWriteSkipped } from './disklessGuards.js'
import {
  getClaudeConfigHomeDir,
  isBareMode,
  isEnvTruthy,
  isRunningOnHomespace,
} from './envUtils.js'
import { errorMessage } from './errors.js'
import { normalizeForceLoginOrgUuids } from './forceLoginOrg.js'
import { decodeJwtExpiry } from './jwtExpiry.js'
import { getCwd } from './cwd.js'
import { execSyncWithDefaults_DEPRECATED } from './execFileNoThrow.js'
import * as lockfile from './lockfile.js'
import { logError } from './log.js'
import { isSafeModeEnabled } from './safeMode.js'
import { createSignal } from './signal.js'
import { memoizeWithTTLAsync } from './memoize.js'
import { getSecureStorage } from './secureStorage/index.js'
import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'
import { isHoverRestOn } from './storageV5/hoverRestPin.js'
import {
  clearLegacyApiKeyPrefetch,
  getLegacyApiKeyPrefetchResult,
} from './secureStorage/keychainPrefetch.js'
import {
  clearKeychainCache,
  getMacOsKeychainStorageServiceName,
  getUsername,
} from './secureStorage/macOsKeychainHelpers.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
  getAdminManagedPolicyUnreadableError,
  formatPolicyUnreadableFailClose,
  rereadManagedSettingsIfNeeded,
} from './settings/settings.js'
import { sleep } from './sleep.js'
import { jsonParse } from './slowOperations.js'
import { Ip } from './toolSchemaCache.js'

/**
 * CCR and Claude Desktop spawn the CLI with OAuth and should never fall back
 * to the user's ~/.claude/settings.json API-key config (apiKeyHelper,
 * env.ANTHROPIC_API_KEY, env.ANTHROPIC_AUTH_TOKEN). Those settings exist for
 * the user's terminal CLI, not managed sessions. Without this guard, a user
 * who runs `claude` in their terminal with an API key sees every CCD session
 * also use that key — and fail if it's stale/wrong-org.
 */
function isManagedOAuthContext(): boolean {
  // Official REMOTE densable.
  let isRemote = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
  try {
    const { isRemoteEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    isRemote = isRemoteEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  return isRemote || process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop'
}

/**
 * Whether a non-Anthropic provider is configured, using the same precedence as
 * `getAPIProvider()`: the cloud `CLAUDE_CODE_USE_*` flags outrank `modelType`,
 * an explicit third-party `modelType` pins, and the OpenAI-style flags rank
 * *below* `modelType === 'anthropic'`.
 *
 * That last rule is the load-bearing one. `/login` writes
 * `CLAUDE_CODE_USE_OPENAI` / `OPENAI_BASE_URL` into `settings.env`, which
 * `applyConfigEnvironmentVariables()` merges into `process.env`, and a later
 * Anthropic login only flips `modelType` — so treating that residue as
 * third-party would disable Anthropic auth for someone who is logged into
 * Anthropic.
 */
export function isThirdPartyProviderConfigured(
  settings: { modelType?: string },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  let useBedrock = isEnvTruthy(env.CLAUDE_CODE_USE_BEDROCK)
  let useVertex = isEnvTruthy(env.CLAUDE_CODE_USE_VERTEX)
  let useFoundry = isEnvTruthy(env.CLAUDE_CODE_USE_FOUNDRY)
  let useOpenAI = isEnvTruthy(env.CLAUDE_CODE_USE_OPENAI)
  let useGemini = isEnvTruthy(env.CLAUDE_CODE_USE_GEMINI)
  let useGrok = isEnvTruthy(env.CLAUDE_CODE_USE_GROK)
  try {
    const {
      isUseBedrockEnvEnabled,
      isUseVertexEnvEnabled,
      isUseFoundryEnvEnabled,
      isUseOpenAIEnvEnabled,
      isUseGeminiEnvEnabled,
      isUseGrokEnvEnabled,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    useBedrock = isUseBedrockEnvEnabled(env)
    useVertex = isUseVertexEnvEnabled(env)
    useFoundry = isUseFoundryEnvEnabled(env)
    useOpenAI = isUseOpenAIEnvEnabled(env)
    useGemini = isUseGeminiEnvEnabled(env)
    useGrok = isUseGrokEnvEnabled(env)
  } catch {
    // keep raw env fallback
  }

  const pinnedToThirdPartyModel =
    settings.modelType === 'openai' ||
    settings.modelType === 'gemini' ||
    settings.modelType === 'grok'
  // gemini and grok default their base URL, so `CLAUDE_CODE_USE_*` alone is a
  // complete config — `*_BASE_URL` cannot be the only signal, or a working 3P
  // user is routed into Anthropic OAuth and the onboarding preflight, which
  // exits on failure.
  const thirdPartyEnv =
    useOpenAI ||
    useGemini ||
    useGrok ||
    !!env.OPENAI_BASE_URL ||
    !!env.GEMINI_BASE_URL ||
    !!env.GROK_BASE_URL

  return (
    useBedrock ||
    useVertex ||
    useFoundry ||
    pinnedToThirdPartyModel ||
    (settings.modelType !== 'anthropic' && thirdPartyEnv)
  )
}

/** Whether we are supporting direct 1P auth. */
// this code is closely related to getAuthTokenSource
export function isAnthropicAuthEnabled(): boolean {
  // --bare: API-key-only, never OAuth.
  if (isBareMode()) return false

  // `claude ssh` remote: ANTHROPIC_UNIX_SOCKET tunnels API calls through a
  // local auth-injecting proxy. The launcher sets CLAUDE_CODE_OAUTH_TOKEN as a
  // placeholder iff the local side is a subscriber (so the remote includes the
  // oauth-2025 beta header to match what the proxy will inject). The remote's
  // ~/.claude settings (apiKeyHelper, settings.env.ANTHROPIC_API_KEY) MUST NOT
  // flip this — they'd cause a header mismatch with the proxy and a bogus
  // "invalid x-api-key" from the API. See src/ssh/sshAuthProxy.ts.
  if (process.env.ANTHROPIC_UNIX_SOCKET) {
    return !!process.env.CLAUDE_CODE_OAUTH_TOKEN
  }

  const settings = getSettings_DEPRECATED() || {}
  const is3P = isThirdPartyProviderConfigured({
    modelType:
      typeof settings.modelType === 'string' ? settings.modelType : undefined,
  })
  const apiKeyHelper = settings.apiKeyHelper
  // Official API_KEY_FILE_DESCRIPTOR densable.
  let apiKeyFileDescriptor: string | null =
    process.env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR || null
  try {
    const { resolveApiKeyFileDescriptor } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    apiKeyFileDescriptor = resolveApiKeyFileDescriptor()
  } catch {
    // keep raw env fallback
  }
  const hasExternalAuthToken =
    process.env.ANTHROPIC_AUTH_TOKEN || apiKeyHelper || apiKeyFileDescriptor

  // Check if API key is from an external source (not managed by /login)
  const { source: apiKeySource } = getAnthropicApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  const hasExternalApiKey =
    apiKeySource === 'ANTHROPIC_API_KEY' || apiKeySource === 'apiKeyHelper'

  // Disable Anthropic auth if:
  // 1. Using 3rd party services (Bedrock/Vertex/Foundry)
  // 2. User has an external API key (regardless of proxy configuration)
  // 3. User has an external auth token (regardless of proxy configuration)
  // this may cause issues if users have complex proxy / gateway "client-side creds" auth scenarios,
  // e.g. if they want to set X-Api-Key to a gateway key but use Anthropic OAuth for the Authorization
  // if we get reports of that, we should probably add an env var to force OAuth enablement
  const shouldDisableAuth =
    is3P ||
    (hasExternalAuthToken && !isManagedOAuthContext()) ||
    (hasExternalApiKey && !isManagedOAuthContext())

  return !shouldDisableAuth
}

/** Where the auth token is being sourced from, if any. */
// this code is closely related to isAnthropicAuthEnabled
export function getAuthTokenSource() {
  // --bare: API-key-only. apiKeyHelper (from --settings) is the only
  // bearer-token-shaped source allowed. OAuth env vars, FD tokens, and
  // keychain are ignored.
  if (isBareMode()) {
    if (getConfiguredApiKeyHelper()) {
      return { source: 'apiKeyHelper' as const, hasToken: true }
    }
    return { source: 'none' as const, hasToken: false }
  }

  if (process.env.ANTHROPIC_AUTH_TOKEN && !isManagedOAuthContext()) {
    return { source: 'ANTHROPIC_AUTH_TOKEN' as const, hasToken: true }
  }

  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { source: 'CLAUDE_CODE_OAUTH_TOKEN' as const, hasToken: true }
  }

  // Check for OAuth token from file descriptor (or its CCR disk fallback)
  const oauthTokenFromFd = getOAuthTokenFromFileDescriptor()
  if (oauthTokenFromFd) {
    // densable `s4`: trimmed FD env, or a consumed descriptor announcement.
    // Disk fallback (pipe FD not inherited) stays CCR_OAUTH_TOKEN_FILE.
    const fromFileDescriptor =
      (process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR?.trim() ?? '') !==
        '' ||
      descriptorAnnouncementConsumed('CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR')
    if (fromFileDescriptor) {
      return {
        source: 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR' as const,
        hasToken: true,
      }
    }
    return {
      source: 'CCR_OAUTH_TOKEN_FILE' as const,
      hasToken: true,
    }
  }

  // Check if apiKeyHelper is configured without executing it
  // This prevents security issues where arbitrary code could execute before trust is established
  const apiKeyHelper = getConfiguredApiKeyHelper()
  if (apiKeyHelper && !isManagedOAuthContext()) {
    return { source: 'apiKeyHelper' as const, hasToken: true }
  }

  const oauthTokens = getClaudeAIOAuthTokens()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isProfileAuthActive, readProfileUserOauthAccessToken } =
    require('./anthropicProfile.js') as typeof import('./anthropicProfile.js')
  if (
    isProfileAuthActive({
      storedClaudeAiLogin: Boolean(oauthTokens?.accessToken),
    })
  ) {
    try {
      const profile = readProfileUserOauthAccessToken()
      if (profile?.token) {
        return { source: 'anthropic-profile' as const, hasToken: true }
      }
    } catch {
      // oRr/DUr is handled on the API client path, not status/source probes
    }
  }

  if (shouldUseClaudeAIAuth(oauthTokens?.scopes) && oauthTokens?.accessToken) {
    return { source: 'claude.ai' as const, hasToken: true }
  }

  return { source: 'none' as const, hasToken: false }
}

export type ApiKeySource =
  | 'ANTHROPIC_API_KEY'
  | 'apiKeyHelper'
  | '/login managed key'
  | 'none'

export function getAnthropicApiKey(): null | string {
  const { key } = getAnthropicApiKeyWithSource()
  return key
}

export function hasAnthropicApiKeyAuth(): boolean {
  const { key, source } = getAnthropicApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  return key !== null && source !== 'none'
}

export function getAnthropicApiKeyWithSource(
  opts: { skipRetrievingKeyFromApiKeyHelper?: boolean } = {},
): {
  key: null | string
  source: ApiKeySource
} {
  // --bare: hermetic auth. Only ANTHROPIC_API_KEY env or apiKeyHelper from
  // the --settings flag. Never touches keychain, config file, or approval
  // lists. 3P (Bedrock/Vertex/Foundry) uses provider creds, not this path.
  if (isBareMode()) {
    if (process.env.ANTHROPIC_API_KEY) {
      return { key: process.env.ANTHROPIC_API_KEY, source: 'ANTHROPIC_API_KEY' }
    }
    if (getConfiguredApiKeyHelper()) {
      return {
        key: opts.skipRetrievingKeyFromApiKeyHelper
          ? null
          : getApiKeyFromApiKeyHelperCached(),
        source: 'apiKeyHelper',
      }
    }
    return { key: null, source: 'none' }
  }

  // On homespace, don't use ANTHROPIC_API_KEY (use Console key instead)
  // https://anthropic.slack.com/archives/C08428WSLKV/p1747331773214779
  const apiKeyEnv = isRunningOnHomespace()
    ? undefined
    : process.env.ANTHROPIC_API_KEY

  // Always check for direct environment variable when the user ran claude --print.
  // This is useful for CI, etc.
  if (preferThirdPartyAuthentication() && apiKeyEnv) {
    return {
      key: apiKeyEnv,
      source: 'ANTHROPIC_API_KEY',
    }
  }

  if (isEnvTruthy(process.env.CI) || process.env.NODE_ENV === 'test') {
    // Check for API key from file descriptor first
    const apiKeyFromFd = getApiKeyFromFileDescriptor()
    if (apiKeyFromFd) {
      return {
        key: apiKeyFromFd,
        source: 'ANTHROPIC_API_KEY',
      }
    }

    if (
      !apiKeyEnv &&
      !process.env.CLAUDE_CODE_OAUTH_TOKEN &&
      !process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
    ) {
      // densable: source-only probes (isAnthropicAuthEnabled / hasAnthropicApiKeyAuth
      // pass skipRetrievingKeyFromApiKeyHelper) must not require CI keys —
      // getUserContext #5 email injection calls getOauthAccountInfo soft-path.
      if (opts.skipRetrievingKeyFromApiKeyHelper) {
        return { key: null, source: 'none' }
      }
      throw new Error(
        'ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN env var is required',
      )
    }

    if (apiKeyEnv) {
      return {
        key: apiKeyEnv,
        source: 'ANTHROPIC_API_KEY',
      }
    }

    // OAuth token is present but this function returns API keys only
    return {
      key: null,
      source: 'none',
    }
  }
  // Check for ANTHROPIC_API_KEY before checking the apiKeyHelper or /login-managed key
  if (
    apiKeyEnv &&
    getGlobalConfig().customApiKeyResponses?.approved?.includes(
      normalizeApiKeyForConfig(apiKeyEnv),
    )
  ) {
    return {
      key: apiKeyEnv,
      source: 'ANTHROPIC_API_KEY',
    }
  }

  // Check for API key from file descriptor
  const apiKeyFromFd = getApiKeyFromFileDescriptor()
  if (apiKeyFromFd) {
    return {
      key: apiKeyFromFd,
      source: 'ANTHROPIC_API_KEY',
    }
  }

  // Check for apiKeyHelper — use sync cache, never block
  const apiKeyHelperCommand = getConfiguredApiKeyHelper()
  if (apiKeyHelperCommand) {
    if (opts.skipRetrievingKeyFromApiKeyHelper) {
      return {
        key: null,
        source: 'apiKeyHelper',
      }
    }
    // Cache may be cold (helper hasn't finished yet). Return null with
    // source='apiKeyHelper' rather than falling through to keychain —
    // apiKeyHelper must win. Callers needing a real key must await
    // getApiKeyFromApiKeyHelper() first (client.ts, useApiKeyVerification do).
    return {
      key: getApiKeyFromApiKeyHelperCached(),
      source: 'apiKeyHelper',
    }
  }

  const apiKeyFromConfigOrMacOSKeychain = getApiKeyFromConfigOrMacOSKeychain()
  if (apiKeyFromConfigOrMacOSKeychain) {
    return apiKeyFromConfigOrMacOSKeychain
  }

  return {
    key: null,
    source: 'none',
  }
}

/**
 * Get the configured apiKeyHelper from settings.
 * In bare mode, only the --settings flag source is consulted — apiKeyHelper
 * from ~/.claude/settings.json or project settings is ignored.
 */
export function getConfiguredApiKeyHelper(): string | undefined {
  // Official RN: host-managed provider auth ignores settings apiKeyHelper.
  if (isHostManagedProviderAuth()) {
    return undefined
  }
  if (isBareMode()) {
    return getSettingsForSource('flagSettings')?.apiKeyHelper
  }
  const mergedSettings = getSettings_DEPRECATED() || {}
  if (mergedSettings.apiKeyHelper) {
    return mergedSettings.apiKeyHelper
  }
  try {
    const { resolveRemoteHelperTier } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/remoteSettingsState.js') as typeof import('./settings/remoteSettingsState.js')
    return resolveRemoteHelperTier()?.apiKeyHelper
  } catch {
    return undefined
  }
}

/**
 * Check if the configured apiKeyHelper comes from project settings (projectSettings or localSettings)
 */
function isApiKeyHelperFromProjectOrLocalSettings(): boolean {
  const apiKeyHelper = getConfiguredApiKeyHelper()
  if (!apiKeyHelper) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.apiKeyHelper === apiKeyHelper ||
    localSettings?.apiKeyHelper === apiKeyHelper
  )
}

/**
 * Get the configured awsAuthRefresh from settings.
 * Official EEe / Qv: host-managed provider skips settings shell refresh.
 */
function getConfiguredAwsAuthRefresh(): string | undefined {
  if (isHostManagedProviderAuth()) {
    return undefined
  }
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.awsAuthRefresh
}

/**
 * Check if the configured awsAuthRefresh comes from project settings
 */
export function isAwsAuthRefreshFromProjectSettings(): boolean {
  const awsAuthRefresh = getConfiguredAwsAuthRefresh()
  if (!awsAuthRefresh) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.awsAuthRefresh === awsAuthRefresh ||
    localSettings?.awsAuthRefresh === awsAuthRefresh
  )
}

/**
 * Get the configured awsCredentialExport from settings.
 * Official pRi / Qv: host-managed provider skips settings credential export.
 */
function getConfiguredAwsCredentialExport(): string | undefined {
  if (isHostManagedProviderAuth()) {
    return undefined
  }
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.awsCredentialExport
}

/**
 * Check if the configured awsCredentialExport comes from project settings
 */
export function isAwsCredentialExportFromProjectSettings(): boolean {
  const awsCredentialExport = getConfiguredAwsCredentialExport()
  if (!awsCredentialExport) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.awsCredentialExport === awsCredentialExport ||
    localSettings?.awsCredentialExport === awsCredentialExport
  )
}

/**
 * Calculate TTL in milliseconds for the API key helper cache
 * Uses CLAUDE_CODE_API_KEY_HELPER_TTL_MS env var if set and valid,
 * otherwise defaults to 5 minutes.
 * Official obc densable via resolveApiKeyHelperTtlMs.
 */
export function calculateApiKeyHelperTTL(): number {
  const { ttlMs, invalidRaw } = resolveApiKeyHelperTtlMs()
  if (invalidRaw !== undefined) {
    logForDebugging(
      `Found CLAUDE_CODE_API_KEY_HELPER_TTL_MS env var, but it was not a valid number. Got ${invalidRaw}`,
      { level: 'error' },
    )
  }
  return ttlMs
}

/** densable bR — JWT near-expiry buffer for official QK. */
export const API_KEY_HELPER_JWT_REFRESH_BUFFER_MS = 30_000

/**
 * densable QK — helper cache is still usable for JWT-idle purposes.
 * na = decodeJwtExpiry (W as cwc). No exp → still valid (TTL/SWR only).
 */
export function isApiKeyHelperJwtCacheValid(cache: {
  value: string
  timestamp: number
}): boolean {
  const exp = decodeJwtExpiry(cache.value)
  if (exp === null) return true
  const refreshAt = exp * 1000 - API_KEY_HELPER_JWT_REFRESH_BUFFER_MS
  if (cache.timestamp >= refreshAt) return true
  return Date.now() < refreshAt
}

/**
 * densable ie() && Hs() && !dr() — first-party helper JWT force-refresh gate.
 * ie = getAPIProvider()==="firstParty" (X as eCc).
 * Hs = !uo() && source==="apiKeyHelper" (skip execute). uo = managed OAuth.
 * dr = ga()?void 0:ANTHROPIC_AUTH_TOKEN. ga = homespace.
 */
function shouldForceRefreshApiKeyHelperJwt(): boolean {
  if (getAPIProvider() !== 'firstParty') return false
  if (isManagedOAuthContext()) return false
  const { source } = getAnthropicApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  if (source !== 'apiKeyHelper') return false
  const authToken = isRunningOnHomespace()
    ? undefined
    : process.env.ANTHROPIC_AUTH_TOKEN
  return !authToken
}

// Async API key helper with sync cache for non-blocking reads.
// Epoch bumps on clearApiKeyHelperCache() — orphaned executions check their
// captured epoch before touching host state so a settings-change or 401-retry
// mid-flight can't clobber the newer cache/inflight.
type ApiKeyHelperHostState = {
  cache: { value: string; timestamp: number } | null
  inflight: {
    promise: Promise<string | null>
    // Only set on cold launches (user is waiting); null for SWR background refreshes.
    startedAt: number | null
  } | null
  epoch: number
}

const apiKeyHelperHostStates = new HostSlot<ApiKeyHelperHostState>(() => ({
  cache: null,
  inflight: null,
  epoch: 0,
}))

function getApiKeyHelperHostState(): ApiKeyHelperHostState {
  return apiKeyHelperHostStates.of(getBootstrapSessionHost())
}

export function getApiKeyHelperElapsedMs(): number {
  const startedAt = getApiKeyHelperHostState().inflight?.startedAt
  return startedAt ? Date.now() - startedAt : 0
}

export async function getApiKeyFromApiKeyHelper(
  isNonInteractiveSession: boolean,
): Promise<string | null> {
  if (!getConfiguredApiKeyHelper()) return null
  const state = getApiKeyHelperHostState()
  const ttl = calculateApiKeyHelperTTL()
  if (state.cache) {
    // Official IR: !QK(cache)&&ie()&&Hs()&&!dr() → await Yw(..., true).
    if (
      !isApiKeyHelperJwtCacheValid(state.cache) &&
      shouldForceRefreshApiKeyHelperJwt()
    ) {
      if (state.inflight) return state.inflight.promise
      state.inflight = {
        promise: _runAndCache(
          isNonInteractiveSession,
          true,
          state.epoch,
          state,
        ),
        startedAt: Date.now(),
      }
      return state.inflight.promise
    }
    if (Date.now() - state.cache.timestamp < ttl) {
      return state.cache.value
    }
    // Stale — return stale value now, refresh in the background.
    // `??=` banned here by eslint no-nullish-assign-object-call (bun bug).
    if (!state.inflight) {
      state.inflight = {
        promise: _runAndCache(
          isNonInteractiveSession,
          false,
          state.epoch,
          state,
        ),
        startedAt: null,
      }
    }
    return state.cache.value
  }
  // Cold cache — deduplicate concurrent calls
  if (state.inflight) return state.inflight.promise
  state.inflight = {
    promise: _runAndCache(isNonInteractiveSession, true, state.epoch, state),
    startedAt: Date.now(),
  }
  return state.inflight.promise
}

async function _runAndCache(
  isNonInteractiveSession: boolean,
  isCold: boolean,
  epoch: number,
  state: ApiKeyHelperHostState,
): Promise<string | null> {
  try {
    const value = await _executeApiKeyHelper(isNonInteractiveSession)
    if (epoch !== state.epoch) return value
    if (value !== null) {
      state.cache = { value, timestamp: Date.now() }
    }
    return value
  } catch (e) {
    if (epoch !== state.epoch) return ' '
    const detail = e instanceof Error ? e.message : String(e)
    console.error(chalk.red(`apiKeyHelper failed: ${detail}`))
    logForDebugging(`Error getting API key from apiKeyHelper: ${detail}`, {
      level: 'error',
    })
    // SWR path: a transient failure shouldn't replace a working key with
    // the ' ' sentinel — keep serving the stale value and bump timestamp
    // so we don't hammer-retry every call.
    if (!isCold && state.cache && state.cache.value !== ' ') {
      state.cache = { ...state.cache, timestamp: Date.now() }
      return state.cache.value
    }
    // Cold cache or prior error — cache ' ' so callers don't fall back to OAuth
    state.cache = { value: ' ', timestamp: Date.now() }
    return ' '
  } finally {
    if (epoch === state.epoch) {
      state.inflight = null
    }
  }
}

async function _executeApiKeyHelper(
  isNonInteractiveSession: boolean,
): Promise<string | null> {
  const apiKeyHelper = getConfiguredApiKeyHelper()
  if (!apiKeyHelper) {
    return null
  }

  if (isApiKeyHelperFromProjectOrLocalSettings()) {
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !isNonInteractiveSession) {
      const error = new Error(
        `Security: apiKeyHelper executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`,
      )
      logAntError('apiKeyHelper invoked before trust check', error)
      logEvent('tengu_apiKeyHelper_missing_trust11', {})
      return null
    }
  }

  const result = await execa(apiKeyHelper, {
    shell: true,
    timeout: 10 * 60 * 1000,
    reject: false,
  })
  if (result.failed) {
    // reject:false — execa resolves on exit≠0/timeout, stderr is on result
    const why = result.timedOut ? 'timed out' : `exited ${result.exitCode}`
    const stderr = result.stderr?.trim()
    throw new Error(stderr ? `${why}: ${stderr}` : why)
  }
  const stdout = result.stdout?.trim()
  if (!stdout) {
    throw new Error('did not return a value')
  }
  return stdout
}

/**
 * Sync cache reader — returns the last fetched apiKeyHelper value without executing.
 * Returns stale values to match SWR semantics of the async reader.
 * Returns null only if the async fetch hasn't completed yet.
 */
export function getApiKeyFromApiKeyHelperCached(): string | null {
  return getApiKeyHelperHostState().cache?.value ?? null
}

export function clearApiKeyHelperCache(): void {
  const state = getApiKeyHelperHostState()
  state.epoch++
  state.cache = null
  state.inflight = null
}

export function prefetchApiKeyFromApiKeyHelperIfSafe(
  isNonInteractiveSession: boolean,
): void {
  // Skip if trust not yet accepted — the inner _executeApiKeyHelper check
  // would catch this too, but would fire a false-positive analytics event.
  if (
    isApiKeyHelperFromProjectOrLocalSettings() &&
    !checkHasTrustDialogAccepted()
  ) {
    return
  }
  void getApiKeyFromApiKeyHelper(isNonInteractiveSession)
}

// Timeout for AWS auth refresh command (3 minutes).
// Long enough for browser-based SSO flows, short enough to prevent indefinite hangs.
const AWS_AUTH_REFRESH_TIMEOUT_MS = 3 * 60 * 1000

/**
 * Cooldown after an interactive awsAuthRefresh / gcpAuthRefresh finishes so
 * every subsequent API call does not re-spawn SSO login when STS is still
 * failing (official 2.1.207 BBn/FTh, 2.1.323 #2007, 2.1.331 [W-080/082/096/097/098]).
 */
type CloudAuthRefreshHostState = {
  awsAuthRefreshLastFinishedAt: number | null
  awsAuthRefreshCooldownEpoch: number
  awsAuthRefreshInflight: Promise<boolean> | null
  gcpAuthRefreshLastFinishedAt: number | null
  gcpAuthRefreshInflight: Promise<boolean> | null
  defaultAwsProviderChainLastInvalidate: Map<string, number>
}

const cloudAuthRefreshHostSlot = new HostSlot<CloudAuthRefreshHostState>(
  () => ({
    awsAuthRefreshLastFinishedAt: null,
    awsAuthRefreshCooldownEpoch: 0,
    awsAuthRefreshInflight: null,
    gcpAuthRefreshLastFinishedAt: null,
    gcpAuthRefreshInflight: null,
    defaultAwsProviderChainLastInvalidate: new Map(),
  }),
)

function getCloudAuthRefreshHostState(): CloudAuthRefreshHostState {
  return cloudAuthRefreshHostSlot.of(getBootstrapSessionHost())
}

const AUTH_REFRESH_LOCK_STALE_MS = 5 * 60 * 1000
const AUTH_REFRESH_LOCK_POLL_MS = 150
const AUTH_REFRESH_LOCK_MAX_WAIT_MS = 3 * 60 * 1000

/**
 * Official 2.1.323 (#2007): Cross-process file lock + completion timestamp
 * marker for `awsAuthRefresh` and `gcpAuthRefresh`.
 *
 * When 3+ Claude Code sessions hit expired credentials simultaneously, every
 * waiter records `waitStartedAt` BEFORE contending for the lock. When the lock
 * is eventually acquired, if another session completed a refresh AFTER
 * `waitStartedAt` (recorded in `<lock>.done`), this session skips spawning the
 * refresh command a second time and returns `true`.
 */
export async function runWithCrossProcessAuthRefreshLock(
  kind: 'aws' | 'gcp',
  run: () => Promise<boolean>,
  opts?: { lockDir?: string; pollMs?: number; maxWaitMs?: number },
): Promise<boolean> {
  if (isDisklessActive()) {
    return await run()
  }
  const lockDir = opts?.lockDir ?? getClaudeConfigHomeDir()
  const lockPath = join(lockDir, `.${kind}-auth-refresh.lock`)
  const donePath = join(lockDir, `.${kind}-auth-refresh.done`)
  const pollMs = opts?.pollMs ?? AUTH_REFRESH_LOCK_POLL_MS
  const maxWaitMs = opts?.maxWaitMs ?? AUTH_REFRESH_LOCK_MAX_WAIT_MS
  const waitStartedAt = Date.now()

  const readDoneAt = (): number => {
    try {
      const raw = getFsImplementation()
        .readFileSync(donePath, { encoding: 'utf8' })
        .trim()
      const parsed = Number(raw)
      return Number.isFinite(parsed) ? parsed : 0
    } catch {
      return 0
    }
  }

  let acquired = false
  try {
    getFsImplementation().mkdirSync(lockDir)
  } catch {
    // ignore mkdir errors — fall through to lock attempt / direct run
  }

  const deadline = waitStartedAt + maxWaitMs
  while (Date.now() < deadline) {
    try {
      const { openSync, closeSync, writeSync } = await import('fs')
      const fd = openSync(lockPath, 'wx', 0o600)
      try {
        writeSync(fd, `${process.pid}\n${Date.now()}\n`)
      } finally {
        closeSync(fd)
      }
      acquired = true
      break
    } catch (e) {
      const code =
        e && typeof e === 'object' && 'code' in e
          ? String((e as { code?: unknown }).code)
          : ''
      if (code !== 'EEXIST') {
        // Lock dir unwritable or unsupported FS — fall back to running directly.
        break
      }
      // Check if lock file is stale (process crashed)
      try {
        const stat = getFsImplementation().statSync(lockPath)
        if (Date.now() - stat.mtimeMs > AUTH_REFRESH_LOCK_STALE_MS) {
          getFsImplementation().unlinkSync(lockPath)
          continue
        }
      } catch (statErr) {
        const statCode =
          statErr && typeof statErr === 'object' && 'code' in statErr
            ? String((statErr as { code?: unknown }).code)
            : ''
        if (statCode === 'ENOENT') {
          continue
        }
        if (statCode === 'EACCES' || statCode === 'EPERM') {
          // Permission denied inspecting/removing lock — fall back to running directly.
          break
        }
        // Other non-ENOENT errors fall through to pollMs sleep instead of busy-spinning.
      }
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
  }

  try {
    // If another session completed a refresh after we started waiting, skip
    // running the refresh command a second time!
    if (readDoneAt() >= waitStartedAt) {
      logForDebugging(
        `Skipping duplicate ${kind}AuthRefresh — another session refreshed after we started waiting`,
      )
      return true
    }
    const ok = await run()
    if (ok) {
      try {
        const { writeFileSync } = await import('fs')
        writeFileSync(donePath, String(Date.now()), { mode: 0o600 })
      } catch {
        // best-effort marker
      }
    }
    return ok
  } finally {
    if (acquired) {
      try {
        getFsImplementation().unlinkSync(lockPath)
      } catch {
        // ignore cleanup error
      }
    }
  }
}

/** Cache key for default provider chain: AWS_PROFILE + region. */
function defaultAwsProviderChainCacheKey(region: string): string {
  return `${process.env.AWS_PROFILE ?? ''}\0${region}`
}

/**
 * Run awsAuthRefresh to perform interactive authentication (e.g., aws sso login)
 * Streams output in real-time for user visibility.
 *
 * Official 2.1.207: STS success skips refresh; failure is single-flight + 30s
 * cooldown so Bedrock does not re-request SSO credentials on every API call.
 */
async function runAwsAuthRefresh(): Promise<boolean> {
  const cloudState = getCloudAuthRefreshHostState()
  const awsAuthRefresh = getConfiguredAwsAuthRefresh()
  const cooldownEpoch = cloudState.awsAuthRefreshCooldownEpoch

  if (!awsAuthRefresh) {
    return false // Not configured, treat as success
  }

  // SECURITY: Check if awsAuthRefresh is from project settings
  if (isAwsAuthRefreshFromProjectSettings()) {
    // Check if trust has been established for this project
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      const error = new Error(
        `Security: awsAuthRefresh executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`,
      )
      logAntError('awsAuthRefresh invoked before trust check', error)
      logEvent('tengu_awsAuthRefresh_missing_trust', {})
      return false
    }
  }

  if (cloudState.awsAuthRefreshInflight) {
    return cloudState.awsAuthRefreshInflight
  }

  try {
    logForDebugging('Fetching AWS caller identity for AWS auth refresh command')
    await checkStsCallerIdentity()
    logForDebugging(
      'Fetched AWS caller identity, skipping AWS auth refresh command',
    )
    return false
  } catch {
    if (cloudState.awsAuthRefreshInflight) {
      return cloudState.awsAuthRefreshInflight
    }
    if (
      cloudState.awsAuthRefreshLastFinishedAt !== null &&
      Date.now() - cloudState.awsAuthRefreshLastFinishedAt <
        AWS_AUTH_REFRESH_COOLDOWN_MS
    ) {
      return false
    }
    cloudState.awsAuthRefreshInflight = (async () => {
      try {
        return await runWithCrossProcessAuthRefreshLock('aws', () =>
          refreshAwsAuth(awsAuthRefresh),
        )
      } finally {
        if (cooldownEpoch === cloudState.awsAuthRefreshCooldownEpoch) {
          cloudState.awsAuthRefreshLastFinishedAt = Date.now()
        }
        cloudState.awsAuthRefreshInflight = null
      }
    })()
    return cloudState.awsAuthRefreshInflight
  }
}

export function refreshAwsAuth(
  awsAuthRefresh: string,
  signal?: AbortSignal,
): Promise<boolean> {
  logForDebugging('Running AWS auth refresh command')
  // Start tracking authentication status
  const authStatusManager = AwsAuthStatusManager.getInstance()
  authStatusManager.startAuthentication()

  return new Promise(resolve => {
    const refreshProc = exec(awsAuthRefresh, {
      timeout: AWS_AUTH_REFRESH_TIMEOUT_MS,
      // Hide the console window on Windows so SSO browser spawn is not noisy
      windowsHide: true,
      ...(signal ? { signal } : {}),
    })
    refreshProc.stdout!.on('data', data => {
      const output = data.toString().trim()
      if (output) {
        // Add output to status manager for UI display
        authStatusManager.addOutput(output)
        // Also log for debugging
        logForDebugging(output, { level: 'debug' })
      }
    })

    refreshProc.stderr!.on('data', data => {
      const error = data.toString().trim()
      if (error) {
        authStatusManager.setError(error)
        logForDebugging(error, { level: 'error' })
      }
    })

    refreshProc.on('close', (code, signalName) => {
      if (code === 0) {
        logForDebugging('AWS auth refresh completed successfully')
        authStatusManager.endAuthentication(true)
        void resolve(true)
      } else {
        const aborted = signal?.aborted === true
        const timedOut = !aborted && signalName === 'SIGTERM'
        const message = aborted
          ? null
          : timedOut
            ? chalk.red(
                'AWS auth refresh timed out after 3 minutes. Run your auth command manually in a separate terminal.',
              )
            : chalk.red(
                'Error running awsAuthRefresh (in settings or ~/.claude.json):',
              )
        if (message) {
          console.error(message)
        }
        authStatusManager.endAuthentication(false)
        void resolve(false)
      }
    })
  })
}

/**
 * Run awsCredentialExport to get credentials.
 * Official 2.1.207: always runs when configured (no ambient-STS skip) so
 * cross-account export is not skipped when ambient creds still resolve.
 * Accepts flat or nested STS JSON; captures Expiration for cache TTL.
 */
async function getAwsCredsFromCredentialExport(): Promise<AwsResolvedCredentials | null> {
  const awsCredentialExport = getConfiguredAwsCredentialExport()

  if (!awsCredentialExport) {
    return null
  }

  // SECURITY: Check if awsCredentialExport is from project settings
  if (isAwsCredentialExportFromProjectSettings()) {
    // Check if trust has been established for this project
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      const error = new Error(
        `Security: awsCredentialExport executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`,
      )
      logAntError('awsCredentialExport invoked before trust check', error)
      logEvent('tengu_awsCredentialExport_missing_trust', {})
      return null
    }
  }

  try {
    logForDebugging('Running AWS credential export command')
    const result = await execa(awsCredentialExport, {
      shell: true,
      reject: false,
    })
    if (result.exitCode !== 0 || !result.stdout) {
      throw new Error('awsCredentialExport did not return a valid value')
    }

    const awsOutput = jsonParse(result.stdout.trim())
    const creds = parseAwsCredentialExport(awsOutput)
    if (!creds) {
      throw new Error(
        'awsCredentialExport did not return valid AWS STS output structure',
      )
    }

    logForDebugging('AWS credentials retrieved from awsCredentialExport')
    const expRaw = creds.Expiration
    const expiration =
      typeof expRaw === 'string' ? Date.parse(expRaw) : Number.NaN
    return {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
      expiration: Number.isFinite(expiration) ? expiration : undefined,
    }
  } catch (e) {
    const message = chalk.red(
      'Error getting AWS credentials from awsCredentialExport (in settings or ~/.claude.json):',
    )
    if (e instanceof Error) {
      console.error(message, e.message)
    } else {
      console.error(message, e)
    }
    return null
  }
}

/**
 * Refresh AWS authentication and get credentials with cache clearing.
 * Official 2.1.207: TTL follows credential Expiration when present; after a
 * successful interactive refresh, clears the default-chain cache + INI cache.
 * Official 2.1.331: per-host memoized instance on SessionHost.
 */
const refreshAndGetAwsCredentialsHostSlot = new HostSlot(() =>
  memoizeWithTTLAsync(
    async (): Promise<AwsResolvedCredentials | null> => {
      const started = performance.now()
      logForDebugging('[API:auth] AWS credential resolve start')
      // First run auth refresh if needed
      const refreshed = await runAwsAuthRefresh()

      // Get credentials from export (always when configured)
      const credentials = await getAwsCredsFromCredentialExport()

      // Clear AWS INI + default-chain caches so ambient chain sees fresh SSO
      if (refreshed) {
        await clearAwsIniCache()
        getDefaultAwsProviderChain.cache.clear?.()
        getCloudAuthRefreshHostState().defaultAwsProviderChainLastInvalidate.clear()
      }

      logForDebugging(
        `[API:auth] AWS credential resolve done in ${Math.round(performance.now() - started)}ms`,
      )
      return credentials
    },
    value => awsCredentialCacheTtlMs(value?.expiration),
  ),
)

function refreshAndGetAwsCredentialsImpl(): Promise<AwsResolvedCredentials | null> {
  return refreshAndGetAwsCredentialsHostSlot.of(getBootstrapSessionHost())()
}

Object.defineProperty(refreshAndGetAwsCredentialsImpl, 'cache', {
  get: () =>
    refreshAndGetAwsCredentialsHostSlot.of(getBootstrapSessionHost()).cache,
  set: (next: { clear: () => void; delete: (key: string) => boolean }) => {
    refreshAndGetAwsCredentialsHostSlot.of(getBootstrapSessionHost()).cache =
      next
  },
  configurable: true,
  enumerable: true,
})

export const refreshAndGetAwsCredentials =
  refreshAndGetAwsCredentialsImpl as unknown as (() => Promise<AwsResolvedCredentials | null>) & {
    cache: {
      clear: () => void
      delete: (key: string) => boolean
    }
  }

/**
 * Official 2.1.325 #2294: AWS `credential_process` helpers and Google Cloud
 * default credentials fail when Claude Code is started without a `HOME`
 * environment variable. Fall back to `os.homedir()` (reads `/etc/passwd` on
 * POSIX) and populate `process.env.HOME` when missing on non-Windows so child
 * `credential_process` helpers and SDK ADC lookups succeed.
 */
export function ensureHomeEnvForCloudCredentials(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  resolveHomedir: () => string = homedir,
): string | undefined {
  if (platform === 'win32') {
    return env.HOME || env.USERPROFILE || undefined
  }
  const existing = env.HOME?.trim()
  if (existing) {
    return existing
  }
  try {
    const resolved = resolveHomedir()?.trim()
    if (resolved) {
      env.HOME = resolved
      return resolved
    }
  } catch {
    // ignore homedir lookup failure
  }
  return undefined
}

type DefaultAwsProviderChainResult = Promise<
  () => Promise<AwsResolvedCredentials>
>

const defaultAwsProviderChainCacheSlot = new HostSlot<{
  cache: Map<string, DefaultAwsProviderChainResult>
}>(() => ({ cache: new Map() }))

function getDefaultAwsProviderChainUncached(
  region: string,
): DefaultAwsProviderChainResult {
  return (async (): Promise<() => Promise<AwsResolvedCredentials>> => {
    const resolveOnce = memoizeWithTTLAsync(
      async (): Promise<AwsResolvedCredentials> => {
        ensureHomeEnvForCloudCredentials()
        logForDebugging(
          `[API:auth] resolving default AWS provider chain (region: ${region})`,
        )
        // densable 2.1.218 $5 / iEp family: parentClientConfig.region +
        // requestHandler on BOTH parentClientConfig and clientConfig so
        // assume-role STS uses wizard/runtime region (partition fix) and
        // proxy-only networks (fYt) instead of default us-east-1 bare STS.
        const [{ fromNodeProviderChain }, { NodeHttpHandler }, proxyHandler] =
          await Promise.all([
            import('@aws-sdk/credential-providers'),
            import('@smithy/node-http-handler'),
            import('./proxy.js').then(m =>
              m.getAwsSdkProxyRequestHandler({
                url: `https://sts.${region}.amazonaws.com`,
                requestTimeoutMs: m.AWS_SDK_REQUEST_TIMEOUT_MS,
              }),
            ),
          ])
        const requestHandler =
          proxyHandler ??
          new NodeHttpHandler({
            requestTimeout: 30_000,
          })
        const provider = fromNodeProviderChain({
          ignoreCache: true,
          parentClientConfig: {
            region,
            requestHandler,
          },
          clientConfig: {
            requestHandler,
          },
        })
        const identity = await resolveWithStallGuard(provider())
        return {
          accessKeyId: identity.accessKeyId,
          secretAccessKey: identity.secretAccessKey,
          sessionToken: identity.sessionToken ?? '',
          expiration: identity.expiration
            ? identity.expiration.getTime()
            : undefined,
        }
      },
      value => awsCredentialCacheTtlMs(value.expiration),
    )
    return () => resolveOnce()
  })()
}

function getDefaultAwsProviderChainImpl(
  region: string,
): DefaultAwsProviderChainResult {
  const key = defaultAwsProviderChainCacheKey(region)
  const map = defaultAwsProviderChainCacheSlot.of(
    getBootstrapSessionHost(),
  ).cache
  const cached = map.get(key)
  if (cached !== undefined || map.has(key)) {
    return cached as DefaultAwsProviderChainResult
  }
  const result = getDefaultAwsProviderChainUncached(region)
  map.set(key, result)
  return result
}

Object.defineProperty(getDefaultAwsProviderChainImpl, 'cache', {
  get: () =>
    defaultAwsProviderChainCacheSlot.of(getBootstrapSessionHost()).cache,
  set: (next: Map<string, DefaultAwsProviderChainResult>) => {
    defaultAwsProviderChainCacheSlot.of(getBootstrapSessionHost()).cache = next
  },
  configurable: true,
  enumerable: true,
})

/**
 * Memoized AWS default provider chain for Bedrock when awsCredentialExport
 * is not configured. Official 2.1.207 A4 + resolveWithStallGuard: cache
 * resolved credentials by profile+region and hard-timeout the resolve so
 * Windows Credential Manager stalls cannot block every API call.
 */
export const getDefaultAwsProviderChain =
  getDefaultAwsProviderChainImpl as unknown as ((
    region: string,
  ) => DefaultAwsProviderChainResult) & {
    cache: Map<string, DefaultAwsProviderChainResult>
  }

/**
 * Debounced invalidation of the default-chain cache for a region
 * (official invalidateDefaultAwsProviderChainDebounced / mjt).
 */
export function invalidateDefaultAwsProviderChainDebounced(
  region: string,
): boolean {
  const { defaultAwsProviderChainLastInvalidate } =
    getCloudAuthRefreshHostState()
  const key = defaultAwsProviderChainCacheKey(region)
  const now = Date.now()
  if (
    now - (defaultAwsProviderChainLastInvalidate.get(key) ?? 0) <
    AWS_CHAIN_INVALIDATE_DEBOUNCE_MS
  ) {
    return false
  }
  defaultAwsProviderChainLastInvalidate.set(key, now)
  getDefaultAwsProviderChain.cache.delete(key)
  return true
}

export function clearAwsCredentialsCache(): void {
  refreshAndGetAwsCredentials.cache.clear()
  getDefaultAwsProviderChain.cache.clear?.()
  getCloudAuthRefreshHostState().defaultAwsProviderChainLastInvalidate.clear()
}

/** Clear only the export/refresh memo (keep default-chain cache). */
export function clearAwsCredentialExportCache(): void {
  refreshAndGetAwsCredentials.cache.clear()
}

// Official Qv surface — re-export host-managed AWS helpers for client/callers.
export {
  hostManagedAwsProviderChain,
  hostManagedAwsSdkCredentials,
  hostManagedNoCredsError,
  isHostManagedProviderAuth,
}

/**
 * Reset SSO refresh cooldown so the next failed STS probe may re-run
 * awsAuthRefresh immediately (official resetAwsAuthRefreshCooldown / WTt).
 */
export function resetAwsAuthRefreshCooldown(): void {
  const cloudState = getCloudAuthRefreshHostState()
  cloudState.awsAuthRefreshLastFinishedAt = null
  cloudState.awsAuthRefreshCooldownEpoch++
}

/**
 * Get the configured gcpAuthRefresh from settings
 */
function getConfiguredGcpAuthRefresh(): string | undefined {
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.gcpAuthRefresh
}

/**
 * Check if the configured gcpAuthRefresh comes from project settings
 */
export function isGcpAuthRefreshFromProjectSettings(): boolean {
  const gcpAuthRefresh = getConfiguredGcpAuthRefresh()
  if (!gcpAuthRefresh) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.gcpAuthRefresh === gcpAuthRefresh ||
    localSettings?.gcpAuthRefresh === gcpAuthRefresh
  )
}

/** Short timeout for the GCP credentials probe. Without this, when no local
 *  credential source exists (no ADC file, no env var), google-auth-library falls
 *  through to the GCE metadata server which hangs ~12s outside GCP. */
const GCP_CREDENTIALS_CHECK_TIMEOUT_MS = 5_000

/**
 * Check if GCP credentials are currently valid by attempting to get an access token.
 * This uses the same authentication chain that the Vertex SDK uses.
 */
export async function checkGcpCredentialsValid(): Promise<boolean> {
  try {
    ensureHomeEnvForCloudCredentials()
    // Dynamically import to avoid loading google-auth-library unnecessarily
    const { GoogleAuth } = await import('google-auth-library')
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
    const probe = (async () => {
      const client = await auth.getClient()
      await client.getAccessToken()
    })()
    const timeout = sleep(GCP_CREDENTIALS_CHECK_TIMEOUT_MS).then(() => {
      throw new GcpCredentialsTimeoutError('GCP credentials check timed out')
    })
    await Promise.race([probe, timeout])
    return true
  } catch {
    return false
  }
}

/** Default GCP credential TTL - 1 hour to match typical ADC token lifetime */
const DEFAULT_GCP_CREDENTIAL_TTL = 60 * 60 * 1000

/**
 * Run gcpAuthRefresh to perform interactive authentication (e.g., gcloud auth application-default login)
 * Streams output in real-time for user visibility
 */
async function runGcpAuthRefresh(): Promise<boolean> {
  const cloudState = getCloudAuthRefreshHostState()
  const gcpAuthRefresh = getConfiguredGcpAuthRefresh()

  if (!gcpAuthRefresh) {
    return false // Not configured, treat as success
  }

  // SECURITY: Check if gcpAuthRefresh is from project settings
  if (isGcpAuthRefreshFromProjectSettings()) {
    // Check if trust has been established for this project
    // Pass true to indicate this is a dangerous feature that requires trust
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      const error = new Error(
        `Security: gcpAuthRefresh executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`,
      )
      logAntError('gcpAuthRefresh invoked before trust check', error)
      logEvent('tengu_gcpAuthRefresh_missing_trust', {})
      return false
    }
  }

  if (cloudState.gcpAuthRefreshInflight) {
    return cloudState.gcpAuthRefreshInflight
  }

  try {
    logForDebugging('Checking GCP credentials validity for auth refresh')
    const isValid = await checkGcpCredentialsValid()
    if (isValid) {
      logForDebugging(
        'GCP credentials are valid, skipping auth refresh command',
      )
      return false
    }
  } catch {
    // Credentials check failed, proceed with refresh
  }

  if (cloudState.gcpAuthRefreshInflight) {
    return cloudState.gcpAuthRefreshInflight
  }
  if (
    cloudState.gcpAuthRefreshLastFinishedAt !== null &&
    Date.now() - cloudState.gcpAuthRefreshLastFinishedAt <
      AWS_AUTH_REFRESH_COOLDOWN_MS
  ) {
    return false
  }

  cloudState.gcpAuthRefreshInflight = (async () => {
    try {
      return await runWithCrossProcessAuthRefreshLock('gcp', () =>
        refreshGcpAuth(gcpAuthRefresh),
      )
    } finally {
      cloudState.gcpAuthRefreshLastFinishedAt = Date.now()
      cloudState.gcpAuthRefreshInflight = null
    }
  })()
  return cloudState.gcpAuthRefreshInflight
}

// Timeout for GCP auth refresh command (3 minutes).
// Long enough for browser-based auth flows, short enough to prevent indefinite hangs.
const GCP_AUTH_REFRESH_TIMEOUT_MS = 3 * 60 * 1000

export function refreshGcpAuth(gcpAuthRefresh: string): Promise<boolean> {
  logForDebugging('Running GCP auth refresh command')
  // Start tracking authentication status. AwsAuthStatusManager is cloud-provider-agnostic
  // despite the name — print.ts emits its updates as generic SDK 'auth_status' messages.
  const authStatusManager = AwsAuthStatusManager.getInstance()
  authStatusManager.startAuthentication()

  return new Promise(resolve => {
    const refreshProc = exec(gcpAuthRefresh, {
      timeout: GCP_AUTH_REFRESH_TIMEOUT_MS,
    })
    refreshProc.stdout!.on('data', data => {
      const output = data.toString().trim()
      if (output) {
        // Add output to status manager for UI display
        authStatusManager.addOutput(output)
        // Also log for debugging
        logForDebugging(output, { level: 'debug' })
      }
    })

    refreshProc.stderr!.on('data', data => {
      const error = data.toString().trim()
      if (error) {
        authStatusManager.setError(error)
        logForDebugging(error, { level: 'error' })
      }
    })

    refreshProc.on('close', (code, signal) => {
      if (code === 0) {
        logForDebugging('GCP auth refresh completed successfully')
        authStatusManager.endAuthentication(true)
        void resolve(true)
      } else {
        const timedOut = signal === 'SIGTERM'
        const message = timedOut
          ? chalk.red(
              'GCP auth refresh timed out after 3 minutes. Run your auth command manually in a separate terminal.',
            )
          : chalk.red(
              'Error running gcpAuthRefresh (in settings or ~/.claude.json):',
            )
        console.error(message)
        authStatusManager.endAuthentication(false)
        void resolve(false)
      }
    })
  })
}

/**
 * Refresh GCP authentication if needed.
 * This function checks if credentials are valid and runs the refresh command if not.
 * Memoized with TTL per SessionHost to avoid excessive refresh attempts.
 */
const refreshGcpCredentialsIfNeededHostSlot = new HostSlot(() =>
  memoizeWithTTLAsync(async (): Promise<boolean> => {
    // Run auth refresh if needed
    const refreshed = await runGcpAuthRefresh()
    return refreshed
  }, DEFAULT_GCP_CREDENTIAL_TTL),
)

function refreshGcpCredentialsIfNeededImpl(): Promise<boolean> {
  return refreshGcpCredentialsIfNeededHostSlot.of(getBootstrapSessionHost())()
}

Object.defineProperty(refreshGcpCredentialsIfNeededImpl, 'cache', {
  get: () =>
    refreshGcpCredentialsIfNeededHostSlot.of(getBootstrapSessionHost()).cache,
  set: (next: { clear: () => void; delete: (key: string) => boolean }) => {
    refreshGcpCredentialsIfNeededHostSlot.of(getBootstrapSessionHost()).cache =
      next
  },
  configurable: true,
  enumerable: true,
})

export const refreshGcpCredentialsIfNeeded =
  refreshGcpCredentialsIfNeededImpl as unknown as (() => Promise<boolean>) & {
    cache: {
      clear: () => void
      delete: (key: string) => boolean
    }
  }

export function clearGcpCredentialsCache(): void {
  refreshGcpCredentialsIfNeeded.cache.clear()
}

/**
 * Prefetches GCP credentials only if workspace trust has already been established.
 * This allows us to start the potentially slow GCP commands early for trusted workspaces
 * while maintaining security for untrusted ones.
 *
 * Returns void to prevent misuse - use refreshGcpCredentialsIfNeeded() to actually refresh.
 */
export function prefetchGcpCredentialsIfSafe(): void {
  // Check if gcpAuthRefresh is configured
  const gcpAuthRefresh = getConfiguredGcpAuthRefresh()

  if (!gcpAuthRefresh) {
    return
  }

  // Check if gcpAuthRefresh is from project settings
  if (isGcpAuthRefreshFromProjectSettings()) {
    // Only prefetch if trust has already been established
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      // Don't prefetch - wait for trust to be established first
      return
    }
  }

  // Safe to prefetch - either not from project settings or trust already established
  void refreshGcpCredentialsIfNeeded()
}

/**
 * Prefetches AWS credentials only if workspace trust has already been established.
 * This allows us to start the potentially slow AWS commands early for trusted workspaces
 * while maintaining security for untrusted ones.
 *
 * Returns void to prevent misuse - use refreshAndGetAwsCredentials() to actually retrieve credentials.
 */
export function prefetchAwsCredentialsAndBedRockInfoIfSafe(): void {
  // Check if either AWS command is configured
  const awsAuthRefresh = getConfiguredAwsAuthRefresh()
  const awsCredentialExport = getConfiguredAwsCredentialExport()

  if (!awsAuthRefresh && !awsCredentialExport) {
    return
  }

  // Check if either command is from project settings
  if (
    isAwsAuthRefreshFromProjectSettings() ||
    isAwsCredentialExportFromProjectSettings()
  ) {
    // Only prefetch if trust has already been established
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      // Don't prefetch - wait for trust to be established first
      return
    }
  }

  // Safe to prefetch - either not from project settings or trust already established
  void refreshAndGetAwsCredentials()
  getModelStrings()
}

type ApiKeyFromConfigOrKeychainResult = {
  key: string
  source: ApiKeySource
} | null

const apiKeyFromConfigOrKeychainCacheSlot = new HostSlot<{
  cache: Map<unknown, ApiKeyFromConfigOrKeychainResult>
}>(() => ({ cache: new Map() }))

function readApiKeyFromConfigOrMacOSKeychainUncached(): ApiKeyFromConfigOrKeychainResult {
  if (isBareMode()) return null
  // TODO: migrate to SecureStorage
  if (process.platform === 'darwin') {
    // keychainPrefetch.ts fires this read at main.tsx top-level in parallel
    // with module imports. If it completed, use that instead of spawning a
    // sync `security` subprocess here (~33ms).
    const prefetch = getLegacyApiKeyPrefetchResult()
    if (prefetch) {
      if (prefetch.stdout) {
        return { key: prefetch.stdout, source: '/login managed key' }
      }
      // Prefetch completed with no key — fall through to config, not keychain.
    } else {
      const storageServiceName = getMacOsKeychainStorageServiceName()
      try {
        const result = execSyncWithDefaults_DEPRECATED(
          `security find-generic-password -a $USER -w -s "${storageServiceName}"`,
        )
        if (result) {
          return { key: result, source: '/login managed key' }
        }
      } catch (e) {
        logError(e)
      }
    }
  }

  const config = getGlobalConfig()
  if (!config.primaryApiKey) {
    return null
  }

  return { key: config.primaryApiKey, source: '/login managed key' }
}

function getApiKeyFromConfigOrMacOSKeychainImpl(): ApiKeyFromConfigOrKeychainResult {
  const map = apiKeyFromConfigOrKeychainCacheSlot.of(
    getBootstrapSessionHost(),
  ).cache
  if (map.has(undefined)) {
    return map.get(undefined) ?? null
  }
  const result = readApiKeyFromConfigOrMacOSKeychainUncached()
  map.set(undefined, result)
  return result
}

Object.defineProperty(getApiKeyFromConfigOrMacOSKeychainImpl, 'cache', {
  get: () =>
    apiKeyFromConfigOrKeychainCacheSlot.of(getBootstrapSessionHost()).cache,
  set: (next: Map<unknown, ApiKeyFromConfigOrKeychainResult>) => {
    apiKeyFromConfigOrKeychainCacheSlot.of(getBootstrapSessionHost()).cache =
      next
  },
  configurable: true,
  enumerable: true,
})

/** @private Use {@link getAnthropicApiKey} or {@link getAnthropicApiKeyWithSource} */
export const getApiKeyFromConfigOrMacOSKeychain =
  getApiKeyFromConfigOrMacOSKeychainImpl as unknown as (() => ApiKeyFromConfigOrKeychainResult) & {
    cache: Map<unknown, ApiKeyFromConfigOrKeychainResult>
  }

function isValidApiKey(apiKey: string): boolean {
  // Only allow alphanumeric characters, dashes, and underscores
  return /^[a-zA-Z0-9-_]+$/.test(apiKey)
}

export async function saveApiKey(apiKey: string): Promise<void> {
  if (!isValidApiKey(apiKey)) {
    throw new Error(
      'Invalid API key format. API key must contain only alphanumeric characters, dashes, and underscores.',
    )
  }

  // Store as primary API key
  await maybeRemoveApiKeyFromMacOSKeychain()
  let savedToKeychain = false
  if (process.platform === 'darwin') {
    try {
      // TODO: migrate to SecureStorage
      const storageServiceName = getMacOsKeychainStorageServiceName()
      const username = getUsername()

      // Convert to hexadecimal to avoid any escaping issues
      const hexValue = Buffer.from(apiKey, 'utf-8').toString('hex')

      // Use security's interactive mode (-i) with -X (hexadecimal) option
      // This ensures credentials never appear in process command-line arguments
      // Process monitors only see "security -i", not the password
      const command = `add-generic-password -U -a "${username}" -s "${storageServiceName}" -X "${hexValue}"\n`

      await execa('security', ['-i'], {
        input: command,
        reject: false,
      })

      logEvent('tengu_api_key_saved_to_keychain', {})
      savedToKeychain = true
    } catch (e) {
      logError(e)
      logEvent('tengu_api_key_keychain_error', {
        error: errorMessage(
          e,
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      logEvent('tengu_api_key_saved_to_config', {})
    }
  } else {
    logEvent('tengu_api_key_saved_to_config', {})
  }

  const normalizedKey = normalizeApiKeyForConfig(apiKey)

  // Save config with all updates
  saveGlobalConfig(current => {
    const approved = current.customApiKeyResponses?.approved ?? []
    return {
      ...current,
      // Only save to config if keychain save failed or not on darwin
      primaryApiKey: savedToKeychain ? current.primaryApiKey : apiKey,
      customApiKeyResponses: {
        ...current.customApiKeyResponses,
        approved: approved.includes(normalizedKey)
          ? approved
          : [...approved, normalizedKey],
        rejected: current.customApiKeyResponses?.rejected ?? [],
      },
    }
  })

  // Clear memo cache
  getApiKeyFromConfigOrMacOSKeychain.cache.clear?.()
  clearLegacyApiKeyPrefetch()
}

export function isCustomApiKeyApproved(apiKey: string): boolean {
  const config = getGlobalConfig()
  const normalizedKey = normalizeApiKeyForConfig(apiKey)
  return (
    config.customApiKeyResponses?.approved?.includes(normalizedKey) ?? false
  )
}

export async function removeApiKey(): Promise<void> {
  await maybeRemoveApiKeyFromMacOSKeychain()

  // Also remove from config instead of returning early, for older clients
  // that set keys before we supported keychain.
  saveGlobalConfig(current => ({
    ...current,
    primaryApiKey: undefined,
  }))

  // Clear memo cache
  getApiKeyFromConfigOrMacOSKeychain.cache.clear?.()
  clearLegacyApiKeyPrefetch()
}

async function maybeRemoveApiKeyFromMacOSKeychain(): Promise<void> {
  try {
    await maybeRemoveApiKeyFromMacOSKeychainThrows()
  } catch (e) {
    logError(e)
  }
}

// Function to store OAuth tokens in secure storage
export function saveOAuthTokensIfNeeded(tokens: OAuthTokens): {
  success: boolean
  warning?: string
  transient?: boolean
  fallbackWritten?: boolean
} {
  if (!shouldUseClaudeAIAuth(tokens.scopes)) {
    logEvent('tengu_oauth_tokens_not_claude_ai', {})
    return { success: true }
  }

  // Skip saving inference-only tokens (they come from env vars)
  if (!tokens.refreshToken || !tokens.expiresAt) {
    logEvent('tengu_oauth_tokens_inference_only', {})
    return { success: true }
  }

  const secureStorage = getSecureStorage()
  const storageBackend =
    secureStorage.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

  try {
    const storageData = secureStorage.read() || {}
    const existingOauth = storageData.claudeAiOauth

    storageData.claudeAiOauth = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      // densable 2.1.217: refreshTokenExpiresAt feeds mAr() 3-day login warning
      refreshTokenExpiresAt:
        tokens.refreshTokenExpiresAt ??
        existingOauth?.refreshTokenExpiresAt ??
        undefined,
      scopes: tokens.scopes,
      // Profile fetch in refreshOAuthToken swallows errors and returns null on
      // transient failures (network, 5xx, rate limit). Don't clobber a valid
      // stored subscription with null — fall back to the existing value.
      subscriptionType:
        tokens.subscriptionType ?? existingOauth?.subscriptionType ?? null,
      subscriptionTypeSource:
        tokens.subscriptionTypeSource ??
        existingOauth?.subscriptionTypeSource ??
        undefined,
      subscriptionTypeVerifiedAt:
        tokens.subscriptionTypeVerifiedAt ??
        existingOauth?.subscriptionTypeVerifiedAt ??
        undefined,
      rateLimitTier:
        tokens.rateLimitTier ?? existingOauth?.rateLimitTier ?? null,
    }

    const updateStatus = secureStorage.update(storageData)

    if (updateStatus.success) {
      logEvent('tengu_oauth_tokens_saved', { storageBackend })
    } else {
      logEvent('tengu_oauth_tokens_save_failed', { storageBackend })
    }

    getClaudeAIOAuthTokens.cache?.clear?.()
    // densable G2t @180709491: lY(),Ip()
    // Ip @180712775: if(jN(),!s_())IW();else o_() — dropInFlight when s_
    Ip()
    return updateStatus
  } catch (error) {
    logError(error)
    logEvent('tengu_oauth_tokens_save_exception', {
      storageBackend,
      error: errorMessage(
        error,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return { success: false, warning: 'Failed to save OAuth tokens' }
  }
}

/**
 * leftover 239 uD + credentials/<profile>.json — not ua()/keychain.
 * Throws AnthropicProfileOauthError when expired with no refresh (oRr).
 */
export function getActiveProfileAccessToken(): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isProfileAuthActive, readProfileUserOauthAccessToken } =
    require('./anthropicProfile.js') as typeof import('./anthropicProfile.js')
  if (
    !isProfileAuthActive({
      storedClaudeAiLogin: Boolean(getClaudeAIOAuthTokens()?.accessToken),
    })
  ) {
    return null
  }
  return readProfileUserOauthAccessToken()?.token ?? null
}

/** leftover 239 zqt — refresh + workspace header + profile base_url. */
export async function getActiveProfileWire(): Promise<{
  token: string
  extraHeaders: Record<string, string>
  baseURL?: string
} | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    getAnthropicProfileAuthKind,
    getAnthropicProfileWireOptions,
    isProfileAuthActive,
    resolveProfileUserOauthAccessToken,
  } = require('./anthropicProfile.js') as typeof import('./anthropicProfile.js')
  if (
    !isProfileAuthActive({
      storedClaudeAiLogin: Boolean(getClaudeAIOAuthTokens()?.accessToken),
    })
  ) {
    return null
  }
  if (getAnthropicProfileAuthKind() === 'oidc_federation') {
    const {
      getOidcFederationWireOptions,
      loadOidcFederationConfig,
      resolveOidcFederationAccessToken,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./anthropicOidc.js') as typeof import('./anthropicOidc.js')
    const token = await resolveOidcFederationAccessToken()
    if (!token?.token) return null
    const config = await loadOidcFederationConfig()
    const wire = getOidcFederationWireOptions(config)
    return {
      token: token.token,
      extraHeaders: wire.extraHeaders,
      ...(wire.baseURL ? { baseURL: wire.baseURL } : {}),
    }
  }
  const token = await resolveProfileUserOauthAccessToken()
  if (!token?.token) return null
  const wire = getAnthropicProfileWireOptions()
  return {
    token: token.token,
    extraHeaders: wire?.extraHeaders ?? {},
    ...(wire?.baseURL ? { baseURL: wire.baseURL } : {}),
  }
}

/**
 * densable `z` — WeakMap host → slot. Same shape as the other hover-rest
 * host slots. There is no shared helper in storageV5 or this file; `jfe`
 * is the oauth slot (`jfe.of(U().host)`).
 */
class WeakOwnerCache<T> {
  #e: () => T
  #t = new WeakMap<object, T>()
  constructor(e: () => T) {
    this.#e = e
  }
  of(e: object): T {
    const t = this.#t.get(e)
    if (t !== undefined) return t
    const o = this.#e()
    this.#t.set(e, o)
    return o
  }
}

/**
 * densable `Yk`. `clear` is `O0e` (`value` undefined, `promise` null) and
 * does not reset mtime, the 401 map, or the in-flight refresh promise.
 * Left unported: lastKeychainAccessToken, lastUnusableTokenRecheckAt,
 * lastOwnSavedAccessToken, credentialsChangedOnDisk,
 * pendingOptedInRefreshChecks.
 */
type OAuth401ForcedRefreshOutcome = 'refreshed' | 'unchanged' | 'failed'

type Pending401HandlerEntry = {
  promise: Promise<boolean>
  callbacks: Array<(outcome: OAuth401ForcedRefreshOutcome) => void>
  outcome?: OAuth401ForcedRefreshOutcome
}

class ClaudeAiOauthHostCache {
  value: OAuthTokens | null | undefined = undefined
  promise: Promise<OAuthTokens | null> | null = null
  lastCredentialsMtimeMs = 0
  /** Same-token 401 dedup. Per host, matching gold `Yk`. */
  pending401Handlers = new Map<string, Pending401HandlerEntry>()
  /** Non-retry, non-force refresh dedup. Per host, matching gold `Yk`. */
  pendingRefreshCheck: Promise<boolean> | null = null
  clear(): void {
    this.value = undefined
    this.promise = null
  }
}

const claudeAiOauthHostCaches = new WeakOwnerCache(
  () => new ClaudeAiOauthHostCache(),
)

function claudeAiOauthHostCache(): ClaudeAiOauthHostCache {
  return claudeAiOauthHostCaches.of(getBootstrapSessionHost())
}

/** densable `nc()` — `Boolean(CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)`; `"0"` stays on. */
function isProviderManagedOauthRead(): boolean {
  return Boolean(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)
}

function isClaudeAiOauthAccess(value: unknown): value is OAuthTokens {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.accessToken === 'string' && row.accessToken.length > 0
}

function claudeAiOauthFromData(value: unknown): OAuthTokens | null {
  return isClaudeAiOauthAccess(value) ? value : null
}

/** densable `_K` — FD scopes when the slot and env scopes are both absent. */
const FILE_DESCRIPTOR_DEFAULT_OAUTH_SCOPES = [
  'user:inference',
  'user:ccr_inference',
  'user:file_upload',
]

/**
 * densable `ck`. Non-empty `CLAUDE_CODE_OAUTH_SCOPES` parts, else `defaults`.
 * Not `scopesFromOauthEnv`: that helper's unset default is inference-only.
 */
function scopesFromOauthScopesEnv(defaults: readonly string[]): string[] {
  const parts = process.env.CLAUDE_CODE_OAUTH_SCOPES?.split(/\s+/).filter(
    part => part.length > 0,
  )
  if (parts !== undefined && parts.length > 0) return parts
  return [...defaults]
}

/** densable `ck` / `Vk` for the env token. Default remains inference-only. */
function scopesFromOauthEnv(): string[] {
  const raw = process.env.CLAUDE_CODE_OAUTH_SCOPES
  if (raw === undefined || raw.length === 0) return ['user:inference']
  const parts = raw.split(/\s+/).filter(part => part.length > 0)
  return parts.length > 0 ? parts : ['user:inference']
}

/**
 * densable `Lso() ?? ck(_K)`. An array from the FD slot is returned as
 * filtered strings, including `[]`. Nullish / non-array falls through to `ck`.
 */
function scopesForFileDescriptorToken(): string[] {
  const fromFd = getOauthScopesFromFd()
  if (Array.isArray(fromFd)) {
    return fromFd.filter(
      (scope): scope is string => typeof scope === 'string' && scope.length > 0,
    )
  }
  return scopesFromOauthScopesEnv(FILE_DESCRIPTOR_DEFAULT_OAUTH_SCOPES)
}

function inferenceOauthToken(
  accessToken: string,
  scopes: string[],
): OAuthTokens {
  return {
    accessToken,
    refreshToken: null,
    expiresAt: null,
    scopes,
    subscriptionType: process.env.CLAUDE_CODE_SUBSCRIPTION_TYPE || null,
    rateLimitTier: process.env.CLAUDE_CODE_RATE_LIMIT_TIER || null,
  }
}

/**
 * densable `yK`. FD wins unless the token came from a bg snapshot and the
 * host is not provider-managed — then storage wins and the FD token is the
 * fallback. Sync `P()`/`b()` lives in authFileDescriptor.ts
 * (`getOAuthTokenFromFileDescriptor`).
 */
function readClaudeAIOAuthTokensUncached(): OAuthTokens | null {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return inferenceOauthToken(
      process.env.CLAUDE_CODE_OAUTH_TOKEN,
      scopesFromOauthEnv(),
    )
  }

  const oauthTokenFromFd = getOAuthTokenFromFileDescriptor()
  const providerManaged = isProviderManagedOauthRead()
  if (oauthTokenFromFd && (!isOauthTokenFromBgSnapshot() || providerManaged)) {
    return inferenceOauthToken(oauthTokenFromFd, scopesForFileDescriptorToken())
  }
  if (providerManaged) return null

  try {
    const oauthData = claudeAiOauthFromData(
      getSecureStorage().read()?.claudeAiOauth,
    )
    if (oauthData) return oauthData
  } catch (error) {
    logError(error)
  }
  if (oauthTokenFromFd) {
    return inferenceOauthToken(oauthTokenFromFd, scopesForFileDescriptorToken())
  }
  return null
}

function readClaudeAIOAuthTokens(): OAuthTokens | null {
  // --bare: API-key-only. No OAuth env tokens, no keychain, no credentials file.
  // densable `mn`: `oW()` returns before the host cache.
  if (isBareMode()) return null
  const slot = claudeAiOauthHostCache()
  if (slot.value !== undefined) return slot.value
  const value = readClaudeAIOAuthTokensUncached()
  slot.value = value
  return value
}

export const getClaudeAIOAuthTokens = Object.assign(readClaudeAIOAuthTokens, {
  cache: {
    clear(): void {
      claudeAiOauthHostCache().clear()
    },
  },
})

/**
 * Clears all OAuth token caches. Call this on 401 errors to ensure
 * the next token read comes from secure storage, not stale in-memory caches.
 * This handles the case where the local expiration check disagrees with the
 * server (e.g., due to clock corrections after token was issued).
 */
// Official 2.1.326 (#336) / 2.1.331: per-host auth state change listeners
// notified when OAuth credentials/account change or clear (login, logout, account switch).
const authStateChangeListenersHostSlot = new HostSlot<Set<() => void>>(
  () => new Set(),
)

export function subscribeAuthStateChanged(listener: () => void): () => void {
  const listeners = authStateChangeListenersHostSlot.of(
    getBootstrapSessionHost(),
  )
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyAuthStateChanged(): void {
  const listeners = authStateChangeListenersHostSlot.peek(
    getBootstrapSessionHost(),
  )
  if (!listeners) return
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // Never let a listener failure break auth transitions
    }
  }
}

export function clearOAuthTokenCache(): void {
  // Slot clear is `O0e`. Do not go through the export: a bun mock of
  // `getClaudeAIOAuthTokens` drops `.cache` and would leave `jfe` populated.
  claudeAiOauthHostCache().clear()
  getClaudeAIOAuthTokens.cache?.clear?.()
  clearKeychainCache()
  // leftover 239 o4b/DJo — login-fail / 401 cache drop includes profile A5/uzs
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { clearAnthropicProfileCaches } =
    require('./anthropicProfile.js') as typeof import('./anthropicProfile.js')
  clearAnthropicProfileCaches()
  notifyAuthStateChanged()
}

// Cross-process staleness: another CC instance may write fresh tokens to
// disk (refresh or /login), but this process's memoize caches forever.
// Without this, terminal 1's /login fixes terminal 1; terminal 2's /login
// then revokes terminal 1 server-side, and terminal 1's memoize never
// re-reads — infinite /login regress (CC-1096, GH#24317).
async function invalidateOAuthCacheIfDiskChanged(): Promise<void> {
  if (isDisklessActive()) {
    return
  }
  try {
    const { mtimeMs } = await stat(
      join(getClaudeConfigHomeDir(), '.credentials.json'),
    )
    const slot = claudeAiOauthHostCache()
    if (mtimeMs !== slot.lastCredentialsMtimeMs) {
      slot.lastCredentialsMtimeMs = mtimeMs
      clearOAuthTokenCache()
    }
  } catch {
    // ENOENT — macOS keychain path (file deleted on migration). Clear only
    // the host oauth slot so it delegates to the keychain cache's 30s TTL
    // instead of caching forever on top. `security find-generic-password` is
    // ~15ms; bounded to once per 30s by the keychain cache.
    claudeAiOauthHostCache().clear()
  }
}

/** Official YPr densable — first unrecovered remote OAuth 401 timestamp (per host). */
const remoteAuthFailStateByHost = new HostSlot<{
  firstAtMs: number | null
}>(() => ({
  firstAtMs: null,
}))

function recordRemoteAuthFailExit(recovered: boolean): 'continue' | 'exit' {
  const slot = remoteAuthFailStateByHost.of(getBootstrapSessionHost())
  const result = evaluateRemoteAuthFailExit(
    { firstFailAtMs: slot.firstAtMs },
    { recovered },
  )
  slot.firstAtMs = result.state.firstFailAtMs
  return result.decision
}

/**
 * densable T9r — clear the remote OAuth 401 fail-exit timer after a
 * successful sideQuery recover+retry (or any recovered auth path that
 * should reset the zombie-exit clock without going through WYt).
 */
export function clearRemoteAuthFailExitTimer(): void {
  const slot = remoteAuthFailStateByHost.peek(getBootstrapSessionHost())
  if (slot) slot.firstAtMs = null
}

/** Test helper — reset official cjt state. */
export function _resetRemoteAuthFailExitStateForTesting(): void {
  const slot = remoteAuthFailStateByHost.peek(getBootstrapSessionHost())
  if (slot) slot.firstAtMs = null
}

// In-flight dedup: when N claude.ai proxy connectors hit 401 with the same
// token simultaneously (common at startup — #20930), only one should clear
// caches and re-read the keychain. Without this, each call's clearOAuthTokenCache()
// nukes readInFlight in macOsKeychainStorage and triggers a fresh spawn —
// sync spawns stacked to 800ms+ of blocked render frames.
/**
 * Handle a 401 "OAuth token has expired" error from the API.
 *
 * This function forces a token refresh when the server says the token is expired,
 * even if our local expiration check disagrees (which can happen due to clock
 * issues when the token was issued).
 *
 * Safety: We compare the failed token with what's in keychain. If another tab
 * already refreshed (different token in keychain), we use that instead of
 * refreshing again. Concurrent calls with the same failedAccessToken are
 * deduplicated to a single keychain read.
 *
 * Official post-183 densable path (XTh/dbc/cjt): when no refresh token is
 * available but an env/FD OAuth token is pinned (bg worker / remote child),
 * wait for host rotation then zombie-exit past AUTH_FAIL_EXIT_MS.
 *
 * @param failedAccessToken - The access token that was rejected with 401
 * @returns true if we now have a valid token, false otherwise
 */
export type HandleOAuth401Options = {
  /**
   * Official 2.1.319 (#1722): when true, only adopt a fresher token already
   * stored on disk/keychain/host — do NOT issue another forced refresh_token
   * request (prevents repeated 401 retries from rotating tokens and causing
   * 401s in sibling sessions).
   */
  adoptOnly?: boolean
  onForcedRefreshOutcome?: (
    outcome: 'refreshed' | 'unchanged' | 'failed',
  ) => void
}

export function handleOAuth401Error(
  failedAccessToken: string,
  options?: HandleOAuth401Options,
): Promise<boolean> {
  if (options?.adoptOnly) {
    return handleOAuth401ErrorImpl(failedAccessToken, options)
  }
  const handlers = claudeAiOauthHostCache().pending401Handlers
  const pending = handlers.get(failedAccessToken)
  if (pending) {
    if (options?.onForcedRefreshOutcome) {
      if (pending.outcome !== undefined) {
        options.onForcedRefreshOutcome(pending.outcome)
      } else {
        pending.callbacks.push(options.onForcedRefreshOutcome)
      }
    }
    return pending.promise
  }

  const entry: Pending401HandlerEntry = {
    promise: undefined as unknown as Promise<boolean>,
    callbacks: options?.onForcedRefreshOutcome
      ? [options.onForcedRefreshOutcome]
      : [],
  }
  const notifyOutcome = (outcome: OAuth401ForcedRefreshOutcome): void => {
    entry.outcome = outcome
    const cbs = entry.callbacks.splice(0)
    for (const cb of cbs) {
      try {
        cb(outcome)
      } catch {
        // ignore listener errors
      }
    }
  }
  entry.promise = handleOAuth401ErrorImpl(failedAccessToken, {
    ...options,
    onForcedRefreshOutcome: notifyOutcome,
  }).finally(() => {
    handlers.delete(failedAccessToken)
  })
  handlers.set(failedAccessToken, entry)
  return entry.promise
}

async function handleOAuth401ErrorImpl(
  failedAccessToken: string,
  options?: HandleOAuth401Options,
): Promise<boolean> {
  // Clear caches and re-read from keychain (async — sync read blocks ~100ms/call)
  clearOAuthTokenCache()
  const currentTokens = await getClaudeAIOAuthTokensAsync()

  if (!currentTokens?.refreshToken) {
    // Official QTh: SDK getOAuthToken callback when host owns refresh.
    const sdkRefresh = getSdkOauthTokenRefreshCallback()
    if (sdkRefresh) {
      try {
        const next = await sdkRefresh()
        if (next && next !== failedAccessToken) {
          process.env.CLAUDE_CODE_OAUTH_TOKEN = next
          clearOAuthTokenCache()
          logEvent('tengu_oauth_401_sdk_callback_refreshed', {})
          recordRemoteAuthFailExit(true)
          return true
        }
        if (next === null) {
          logForDebugging(
            'SDK getOAuthToken callback returned null (no token available)',
          )
        } else {
          logForDebugging(
            'SDK getOAuthToken callback returned the same expired token; treating as no refresh',
            { level: 'error' },
          )
        }
      } catch (e) {
        logEvent('tengu_oauth_401_sdk_callback_failed', {})
        logForDebugging(
          `SDK getOAuthToken callback failed: ${e instanceof Error ? e.message : String(e)}`,
          { level: 'error' },
        )
      }
    }

    // densable 2.1.225 QTh: long-lived user-supplied CLAUDE_CODE_OAUTH_TOKEN
    // must NOT be overwritten by a short-lived disk credential on 401.
    // SEA: n = Boolean(env token) && !REMOTE_SESSION_ID && !ANTHROPIC_UNIX_SOCKET
    // → keep env, log, skip disk adopt; still allow wait-for-rotation / zombie exit.
    if (!isHostManagedProviderAuth()) {
      const hasEnvToken = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN)
      const hasFdToken = Boolean(getOAuthTokenFromFileDescriptor())
      // densable oDa = CLAUDE_CODE_REMOTE_SESSION_ID (remote child may adopt disk)
      const isRemoteSession = Boolean(process.env.CLAUDE_CODE_REMOTE_SESSION_ID)
      const keepUserSuppliedEnvToken =
        hasEnvToken && !isRemoteSession && !process.env.ANTHROPIC_UNIX_SOCKET

      // Official 2.1.309 (#1136): desktop/IDE app sessions launched with
      // CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR must not fall back to local
      // secureStorage credentials on 401 (may belong to a different account).
      const isAppOAuthRefreshSession =
        Boolean(process.env.CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH) &&
        new Set(['claude-desktop', 'local-agent', 'claude-vscode']).has(
          process.env.CLAUDE_CODE_ENTRYPOINT ?? '',
        )
      const keepInjectedAppSessionToken =
        !hasEnvToken &&
        isAppOAuthRefreshSession &&
        hasFdToken &&
        !isRemoteSession

      if (keepUserSuppliedEnvToken) {
        logForDebugging(
          'OAuth 401: keeping the user-supplied CLAUDE_CODE_OAUTH_TOKEN instead of adopting the stored credential. Mint a fresh token with `claude setup-token` and restart with it, or unset the variable and run /login.',
          { level: 'error' },
        )
      } else if (keepInjectedAppSessionToken) {
        logForDebugging(
          'OAuth 401: the login this session is using was refused. The login saved on this machine was not used because it may be a different account. Sign in again in the app that started this session, or run /login.',
          { level: 'error' },
        )
      } else if (hasEnvToken || hasFdToken) {
        // densable: disk recover only when not keeping user-supplied env token.
        // Also refuse expired stored tokens (Sbe / isOAuthTokenExpired).
        try {
          const secureStorage = getSecureStorage()
          const storageData = await secureStorage.readAsync()
          const oauthData = storageData?.claudeAiOauth
          if (
            oauthData?.accessToken &&
            oauthData.accessToken !== failedAccessToken &&
            !isOAuthTokenExpired(oauthData.expiresAt ?? null)
          ) {
            if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
              process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthData.accessToken
            }
            clearOAuthTokenCache()
            logEvent('tengu_oauth_401_recovered_from_disk', {})
            recordRemoteAuthFailExit(true)
            return true
          }
        } catch {
          // densable fe("oauth_401_recovery","oauth_401_disk_read_failed")
          logEvent('oauth_401_disk_read_failed', {})
        }
      }

      if (hasEnvToken || hasFdToken) {
        const waitMs = resolveOauth401WaitMsOrDefault()
        if (waitMs > 0) {
          logForDebugging(
            `OAuth 401 recovery: waiting up to ${waitMs}ms for a rotated env token`,
          )
          const rotated = await waitForRotatedOauthToken({
            failedAccessToken,
            timeoutMs: waitMs,
            readToken: () =>
              process.env.CLAUDE_CODE_OAUTH_TOKEN ||
              getOAuthTokenFromFileDescriptor() ||
              undefined,
          })
          if (rotated) {
            clearOAuthTokenCache()
            logEvent('tengu_oauth_401_recovered_from_rotation', {})
            recordRemoteAuthFailExit(true)
            return true
          }
        }
      }

      // densable fe("oauth_401_recovery", n?"oauth_401_skipped_user_env_token":…)
      if (keepUserSuppliedEnvToken) {
        logEvent('oauth_401_skipped_user_env_token', {})
      } else if (hasEnvToken || hasFdToken) {
        logEvent(
          isRemoteSession
            ? 'oauth_401_no_refresh_token_bg_worker'
            : 'oauth_401_no_refresh_token_interactive',
          {},
        )
      }
    }
    if (recordRemoteAuthFailExit(false) === 'exit') {
      logEvent('tengu_oauth_401_zombie_exit', {})
      logForDebugging(
        'OAuth 401 unrecovered past CLAUDE_CODE_AUTH_FAIL_EXIT_MS — exiting so the runner recycles this session with fresh credentials',
        { level: 'error' },
      )
      setTimeout(() => process.exit(1), 2000)
    }
    return false
  }

  // If keychain has a different token, another tab already refreshed - use it
  if (currentTokens.accessToken !== failedAccessToken) {
    logEvent('tengu_oauth_401_recovered_from_keychain', {})
    recordRemoteAuthFailExit(true)
    return true
  }

  // Official 2.1.319 (#1722): when adoptOnly is true, do not issue another
  // forced refresh request on repeated 401 retries.
  if (options?.adoptOnly) {
    logForDebugging(
      'OAuth 401: adoptOnly active — skipping repeat forced token refresh',
    )
    options.onForcedRefreshOutcome?.('unchanged')
    return false
  }

  // Same token that failed - force refresh, bypassing local expiration check
  const refreshed = await checkAndRefreshOAuthTokenIfNeeded(0, true)
  options?.onForcedRefreshOutcome?.(refreshed ? 'refreshed' : 'failed')
  return refreshed
}

/**
 * Official 2.1.319 `GEs(profile)` (#1712 / #1713):
 * Format the organization name from an `ant auth login` profile as
 * `<org> (Claude Console)` (or `"your Claude Console organization"` if absent
 * or lacking alphanumeric characters).
 */
export function formatAntProfileOrganizationLabel(
  profile: { organizationName?: string | null } | null | undefined,
): string {
  const raw =
    typeof profile?.organizationName === 'string'
      ? profile.organizationName
          .replace(/[\u00B7\u26A0]|:\/\//g, ' ')
          .trim()
          .slice(0, 60)
          .replace(/[\u00B7\u26A0]|:\/\//g, ' ')
          .trim()
      : ''
  return /[\p{L}\p{N}]/u.test(raw)
    ? `${raw} (Claude Console)`
    : 'your Claude Console organization'
}

export type ActiveConsoleFallbackCredential =
  | { kind: 'login_key' }
  | { kind: 'ant_profile'; organization: string }
  | null

/**
 * Official 2.1.319 (#1712 / #1713): detect whether Claude Code is currently
 * using a saved `/login` managed key or an `ant auth login` Console profile
 * (e.g. after a `claude.ai` subscription sign-in ended or at startup).
 */
export function detectActiveConsoleFallbackCredential(): ActiveConsoleFallbackCredential {
  try {
    // Official 2.1.323 (#2003): custom X-Api-Key header in ANTHROPIC_CUSTOM_HEADERS
    // supersedes ant auth login / Console fallback billing notices.
    const rawCustomHeaders = process.env.ANTHROPIC_CUSTOM_HEADERS
    if (rawCustomHeaders) {
      for (const line of rawCustomHeaders.split(/\r?\n/)) {
        const colon = line.indexOf(':')
        if (colon <= 0) continue
        const name = line.slice(0, colon).trim().toLowerCase()
        const value = line.slice(colon + 1).trim()
        if (name === 'x-api-key' && value.length > 0) {
          return null
        }
      }
    }
    const { source } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    if (source !== 'none') {
      return source === '/login managed key' ? { kind: 'login_key' } : null
    }
    const { getActiveAnthropicProfileMetadata, isProfileAuthActive } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./anthropicProfile.js') as typeof import('./anthropicProfile.js') & {
        getActiveAnthropicProfileMetadata?: () => {
          createdBy?: string
          organizationName?: string
        } | null
      }
    if (
      !isProfileAuthActive({
        storedClaudeAiLogin: Boolean(getClaudeAIOAuthTokens()?.accessToken),
      })
    ) {
      return null
    }
    const meta = getActiveAnthropicProfileMetadata?.()
    if (meta?.createdBy === 'claude-code') {
      return null
    }
    return {
      kind: 'ant_profile',
      organization: formatAntProfileOrganizationLabel(meta),
    }
  } catch (err) {
    logForDebugging(
      `Could not tell which saved credential is in use: ${err instanceof Error ? err.message : String(err)}`,
      { level: 'error' },
    )
    return null
  }
}

/**
 * Official 2.1.319 (#1712): warning text when a `claude.ai` login ends and
 * Claude Code continues on the sign-in from `ant auth login`, billing usage
 * to the Claude Console organization.
 */
export function formatAntProfileFallbackWarning(
  organizationLabel: string,
): string {
  return `Your claude.ai login ended; continuing on the sign-in from \`ant auth login\`, which bills usage to ${organizationLabel}. Run /login to sign back in to claude.ai.`
}

type BgAuthHandoff = {
  readHandoffCredential?: (
    path: string,
    opts: { symlinkAtPath: 'follow' | 'refuse' },
  ) => Promise<unknown>
  discardSpentCredentialFile?: (path: string) => Promise<unknown> | unknown
  readCredentials?: () => Promise<unknown>
  readAsync?: (arg?: unknown) => Promise<unknown>
  claudeAiOauth?: unknown
}

/**
 * densable `Q7r`. Requires `credentials.readHandoffCredential`. Sync
 * `P()`/`b()` lives in authFileDescriptor.ts
 * (`getOAuthTokenFromFileDescriptor`); this function is the async Q7r path.
 */
async function consumeBgAuthSnapshot(credentials: unknown): Promise<void> {
  const path = process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH
  if (!path) return
  if (credentials === null || typeof credentials !== 'object') return
  const bag = credentials as BgAuthHandoff
  if (typeof bag.readHandoffCredential !== 'function') return
  const result = await bag.readHandoffCredential.call(credentials, path, {
    symlinkAtPath: process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
      ? 'follow'
      : 'refuse',
  })
  if (process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH !== path) return
  if (result === null || typeof result !== 'object') return
  const state = (result as { state?: unknown }).state
  if (state === 'absent') {
    delete process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH
    return
  }
  if (state === 'read-failed') {
    const code = (result as { code?: unknown }).code
    const windows = process.platform === 'win32'
    if (
      code !== 'EBUSY' &&
      code !== 'EPERM' &&
      !(code === 'EACCES' && windows)
    ) {
      delete process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH
    }
    logForDebugging(
      `Failed to consume bg auth snapshot: ${
        typeof code === 'string' ? code : 'unknown error'
      }`,
      { level: 'warn' },
    )
    return
  }
  if (state !== 'present') return
  delete process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH
  if (typeof bag.discardSpentCredentialFile === 'function') {
    void Promise.resolve()
      .then(() => bag.discardSpentCredentialFile?.call(credentials, path))
      .catch(() => {})
  }
  try {
    const contents = (result as { contents?: unknown }).contents
    const parsed = JSON.parse(
      typeof contents === 'string' ? contents : '',
    ) as Record<string, unknown>
    if (typeof parsed.gatewayToken === 'string' && parsed.gatewayToken) {
      setGatewayTokenFromDescriptor(parsed.gatewayToken)
      logForDebugging('Consumed gateway token from bg auth snapshot')
      return
    }
    if (typeof parsed.accessToken !== 'string' || !parsed.accessToken) {
      logForDebugging('bg auth snapshot missing accessToken', {
        level: 'warn',
      })
      return
    }
    setOauthTokenFromFd(parsed.accessToken)
    setOauthTokenFromBgSnapshot(true)
    if (Array.isArray(parsed.scopes) && parsed.scopes.length > 0) {
      setOauthScopesFromFd(parsed.scopes)
    }
    if (parsed.subscriptionType) {
      process.env.CLAUDE_CODE_SUBSCRIPTION_TYPE = String(
        parsed.subscriptionType,
      )
    }
    if (parsed.rateLimitTier) {
      process.env.CLAUDE_CODE_RATE_LIMIT_TIER = String(parsed.rateLimitTier)
    }
    logForDebugging('Consumed bg auth snapshot from sockDir')
  } catch (error) {
    logForDebugging(
      `Failed to consume bg auth snapshot: ${errorMessage(error)}`,
      { level: 'warn' },
    )
  }
}

/** densable `psr` — `Q7r` then `Z7r` (`F` with the credentials handle). */
async function readOauthFileDescriptorSnapshot(
  credentials: unknown,
): Promise<string | null> {
  await consumeBgAuthSnapshot(credentials)
  return readOAuthTokenFromFileDescriptor(credentials)
}

function oauthFromCredentialRead(result: unknown): OAuthTokens | null {
  if (result !== null && typeof result === 'object' && 'state' in result) {
    if ((result as { state?: unknown }).state !== 'present') return null
    const data = (result as { data?: unknown }).data
    if (data === null || typeof data !== 'object') return null
    return claudeAiOauthFromData(
      (data as { claudeAiOauth?: unknown }).claudeAiOauth,
    )
  }
  return null
}

/**
 * Hover-rest handle read. Gold `ue(e).read()` calls `readCredentials()`.
 * Local handles also carry `claudeAiOauth` or `readAsync` (secure storage).
 * `undefined` means this value has no reader.
 */
async function readCredentialsHandle(
  credentials: unknown,
): Promise<OAuthTokens | null | undefined> {
  if (credentials === null || typeof credentials !== 'object') return undefined
  const bag = credentials as BgAuthHandoff
  if (typeof bag.readCredentials === 'function') {
    return oauthFromCredentialRead(await bag.readCredentials.call(credentials))
  }
  const direct = claudeAiOauthFromData(bag.claudeAiOauth)
  if (direct) return direct
  if (typeof bag.readAsync === 'function') {
    const stored = await bag.readAsync.call(credentials, credentials)
    if (stored === null || typeof stored !== 'object') return null
    return claudeAiOauthFromData(
      (stored as { claudeAiOauth?: unknown }).claudeAiOauth,
    )
  }
  if ('claudeAiOauth' in bag) return null
  return undefined
}

async function readStoredClaudeAiOauth(
  credentials: unknown,
): Promise<OAuthTokens | null> {
  if (isHoverRestOn() && credentials !== undefined) {
    const fromHandle = await readCredentialsHandle(credentials)
    if (fromHandle !== undefined) return fromHandle
  }
  const oauthData = claudeAiOauthFromData(
    (await getSecureStorage().readAsync())?.claudeAiOauth,
  )
  return oauthData
}

/**
 * densable `EK`. Env, then `psr` (hover-rest + handle) or sync FD, then
 * storage. A non-snapshot FD token is returned through `mn` before storage.
 * Provider-managed reads never fall through to storage.
 */
async function readClaudeAIOAuthTokensAsyncUncached(
  credentials?: unknown,
): Promise<OAuthTokens | null> {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return readClaudeAIOAuthTokens()
  const fdToken =
    isHoverRestOn() && credentials !== undefined
      ? await readOauthFileDescriptorSnapshot(credentials)
      : getOAuthTokenFromFileDescriptor()
  const providerManaged = isProviderManagedOauthRead()
  if (fdToken && (!isOauthTokenFromBgSnapshot() || providerManaged)) {
    return readClaudeAIOAuthTokens()
  }
  if (providerManaged) return null
  try {
    const stored = await readStoredClaudeAiOauth(credentials)
    if (stored?.accessToken) return stored
  } catch (error) {
    logError(error)
  }
  if (fdToken) return readClaudeAIOAuthTokens()
  return null
}

/**
 * densable `il`. Bare mode skips the cache. An in-flight or settled promise
 * is reused until `O0e` / `cache.clear()`. Rejection drops only that promise.
 */
export async function getClaudeAIOAuthTokensAsync(
  credentials?: unknown,
): Promise<OAuthTokens | null> {
  if (isBareMode()) return null
  const slot = claudeAiOauthHostCache()
  if (slot.promise) return slot.promise
  const pending = readClaudeAIOAuthTokensAsyncUncached(credentials)
  slot.promise = pending
  void pending.catch(() => {
    if (slot.promise === pending) slot.promise = null
  })
  return pending
}

export function checkAndRefreshOAuthTokenIfNeeded(
  retryCount = 0,
  force = false,
  // densable `aO({credentials, storageV5})` / fk `Op({credentials:i,storageV5:a})`
  credentials?: unknown,
  storageV5?: unknown,
): Promise<boolean> {
  // Deduplicate concurrent non-retry, non-force calls
  if (retryCount === 0 && !force) {
    const slot = claudeAiOauthHostCache()
    if (slot.pendingRefreshCheck) {
      return slot.pendingRefreshCheck
    }

    const promise = checkAndRefreshOAuthTokenIfNeededImpl(
      retryCount,
      force,
      credentials,
      storageV5,
    )
    slot.pendingRefreshCheck = promise.finally(() => {
      slot.pendingRefreshCheck = null
    })
    return slot.pendingRefreshCheck
  }

  return checkAndRefreshOAuthTokenIfNeededImpl(
    retryCount,
    force,
    credentials,
    storageV5,
  )
}

/**
 * densable 2.1.246 `dl` / fk `_F(i)` — dead refresh on the credentials handle.
 * `qR(await J(e))`, else `XR(await ne().readAsync(e))`.
 */
export async function isOAuthRefreshDead(
  credentials?: unknown,
): Promise<boolean> {
  const tokens = await getClaudeAIOAuthTokensAsync(credentials)
  const sync = isOAuthRefreshTokenDead(tokens)
  if (sync !== undefined) return sync
  try {
    return isStoredOAuthRefreshTokenCleared(
      await getSecureStorage().readAsync(),
    )
  } catch {
    return false
  }
}

const ALIVE_HOLDER_WAIT_MS = 7500
const OAUTH_REFRESH_LOCK_FILENAME = '.oauth_refresh.lock'
const OAUTH_REFRESH_LOCK_OWNER_TMP_PREFIX = '.oauth_refresh.lock.owner.tmp.'

/**
 * Official 2.1.325 #2284 — sweep leftover `.oauth_refresh.lock.owner.tmp.*`
 * files in the config directory so abandoned atomic-write temp files do not
 * pile up over time. Removes matching temp files older than `minAgeMs`
 * (default 60s, matching the lock stale window).
 */
export async function cleanupStaleOAuthRefreshLockTmpFiles(
  claudeDir: string,
  minAgeMs = 60_000,
): Promise<number> {
  let removed = 0
  try {
    const entries = await readdir(claudeDir)
    const now = Date.now()
    for (const entry of entries) {
      if (!entry.startsWith(OAUTH_REFRESH_LOCK_OWNER_TMP_PREFIX)) {
        continue
      }
      const fullPath = join(claudeDir, entry)
      try {
        if (minAgeMs > 0) {
          const info = await stat(fullPath)
          if (now - info.mtimeMs < minAgeMs) {
            continue
          }
        }
        await unlink(fullPath)
        removed++
      } catch {
        // Ignore ENOENT / permission errors for individual tmp files
      }
    }
  } catch {
    // Config directory unreadable or absent
  }
  return removed
}

export type OAuthRefreshLockSnapshot = {
  contendedLock: 'current' | 'legacy'
  lockAgeMs: number | undefined
  mtimeMs: number | undefined
}

export function getOAuthRefreshLockOptions(
  claudeDir: string,
  onCompromisedCb?: () => void,
) {
  return {
    lockfilePath: join(claudeDir, OAUTH_REFRESH_LOCK_FILENAME),
    realpath: false as const,
    stale: 60_000,
    update: 5_000,
    onCompromised: (err: Error) => {
      logForDebugging(`OAuth refresh lock compromised: ${err.message}`, {
        level: 'error',
      })
      onCompromisedCb?.()
    },
  }
}

export async function inspectOAuthRefreshLock(
  err: unknown,
  claudeDir: string,
): Promise<OAuthRefreshLockSnapshot> {
  const rawFile =
    typeof err === 'object' &&
    err !== null &&
    'file' in err &&
    typeof (err as { file?: unknown }).file === 'string'
      ? (err as { file: string }).file
      : undefined
  const isCurrent =
    rawFile === undefined || resolve(rawFile) === resolve(claudeDir)
  const targetPath = isCurrent
    ? join(claudeDir, OAUTH_REFRESH_LOCK_FILENAME)
    : rawFile
  let mtimeMs: number | undefined
  let lockAgeMs: number | undefined
  try {
    const s = await stat(targetPath)
    mtimeMs = s.mtimeMs
    lockAgeMs = Math.max(0, Math.round(Date.now() - s.mtimeMs))
  } catch {
    lockAgeMs = undefined
  }
  return {
    contendedLock: isCurrent ? 'current' : 'legacy',
    lockAgeMs,
    mtimeMs,
  }
}

export function isSameOAuthRefreshLockSnapshot(
  a: OAuthRefreshLockSnapshot,
  b: OAuthRefreshLockSnapshot,
): boolean {
  return (
    a.mtimeMs !== undefined &&
    b.mtimeMs !== undefined &&
    a.contendedLock === b.contendedLock &&
    a.mtimeMs === b.mtimeMs
  )
}

async function tryTakeOverDeadOAuthRefreshLock(
  lockfilePath: string,
  watchedMtimeMs: number,
): Promise<'taken_over' | 'lock_changed' | 'failed'> {
  try {
    const current = await stat(lockfilePath)
    if (current.mtimeMs !== watchedMtimeMs) {
      return 'lock_changed'
    }
    await rm(lockfilePath, { recursive: true, force: true })
    return 'taken_over'
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') {
      return 'lock_changed'
    }
    return 'failed'
  }
}

async function checkAndRefreshOAuthTokenIfNeededImpl(
  retryCount: number,
  force: boolean,
  credentials?: unknown,
  storageV5?: unknown,
  totalWaitMs = 0,
  firstObservedLock?: OAuthRefreshLockSnapshot,
  takenOver = false,
): Promise<boolean> {
  void storageV5
  const MAX_RETRIES = 5

  await invalidateOAuthCacheIfDiskChanged()

  // densable Al: the fast check is `await il(credentials)`, not sync `mn()`.
  // A hover-rest handle can hold an expired token the sync cache never sees.
  const tokens = await getClaudeAIOAuthTokensAsync(credentials)
  if (!force) {
    if (tokens && !isOAuthTokenExpired(tokens.expiresAt)) {
      return false
    }
    if (!tokens?.refreshToken) {
      return false
    }
  }

  if (!tokens?.refreshToken) {
    return false
  }

  if (!shouldUseClaudeAIAuth(tokens.scopes)) {
    return false
  }

  // densable `if ($s.has(s.refreshToken)) return "known_dead_refresh_token"`
  if (isOAuthRefreshTokenKnownDead(tokens.refreshToken)) {
    return false
  }

  // densable `if (Hs.has(s.refreshToken)) return "account_on_hold"`
  if (isOAuthRefreshTokenOnHold(tokens.refreshToken)) {
    return false
  }

  // Re-read tokens async to check if they're still expired
  // Another process might have refreshed them
  getClaudeAIOAuthTokens.cache?.clear?.()
  clearKeychainCache()
  const freshTokens = await getClaudeAIOAuthTokensAsync(credentials)
  if (
    !freshTokens?.refreshToken ||
    !isOAuthTokenExpired(freshTokens.expiresAt)
  ) {
    return false
  }

  if (isOAuthRefreshTokenKnownDead(freshTokens.refreshToken)) {
    return false
  }

  if (isOAuthRefreshTokenOnHold(freshTokens.refreshToken)) {
    return false
  }

  // Official 2.1.331: skip disk OAuth refresh lock/write in diskless sessions.
  if (isDisklessActive()) {
    logForDebugging(
      'oauth_refresh_diskless: skipping disk OAuth refresh lock/write in diskless session',
    )
    logDisklessWriteSkipped('oauth_refresh_diskless', 'oauth-refresh.lock')
    return false
  }

  // Tokens are still expired, try to acquire lock and refresh
  const claudeDir = getClaudeConfigHomeDir()
  try {
    await mkdir(claudeDir, { recursive: true })
  } catch (err) {
    if (isDiskFullError(err)) {
      logError(err)
      logEvent('tengu_oauth_token_refresh_lock_error', {
        error: errorMessage(
          err,
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      throw new OAuthRefreshDiskFullError()
    }
    throw err
  }

  let release
  let isCompromised = false
  const releaseHold = beginOAuthRefreshLockHold()
  const lockOpts = getOAuthRefreshLockOptions(claudeDir, () => {
    isCompromised = true
  })
  try {
    logEvent('tengu_oauth_token_refresh_lock_acquiring', {})
    release = await lockfile.lock(claudeDir, lockOpts)
    logEvent('tengu_oauth_token_refresh_lock_acquired', {})
    void cleanupStaleOAuthRefreshLockTmpFiles(claudeDir)
  } catch (err) {
    releaseHold()
    if ((err as { code?: string }).code === 'ELOCKED') {
      const observed =
        firstObservedLock ?? (await inspectOAuthRefreshLock(err, claudeDir))
      // Another process has the lock, let's retry if we haven't exceeded max retries
      if (retryCount < MAX_RETRIES) {
        logEvent('tengu_oauth_token_refresh_lock_retry', {
          retryCount: retryCount + 1,
        })
        const waitMs = 1000 + Math.random() * 1000
        await sleep(waitMs)
        return checkAndRefreshOAuthTokenIfNeededImpl(
          retryCount + 1,
          force,
          credentials,
          storageV5,
          totalWaitMs + waitMs,
          observed,
          takenOver,
        )
      }
      // densable 2.1.314 (#1366): wait up to ALIVE_HOLDER_WAIT_MS (7.5s) to
      // distinguish an alive holder updating lock mtime from a dead holder.
      let latest = await inspectOAuthRefreshLock(err, claudeDir)
      if (
        isSameOAuthRefreshLockSnapshot(observed, latest) &&
        totalWaitMs < ALIVE_HOLDER_WAIT_MS
      ) {
        await sleep(ALIVE_HOLDER_WAIT_MS - totalWaitMs)
        latest = await inspectOAuthRefreshLock(err, claudeDir)
      }
      const holderAlive = !isSameOAuthRefreshLockSnapshot(observed, latest)
      if (
        !holderAlive &&
        !takenOver &&
        latest.contendedLock === 'current' &&
        latest.mtimeMs !== undefined
      ) {
        const takeoverOutcome = await tryTakeOverDeadOAuthRefreshLock(
          lockOpts.lockfilePath,
          latest.mtimeMs,
        )
        logEvent('tengu_oauth_token_refresh_lock_dead_holder_takeover', {
          outcome:
            takeoverOutcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          lockAgeMs: latest.lockAgeMs,
        })
        if (
          takeoverOutcome === 'taken_over' ||
          takeoverOutcome === 'lock_changed'
        ) {
          return checkAndRefreshOAuthTokenIfNeededImpl(
            0,
            force,
            credentials,
            storageV5,
            0,
            undefined,
            true,
          )
        }
      }
      logEvent('tengu_oauth_token_refresh_lock_retry_limit_reached', {
        maxRetries: MAX_RETRIES,
        contendedLock:
          latest.contendedLock as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        lockAgeMs: latest.lockAgeMs,
        holderAlive,
      })
      // densable 2.1.248 vp → "lock_timeout"; leftover boolean API throws Zye
      throw new OAuthRefreshLockTimeoutError()
    }
    logError(err)
    logEvent('tengu_oauth_token_refresh_lock_error', {
      error: errorMessage(
        err,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (isDiskFullError(err)) {
      throw new OAuthRefreshDiskFullError()
    }
    // Official 2.1.326 (#60) `$Ye`: on drives that reject folder timestamp
    // updates or advisory lock files, proceed without the lock rather than
    // breaking token refresh.
    if (lockfile.isTimestampRejectionError(err)) {
      logForDebugging(
        `OAuth refresh lock unsupported on filesystem (${getErrnoCode(err) ?? errorMessage(err)}); proceeding unlocked`,
        { level: 'warn' },
      )
      release = async () => {}
    } else {
      return false
    }
  }
  let refreshToken: string | undefined
  try {
    // Check one more time after acquiring lock
    getClaudeAIOAuthTokens.cache?.clear?.()
    clearKeychainCache()
    const lockedTokens = await getClaudeAIOAuthTokensAsync(credentials)
    if (
      !lockedTokens?.refreshToken ||
      !isOAuthTokenExpired(lockedTokens.expiresAt)
    ) {
      logEvent('tengu_oauth_token_refresh_race_resolved', {})
      return false
    }

    // densable `if ($s.has(y.refreshToken)) return "known_dead_refresh_token"`
    if (isOAuthRefreshTokenKnownDead(lockedTokens.refreshToken)) {
      return false
    }

    // densable `if (Hs.has(y.refreshToken)) return "account_on_hold"`
    if (isOAuthRefreshTokenOnHold(lockedTokens.refreshToken)) {
      return false
    }

    if (isCompromised) {
      logEvent('tengu_oauth_token_refresh_lock_compromised_pre_post', {})
      return false
    }

    logEvent('tengu_oauth_token_refresh_starting', {})
    const lockedRefreshToken = lockedTokens.refreshToken
    refreshToken = lockedRefreshToken
    const initialAccessToken = lockedTokens.accessToken
    const refreshedTokens = await refreshOAuthToken(lockedRefreshToken, {
      // For Claude.ai subscribers, omit scopes so the default
      // CLAUDE_AI_OAUTH_SCOPES applies — this allows scope expansion
      // (e.g. adding user:file_upload) on refresh without re-login.
      scopes: shouldUseClaudeAIAuth(lockedTokens.scopes)
        ? undefined
        : lockedTokens.scopes,
    })
    if (isCompromised) {
      logEvent('tengu_oauth_token_refresh_lock_compromised_post_post', {})
    }
    saveOAuthTokensIfNeeded(refreshedTokens)

    // Clear the cache after refreshing token
    getClaudeAIOAuthTokens.cache?.clear?.()
    clearKeychainCache()
    return true
  } catch (error) {
    if (isCompromised) {
      logForDebugging(
        `OAuth refresh failed while lock compromised: ${errorMessage(error)}`,
        { level: 'error' },
      )
      logEvent('tengu_oauth_token_refresh_lock_compromised_in_catch', {})
      getClaudeAIOAuthTokens.cache?.clear?.()
      clearKeychainCache()
      const recovered = await getClaudeAIOAuthTokensAsync(credentials)
      if (
        recovered &&
        (recovered.accessToken !== freshTokens.accessToken ||
          !isOAuthTokenExpired(recovered.expiresAt))
      ) {
        logEvent('tengu_oauth_token_refresh_race_recovered', {})
        return true
      }
      return false
    }

    logError(error)

    getClaudeAIOAuthTokens.cache?.clear?.()
    clearKeychainCache()
    const currentTokens = await getClaudeAIOAuthTokensAsync(credentials)
    if (
      currentTokens &&
      (currentTokens.accessToken !== freshTokens.accessToken ||
        !isOAuthTokenExpired(currentTokens.expiresAt))
    ) {
      logEvent('tengu_oauth_token_refresh_race_recovered', {})
      return true
    }

    // densable `if (Ms(m) && g) await Vk(g, r)`
    if (isOAuthRefreshDeadInvalidGrant(error) && refreshToken) {
      await markDeadOAuthRefreshToken(refreshToken)
    }

    // densable `if (Xl(m) && g) return Hs.set(g, uT(m)), E(...), "account_on_hold"`
    if (isOAuthRefreshAccountOnHoldError(error) && refreshToken) {
      rememberOAuthAccountOnHold(
        refreshToken,
        getOAuthRefreshAccountOnHoldUrl(error),
      )
      logEvent('tengu_oauth_refresh_token_account_on_hold', {})
    }

    if (isDiskFullError(error)) {
      throw new OAuthRefreshDiskFullError()
    }

    return false
  } finally {
    try {
      logEvent('tengu_oauth_token_refresh_lock_releasing', {})
      await release()
      logEvent('tengu_oauth_token_refresh_lock_released', {})
    } finally {
      releaseHold()
    }
  }
}

/**
 * Official gO / V4r / O4t / Sjo / I4t (#860) — track in-flight OAuth refresh locks
 * so short-lived commands (e.g. `claude auth status`, `claude plugin list`) can
 * wait briefly for an active refresh to finish before exiting.
 */
type OAuthRefreshHoldState = {
  held: number
  released: PromiseWithResolvers<void> | null
}

const oauthRefreshHoldStates = new WeakOwnerCache<OAuthRefreshHoldState>(
  () => ({ held: 0, released: null }),
)

const OAUTH_REFRESH_EXIT_WAIT_BASE_MS = 2000
const OAUTH_REFRESH_EXIT_WAIT_DEADLINE_MS = 8500

export function beginOAuthRefreshLockHold(): () => void {
  const state = oauthRefreshHoldStates.of(getBootstrapSessionHost())
  state.held++
  let active = true
  return () => {
    if (!active) return
    active = false
    if (--state.held === 0) {
      state.released?.resolve()
      state.released = null
    }
  }
}

export function getHeldOAuthRefreshPromise(): Promise<void> | null {
  const state = oauthRefreshHoldStates.of(getBootstrapSessionHost())
  if (state.held === 0) return null
  state.released ??= Promise.withResolvers<void>()
  return state.released.promise
}

export function getOAuthRefreshExitWaitMs(untilDeadline = false): number {
  return untilDeadline
    ? Math.max(
        OAUTH_REFRESH_EXIT_WAIT_BASE_MS,
        OAUTH_REFRESH_EXIT_WAIT_DEADLINE_MS - process.uptime() * 1000,
      )
    : OAUTH_REFRESH_EXIT_WAIT_BASE_MS
}

export async function waitForHeldOAuthRefresh(
  timeoutMs: number = getOAuthRefreshExitWaitMs(),
): Promise<boolean> {
  try {
    const held = getHeldOAuthRefreshPromise()
    if (held === null) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    const settled = await Promise.race([
      held.then(() => true),
      new Promise<boolean>(resolve => {
        timer = setTimeout(resolve, Math.max(0, timeoutMs), false)
        timer.unref?.()
      }),
    ])
    if (timer !== undefined) clearTimeout(timer)
    if (!settled) {
      logForDebugging(
        `OAuth refresh still in flight after ${timeoutMs}ms; exiting without waiting further`,
      )
    }
    return settled
  } catch {
    return false
  }
}

export function resetOAuthRefreshHoldForTesting(): void {
  const state = oauthRefreshHoldStates.of(getBootstrapSessionHost())
  state.held = 0
  state.released?.resolve()
  state.released = null
}

/**
 * Official FJo / eRn (#773) — roll back a refused sign-in so an organization-pinned
 * session never leaves a refused org's OAuth token stored on disk or live in memory.
 */
export async function rollbackRefusedSignIn(): Promise<{
  cleared: boolean
}> {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  clearOAuthTokenCache()
  let cleared = true
  try {
    const storage = getSecureStorage()
    const data = (await storage.readAsync?.()) ?? storage.read()
    if (data && 'claudeAiOauth' in data) {
      const { claudeAiOauth: _drop, ...rest } = data as Record<string, unknown>
      if (Object.keys(rest).length === 0) {
        cleared = storage.delete()
      } else {
        const res = storage.update(rest)
        cleared = res.success
      }
    }
  } catch (err) {
    logError(err)
    cleared = false
  } finally {
    clearOAuthTokenCache()
  }
  return { cleared }
}

export function isClaudeAISubscriber(): boolean {
  if (!isAnthropicAuthEnabled()) {
    return false
  }

  return shouldUseClaudeAIAuth(getClaudeAIOAuthTokens()?.scopes)
}

/**
 * Check if the current OAuth token has the user:profile scope.
 *
 * Real /login tokens always include this scope. Env-var and file-descriptor
 * tokens (service keys) hardcode scopes to ['user:inference'] only. Use this
 * to gate calls to profile-scoped endpoints so service key sessions don't
 * generate 403 storms against /api/oauth/profile, bootstrap, etc.
 */
export function hasProfileScope(): boolean {
  return (
    getClaudeAIOAuthTokens()?.scopes?.includes(CLAUDE_AI_PROFILE_SCOPE) ?? false
  )
}

/**
 * densable 2.1.216 pure form of `JKn` scope set accepted by
 * `/api/oauth/validate` for Claude-in-Chrome bridge.
 * Accepts user:profile (WCe) | user:office | user:ccr_inference.
 * Env-var / setup-token sessions default to user:inference only → false.
 */
export function oauthScopesAcceptedByValidate(
  scopes: string[] | null | undefined,
): boolean {
  return (
    Array.isArray(scopes) &&
    (scopes.includes(CLAUDE_AI_PROFILE_SCOPE) ||
      scopes.includes('user:office') ||
      scopes.includes('user:ccr_inference'))
  )
}

/**
 * densable `JKn()` — token scopes accepted by Chrome oauth validate.
 * Gate Chrome enable (`yhn`) so missing-scope sessions never wire MCP and
 * 403-reconnect-loop.
 */
export function hasOauthValidateAcceptedScope(): boolean {
  return oauthScopesAcceptedByValidate(getClaudeAIOAuthTokens()?.scopes)
}

export function is1PApiCustomer(): boolean {
  // 1P API customers are users who are NOT:
  // 1. Claude.ai subscribers (Max, Pro, Enterprise, Team)
  // 2. Vertex AI users
  // 3. AWS Bedrock users
  // 4. Foundry users

  // Exclude Vertex, Bedrock, and Foundry customers
  // Official USE_* densables.
  let useBedrock1P = isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
  let useVertex1P = isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
  let useFoundry1P = isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
  try {
    const {
      isUseBedrockEnvEnabled,
      isUseVertexEnvEnabled,
      isUseFoundryEnvEnabled,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    useBedrock1P = isUseBedrockEnvEnabled()
    useVertex1P = isUseVertexEnvEnabled()
    useFoundry1P = isUseFoundryEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (useBedrock1P || useVertex1P || useFoundry1P) {
    return false
  }

  // Exclude Claude.ai subscribers
  if (isClaudeAISubscriber()) {
    return false
  }

  // Everyone else is an API customer (OAuth API customers, direct API key users, etc.)
  return true
}

/**
 * Gets OAuth account information when Anthropic auth is enabled.
 * Returns undefined when using external API keys or third-party services.
 */
export function getOauthAccountInfo(): AccountInfo | undefined {
  return isAnthropicAuthEnabled() ? getGlobalConfig().oauthAccount : undefined
}

/**
 * densable We / Y — oauthAccount from disk (not getGlobalConfig cache).
 * Used by initReplBridge Jn and env-handoff owner checks.
 */
export function getOauthAccountInfoFromDisk(): AccountInfo | undefined {
  if (!isAnthropicAuthEnabled()) return undefined
  return readGlobalConfigFromDisk()?.oauthAccount
}

/**
 * densable 2.1.248 DN — extra-usage / usage-credits billing allowlist.
 * Gold 1:1; do not invent types beyond this set.
 */
export const OVERAGE_PROVISIONING_BILLING_TYPES = new Set([
  'stripe_subscription',
  'stripe_subscription_contracted',
  'stripe_subscription_enterprise_self_serve',
  'aws_marketplace',
  'c4e_consumption_trial',
  'apple_subscription',
  'google_play_subscription',
])

/**
 * densable 2.1.248 Zur:
 *   let e = In()?.billingType
 *   if (!St() || !e) return false
 *   return DN.has(e)
 */
export function isOverageProvisioningAllowed(): boolean {
  const billingType = getOauthAccountInfo()?.billingType
  if (!isClaudeAISubscriber() || !billingType) {
    return false
  }
  return OVERAGE_PROVISIONING_BILLING_TYPES.has(billingType)
}

// Returns whether the user has Opus access at all, regardless of whether they
// are a subscriber or PayG.
export function hasOpusAccess(): boolean {
  const subscriptionType = getSubscriptionType()

  return (
    subscriptionType === 'max' ||
    subscriptionType === 'enterprise' ||
    subscriptionType === 'team' ||
    subscriptionType === 'pro' ||
    // subscriptionType === null covers both API users and the case where
    // subscribers do not have subscription type populated. For those
    // subscribers, when in doubt, we should not limit their access to Opus.
    subscriptionType === null
  )
}

export function getSubscriptionType(): SubscriptionType | null {
  // Check for mock subscription type first (ANT-only testing)
  if (shouldUseMockSubscription()) {
    return getMockSubscriptionType()
  }

  if (!isAnthropicAuthEnabled()) {
    return null
  }
  const oauthTokens = getClaudeAIOAuthTokens()
  if (!oauthTokens) {
    return null
  }

  return subscriptionFromTokenOrDispatcher(
    oauthTokens.subscriptionType,
    process.env,
    canTrustOauthSubscriptionFields(),
  )
}

export function isMaxSubscriber(): boolean {
  return getSubscriptionType() === 'max'
}

export function isTeamSubscriber(): boolean {
  return getSubscriptionType() === 'team'
}

export function isTeamPremiumSubscriber(): boolean {
  return (
    getSubscriptionType() === 'team' &&
    getRateLimitTier() === 'default_claude_max_5x'
  )
}

export function isEnterpriseSubscriber(): boolean {
  return getSubscriptionType() === 'enterprise'
}

export function isProSubscriber(): boolean {
  return getSubscriptionType() === 'pro'
}

export function getRateLimitTier(): string | null {
  if (!isAnthropicAuthEnabled()) {
    return null
  }
  const oauthTokens = getClaudeAIOAuthTokens()
  if (!oauthTokens) {
    return null
  }

  return rateLimitTierFromTokenOrDispatcher(
    oauthTokens.rateLimitTier,
    process.env,
    canTrustOauthSubscriptionFields(),
  )
}

/**
 * densable Yp — dispatcher env and awn token fields are trusted only for
 * first-party subscriber oauth, not 3P / env token / bare / env API key.
 * ko = isUsing3PServices; Cc = isBareMode; D7 = hasAnthropicApiKeyAuth;
 * M7 = isClaudeAISubscriber.
 */
export function canTrustOauthSubscriptionFields(): boolean {
  if (
    isUsing3PServices() ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    isBareMode()
  ) {
    return false
  }
  return !(hasAnthropicApiKeyAuth() && !isClaudeAISubscriber())
}

/**
 * densable awn — token subscription/tier only when wl() and Yp().
 * wl = isAnthropicAuthEnabled; Xt = getClaudeAIOAuthTokens.
 * urr(awn()) is left on the spawn caller (not in this leftover's edit list).
 */
export function getDispatcherAccountFromOauthToken(): DispatcherAccount {
  if (!isAnthropicAuthEnabled()) {
    return { subscriptionType: null, rateLimitTier: null }
  }
  const token = getClaudeAIOAuthTokens()
  if (!token || !canTrustOauthSubscriptionFields()) {
    return { subscriptionType: null, rateLimitTier: null }
  }
  return {
    subscriptionType: token.subscriptionType ?? null,
    rateLimitTier: token.rateLimitTier ?? null,
  }
}

export function getSubscriptionName(): string {
  const subscriptionType = getSubscriptionType()

  switch (subscriptionType) {
    case 'enterprise':
      return 'Claude Enterprise'
    case 'team':
      return 'Claude Team'
    case 'max':
      return 'Claude Max'
    case 'pro':
      return 'Claude Pro'
    default:
      return 'Claude API'
  }
}

/**
 * Check if using third-party services (non-Anthropic providers).
 *
 * This function gates several behaviours that should only apply when the user
 * is NOT calling the first-party Anthropic API directly:
 *  - auth status display (authStatus handler)
 *  - command visibility (login/logout shown for non-3P)
 *  - command availability checks (meetsAvailabilityRequirement)
 *
 * KEEP IN SYNC with providers.ts — when a new CLAUDE_CODE_USE_* env var is
 * added to getAPIProvider(), the corresponding check MUST be added here.
 * Providers whose selection is controlled purely via settings.modelType
 * (rather than env vars) are NOT covered by this function and may need
 * separate handling in the call sites above.
 */
export function isUsing3PServices(): boolean {
  // Official USE_* densables — keep in sync with providers.ts getAPIProvider.
  let useBedrock = isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
  let useVertex = isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
  let useFoundry = isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
  let useOpenAI = isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI)
  let useGemini = isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI)
  let useGrok = isEnvTruthy(process.env.CLAUDE_CODE_USE_GROK)
  try {
    const {
      isUseBedrockEnvEnabled,
      isUseVertexEnvEnabled,
      isUseFoundryEnvEnabled,
      isUseOpenAIEnvEnabled,
      isUseGeminiEnvEnabled,
      isUseGrokEnvEnabled,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    useBedrock = isUseBedrockEnvEnabled()
    useVertex = isUseVertexEnvEnabled()
    useFoundry = isUseFoundryEnvEnabled()
    useOpenAI = isUseOpenAIEnvEnabled()
    useGemini = isUseGeminiEnvEnabled()
    useGrok = isUseGrokEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  return !!(
    useBedrock ||
    useVertex ||
    useFoundry ||
    useOpenAI ||
    useGemini ||
    useGrok
  )
}

/**
 * Get the configured otelHeadersHelper from settings.
 * densable BNt: policySettings when safe-mode, else merged settings.
 */
function getConfiguredOtelHeadersHelper(): string | undefined {
  if (isSafeModeEnabled()) {
    return getSettingsForSource('policySettings')?.otelHeadersHelper
  }
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.otelHeadersHelper
}

/**
 * Check if the configured otelHeadersHelper comes from project settings (projectSettings or localSettings)
 */
export function isOtelHeadersHelperFromProjectOrLocalSettings(): boolean {
  const otelHeadersHelper = getConfiguredOtelHeadersHelper()
  if (!otelHeadersHelper) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.otelHeadersHelper === otelHeadersHelper ||
    localSettings?.otelHeadersHelper === otelHeadersHelper
  )
}

type OtelHeadersHelperFailureKind =
  | 'timeout'
  | 'exit_code'
  | 'killed'
  | 'spawn_failed'
  | 'empty_output'
  | 'invalid_json'
  | 'not_an_object'
  | 'non_string_value'
  | 'unknown'

class OtelHeadersHelperError extends Error {
  kind: OtelHeadersHelperFailureKind
  exitCode: number | undefined
  constructor(
    message: string,
    kind: OtelHeadersHelperFailureKind,
    exitCode?: number,
  ) {
    super(message)
    this.kind = kind
    this.exitCode = exitCode
  }
}

export function otelHeadersHelperFailureKind(
  error: unknown,
): OtelHeadersHelperFailureKind | undefined {
  return error instanceof OtelHeadersHelperError ? error.kind : undefined
}

type OtelHeadersHelperState = {
  cache: Record<string, string> | null
  timestamp: number
  inflight: Promise<Record<string, string>> | null
  lastFailure: string | null
  failed: ReturnType<typeof createSignal<[string]>>
  prefetched: boolean
}

function createOtelHeadersHelperState(): OtelHeadersHelperState {
  return {
    cache: null,
    timestamp: 0,
    inflight: null,
    lastFailure: null,
    failed: createSignal<[string]>(),
    prefetched: false,
  }
}

const otelHeadersHelperStates = new HostSlot<
  Map<string, OtelHeadersHelperState>
>(() => new Map())

function getOtelHeadersHelperState(): OtelHeadersHelperState {
  const byHostKey = otelHeadersHelperStates.of(getBootstrapSessionHost())
  const hostKey = process.env.CLAUDE_CODE_HOST ?? 'default'
  let state = byHostKey.get(hostKey)
  if (!state) {
    state = createOtelHeadersHelperState()
    byHostKey.set(hostKey, state)
  }
  return state
}

const DEFAULT_OTEL_HEADERS_DEBOUNCE_MS = 1_740_000

/** densable jYe — NaN falls back; 0 is a valid debounce. */
function resolveOtelHeadersDebounceMs(): number {
  const raw = process.env.CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS
  if (raw === undefined) return DEFAULT_OTEL_HEADERS_DEBOUNCE_MS
  const n = Number(raw)
  return Number.isNaN(n) ? DEFAULT_OTEL_HEADERS_DEBOUNCE_MS : n
}

export function getOtelHeadersHelperLastFailure(): string | null {
  if (!getConfiguredOtelHeadersHelper()) return null
  return getOtelHeadersHelperState().lastFailure
}

export function clearOtelHeadersCache(): void {
  const state = getOtelHeadersHelperState()
  state.cache = null
  state.timestamp = 0
  state.inflight = null
  state.lastFailure = null
  state.prefetched = false
}

export function onOtelHeadersHelperFailure(
  listener: (message: string) => void,
): () => void {
  return getOtelHeadersHelperState().failed.subscribe(listener)
}

/**
 * densable $Nr — fire-and-forget prefetch of otelHeadersHelper for HTTP OTLP.
 * No-op in non-interactive sessions; once per host.
 */
export function prefetchOtelHeadersFromHelper(): void {
  if (getIsNonInteractiveSession()) return
  const state = getOtelHeadersHelperState()
  if (state.prefetched) return
  state.prefetched = true
  void getOtelHeadersFromHelperAsync().catch(() => {})
}

/**
 * densable H3n — async otelHeadersHelper exec with debounce, inflight share,
 * file-or-shell spawn, and tengu_otel_headers_helper_failed on first failure.
 */
export async function getOtelHeadersFromHelperAsync(): Promise<
  Record<string, string>
> {
  const otelHeadersHelper = getConfiguredOtelHeadersHelper()
  if (!otelHeadersHelper) return {}

  const debounceMs = resolveOtelHeadersDebounceMs()
  const state = getOtelHeadersHelperState()
  if (state.cache && Date.now() - state.timestamp < debounceMs) {
    return state.cache
  }
  if (state.inflight) return state.inflight

  if (isOtelHeadersHelperFromProjectOrLocalSettings()) {
    if (!checkHasTrustDialogAccepted()) return {}
  }

  state.inflight = (async () => {
    try {
      const trimmed = otelHeadersHelper.trim()
      let isFile = false
      try {
        let cwd: string | null
        try {
          cwd = getCwd()
        } catch {
          cwd = null
        }
        const candidate = cwd === null ? trimmed : resolve(cwd, trimmed)
        isFile = (await stat(candidate)).isFile()
      } catch {
        // not a file path
      }

      let result: Awaited<ReturnType<typeof execa>> | null = null
      let cwd: string | null
      try {
        cwd = getCwd()
      } catch {
        cwd = null
      }
      const cwdOpt = cwd !== null ? { cwd } : {}
      if (isFile) {
        try {
          const fileRun = await execa(trimmed, [], {
            ...cwdOpt,
            timeout: 30_000,
            reject: false,
          })
          const unstarted =
            fileRun.failed &&
            !fileRun.timedOut &&
            typeof fileRun.exitCode !== 'number' &&
            !fileRun.signal
          if (!unstarted) result = fileRun
        } catch {
          // fall through to shell
        }
      }
      if (!result) {
        result = await execa(otelHeadersHelper, {
          ...cwdOpt,
          shell: true,
          timeout: 30_000,
          reject: false,
        })
      }

      if (result.failed) {
        let why: string
        let kind: OtelHeadersHelperFailureKind
        if (result.timedOut) {
          why = 'timed out'
          kind = 'timeout'
        } else if (typeof result.exitCode === 'number') {
          why = `exited ${result.exitCode}`
          kind = 'exit_code'
        } else if (result.signal) {
          why = `was killed by ${result.signal}`
          kind = 'killed'
        } else {
          why = 'could not be started'
          kind = 'spawn_failed'
        }
        const stderr = result.stderr?.toString().trim()
        throw new OtelHeadersHelperError(
          stderr ? `${why}: ${stderr}` : why,
          kind,
          kind === 'exit_code' ? (result.exitCode ?? undefined) : undefined,
        )
      }

      const stdout = result.stdout?.toString().trim()
      if (!stdout) {
        throw new OtelHeadersHelperError(
          'otelHeadersHelper did not return a valid value',
          'empty_output',
        )
      }

      let headers: unknown
      try {
        headers = jsonParse(stdout)
      } catch {
        throw new OtelHeadersHelperError(
          'otelHeadersHelper did not return valid JSON',
          'invalid_json',
        )
      }
      if (
        typeof headers !== 'object' ||
        headers === null ||
        Array.isArray(headers)
      ) {
        throw new OtelHeadersHelperError(
          'otelHeadersHelper must return a JSON object with string key-value pairs',
          'not_an_object',
        )
      }
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value !== 'string') {
          throw new OtelHeadersHelperError(
            `otelHeadersHelper returned non-string value for key "${key}": ${typeof value}`,
            'non_string_value',
          )
        }
      }

      state.cache = headers as Record<string, string>
      state.timestamp = Date.now()
      state.lastFailure = null
      return state.cache
    } catch (error) {
      const message = errorMessage(error)
      const firstFailure = state.lastFailure === null
      state.lastFailure = message
      logForDebugging(
        `Error getting OpenTelemetry headers from otelHeadersHelper (in settings): ${message}`,
        { level: 'error' },
      )
      if (firstFailure) {
        if (getIsNonInteractiveSession()) {
          process.stderr.write(
            chalk.red(
              `otelHeadersHelper failed (OpenTelemetry export headers unavailable): ${message}`,
            ) + '\n',
          )
        }
        const kind =
          error instanceof OtelHeadersHelperError ? error.kind : 'unknown'
        try {
          state.failed.emit(message)
        } catch (listenerError) {
          logForDebugging(
            `otelHeadersHelper failure listener threw: ${errorMessage(listenerError)}`,
            { level: 'error' },
          )
        }
        logEvent('tengu_otel_headers_helper_failed', {
          failure_kind:
            kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          exit_code:
            error instanceof OtelHeadersHelperError
              ? (error.exitCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
              : (undefined as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS),
        })
      }
      throw error
    } finally {
      state.inflight = null
    }
  })()
  return state.inflight
}

/** Sync wrapper — densable callers that still need a Record use the cache or kick H3n. */
export function getOtelHeadersFromHelper(): Record<string, string> {
  const state = getOtelHeadersHelperState()
  if (state.cache) return state.cache
  void getOtelHeadersFromHelperAsync().catch(() => {})
  return {}
}

function isConsumerPlan(plan: SubscriptionType): plan is 'max' | 'pro' {
  return plan === 'max' || plan === 'pro'
}

export function isConsumerSubscriber(): boolean {
  const subscriptionType = getSubscriptionType()
  return (
    isClaudeAISubscriber() &&
    subscriptionType !== null &&
    isConsumerPlan(subscriptionType)
  )
}

export type UserAccountInfo = {
  subscription?: string
  tokenSource?: string
  apiKeySource?: ApiKeySource
  organization?: string
  email?: string
}

export function getAccountInformation() {
  const apiProvider = getAPIProvider()
  // Only provide account info for first-party Anthropic API
  if (apiProvider !== 'firstParty') {
    return undefined
  }
  const { source: authTokenSource } = getAuthTokenSource()
  const accountInfo: UserAccountInfo = {}
  if (
    authTokenSource === 'CLAUDE_CODE_OAUTH_TOKEN' ||
    authTokenSource === 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'
  ) {
    accountInfo.tokenSource = authTokenSource
  } else if (isClaudeAISubscriber()) {
    accountInfo.subscription = getSubscriptionName()
  } else {
    accountInfo.tokenSource = authTokenSource
  }
  const { key: apiKey, source: apiKeySource } = getAnthropicApiKeyWithSource()
  if (apiKey) {
    accountInfo.apiKeySource = apiKeySource
  }

  // 如果我们依赖外部 API 密钥或认证令牌，则不知道组织
  if (
    authTokenSource === 'claude.ai' ||
    apiKeySource === '/login managed key'
  ) {
    // 从 OAuth 账户信息获取组织名称
    const orgName = getOauthAccountInfo()?.organizationName
    if (orgName) {
      accountInfo.organization = orgName
    }
  }
  const email = getOauthAccountInfo()?.emailAddress
  if (
    (authTokenSource === 'claude.ai' ||
      apiKeySource === '/login managed key') &&
    email
  ) {
    accountInfo.email = email
  }
  return accountInfo
}

/**
 * Result of org validation — either success or a descriptive error.
 */
export type OrgValidationResult =
  | { valid: true }
  | { valid: false; reason?: string; message: string }

/**
 * densable J$'s `q$` — an Anthropic-issued credential that is NOT first-party
 * OAuth is configured, so it can never satisfy an org pin.
 *
 * Upstream also returns `getAPIProvider() === 'firstParty' && !tt() && !tn()`
 * when none of the credentials match. `tt` is still unidentified, so that
 * return stays out: this function only gates a fail-closed startup rejection,
 * and under-matching merely lets a session through that upstream would stop.
 * The credential OR matches QK: api key, auth token, s4(api-key FD), Het(),
 * and the api-key helper.
 */
function hasNonOAuthAnthropicCredential(): boolean {
  return (
    hasAnthropicApiKeyAuth() ||
    !!process.env.ANTHROPIC_AUTH_TOKEN ||
    (process.env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR?.trim() ?? '') !== '' ||
    descriptorAnnouncementConsumed('CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR') ||
    !!readGatewayTokenFromDescriptor() ||
    !!getConfiguredApiKeyHelper()
  )
}

/**
 * Validate that the active OAuth token belongs to the organization required
 * by `forceLoginOrgUUID` in managed settings. Returns a result object
 * rather than throwing so callers can choose how to surface the error.
 *
 * Fails closed: if `forceLoginOrgUUID` is set and we cannot determine the
 * token's org (network error, missing profile data), validation fails.
 */
export async function validateForceLoginOrg(): Promise<OrgValidationResult> {
  const prevPolicy = getSettingsForSource('policySettings')
  await rereadManagedSettingsIfNeeded()
  const policy = getSettingsForSource('policySettings')
  const configuredOrgUuid =
    policy?.forceLoginOrgUUID ?? prevPolicy?.forceLoginOrgUUID
  // densable J$ `r` — either key counts as "an auth pin is configured", and both
  // are read from policySettings only, never from merged settings.
  const pinConfigured =
    configuredOrgUuid !== undefined ||
    policy?.forceLoginMethod !== undefined ||
    prevPolicy?.forceLoginMethod !== undefined

  // Official 2.1.328 `euo` (chunk@286370035.js @647445): enforce managed
  // `allowedProviders` at startup org/policy validation before skipping for
  // host-managed / unix-socket / non-OAuth branches.
  const providerCheck = validateAllowedProvider(getAPIProvider())
  if (!providerCheck.valid) {
    logEvent('tengu_auth_force_login_org', {
      reason: 'provider_not_allowed' as never,
      api_provider: getAPIProvider() as never,
    })
    return {
      valid: false,
      reason: 'provider_not_allowed',
      message: providerCheck.message,
    }
  }

  // densable J$ — the host injects credentials, so the pin cannot apply here.
  // Mirrors validateForcedLoginMethod's host-managed branch.
  if (isHostManagedProviderAuth()) {
    if (pinConfigured) {
      logEvent('tengu_auth_force_login_org', {
        reason: 'managed_by_host_under_pin' as never,
      })
    }
    return { valid: true }
  }

  // `claude ssh` remote: real auth lives on the local machine and is injected
  // by the proxy. The placeholder token can't be validated against the profile
  // endpoint. The local side already ran this check before establishing the session.
  if (process.env.ANTHROPIC_UNIX_SOCKET) {
    const anthropicAuth = isAnthropicAuthEnabled()
    const meta = {
      api_provider: getAPIProvider() as never,
      auth_token_source: getAuthTokenSource().source as never,
    }
    if (!anthropicAuth && pinConfigured) {
      logEvent('tengu_auth_force_login_org', {
        reason: 'unix_socket_3p_under_pin' as never,
        ...meta,
      })
    } else if (anthropicAuth && configuredOrgUuid !== undefined) {
      logEvent('tengu_auth_force_login_org', {
        reason: 'unix_socket_ssh_under_pin' as never,
        ...meta,
      })
    } else if (getAdminManagedPolicyUnreadableError()) {
      logEvent('tengu_auth_force_login_org', {
        reason: 'unix_socket_unreadable_policy' as never,
        ...meta,
      })
    }
    return { valid: true }
  }

  if (!isAnthropicAuthEnabled()) {
    // densable J$ — an org pin targets first-party OAuth. If the machine is
    // pinned but carries an Anthropic-issued non-OAuth credential instead, the
    // pin can never be satisfied, so refuse rather than start unpinned.
    if (pinConfigured && hasNonOAuthAnthropicCredential()) {
      return {
        valid: false,
        message:
          `This machine's managed settings require a first-party login, but an\n` +
          `Anthropic-issued credential (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,\n` +
          `or apiKeyHelper) is configured. A non-OAuth Anthropic credential\n` +
          `cannot satisfy the org pin.\n\n` +
          `Remove the credential and run: claude auth login\n\n` +
          `If this is a third-party desktop session: forceLoginOrgUUID targets\n` +
          `first-party OAuth and should be removed from managed-settings.json.`,
      }
    }
    return { valid: true }
  }

  // densable 2.1.247 pm/J$ — fail-close if admin managed settings are
  // unreadable, even when host/HKCU settings exist.
  const unreadable = getAdminManagedPolicyUnreadableError()
  if (unreadable) {
    return {
      valid: false,
      message: formatPolicyUnreadableFailClose(unreadable),
    }
  }

  if (configuredOrgUuid === undefined) {
    return { valid: true }
  }

  // densable J$ — the pin accepts a single UUID or a list, and any one of the
  // listed orgs is permitted.
  const permittedOrgUuids = normalizeForceLoginOrgUuids(configuredOrgUuid)
  if (permittedOrgUuids.length === 0) {
    return {
      valid: false,
      message:
        `forceLoginOrgUUID in managed settings is set to an empty array.\n` +
        `No organizations are permitted. This is almost certainly a\n` +
        `misconfiguration. Contact your administrator.`,
    }
  }
  const requirement =
    permittedOrgUuids.length === 1
      ? `organization ${permittedOrgUuids[0]}`
      : `one of these organizations: ${permittedOrgUuids.join(', ')}`

  // Ensure the access token is fresh before hitting the profile endpoint.
  // No-op for env-var tokens (refreshToken is null).
  await checkAndRefreshOAuthTokenIfNeeded()

  const tokens = getClaudeAIOAuthTokens()
  if (!tokens) {
    return { valid: true }
  }

  // Always fetch the authoritative org UUID from the profile endpoint.
  // Even keychain-sourced tokens verify server-side: the cached org UUID
  // in ~/.claude.json is user-writable and cannot be trusted.
  const { source } = getAuthTokenSource()
  const isEnvVarToken =
    source === 'CLAUDE_CODE_OAUTH_TOKEN' ||
    source === 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'

  const orgLookup = await getOauthOrgUuidFromTokenDetailed(tokens.accessToken)
  if (orgLookup.networkEdgeBlocked) {
    // Official 2.1.326 (#63): HTTP 403 from a network edge/CDN (e.g. Cloudflare)
    // before reaching Anthropic must not tell the user to sign in again.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NETWORK_EDGE_BLOCKED_MESSAGE } =
      require('../services/api/errors.js') as typeof import('../services/api/errors.js')
    return {
      valid: false,
      message:
        `Unable to verify organization for the current authentication token.\n` +
        `${NETWORK_EDGE_BLOCKED_MESSAGE}`,
    }
  }
  const tokenOrgUuid = orgLookup.orgUuid
  if (!tokenOrgUuid) {
    // Fail closed — we can't verify the org
    return {
      valid: false,
      message:
        `Unable to verify organization for the current authentication token.\n` +
        `This machine requires ${requirement} but the organization could not be verified.\n` +
        `Try again, or obtain a token via 'claude auth login'.`,
    }
  }

  if (permittedOrgUuids.includes(tokenOrgUuid)) {
    return { valid: true }
  }

  if (isEnvVarToken) {
    const envVarName =
      source === 'CLAUDE_CODE_OAUTH_TOKEN'
        ? 'CLAUDE_CODE_OAUTH_TOKEN'
        : 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'
    return {
      valid: false,
      message:
        `The ${envVarName} environment variable provides a token for a\n` +
        `different organization than required by this machine's managed settings.\n\n` +
        `Required: ${requirement}\n` +
        `Token organization: ${tokenOrgUuid}\n\n` +
        `Remove the environment variable or obtain a token for the correct organization.`,
    }
  }

  return {
    valid: false,
    message:
      `Your authentication token belongs to organization ${tokenOrgUuid},\n` +
      `but this machine requires ${requirement}.\n\n` +
      `Please log in with the correct organization: claude auth login`,
  }
}

/**
 * Official `OCa` (#1656): resolve the organization UUID for an OAuth access token
 * via `/api/oauth/org` (which does not require `user:profile` scope), falling back
 * to `/api/oauth/profile` when unavailable.
 */
/**
 * Official `h0e` / `nit` / `I1o` (#1550): classify HTTP 403 responses from
 * Cloudflare / CDN / network intermediaries vs Anthropic origin.
 */
export type Http403OriginKind = 'origin' | 'nonorigin_cf' | 'nonorigin_other'

export function classify403Origin(
  getHeader: (name: string) => string | undefined,
): Http403OriginKind {
  const reqId = getHeader('request-id')
  if (typeof reqId === 'string' && reqId.trim().startsWith('req_')) {
    return 'origin'
  }
  const cfRay = getHeader('cf-ray')
  const server = getHeader('server')
  if (
    (typeof cfRay === 'string' && cfRay !== '') ||
    (typeof server === 'string' && /cloudflare/i.test(server))
  ) {
    return 'nonorigin_cf'
  }
  return 'nonorigin_other'
}

export function isNonOrigin403(
  kind: Http403OriginKind,
): kind is 'nonorigin_cf' | 'nonorigin_other' {
  return kind === 'nonorigin_cf' || kind === 'nonorigin_other'
}

export function explainNonOrigin403(
  kind: 'nonorigin_cf' | 'nonorigin_other',
): string {
  switch (kind) {
    case 'nonorigin_cf':
      return "a network edge refused the connection before it reached Anthropic's server (HTTP 403 — Anthropic's CDN enforcing a region or network policy, or a Cloudflare gateway on this network) rather than this session; this often follows a VPN or network change"
    case 'nonorigin_other':
      return 'the connection was refused before it reached Anthropic (HTTP 403) — usually a proxy, VPN or firewall on this network'
  }
}

export function getNonOrigin403HintFromError(err: unknown): string | undefined {
  if (!axios.isAxiosError(err) || err.response?.status !== 403) {
    return undefined
  }
  const headers = err.response.headers
  const getHeader = (name: string): string | undefined => {
    const val = headers?.[name] ?? headers?.[name.toLowerCase()]
    return Array.isArray(val) ? String(val[0]) : val ? String(val) : undefined
  }
  const kind = classify403Origin(getHeader)
  return isNonOrigin403(kind) ? explainNonOrigin403(kind) : undefined
}

/**
 * Official `Bar` / `osr` (#1618): compute login credential expiration date and
 * `credential_expires_at` field from stored OAuth refreshTokenExpiresAt.
 */
const LOGIN_EXPIRATION_DRIFT_GRACE_MS = 3 * 24 * 60 * 60 * 1000

export function getLoginExpirationDate(): Date | null {
  if (getAPIProvider() !== 'firstParty' || !isAnthropicAuthEnabled()) {
    return null
  }
  const tokens = getClaudeAIOAuthTokens()
  if (
    !tokens?.refreshToken ||
    typeof tokens.refreshTokenExpiresAt !== 'number' ||
    !Number.isFinite(tokens.refreshTokenExpiresAt) ||
    tokens.refreshTokenExpiresAt <= 0
  ) {
    return null
  }
  if (
    typeof tokens.expiresAt === 'number' &&
    tokens.expiresAt >
      tokens.refreshTokenExpiresAt + LOGIN_EXPIRATION_DRIFT_GRACE_MS
  ) {
    return null
  }
  return new Date(tokens.refreshTokenExpiresAt)
}

export function getCredentialExpiresAtField(): {
  credential_expires_at?: string
} {
  const expires = getLoginExpirationDate()
  return expires === null
    ? {}
    : { credential_expires_at: expires.toISOString() }
}

/**
 * Official `e9e` (#1629): resolve `allowedProviders` from managed settings.
 */
export function getAllowedProviders(): string[] | undefined {
  const policy = getSettingsForSource('policySettings')
  return policy?.allowedProviders
}

export function validateAllowedProvider(
  provider: string = getAPIProvider(),
):
  | { valid: true }
  | { valid: false; reason: 'provider_not_allowed'; message: string } {
  const allowed = getAllowedProviders()
  if (allowed === undefined) {
    return { valid: true }
  }
  const normalized = provider === 'firstParty' ? 'anthropic' : provider
  if (allowed.includes(normalized)) {
    return { valid: true }
  }
  return {
    valid: false,
    reason: 'provider_not_allowed',
    message: `API provider "${normalized}" is not allowed by this machine's managed settings (allowedProviders: ${allowed.join(', ') || 'none'}).`,
  }
}

class GcpCredentialsTimeoutError extends Error {}

export async function getOauthOrgUuidFromTokenDetailed(
  accessToken: string,
): Promise<{ orgUuid: string | undefined; networkEdgeBlocked: boolean }> {
  let networkEdgeBlocked = false
  try {
    const url = `${getOauthConfig().BASE_API_URL}/api/oauth/org`
    const response = await axios.post<{ organization_uuid?: string }>(
      url,
      null,
      {
        headers: {
          'User-Agent': `claude-code/${MACRO.VERSION}`,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      },
    )
    const orgUuid = response.data?.organization_uuid
    if (typeof orgUuid === 'string' && orgUuid !== '') {
      return { orgUuid, networkEdgeBlocked: false }
    }
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isNonOriginCloudflare403Error } =
      require('../services/api/errors.js') as typeof import('../services/api/errors.js')
    if (isNonOriginCloudflare403Error(err)) {
      networkEdgeBlocked = true
    }
    logForDebugging(
      `Failed to look up the token's organization via /api/oauth/org: ${errorMessage(err)}`,
      { level: 'error' },
    )
  }
  try {
    const profile = await getOauthProfileFromOauthToken(accessToken)
    if (profile?.organization?.uuid) {
      return { orgUuid: profile.organization.uuid, networkEdgeBlocked: false }
    }
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isNonOriginCloudflare403Error } =
      require('../services/api/errors.js') as typeof import('../services/api/errors.js')
    if (isNonOriginCloudflare403Error(err)) {
      networkEdgeBlocked = true
    }
  }
  return { orgUuid: undefined, networkEdgeBlocked }
}

export async function getOauthOrgUuidFromToken(
  accessToken: string,
): Promise<string | undefined> {
  const { orgUuid } = await getOauthOrgUuidFromTokenDetailed(accessToken)
  return orgUuid
}

/**
 * Official `oj` (2.1.301 #851): true when an error (or its cause chain) is a
 * disk-full / quota-exceeded error (`ENOSPC` or `EDQUOT`).
 */
export function isDiskFullError(err: unknown): boolean {
  let cur: unknown = err
  for (let i = 0; i < 5 && cur !== null && typeof cur === 'object'; i++) {
    const code = getErrnoCode(cur)
    if (code === 'ENOSPC' || code === 'EDQUOT') {
      return true
    }
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}

/**
 * Official `YX` (2.1.301 #851): thrown when OAuth token refresh fails because
 * the disk or quota holding the config directory is full.
 */
export class OAuthRefreshDiskFullError extends Error {
  constructor() {
    super(
      'OAuth access token could not be refreshed: the disk that holds the Claude Code config directory, or the disk quota on it, is full; delete files you no longer need on that disk and try again',
    )
    this.name = 'OAuthRefreshDiskFullError'
  }
}

const PRO_MAX_STARTUP_CACHE_GRACE_HOURS = 1
const MAX_CLOCK_SKEW_MS = 600_000

/**
 * Official `Ejo` (#1274): extract `subscriptionTypeVerifiedAt` when the
 * stored subscription type came from a profile fetch.
 */
export function getSubscriptionTypeVerifiedAt(
  tokens: OAuthTokens | null | undefined,
): number | null | undefined {
  if (!tokens || tokens.subscriptionTypeSource !== 'profile') {
    return undefined
  }
  return typeof tokens.subscriptionTypeVerifiedAt === 'number'
    ? tokens.subscriptionTypeVerifiedAt
    : null
}

/**
 * Official `Gjo` / `u3r` (#1274): keep a profile-verified subscription tier
 * while within `graceTtlHours` (default 1 hour for Pro/Max startup skip).
 */
export function resolveGracefulSubscriptionType(
  tier: string | null,
  verifiedAtMs: number | null | undefined,
  graceTtlHours: number = PRO_MAX_STARTUP_CACHE_GRACE_HOURS,
  nowMs: number = Date.now(),
): string | null {
  if (tier === null || verifiedAtMs === undefined) {
    return tier
  }
  if (verifiedAtMs === null) {
    return null
  }
  return verifiedAtMs - nowMs <= MAX_CLOCK_SKEW_MS &&
    nowMs - verifiedAtMs <= graceTtlHours * 3_600_000
    ? tier
    : null
}

/**
 * Official #1274: Pro/Max accounts skip the two startup policy/settings
 * network fetches when their subscription tier is freshly verified (within
 * 1 hour) or stamped at sign-in.
 */
export function shouldSkipPolicyLimitsForProMaxStartup(
  tokens: OAuthTokens | null | undefined = getClaudeAIOAuthTokens(),
  graceTtlHours: number = PRO_MAX_STARTUP_CACHE_GRACE_HOURS,
  nowMs: number = Date.now(),
): boolean {
  if (!tokens?.accessToken) {
    return false
  }
  const effectiveTier = resolveGracefulSubscriptionType(
    tokens.subscriptionType ?? null,
    getSubscriptionTypeVerifiedAt(tokens),
    graceTtlHours,
    nowMs,
  )
  return effectiveTier === 'pro' || effectiveTier === 'max'
}
