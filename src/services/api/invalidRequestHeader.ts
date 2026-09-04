/**
 * densable 2.1.243 `lb` / `FTn` / `mz`.
 * Thrown before send when a header fails `new Headers()`.
 */

export class InvalidRequestHeaderValueError extends Error {
  readonly header: string
  readonly source: string

  constructor(message: string, header: string, source: string) {
    super(message)
    this.name = 'InvalidRequestHeaderValueError'
    this.header = header
    this.source = source
  }

  get isUserSupplied(): boolean {
    return this.source !== 'claude-code'
  }
}

/** densable `CMo` */
const INTERNAL_HEADER_NAMES = new Set([
  'x-app',
  'X-Claude-Code-Session-Id',
  'x-claude-code-agent-id',
  'x-claude-code-parent-agent-id',
  'x-anthropic-additional-protection',
])

/** densable `RMo` */
const ENV_SUPPLIED_HEADER_SOURCES: Record<string, string> = {
  'x-client-app': 'CLAUDE_AGENT_SDK_CLIENT_APP',
  'x-claude-remote-container-id': 'CLAUDE_CODE_CONTAINER_ID',
  'x-claude-remote-session-id': 'CLAUDE_CODE_REMOTE_SESSION_ID',
  'User-Agent': 'User-Agent environment',
}

/** densable `bde` */
const HEADER_SOURCE_LABEL: Record<string, string> = {
  ANTHROPIC_API_KEY: ' from ANTHROPIC_API_KEY',
  apiKeyHelper: ' from apiKeyHelper',
  '/login managed key': ' from the saved /login API key',
  ANTHROPIC_AUTH_TOKEN: ' from ANTHROPIC_AUTH_TOKEN',
  CLAUDE_CODE_OAUTH_TOKEN: ' from CLAUDE_CODE_OAUTH_TOKEN',
  CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR:
    ' from the OAuth token file descriptor',
  CCR_OAUTH_TOKEN_FILE: ' from the OAuth token file',
  'claude.ai': ' from the saved claude.ai login',
  ANTHROPIC_CUSTOM_HEADERS: ' from ANTHROPIC_CUSTOM_HEADERS',
  CLAUDE_AGENT_SDK_CLIENT_APP: ' from CLAUDE_AGENT_SDK_CLIENT_APP',
  CLAUDE_CODE_CONTAINER_ID: ' from CLAUDE_CODE_CONTAINER_ID',
  CLAUDE_CODE_REMOTE_SESSION_ID: ' from CLAUDE_CODE_REMOTE_SESSION_ID',
  'User-Agent environment':
    ' from CLAUDE_CODE_ENTRYPOINT / CLAUDE_AGENT_SDK_VERSION / CLAUDE_AGENT_SDK_CLIENT_APP',
  unknown: '',
  'claude-code': '',
}

type HeaderScan =
  | { kind: 'line_break'; index: number }
  | { kind: 'nul'; index: number }
  | { kind: 'whitespace'; index: number }
  | { kind: 'control_character'; index: number; codePoint: number }
  | { kind: 'non_ascii'; index: number; codePoint: number }
  | { kind: 'too_long'; length: number; maxLength: number }

/** densable `Lft` — true when `new Headers` rejects the pair. */
export function isRejectedHeaderPair(name: string, value: string): boolean {
  try {
    new Headers([[name, value]])
    return false
  } catch {
    return true
  }
}

/** densable `AMo` — true when the name alone is rejected. */
export function isRejectedHeaderName(name: string): boolean {
  try {
    new Headers([[name, 'x']])
    return false
  } catch {
    return true
  }
}

/** densable `Nft` */
function formatCharacterCount(n: number): string {
  return n === 1 ? '1 character' : `${n} characters`
}

/** densable `kT` */
function isHttpWhitespaceCode(code: number): boolean {
  return code === 9 || code === 32 || code === 10 || code === 13
}

/** densable `xT` */
function firstLineBreakIndex(text: string): number {
  const lf = text.indexOf('\n')
  const cr = text.indexOf('\r')
  if (lf === -1) return cr
  return cr === -1 ? lf : Math.min(lf, cr)
}

/** densable `PT` */
function codePointAt(text: string, index: number): number {
  return text.codePointAt(index) ?? text.charCodeAt(index)
}

/** densable `Bn` */
function codePointIndex(text: string, utf16End: number): number {
  let n = 0
  for (let i = 0; i < utf16End; i++) {
    const code = text.charCodeAt(i)
    if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < text.length &&
      (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00
    ) {
      i++
    }
    n++
  }
  return n
}

/** densable `DT` */
function codePointLength(text: string): number {
  return codePointIndex(text, text.length)
}

/** densable `pZ` / `DTn` */
function describeInvalidHeaderValue(text: string): HeaderScan | null {
  let start = 0
  let end = text.length
  while (start < end && isHttpWhitespaceCode(text.charCodeAt(start))) start++
  while (end > start && isHttpWhitespaceCode(text.charCodeAt(end - 1))) end--
  const breakAt = firstLineBreakIndex(text.slice(start, end))
  if (breakAt !== -1) {
    return { kind: 'line_break', index: codePointIndex(text, start + breakAt) }
  }
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i)
    if (code === 0) return { kind: 'nul', index: codePointIndex(text, i) }
    if (code > 255) {
      return {
        kind: 'non_ascii',
        index: codePointIndex(text, i),
        codePoint: codePointAt(text, i),
      }
    }
  }
  return null
}

/** densable `RT` / `LTn` */
function headerValueSize(text: string): { length: number; lineCount: number } {
  let lineCount = 1
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 10) lineCount++
    else if (code === 13) {
      lineCount++
      if (text.charCodeAt(i + 1) === 10) i++
    }
  }
  return { length: codePointLength(text), lineCount }
}

/** densable `Ls` */
function formatCodePoint(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
}

/** densable `VU` */
function describeSpecialCodePoint(code: number): string | null {
  switch (code) {
    case 65279:
      return 'a byte-order mark (U+FEFF)'
    case 8203:
    case 8204:
    case 8205:
    case 8288:
      return `a zero-width character (${formatCodePoint(code)})`
    case 160:
    case 8239:
      return `a no-break space (${formatCodePoint(code)})`
    case 8216:
    case 8217:
    case 8220:
    case 8221:
      return `a typographic quote (${formatCodePoint(code)})`
    case 8211:
    case 8212:
      return `a typographic dash (${formatCodePoint(code)})`
    case 8230:
      return 'an ellipsis character (U+2026)'
    case 8232:
    case 8233:
      return `a line or paragraph separator (${formatCodePoint(code)})`
    case 65533:
      return 'a replacement character (U+FFFD)'
    default:
      return code >= 55296 && code <= 57343
        ? 'an unpaired UTF-16 surrogate'
        : null
  }
}

/** densable `OT` / `NTn` */
function formatHeaderScan(
  scan: HeaderScan,
  size: { length: number; lineCount: number },
): string {
  const count = formatCharacterCount(size.length)
  const sized =
    size.lineCount > 1 ? `${count} on ${size.lineCount} lines` : count
  switch (scan.kind) {
    case 'line_break':
      return `it contains a line break at character ${scan.index + 1} (${sized})`
    case 'nul':
      return `it contains a NUL byte at character ${scan.index + 1} (${sized})`
    case 'control_character':
      return `it contains a control character at character ${scan.index + 1} (${sized})`
    case 'whitespace':
      return `it contains whitespace at character ${scan.index + 1} (${sized})`
    case 'non_ascii':
      return `it contains ${describeSpecialCodePoint(scan.codePoint) ?? 'a non-ASCII character'} at character ${scan.index + 1} (${sized})`
    case 'too_long':
      return `it is ${scan.length} characters long (limit ${scan.maxLength})`
  }
}

/** densable `mz` */
export function describeRejectedHeaderValue(value: string): string {
  const scan = describeInvalidHeaderValue(value)
  const size = headerValueSize(value)
  return scan === null
    ? `it contains a character the HTTP runtime does not accept (${formatCharacterCount(size.length)})`
    : formatHeaderScan(scan, size)
}

export type AssertValidOutgoingHeadersArgs = {
  apiKey: string | null
  getApiKeySource: () => string
  authToken: string | null
  getAuthTokenSource: () => string
  defaultHeaders: Record<string, string>
  authorizationSource: string | null
  customHeaderNames: string[]
  envSuppliedHeaderNames: Set<string>
}

/**
 * densable 2.1.243 `FTn` — throw `lb` when a header would be rejected before send.
 */
export function assertValidOutgoingHeaders(
  args: AssertValidOutgoingHeadersArgs,
): void {
  const {
    apiKey,
    getApiKeySource,
    authToken,
    getAuthTokenSource,
    defaultHeaders,
    authorizationSource,
    customHeaderNames,
    envSuppliedHeaderNames,
  } = args

  if (apiKey !== null && isRejectedHeaderPair('x-api-key', apiKey)) {
    const source = getApiKeySource()
    throw new InvalidRequestHeaderValueError(
      `Invalid X-Api-Key header value${HEADER_SOURCE_LABEL[source]}: ${describeRejectedHeaderValue(apiKey)}.`,
      'X-Api-Key',
      source,
    )
  }

  for (const [name, value] of Object.entries(defaultHeaders)) {
    if (typeof value !== 'string' || !isRejectedHeaderPair(name, value)) {
      continue
    }
    const customIndex = customHeaderNames.indexOf(name)
    const customOrdinal = `distinct header ${customIndex + 1} of ${customHeaderNames.length} parsed from ANTHROPIC_CUSTOM_HEADERS`
    if (isRejectedHeaderName(name)) {
      throw new InvalidRequestHeaderValueError(
        customIndex === -1
          ? `Invalid request header name: the HTTP runtime does not accept it (${formatCharacterCount(name.length)}).`
          : `Invalid name for ${customOrdinal}: the HTTP runtime does not accept it (${formatCharacterCount(name.length)}).`,
        'other',
        customIndex === -1 ? 'claude-code' : 'ANTHROPIC_CUSTOM_HEADERS',
      )
    }
    const envSource = ENV_SUPPLIED_HEADER_SOURCES[name]
    if (envSource !== undefined && envSuppliedHeaderNames.has(name)) {
      throw new InvalidRequestHeaderValueError(
        `Invalid ${name} header value${HEADER_SOURCE_LABEL[envSource]}: ${describeRejectedHeaderValue(value)}.`,
        'other',
        envSource,
      )
    }
    const authFromSource =
      name === 'Authorization' && authorizationSource !== null
    if (name.toLowerCase() === 'authorization') {
      const source = authFromSource
        ? authorizationSource
        : customIndex === -1
          ? 'unknown'
          : 'ANTHROPIC_CUSTOM_HEADERS'
      const shown =
        authFromSource && value.startsWith('Bearer ') ? value.slice(7) : value
      throw new InvalidRequestHeaderValueError(
        `Invalid Authorization header value${HEADER_SOURCE_LABEL[source]}: ${describeRejectedHeaderValue(shown)}.`,
        'Authorization',
        source,
      )
    }
    if (customIndex !== -1) {
      throw new InvalidRequestHeaderValueError(
        `Invalid value for ${customOrdinal}: ${describeRejectedHeaderValue(value)}.`,
        name.toLowerCase() === 'x-api-key' ? 'X-Api-Key' : 'other',
        'ANTHROPIC_CUSTOM_HEADERS',
      )
    }
    if (envSource !== undefined) {
      throw new InvalidRequestHeaderValueError(
        `Invalid ${name} header value${HEADER_SOURCE_LABEL[envSource]}: ${describeRejectedHeaderValue(value)}.`,
        'other',
        envSource,
      )
    }
    throw new InvalidRequestHeaderValueError(
      INTERNAL_HEADER_NAMES.has(name)
        ? `Invalid ${name} header value: ${describeRejectedHeaderValue(value)}.`
        : `Invalid request header value: ${describeRejectedHeaderValue(value)}.`,
      'other',
      'claude-code',
    )
  }

  if (
    authToken !== null &&
    isRejectedHeaderPair('authorization', `Bearer ${authToken}`)
  ) {
    const source = getAuthTokenSource()
    throw new InvalidRequestHeaderValueError(
      `Invalid Authorization header value${HEADER_SOURCE_LABEL[source]}: ${describeRejectedHeaderValue(authToken)}.`,
      'Authorization',
      source,
    )
  }
}
