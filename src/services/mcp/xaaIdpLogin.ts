/**
 * XAA IdP Login — acquires an OIDC id_token from an enterprise IdP via the
 * standard authorization_code + PKCE flow, then caches it by IdP issuer.
 *
 * This is the "one browser pop" in the XAA value prop: one IdP login → N silent
 * MCP server auths. The id_token is cached in the keychain and reused until expiry.
 */

import {
  exchangeAuthorization,
  startAuthorization,
  type FetchLike,
  type OAuthClientInformation,
  type OpenIdProviderDiscoveryMetadata,
} from '@modelcontextprotocol/client'

/** Structural OIDC discovery — required token_endpoint for XAA HTTPS gate. */
function parseOpenIdProviderDiscoveryMetadata(
  value: unknown,
): OpenIdProviderDiscoveryMetadata {
  if (!value || typeof value !== 'object') {
    throw new Error('XAA IdP: invalid OIDC metadata: not an object')
  }
  const v = value as Record<string, unknown>
  if (typeof v.token_endpoint !== 'string' || v.token_endpoint.length === 0) {
    throw new Error('XAA IdP: invalid OIDC metadata: missing token_endpoint')
  }
  return value as OpenIdProviderDiscoveryMetadata
}
import { randomBytes } from 'crypto'
import { createServer, request as httpRequest, type Server } from 'http'
import { request as httpsRequest } from 'https'
import type * as undici from 'undici'
import { parse } from 'url'
import xss from 'xss'
import { openBrowser } from '../../utils/browser.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { toError } from '../../utils/errors.js'
import {
  isBlockedHostnameOrIp,
  ssrfGuardedLookup,
} from '../../utils/hooks/ssrfGuard.js'
import { logMCPDebug } from '../../utils/log.js'
import { getPlatform } from '../../utils/platform.js'
import { getSecureStorage } from '../../utils/secureStorage/index.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { jsonParse } from '../../utils/slowOperations.js'
import { buildRedirectUri, findAvailablePort } from './oauthPort.js'

export function isXaaEnabled(): boolean {
  // Official ENABLE_XAA densable.
  try {
    const { isXaaEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    return isXaaEnvEnabled()
  } catch {
    return isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_XAA)
  }
}

export type XaaIdpSettings = {
  issuer: string
  clientId: string
  callbackPort?: number
}

/**
 * Typed accessor for settings.xaaIdp. The field is env-gated in SettingsSchema
 * so it doesn't surface in SDK types/docs — which means the inferred settings
 * type doesn't have it at compile time. This is the one cast.
 */
export function getXaaIdpSettings(): XaaIdpSettings | undefined {
  return (getInitialSettings() as { xaaIdp?: XaaIdpSettings }).xaaIdp
}

const IDP_LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const IDP_REQUEST_TIMEOUT_MS = 30000
const ID_TOKEN_EXPIRY_BUFFER_S = 60

export type IdpLoginOptions = {
  idpIssuer: string
  idpClientId: string
  /**
   * Optional IdP client secret for confidential clients. Auth method
   * (client_secret_post, client_secret_basic, none) is chosen per IdP
   * metadata. Omit for public clients (PKCE only).
   */
  idpClientSecret?: string
  /**
   * Fixed callback port. If omitted, a random port is chosen.
   * Use this when the IdP client is pre-registered with a specific loopback
   * redirect URI (RFC 8252 §7.3 says IdPs SHOULD accept any port for
   * http://localhost, but many don't).
   */
  callbackPort?: number
  /** Called with the authorization URL before (or instead of) opening the browser */
  onAuthorizationUrl?: (url: string) => void
  /** If true, don't auto-open the browser — just call onAuthorizationUrl */
  skipBrowserOpen?: boolean
  abortSignal?: AbortSignal
}

/**
 * Normalize an IdP issuer URL for use as a cache key: strip trailing slashes,
 * lowercase host. Issuers from config and from OIDC discovery may differ
 * cosmetically but should hit the same cache slot. Exported so the setup
 * command can compare issuers using the same normalization as keychain ops.
 */
export function issuerKey(issuer: string): string {
  try {
    const u = new URL(issuer)
    u.pathname = u.pathname.replace(/\/+$/, '')
    u.host = u.host.toLowerCase()
    return u.toString()
  } catch {
    return issuer.replace(/\/+$/, '')
  }
}

/**
 * Read a cached id_token for the given IdP issuer from secure storage.
 * Returns undefined if missing or within ID_TOKEN_EXPIRY_BUFFER_S of expiring.
 */
export function getCachedIdpIdToken(idpIssuer: string): string | undefined {
  const storage = getSecureStorage()
  const data = storage.read()
  const entry = data?.mcpXaaIdp?.[issuerKey(idpIssuer)]
  if (!entry) return undefined
  const remainingMs = entry.expiresAt - Date.now()
  if (remainingMs <= ID_TOKEN_EXPIRY_BUFFER_S * 1000) return undefined
  return entry.idToken
}

function saveIdpIdToken(
  idpIssuer: string,
  idToken: string,
  expiresAt: number,
): void {
  const storage = getSecureStorage()
  const existing = storage.read() || {}
  storage.update({
    ...existing,
    mcpXaaIdp: {
      ...existing.mcpXaaIdp,
      [issuerKey(idpIssuer)]: { idToken, expiresAt },
    },
  })
}

const BASE64URL_SEGMENT_RE = /^[A-Za-z0-9_-]+$/
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function isLoopbackHttpUrl(u: URL): boolean {
  return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname.toLowerCase())
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Save an externally-obtained id_token into the XAA cache — the exact slot
 * getCachedIdpIdToken/acquireIdpIdToken read from. Used by conformance testing
 * where the mock IdP hands us a pre-signed token but doesn't serve /authorize.
 *
 * Validates 3-segment base64url JWT structure, parses header & payload JSON,
 * rejects already-expired `exp <= now`, and verifies `iss` matches `idpIssuer`
 * when present. Returns the computed `expiresAt` (ms).
 */
export function saveIdpIdTokenFromJwt(
  idpIssuer: string,
  idToken: string,
): number {
  const trimmed = idToken.trim()
  const parts = trimmed.split('.')
  if (
    parts.length !== 3 ||
    !parts.every(part => part.length > 0 && BASE64URL_SEGMENT_RE.test(part))
  ) {
    throw new Error(
      'XAA IdP: invalid id_token: expected a 3-segment base64url JWT',
    )
  }

  let header: unknown
  let payload: unknown
  try {
    header = jsonParse(Buffer.from(parts[0]!, 'base64url').toString('utf-8'))
    payload = jsonParse(Buffer.from(parts[1]!, 'base64url').toString('utf-8'))
  } catch {
    throw new Error(
      'XAA IdP: invalid id_token: header or payload is not valid JSON',
    )
  }

  if (!isPlainJsonObject(header) || !isPlainJsonObject(payload)) {
    throw new Error(
      'XAA IdP: invalid id_token: header and payload must be JSON objects',
    )
  }

  if (typeof payload.iss !== 'string' || payload.iss.trim() === '') {
    throw new Error('XAA IdP: invalid id_token: missing required iss claim')
  }
  if (issuerKey(payload.iss) !== issuerKey(idpIssuer)) {
    throw new Error(
      `XAA IdP: id_token issuer "${payload.iss}" does not match configured issuer "${idpIssuer}"`,
    )
  }

  let expiresAt: number
  if (payload.exp !== undefined) {
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      throw new Error('XAA IdP: invalid id_token: exp claim must be a number')
    }
    expiresAt = payload.exp * 1000
    if (expiresAt <= Date.now()) {
      throw new Error('XAA IdP: id_token is already expired')
    }
  } else {
    expiresAt = Date.now() + 3600 * 1000
  }

  saveIdpIdToken(idpIssuer, trimmed, expiresAt)
  return expiresAt
}

export function clearIdpIdToken(idpIssuer: string): void {
  const storage = getSecureStorage()
  const existing = storage.read()
  const key = issuerKey(idpIssuer)
  if (!existing?.mcpXaaIdp?.[key]) return
  delete existing.mcpXaaIdp[key]
  storage.update(existing)
}

/**
 * Save an IdP client secret to secure storage, keyed by IdP issuer.
 * Separate from MCP server AS secrets — different trust domain.
 * Returns the storage update result so callers can surface keychain
 * failures (locked keychain, `security` nonzero exit) instead of
 * silently dropping the secret and failing later with invalid_client.
 */
export function saveIdpClientSecret(
  idpIssuer: string,
  clientSecret: string,
): { success: boolean; warning?: string } {
  const storage = getSecureStorage()
  const existing = storage.read() || {}
  return storage.update({
    ...existing,
    mcpXaaIdpConfig: {
      ...existing.mcpXaaIdpConfig,
      [issuerKey(idpIssuer)]: { clientSecret },
    },
  })
}

/**
 * Read the IdP client secret for the given issuer from secure storage.
 */
export function getIdpClientSecret(idpIssuer: string): string | undefined {
  const storage = getSecureStorage()
  const data = storage.read()
  return data?.mcpXaaIdpConfig?.[issuerKey(idpIssuer)]?.clientSecret
}

/**
 * Remove the IdP client secret for the given issuer from secure storage.
 * Used by `claude mcp xaa clear`.
 */
export function clearIdpClientSecret(idpIssuer: string): void {
  const storage = getSecureStorage()
  const existing = storage.read()
  const key = issuerKey(idpIssuer)
  if (!existing?.mcpXaaIdpConfig?.[key]) return
  delete existing.mcpXaaIdpConfig[key]
  storage.update(existing)
}

const MAX_OIDC_REDIRECTS = 5
const OIDC_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

export const CROSS_ORIGIN_SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'proxy-authorization',
] as const

export const REDIRECT_POST_TO_GET_STRIP_HEADERS = [
  'content-type',
  'content-length',
  'content-encoding',
  'content-language',
  'content-location',
] as const

/**
 * Clone request headers and strip credential-bearing headers before following
 * a cross-origin redirect (`P1-E3`).
 */
export function stripCrossOriginCredentialHeaders(
  headersInit: RequestInit['headers'],
): Headers {
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  const headers = new Headers(headersInit)
  for (const name of CROSS_ORIGIN_SENSITIVE_HEADERS) {
    headers.delete(name)
  }
  return headers
}

type RequestInitWithDispatcher = RequestInit & {
  dispatcher?: undici.Dispatcher
}

const ssrfDispatcherCache = new WeakMap<
  typeof ssrfGuardedLookup,
  undici.Dispatcher
>()

/**
 * Build (and cache per lookup fn) an undici `Agent` with `connect.lookup`
 * bound directly to `ssrfGuardedLookup` so DNS resolution and TCP connect
 * share a single lookup (eliminating DNS-rebinding TOCTOU on Node.js).
 */
export function createSsrfGuardedUndiciDispatcher(
  lookup: typeof ssrfGuardedLookup = ssrfGuardedLookup,
): undici.Dispatcher | undefined {
  const cached = ssrfDispatcherCache.get(lookup)
  if (cached) return cached
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const undiciMod = require('undici') as typeof undici
    if (typeof undiciMod.Agent !== 'function') return undefined
    const agent = new undiciMod.Agent({
      connect: {
        lookup: (hostname, options, callback) => {
          lookup(hostname, options, (err, address, family) => {
            if (Array.isArray(address)) {
              const normalized = address.map(entry =>
                typeof entry === 'string'
                  ? { address: entry, family: entry.includes(':') ? 6 : 4 }
                  : {
                      address: entry.address,
                      family:
                        entry.family ?? (entry.address.includes(':') ? 6 : 4),
                    },
              )
              callback(err, normalized)
            } else if (typeof address === 'string') {
              callback(err, address, family)
            } else {
              callback(err, address.address, address.family)
            }
          })
        },
      },
    })
    ssrfDispatcherCache.set(lookup, agent)
    return agent
  } catch {
    return undefined
  }
}

function isRunningOnBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
}

async function serializeRequestBody(
  body: RequestInit['body'],
): Promise<Buffer | undefined> {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (body instanceof URLSearchParams) {
    return Buffer.from(body.toString(), 'utf8')
  }
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer())
  }
  // ReadableStream or other BodyInit supported by Response
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  const buf = await new Response(body).arrayBuffer()
  return Buffer.from(buf)
}

/**
 * Node `http`/`https` fetch adapter that binds `lookup` directly to the socket
 * connect call (used on Bun where built-in `fetch` ignores undici `dispatcher`
 * and as fallback when undici is unavailable). Eliminates DNS-rebinding TOCTOU.
 */
async function nodeHttpFetchWithLookup(
  targetUrl: URL,
  init: RequestInit | undefined,
  lookup: typeof ssrfGuardedLookup,
): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  const reqHeaders = new Headers(init?.headers)
  const bodyBuf = await serializeRequestBody(init?.body)
  if (bodyBuf && !reqHeaders.has('content-length')) {
    reqHeaders.set('content-length', String(bodyBuf.byteLength))
  }
  const plainHeaders: Record<string, string> = {}
  reqHeaders.forEach((value, key) => {
    plainHeaders[key] = value
  })

  const signal = init?.signal ?? undefined
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('The operation was aborted')
  }

  return await new Promise<Response>((resolve, reject) => {
    const requestFn =
      targetUrl.protocol === 'https:' ? httpsRequest : httpRequest
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const req = requestFn(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname.replace(/^\[|\]$/g, ''),
        port: targetUrl.port || undefined,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method,
        headers: plainHeaders,
        lookup: (hostname, options, callback) => {
          lookup(hostname, options, (err, address, family) => {
            if (Array.isArray(address)) {
              const normalized = address.map(entry =>
                typeof entry === 'string'
                  ? { address: entry, family: entry.includes(':') ? 6 : 4 }
                  : {
                      address: entry.address,
                      family:
                        entry.family ?? (entry.address.includes(':') ? 6 : 4),
                    },
              )
              callback(err, normalized)
            } else if (typeof address === 'string') {
              callback(err, address, family)
            } else {
              callback(err, address.address, address.family)
            }
          })
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer | string) => {
          chunks.push(
            typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk,
          )
        })
        res.on('error', err => {
          finish(() => reject(err))
        })
        res.on('end', () => {
          finish(() => {
            const status = res.statusCode ?? 200
            // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
            const responseHeaders = new Headers()
            for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
              const name = res.rawHeaders[i]
              const val = res.rawHeaders[i + 1]
              if (name !== undefined && val !== undefined) {
                responseHeaders.append(name, val)
              }
            }
            const hasNullBody =
              method === 'HEAD' || NULL_BODY_STATUSES.has(status)
            const bodyPayload = hasNullBody
              ? null
              : new Uint8Array(Buffer.concat(chunks))
            // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
            resolve(
              new Response(bodyPayload, {
                status,
                statusText: res.statusMessage ?? '',
                headers: responseHeaders,
              }),
            )
          })
        })
      },
    )

    const onAbort = () => {
      const reason =
        signal?.reason instanceof Error
          ? signal.reason
          : new Error('The operation was aborted')
      req.destroy(reason)
      finish(() => reject(reason))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    req.on('error', err => {
      finish(() => reject(err))
    })

    if (bodyBuf && bodyBuf.byteLength > 0) {
      req.end(bodyBuf)
    } else {
      req.end()
    }
  })
}

function isProxyActiveForOidcUrl(href: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getProxyUrl, shouldBypassProxy } =
      require('../../utils/proxy.js') as typeof import('../../utils/proxy.js')
    return Boolean(getProxyUrl()) && !shouldBypassProxy(href)
  } catch {
    return false
  }
}

/**
 * Execute a single HTTP/HTTPS hop with SSRF DNS enforcement bound directly
 * into the transport connector (eliminating DNS-rebinding TOCTOU):
 * - On Node.js: binds `ssrfGuardedLookup` to an undici `Agent({ connect: { lookup } })`
 *   dispatcher passed directly to `fetch()`.
 * - On Bun: binds `ssrfGuardedLookup` directly to `node:http` / `node:https`
 *   `request({ lookup })` (since Bun's built-in `fetch` ignores undici dispatchers).
 * - When a custom `fetchFn` is injected (e.g. unit tests), performs the lookup
 *   check and attaches the undici dispatcher on `init`.
 */
export async function executeSsrfBoundFetchHop(
  targetUrl: URL,
  init: RequestInit | undefined,
  options?: {
    fetchFn?: FetchLike
    lookup?: typeof ssrfGuardedLookup
    errorPrefix?: string
  },
): Promise<Response> {
  const prefix = options?.errorPrefix ?? 'XAA IdP'
  if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
    throw new Error(
      `${prefix}: disallowed URL scheme ${targetUrl.protocol} for ${targetUrl.href}`,
    )
  }
  if (isBlockedHostnameOrIp(targetUrl.hostname, { allowLoopback: true })) {
    throw new Error(`${prefix}: blocked SSRF target ${targetUrl.origin}`)
  }

  const customLookup = options?.lookup
  const useProxy =
    customLookup === undefined && isProxyActiveForOidcUrl(targetUrl.href)
  const effectiveLookup = customLookup ?? ssrfGuardedLookup

  if (options?.fetchFn) {
    if (!useProxy) {
      await new Promise<void>((resolve, reject) => {
        effectiveLookup(targetUrl.hostname, { all: true }, err => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    }
    const reqInit: RequestInitWithDispatcher = { ...(init ?? {}) }
    if (!useProxy && reqInit.dispatcher === undefined) {
      const dispatcher = createSsrfGuardedUndiciDispatcher(effectiveLookup)
      if (dispatcher) {
        reqInit.dispatcher = dispatcher
      }
    }
    return options.fetchFn(targetUrl, reqInit)
  }

  if (useProxy) {
    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    return fetch(targetUrl, init)
  }

  // Real network path: bind lookup directly to the socket connector so there is
  // only ONE DNS lookup per connection (zero DNS-rebinding TOCTOU).
  if (!isRunningOnBun()) {
    const dispatcher = createSsrfGuardedUndiciDispatcher(effectiveLookup)
    if (dispatcher) {
      const reqInit: RequestInitWithDispatcher = {
        ...(init ?? {}),
        dispatcher,
      }
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      return fetch(targetUrl, reqInit)
    }
  }

  return nodeHttpFetchWithLookup(targetUrl, init, effectiveLookup)
}

/**
 * Fetch helper for XAA OIDC discovery & token exchange that binds
 * `ssrfGuardedLookup` directly into the socket connector on every hop,
 * forbids `https:// -> http://` protocol downgrade redirects, strips
 * `authorization`/`cookie`/`proxy-authorization` across origins, and
 * converts 301/302/303 non-GET/HEAD requests to GET without body (P1-E3).
 */
export async function ssrfGuardedOidcFetch(
  input: string | URL,
  init: RequestInit | undefined,
  options?: {
    fetchFn?: FetchLike
    lookup?: typeof ssrfGuardedLookup
    forbidCrossOriginRedirects?: boolean
  },
): Promise<Response> {
  let currentUrl = new URL(String(input))
  let currentInit: RequestInit = { ...(init ?? {}), redirect: 'manual' }
  let currentMethod = (currentInit.method ?? 'GET').toUpperCase()

  for (let hop = 0; ; hop++) {
    const res = await executeSsrfBoundFetchHop(currentUrl, currentInit, {
      fetchFn: options?.fetchFn,
      lookup: options?.lookup,
      errorPrefix: 'XAA IdP',
    })
    const location = OIDC_REDIRECT_STATUSES.has(res.status)
      ? res.headers.get('location')
      : null
    if (!location) {
      return res
    }
    void res.body?.cancel().catch(() => {})
    let nextUrl: URL
    try {
      nextUrl = new URL(location, currentUrl)
    } catch {
      throw new Error(
        `XAA IdP: invalid redirect location "${location}" from ${currentUrl.origin}`,
      )
    }
    if (nextUrl.protocol !== 'https:' && nextUrl.protocol !== 'http:') {
      throw new Error(
        `XAA IdP: refusing redirect to disallowed scheme ${nextUrl.protocol}`,
      )
    }
    if (currentUrl.protocol === 'https:' && nextUrl.protocol === 'http:') {
      throw new Error(
        `XAA IdP: refusing HTTPS to HTTP redirect downgrade from ${currentUrl.origin} to ${nextUrl.origin}`,
      )
    }
    if (
      options?.forbidCrossOriginRedirects &&
      nextUrl.origin !== currentUrl.origin
    ) {
      throw new Error(
        `XAA IdP: refusing cross-origin redirect from ${currentUrl.origin} to ${nextUrl.origin}`,
      )
    }
    if (hop >= MAX_OIDC_REDIRECTS) {
      throw new Error(
        `XAA IdP: too many redirects (>${MAX_OIDC_REDIRECTS}) at ${currentUrl.origin}`,
      )
    }

    let nextInit: RequestInit = currentInit
    // P1-E3: Strip credential headers whenever redirecting across origins.
    if (nextUrl.origin !== currentUrl.origin) {
      nextInit = {
        ...nextInit,
        headers: stripCrossOriginCredentialHeaders(nextInit.headers),
      }
    }
    // P1-E3: On 301/302/303 from non-GET/HEAD (e.g. POST), switch method to GET
    // and drop body + content-length/content-type headers.
    const isReadOnly = currentMethod === 'GET' || currentMethod === 'HEAD'
    if (
      !isReadOnly &&
      (res.status === 301 || res.status === 302 || res.status === 303)
    ) {
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const headers = new Headers(nextInit.headers)
      for (const h of REDIRECT_POST_TO_GET_STRIP_HEADERS) {
        headers.delete(h)
      }
      currentMethod = 'GET'
      nextInit = {
        ...nextInit,
        redirect: 'manual',
        method: 'GET',
        body: undefined,
        headers,
      }
    }

    currentInit = nextInit
    currentUrl = nextUrl
  }
}

// OIDC Discovery §4.1 says `{issuer}/.well-known/openid-configuration` — path
// APPEND, not replace. `new URL('/.well-known/...', issuer)` with a leading
// slash is a WHATWG absolute-path reference and drops the issuer's pathname,
// breaking Azure AD (`login.microsoftonline.com/{tenant}/v2.0`), Okta custom
// auth servers, and Keycloak realms. Trailing-slash base + relative path is
// the fix. Exported because auth.ts needs the same discovery.
export async function discoverOidc(
  idpIssuer: string,
  options?: {
    fetchFn?: FetchLike
    lookup?: typeof ssrfGuardedLookup
  },
): Promise<OpenIdProviderDiscoveryMetadata> {
  const base = idpIssuer.endsWith('/') ? idpIssuer : idpIssuer + '/'
  const issuerUrl = new URL(base)
  if (issuerUrl.protocol !== 'https:' && !isLoopbackHttpUrl(issuerUrl)) {
    throw new Error(`XAA IdP: refusing non-HTTPS issuer URL: ${idpIssuer}`)
  }
  const url = new URL('.well-known/openid-configuration', base)
  if (
    process.env.CLAUDE_GATEWAY_IDP_CONNECT_BY_HOSTNAME &&
    /^(?:1|true|yes|on)$/i.test(
      process.env.CLAUDE_GATEWAY_IDP_CONNECT_BY_HOSTNAME.trim(),
    )
  ) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { assertSafeIdpProxyTarget, getProxyUrl, shouldBypassProxy } =
      require('../../utils/proxy.js') as typeof import('../../utils/proxy.js')
    if (getProxyUrl() && !shouldBypassProxy(url.href)) {
      assertSafeIdpProxyTarget(url, { connectByHostname: true })
    }
  }
  const res = await ssrfGuardedOidcFetch(
    url,
    {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(IDP_REQUEST_TIMEOUT_MS),
    },
    options,
  )
  if (!res.ok) {
    throw new Error(
      `XAA IdP: OIDC discovery failed: HTTP ${res.status} at ${url}`,
    )
  }
  // Captive portals and proxy auth pages return 200 with HTML. res.json()
  // throws a raw SyntaxError before safeParse can give a useful message.
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new Error(
      `XAA IdP: OIDC discovery returned non-JSON at ${url} (captive portal or proxy?)`,
    )
  }
  const parsed = parseOpenIdProviderDiscoveryMetadata(body)

  // RFC 8414 §3.3 / OIDC Discovery §4.3: metadata `issuer` MUST match requested issuer
  if (typeof parsed.issuer !== 'string' || parsed.issuer.length === 0) {
    throw new Error('XAA IdP: invalid OIDC metadata: missing issuer')
  }
  if (issuerKey(parsed.issuer) !== issuerKey(idpIssuer)) {
    throw new Error(
      `XAA IdP: OIDC metadata issuer "${parsed.issuer}" does not match configured issuer "${idpIssuer}" (RFC 8414 §3.3)`,
    )
  }

  // Validate authorization_endpoint is https: (or loopback http: for a loopback issuer)
  if (
    typeof parsed.authorization_endpoint !== 'string' ||
    parsed.authorization_endpoint.length === 0
  ) {
    throw new Error(
      'XAA IdP: invalid OIDC metadata: missing authorization_endpoint',
    )
  }
  let authEndpointUrl: URL
  try {
    authEndpointUrl = new URL(parsed.authorization_endpoint)
  } catch {
    throw new Error(
      `XAA IdP: invalid authorization endpoint URL: ${parsed.authorization_endpoint}`,
    )
  }
  const allowLoopbackAuthEndpoint =
    isLoopbackHttpUrl(issuerUrl) && isLoopbackHttpUrl(authEndpointUrl)
  if (authEndpointUrl.protocol !== 'https:' && !allowLoopbackAuthEndpoint) {
    throw new Error(
      `XAA IdP: refusing non-HTTPS authorization endpoint: ${parsed.authorization_endpoint}`,
    )
  }

  let tokenEndpointUrl: URL
  try {
    tokenEndpointUrl = new URL(parsed.token_endpoint)
  } catch {
    throw new Error(
      `XAA IdP: invalid token endpoint URL: ${parsed.token_endpoint}`,
    )
  }
  const allowLoopbackTokenEndpoint =
    isLoopbackHttpUrl(issuerUrl) && isLoopbackHttpUrl(tokenEndpointUrl)
  if (tokenEndpointUrl.protocol !== 'https:' && !allowLoopbackTokenEndpoint) {
    throw new Error(
      `XAA IdP: refusing non-HTTPS token endpoint: ${parsed.token_endpoint}`,
    )
  }
  return parsed
}

/**
 * Decode the exp claim from a JWT without verifying its signature.
 * Returns undefined if parsing fails or exp is absent. Used only to
 * derive a cache TTL.
 *
 * Why no signature/iss/aud/nonce validation: per SEP-990, this id_token
 * is the RFC 8693 subject_token in a token-exchange at the IdP's own
 * token endpoint. The IdP validates its own token there. An attacker who
 * can mint a token that fools the IdP has no need to fool us first; an
 * attacker who can't, hands us garbage and gets a 401 from the IdP. The
 * --id-token injection seam is likewise safe: bad input → rejected later,
 * no privesc. Client-side verification would add code and no security.
 */
function jwtExp(jwt: string): number | undefined {
  const parts = jwt.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = jsonParse(
      Buffer.from(parts[1]!, 'base64url').toString('utf-8'),
    ) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp : undefined
  } catch {
    return undefined
  }
}

/**
 * Wait for the OAuth authorization code on a local callback server.
 * Returns the code once /callback is hit with a matching state.
 *
 * `onListening` fires after the socket is actually bound — use it to defer
 * browser-open so EADDRINUSE surfaces before a spurious tab pops open.
 */
function waitForCallback(
  port: number,
  expectedState: string,
  abortSignal: AbortSignal | undefined,
  onListening: () => void,
): Promise<string> {
  let server: Server | null = null
  let timeoutId: NodeJS.Timeout | null = null
  let abortHandler: (() => void) | null = null
  const cleanup = () => {
    server?.removeAllListeners()
    // Defensive: removeAllListeners() strips the error handler, so swallow any late error during close
    server?.on('error', () => {})
    server?.close()
    server = null
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (abortSignal && abortHandler) {
      abortSignal.removeEventListener('abort', abortHandler)
      abortHandler = null
    }
  }
  return new Promise<string>((resolve, reject) => {
    let resolved = false
    const resolveOnce = (v: string) => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve(v)
    }
    const rejectOnce = (e: Error) => {
      if (resolved) return
      resolved = true
      cleanup()
      reject(e)
    }

    if (abortSignal) {
      abortHandler = () => rejectOnce(new Error('XAA IdP: login cancelled'))
      if (abortSignal.aborted) {
        abortHandler()
        return
      }
      abortSignal.addEventListener('abort', abortHandler, { once: true })
    }

    server = createServer((req, res) => {
      const parsed = parse(req.url || '', true)
      if (parsed.pathname !== '/callback') {
        res.writeHead(404)
        res.end()
        return
      }
      const code = parsed.query.code as string | undefined
      const state = parsed.query.state as string | undefined
      const err = parsed.query.error as string | undefined

      if (err) {
        const desc = parsed.query.error_description as string | undefined
        const safeErr = xss(err)
        const safeDesc = desc ? xss(desc) : ''
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(
          `<html><body><h3>IdP login failed</h3><p>${safeErr}</p><p>${safeDesc}</p></body></html>`,
        )
        rejectOnce(new Error(`XAA IdP: ${err}${desc ? ` — ${desc}` : ''}`))
        return
      }

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body><h3>State mismatch</h3></body></html>')
        rejectOnce(new Error('XAA IdP: state mismatch (possible CSRF)'))
        return
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body><h3>Missing code</h3></body></html>')
        rejectOnce(new Error('XAA IdP: callback missing code'))
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        '<html><body><h3>IdP login complete — you can close this window.</h3></body></html>',
      )
      resolveOnce(code)
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        const findCmd =
          getPlatform() === 'windows'
            ? `netstat -ano | findstr :${port}`
            : `lsof -ti:${port} -sTCP:LISTEN`
        rejectOnce(
          new Error(
            `XAA IdP: callback port ${port} is already in use. Run \`${findCmd}\` to find the holder.`,
          ),
        )
      } else {
        rejectOnce(new Error(`XAA IdP: callback server failed: ${err.message}`))
      }
    })

    server.listen(port, '127.0.0.1', () => {
      try {
        onListening()
      } catch (e) {
        rejectOnce(toError(e))
      }
    })
    server.unref()
    timeoutId = setTimeout(
      rej => rej(new Error('XAA IdP: login timed out')),
      IDP_LOGIN_TIMEOUT_MS,
      rejectOnce,
    )
    timeoutId.unref()
  })
}

/**
 * Acquire an id_token from the IdP: return cached if valid, otherwise run
 * the full OIDC authorization_code + PKCE flow (one browser pop).
 */
export async function acquireIdpIdToken(
  opts: IdpLoginOptions,
): Promise<string> {
  const { idpIssuer, idpClientId } = opts

  const cached = getCachedIdpIdToken(idpIssuer)
  if (cached) {
    logMCPDebug('xaa', `Using cached id_token for ${idpIssuer}`)
    return cached
  }

  logMCPDebug('xaa', `No cached id_token for ${idpIssuer}; starting OIDC login`)

  const metadata = await discoverOidc(idpIssuer)
  const port = opts.callbackPort ?? (await findAvailablePort())
  const redirectUri = buildRedirectUri(port)
  const state = randomBytes(32).toString('base64url')
  const clientInformation: OAuthClientInformation = {
    client_id: idpClientId,
    ...(opts.idpClientSecret ? { client_secret: opts.idpClientSecret } : {}),
  }

  const { authorizationUrl, codeVerifier } = await startAuthorization(
    idpIssuer,
    {
      metadata,
      clientInformation,
      redirectUrl: redirectUri,
      scope: 'openid',
      state,
    },
  )

  // Open the browser only after the socket is actually bound — listen() is
  // async, and on the fixed-callbackPort path EADDRINUSE otherwise surfaces
  // after a spurious tab has already popped. Mirrors the auth.ts pattern of
  // wrapping sdkAuth inside server.listen's callback.
  const authorizationCode = await waitForCallback(
    port,
    state,
    opts.abortSignal,
    () => {
      if (opts.onAuthorizationUrl) {
        opts.onAuthorizationUrl(authorizationUrl.toString())
      }
      if (!opts.skipBrowserOpen) {
        logMCPDebug('xaa', `Opening browser to IdP authorization endpoint`)
        void openBrowser(authorizationUrl.toString())
      }
    },
  )

  const tokens = await exchangeAuthorization(idpIssuer, {
    metadata,
    clientInformation,
    authorizationCode,
    codeVerifier,
    redirectUri,
    fetchFn: (url, init) =>
      ssrfGuardedOidcFetch(
        url,
        {
          ...init,
          signal: AbortSignal.timeout(IDP_REQUEST_TIMEOUT_MS),
        },
        { forbidCrossOriginRedirects: true },
      ),
  })
  if (!tokens.id_token) {
    throw new Error(
      'XAA IdP: token response missing id_token (check scope=openid)',
    )
  }

  // Prefer the id_token's own exp claim; fall back to expires_in.
  // expires_in is for the access_token and may differ from the id_token
  // lifetime. If neither is present, default to 1h.
  const expFromJwt = jwtExp(tokens.id_token)
  const expiresAt = expFromJwt
    ? expFromJwt * 1000
    : Date.now() + (tokens.expires_in ?? 3600) * 1000

  saveIdpIdToken(idpIssuer, tokens.id_token, expiresAt)
  logMCPDebug(
    'xaa',
    `Cached id_token for ${idpIssuer} (expires ${new Date(expiresAt).toISOString()})`,
  )

  return tokens.id_token
}
