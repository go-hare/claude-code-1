/**
 * densable 2.1.219 MCP connection issue formatting (`fSp` / `mSp` / `pSp` / `Ujo`).
 * Surfaces HTTP status + error text on `claude mcp list` / `/mcp` failed rows.
 */

import type { FailedMCPServer } from './types.js'
import { isMcpConnectTimeoutRetryEnabled } from './mcpConnectTimeout.js'

/** densable `O_o` — hard cap before ellipsis. */
const ISSUE_HARD_MAX = 2000
/** densable `Uqu` — final display cap. */
const ISSUE_DISPLAY_MAX = 500

/**
 * densable `pSp` — error codes hidden from the primary issue prefix
 * (still surface `error` / `displayDetail` when present).
 */
export const HIDDEN_MCP_ERROR_CODES = new Set([
  'INVALID_CONFIG',
  'UNCONFIGURED',
  'AUTH_HEADER_REJECTED',
  'CLI_OWNED_BEARER_REJECTED',
  'FIRST_PARTY_AUTH_REJECTED',
  'ENDPOINT_NOT_FOUND',
])

/**
 * densable `fSp` — map raw errorCode to display token.
 * - `"23"` → `request timed out` (MCP JSON-RPC timeout code)
 * - integer 100–599 → `HTTP ${code}`
 * - else raw code string
 */
export function formatMcpErrorCode(errorCode: string): string {
  const asNum = Number(errorCode)
  if (errorCode === '23') return 'request timed out'
  if (Number.isInteger(asNum) && asNum >= 100 && asNum <= 599) {
    return `HTTP ${errorCode}`
  }
  return errorCode
}

/**
 * densable `vEe` (subset) — collapse whitespace, redact bearer/basic tokens,
 * truncate long issue strings for terminal list/get output.
 */
export function sanitizeMcpIssueText(raw: string): string {
  let text = raw.replaceAll(/\s+/g, ' ').trim()
  if (text.length > ISSUE_HARD_MAX) {
    text = `${text.slice(0, ISSUE_HARD_MAX)}…`
  }
  // densable `jqu` — redact bearer/basic credentials in issue text.
  text = text.replace(
    /\b(bearer|basic)[\s:=\uFF1A\uFF1D]+([A-Za-z0-9._~+/=%-]{8,})/gi,
    (_full, scheme: string) => `${scheme} [redacted]`,
  )
  if (text.length > ISSUE_DISPLAY_MAX) {
    return `${text.slice(0, ISSUE_DISPLAY_MAX)}…`
  }
  return text
}

type FailedIssueFields = Pick<
  FailedMCPServer,
  'error' | 'errorCode' | 'displayDetail'
>

/**
 * densable `mSp` — compose human-readable issue from failed connection fields.
 */
export function formatFailedMcpIssue(failed: FailedIssueFields): string {
  const { errorCode, displayDetail, error } = failed
  if (errorCode && !HIDDEN_MCP_ERROR_CODES.has(errorCode)) {
    const codeLabel = formatMcpErrorCode(errorCode)
    const withError = error !== undefined ? `${codeLabel}: ${error}` : codeLabel
    const combined = displayDetail ? `${withError} ${displayDetail}` : withError
    return sanitizeMcpIssueText(combined)
  }
  const base = error ?? errorCode ?? ''
  const withDetail = displayDetail ? `${base} ${displayDetail}`.trim() : base
  if (withDetail === '') return withDetail
  return sanitizeMcpIssueText(withDetail)
}

/**
 * densable `Ujo` / 2.1.234 #13 — reconnect failure detail uses URL **origin** only
 * (cHr), never full URL with path/query/userinfo secrets.
 */
export function formatFailedMcpReconnectIssue(
  failed: FailedIssueFields & { config?: unknown },
): string {
  let origin: string | null = null
  const cfg = failed.config
  if (cfg && typeof cfg === 'object' && 'url' in cfg) {
    const u = (cfg as { url?: unknown }).url
    if (typeof u === 'string') {
      try {
        origin = new URL(u).origin
      } catch {
        origin = null
      }
    }
  }
  const code = failed.errorCode
  if (code !== undefined && HIDDEN_MCP_ERROR_CODES.has(code)) {
    return failed.error ?? code
  }
  if (code) {
    const label = formatMcpErrorCode(code)
    return origin ? `${label} at ${origin}` : label
  }
  return failed.error ?? ''
}

/**
 * Pull a densable-style errorCode from a thrown connection error.
 * HTTP 404 on http transport without session → ENDPOINT_NOT_FOUND.
 * densable 2.1.232: McpError RequestTimeout (-32001) → CONNECT_TIMEOUT when
 * `tengu_mcp_connect_timeout_retry` is enabled (default true).
 */
export function extractMcpConnectionErrorCode(
  error: unknown,
  opts?: {
    transportType?: string | undefined
    hasSessionId?: boolean
    mapRequestTimeoutToConnectTimeout?: boolean
  },
): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const withCode = error as { code?: string | number }
  if (withCode.code === undefined || withCode.code === null) return undefined
  let code = String(withCode.code)
  // densable: h instanceof rd && h.code === Mu.RequestTimeout && GB → CONNECT_TIMEOUT
  const mapTimeout =
    opts?.mapRequestTimeoutToConnectTimeout !== false &&
    (code === '-32001' || code === 'RequestTimeout')
  if (mapTimeout && isMcpConnectTimeoutRetryEnabled()) {
    code = 'CONNECT_TIMEOUT'
  }
  if (opts?.transportType === 'http' && code === '404' && !opts.hasSessionId) {
    code = 'ENDPOINT_NOT_FOUND'
  }
  return code
}
