import type { Context, Next } from 'hono'
import { config } from '../config'
import { validateApiKey } from './api-key'
import { isWebSocketOriginAllowed } from './cors'
import { verifyWorkerJwt } from './jwt'
import { resolveToken } from './token'

const WS_AUTH_PROTOCOL_PREFIX = 'rcs.auth.'

/** Encode a bearer token for WebSocket clients that cannot send auth headers. */
export function encodeWebSocketAuthProtocol(token: string): string {
  return `${WS_AUTH_PROTOCOL_PREFIX}${Buffer.from(token, 'utf8').toString('base64url')}`
}

function decodeWebSocketAuthProtocol(
  protocolHeader: string | undefined,
): string | undefined {
  if (!protocolHeader) {
    return undefined
  }

  for (const protocol of protocolHeader.split(',')) {
    const trimmed = protocol.trim()
    if (!trimmed.startsWith(WS_AUTH_PROTOCOL_PREFIX)) {
      continue
    }

    const encoded = trimmed.slice(WS_AUTH_PROTOCOL_PREFIX.length)
    if (!encoded) {
      return undefined
    }

    try {
      const token = Buffer.from(encoded, 'base64url').toString('utf8')
      return token.length > 0 ? token : undefined
    } catch {
      return undefined
    }
  }

  return undefined
}

/** Extract a Bearer token from the Authorization header only. */
export function extractBearerToken(c: Context): string | undefined {
  const authHeader = c.req.header('Authorization')
  return authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : undefined
}

/** Extract auth for WebSocket upgrades without putting secrets in query strings. */
export function extractWebSocketAuthToken(c: Context): string | undefined {
  return (
    extractBearerToken(c) ??
    decodeWebSocketAuthProtocol(c.req.header('Sec-WebSocket-Protocol'))
  )
}

/**
 * API-key-only authentication middleware for `/v1/*` CLI/bridge/worker routes (`P1-E5`).
 *
 * Accepts ONLY a valid server API key (`validateApiKey(token)`). Regular Web UI
 * `rct_*` session tokens are explicitly rejected so web clients cannot escalate
 * into privileged `/v1/environments/*`, `/v1/code/sessions/*`, or `/v1/sessions/*`
 * control planes (web clients must use `/web/*` routes guarded by `uuidAuth`).
 */
export async function apiKeyAuth(c: Context, next: Next) {
  const token = extractBearerToken(c)

  if (validateApiKey(token)) {
    // Extract username from X-Username header or ?username= query param
    const username = c.req.header('X-Username') || c.req.query('username')
    if (username) {
      c.set('username', username)
    }
    await next()
    return
  }

  return c.json(
    {
      error: { type: 'unauthorized', message: 'Valid API key required' },
    },
    401,
  )
}

/**
 * Session ingress authentication — accepts both API key and worker JWT.
 *
 * Used for SSE stream, CCR worker events, and WebSocket ingress endpoints.
 * On JWT validation, stores the decoded payload in c.set("jwtPayload") for
 * downstream handlers to inspect session_id if needed.
 */
export async function sessionIngressAuth(c: Context, next: Next) {
  const token = extractWebSocketAuthToken(c)

  if (!token) {
    return c.json(
      { error: { type: 'unauthorized', message: 'Missing auth token' } },
      401,
    )
  }

  // Try API key first (backward compatible)
  if (validateApiKey(token)) {
    await next()
    return
  }

  // Try JWT verification — validate session_id matches route param
  const payload = verifyWorkerJwt(token)
  if (payload) {
    const routeSessionId = c.req.param('id') || c.req.param('sessionId')
    if (routeSessionId && payload.session_id !== routeSessionId) {
      return c.json(
        {
          error: {
            type: 'forbidden',
            message: 'JWT session_id does not match target session',
          },
        },
        403,
      )
    }
    c.set('jwtPayload', payload)
    await next()
    return
  }

  return c.json(
    { error: { type: 'unauthorized', message: 'Invalid API key or JWT' } },
    401,
  )
}

/** Accept CLI headers but don't validate them */
export async function acceptCliHeaders(c: Context, next: Next) {
  await next()
}

/**
 * Extract UUID from request — query param ?uuid= or header X-UUID
 */
export function getUuidFromRequest(c: Context): string | undefined {
  return c.req.query('uuid') || c.req.header('X-UUID')
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) {
    return false
  }
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase())
}

/**
 * Unauthenticated UUID mode is ONLY permitted when BOTH:
 * 1. Explicitly opted in via `--insecure-no-auth`, `RCS_ALLOW_UNAUTHENTICATED_UUID=1`,
 *    or `config.allowUnauthenticatedUuid === true`, AND
 * 2. The server is bound to a loopback interface (`127.0.0.1`, `localhost`, `::1`).
 */
export function isUnauthenticatedUuidAllowed(): boolean {
  if (!isLoopbackHost(config.host)) {
    return false
  }
  const cfgFlag = (config as { allowUnauthenticatedUuid?: boolean })
    .allowUnauthenticatedUuid
  return (
    cfgFlag === true ||
    process.env.RCS_ALLOW_UNAUTHENTICATED_UUID === '1' ||
    process.argv.includes('--insecure-no-auth')
  )
}

/**
 * Require `Content-Type: application/json` on mutating requests (POST/PUT/PATCH/DELETE)
 * to prevent `text/plain` / `application/x-www-form-urlencoded` simple-request CSRF.
 */
export async function requireJsonContentType(c: Context, next: Next) {
  const method = c.req.method.toUpperCase()
  if (
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE'
  ) {
    const raw = c.req.header('Content-Type') ?? ''
    const mediaType = raw.split(';')[0]?.trim().toLowerCase()
    if (mediaType !== 'application/json') {
      return c.json(
        {
          error: {
            type: 'unsupported_media_type',
            message: 'Content-Type must be application/json',
          },
        },
        415,
      )
    }
  }
  await next()
}

/**
 * Enforce `resolveWebCorsOrigin(origin)` when `Origin` header is present on
 * WebSocket upgrade routes.
 */
export async function requireWebSocketOrigin(c: Context, next: Next) {
  const origin = c.req.header('Origin')
  if (!isWebSocketOriginAllowed(origin)) {
    return c.json(
      {
        error: {
          type: 'forbidden',
          message: 'Disallowed WebSocket Origin',
        },
      },
      403,
    )
  }
  await next()
}

/**
 * Hardened authentication middleware for `/web/*` routes (E5-P0-3).
 *
 * Requires either:
 * 1. A valid server-issued session token (`resolveToken(bearer)`) — pins `uuid` to
 *    the verified username so token holders cannot spoof another user's UUID, OR
 * 2. A valid API key (`validateApiKey(bearer)`) — allows optional `X-UUID`/`?uuid=`
 *    scoping for CLI/bridge/admin callers, OR
 * 3. ONLY when explicitly opted in on loopback (`--insecure-no-auth` /
 *    `RCS_ALLOW_UNAUTHENTICATED_UUID=1`), a client-supplied UUID.
 */
export async function uuidAuth(c: Context, next: Next) {
  const bearer = extractBearerToken(c)

  // 1. Server-issued session token
  const tokenUsername = resolveToken(bearer)
  if (tokenUsername) {
    c.set('username', tokenUsername)
    c.set('uuid', tokenUsername)
    await next()
    return
  }

  // 2. Valid API key
  if (bearer && validateApiKey(bearer)) {
    const uuid = getUuidFromRequest(c)
    c.set('uuid', uuid || bearer)
    await next()
    return
  }

  // 3. Explicit loopback-only unauthenticated UUID opt-in
  if (isUnauthenticatedUuidAllowed()) {
    const uuid = getUuidFromRequest(c)
    if (!uuid) {
      return c.json(
        { error: { type: 'unauthorized', message: 'Missing UUID' } },
        401,
      )
    }
    c.set('uuid', uuid)
    await next()
    return
  }

  return c.json(
    {
      error: {
        type: 'unauthorized',
        message: 'Valid API key or session token required',
      },
    },
    401,
  )
}
