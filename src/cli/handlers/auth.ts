/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handler intentionally exits */

import { createInterface, type Interface as ReadlineInterface } from 'readline'
import {
  clearAuthRelatedCaches,
  performLogout,
} from '../../commands/logout/logout.js'
import {
  formatCliActionSuccess,
  formatCliError,
  formatCliSuccess,
  formatCliWarning,
} from '../cliStatusMarkers.js'
import { formatRevokeUnconfirmedMessage } from './designOauth.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getSSLErrorHint } from '@ant/model-provider'
import { fetchAndStoreClaudeCodeFirstTokenDate } from '../../services/api/firstTokenDate.js'
import {
  createAndStoreApiKey,
  fetchAndStoreUserRoles,
  refreshOAuthToken,
  shouldUseClaudeAIAuth,
  storeOAuthAccountInfo,
} from '../../services/oauth/client.js'
import { getOauthProfileFromOauthToken } from '../../services/oauth/getOauthProfile.js'
import { OAuthService } from '../../services/oauth/index.js'
import type { OAuthTokens } from '../../services/oauth/types.js'
import {
  clearOAuthTokenCache,
  getAllowedProviders,
  getAnthropicApiKeyWithSource,
  getAuthTokenSource,
  getCredentialExpiresAtField,
  getNonOrigin403HintFromError,
  getOauthAccountInfo,
  getOAuthRefreshExitWaitMs,
  getSubscriptionType,
  isUsing3PServices,
  saveOAuthTokensIfNeeded,
  validateAllowedProvider,
  validateForceLoginOrg,
  waitForHeldOAuthRefresh,
} from '../../utils/auth.js'
import { oauthLoginOrgUUIDHint } from '../../utils/forceLoginOrg.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { isRunningOnHomespace } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { logOTelAuthEvent } from '../../utils/sessionSlots.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import {
  declareNoWifTokenRenewal,
  releaseAllHeldWifLocks,
} from '../../utils/wifCredentialRace.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  buildAccountProperties,
  buildAPIProviderProperties,
} from '../../utils/status.js'

/**
 * Shared post-token-acquisition logic. Saves tokens, fetches profile/roles,
 * and sets up the local auth state.
 */
export async function installOAuthTokens(
  tokens: OAuthTokens,
  options?: { skipApiKey?: boolean },
): Promise<void> {
  // Clear old state before saving new credentials
  await performLogout({ clearOnboarding: false })

  // Reuse pre-fetched profile if available, otherwise fetch fresh
  const profile =
    tokens.profile ?? (await getOauthProfileFromOauthToken(tokens.accessToken))
  if (profile) {
    storeOAuthAccountInfo({
      accountUuid: profile.account.uuid,
      emailAddress: profile.account.email,
      organizationUuid: profile.organization.uuid,
      displayName: profile.account.display_name || undefined,
      hasExtraUsageEnabled:
        profile.organization.has_extra_usage_enabled ?? undefined,
      billingType: profile.organization.billing_type ?? undefined,
      subscriptionCreatedAt:
        profile.organization.subscription_created_at ?? undefined,
      accountCreatedAt: profile.account.created_at,
    })
  } else if (tokens.tokenAccount) {
    // Fallback to token exchange account data when profile endpoint fails
    storeOAuthAccountInfo({
      accountUuid: tokens.tokenAccount.uuid,
      emailAddress: tokens.tokenAccount.emailAddress,
      organizationUuid: tokens.tokenAccount.organizationUuid,
    })
  }

  const storageResult = saveOAuthTokensIfNeeded(tokens)
  clearOAuthTokenCache()
  logOTelAuthEvent({ action: 'login', success: true, authMethod: 'oauth' })

  if (storageResult.warning) {
    logEvent('tengu_oauth_storage_warning', {
      warning:
        storageResult.warning as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  // Roles and first-token-date may fail for limited-scope tokens (e.g.
  // inference-only from setup-token). They're not required for core auth.
  await fetchAndStoreUserRoles(tokens.accessToken).catch(err =>
    logForDebugging(String(err), { level: 'error' }),
  )

  if (shouldUseClaudeAIAuth(tokens.scopes) || options?.skipApiKey) {
    await fetchAndStoreClaudeCodeFirstTokenDate().catch(err =>
      logForDebugging(String(err), { level: 'error' }),
    )
  } else {
    // API key creation is critical for Console users — let it throw.
    // densable 2.1.243 #5: skip when the user picked Console WIF (keyless).
    const apiKey = await createAndStoreApiKey(tokens.accessToken)
    if (!apiKey) {
      throw new Error(
        'Unable to create API key. The server accepted the request but did not return a key.',
      )
    }
  }

  await clearAuthRelatedCaches()
}

/**
 * Official 2.1.326 (#64) `V`: parse a manually pasted OAuth authorization code
 * (either `<code>#<state>` or bare `<code>`) from the TTY readline prompt.
 */
export function parsePastedOAuthCode(
  raw: string,
): { authorizationCode: string; state: string } | null {
  const cleaned = raw.trim()
  if (!cleaned) return null
  const hashIdx = cleaned.indexOf('#')
  if (hashIdx !== -1) {
    const authorizationCode = cleaned.slice(0, hashIdx).trim()
    const state = cleaned.slice(hashIdx + 1).trim()
    if (!authorizationCode) return null
    return { authorizationCode, state }
  }
  return { authorizationCode: cleaned, state: '' }
}

/**
 * Official 2.1.326 (#64) `V`: when `claude auth login` runs in an interactive
 * TTY, attach a `readline` prompt (`Paste code here if prompted > `) so pasted
 * authorization codes are echoed and editable before pressing Enter.
 */
export function attachOAuthManualCodePrompt(
  oauthService: Pick<OAuthService, 'handleManualAuthCodeInput'>,
  io: {
    input?: NodeJS.ReadableStream & { isTTY?: boolean }
    output?: NodeJS.WritableStream & { isTTY?: boolean }
  } = {},
): () => void {
  const input = io.input ?? process.stdin
  const output = io.output ?? process.stdout
  if (!input.isTTY || !output.isTTY) {
    return () => {}
  }

  let rl: ReadlineInterface | null = createInterface({
    input,
    output,
    prompt: 'Paste code here if prompted > ',
    terminal: true,
  })
  let closed = false

  const close = (): void => {
    if (closed) return
    closed = true
    rl?.close()
    rl = null
  }

  rl.on('line', line => {
    const parsed = parsePastedOAuthCode(line)
    if (!parsed) {
      rl?.prompt()
      return
    }
    oauthService.handleManualAuthCodeInput(parsed)
    close()
  })

  rl.on('SIGINT', () => {
    close()
  })

  rl.prompt()
  return close
}

export async function authLogin({
  email,
  sso,
  console: useConsole,
  claudeai,
}: {
  email?: string
  sso?: boolean
  console?: boolean
  claudeai?: boolean
}): Promise<void> {
  if (useConsole && claudeai) {
    process.stderr.write(
      `${formatCliError('--console and --claudeai cannot be used together.', 'Error: ')}\n`,
    )
    process.exit(1)
  }

  const settings = getInitialSettings()
  // densable A9t / ibS — forceLoginMethod hard pin; gateway cannot use CLI auth login without interactive /login
  const { resolveEffectiveForceLoginMethod } = await import(
    '../../utils/forceLoginMethod.js'
  )
  const forcedMethod = resolveEffectiveForceLoginMethod()
  if (forcedMethod === 'gateway') {
    process.stderr.write(
      'Managed settings on this machine configure a Cloud gateway sign-in; run interactive /login to authenticate.\n',
    )
    await waitForHeldOAuthRefresh(getOAuthRefreshExitWaitMs(true))
    process.exit(1)
  }
  const providerCheck = validateAllowedProvider('firstParty')
  if (!providerCheck.valid) {
    process.stderr.write(`${providerCheck.message}\n`)
    await waitForHeldOAuthRefresh(getOAuthRefreshExitWaitMs(true))
    process.exit(1)
  }
  // Without pin, --console selects Console; --claudeai (or no flag) selects claude.ai.
  const loginWithClaudeAi = forcedMethod
    ? forcedMethod === 'claudeai'
    : !useConsole
  // densable: suppress forceLoginOrgUUID when effective method mismatches settings pin
  const methodMismatch =
    settings.forceLoginMethod !== undefined &&
    loginWithClaudeAi !== (settings.forceLoginMethod === 'claudeai')
  const orgUUID = oauthLoginOrgUUIDHint(
    settings.forceLoginOrgUUID,
    methodMismatch,
  )

  // Fast path: if a refresh token is provided via env var, skip the browser
  // OAuth flow and exchange it directly for tokens.
  const envRefreshToken = process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN
  if (envRefreshToken) {
    const envScopes = process.env.CLAUDE_CODE_OAUTH_SCOPES
    if (!envScopes) {
      process.stderr.write(
        'CLAUDE_CODE_OAUTH_SCOPES is required when using CLAUDE_CODE_OAUTH_REFRESH_TOKEN.\n' +
          'Set it to the space-separated scopes the refresh token was issued with\n' +
          '(e.g. "user:inference" or "user:profile user:inference user:sessions:claude_code user:mcp_servers").\n',
      )
      process.exit(1)
    }

    const scopes = envScopes.split(/\s+/).filter(Boolean)

    try {
      logEvent('tengu_login_from_refresh_token', {})

      const tokens = await refreshOAuthToken(envRefreshToken, { scopes })
      await installOAuthTokens(tokens)

      const orgResult = await validateForceLoginOrg()
      if (!orgResult.valid) {
        process.stderr.write(
          (orgResult as { valid: false; message: string }).message + '\n',
        )
        process.exit(1)
      }

      // Mark onboarding complete — interactive paths handle this via
      // the Onboarding component, but the env var path skips it.
      saveGlobalConfig(current => {
        if (current.hasCompletedOnboarding) return current
        return { ...current, hasCompletedOnboarding: true }
      })

      logEvent('tengu_oauth_success', {
        loginWithClaudeAi: shouldUseClaudeAIAuth(tokens.scopes),
      })
      process.stdout.write(`${formatCliSuccess('Login successful.', '')}\n`)
      process.exit(0)
    } catch (err) {
      logOTelAuthEvent({
        action: 'login',
        success: false,
        authMethod: 'oauth',
        error: err,
      })
      logError(err)
      const sslHint = getSSLErrorHint(err)
      const nonOriginHint = getNonOrigin403HintFromError(err)
      const extraHint = nonOriginHint ?? sslHint
      process.stderr.write(
        `${formatCliError(`Login failed: ${errorMessage(err)}`, '')}\n${extraHint ? extraHint + '\n' : ''}`,
      )
      await waitForHeldOAuthRefresh(getOAuthRefreshExitWaitMs(true))
      process.exit(1)
    }
  }

  const resolvedLoginMethod = sso ? 'sso' : undefined

  const oauthService = new OAuthService()
  let closeManualCodePrompt: (() => void) | undefined

  try {
    logEvent('tengu_oauth_flow_start', { loginWithClaudeAi })

    const result = await oauthService.startOAuthFlow(
      async url => {
        process.stdout.write('Opening browser to sign in…\n')
        process.stdout.write(`If the browser didn't open, visit: ${url}\n`)
        closeManualCodePrompt?.()
        closeManualCodePrompt = attachOAuthManualCodePrompt(oauthService)
      },
      {
        loginWithClaudeAi,
        loginHint: email,
        loginMethod: resolvedLoginMethod,
        orgUUID,
      },
    )

    closeManualCodePrompt?.()
    closeManualCodePrompt = undefined

    await installOAuthTokens(result)

    const orgResult = await validateForceLoginOrg()
    if (!orgResult.valid) {
      process.stderr.write(
        (orgResult as { valid: false; message: string }).message + '\n',
      )
      process.exit(1)
    }

    logEvent('tengu_oauth_success', { loginWithClaudeAi })

    process.stdout.write(`${formatCliSuccess('Login successful.', '')}\n`)
    process.exit(0)
  } catch (err) {
    logOTelAuthEvent({
      action: 'login',
      success: false,
      authMethod: 'oauth',
      error: err,
    })
    logError(err)
    const sslHint = getSSLErrorHint(err)
    const nonOriginHint = getNonOrigin403HintFromError(err)
    const extraHint = nonOriginHint ?? sslHint
    process.stderr.write(
      `${formatCliError(`Login failed: ${errorMessage(err)}`, '')}\n${extraHint ? extraHint + '\n' : ''}`,
    )
    await waitForHeldOAuthRefresh(getOAuthRefreshExitWaitMs(true))
    process.exit(1)
  } finally {
    closeManualCodePrompt?.()
    oauthService.cleanup()
  }
}

export async function authStatus(opts: {
  json?: boolean
  text?: boolean
}): Promise<void> {
  // Official 2.1.325 #2289 (`D9s`): short status commands read valid cached
  // profile tokens without starting a refresh lock that could linger on exit.
  declareNoWifTokenRenewal()
  const { source: authTokenSource, hasToken } = getAuthTokenSource()
  const { source: apiKeySource } = getAnthropicApiKeyWithSource()
  const hasApiKeyEnvVar =
    !!process.env.ANTHROPIC_API_KEY && !isRunningOnHomespace()
  const oauthAccount = getOauthAccountInfo()
  const subscriptionType = getSubscriptionType()
  const using3P = isUsing3PServices()
  const loggedIn =
    hasToken || apiKeySource !== 'none' || hasApiKeyEnvVar || using3P

  // Determine auth method
  let authMethod: string = 'none'
  if (using3P) {
    authMethod = 'third_party'
  } else if (authTokenSource === 'claude.ai') {
    authMethod = 'claude.ai'
  } else if (authTokenSource === 'apiKeyHelper') {
    authMethod = 'api_key_helper'
  } else if (authTokenSource !== 'none') {
    authMethod = 'oauth_token'
  } else if (apiKeySource === 'ANTHROPIC_API_KEY' || hasApiKeyEnvVar) {
    authMethod = 'api_key'
  } else if (apiKeySource === '/login managed key') {
    authMethod = 'claude.ai'
  }

  if (opts.text) {
    const properties = [
      ...buildAccountProperties(),
      ...buildAPIProviderProperties(),
    ]
    let hasAuthProperty = false
    for (const prop of properties) {
      const value =
        typeof prop.value === 'string'
          ? prop.value
          : Array.isArray(prop.value)
            ? prop.value.join(', ')
            : null
      if (value === null || value === 'none') {
        continue
      }
      hasAuthProperty = true
      if (prop.label) {
        process.stdout.write(`${prop.label}: ${value}\n`)
      } else {
        process.stdout.write(`${value}\n`)
      }
    }
    if (!hasAuthProperty && hasApiKeyEnvVar) {
      process.stdout.write('API key: ANTHROPIC_API_KEY\n')
    }
    if (!loggedIn) {
      process.stdout.write(
        'Not logged in. Run claude auth login to authenticate.\n',
      )
    }
  } else {
    const apiProvider = getAPIProvider()
    const resolvedApiKeySource =
      apiKeySource !== 'none'
        ? apiKeySource
        : hasApiKeyEnvVar
          ? 'ANTHROPIC_API_KEY'
          : null
    const output: Record<string, string | boolean | string[] | null> = {
      loggedIn,
      authMethod,
      apiProvider,
      loginExpiresAt:
        getCredentialExpiresAtField().credential_expires_at ?? null,
    }
    const allowedProviders = getAllowedProviders()
    if (allowedProviders !== undefined) {
      output.allowedProviders = [...allowedProviders]
    }
    if (resolvedApiKeySource) {
      output.apiKeySource = resolvedApiKeySource
    }
    if (authMethod === 'claude.ai') {
      output.email = oauthAccount?.emailAddress ?? null
      output.orgId = oauthAccount?.organizationUuid ?? null
      output.orgName = oauthAccount?.organizationName ?? null
      output.subscriptionType = subscriptionType ?? null
    }

    process.stdout.write(jsonStringify(output, null, 2) + '\n')
  }
  await Promise.all([
    waitForHeldOAuthRefresh(getOAuthRefreshExitWaitMs(true)),
    releaseAllHeldWifLocks(),
  ])
  process.exit(loggedIn ? 0 : 1)
}

export async function authLogout(): Promise<void> {
  logOTelAuthEvent({ action: 'logout', success: true, authMethod: 'oauth' })
  // Official 2.1.326 #238: performLogout revokes OAuth refresh tokens via
  // revokeOAuthRefreshTokenWithRetry and returns 'revoke_unconfirmed' if server
  // revocation could not be confirmed.
  let outcome: Awaited<ReturnType<typeof performLogout>>
  try {
    outcome = await performLogout({ clearOnboarding: false })
  } catch (err) {
    logError(err)
    process.stderr.write(
      `${formatCliError(`Couldn't log out: ${errorMessage(err)}`, '')}\n`,
    )
    await releaseAllHeldWifLocks()
    process.exit(1)
  }
  if (outcome === 'revoke_unconfirmed') {
    const unconfirmedMessage = await formatRevokeUnconfirmedMessage()
    process.stdout.write(`${formatCliWarning(unconfirmedMessage, '')}\n`)
  } else {
    process.stdout.write(
      `${formatCliActionSuccess('Successfully logged out from your Anthropic account.', '')}\n`,
    )
  }
  await Promise.all([
    waitForHeldOAuthRefresh(getOAuthRefreshExitWaitMs(true)),
    releaseAllHeldWifLocks(),
  ])
  process.exit(0)
}
