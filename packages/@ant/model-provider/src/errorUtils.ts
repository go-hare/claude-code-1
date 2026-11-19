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
  // Name constraint errors
  'PERMITTED_VIOLATION',
  'EXCLUDED_VIOLATION',
  'NAME_CONSTRAINTS_WITHOUT_SANS',
  'UNSUPPORTED_CONSTRAINT_TYPE',
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
 * Official 2.1.326 (#174 & #263) `p0n`: returns true when an error is an
 * OpenSSL/TLS `CERT_SIGNATURE_FAILURE` (code or message match).
 */
export function isCertSignatureFailureError(error: unknown): boolean {
  const details = extractConnectionErrorDetails(error)
  if (
    details &&
    (details.code === 'CERT_SIGNATURE_FAILURE' ||
      /certificate signature failure/i.test(details.message))
  ) {
    return true
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    if (
      code === 'CERT_SIGNATURE_FAILURE' ||
      /certificate signature failure/i.test(error.message)
    ) {
      return true
    }
  }
  return false
}

/**
 * Official 2.1.326 (#263) `ptn`: clear explanation of `CERT_SIGNATURE_FAILURE`
 * after a CA renewal (two CAs with the same subject name and different keys
 * without authority key identifiers), with Desktop vs CLI IT guidance.
 */
export function formatCertSignatureFailureCause(
  isDesktop = process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop' ||
    process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop-3p',
): string {
  const action = isDesktop
    ? "Ask your IT team to re-issue the certificates with authority key identifiers, or, if only one of the two CAs still signs your servers' certificates, to trust only that one in this computer's certificate store and the CA file that your organization configured."
    : "Have the certificates re-issued with authority key identifiers, or, if only one of the two CAs still signs your servers' certificates, trust only that one in the system certificate store and the NODE_EXTRA_CA_CERTS file."
  return `After a CA renewal, this can mean that this computer trusts two CA certificates with the same name but different keys, and the server's certificates don't say which key signed them. ${action} If no CA was renewed, don't work around this error, because it can also mean that something on the network changed the connection.`
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
  if (
    details.code === 'CERT_SIGNATURE_FAILURE' ||
    /certificate signature failure/i.test(details.message)
  ) {
    return `SSL certificate verification failed (CERT_SIGNATURE_FAILURE). ${formatCertSignatureFailureCause()}`
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

function formatNameConstraintSslCause(code: string): string {
  switch (code) {
    case 'NAME_CONSTRAINTS_WITHOUT_SANS':
      return "A certificate authority in the server's chain limits the names that it may certify (a name constraint), and under such an authority this client needs the server's certificate to list its names as subject alternative names, and it lists none. Whoever runs the server, proxy or gateway can fix this with a new certificate that lists them."
    case 'UNSUPPORTED_CONSTRAINT_TYPE':
      return "A certificate authority in the server's chain limits the names that it may certify (a name constraint), and the limit covers a kind of name that this client can't check, usually IP addresses. This client refuses any certificate under such an authority that lists a name of that kind, whether or not the name fits. Whoever runs the server, proxy or gateway can fix this with a new certificate whose chain, including the trusted root, has no such limit, or with one that lists only DNS names that every authority in the chain allows, which clients must then use to reach the server."
    default:
      return "A certificate authority in the server's chain limits the names that it may certify (a name constraint), and a name in the server's certificate breaks that limit. If the certificate has no DNS subject alternative name, its common name can be checked as a DNS name, even if it's an address. Whoever runs the server, proxy or gateway can fix this with a new certificate whose names all fit the limit, or one whose chain, including the trusted root, has no such limit."
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
    if (code === 'StreamNoResponse') {
      return 'No response from API'
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
      const caHint =
        'set NODE_EXTRA_CA_CERTS to that CA bundle, or add it to the system certificate store · see https://code.claude.com/docs/en/network-config'
      const untrustedDetail = `(${code}). The certificate comes from an authority Claude Code doesn't trust, usually a TLS-inspecting corporate proxy or a gateway signed by a private CA: ${caHint}`
      switch (code) {
        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
        case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
        case 'UNABLE_TO_GET_ISSUER_CERT':
          if (code === 'UNABLE_TO_GET_ISSUER_CERT') {
            return `Unable to connect to API: SSL certificate verification failed (${code}). The certificates this computer trusts include a CA certificate whose own issuer is missing, often a leftover from a renewal: remove it from the system certificate store or the NODE_EXTRA_CA_CERTS file, or add its issuer there.`
          }
          return `Unable to connect to API: SSL certificate verification failed (${code}). The certificates the server sent don't lead to a trusted authority. If the server leaves out an intermediate certificate, which browsers fetch by themselves, whoever runs it must have it send its full chain. If it is a TLS-inspecting corporate proxy or a gateway signed by a private CA, ${caHint}`
        case 'CERT_HAS_EXPIRED':
          return 'Unable to connect to API: SSL certificate has expired'
        case 'CERT_REVOKED':
          return 'Unable to connect to API: SSL certificate has been revoked'
        case 'DEPTH_ZERO_SELF_SIGNED_CERT':
        case 'SELF_SIGNED_CERT_IN_CHAIN':
          return `Unable to connect to API: Self-signed certificate detected ${untrustedDetail}`
        case 'ERR_TLS_CERT_ALTNAME_INVALID':
        case 'HOSTNAME_MISMATCH':
          return 'Unable to connect to API: SSL certificate hostname mismatch'
        case 'CERT_NOT_YET_VALID':
          return 'Unable to connect to API: SSL certificate is not yet valid'
        case 'CERT_SIGNATURE_FAILURE':
          return `Unable to connect to API: SSL certificate verification failed (CERT_SIGNATURE_FAILURE). ${formatCertSignatureFailureCause()}`
        case 'PERMITTED_VIOLATION':
        case 'EXCLUDED_VIOLATION':
        case 'NAME_CONSTRAINTS_WITHOUT_SANS':
        case 'UNSUPPORTED_CONSTRAINT_TYPE':
          return `Unable to connect to API: SSL certificate verification failed (${code}). ${formatNameConstraintSslCause(code)}`
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
