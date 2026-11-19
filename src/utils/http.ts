/**
 * HTTP utility constants and helpers
 */

import axios from 'axios'
import { Transform } from 'stream'
import { createZstdDecompress } from 'zlib'
import { getOauthConfig, OAUTH_BETA_HEADER } from '../constants/oauth.js'
import {
  getAnthropicApiKey,
  getClaudeAIOAuthTokens,
  handleOAuth401Error,
  isClaudeAISubscriber,
} from './auth.js'
import { getClaudeCodeUserAgent } from './userAgent.js'
import { getWorkload } from './workloadContext.js'

// WARNING: We rely on `claude-cli` in the user agent for log filtering.
// Please do NOT change this without making sure that logging also gets updated!
export function getUserAgent(): string {
  const agentSdkVersion = process.env.CLAUDE_AGENT_SDK_VERSION
    ? `, agent-sdk/${process.env.CLAUDE_AGENT_SDK_VERSION}`
    : ''
  // SDK consumers can identify their app/library via CLAUDE_AGENT_SDK_CLIENT_APP
  // e.g., "my-app/1.0.0" or "my-library/2.1"
  const clientApp = process.env.CLAUDE_AGENT_SDK_CLIENT_APP
    ? `, client-app/${process.env.CLAUDE_AGENT_SDK_CLIENT_APP}`
    : ''
  // Turn-/process-scoped workload tag for cron-initiated requests. 1P-only
  // observability — proxies strip HTTP headers; QoS routing uses cc_workload
  // in the billing-header attribution block instead (see constants/system.ts).
  // getAnthropicClient (client.ts:98) calls this per-request inside withRetry,
  // so the read picks up the same setWorkload() value as getAttributionHeader.
  const workload = getWorkload()
  const workloadSuffix = workload ? `, workload/${workload}` : ''
  return `claude-cli/${MACRO.VERSION} (${process.env.USER_TYPE}, ${process.env.CLAUDE_CODE_ENTRYPOINT ?? 'cli'}${agentSdkVersion}${clientApp}${workloadSuffix})`
}

export function getMCPUserAgent(): string {
  const parts: string[] = []
  if (process.env.CLAUDE_CODE_ENTRYPOINT) {
    parts.push(process.env.CLAUDE_CODE_ENTRYPOINT)
  }
  if (process.env.CLAUDE_AGENT_SDK_VERSION) {
    parts.push(`agent-sdk/${process.env.CLAUDE_AGENT_SDK_VERSION}`)
  }
  if (process.env.CLAUDE_AGENT_SDK_CLIENT_APP) {
    parts.push(`client-app/${process.env.CLAUDE_AGENT_SDK_CLIENT_APP}`)
  }
  const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `claude-code/${MACRO.VERSION}${suffix}`
}

// User-Agent for WebFetch requests to arbitrary sites. `Claude-User` is
// Anthropic's publicly documented agent for user-initiated fetches (what site
// operators match in robots.txt); the claude-code suffix lets them distinguish
// local CLI traffic from claude.ai server-side fetches.
export function getWebFetchUserAgent(): string {
  return `Claude-User (${getClaudeCodeUserAgent()}; +https://support.anthropic.com/)`
}

export type AuthHeaders = {
  headers: Record<string, string>
  error?: string
  /** Official `ky` — telemetry host mismatch. */
  reasonCode?: 'misrouted_credential'
}

/** Official `VP` — default first-party telemetry host. */
const ANTHROPIC_TELEMETRY_HOST = 'api.anthropic.com'

/** Official `Su` — URL host, or undefined. */
function telemetryUrlHost(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

/** Official `YP` — https URL? */
function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Official `qP` — host is a known Anthropic telemetry host.
 * SEA: `Ro(\`https://${e}\`)||Cy.some((t)=>Su(t)===e)`. `Ro`/`Cy` not locked;
 * locked default is `VP="api.anthropic.com"`.
 */
function isKnownAnthropicTelemetryHost(host: string | undefined): boolean {
  if (host === undefined) return false
  if (host === ANTHROPIC_TELEMETRY_HOST) return true
  const oauthHost = oauthApiHost()
  return oauthHost !== undefined && host === oauthHost
}

/** Official `WP` — `ANTHROPIC_BASE_URL` host, else `api.anthropic.com`. */
function apiKeyCredentialHost(): string | undefined {
  if (process.env.ANTHROPIC_BASE_URL) {
    return telemetryUrlHost(process.env.ANTHROPIC_BASE_URL)
  }
  return ANTHROPIC_TELEMETRY_HOST
}

/** Official `Ay` — `BASE_API_URL` host. */
function oauthApiHost(): string | undefined {
  try {
    return telemetryUrlHost(getOauthConfig().BASE_API_URL)
  } catch {
    return undefined
  }
}

/**
 * Official `Hd` — credential host equals https endpoint host AND host is known.
 */
function credentialBelongsToEndpointHost(
  credentialHost: string | undefined,
  endpointUrl: string,
): boolean {
  const endpointHost = isHttpsUrl(endpointUrl)
    ? telemetryUrlHost(endpointUrl)
    : undefined
  return (
    credentialHost !== undefined &&
    credentialHost === endpointHost &&
    isKnownAnthropicTelemetryHost(endpointHost)
  )
}

/** Official `zP` — API key belongs to both `ANTHROPIC_BASE_URL` and `BASE_API_URL` hosts. */
function apiKeyBelongsToEndpoint(endpointUrl: string): boolean {
  return (
    credentialBelongsToEndpointHost(apiKeyCredentialHost(), endpointUrl) &&
    credentialBelongsToEndpointHost(oauthApiHost(), endpointUrl)
  )
}

/** Official `jP` — bearer belongs to `BASE_API_URL` host. */
function bearerBelongsToEndpoint(endpointUrl: string): boolean {
  return credentialBelongsToEndpointHost(oauthApiHost(), endpointUrl)
}

/**
 * Official `ky` — withhold a credential that does not belong to this telemetry host.
 */
export function withholdMisroutedCredential(
  auth: AuthHeaders,
  endpointUrl: string,
): AuthHeaders {
  const withholdApiKey =
    'x-api-key' in auth.headers && !apiKeyBelongsToEndpoint(endpointUrl)
  const withholdBearer =
    'Authorization' in auth.headers && !bearerBelongsToEndpoint(endpointUrl)
  if (!(withholdApiKey || withholdBearer)) {
    return auth
  }
  return {
    headers: {},
    error:
      'credential withheld: this telemetry endpoint is not the host it belongs to',
    reasonCode: 'misrouted_credential',
  }
}

/**
 * Get authentication headers for API requests
 * Returns either OAuth headers for Max/Pro users or API key headers for regular users
 */
export function getAuthHeaders(): AuthHeaders {
  if (isClaudeAISubscriber()) {
    const oauthTokens = getClaudeAIOAuthTokens()
    if (!oauthTokens?.accessToken) {
      return {
        headers: {},
        error: 'No OAuth token available',
      }
    }
    return {
      headers: {
        Authorization: `Bearer ${oauthTokens.accessToken}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
    }
  }
  // Gateway keys are withheld at telemetry call sites via `ky` /
  // withholdMisroutedCredential — do not send them to api.anthropic.com.
  const apiKey = getAnthropicApiKey()
  if (!apiKey) {
    return {
      headers: {},
      error: 'No API key available',
    }
  }
  return {
    headers: {
      'x-api-key': apiKey,
    },
  }
}

/**
 * Wrapper that handles OAuth 401 errors by force-refreshing the token and
 * retrying once. Addresses clock drift scenarios where the local expiration
 * check disagrees with the server.
 *
 * The request closure is called again on retry, so it should re-read auth
 * (e.g., via getAuthHeaders()) to pick up the refreshed token.
 *
 * Note: bridgeApi.ts has its own DI-injected version — handleOAuth401Error
 * transitively pulls in config.ts (~1300 modules), which breaks the SDK bundle.
 *
 * @param opts.also403Revoked - Also retry on 403 with "OAuth token has been
 *   revoked" body (some endpoints signal revocation this way instead of 401).
 */
export async function withOAuth401Retry<T>(
  request: () => Promise<T>,
  opts?: { also403Revoked?: boolean },
): Promise<T> {
  try {
    return await request()
  } catch (err) {
    if (!axios.isAxiosError(err)) throw err
    const status = err.response?.status
    const isAuthError =
      status === 401 ||
      (opts?.also403Revoked &&
        status === 403 &&
        typeof err.response?.data === 'string' &&
        err.response.data.includes('OAuth token has been revoked'))
    if (!isAuthError) throw err
    const failedAccessToken = getClaudeAIOAuthTokens()?.accessToken
    if (!failedAccessToken) throw err
    await handleOAuth401Error(failedAccessToken)
    return await request()
  }
}

/**
 * Official 2.1.325 #2258 — zstd / brotli Content-Encoding safety helpers.
 *
 * - `parseResponseContentEncodings` splits comma-separated Content-Encoding
 *   headers and strips `identity`.
 * - `hasDisallowedResponseEncoding` returns true when `br` or `zstd` appears
 *   anywhere in the chain (prevents bypassing a primary-only check via
 *   `Content-Encoding: gzip, zstd`).
 * - `isZstdDecompressError` detects Node/Bun zlib `ZSTD_error_*` frame
 *   rejection codes.
 * - `createBoundedDecompressGuard` bounds decompressed output byte count so a
 *   crafted zstd frame cannot cause unbounded memory/disk expansion.
 */
export const DISALLOWED_RESPONSE_ENCODINGS = new Set(['br', 'zstd'])

export function parseResponseContentEncodings(
  headerValue: string | null | undefined,
): string[] {
  if (!headerValue) return []
  return headerValue
    .toLowerCase()
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '' && s !== 'identity')
}

export function hasDisallowedResponseEncoding(
  headerValue: string | null | undefined,
): boolean {
  return parseResponseContentEncodings(headerValue).some(enc =>
    DISALLOWED_RESPONSE_ENCODINGS.has(enc),
  )
}

export function isZstdDecompressError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.startsWith('ZSTD_error_')
}

export function createBoundedZstdDecompressStreams(
  maxDecompressedBytes: number,
  onChunk?: (chunk: Buffer) => void,
): { decompress: ReturnType<typeof createZstdDecompress>; guard: Transform } {
  let decompressedBytes = 0
  const decompress = createZstdDecompress()
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      decompressedBytes += chunk.length
      if (decompressedBytes > maxDecompressedBytes) {
        callback(
          new Error(
            `Decompressed binary exceeds the manifest size of ${maxDecompressedBytes} bytes`,
          ),
        )
        return
      }
      onChunk?.(chunk)
      callback(null, chunk)
    },
  })
  return { decompress, guard }
}
