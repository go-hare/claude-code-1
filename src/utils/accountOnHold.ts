/**
 * densable 2.1.243 account-on-hold helpers (`he` / `P` / `v` / `j` / `fe`).
 * Gx imports `he` as `wx`.
 */
import { logEvent } from 'src/services/analytics/index.js'
import { logForDebugging } from './debug.js'
import { errorMessage } from './errors.js'
import { getSecureStorage } from './secureStorage/index.js'

export const ACCOUNT_ON_HOLD_GATE = 'tengu_lively_beaver'
export const ACCOUNT_ON_HOLD = 'account_on_hold'
export const ACCOUNT_ON_HOLD_FALLBACK_URL = 'https://claude.ai/restricted'
export const ACCOUNT_ON_HOLD_USE_PREFIX =
  "Your account is on hold and can't use Claude Code. View details or appeal: "
const ACCOUNT_ON_HOLD_URL_MAX = 2048
// densable `I` — official character class includes C0 controls.
// biome-ignore lint/suspicious/noControlCharactersInRegex: official he/I regex
const LOOSE_URL_RE = /^https?:\/\/[^\s"'<>\\\u2026\x00-\x1f]+$/
const STRICT_HREF_RE =
  /^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9/._~%-]*(?:\?[A-Za-z0-9._~%=&-]*)?(?<![.?])$/

export type AccountOnHoldGateReader = (
  gate: string,
  fallback: boolean,
) => boolean

class AccountOnHoldGateSlot {
  reader: AccountOnHoldGateReader | null = null
  register(
    next: AccountOnHoldGateReader | null,
  ): AccountOnHoldGateReader | null {
    const prev = this.reader
    this.reader = next
    return prev
  }
}

const gateSlot = new AccountOnHoldGateSlot()

/** densable `de` — swap the `tengu_lively_beaver` reader; returns the previous. */
export function registerAccountOnHoldGateReader(
  reader: AccountOnHoldGateReader | null,
): AccountOnHoldGateReader | null {
  return gateSlot.register(reader)
}

/** densable `v`. */
export function isAccountOnHoldGateEnabled(): boolean {
  const reader = gateSlot.reader
  if (!reader) return false
  try {
    return reader(ACCOUNT_ON_HOLD_GATE, false) === true
  } catch {
    return false
  }
}

/** densable `I`. */
export function isLooseHttpUrl(text: string): boolean {
  return LOOSE_URL_RE.test(text)
}

/** densable `P` — allowlisted https appeal URL, else the restricted fallback. */
export function sanitizeAccountOnHoldUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > ACCOUNT_ON_HOLD_URL_MAX) {
    return ACCOUNT_ON_HOLD_FALLBACK_URL
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return ACCOUNT_ON_HOLD_FALLBACK_URL
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash
  ) {
    return ACCOUNT_ON_HOLD_FALLBACK_URL
  }
  const host = parsed.hostname
  const allowed =
    host === 'claude.ai' ||
    host.endsWith('.claude.ai') ||
    host === 'anthropic.com' ||
    host.endsWith('.anthropic.com')
  if (
    allowed &&
    parsed.href.length <= ACCOUNT_ON_HOLD_URL_MAX &&
    STRICT_HREF_RE.test(parsed.href)
  ) {
    return parsed.href
  }
  return ACCOUNT_ON_HOLD_FALLBACK_URL
}

/** densable `j`. */
export function formatAccountOnHoldUseMessage(url: string): string {
  return `${ACCOUNT_ON_HOLD_USE_PREFIX}${url}`
}

/** densable `fe`. */
export function formatAccountOnHoldSignInMessage(url: string): string {
  return `Your account is on hold and can't sign in to Claude Code. View details or appeal: ${url}`
}

/**
 * densable 2.1.243 `he` — Gx `wx`.
 * Prefix + already-sanitized allowlisted URL, and only when the gate is on.
 */
export function isAccountOnHoldAppealLine(text: string): boolean {
  if (
    !isAccountOnHoldGateEnabled() ||
    !text.startsWith(ACCOUNT_ON_HOLD_USE_PREFIX)
  ) {
    return false
  }
  const url = text.slice(ACCOUNT_ON_HOLD_USE_PREFIX.length)
  return isLooseHttpUrl(url) && sanitizeAccountOnHoldUrl(url) === url
}

export class OAuthAccountOnHoldError extends Error {
  readonly url: string
  constructor(url: string) {
    super('OAuth account is on hold')
    this.url = url
    this.name = 'OAuthAccountOnHoldError'
  }
}

/** densable 2.1.246 `Z9` — fk throws when `_F`/`dl(credentials)` is dead. */
export class OAuthRefreshDeadError extends Error {
  constructor() {
    super(
      'OAuth refresh token is no longer valid; run /login to re-authenticate',
    )
    this.name = 'OAuthRefreshDeadError'
  }
}

type AxiosLikeError = {
  isAxiosError: true
  response?: {
    status?: number
    data?: unknown
  }
}

function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { isAxiosError?: unknown }).isAxiosError === true
  )
}

/**
 * densable 2.1.243 `W` / import `_Tc as Yl`.
 * Gate + `{error ∈ {invalid_grant,access_denied}, error_description: account_on_hold}`
 * then `P(error_uri)`.
 */
export function parseAccountOnHoldBody(body: unknown): { url: string } | null {
  if (!isAccountOnHoldGateEnabled()) return null
  let parsed: unknown = body
  if (typeof parsed === 'string') {
    if (!parsed.includes(ACCOUNT_ON_HOLD)) return null
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return null
    }
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const rec = parsed as Record<string, unknown>
  const error = rec.error
  const desc = rec.error_description
  if (
    (error !== 'invalid_grant' && error !== 'access_denied') ||
    desc !== ACCOUNT_ON_HOLD
  ) {
    return null
  }
  return { url: sanitizeAccountOnHoldUrl(rec.error_uri) }
}

/**
 * densable `Ee` / import `dUc as Upe`.
 * Profile OAuth error 400/401/403 → `W(body)`.
 */
export function getProfileAccountOnHold(
  error: unknown,
): { url: string } | null {
  // Lazy to keep this module loadable from auth without a profile cycle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AnthropicProfileOauthError } =
    require('./anthropicProfile.js') as typeof import('./anthropicProfile.js')
  if (!(error instanceof AnthropicProfileOauthError)) return null
  if (
    error.statusCode !== 400 &&
    error.statusCode !== 401 &&
    error.statusCode !== 403
  ) {
    return null
  }
  return parseAccountOnHoldBody(error.body)
}

/**
 * densable `Xl` — axios 400/401/403 whose body is `Yl`/`W`.
 */
export function isOAuthRefreshAccountOnHoldError(error: unknown): boolean {
  if (!isAxiosLikeError(error) || !error.response) return false
  const status = error.response.status
  if (status !== 400 && status !== 401 && status !== 403) return false
  return parseAccountOnHoldBody(error.response.data) !== null
}

/**
 * densable `uT` — `Yl(response.data)?.url ?? aT` (`aT` = `u` restricted URL).
 */
export function getOAuthRefreshAccountOnHoldUrl(error: unknown): string {
  return (
    (isAxiosLikeError(error)
      ? parseAccountOnHoldBody(error.response?.data)
      : null
    )?.url ?? ACCOUNT_ON_HOLD_FALLBACK_URL
  )
}

/** densable `Hs` — refreshToken → sanitized appeal URL. */
const oauthAccountOnHoldByRefreshToken = new Map<string, string>()

/** densable `$s` — refresh tokens marked dead after invalid_grant. */
const oauthDeadInvalidGrantRefreshTokens = new Set<string>()

/** densable `oi` / `K0=32` — refresh tokens that already tried scope expansion. */
const oauthScopeExpansionRefreshTokens = new Set<string>()
const OAUTH_SCOPE_EXPANSION_ATTEMPTS_MAX = 32

/** densable `Hs.set`. */
export function rememberOAuthAccountOnHold(
  refreshToken: string,
  url: string,
): void {
  oauthAccountOnHoldByRefreshToken.set(refreshToken, url)
}

/** densable `Hs.has`. */
export function isOAuthRefreshTokenOnHold(refreshToken: string): boolean {
  return oauthAccountOnHoldByRefreshToken.has(refreshToken)
}

/**
 * densable `V0` / `f$e` / `getOAuthAccountOnHold`.
 * `x()?.refreshToken` then `Hs.get`; miss → null.
 */
export function getOAuthAccountOnHold(): { url: string } | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getClaudeAIOAuthTokens } =
    require('./auth.js') as typeof import('./auth.js')
  const refreshToken = getClaudeAIOAuthTokens()?.refreshToken
  if (!refreshToken) return null
  const url = oauthAccountOnHoldByRefreshToken.get(refreshToken)
  return url === undefined ? null : { url }
}

/**
 * densable `G0` — `oi.has`. Official caller is `jwo` (plugins_scope_expansion).
 */
export function isOAuthScopeExpansionAttempted(refreshToken: string): boolean {
  return oauthScopeExpansionRefreshTokens.has(refreshToken)
}

/**
 * densable `$0` — cap `oi` at `K0=32` (FIFO), then add.
 */
export function recordOAuthScopeExpansionAttempt(refreshToken: string): void {
  if (
    oauthScopeExpansionRefreshTokens.size >= OAUTH_SCOPE_EXPANSION_ATTEMPTS_MAX
  ) {
    const oldest = oauthScopeExpansionRefreshTokens.values().next().value
    if (oldest !== undefined) oauthScopeExpansionRefreshTokens.delete(oldest)
  }
  oauthScopeExpansionRefreshTokens.add(refreshToken)
}

/**
 * densable `z0` — `$s` + `oi` + `Hs`. Official `jwo` is the only `$0`/`G0`
 * caller (plugins skill-search scope expansion); local has no `jwo`.
 */
export function clearOAuthAccountOnHoldCaches(): void {
  oauthDeadInvalidGrantRefreshTokens.clear()
  oauthScopeExpansionRefreshTokens.clear()
  oauthAccountOnHoldByRefreshToken.clear()
}

/**
 * densable `ql` — OAuth error body → `{code, description}`.
 * `code` is `error` string, or `error.type` when `error` is an object.
 */
export function parseOAuthErrorBody(body: unknown): {
  code: unknown
  description: unknown
} {
  if (!body || typeof body !== 'object') {
    return { code: undefined, description: undefined }
  }
  const rec = body as Record<string, unknown>
  const error = rec.error
  let code: unknown
  if (typeof error === 'string') {
    code = error
  } else if (error && typeof error === 'object') {
    code = (error as { type?: unknown }).type
  }
  return { code, description: rec.error_description }
}

/**
 * densable `Ms` — axios 400/401 `invalid_grant` that is not `Yl`/`W` on-hold.
 */
export function isOAuthRefreshDeadInvalidGrant(error: unknown): boolean {
  if (!isAxiosLikeError(error) || !error.response) return false
  const status = error.response.status
  if (status !== 400 && status !== 401) return false
  return (
    parseOAuthErrorBody(error.response.data).code === 'invalid_grant' &&
    parseAccountOnHoldBody(error.response.data) === null
  )
}

/** densable `$s.has`. */
export function isOAuthRefreshTokenKnownDead(refreshToken: string): boolean {
  return oauthDeadInvalidGrantRefreshTokens.has(refreshToken)
}

/**
 * densable `zk` — empty refresh, or `$s.has`. No tokens: `Ce()` host-managed →
 * false, else `undefined` (caller falls through to `Wk`).
 */
export function isOAuthRefreshTokenDead(
  tokens: { refreshToken?: string | null } | null | undefined,
): boolean | undefined {
  if (tokens) {
    const refreshToken = tokens.refreshToken
    return (
      refreshToken === '' ||
      (!!refreshToken && oauthDeadInvalidGrantRefreshTokens.has(refreshToken))
    )
  }
  if (process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST) return false
  return undefined
}

/** densable `Wk`. */
export function isStoredOAuthRefreshTokenCleared(
  data: { claudeAiOauth?: { refreshToken?: string } } | null | undefined,
): boolean {
  return data?.claudeAiOauth?.refreshToken === ''
}

/**
 * densable `Vk` mutate callback — only rewrite when stored refresh === `e`.
 */
export function applyDeadOAuthRefreshTokenMutate<
  T extends { claudeAiOauth?: Record<string, unknown> | undefined },
>(data: T, refreshToken: string): T {
  const oauth = data.claudeAiOauth
  if (!oauth || oauth.refreshToken !== refreshToken) return data
  return {
    ...data,
    claudeAiOauth: {
      ...oauth,
      refreshToken: '',
      accessToken: '',
      expiresAt: 0,
    },
  }
}

/**
 * densable `Vk` — mark refresh dead in `$s`, then clear matching disk tokens.
 * Official `t` is `oe().mutate` credentials; local `update` has no such slot.
 */
export async function markDeadOAuthRefreshToken(
  refreshToken: string,
): Promise<void> {
  oauthDeadInvalidGrantRefreshTokens.add(refreshToken)
  logEvent('tengu_oauth_refresh_token_marked_dead_invalid_grant', {})
  try {
    const storage = getSecureStorage()
    const current = storage.read() || {}
    const next = applyDeadOAuthRefreshTokenMutate(current, refreshToken)
    if (next === current) {
      return
    }
    const result = storage.update(next)
    if (result.success) {
      logEvent('tengu_oauth_refresh_token_cleared_on_disk', {})
    } else {
      logForDebugging('OAuth dead-token disk clear: backend write failed', {
        level: 'error',
      })
    }
  } catch (error) {
    logForDebugging(
      `OAuth dead-token disk clear failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}
