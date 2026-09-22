/**
 * densable 2.1.248 #24 — connect-time `ko` / `x6e` / `gC`.
 *
 * When `headers.Authorization` is already set (static or headersHelper-minted),
 * 401/403 must not fall into OAuth discovery (`Yo`). Official SEA:
 * `OAuth fallback is disabled when headers.Authorization is set` and
 * `OAuth fallback is disabled when the helper supplies Authorization`.
 *
 * Unique vs 247: `helperMintsAuthHeader` → `HEADERS_HELPER_AUTH_REJECTED`.
 * 247 `MQr` only had `hasUserAuthHeader` → `AUTH_HEADER_REJECTED`.
 */

export const AUTH_HEADER_REJECTED = 'AUTH_HEADER_REJECTED'
export const HEADERS_HELPER_AUTH_REJECTED = 'HEADERS_HELPER_AUTH_REJECTED'

export type ConnectAuthHeaderErrorCode =
  | typeof AUTH_HEADER_REJECTED
  | typeof HEADERS_HELPER_AUTH_REJECTED

export type ConnectAuthHeaderRejection = {
  errorCode: ConnectAuthHeaderErrorCode
  message: string
  displayDetail?: string
}

export type ConnectAuthFlags = {
  hasUserAuthHeader: boolean
  helperMintsAuthHeader: boolean
}

/** Official `x6e` — any header key is Authorization (case-insensitive). */
export function headersHaveAuthorization(
  headers: Record<string, string> | undefined,
): boolean {
  return Object.keys(headers ?? {}).some(
    key => key.toLowerCase() === 'authorization',
  )
}

/**
 * Official `ce` / `gC(t)`: http/sse static config headers already have
 * Authorization.
 */
export function hasUserAuthHeader(config: {
  type?: string
  headers?: Record<string, string>
}): boolean {
  return (
    (config.type === 'sse' || config.type === 'http') &&
    headersHaveAuthorization(config.headers)
  )
}

/**
 * Official `re`: http/sse + headersHelper + minted bag (`$Ze` / G) has
 * Authorization.
 */
export function helperMintsAuthHeader(
  config: { type?: string; headersHelper?: string },
  mintedHeaders: Record<string, string>,
): boolean {
  return (
    (config.type === 'sse' || config.type === 'http') &&
    !!config.headersHelper &&
    headersHaveAuthorization(mintedHeaders)
  )
}

export function resolveConnectAuthFlags(
  config: {
    type?: string
    headers?: Record<string, string>
    headersHelper?: string
  },
  mintedHeaders: Record<string, string>,
): ConnectAuthFlags {
  return {
    hasUserAuthHeader: hasUserAuthHeader(config),
    helperMintsAuthHeader: helperMintsAuthHeader(config, mintedHeaders),
  }
}

/**
 * Official `k=ce||re||L||me?void 0:new EFe`. Leftover has no cliOwned / first-
 * party auto-auth host — only land the Authorization-already-set pair.
 */
export function shouldSkipOAuthAuthProvider(flags: ConnectAuthFlags): boolean {
  return flags.hasUserAuthHeader || flags.helperMintsAuthHeader
}

export function connectAuthStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const e = error as { status?: unknown; code?: unknown }
  if (typeof e.status === 'number') return e.status
  if (typeof e.code === 'number') return e.code
  return undefined
}

function isUnauthorizedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'UnauthorizedError' ||
      error.constructor.name === 'UnauthorizedError')
  )
}

/**
 * Official `ko` gate: `DE || (Gk && sawAuthChallenge) || 401 || 403`.
 * Leftover has no connect-time Zod/sawAuthChallenge host — 401/403 /
 * UnauthorizedError only.
 */
export function isConnectAuthFailureCandidate(opts: {
  error: unknown
  statusCode?: number
}): boolean {
  if (isUnauthorizedError(opts.error)) return true
  return opts.statusCode === 401 || opts.statusCode === 403
}

/** Official `JR` input: StreamableHTTP `data.text` else `message`. */
export function connectAuthErrorDetail(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const text = (error as { data?: { text?: unknown } }).data?.text
    if (typeof text === 'string' && text.trim() !== '') return text
  }
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message
  }
  return ''
}

/**
 * Official `ko` Authorization arms only. Returns undefined so the caller can
 * fall through to leftover `handleRemoteAuthFailure` / OAuth (`Yo`).
 */
export function classifyConnectAuthHeaderRejection(opts: {
  error: unknown
  statusCode?: number
  hasUserAuthHeader: boolean
  helperMintsAuthHeader: boolean
}): ConnectAuthHeaderRejection | undefined {
  if (!isConnectAuthFailureCandidate(opts)) return undefined
  const status = opts.statusCode ?? 401
  const detail = connectAuthErrorDetail(opts.error)
  const displayDetail =
    detail !== '' ? { displayDetail: `Error detail: ${detail}` } : {}
  if (opts.hasUserAuthHeader) {
    return {
      errorCode: AUTH_HEADER_REJECTED,
      message:
        `Server rejected the configured Authorization header (HTTP ${status}). ` +
        'Check that the token is valid for this MCP endpoint — OAuth fallback is ' +
        'disabled when headers.Authorization is set.',
      ...displayDetail,
    }
  }
  if (opts.helperMintsAuthHeader) {
    return {
      errorCode: HEADERS_HELPER_AUTH_REJECTED,
      message:
        `Server rejected the Authorization header minted by the configured headersHelper (HTTP ${status}). ` +
        'Check that the helper command returns a valid credential for this MCP endpoint — OAuth fallback is ' +
        'disabled when the helper supplies Authorization.',
      ...displayDetail,
    }
  }
  return undefined
}
