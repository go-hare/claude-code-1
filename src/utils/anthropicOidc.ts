/**
 * leftover 2.1.239 i4b / VPu / TQt / By_ / kQt — OIDC federation jwt-bearer.
 *
 * Gold: POST `${baseURL}/v1/oauth/token` with
 * grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer and betas
 * oauth-2025-04-20,oidc-federation-2026-04-01.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { OAUTH_BETA_HEADER } from 'src/constants/oauth.js'
import { logForDebugging } from './debug.js'
import {
  AnthropicProfileOauthError,
  getActiveAnthropicProfileName,
  getAnthropicConfigDir,
  getAnthropicProfileSource,
  isAnthropicProfileOauthExpiredError,
} from './anthropicProfile.js'
import { getProxyFetchOptions } from './proxy.js'

export const JWT_BEARER_GRANT =
  'urn:ietf:params:oauth:grant-type:jwt-bearer' as const
export const OIDC_FEDERATION_BETA = 'oidc-federation-2026-04-01' as const
export const OIDC_TOKEN_PATH = '/v1/oauth/token' as const
export const OIDC_IDENTITY_TOKEN_MAX_BYTES = 16_384
/** leftover 239 DPu — fresh if more than this many seconds remain. */
export const OIDC_CACHE_FRESH_SEC = 120
/** leftover 239 GHt — background refresh band. */
export const OIDC_CACHE_BACKGROUND_SEC = 30
/** leftover 239 MPu — advisory refresh error cooldown. */
export const OIDC_ADVISORY_ERROR_COOLDOWN_SEC = 5
/** leftover 239 $Ur AbortSignal.timeout */
export const OIDC_TOKEN_FETCH_TIMEOUT_MS = 10_000
/** leftover 239 Fjo */
const CREDENTIALS_FILE_VERSION = '1.0'
/** leftover 239 enr */
const ACCOUNT_ON_HOLD = 'account_on_hold'
/** leftover 239 Pqs */
const ERROR_BODY_CAP = 2000
const TOKEN_BODY_MAX = 1_048_576
const DEFAULT_API_BASE = 'https://api.anthropic.com'
const SAFE_ERROR_KEYS = new Set(['error', 'error_description', 'error_uri'])

export type OidcFederationConfig = {
  organization_id?: string
  workspace_id?: string
  base_url?: string
  authentication: {
    type: 'oidc_federation'
    federation_rule_id?: string
    service_account_id?: string
    identity_token?: { source: string; path?: string }
    scope?: string
    credentials_path?: string
  }
}

export type OidcAccessToken = {
  token: string
  expiresAt: number | null
}

export type OidcTokenProviderOpts = {
  forceRefresh?: boolean
}

type OidcTokenProvider = (
  opts?: OidcTokenProviderOpts,
) => Promise<OidcAccessToken>

type FetchLike = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

function nowUnixSec(): number {
  return Math.floor(Date.now() / 1000)
}

function envTrim(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env[key]?.trim() || undefined
}

function sdkVersion(): string {
  return typeof MACRO !== 'undefined' && typeof MACRO.VERSION === 'string'
    ? MACRO.VERSION
    : '0.0.0'
}

/** leftover 239 Pjo */
export function assertHttpsTokenBaseURL(baseURL: string | undefined): void {
  if (!baseURL) return
  let parsed: URL
  try {
    parsed = new URL(baseURL)
  } catch (err) {
    throw new AnthropicProfileOauthError(
      `Invalid token endpoint base URL "${baseURL}": ${err}`,
    )
  }
  if (parsed.protocol === 'https:') return
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    parsed.protocol === 'http:' &&
    (host === 'localhost' || host === '127.0.0.1' || host === '::1')
  ) {
    return
  }
  throw new AnthropicProfileOauthError(
    `Refusing to send credential over non-https token endpoint "${baseURL}"`,
  )
}

/** leftover 239 hbe */
export function redactTokenErrorBody(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    try {
      return JSON.stringify(redactTokenErrorBody(JSON.parse(value)))
    } catch {
      if (value.length <= ERROR_BODY_CAP) return value
      return `${value.slice(0, ERROR_BODY_CAP)}... <${value.length - ERROR_BODY_CAP} more chars>`
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SAFE_ERROR_KEYS.has(k)) out[k] = v
    }
    return out
  }
  return null
}

/**
 * leftover 239 PUr / sOt — account_on_hold body (HUr gate omitted: leftover
 * CLI has the parser; skip kew invalidate when the body matches).
 */
export function parseOidcAccountOnHold(body: unknown): { url?: string } | null {
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
  return {
    ...(typeof rec.error_uri === 'string' ? { url: rec.error_uri } : {}),
  }
}

/** leftover 239 sOt */
export function getOidcAccountOnHold(err: unknown): { url?: string } | null {
  if (!(err instanceof AnthropicProfileOauthError)) return null
  if (
    err.statusCode !== 400 &&
    err.statusCode !== 401 &&
    err.statusCode !== 403
  ) {
    return null
  }
  return parseOidcAccountOnHold(err.body)
}

async function readResponseTextCapped(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (n + value.length > TOKEN_BODY_MAX) {
      const room = TOKEN_BODY_MAX - n
      if (room > 0) chunks.push(value.subarray(0, room))
      await reader.cancel()
      break
    }
    chunks.push(value)
    n += value.length
  }
  let all: Uint8Array
  if (chunks.length === 1) all = chunks[0]!
  else {
    all = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
    let off = 0
    for (const c of chunks) {
      all.set(c, off)
      off += c.length
    }
  }
  return new TextDecoder('utf-8').decode(all)
}

/** leftover 239 Djo */
async function parseTokenEndpointJson(
  res: Response,
  requestId: string | null,
): Promise<{
  access_token: string
  expires_in?: unknown
  token_type?: string
}> {
  const raw = await readResponseTextCapped(res)
  let parsed: {
    access_token?: unknown
    expires_in?: unknown
    token_type?: unknown
  }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    throw new AnthropicProfileOauthError(
      `Token endpoint returned non-JSON response (status ${res.status})`,
      res.status,
      redactTokenErrorBody(raw),
      requestId,
    )
  }
  if (typeof parsed.access_token !== 'string' || !parsed.access_token) {
    throw new AnthropicProfileOauthError(
      `Token endpoint response missing access_token: ${JSON.stringify(redactTokenErrorBody(parsed))}`,
      res.status,
      redactTokenErrorBody(parsed),
      requestId,
    )
  }
  if (
    parsed.token_type &&
    String(parsed.token_type).toLowerCase() !== 'bearer'
  ) {
    throw new AnthropicProfileOauthError(
      `Token endpoint response: unsupported token_type "${parsed.token_type}" (want Bearer)`,
      res.status,
      redactTokenErrorBody(parsed),
      requestId,
    )
  }
  return {
    access_token: parsed.access_token,
    expires_in: parsed.expires_in,
    token_type:
      typeof parsed.token_type === 'string' ? parsed.token_type : undefined,
  }
}

/** leftover 239 Fqs */
function identityTokenFromFile(path: string): () => Promise<string> {
  if (!path) throw new Error('Identity token file path is empty')
  return async () => {
    let raw: string
    try {
      raw = await readFile(path, 'utf-8')
    } catch (err) {
      throw new Error(`Failed to read identity token file at ${path}: ${err}`)
    }
    const token = raw.trim()
    if (!token) throw new Error(`Identity token file at ${path} is empty`)
    return token
  }
}

/** leftover 239 WPu */
function identityTokenFromValue(value: string): () => string {
  if (!value) throw new Error('Identity token value is empty')
  return () => value
}

/** leftover 239 By_ */
export function resolveIdentityTokenProvider(
  auth: OidcFederationConfig['authentication'],
  env: NodeJS.ProcessEnv = process.env,
): (() => Promise<string> | string) | null {
  if (auth.identity_token) {
    const source = auth.identity_token.source
    if (source !== 'file') {
      throw new AnthropicProfileOauthError(
        `identity_token.source "${source}" is not supported by this SDK version (only "file")`,
      )
    }
    if (!auth.identity_token.path) {
      throw new AnthropicProfileOauthError(
        'identity_token.source "file" requires a non-empty path',
      )
    }
    return identityTokenFromFile(auth.identity_token.path)
  }
  const file = envTrim('ANTHROPIC_IDENTITY_TOKEN_FILE', env)
  if (file) return identityTokenFromFile(file)
  const inline = envTrim('ANTHROPIC_IDENTITY_TOKEN', env)
  if (inline) return identityTokenFromValue(inline)
  return null
}

function envQuadConfig(env: NodeJS.ProcessEnv): OidcFederationConfig | null {
  const rule = envTrim('ANTHROPIC_FEDERATION_RULE_ID', env)
  const org = envTrim('ANTHROPIC_ORGANIZATION_ID', env)
  if (!rule || !org) return null
  const tokenFile = envTrim('ANTHROPIC_IDENTITY_TOKEN_FILE', env)
  return {
    organization_id: org,
    workspace_id: envTrim('ANTHROPIC_WORKSPACE_ID', env),
    base_url: envTrim('ANTHROPIC_BASE_URL', env),
    authentication: {
      type: 'oidc_federation',
      federation_rule_id: rule,
      service_account_id: envTrim('ANTHROPIC_SERVICE_ACCOUNT_ID', env),
      identity_token: tokenFile
        ? { source: 'file', path: tokenFile }
        : undefined,
      scope: envTrim('ANTHROPIC_SCOPE', env),
    },
  }
}

/**
 * leftover 239 Nqs — profile file, else env-quad shape when the file is absent.
 */
async function loadProfileOidcConfig(
  env: NodeJS.ProcessEnv,
): Promise<OidcFederationConfig | null> {
  const dir = getAnthropicConfigDir(env)
  if (dir === null) return envQuadConfig(env)
  const name =
    env.ANTHROPIC_PROFILE?.trim() || getActiveAnthropicProfileName(dir)
  const path = join(dir, 'configs', `${name}.json`)
  let raw: string | null
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : ''
    if (code !== 'ENOENT') {
      throw new Error(`failed to read config file ${path}: ${err}`)
    }
    raw = null
  }
  if (raw === null) return envQuadConfig(env)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    throw new Error(`failed to parse config file ${path}: ${err}`)
  }
  const authentication = parsed.authentication as
    | Record<string, unknown>
    | undefined
  if (!authentication) {
    throw new Error(`config file ${path} is missing "authentication"`)
  }
  const type = authentication.type
  if (type !== 'oidc_federation' && type !== 'user_oauth') {
    throw new Error(
      `authentication.type "${String(type)}" is not a known authentication type`,
    )
  }
  if (parsed.organization_id == null) {
    parsed.organization_id = envTrim('ANTHROPIC_ORGANIZATION_ID', env)
  }
  if (parsed.workspace_id == null) {
    parsed.workspace_id = envTrim('ANTHROPIC_WORKSPACE_ID', env)
  }
  if (parsed.base_url == null) {
    parsed.base_url = envTrim('ANTHROPIC_BASE_URL', env)
  }
  if (authentication.scope == null) {
    authentication.scope = envTrim('ANTHROPIC_SCOPE', env)
  }
  if (type === 'oidc_federation') {
    if (!authentication.identity_token) {
      const tokenFile = envTrim('ANTHROPIC_IDENTITY_TOKEN_FILE', env)
      if (tokenFile) {
        authentication.identity_token = { source: 'file', path: tokenFile }
      }
    }
    if (!authentication.federation_rule_id) {
      authentication.federation_rule_id =
        envTrim('ANTHROPIC_FEDERATION_RULE_ID', env) ?? ''
    }
    if (authentication.service_account_id == null) {
      authentication.service_account_id = envTrim(
        'ANTHROPIC_SERVICE_ACCOUNT_ID',
        env,
      )
    }
  }
  if (type !== 'oidc_federation') return null
  return parsed as unknown as OidcFederationConfig
}

/** leftover 239 i4b */
export async function loadOidcFederationConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OidcFederationConfig | null> {
  if (getAnthropicProfileSource(env) === 'env-quad') {
    return envQuadConfig(env)
  }
  return loadProfileOidcConfig(env)
}

function oidcBaseURL(config: OidcFederationConfig): string {
  return (
    envTrim('ANTHROPIC_BASE_URL') ||
    config.base_url ||
    DEFAULT_API_BASE
  ).replace(/\/+$/, '')
}

/**
 * leftover 239 VPu — jwt-bearer exchange.
 */
export async function exchangeOidcFederationToken(
  config: OidcFederationConfig,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<OidcAccessToken> {
  const provider = resolveIdentityTokenProvider(config.authentication)
  if (!provider) {
    throw new AnthropicProfileOauthError(
      'oidc_federation config requires an identity token (set authentication.identity_token, ANTHROPIC_IDENTITY_TOKEN_FILE, or ANTHROPIC_IDENTITY_TOKEN)',
    )
  }
  if (!config.authentication.federation_rule_id) {
    throw new AnthropicProfileOauthError(
      "oidc_federation config requires 'federation_rule_id'. Set it in authentication.federation_rule_id in your profile, or via ANTHROPIC_FEDERATION_RULE_ID (profile takes precedence).",
    )
  }
  if (!config.organization_id) {
    throw new AnthropicProfileOauthError(
      'oidc_federation config requires organization_id (set ANTHROPIC_ORGANIZATION_ID or config.organization_id)',
    )
  }
  const baseURL = oidcBaseURL(config)
  assertHttpsTokenBaseURL(baseURL)
  const assertion = await provider()
  if (assertion.length > OIDC_IDENTITY_TOKEN_MAX_BYTES) {
    throw new AnthropicProfileOauthError(
      `Identity token is ${Math.ceil(assertion.length / 1024)} KiB, exceeds the 16 KiB assertion limit`,
    )
  }
  const body: Record<string, string> = {
    grant_type: JWT_BEARER_GRANT,
    assertion,
    federation_rule_id: config.authentication.federation_rule_id,
    organization_id: config.organization_id,
  }
  if (config.authentication.service_account_id) {
    body.service_account_id = config.authentication.service_account_id
  }
  if (config.workspace_id) body.workspace_id = config.workspace_id
  const url = `${baseURL}${OIDC_TOKEN_PATH}`
  let res: Response
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-beta': `${OAUTH_BETA_HEADER},${OIDC_FEDERATION_BETA}`,
        'User-Agent': `anthropic-sdk-typescript/${sdkVersion()} oidcFederationProvider`,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new AnthropicProfileOauthError(
      `Failed to reach token endpoint ${url}: ${err}`,
    )
  }
  const requestId = res.headers.get('Request-Id')
  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    const redacted = redactTokenErrorBody(raw)
    let hint = ''
    if (res.status === 401) {
      hint = ` Ensure your federation rule matches your identity token. ${
        config.workspace_id
          ? ''
          : "If your federation rule is scoped to multiple workspaces, set the ANTHROPIC_WORKSPACE_ID environment variable, the 'workspace_id' config key, or the `workspaceId` option. "
      }View your authentication events in the Workload identity page of Claude Console for more details.`
    }
    throw new AnthropicProfileOauthError(
      `Token exchange failed with status ${res.status}${requestId ? ` (request-id ${requestId})` : ''}: ${redacted}${hint}`,
      res.status,
      redacted,
      requestId,
    )
  }
  const payload = await parseTokenEndpointJson(res, requestId)
  const expiresIn = Number(payload.expires_in)
  if (!Number.isFinite(expiresIn)) {
    throw new AnthropicProfileOauthError(
      `Token endpoint response missing required fields: ${JSON.stringify(redactTokenErrorBody(payload))}`,
      res.status,
      redactTokenErrorBody(payload),
      requestId,
    )
  }
  return { token: payload.access_token, expiresAt: nowUnixSec() + expiresIn }
}

/** leftover 239 AOr — profile credentials path; env-quad has none. */
export function resolveOidcCredentialsPath(
  config: OidcFederationConfig,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const custom = config.authentication.credentials_path
  if (typeof custom === 'string' && custom.length > 0) return custom
  if (getAnthropicProfileSource(env) === 'env-quad') return null
  const dir = getAnthropicConfigDir(env)
  if (!dir) return null
  const name =
    env.ANTHROPIC_PROFILE?.trim() || getActiveAnthropicProfileName(dir)
  if (!name) return null
  return join(dir, 'credentials', `${name}.json`)
}

/** leftover 239 $Ur fetch wrap — proxy + AbortSignal.timeout(10000). */
function wrapOidcTokenFetch(fetchFn: FetchLike): FetchLike {
  return (url, init) => {
    const proxy = getProxyFetchOptions({ forAnthropicAPI: true })
    return fetchFn(url, {
      ...init,
      ...proxy,
      signal: AbortSignal.timeout(OIDC_TOKEN_FETCH_TIMEOUT_MS),
    })
  }
}

async function writeOidcCredentialsFile(
  path: string,
  value: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
    await rename(tmp, path)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

/**
 * leftover 239 jy_ — credentials-file cache around VPu.
 * Reuse access_token unless forceRefresh or within GHt of expiry.
 */
function wrapOidcCredentialsFileCache(
  provider: OidcTokenProvider,
  credentialsPath: string,
): OidcTokenProvider {
  return async opts => {
    let parsed: Record<string, unknown> | undefined
    try {
      parsed = JSON.parse(await readFile(credentialsPath, 'utf-8')) as Record<
        string,
        unknown
      >
      const token = parsed.access_token
      if (typeof token === 'string' && token && !opts?.forceRefresh) {
        const expiresAt =
          typeof parsed.expires_at === 'number' ? parsed.expires_at : null
        if (
          expiresAt == null ||
          nowUnixSec() < expiresAt - OIDC_CACHE_BACKGROUND_SEC
        ) {
          return { token, expiresAt }
        }
      }
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code)
          : ''
      if (code !== 'ENOENT' && !(err instanceof SyntaxError)) {
        logForDebugging(String(err), { level: 'warn' })
      }
    }
    const tok = await provider(opts)
    try {
      await writeOidcCredentialsFile(credentialsPath, {
        ...parsed,
        version: CREDENTIALS_FILE_VERSION,
        type: 'oauth_token',
        access_token: tok.token,
        expires_at: tok.expiresAt,
      })
    } catch (err) {
      logForDebugging(String(err), { level: 'warn' })
    }
    return tok
  }
}

function oidcCacheFingerprint(
  env: NodeJS.ProcessEnv,
  fetchFn: FetchLike,
): string {
  return (
    [
      env.ANTHROPIC_FEDERATION_RULE_ID,
      env.ANTHROPIC_ORGANIZATION_ID,
      env.ANTHROPIC_WORKSPACE_ID,
      env.ANTHROPIC_IDENTITY_TOKEN_FILE,
      env.ANTHROPIC_IDENTITY_TOKEN,
      env.ANTHROPIC_BASE_URL,
      env.ANTHROPIC_PROFILE,
      env.ANTHROPIC_CONFIG_DIR,
      env.ANTHROPIC_SERVICE_ACCOUNT_ID,
      env.ANTHROPIC_SCOPE,
    ].join('\0') + (fetchFn === globalThis.fetch ? '#g' : '#c')
  )
}

/** leftover 239 TQt */
class WifTokenCache {
  cached: OidcAccessToken | null = null
  pendingRefresh: Promise<OidcAccessToken> | null = null
  nextForce = false
  lastAdvisoryError = 0
  constructor(private readonly provider: OidcTokenProvider) {}
  async getToken(): Promise<string> {
    const force = this.nextForce
    this.nextForce = false
    const cached = this.cached
    if (force || cached == null) return (await this.refresh(force)).token
    if (cached.expiresAt == null) return cached.token
    const remain = cached.expiresAt - nowUnixSec()
    if (remain > OIDC_CACHE_FRESH_SEC) return cached.token
    if (remain > OIDC_CACHE_BACKGROUND_SEC) {
      this.backgroundRefresh()
      return cached.token
    }
    return (await this.refresh()).token
  }
  invalidate(): void {
    this.cached = null
    this.nextForce = true
  }
  refresh(force = false): Promise<OidcAccessToken> {
    if (this.pendingRefresh && !force) return this.pendingRefresh
    return this.doRefresh(force)
  }
  backgroundRefresh(): void {
    if (this.pendingRefresh) return
    if (
      nowUnixSec() - this.lastAdvisoryError <
      OIDC_ADVISORY_ERROR_COOLDOWN_SEC
    ) {
      return
    }
    this.doRefresh().catch(err => {
      this.lastAdvisoryError = nowUnixSec()
      logForDebugging(String(err), { level: 'warn' })
    })
  }
  doRefresh(force = false): Promise<OidcAccessToken> {
    this.pendingRefresh = this.provider(
      force ? { forceRefresh: true } : undefined,
    )
      .then(tok => {
        this.cached = tok
        this.pendingRefresh = null
        return tok
      })
      .catch(err => {
        this.pendingRefresh = null
        throw err
      })
    return this.pendingRefresh
  }
}

let tokenCache: WifTokenCache | null = null
let cacheFetch: FetchLike = globalThis.fetch
let cacheFingerprint = ''

function resetOidcTokenCache(): void {
  tokenCache = null
  cacheFingerprint = ''
}

/** leftover 239 iZe / getWIFTokenCache */
function getOidcTokenCache(
  env: NodeJS.ProcessEnv,
  fetchFn: FetchLike,
): WifTokenCache {
  const fingerprint = oidcCacheFingerprint(env, fetchFn)
  if (
    tokenCache &&
    cacheFetch === fetchFn &&
    cacheFingerprint === fingerprint
  ) {
    return tokenCache
  }
  cacheFetch = fetchFn
  cacheFingerprint = fingerprint
  const wrappedFetch = wrapOidcTokenFetch(fetchFn)
  tokenCache = new WifTokenCache(async opts => {
    const config = await loadOidcFederationConfig(env)
    if (config === null) {
      throw new AnthropicProfileOauthError(
        'No oidc_federation config to exchange',
      )
    }
    const exchange: OidcTokenProvider = () =>
      exchangeOidcFederationToken(config, wrappedFetch)
    const credentialsPath = resolveOidcCredentialsPath(config, env)
    const provider = credentialsPath
      ? wrapOidcCredentialsFileCache(exchange, credentialsPath)
      : exchange
    return provider(opts)
  })
  return tokenCache
}

/**
 * leftover 239 kew — invalidate TQt on profile-oauth 401/5xx/null
 * except DUr (expired-no-refresh) and sOt (account_on_hold).
 */
export async function invalidateOidcFederationCacheOnRetry(
  error: unknown,
): Promise<boolean> {
  if (!(error instanceof AnthropicProfileOauthError)) return false
  if (isAnthropicProfileOauthExpiredError(error)) return false
  if (getOidcAccountOnHold(error) !== null) return false
  const status = error.statusCode
  if (status !== null && status !== 401 && status < 500) return false
  try {
    if (tokenCache === null) {
      const config = await loadOidcFederationConfig()
      if (config === null) return false
    }
    getOidcTokenCache(process.env, cacheFetch).invalidate()
    return true
  } catch {
    return false
  }
}

/** leftover 239 kQt extraHeaders — workspace header is user_oauth only. */
export function getOidcFederationWireOptions(
  config: OidcFederationConfig | null,
): { extraHeaders: Record<string, string>; baseURL?: string } {
  const raw = config?.base_url?.trim() || envTrim('ANTHROPIC_BASE_URL') || ''
  return {
    extraHeaders: {},
    ...(raw ? { baseURL: raw.replace(/\/+$/, '') } : {}),
  }
}

/** leftover 239 iZe.getToken for oidc_federation. */
export async function resolveOidcFederationAccessToken(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<OidcAccessToken | null> {
  const config = await loadOidcFederationConfig(env)
  if (config === null) return null
  return getOidcTokenCache(env, fetchFn)
    .getToken()
    .then(token => {
      const cached = tokenCache?.cached
      return cached ?? { token, expiresAt: null }
    })
}

export function clearOidcFederationCaches(): void {
  resetOidcTokenCache()
}
