/**
 * densable 2.1.234 #35 / leftover 2.1.239 — Anthropic credentials-file stack.
 *
 * Gold: M$o / A5 / Ewn / Swn / D$o / lzs / oRr(DUr) / I$o(DJo) / uD / z_.
 * Reads ANTHROPIC_CONFIG_DIR / ~/.config/anthropic (or %APPDATA%\\Anthropic).
 * user_oauth access_token is local JSON. OIDC jwt-bearer is anthropicOidc.ts.
 */

import { readFileSync } from 'fs'
import { rename, unlink, writeFile } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import { getOauthConfig, OAUTH_BETA_HEADER } from 'src/constants/oauth.js'
import { logEvent } from 'src/services/analytics/index.js'
import { logForDebugging } from './debug.js'
import { isBareMode, isEnvTruthy } from './envUtils.js'

export type AnthropicProfileSource =
  | 'profile-explicit'
  | 'profile-implicit'
  | 'env-quad'
  | null

export type AnthropicProfileAuthType = 'user_oauth' | 'oidc_federation' | string

const ENV_QUAD_KEYS = [
  'ANTHROPIC_FEDERATION_RULE_ID',
  'ANTHROPIC_ORGANIZATION_ID',
] as const

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : ''
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    return null
  }
}

/** densable M$o — config root. Unix uses XDG/HOME (gold Windows block returned early). */
export function getAnthropicConfigDir(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = env.ANTHROPIC_CONFIG_DIR?.trim()
  if (explicit) return explicit
  if (process.platform === 'win32') {
    const appdata = env.APPDATA?.trim()
    if (appdata) return join(appdata, 'Anthropic')
    const profile = env.USERPROFILE?.trim()
    return profile ? join(profile, 'AppData', 'Roaming', 'Anthropic') : null
  }
  const xdg = env.XDG_CONFIG_HOME?.trim()
  if (xdg) return join(xdg, 'anthropic')
  const home = env.HOME?.trim()
  return home ? join(home, '.config', 'anthropic') : null
}

/** densable D$o */
export function getActiveAnthropicProfileName(
  configDir: string = getAnthropicConfigDir() ?? '',
): string {
  if (!configDir) return 'default'
  return readText(join(configDir, 'active_config'))?.trim() || 'default'
}

function profileCredentialsPath(
  configDir: string,
  profile: string,
  parsed?: { authentication?: { credentials_path?: unknown } },
): string {
  const custom = parsed?.authentication?.credentials_path
  if (typeof custom === 'string' && custom.length > 0) return custom
  return join(configDir, 'credentials', `${profile}.json`)
}

/** densable lzs — auth type only when credentials file exists for user_oauth. */
export function readAnthropicProfileAuthType(
  configDir: string,
  profile: string,
): AnthropicProfileAuthType | null {
  const raw = readText(join(configDir, 'configs', `${profile}.json`))
  if (raw === null) return null
  let parsed: {
    authentication?: { type?: unknown; credentials_path?: unknown }
  }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    return null
  }
  const type = parsed?.authentication?.type
  if (typeof type !== 'string' || type.length === 0) return null
  if (type === 'user_oauth') {
    if (readText(profileCredentialsPath(configDir, profile, parsed)) === null) {
      return null
    }
  }
  return type
}

function isProfileAuthType(type: string | null): boolean {
  return type === 'oidc_federation' || type === 'user_oauth'
}

function resolveAnthropicProfileSource(
  env: NodeJS.ProcessEnv,
): AnthropicProfileSource {
  const dir = getAnthropicConfigDir(env)
  const explicit = env.ANTHROPIC_PROFILE?.trim()
  if (explicit) {
    if (dir === null) return null
    const type = readAnthropicProfileAuthType(dir, explicit)
    return isProfileAuthType(type) ? 'profile-explicit' : null
  }
  if (ENV_QUAD_KEYS.every(k => env[k]?.trim())) return 'env-quad'
  if (dir !== null) {
    const type = readAnthropicProfileAuthType(
      dir,
      getActiveAnthropicProfileName(dir),
    )
    if (isProfileAuthType(type)) return 'profile-implicit'
  }
  return null
}

/** densable A5 / leftover 239 Szb — memoized like gold iu()/PJo. */
export const getAnthropicProfileSource = memoize(
  (env: NodeJS.ProcessEnv = process.env): AnthropicProfileSource =>
    resolveAnthropicProfileSource(env),
)

function resolveAnthropicProfileAuthKind(
  env: NodeJS.ProcessEnv,
): string | null {
  const source = getAnthropicProfileSource(env)
  if (source === null) return null
  if (source === 'env-quad') return 'oidc_federation'
  const dir = getAnthropicConfigDir(env)
  if (dir === null) return null
  const name =
    source === 'profile-explicit'
      ? (env.ANTHROPIC_PROFILE?.trim() ?? 'default')
      : getActiveAnthropicProfileName(dir)
  return readAnthropicProfileAuthType(dir, name)
}

/** densable uzs / leftover 239 wzb */
export const getAnthropicProfileAuthKind = memoize(
  (env: NodeJS.ProcessEnv = process.env): string | null =>
    resolveAnthropicProfileAuthKind(env),
)

/** densable I$o / leftover 239 DJo — drop A5/uzs/o1_ caches. */
export function clearAnthropicProfileCaches(): void {
  try {
    const { clearOidcFederationCaches } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./anthropicOidc.js') as typeof import('./anthropicOidc.js')
    clearOidcFederationCaches()
  } catch {
    // oidc module optional during isolated tests
  }
  getAnthropicProfileSource.cache?.clear?.()
  getAnthropicProfileAuthKind.cache?.clear?.()
  getAnthropicProfileAccountInfo.cache?.clear?.()
  warnImplicitProfileSkipped.cache?.clear?.()
  infoUsingProfileAuth.cache?.clear?.()
}

/** densable P$o / leftover 239 MJo */
export function hasAnthropicProfileAuth(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getAnthropicProfileSource(env) !== null
}

/** densable Swn */
export function isProfileImplicitUserOauth(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    getAnthropicProfileSource(env) === 'profile-implicit' &&
    getAnthropicProfileAuthKind(env) === 'user_oauth'
  )
}

function tail6(value: string): string {
  return value.length <= 6 ? value : `…${value.slice(-6)}`
}

/** densable Ewn — /login status line. No network. */
export function describeAnthropicProfile(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const source = getAnthropicProfileSource(env)
  if (source === 'env-quad') {
    const org = tail6(env.ANTHROPIC_ORGANIZATION_ID ?? '')
    const rule = tail6(env.ANTHROPIC_FEDERATION_RULE_ID ?? '')
    const ws = env.ANTHROPIC_WORKSPACE_ID?.trim()
    const wsBit = ws ? ` · ws ${ws.startsWith('wrkspc_') ? tail6(ws) : ws}` : ''
    return `env-quad · org ${org} · rule ${rule}${wsBit}`
  }
  if (source === 'profile-explicit' || source === 'profile-implicit') {
    const dir = getAnthropicConfigDir(env)
    const profile =
      dir === null
        ? 'default'
        : source === 'profile-explicit'
          ? (env.ANTHROPIC_PROFILE?.trim() ?? 'default')
          : getActiveAnthropicProfileName(dir)
    return `credentials-file · ${getAnthropicProfileAuthKind(env) ?? 'unknown'} · profile ${profile}`
  }
  return 'inactive'
}

/** densable o1_ / leftover 239 accountInfo */
export const getAnthropicProfileAccountInfo = memoize(
  (
    env: NodeJS.ProcessEnv = process.env,
  ): {
    organizationUuid?: unknown
    organizationName?: unknown
    accountEmail?: unknown
    workspaceName?: unknown
  } | null => {
    const source = getAnthropicProfileSource(env)
    if (source === null || source === 'env-quad') return null
    const dir = getAnthropicConfigDir(env)
    if (dir === null) return null
    const name =
      source === 'profile-explicit'
        ? (env.ANTHROPIC_PROFILE?.trim() ?? 'default')
        : getActiveAnthropicProfileName(dir)
    const raw = readText(profileCredentialsPath(dir, name))
    if (raw === null) return null
    try {
      const parsed = JSON.parse(raw) as {
        organization_uuid?: unknown
        organization_name?: unknown
        account_email?: unknown
        workspace_name?: unknown
      }
      return {
        organizationUuid: parsed.organization_uuid,
        organizationName: parsed.organization_name,
        accountEmail: parsed.account_email,
        workspaceName: parsed.workspace_name,
      }
    } catch {
      return null
    }
  },
)

/**
 * densable z_ / leftover 239 Cb — local credentials-file OAuth error.
 * oRr/DUr requires instanceof + statusCode === null.
 */
export class AnthropicProfileOauthError extends Error {
  statusCode: number | null
  body: unknown
  requestId: string | null
  constructor(
    message: string,
    statusCode: number | null = null,
    body: unknown = null,
    requestId: string | null = null,
  ) {
    super(message)
    this.name = 'AnthropicProfileOauthError'
    this.statusCode = statusCode
    this.body = body
    this.requestId = requestId
  }
}

/** densable oRr / leftover 239 DUr */
export function isAnthropicProfileOauthExpiredError(err: unknown): boolean {
  return (
    err instanceof AnthropicProfileOauthError &&
    err.statusCode === null &&
    err.message.includes('has expired and no refresh is available')
  )
}

/** densable Vmd */
const warnImplicitProfileSkipped = memoize((): void => {
  logForDebugging(
    'An Anthropic profile (~/.config/anthropic) is configured, but a claude.ai login exists — using the claude.ai login. Set ANTHROPIC_PROFILE=<name> to use the profile instead.',
    { level: 'warn' },
  )
  queueMicrotask(() => {
    logEvent('tengu_wif_implicit_profile_skipped_stored_login', {})
  })
})

/** densable qmd */
const infoUsingProfileAuth = memoize((): void => {
  const source = getAnthropicProfileSource() ?? 'profile'
  logForDebugging(
    `Using Anthropic profile auth (${source}); ${
      isProfileImplicitUserOauth()
        ? 'a claude.ai login (/login) would take precedence over it'
        : 'this takes precedence over any stored claude.ai login'
    }`,
    { level: 'info' },
  )
})

/**
 * densable uD — profile auth is the active API credential source.
 * Lets API key / OAuth env / Bedrock / Vertex / Mantle / bare win.
 * Implicit user_oauth + stored claude.ai login → Vmd skip.
 */
export function isProfileAuthActive(opts?: {
  storedClaudeAiLogin?: boolean
  env?: NodeJS.ProcessEnv
}): boolean {
  const env = opts?.env ?? process.env
  if (!hasAnthropicProfileAuth(env)) return false
  if (isBareMode()) return false
  if (env.ANTHROPIC_UNIX_SOCKET) return false
  if (env.ANTHROPIC_AUTH_TOKEN) return false
  if (env.ANTHROPIC_API_KEY) return false
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return false
  if (
    isEnvTruthy(env.CLAUDE_CODE_USE_BEDROCK) ||
    isEnvTruthy(env.CLAUDE_CODE_USE_VERTEX) ||
    isEnvTruthy(env.CLAUDE_CODE_USE_FOUNDRY) ||
    isEnvTruthy(env.CLAUDE_CODE_USE_ANTHROPIC_AWS) ||
    isEnvTruthy(env.CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD) ||
    isEnvTruthy(env.CLAUDE_CODE_USE_MANTLE)
  ) {
    return false
  }
  if (getAnthropicProfileSource(env) === 'profile-implicit') {
    if (opts?.storedClaudeAiLogin && isProfileImplicitUserOauth(env)) {
      warnImplicitProfileSkipped()
      return false
    }
  }
  infoUsingProfileAuth()
  return true
}

export type ProfileUserOauthToken = {
  token: string
  expiresAt: number | null
  credentialsPath: string
  needsRefresh?: boolean
}

export type AnthropicProfileWireOptions = {
  extraHeaders: Record<string, string>
  baseURL?: string
}

type ProfileFileConfig = {
  workspace_id?: unknown
  base_url?: unknown
  authentication?: {
    type?: unknown
    credentials_path?: unknown
    client_id?: unknown
  }
}

/** leftover 239 Hjo / HPu / GHt / Tft */
export const PROFILE_OAUTH_TOKEN_PATH = '/v1/oauth/token'
export const PROFILE_OAUTH_REFRESH_GRANT = 'refresh_token'
export const PROFILE_OAUTH_REFRESH_SKEW_SEC = 30
const DEFAULT_PROFILE_API_BASE = 'https://api.anthropic.com'

function nowUnixSec(): number {
  return Math.floor(Date.now() / 1000)
}

function loadProfileFileConfig(env: NodeJS.ProcessEnv = process.env): {
  dir: string
  name: string
  config: ProfileFileConfig | undefined
  credentialsPath: string
} | null {
  if (getAnthropicProfileAuthKind(env) !== 'user_oauth') return null
  const dir = getAnthropicConfigDir(env)
  if (dir === null) return null
  const source = getAnthropicProfileSource(env)
  const name =
    source === 'profile-explicit'
      ? (env.ANTHROPIC_PROFILE?.trim() ?? 'default')
      : getActiveAnthropicProfileName(dir)
  const configRaw = readText(join(dir, 'configs', `${name}.json`))
  let config: ProfileFileConfig | undefined
  if (configRaw !== null) {
    try {
      config = JSON.parse(configRaw) as ProfileFileConfig
    } catch {
      config = undefined
    }
  }
  return {
    dir,
    name,
    config,
    credentialsPath: profileCredentialsPath(dir, name, config),
  }
}

/** leftover 239 zqt — workspace header + optional profile base_url. */
export function getAnthropicProfileWireOptions(
  env: NodeJS.ProcessEnv = process.env,
): AnthropicProfileWireOptions | null {
  const loaded = loadProfileFileConfig(env)
  if (loaded === null) return null
  const extraHeaders: Record<string, string> = {}
  const workspace =
    typeof loaded.config?.workspace_id === 'string'
      ? loaded.config.workspace_id.trim()
      : ''
  if (workspace) {
    extraHeaders['anthropic-workspace-id'] = workspace
  }
  const rawBase =
    typeof loaded.config?.base_url === 'string'
      ? loaded.config.base_url.trim()
      : ''
  return {
    extraHeaders,
    ...(rawBase ? { baseURL: rawBase.replace(/\/+$/, '') } : {}),
  }
}

function profileRefreshBaseURL(config: ProfileFileConfig | undefined): string {
  const raw = typeof config?.base_url === 'string' ? config.base_url.trim() : ''
  return (
    raw ||
    getOauthConfig().BASE_API_URL ||
    DEFAULT_PROFILE_API_BASE
  ).replace(/\/+$/, '')
}

/**
 * Gold userOAuthProvider local read: credentials/<profile>.json.
 * Throws AnthropicProfileOauthError (oRr) when expired and no refresh.
 * When refresh is available, sets needsRefresh for the async POST path.
 */
export function readProfileUserOauthAccessToken(
  env: NodeJS.ProcessEnv = process.env,
): ProfileUserOauthToken | null {
  const loaded = loadProfileFileConfig(env)
  if (loaded === null) return null
  const { credentialsPath, config } = loaded
  const raw = readText(credentialsPath)
  if (raw === null) return null
  let parsed: {
    access_token?: unknown
    expires_at?: unknown
    refresh_token?: unknown
  }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch (err) {
    throw new AnthropicProfileOauthError(
      `Credentials file at ${credentialsPath} is not valid JSON: ${err}`,
    )
  }
  const token = parsed.access_token
  if (typeof token !== 'string' || token.length === 0) {
    throw new AnthropicProfileOauthError(
      `Credentials file at ${credentialsPath} must include 'access_token'`,
    )
  }
  const expiresAt =
    typeof parsed.expires_at === 'number' ? parsed.expires_at : null
  // leftover 239 GHt: still valid if now < expires_at - 30
  if (
    expiresAt === null ||
    nowUnixSec() < expiresAt - PROFILE_OAUTH_REFRESH_SKEW_SEC
  ) {
    return { token, expiresAt, credentialsPath }
  }
  const refresh =
    typeof parsed.refresh_token === 'string' && parsed.refresh_token.length > 0
      ? parsed.refresh_token
      : null
  const clientId =
    typeof config?.authentication?.client_id === 'string' &&
    config.authentication.client_id.length > 0
      ? config.authentication.client_id
      : null
  if (!clientId || !refresh) {
    throw new AnthropicProfileOauthError(
      `Access token at ${credentialsPath} has expired and no refresh is available (client_id ${clientId ? 'set' : 'empty'}, refresh_token ${refresh ? 'set' : 'empty'})`,
    )
  }
  return { token, expiresAt, credentialsPath, needsRefresh: true }
}

async function writeCredentialsAtomic(
  path: string,
  value: Record<string, unknown>,
): Promise<void> {
  const tmp = `${path}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
    await rename(tmp, path)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

let pendingProfileRefresh: Promise<ProfileUserOauthToken> | null = null

/**
 * leftover 239 userOAuthProvider refresh: POST `${baseURL}/v1/oauth/token`.
 */
export async function refreshProfileUserOauthAccessToken(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<ProfileUserOauthToken> {
  const loaded = loadProfileFileConfig(env)
  if (loaded === null) {
    throw new AnthropicProfileOauthError(
      'No user_oauth profile credentials to refresh',
    )
  }
  const { credentialsPath, config } = loaded
  const raw = readText(credentialsPath)
  if (raw === null) {
    throw new AnthropicProfileOauthError(
      `Credentials file at ${credentialsPath} is missing`,
    )
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    throw new AnthropicProfileOauthError(
      `Credentials file at ${credentialsPath} is not valid JSON: ${err}`,
    )
  }
  const refresh =
    typeof parsed.refresh_token === 'string' && parsed.refresh_token.length > 0
      ? parsed.refresh_token
      : null
  const clientId =
    typeof config?.authentication?.client_id === 'string' &&
    config.authentication.client_id.length > 0
      ? config.authentication.client_id
      : null
  if (!clientId || !refresh) {
    throw new AnthropicProfileOauthError(
      `Access token at ${credentialsPath} has expired and no refresh is available (client_id ${clientId ? 'set' : 'empty'}, refresh_token ${refresh ? 'set' : 'empty'})`,
    )
  }
  const baseURL = profileRefreshBaseURL(config)
  const url = `${baseURL}${PROFILE_OAUTH_TOKEN_PATH}`
  const version =
    typeof MACRO !== 'undefined' && typeof MACRO.VERSION === 'string'
      ? MACRO.VERSION
      : '0.0.0'
  let res: Response
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-beta': OAUTH_BETA_HEADER,
        'User-Agent': `anthropic-sdk-typescript/${version} userOAuthProvider`,
      },
      body: JSON.stringify({
        grant_type: PROFILE_OAUTH_REFRESH_GRANT,
        refresh_token: refresh,
        client_id: clientId,
      }),
    })
  } catch (err) {
    throw new AnthropicProfileOauthError(
      `User OAuth refresh failed to reach token endpoint: ${err}`,
    )
  }
  const requestId = res.headers.get('Request-Id')
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new AnthropicProfileOauthError(
      `User OAuth refresh failed (HTTP ${res.status}): ${body}`,
      res.status,
      body,
      requestId,
    )
  }
  let payload: {
    access_token?: unknown
    expires_in?: unknown
    refresh_token?: unknown
  }
  try {
    payload = (await res.json()) as typeof payload
  } catch (err) {
    throw new AnthropicProfileOauthError(
      `User OAuth refresh response missing or invalid expires_in: ${err}`,
      res.status,
      null,
      requestId,
    )
  }
  const expiresIn = Number(payload.expires_in)
  if (!Number.isFinite(expiresIn)) {
    throw new AnthropicProfileOauthError(
      `User OAuth refresh response missing or invalid expires_in: ${JSON.stringify(payload)}`,
      res.status,
      payload,
      requestId,
    )
  }
  const accessToken = payload.access_token
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new AnthropicProfileOauthError(
      `User OAuth refresh response missing access_token`,
      res.status,
      payload,
      requestId,
    )
  }
  const expiresAt = nowUnixSec() + expiresIn
  const nextRefresh =
    typeof payload.refresh_token === 'string' &&
    payload.refresh_token.length > 0
      ? payload.refresh_token
      : refresh
  await writeCredentialsAtomic(credentialsPath, {
    ...parsed,
    type: 'oauth_token',
    access_token: accessToken,
    expires_at: expiresAt,
    refresh_token: nextRefresh,
  })
  return { token: accessToken, expiresAt, credentialsPath }
}

/** leftover 239 token cache: refresh when within GHt of expiry. */
export async function resolveProfileUserOauthAccessToken(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<ProfileUserOauthToken | null> {
  const read = readProfileUserOauthAccessToken(env)
  if (read === null) return null
  if (!read.needsRefresh) return read
  if (pendingProfileRefresh) return pendingProfileRefresh
  pendingProfileRefresh = refreshProfileUserOauthAccessToken(
    env,
    fetchFn,
  ).finally(() => {
    pendingProfileRefresh = null
  })
  return pendingProfileRefresh
}
