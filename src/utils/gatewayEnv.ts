/**
 * Official uRi CLAUDE_CODE_USE_GATEWAY env bootstrap + densable gatewayAuth
 * session store (o_ / XFe / eGo / Sht).
 *
 * When USE_GATEWAY is on and ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN are set,
 * official pins a Cloud-gateway session from env (unpinned JWT session).
 * Missing pair → warn and ignore. Invalid URL → throw (official throws).
 *
 * Full enterpriseGateway / TLS trust restore + idp refresh (SJe) denser.
 */

import { isEnvTruthy } from './envUtils.js'

export type GatewayAuthSession = {
  url: string
  jwt: string
  /** ms epoch; MAX_SAFE_INTEGER when JWT has no exp. */
  expiresAtMs: number
  /** Env-pinned sessions are unpinned; enterprise login may set false. */
  unpinned?: boolean
  idpRefreshToken?: string
  tokenEndpoint?: string
}

/** @deprecated Prefer GatewayAuthSession — kept for existing resolveGatewayFromEnv. */
export type GatewayEnvSession = GatewayAuthSession & { unpinned: true }

export type ResolveGatewayFromEnvResult =
  | { status: 'disabled' }
  | { status: 'missing'; message: string }
  | { status: 'invalid_url'; message: string }
  | { status: 'ok'; session: GatewayEnvSession }

// Official Pt.gatewayAuth densable store
let gatewayAuth: GatewayAuthSession | null = null

/**
 * Process-level cache for default secure-storage restore.
 * - Successful miss (no usable credential / blocked): permanent until
 *   login/logout/credential write invalidates.
 * - storage_read_failed: short backoff only (external writers / transient IO
 *   must be able to recover in long-lived daemon/bridge processes).
 * Env bootstrap still runs every ensureGatewayAuthApplied call.
 */
let secureStorageRestoreAttempted = false
/** ms epoch until which failed default-host reads may be retried. */
let secureStorageReadFailBackoffUntilMs = 0

/** Backoff after a failed secure-storage read (default host). */
export const GATEWAY_SECURE_STORAGE_READ_FAIL_BACKOFF_MS = 5_000

/**
 * Test-only override for the default secure-storage read path (avoids
 * process-global mock.module of secureStorage).
 */
let testSecureStorageRead: (() => Record<string, unknown> | null) | null = null

/** Optional clock for tests (default Date.now). */
let gatewaySecureStorageNowMs: () => number = () => Date.now()

/** Invalidate secure-storage restore negative cache (login / logout / credential write). */
export function invalidateGatewaySecureStorageRestoreCache(): void {
  secureStorageRestoreAttempted = false
  secureStorageReadFailBackoffUntilMs = 0
}

/** @internal test helper — reset negative cache + clear read override. */
export function resetGatewaySecureStorageRestoreCache_FOR_TESTS(): void {
  secureStorageRestoreAttempted = false
  secureStorageReadFailBackoffUntilMs = 0
  testSecureStorageRead = null
  gatewaySecureStorageNowMs = () => Date.now()
}

/** @internal test helper — inject clock for backoff tests. */
export function setGatewaySecureStorageNowMs_FOR_TESTS(
  nowMs: (() => number) | null,
): void {
  gatewaySecureStorageNowMs = nowMs ?? (() => Date.now())
}

/**
 * @internal test helper — inject default-host secure storage read.
 * Pass null to clear. Does not mark the negative cache.
 */
export function setTestGatewaySecureStorageRead_FOR_TESTS(
  read: (() => Record<string, unknown> | null) | null,
): void {
  testSecureStorageRead = read
}

/** Official o_ — current gateway auth session, if any. */
export function getGatewayAuth(): GatewayAuthSession | null {
  return gatewayAuth
}

/** Official XFe — pin/replace gateway auth session. */
export function setGatewayAuth(session: GatewayAuthSession | null): void {
  gatewayAuth = session
}

export function clearGatewayAuth(): void {
  gatewayAuth = null
  // Logout / test reset: allow a later restore after new credentials are written.
  secureStorageRestoreAttempted = false
  secureStorageReadFailBackoffUntilMs = 0
}

/** Official eGo — session present and expired. */
export function isGatewayAuthExpired(
  session: GatewayAuthSession | null | undefined = gatewayAuth,
  nowMs: number = Date.now(),
): boolean {
  return !!session && session.expiresAtMs <= nowMs
}

/** Official Sht — pinned (enterprise) session, not env-unpinned. */
export function isGatewayAuthPinned(
  session: GatewayAuthSession | null | undefined = gatewayAuth,
): boolean {
  return !!session && !session.unpinned
}

/**
 * Official client-branch error when session missing/expired.
 * USE_GATEWAY → refresh ANTHROPIC_AUTH_TOKEN; else /login reconnect.
 */
export function formatGatewaySessionExpiredError(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return isEnvTruthy(env.CLAUDE_CODE_USE_GATEWAY)
    ? 'Cloud gateway token expired — refresh ANTHROPIC_AUTH_TOKEN and restart.'
    : 'Cloud gateway session expired — run /login to reconnect.'
}

/**
 * Decode JWT exp claim (seconds) without verifying signature.
 * Returns null when payload is unreadable or exp missing.
 */
export function decodeJwtExpSeconds(token: string): number | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payloadB64 = parts[1]!
    const json = Buffer.from(
      payloadB64.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8')
    const payload = JSON.parse(json) as { exp?: unknown }
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return null
    }
    return payload.exp
  } catch {
    return null
  }
}

export function normalizeGatewayBaseUrl(raw: string): string {
  const url = new URL(raw)
  // Strip trailing slash for stable Anthropic client baseURL.
  return url.toString().replace(/\/$/, '')
}

/**
 * Official uRi first branch — env-driven gateway session pin.
 */
export function resolveGatewayFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ResolveGatewayFromEnvResult {
  if (!isEnvTruthy(env.CLAUDE_CODE_USE_GATEWAY)) {
    return { status: 'disabled' }
  }
  const baseUrl = env.ANTHROPIC_BASE_URL?.trim()
  const authToken = env.ANTHROPIC_AUTH_TOKEN?.trim()
  if (!baseUrl || !authToken) {
    return {
      status: 'missing',
      message:
        'CLAUDE_CODE_USE_GATEWAY is set but ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN is missing; ignoring',
    }
  }
  try {
    const url = normalizeGatewayBaseUrl(baseUrl)
    const exp = decodeJwtExpSeconds(authToken)
    return {
      status: 'ok',
      session: {
        url,
        jwt: authToken,
        expiresAtMs: exp !== null ? exp * 1000 : Number.MAX_SAFE_INTEGER,
        unpinned: true,
      },
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      status: 'invalid_url',
      message: `CLAUDE_CODE_USE_GATEWAY is set but ANTHROPIC_BASE_URL is invalid: ${detail}`,
    }
  }
}

/**
 * Apply env resolve result: pin session on ok; leave store unchanged otherwise.
 * Returns the session after apply (existing store if not ok).
 */
export function applyGatewayFromEnvResult(
  result: ResolveGatewayFromEnvResult,
): GatewayAuthSession | null {
  if (result.status === 'ok') {
    setGatewayAuth(result.session)
  }
  return getGatewayAuth()
}

/**
 * Ensure gateway env / secure-storage session is visible to getAPIProvider()
 * and other early callers that do not go through getAnthropicClient().
 * Does not throw on missing/invalid env (client path still validates).
 *
 * Env is re-checked every call. Default secure-storage restore is process-level
 * negative-cached (see tryRestoreGatewayAuthFromSecureStorage) so repeated
 * getAPIProvider() / getAnthropicClient() cold paths do not re-read disk.
 */
export function ensureGatewayAuthApplied(): GatewayAuthSession | null {
  if (getGatewayAuth()) {
    return getGatewayAuth()
  }
  const fromEnv = resolveGatewayFromEnv()
  if (fromEnv.status === 'ok') {
    applyGatewayFromEnvResult(fromEnv)
  }
  if (!getGatewayAuth()) {
    try {
      tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
    } catch {
      // secure-storage restore optional
    }
  }
  return getGatewayAuth()
}

/**
 * Official YZm — refresh when idp token expires within 5 minutes.
 */
export const GATEWAY_IDP_REFRESH_SKEW_MS = 300_000

export type GatewayIdpTokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string | null
}

/** Official Lyi densable — parse IdP token refresh response. */
export function parseGatewayIdpTokenResponse(
  data: unknown,
): GatewayIdpTokenResponse | null {
  if (typeof data !== 'object' || data === null) return null
  const rec = data as Record<string, unknown>
  if (
    typeof rec.access_token !== 'string' ||
    rec.access_token.length === 0 ||
    typeof rec.expires_in !== 'number' ||
    !Number.isFinite(rec.expires_in)
  ) {
    return null
  }
  return {
    access_token: rec.access_token,
    expires_in: rec.expires_in,
    refresh_token:
      typeof rec.refresh_token === 'string' ? rec.refresh_token : null,
  }
}

/**
 * Official SJe gate densable — whether session needs IdP refresh now.
 * Requires idpRefreshToken and expires within GATEWAY_IDP_REFRESH_SKEW_MS.
 */
export function shouldRefreshGatewayIdp(
  session: GatewayAuthSession | null | undefined = gatewayAuth,
  nowMs: number = Date.now(),
  skewMs: number = GATEWAY_IDP_REFRESH_SKEW_MS,
): boolean {
  if (!session?.idpRefreshToken) return false
  return session.expiresAtMs - nowMs < skewMs
}

/** Official tokenEndpoint densable — custom or `${url}/oauth/token`. */
export function resolveGatewayIdpTokenEndpoint(
  session: GatewayAuthSession,
): string {
  return session.tokenEndpoint ?? `${session.url}/oauth/token`
}

/**
 * Official JZm pure densable — build refreshed session from token response.
 * Caller applies via setGatewayAuth + optional secureStorage persist denser.
 */
export function buildRefreshedGatewayAuthSession(
  session: GatewayAuthSession,
  token: GatewayIdpTokenResponse,
  nowMs: number = Date.now(),
): GatewayAuthSession {
  return {
    url: session.url,
    jwt: token.access_token,
    expiresAtMs: nowMs + token.expires_in * 1000,
    idpRefreshToken: token.refresh_token ?? session.idpRefreshToken,
    ...(session.tokenEndpoint ? { tokenEndpoint: session.tokenEndpoint } : {}),
    ...(session.unpinned !== undefined ? { unpinned: session.unpinned } : {}),
  }
}

export type GatewayIdpRefreshResult =
  | { status: 'skipped'; reason: 'no_session' | 'not_due' | 'no_refresh_token' }
  | { status: 'refreshed'; session: GatewayAuthSession }
  | { status: 'invalid_grant'; clearedRefresh: boolean }
  | { status: 'error'; message: string; retryable: boolean }

/**
 * Official enterpriseGateway secureStorage shape densable (JYl / XYl).
 * Stored under SecureStorageData.enterpriseGateway.
 */
export type EnterpriseGatewayCredential = {
  url: string
  jwt: string
  expiresAtMs: number
  idpRefreshToken?: string
  tokenEndpoint?: string
  unpinned?: boolean
}

/** Convert live session → secureStorage enterpriseGateway record. */
export function toEnterpriseGatewayCredential(
  session: GatewayAuthSession,
): EnterpriseGatewayCredential {
  return {
    url: session.url,
    jwt: session.jwt,
    expiresAtMs: session.expiresAtMs,
    ...(session.idpRefreshToken
      ? { idpRefreshToken: session.idpRefreshToken }
      : {}),
    ...(session.tokenEndpoint ? { tokenEndpoint: session.tokenEndpoint } : {}),
    ...(session.unpinned !== undefined ? { unpinned: session.unpinned } : {}),
  }
}

/**
 * Official JYl densable — merge enterpriseGateway into injectable secureStorage.
 * When expectedIdpRefreshToken is set and storage already holds a different
 * idpRefreshToken, keep the stored credential (mid-refresh race).
 */
export function planEnterpriseGatewayStorageMerge(input: {
  existing: Record<string, unknown> | null | undefined
  next: GatewayAuthSession
  /**
   * Official expected refresh token at mutate start. When stored
   * enterpriseGateway.idpRefreshToken differs, keep stored value.
   */
  expectedIdpRefreshToken?: string
}): {
  data: Record<string, unknown>
  applied: EnterpriseGatewayCredential
  discarded: boolean
} {
  const existing = input.existing ?? {}
  const prev = existing.enterpriseGateway as
    | EnterpriseGatewayCredential
    | undefined
  if (
    input.expectedIdpRefreshToken !== undefined &&
    prev?.idpRefreshToken !== undefined &&
    prev.idpRefreshToken !== input.expectedIdpRefreshToken
  ) {
    return {
      data: existing as Record<string, unknown>,
      applied: prev,
      discarded: true,
    }
  }
  const applied = toEnterpriseGatewayCredential(input.next)
  return {
    data: { ...existing, enterpriseGateway: applied },
    applied,
    discarded: false,
  }
}

export type EnterpriseGatewayPersistResult =
  | { success: true; discarded: boolean }
  | { success: false; message: string; warning?: string }

/**
 * Official XYl / JYl densable — persist enterpriseGateway credential via
 * injectable secureStorage. Real getSecureStorage().update is the default
 * host when storage omitted (lazy require to avoid bootstrap cycles).
 */
export async function persistEnterpriseGatewayCredential(input: {
  session: GatewayAuthSession
  expectedIdpRefreshToken?: string
  /**
   * Official Fc() secureStorage host. When omitted, lazy getSecureStorage().
   */
  storage?: {
    read: () => Record<string, unknown> | null
    update: (data: Record<string, unknown>) => {
      success: boolean
      warning?: string
    }
  }
  log?: (msg: string, level?: 'warn' | 'debug') => void
}): Promise<EnterpriseGatewayPersistResult> {
  let storage = input.storage
  if (!storage) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSecureStorage } =
        require('./secureStorage/index.js') as typeof import('./secureStorage/index.js')
      const host = getSecureStorage()
      storage = {
        read: () =>
          (host.read() as Record<string, unknown> | null | undefined) ?? null,
        update: data =>
          host.update(data as never) as {
            success: boolean
            warning?: string
          },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      input.log?.(
        `[gateway-refresh] secureStorage write failed: ${message}`,
        'warn',
      )
      return { success: false, message }
    }
  }
  try {
    const existing = storage.read()
    const planned = planEnterpriseGatewayStorageMerge({
      existing,
      next: input.session,
      expectedIdpRefreshToken: input.expectedIdpRefreshToken,
    })
    if (planned.discarded) {
      input.log?.(
        '[gateway-refresh] auth changed during persist; discarding outcome',
        'debug',
      )
      // Storage may have a newer credential; allow a subsequent restore.
      invalidateGatewaySecureStorageRestoreCache()
      return { success: true, discarded: true }
    }
    const result = storage.update(planned.data)
    if (!result.success) {
      const message = `Failed to persist gateway credential${
        result.warning ? `: ${result.warning}` : ''
      }`
      input.log?.(
        `[gateway-refresh] secureStorage write failed: ${message}`,
        'warn',
      )
      return {
        success: false,
        message,
        ...(result.warning ? { warning: result.warning } : {}),
      }
    }
    // Credential written: next cold restore after clear must re-read disk.
    invalidateGatewaySecureStorageRestoreCache()
    return { success: true, discarded: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    input.log?.(
      `[gateway-refresh] secureStorage write failed; applying refreshed credential in-memory only: ${message}`,
      'warn',
    )
    return { success: false, message }
  }
}

/**
 * Official SJe densable — refresh gateway JWT via IdP refresh_token when due.
 * Injectable transport; enterpriseGateway secureStorage persist densable via
 * persistEnterpriseGatewayCredential when persist omitted (pinned only).
 */
export async function maybeRefreshGatewayIdp(input?: {
  session?: GatewayAuthSession | null
  nowMs?: number
  skewMs?: number
  /**
   * Official QS.post(tokenEndpoint, form-urlencoded body).
   * When omitted and refresh is due → error (no transport).
   */
  postToken?: (args: {
    endpoint: string
    body: string
    headers: Record<string, string>
  }) => Promise<{ data: unknown }>
  /** Optional persist denser after refresh (enterpriseGateway secureStorage). */
  persist?: (session: GatewayAuthSession) => Promise<void> | void
  /**
   * When true (default for pinned sessions), auto-persist via
   * persistEnterpriseGatewayCredential when persist omitted.
   * Env-unpinned sessions skip auto-persist.
   */
  autoPersist?: boolean
  /** Apply refreshed session to in-memory store (default setGatewayAuth). */
  apply?: (session: GatewayAuthSession) => void
  /**
   * When true (default), clear idpRefreshToken on invalid_grant and apply.
   */
  clearOnInvalidGrant?: boolean
  isInvalidGrant?: (err: unknown) => boolean
  log?: (msg: string, level?: 'warn' | 'debug') => void
}): Promise<GatewayIdpRefreshResult> {
  const session = input?.session === undefined ? gatewayAuth : input.session
  if (!session) return { status: 'skipped', reason: 'no_session' }
  if (!session.idpRefreshToken) {
    return { status: 'skipped', reason: 'no_refresh_token' }
  }
  const nowMs = input?.nowMs ?? Date.now()
  if (
    !shouldRefreshGatewayIdp(
      session,
      nowMs,
      input?.skewMs ?? GATEWAY_IDP_REFRESH_SKEW_MS,
    )
  ) {
    return { status: 'skipped', reason: 'not_due' }
  }
  if (!input?.postToken) {
    return {
      status: 'error',
      message: 'gateway idp refresh gated: no transport',
      retryable: false,
    }
  }
  const endpoint = resolveGatewayIdpTokenEndpoint(session)
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.idpRefreshToken,
  }).toString()
  const expectedRefresh = session.idpRefreshToken
  const runPersist = async (next: GatewayAuthSession): Promise<void> => {
    if (input?.persist) {
      await input.persist(next)
      return
    }
    const auto = input?.autoPersist !== false && isGatewayAuthPinned(session)
    if (!auto) return
    await persistEnterpriseGatewayCredential({
      session: next,
      expectedIdpRefreshToken: expectedRefresh,
      log: input?.log,
    })
  }
  try {
    const res = await input.postToken({
      endpoint,
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const token = parseGatewayIdpTokenResponse(res.data)
    if (!token) {
      return {
        status: 'error',
        message: 'malformed idp token response',
        retryable: true,
      }
    }
    // Official: discard if auth changed mid-refresh
    if (input?.session === undefined && getGatewayAuth() !== session) {
      return {
        status: 'error',
        message: 'auth changed mid-refresh',
        retryable: false,
      }
    }
    const next = buildRefreshedGatewayAuthSession(session, token, nowMs)
    ;(input?.apply ?? setGatewayAuth)(next)
    try {
      await runPersist(next)
    } catch {
      // secureStorage densable optional — in-memory already applied
    }
    return { status: 'refreshed', session: next }
  } catch (err) {
    const invalid =
      input?.isInvalidGrant?.(err) === true ||
      (err &&
        typeof err === 'object' &&
        'response' in err &&
        typeof (err as { response?: { data?: { error?: unknown } } }).response
          ?.data?.error === 'string' &&
        (err as { response: { data: { error: string } } }).response.data
          .error === 'invalid_grant')
    if (invalid) {
      const clear = input?.clearOnInvalidGrant !== false
      if (clear) {
        const cleared: GatewayAuthSession = {
          ...session,
          idpRefreshToken: undefined,
        }
        ;(input?.apply ?? setGatewayAuth)(cleared)
        try {
          await runPersist(cleared)
        } catch {
          // optional
        }
      }
      return { status: 'invalid_grant', clearedRefresh: clear }
    }
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
    }
  }
}

// ---------------------------------------------------------------------------
// Official gatewayTrust TLS pin densables (U_c / zPr / B_c / uRi restore branch)
// Pure plan/persist + restore orchestration with injectable probe, plus
// production tls.connect probe (probeGatewayTlsFingerprint /
// defaultProbeGatewayTlsFingerprint) and checkServerIdentity pin Agent.
// ---------------------------------------------------------------------------

/** Official FBn — TLS pin mismatch message. */
export const GATEWAY_TLS_PIN_MISMATCH_MESSAGE =
  'gateway TLS certificate does not match the pinned fingerprint'

/**
 * Official fingerprint256 densable — strip colons, lowercase.
 * Empty/non-string → ''.
 */
export function normalizeGatewayTlsFingerprint(
  fingerprint: string | null | undefined,
): string {
  if (typeof fingerprint !== 'string' || fingerprint.length === 0) return ''
  return fingerprint.replaceAll(':', '').toLowerCase()
}

/**
 * Official hostname densable for gatewayTrust map key — URL hostname without
 * IPv6 brackets.
 */
export function resolveGatewayTrustHostKey(url: string): string {
  return new URL(url).hostname.replace(/^\[|\]$/g, '')
}

/**
 * Official B_c check densable — compare live fingerprint256 to pin.
 */
export function matchesGatewayTlsPin(
  liveFingerprint: string | null | undefined,
  pinnedFingerprint: string | null | undefined,
): boolean {
  const live = normalizeGatewayTlsFingerprint(liveFingerprint)
  const pin = normalizeGatewayTlsFingerprint(pinnedFingerprint)
  if (!pin) return false
  return live === pin
}

/**
 * Official U_c merge densable — plan gatewayTrust host→fingerprint update.
 */
export function planGatewayTrustStorageMerge(input: {
  existing: Record<string, unknown> | null | undefined
  host: string
  fingerprint: string
}): Record<string, unknown> {
  const existing = input.existing ?? {}
  const prev =
    existing.gatewayTrust &&
    typeof existing.gatewayTrust === 'object' &&
    existing.gatewayTrust !== null
      ? (existing.gatewayTrust as Record<string, string>)
      : {}
  return {
    ...existing,
    gatewayTrust: {
      ...prev,
      [input.host]: normalizeGatewayTlsFingerprint(input.fingerprint),
    },
  }
}

export type GatewayTlsPinPersistResult =
  | { success: true }
  | { success: false; message: string; warning?: string }

/**
 * Official U_c densable — persist gatewayTrust pin via injectable secureStorage.
 */
export async function persistGatewayTlsPin(input: {
  host: string
  fingerprint: string
  storage?: {
    read: () => Record<string, unknown> | null
    update: (data: Record<string, unknown>) => {
      success: boolean
      warning?: string
    }
  }
}): Promise<GatewayTlsPinPersistResult> {
  let storage = input.storage
  if (!storage) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSecureStorage } =
        require('./secureStorage/index.js') as typeof import('./secureStorage/index.js')
      const host = getSecureStorage()
      storage = {
        read: () =>
          (host.read() as Record<string, unknown> | null | undefined) ?? null,
        update: data =>
          host.update(data as never) as {
            success: boolean
            warning?: string
          },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, message }
    }
  }
  try {
    const data = planGatewayTrustStorageMerge({
      existing: storage.read(),
      host: input.host,
      fingerprint: input.fingerprint,
    })
    const result = storage.update(data)
    if (!result.success) {
      return {
        success: false,
        message: `Failed to persist gateway TLS pin${
          result.warning ? `: ${result.warning}` : ''
        }`,
        ...(result.warning ? { warning: result.warning } : {}),
      }
    }
    // Pin write can unblock a previously skipped restore (untrusted host).
    invalidateGatewaySecureStorageRestoreCache()
    return { success: true }
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Official zPr densable — read pinned fingerprint for host from storage.
 */
export function readGatewayTlsPin(input: {
  host: string
  storageData: Record<string, unknown> | null | undefined
}): string | undefined {
  const trust = input.storageData?.gatewayTrust
  if (!trust || typeof trust !== 'object') return undefined
  const pin = (trust as Record<string, unknown>)[input.host]
  return typeof pin === 'string' && pin.length > 0
    ? normalizeGatewayTlsFingerprint(pin)
    : undefined
}

/**
 * Official enterpriseGateway record → GatewayAuthSession densable.
 * Accepts either expiresAtMs (local) or expiresAt (official storage).
 */
export function parseEnterpriseGatewayCredential(
  raw: unknown,
): GatewayAuthSession | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (typeof rec.url !== 'string' || rec.url.length === 0) return null
  if (typeof rec.jwt !== 'string' || rec.jwt.length === 0) return null
  const expiresAtMs =
    typeof rec.expiresAtMs === 'number' && Number.isFinite(rec.expiresAtMs)
      ? rec.expiresAtMs
      : typeof rec.expiresAt === 'number' && Number.isFinite(rec.expiresAt)
        ? rec.expiresAt
        : null
  if (expiresAtMs === null) return null
  return {
    url: rec.url,
    jwt: rec.jwt,
    expiresAtMs,
    unpinned: rec.unpinned === true ? true : false,
    ...(typeof rec.idpRefreshToken === 'string'
      ? { idpRefreshToken: rec.idpRefreshToken }
      : {}),
    ...(typeof rec.tokenEndpoint === 'string'
      ? { tokenEndpoint: rec.tokenEndpoint }
      : {}),
  }
}

export type RestoreGatewayAuthPlan =
  | { status: 'env_applied' }
  | { status: 'no_credential' }
  | {
      status: 'untrusted'
      host: string
      message: string
    }
  | {
      status: 'expired'
      host: string
      message: string
    }
  | {
      status: 'tls_mismatch'
      host: string
      pinned: string
      live: string
      message: string
    }
  | {
      status: 'tls_probe_failed'
      host: string
      message: string
      /** Official: proceed without re-verify on probe failure. */
      proceed: true
      session: GatewayAuthSession
    }
  | {
      status: 'restore'
      host: string
      session: GatewayAuthSession
      pinned: string
    }

/**
 * Official uRi restore densable pure plan — after env branch fails/skips,
 * restore enterpriseGateway from secureStorage when TLS pin matches (or
 * probe fails and proceed).
 */
export function planRestoreGatewayAuth(input: {
  storageData: Record<string, unknown> | null | undefined
  nowMs?: number
  /**
   * Official VPr densable result. When omitted, plan returns restore without
   * live verify (caller should probe before apply when pin present).
   */
  liveFingerprint?: string | null
  probeError?: string | null
}): RestoreGatewayAuthPlan {
  const session = parseEnterpriseGatewayCredential(
    input.storageData?.enterpriseGateway,
  )
  if (!session) return { status: 'no_credential' }
  let host: string
  try {
    host = resolveGatewayTrustHostKey(session.url)
  } catch {
    return { status: 'no_credential' }
  }
  const pinned = readGatewayTlsPin({
    host,
    storageData: input.storageData,
  })
  if (!pinned) {
    return {
      status: 'untrusted',
      host,
      message: `Cloud gateway ${host} is not trusted on this machine — run /login to reconnect.`,
    }
  }
  const nowMs = input.nowMs ?? Date.now()
  if (session.expiresAtMs <= nowMs && !session.idpRefreshToken) {
    return {
      status: 'expired',
      host,
      message: 'Cloud gateway session expired — run /login to reconnect.',
    }
  }
  if (input.probeError) {
    return {
      status: 'tls_probe_failed',
      host,
      message: input.probeError,
      proceed: true,
      session,
    }
  }
  if (input.liveFingerprint !== undefined && input.liveFingerprint !== null) {
    if (!matchesGatewayTlsPin(input.liveFingerprint, pinned)) {
      const live = normalizeGatewayTlsFingerprint(input.liveFingerprint)
      return {
        status: 'tls_mismatch',
        host,
        pinned,
        live,
        message: `Cloud gateway ${host} TLS certificate changed since you connected — run /login to verify and reconnect.`,
      }
    }
  }
  return { status: 'restore', host, session, pinned }
}

export type RestoreGatewayAuthResult =
  | { status: 'env_applied'; session: GatewayAuthSession }
  | { status: 'restored'; session: GatewayAuthSession }
  | { status: 'skipped'; reason: string }
  | { status: 'blocked'; reason: string; message?: string }

/**
 * Official uRi densable consumer — env pin first, else restore enterprise
 * credential when TLS pin allows. Injectable storage + probe.
 */
export async function restoreGatewayAuth(input?: {
  env?: NodeJS.ProcessEnv
  /**
   * When omitted, lazy secureStorage readAsync/read.
   */
  readStorage?: () =>
    | Promise<Record<string, unknown> | null>
    | Record<string, unknown>
    | null
  /**
   * Official VPr — probe live TLS fingerprint for gateway URL.
   * When omitted, uses defaultProbeGatewayTlsFingerprint (real tls.connect).
   * Pass `probeFingerprint: null` to skip live probe (sync restore path).
   */
  probeFingerprint?:
    | null
    | ((
        url: string,
      ) =>
        | Promise<{ fingerprint: string } | null>
        | { fingerprint: string }
        | null)
  /**
   * Official cn() — when true, suppress stderr user messages.
   */
  quiet?: boolean
  writeStderr?: (msg: string) => void
  log?: (msg: string, level?: 'warn' | 'debug') => void
  apply?: (session: GatewayAuthSession) => void
  nowMs?: number
}): Promise<RestoreGatewayAuthResult> {
  const env = input?.env ?? process.env
  const envResult = resolveGatewayFromEnv(env)
  if (envResult.status === 'ok') {
    ;(input?.apply ?? setGatewayAuth)(envResult.session)
    return { status: 'env_applied', session: envResult.session }
  }
  if (envResult.status === 'invalid_url') {
    throw new Error(envResult.message)
  }
  if (envResult.status === 'missing') {
    input?.log?.(envResult.message, 'warn')
  }

  let storageData: Record<string, unknown> | null = null
  try {
    if (input?.readStorage) {
      storageData = await input.readStorage()
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSecureStorage } =
        require('./secureStorage/index.js') as typeof import('./secureStorage/index.js')
      const host = getSecureStorage()
      storageData =
        ((await host.readAsync?.()) as Record<string, unknown> | null) ??
        (host.read() as Record<string, unknown> | null)
    }
  } catch (err) {
    input?.log?.(
      `[gateway] secureStorage read failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      'warn',
    )
    return { status: 'skipped', reason: 'storage_read_failed' }
  }

  const session = parseEnterpriseGatewayCredential(
    storageData?.enterpriseGateway,
  )
  if (!session) return { status: 'skipped', reason: 'no_credential' }

  let liveFingerprint: string | null | undefined
  let probeError: string | null = null
  // Official VPr: default live probe when not explicitly skipped (null).
  const probeFn =
    input?.probeFingerprint === null
      ? null
      : (input?.probeFingerprint ?? defaultProbeGatewayTlsFingerprint)
  if (probeFn) {
    try {
      const probe = await probeFn(session.url)
      liveFingerprint = probe?.fingerprint ?? null
      if (liveFingerprint === null) {
        probeError = 'could not read TLS certificate fingerprint'
      }
    } catch (err) {
      probeError = err instanceof Error ? err.message : String(err)
    }
  }

  const plan = planRestoreGatewayAuth({
    storageData,
    nowMs: input?.nowMs,
    liveFingerprint,
    probeError,
  })

  const stderr = input?.writeStderr ?? (msg => process.stderr.write(msg))
  const quiet = input?.quiet === true

  if (plan.status === 'untrusted' || plan.status === 'expired') {
    if (!quiet) stderr(`${plan.message}\n`)
    return {
      status: 'blocked',
      reason: plan.status,
      message: plan.message,
    }
  }
  if (plan.status === 'tls_mismatch') {
    if (!quiet) stderr(`${plan.message}\n`)
    input?.log?.(
      `[gateway] TLS fingerprint mismatch on restore for ${plan.host}: pinned ${plan.pinned}, live ${plan.live}`,
      'warn',
    )
    return {
      status: 'blocked',
      reason: 'tls_mismatch',
      message: plan.message,
    }
  }
  if (plan.status === 'tls_probe_failed') {
    input?.log?.(
      `[gateway] TLS fingerprint probe failed on restore for ${plan.host} (${plan.message}); proceeding without re-verify`,
      'debug',
    )
    ;(input?.apply ?? setGatewayAuth)(plan.session)
    return { status: 'restored', session: plan.session }
  }
  if (plan.status === 'restore') {
    // When probe not provided, still restore (pin present + not expired).
    ;(input?.apply ?? setGatewayAuth)(plan.session)
    return { status: 'restored', session: plan.session }
  }
  return { status: 'skipped', reason: plan.status }
}

/**
 * Sync restore densable for getAnthropicClient path — secureStorage.read()
 * without live TLS probe (proceed when pin present). Full probe remains denser
 * via restoreGatewayAuth({ probeFingerprint }).
 *
 * Default host (no injectable `storage`) is process-level negative-cached:
 * only the first miss path hits disk; subsequent calls return
 * `already_attempted` until invalidateGatewaySecureStorageRestoreCache /
 * clearGatewayAuth / successful persist. Injectable `storage` always reads
 * (tests / callers that supply their own host).
 */
export function tryRestoreGatewayAuthFromSecureStorage(input?: {
  storage?: {
    read: () => Record<string, unknown> | null
  }
  apply?: (session: GatewayAuthSession) => void
  nowMs?: number
  quiet?: boolean
  writeStderr?: (msg: string) => void
  /**
   * When true, bypass negative cache for this call (still marks attempted
   * after a default-host read). Used by tests that need a forced re-read.
   */
  force?: boolean
}): RestoreGatewayAuthResult {
  const useDefaultHost = !input?.storage
  const nowMs = gatewaySecureStorageNowMs()
  if (useDefaultHost && !input?.force) {
    if (secureStorageRestoreAttempted) {
      return { status: 'skipped', reason: 'already_attempted' }
    }
    if (
      secureStorageReadFailBackoffUntilMs > 0 &&
      nowMs < secureStorageReadFailBackoffUntilMs
    ) {
      return { status: 'skipped', reason: 'storage_read_backoff' }
    }
  }

  let storageData: Record<string, unknown> | null = null
  try {
    if (input?.storage) {
      storageData = input.storage.read()
    } else {
      if (testSecureStorageRead) {
        storageData = testSecureStorageRead()
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getSecureStorage } =
          require('./secureStorage/index.js') as typeof import('./secureStorage/index.js')
        storageData = getSecureStorage().read() as Record<
          string,
          unknown
        > | null
      }
    }
  } catch {
    if (useDefaultHost) {
      // Transient IO failure: short backoff, not permanent negative cache.
      secureStorageReadFailBackoffUntilMs =
        nowMs + GATEWAY_SECURE_STORAGE_READ_FAIL_BACKOFF_MS
      secureStorageRestoreAttempted = false
    }
    return { status: 'skipped', reason: 'storage_read_failed' }
  }

  // Successful read: clear fail-backoff; mark permanent miss cache after plan.
  if (useDefaultHost) {
    secureStorageReadFailBackoffUntilMs = 0
  }

  const plan = planRestoreGatewayAuth({
    storageData,
    nowMs: input?.nowMs,
  })
  if (plan.status === 'restore' || plan.status === 'tls_probe_failed') {
    const session = plan.status === 'restore' ? plan.session : plan.session
    ;(input?.apply ?? setGatewayAuth)(session)
    // Restored session is in memory; further cold reads are unnecessary until
    // clear/invalidate. Mark attempted so ensureGatewayAuthApplied stays cheap.
    if (useDefaultHost) {
      secureStorageRestoreAttempted = true
    }
    return { status: 'restored', session }
  }
  if (plan.status === 'untrusted' || plan.status === 'expired') {
    if (useDefaultHost) {
      secureStorageRestoreAttempted = true
    }
    if (input?.quiet !== true) {
      ;(input?.writeStderr ?? (m => process.stderr.write(m)))(
        `${plan.message}\n`,
      )
    }
    return { status: 'blocked', reason: plan.status, message: plan.message }
  }
  if (useDefaultHost) {
    // no_credential / other permanent misses
    secureStorageRestoreAttempted = true
  }
  return { status: 'skipped', reason: plan.status }
}

// ---------------------------------------------------------------------------
// Official VPr live TLS probe + B_c pin Agent densables
// ---------------------------------------------------------------------------

/** Official VPr default timeout (10s). */
export const DEFAULT_GATEWAY_TLS_PROBE_TIMEOUT_MS = 10_000

/** Official non-https restore fingerprint sentinel. */
export const GATEWAY_HTTP_LOOPBACK_FINGERPRINT = 'http-loopback'

export type GatewayTlsProbeResult = {
  hostname: string
  fingerprint: string
}

/**
 * Official VPr densable pure plan — non-https URLs short-circuit to
 * http-loopback fingerprint (no live socket).
 */
export function planGatewayTlsProbe(
  url: string,
):
  | { status: 'http_loopback'; hostname: string; fingerprint: string }
  | { status: 'probe'; hostname: string; host: string; port: number }
  | { status: 'invalid_url'; message: string } {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
    if (parsed.protocol !== 'https:') {
      return {
        status: 'http_loopback',
        hostname,
        fingerprint: GATEWAY_HTTP_LOOPBACK_FINGERPRINT,
      }
    }
    const port = parsed.port ? Number(parsed.port) : 443
    return { status: 'probe', hostname, host: hostname, port }
  } catch (err) {
    return {
      status: 'invalid_url',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Official B_c checkServerIdentity densable — first default hostname check,
 * then fingerprint pin match. Returns Error on mismatch (official FBn).
 */
export function createGatewayTlsPinCheckServerIdentity(
  pinnedFingerprint: string,
  checkServerIdentity?: (
    hostname: string,
    cert: { fingerprint256?: string },
  ) => Error | undefined,
): (hostname: string, cert: { fingerprint256?: string }) => Error | undefined {
  const pin = normalizeGatewayTlsFingerprint(pinnedFingerprint)
  return (hostname, cert) => {
    if (checkServerIdentity) {
      const baseErr = checkServerIdentity(hostname, cert)
      if (baseErr) return baseErr
    }
    const live =
      typeof cert?.fingerprint256 === 'string'
        ? normalizeGatewayTlsFingerprint(cert.fingerprint256)
        : ''
    if (live !== pin) {
      return new Error(GATEWAY_TLS_PIN_MISMATCH_MESSAGE)
    }
    return undefined
  }
}

/**
 * Official B_c densable — https.Agent with mTLS/CA + checkServerIdentity pin.
 * Injectable Agent/checkServerIdentity for tests; production uses node:https/tls.
 */
export function createPinnedGatewayHttpsAgent(
  pinnedFingerprint: string,
  opts?: {
    ca?: string | string[] | Buffer
    cert?: string
    key?: string
    passphrase?: string
    Agent?: new (options?: Record<string, unknown>) => unknown
    checkServerIdentity?: (
      hostname: string,
      cert: { fingerprint256?: string },
    ) => Error | undefined
  },
): unknown {
  // Lazy defaults so pure densable tests need not import https/tls.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const httpsMod = opts?.Agent
    ? null
    : (require('https') as typeof import('https'))
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tlsMod = opts?.checkServerIdentity
    ? null
    : (require('tls') as typeof import('tls'))
  const AgentCtor = opts?.Agent ?? httpsMod!.Agent
  const baseCheck =
    opts?.checkServerIdentity ??
    ((hostname: string, cert: { fingerprint256?: string }) =>
      tlsMod!.checkServerIdentity(
        hostname,
        cert as import('tls').PeerCertificate,
      ))
  return new AgentCtor({
    ...(opts?.ca !== undefined ? { ca: opts.ca } : {}),
    ...(opts?.cert !== undefined ? { cert: opts.cert } : {}),
    ...(opts?.key !== undefined ? { key: opts.key } : {}),
    ...(opts?.passphrase !== undefined ? { passphrase: opts.passphrase } : {}),
    checkServerIdentity: createGatewayTlsPinCheckServerIdentity(
      pinnedFingerprint,
      baseCheck,
    ),
  })
}

/**
 * Official VPr densable — probe live TLS fingerprint256 for gateway URL.
 * Supports injectable connect (tests) and optional proxy CONNECT socket.
 * Default path: tls.connect with CA/mTLS from caCerts/mtls when available.
 */
export async function probeGatewayTlsFingerprint(
  url: string,
  opts?: {
    timeoutMs?: number
    /**
     * Injectable connect densable — when provided, used instead of real
     * tls.connect. Must emit 'secureConnect' or call onSecure immediately
     * with a peer cert, or error/timeout.
     */
    connect?: (input: {
      host: string
      port: number
      servername: string
      timeoutMs: number
      socket?: unknown
      ca?: string | string[] | Buffer
      cert?: string
      key?: string
      passphrase?: string
    }) => Promise<{ fingerprint256?: string } | null>
    getCa?: () => string | string[] | Buffer | undefined
    getMtls?: () =>
      | { cert?: string; key?: string; passphrase?: string }
      | undefined
    getProxyUrl?: () => string | undefined
    /**
     * Official ITh densable — open proxy CONNECT tunnel to host:port.
     * When omitted and proxy URL present, probe skips proxy (direct connect).
     */
    proxyConnect?: (
      proxyUrl: string,
      host: string,
      port: number,
      timeoutMs: number,
    ) => Promise<unknown>
    /**
     * Official bie densable — when true, skip proxy for this gateway URL.
     * Defaults to loopback hostnames.
     */
    shouldSkipProxy?: (gatewayUrl: string) => boolean
  },
): Promise<GatewayTlsProbeResult> {
  const plan = planGatewayTlsProbe(url)
  if (plan.status === 'invalid_url') {
    throw new Error(plan.message)
  }
  if (plan.status === 'http_loopback') {
    return { hostname: plan.hostname, fingerprint: plan.fingerprint }
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_GATEWAY_TLS_PROBE_TIMEOUT_MS
  const ca = opts?.getCa?.()
  const mtls = opts?.getMtls?.()
  const proxyUrl = opts?.getProxyUrl?.()
  const skipProxy =
    opts?.shouldSkipProxy?.(url) ??
    (() => {
      const h = plan.host.toLowerCase()
      return (
        h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
      )
    })()

  let socket: unknown
  if (proxyUrl && !skipProxy && opts?.proxyConnect) {
    socket = await opts.proxyConnect(proxyUrl, plan.host, plan.port, timeoutMs)
  }

  if (opts?.connect) {
    const peer = await opts.connect({
      host: plan.host,
      port: plan.port,
      servername: plan.hostname,
      timeoutMs,
      socket,
      ...(ca !== undefined ? { ca } : {}),
      ...(mtls?.cert !== undefined ? { cert: mtls.cert } : {}),
      ...(mtls?.key !== undefined ? { key: mtls.key } : {}),
      ...(mtls?.passphrase !== undefined
        ? { passphrase: mtls.passphrase }
        : {}),
    })
    const f =
      typeof peer?.fingerprint256 === 'string'
        ? normalizeGatewayTlsFingerprint(peer.fingerprint256)
        : ''
    if (!f) throw new Error('could not read TLS certificate fingerprint')
    return { hostname: plan.hostname, fingerprint: f }
  }

  // Production path: real tls.connect (official VPr / MBn.connect).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tls = require('tls') as typeof import('tls')
  return await new Promise<GatewayTlsProbeResult>((resolve, reject) => {
    let settled = false
    const finish = (err?: Error, result?: GatewayTlsProbeResult) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else if (result) resolve(result)
    }
    const socketOpts: import('tls').ConnectionOptions = {
      host: plan.host,
      port: plan.port,
      servername: plan.hostname,
      ...(socket ? { socket: socket as import('net').Socket } : {}),
      ...(ca !== undefined ? { ca } : {}),
      ...(mtls?.cert !== undefined ? { cert: mtls.cert } : {}),
      ...(mtls?.key !== undefined ? { key: mtls.key } : {}),
      ...(mtls?.passphrase !== undefined
        ? { passphrase: mtls.passphrase }
        : {}),
    }
    // Prefer getCa/getMtls injectables; else lazy load real ca/mtls densables.
    if (ca === undefined && !opts?.getCa) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getCACertificates } =
          require('./caCerts.js') as typeof import('./caCerts.js')
        const realCa = getCACertificates()
        if (realCa) socketOpts.ca = realCa
      } catch {
        // optional
      }
    }
    if (!mtls && !opts?.getMtls) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getMTLSConfig } =
          require('./mtls.js') as typeof import('./mtls.js')
        const realMtls = getMTLSConfig()
        if (realMtls?.cert) socketOpts.cert = realMtls.cert
        if (realMtls?.key) socketOpts.key = realMtls.key
        if (realMtls?.passphrase) socketOpts.passphrase = realMtls.passphrase
      } catch {
        // optional
      }
    }

    const d = tls.connect(socketOpts, () => {
      try {
        const p = d.getPeerCertificate()
        const f =
          typeof p?.fingerprint256 === 'string'
            ? normalizeGatewayTlsFingerprint(p.fingerprint256)
            : ''
        d.destroy()
        if (!f) {
          finish(new Error('could not read TLS certificate fingerprint'))
        } else {
          finish(undefined, { hostname: plan.hostname, fingerprint: f })
        }
      } catch (err) {
        d.destroy()
        finish(err instanceof Error ? err : new Error(String(err)))
      }
    })
    d.setTimeout(timeoutMs)
    d.once('error', err => {
      finish(err instanceof Error ? err : new Error(String(err)))
    })
    d.once('timeout', () => {
      d.destroy()
      try {
        ;(socket as { destroy?: () => void } | undefined)?.destroy?.()
      } catch {
        // ignore
      }
      finish(new Error('TLS connection timed out'))
    })
  })
}

/**
 * Official proxy CONNECT densable (ITh) — tunnel via HTTP(S) proxy for VPr.
 * Injectable request for tests; production uses http/https.request CONNECT.
 */
export async function proxyConnectForGatewayTlsProbe(
  proxyUrl: string,
  host: string,
  port: number,
  timeoutMs: number = DEFAULT_GATEWAY_TLS_PROBE_TIMEOUT_MS,
  deps?: {
    httpRequest?: typeof import('http').request
    httpsRequest?: typeof import('https').request
    getCa?: () => string | string[] | Buffer | undefined
    getMtls?: () =>
      | { cert?: string; key?: string; passphrase?: string }
      | undefined
  },
): Promise<import('net').Socket> {
  const o = new URL(proxyUrl)
  const isHttps = o.protocol === 'https:'
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const httpMod = deps?.httpRequest
    ? null
    : (require('http') as typeof import('http'))
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const httpsMod = deps?.httpsRequest
    ? null
    : (require('https') as typeof import('https'))
  const request = isHttps
    ? (deps?.httpsRequest ?? httpsMod!.request)
    : (deps?.httpRequest ?? httpMod!.request)
  const targetHost = host.includes(':') ? `[${host}]` : host
  const headers: Record<string, string> = {
    Host: `${targetHost}:${port}`,
  }
  if (o.username) {
    const u = `${decodeURIComponent(o.username)}:${decodeURIComponent(o.password)}`
    headers['Proxy-Authorization'] =
      'Basic ' + Buffer.from(u).toString('base64')
  }
  const ca = deps?.getCa?.()
  const mtls = deps?.getMtls?.()
  return await new Promise((resolve, reject) => {
    const req = request({
      host: o.hostname,
      port: o.port || (isHttps ? 443 : 80),
      method: 'CONNECT',
      path: `${targetHost}:${port}`,
      timeout: timeoutMs,
      headers,
      ...(isHttps && ca !== undefined ? { ca } : {}),
      ...(isHttps && mtls?.cert ? { cert: mtls.cert } : {}),
      ...(isHttps && mtls?.key ? { key: mtls.key } : {}),
      ...(isHttps && mtls?.passphrase ? { passphrase: mtls.passphrase } : {}),
    })
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`proxy CONNECT failed: ${res.statusCode}`))
      } else {
        resolve(socket)
      }
    })
    req.once('error', err => {
      reject(err instanceof Error ? err : new Error(String(err)))
    })
    req.once('timeout', () => {
      req.destroy()
      reject(new Error('proxy CONNECT timed out'))
    })
    req.end()
  })
}

/**
 * Default VPr probe for restoreGatewayAuth — uses real tls + optional proxy.
 */
export async function defaultProbeGatewayTlsFingerprint(
  url: string,
  timeoutMs: number = DEFAULT_GATEWAY_TLS_PROBE_TIMEOUT_MS,
): Promise<GatewayTlsProbeResult | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getProxyUrl } = require('./proxy.js') as typeof import('./proxy.js')
    return await probeGatewayTlsFingerprint(url, {
      timeoutMs,
      getProxyUrl: () => getProxyUrl(),
      proxyConnect: (proxyUrl, host, port, t) =>
        proxyConnectForGatewayTlsProbe(proxyUrl, host, port, t),
    })
  } catch {
    return null
  }
}
