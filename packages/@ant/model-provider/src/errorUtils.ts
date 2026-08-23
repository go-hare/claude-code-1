import type { APIError } from '@anthropic-ai/sdk'

// SSL/TLS error codes from OpenSSL (used by both Node.js and Bun)
// See: https://www.openssl.org/docs/man3.1/man3/X509_STORE_CTX_get_error.html
const SSL_ERROR_CODES = new Set([
  // Certificate verification errors
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_SIGNATURE_FAILURE',
  'CERT_NOT_YET_VALID',
  'CERT_HAS_EXPIRED',
  'CERT_REVOKED',
  'CERT_REJECTED',
  'CERT_UNTRUSTED',
  // Self-signed certificate errors
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  // Chain errors
  'CERT_CHAIN_TOO_LONG',
  'PATH_LENGTH_EXCEEDED',
  // Hostname/altname errors
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH',
  // TLS handshake errors
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC',
])

export type ConnectionErrorDetails = {
  code: string
  message: string
  isSSLError: boolean
}

/**
 * densable Sxg — Bun/fetch message prefix when the socket dies mid-stream
 * without a Node-style errno code (Windows corporate proxy #18).
 */
export const SOCKET_CONNECTION_CLOSED_PREFIX =
  'The socket connection was closed unexpectedly'

/** densable T9r `zff` — unwrap to inner cause when the wrapper is generic. */
const AWS_CREDENTIALS_CHAIN_FAILED =
  'Failed to resolve AWS credentials from the credential provider chain.'

/** densable T9r `Wvi` */
const GCP_OAUTH_CREDENTIALS_FAILED =
  'Failed to acquire Google OAuth credentials.'

/**
 * densable T2 — extract connection error details from the error cause chain.
 * The Anthropic SDK wraps underlying errors in the `cause` property.
 * Also maps Bun's "socket connection was closed" message to ConnectionClosed
 * so stale-connection retry / keep-alive disable can fire (#18/#46).
 */
export function extractConnectionErrorDetails(
  error: unknown,
): ConnectionErrorDetails | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  // Walk the cause chain to find the root error with a code
  let current: unknown = error
  const maxDepth = 5 // Prevent infinite loops
  let depth = 0

  while (current && depth < maxDepth) {
    if (current instanceof Error) {
      if ('code' in current && typeof current.code === 'string') {
        const code = current.code
        const isSSLError = SSL_ERROR_CODES.has(code)
        return {
          code,
          message: current.message,
          isSSLError,
        }
      }
      // densable T2: message.startsWith(Sxg) → ConnectionClosed
      if (current.message.startsWith(SOCKET_CONNECTION_CLOSED_PREFIX)) {
        return {
          code: 'ConnectionClosed',
          message: current.message,
          isSSLError: false,
        }
      }
    }

    // Move to the next cause in the chain
    if (
      current instanceof Error &&
      'cause' in current &&
      current.cause !== current
    ) {
      current = current.cause
      depth++
    } else {
      break
    }
  }

  return null
}

/**
 * Returns an actionable hint for SSL/TLS errors, intended for contexts outside
 * the main API client (OAuth token exchange, preflight connectivity checks)
 * where `formatAPIError` doesn't apply.
 */
export function getSSLErrorHint(error: unknown): string | null {
  const details = extractConnectionErrorDetails(error)
  if (!details?.isSSLError) {
    return null
  }
  return `SSL certificate error (${details.code}). If you are behind a corporate proxy or TLS-intercepting firewall, set NODE_EXTRA_CA_CERTS to your CA bundle path, or ask IT to allowlist *.anthropic.com. Run /doctor for details.`
}

/**
 * Strips HTML content (e.g., CloudFlare error pages) from a message string,
 * returning a user-friendly title or empty string if HTML is detected.
 * Returns the original message unchanged if no HTML is found.
 */
function sanitizeMessageHTML(message: string): string {
  if (message.includes('<!DOCTYPE html') || message.includes('<html')) {
    const titleMatch = message.match(/<title>([^<]+)<\/title>/)
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].trim()
    }
    return ''
  }
  return message
}

/**
 * Detects if an error message contains HTML content (e.g., CloudFlare error pages)
 * and returns a user-friendly message instead
 */
export function sanitizeAPIError(apiError: APIError): string {
  const message = apiError.message
  if (!message) {
    return ''
  }
  return sanitizeMessageHTML(message)
}

/**
 * Shapes of deserialized API errors from session JSONL.
 */
type NestedAPIError = {
  error?: {
    message?: string
    error?: { message?: string }
  }
}

function hasNestedError(value: unknown): value is NestedAPIError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null
  )
}

/**
 * Extract a human-readable message from a deserialized API error that lacks
 * a top-level `.message`.
 */
function extractNestedErrorMessage(error: APIError): string | null {
  if (!hasNestedError(error)) {
    return null
  }

  const narrowed: NestedAPIError = error
  const nested = narrowed.error

  // Standard Anthropic API shape: { error: { error: { message } } }
  const deepMsg = nested?.error?.message
  if (typeof deepMsg === 'string' && deepMsg.length > 0) {
    const sanitized = sanitizeMessageHTML(deepMsg)
    if (sanitized.length > 0) {
      return sanitized
    }
  }

  // Bedrock shape: { error: { message } }
  const msg = nested?.message
  if (typeof msg === 'string' && msg.length > 0) {
    const sanitized = sanitizeMessageHTML(msg)
    if (sanitized.length > 0) {
      return sanitized
    }
  }

  return null
}

/**
 * densable T9r `EJt` — walk `start` (typically `error.cause`) up to `maxDepth`.
 */
function findCauseError(
  start: unknown,
  pred: (err: Error) => boolean,
  maxDepth = 5,
): Error | undefined {
  let current = start
  for (let i = 0; i < maxDepth; i++) {
    if (!(current instanceof Error)) return undefined
    if (pred(current)) return current
    current = 'cause' in current ? current.cause : undefined
  }
  return undefined
}

/**
 * densable T9r named copy for `message === "Connection error."` + errno.
 * Includes `ERR_PROXY_TUNNEL` → `Couldn't connect through your proxy`.
 * Display-only — does not change STREAM_NETWORK_DOWN_CODES / F4y.
 */
function formatNamedConnectionError(code: string): string {
  switch (code) {
    case 'ECONNRESET':
    case 'EPIPE':
    case 'ECONNABORTED':
    case 'ConnectionClosed':
    case 'ERR_SOCKET_CLOSED':
    case 'UND_ERR_SOCKET':
      return `Connection dropped (${code})`
    case 'ECONNREFUSED':
    case 'ConnectionRefused':
      return (
        `Connection refused — a firewall or proxy may be blocking it ` +
        `(${code})`
      )
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
    case 'FailedToOpenSocket':
      return (
        `Can't reach the API server — check your internet or DNS ` + `(${code})`
      )
    case 'ENETUNREACH':
    case 'ENETDOWN':
    case 'EHOSTUNREACH':
    case 'EHOSTDOWN':
      return `No internet route — check your connection or VPN (${code})`
    case 'ERR_PROXY_TUNNEL':
      return `Couldn't connect through your proxy (${code})`
    default:
      return `Unable to connect to API (${code})`
  }
}

export function formatAPIError(error: APIError): string {
  // Extract connection error details from the cause chain
  const connectionDetails = extractConnectionErrorDetails(error)

  if (connectionDetails) {
    const { code, isSSLError } = connectionDetails

    // densable T9r order: StreamSuspended → Bedrock → ETIMEDOUT → SSL
    if (code === 'StreamSuspended') {
      return 'Connection lost while your computer was asleep'
    }
    if (code === 'BedrockUnexpectedContentType') {
      return connectionDetails.message
    }

    // Handle timeout errors
    if (code === 'ETIMEDOUT') {
      return 'Request timed out. Check your internet connection and proxy settings'
    }

    // Handle SSL/TLS errors with specific messages
    if (isSSLError) {
      switch (code) {
        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
        case 'UNABLE_TO_GET_ISSUER_CERT':
        case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
          return 'Unable to connect to API: SSL certificate verification failed. Check your proxy or corporate SSL certificates'
        case 'CERT_HAS_EXPIRED':
          return 'Unable to connect to API: SSL certificate has expired'
        case 'CERT_REVOKED':
          return 'Unable to connect to API: SSL certificate has been revoked'
        case 'DEPTH_ZERO_SELF_SIGNED_CERT':
        case 'SELF_SIGNED_CERT_IN_CHAIN':
          return 'Unable to connect to API: Self-signed certificate detected. Check your proxy or corporate SSL certificates'
        case 'ERR_TLS_CERT_ALTNAME_INVALID':
        case 'HOSTNAME_MISMATCH':
          return 'Unable to connect to API: SSL certificate hostname mismatch'
        case 'CERT_NOT_YET_VALID':
          return 'Unable to connect to API: SSL certificate is not yet valid'
        default:
          return `Unable to connect to API: SSL error (${code})`
      }
    }
  }

  // densable T9r: generic cloud-cred wrappers unwrap a useful inner message
  if (
    error.message === AWS_CREDENTIALS_CHAIN_FAILED ||
    error.message === GCP_OAUTH_CREDENTIALS_FAILED
  ) {
    const inner = findCauseError(
      error.cause,
      err =>
        err.message.trim().length > 0 &&
        err.message !== AWS_CREDENTIALS_CHAIN_FAILED &&
        err.message !== GCP_OAUTH_CREDENTIALS_FAILED,
    )
    if (inner) {
      const sanitized = sanitizeMessageHTML(inner.message.trim())
      if (sanitized.length > 0) return sanitized
    }
  }

  if (error.message === 'Connection error.') {
    const n = connectionDetails?.code
    if (n === undefined) {
      return 'Unable to connect to API. Check your internet connection'
    }
    return formatNamedConnectionError(n)
  }

  // Guard: when deserialized from JSONL (e.g. --resume), the error object may
  // be a plain object without a `.message` property.
  if (!error.message) {
    return (
      extractNestedErrorMessage(error) ??
      `API error (status ${error.status ?? 'unknown'})`
    )
  }

  // densable T9r: nested JSON body often leaks as `{"type":...}` in message
  if (error.message.includes('{"')) {
    const nested = extractNestedErrorMessage(error)
    if (nested) {
      return error.status ? `${error.status} ${nested}` : nested
    }
  }

  const sanitizedMessage = sanitizeAPIError(error)
  // Use sanitized message if it's different from the original (i.e., HTML was sanitized)
  return sanitizedMessage !== error.message && sanitizedMessage.length > 0
    ? sanitizedMessage
    : error.message
}
