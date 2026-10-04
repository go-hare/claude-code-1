/**
 * densable Design OAuth unique cluster @195240182–195248000 + `BO()` @182628406.
 * Gold names: `upe` / `xqt` / `Pqt` / `Nbe` / `uwt` / `Iqt` / `BO`.
 */
import { isHipaaPolicy } from '../../utils/midConversationSystem.js'
import { isRemotePolicyAllowed } from '../../services/policyLimits/index.js'
import { isRemoteEnvEnabled } from '../../utils/residualFinalEnvGates.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { env } from '../../utils/env.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { OAuthService } from '../../services/oauth/index.js'
import { getSecureStorage } from '../../utils/secureStorage/index.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../services/analytics/index.js'

/** densable `H_e` @175685147 */
export const DESIGN_OAUTH_SCOPES = [
  'user:design:read',
  'user:design:write',
] as const

export type DesignOauthSlot = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: string[]
  clientId: string
}

let designOauth: DesignOauthSlot | null = null

/** densable `Pqt` @195244333 */
export function designOAuthClientId(): string {
  return (
    process.env.CLAUDE_CODE_DESIGN_OAUTH_CLIENT_ID ??
    '00000000-0000-0000-0000-000000000000'
  )
}

/** densable `Nbe` @195244415 */
export function isDesignOAuthClientConfigured(): boolean {
  return !designOAuthClientId().startsWith('00000000-')
}

/** densable `uwt` @195245000 — `a.isSSH()||CLAUDE_CODE_REMOTE||Yn()`. */
export function isDesignLoginRemote(): boolean {
  return (
    env.isSSH() ||
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
    isRemoteEnvEnabled()
  )
}

/**
 * densable `BO()` @182628406
 * `if(!Jt("allow_design_sync"))return!1;if(It())return!1;return Gn()`
 * `Gn` = firstParty. `It` = HIPAA. `Jt` = policy `allow_design_sync`.
 */
export function isDesignLoginAvailable(): boolean {
  if (!isRemotePolicyAllowed('allow_design_sync')) return false
  if (isHipaaPolicy()) return false
  return getAPIProvider() === 'firstParty'
}

function isDesignOauthSlot(value: unknown): value is DesignOauthSlot {
  if (value === null || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return (
    typeof o.accessToken === 'string' &&
    typeof o.refreshToken === 'string' &&
    typeof o.expiresAt === 'number' &&
    Array.isArray(o.scopes) &&
    typeof o.clientId === 'string'
  )
}

/** densable `upe(r)` @195240182 — `Un().readAsync()?.designOauth` */
export async function readDesignOauth(
  _storageV5?: unknown,
): Promise<DesignOauthSlot | null> {
  try {
    if (designOauth) return designOauth
    const bag = await getSecureStorage().readAsync()
    const slot = (bag as { designOauth?: unknown } | null)?.designOauth
    if (!isDesignOauthSlot(slot)) return null
    designOauth = slot
    return slot
  } catch (err) {
    logForDebugging(
      `Failed to read design OAuth tokens: ${errorMessage(err)}`,
      {
        level: 'error',
      },
    )
    return null
  }
}

/** densable `xqt` persist — `Un().mutate` onto credentials bag. */
export async function writeDesignOauth(
  slot: DesignOauthSlot,
): Promise<{ success: boolean }> {
  designOauth = slot
  try {
    const store = getSecureStorage()
    const bag = ((await store.readAsync()) ?? {}) as Record<string, unknown>
    const result = store.update({ ...bag, designOauth: slot })
    return { success: result.success }
  } catch (err) {
    logForDebugging(
      `Failed to save design OAuth tokens: ${errorMessage(err)}`,
      { level: 'error' },
    )
    return { success: false }
  }
}

/**
 * densable `Fv` @178724750 — POST TOKEN_URL/revoke, continue on failure.
 */
export async function revokeOAuthRefreshToken(
  token: string,
  clientId: string,
): Promise<void> {
  try {
    const { getOauthConfig } = await import('../../constants/oauth.js')
    const axios = (await import('axios')).default
    await axios.post(
      `${getOauthConfig().TOKEN_URL}/revoke`,
      {
        token,
        token_type_hint: 'refresh_token',
        client_id: clientId,
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 5000 },
    )
    logEvent('tengu_feature_ok', {
      feature_name:
        'oauth_token_revoke' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } catch (err) {
    const status =
      err !== null &&
      typeof err === 'object' &&
      'response' in err &&
      err.response !== null &&
      typeof err.response === 'object' &&
      'status' in err.response
        ? Number((err.response as { status?: unknown }).status)
        : undefined
    logForDebugging(
      `OAuth token revoke failed (status=${status ?? 'network'}); continuing with local logout.`,
      { level: 'warn' },
    )
    logEvent('tengu_feature_sad', {
      feature_name:
        'oauth_token_revoke' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        `http_${status ?? 'network'}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
}

/** densable `gkn` @195244450 — require H_e scopes. */
export function grantDesignOauthSlot(
  tokens: {
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    scopes: string[]
  },
  clientId: string,
): { ok: true; slot: DesignOauthSlot } | { ok: false; message: string } {
  const missing = DESIGN_OAUTH_SCOPES.filter(s => !tokens.scopes.includes(s))
  if (missing.length > 0) {
    return {
      ok: false,
      message: `The authorization server did not grant the design scopes (missing: ${missing.join(', ')}) — the Claude Design app registration may be incomplete or out of date.`,
    }
  }
  if (!tokens.refreshToken || !tokens.expiresAt) {
    return {
      ok: false,
      message:
        'The token response was missing a refresh token or expiry — cannot store a usable design credential.',
    }
  }
  return {
    ok: true,
    slot: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes.filter(s =>
        (DESIGN_OAUTH_SCOPES as readonly string[]).includes(s),
      ),
      clientId,
    },
  }
}

export function resetDesignOauthForTests(): void {
  designOauth = null
}

export type DesignLoginIqtResult =
  | { ok: true; accessToken: string }
  | {
      ok: false
      reason:
        | 'interrupted'
        | 'unconfigured'
        | 'remote'
        | 'timed_out'
        | 'failed'
        | 'invalid'
        | 'save_failed'
      message: string
      cause?: string
    }

/** densable `I=300000` @195245228 */
const DESIGN_LOGIN_TIMEOUT_MS = 300_000

/**
 * densable `Iqt(r,o)` @195245230. After gates, `mM.startOAuthFlow` twin is
 * `OAuthService.startOAuthFlow` (loginWithClaudeAi + skipBrowserOpen).
 */
export async function runDesignOAuthFlow(
  signal?: AbortSignal,
  opts?: {
    onAuthUrl?: (url: string, manualUrl: string) => void
    onManualCode?: (set: (code: string, state: string) => void) => void
  },
): Promise<DesignLoginIqtResult> {
  if (signal?.aborted) {
    return {
      ok: false,
      reason: 'interrupted',
      message: 'Design login was interrupted.',
    }
  }
  if (!isDesignOAuthClientConfigured()) {
    return {
      ok: false,
      reason: 'unconfigured',
      message:
        'The Claude Design OAuth client is not configured in this build. Set CLAUDE_CODE_DESIGN_OAUTH_CLIENT_ID to the registered client id, or update to a build with the registered client.',
    }
  }
  if (isDesignLoginRemote() && !opts?.onManualCode) {
    return {
      ok: false,
      reason: 'remote',
      message:
        "This session is remote, so the browser can't reach the local sign-in listener. Run /design-login instead — it supports pasting the authorization code manually.",
    }
  }
  const clientId = designOAuthClientId()
  const flow = new OAuthService()
  let timedOut = false
  let cancelled = false
  const onAuthUrl = opts?.onAuthUrl
  opts?.onManualCode?.((code, state) => {
    flow.handleManualAuthCodeInput({ authorizationCode: code, state })
  })
  try {
    const tokens = await Promise.race([
      flow.startOAuthFlow(
        onAuthUrl
          ? async (manual, automatic) => {
              onAuthUrl(automatic ?? manual, manual)
            }
          : async () => {},
        {
          loginWithClaudeAi: true,
          skipProfileFetch: true,
          ...(onAuthUrl !== undefined ? { skipBrowserOpen: true } : {}),
        },
      ),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          timedOut = true
          cancelled = true
          reject(new Error('design login timed out'))
        }, DESIGN_LOGIN_TIMEOUT_MS)
        signal?.addEventListener(
          'abort',
          () => {
            cancelled = true
            clearTimeout(timer)
            reject(new Error('design login interrupted'))
          },
          { once: true },
        )
      }),
    ])
    if (signal?.aborted) {
      return {
        ok: false,
        reason: 'interrupted',
        message: 'Design login was interrupted.',
      }
    }
    const granted = grantDesignOauthSlot(tokens, clientId)
    if (!granted.ok) {
      if (tokens.refreshToken) {
        await revokeOAuthRefreshToken(tokens.refreshToken, clientId)
      }
      return { ok: false, reason: 'invalid', message: granted.message }
    }
    if (signal?.aborted) {
      await revokeOAuthRefreshToken(granted.slot.refreshToken, clientId)
      return {
        ok: false,
        reason: 'interrupted',
        message: 'Design login was interrupted.',
      }
    }
    const saved = await writeDesignOauth(granted.slot)
    if (!saved.success) {
      await revokeOAuthRefreshToken(granted.slot.refreshToken, clientId)
      return {
        ok: false,
        reason: 'save_failed',
        message:
          'Could not save the design credential to secure storage. Retry, or run /design-login.',
      }
    }
    return { ok: true, accessToken: tokens.accessToken }
  } catch (err) {
    if (timedOut) {
      return {
        ok: false,
        reason: 'timed_out',
        message:
          'The browser authorization timed out after 5 minutes. Retry, or run /design-login for the manual flow.',
      }
    }
    if (signal?.aborted || cancelled) {
      return {
        ok: false,
        reason: 'interrupted',
        message: 'Design login was interrupted.',
      }
    }
    return {
      ok: false,
      reason: 'failed',
      cause: errorMessage(err),
      message: `The browser authorization failed (${errorMessage(err)}). Run /design-login to retry with the manual flow.`,
    }
  } finally {
    flow.cleanup()
  }
}

/** densable `m(i)` @205301656 */
export function designLoginFailureMessage(
  result: Extract<DesignLoginIqtResult, { ok: false }>,
): string {
  switch (result.reason) {
    case 'interrupted':
      return 'The sign-in was cancelled.'
    case 'unconfigured':
      return 'The Claude Design sign-in is not configured in this build.'
    case 'remote':
      return 'This session runs on a remote machine, so the browser sign-in cannot finish here.'
    case 'timed_out':
      return 'The browser sign-in timed out after five minutes. Try again.'
    case 'failed':
      return `The browser sign-in failed (${result.cause ?? 'unknown error'}). Try again.`
    case 'invalid':
      return 'The sign-in did not return a usable credential. Try again.'
    case 'save_failed':
      return 'The credential could not be saved to secure storage. Try again.'
  }
}
