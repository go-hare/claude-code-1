/**
 * densable 2.1.234 #37 — UnexpectedApiResponseError (Pai) + Tbv/Sbv/tHa diagnostics.
 *
 * Thrown when non-streaming fallback returns a body that is not a Message
 * (proxy/gateway HTML, empty body, event-stream, etc.). Message includes
 * content-type, body kind, size, request-id, and why the original stream failed.
 */

import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/utils/errors.js'
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from 'src/utils/errors.js'
import { plural } from 'src/utils/stringUtils.js'

/** densable rbv */
const ANTHROPIC_REQUEST_ID_RE = /^req_[A-Za-z0-9_-]{1,36}$/

/** densable vbv — SSE lead-in */
const EVENT_STREAM_LEAD_RE = /^(event|data|id|retry)?:/

/** densable rzp — known AI gateway header prefixes */
const GATEWAY_HEADER_PREFIXES: Record<string, { prefixes: string[] }> = {
  litellm: { prefixes: ['x-litellm-'] },
  helicone: { prefixes: ['helicone-'] },
  portkey: { prefixes: ['x-portkey-'] },
  'cloudflare-ai-gateway': { prefixes: ['cf-aig-'] },
  kong: { prefixes: ['x-kong-'] },
  braintrust: { prefixes: ['x-bt-'] },
}

/** densable _bv — intermediary header names (exact) */
const INTERMEDIARY_HEADERS = new Set([
  'via',
  'x-cache',
  'x-cache-hits',
  'x-served-by',
  'x-varnish',
  'age',
  'cf-ray',
  'cf-cache-status',
  'x-request-id',
  'x-correlation-id',
  'x-forwarded-for',
  'x-powered-by',
  'x-squid-error',
  'proxy-authenticate',
  'proxy-connection',
  'www-authenticate',
  'server-timing',
  'retry-after',
  'x-should-retry',
  'content-encoding',
  'transfer-encoding',
  'x-accel-buffering',
  'traceparent',
  'x-cloud-trace-context',
  'cf-mitigated',
  'x-iinfo',
])

/** densable bbv — intermediary header prefixes */
const INTERMEDIARY_HEADER_PREFIXES = [
  'anthropic-',
  'x-amz-',
  'x-amzn-',
  'x-ms-',
  'x-azure-',
  'x-goog-',
  'x-envoy-',
  'x-apigee-',
  'x-akamai-',
  'x-zscaler-',
  'x-databricks-',
  ...Object.values(GATEWAY_HEADER_PREFIXES).flatMap(({ prefixes }) => prefixes),
]

/** densable dbv — Server header → vendor */
const SERVER_PATTERNS: Array<[string, RegExp]> = [
  ['cloudflare', /cloudflare/],
  ['envoy', /envoy|istio/],
  ['nginx', /nginx|openresty/],
  ['apigee', /apigee/],
  ['akamai', /akamai/],
  ['aws', /awselb|amazon|cloudfront/],
  ['azure', /azure/],
  ['google', /^(gws|gfe|esf|gse)\b|google/],
  ['iis', /microsoft-iis/],
  ['apache', /apache/],
  ['zscaler', /zscaler/],
  ['netskope', /netskope/],
  ['bluecoat', /bluecoat|symantec/],
  ['forcepoint', /forcepoint|websense/],
  ['f5', /big-?ip|\bf5\b/],
  ['netscaler', /netscaler|citrix/],
  ['squid', /squid/],
  ['haproxy', /haproxy/],
  ['traefik', /traefik/],
  ['kestrel', /kestrel/],
  ['python', /uvicorn|gunicorn|hypercorn/],
]

/** densable fbv */
const APIGEE_FAULT_SOURCES = ['target', 'proxy', 'policy', 'apigee', 'mp']

/** densable mbv — known Apigee fault codes */
const APIGEE_FAULT_CODES = [
  'flow.APITimedOut',
  'flow.SharedFlowNotFound',
  'messaging.adaptors.http.flow.ApplicationNotFound',
  'messaging.adaptors.http.flow.DecompressionFailureAtRequest',
  'messaging.adaptors.http.flow.DecompressionFailureAtResponse',
  'messaging.adaptors.http.flow.ErrorResponseCode',
  'messaging.adaptors.http.flow.GatewayTimeout',
  'messaging.adaptors.http.flow.LengthRequired',
  'messaging.adaptors.http.flow.NoActiveTargets',
  'messaging.adaptors.http.flow.ServiceUnavailable',
  'messaging.adaptors.http.flow.SslHandshakeFailed',
  'messaging.adaptors.http.flow.UnexpectedEOFAtTarget',
  'messaging.runtime.RouteFailed',
  'messaging.runtime.TargetMissing',
  'protocol.http.BadPath',
  'protocol.http.DuplicateHeader',
  'protocol.http.ProxyTunnelCreationFailed',
  'protocol.http.Response405WithoutAllowHeader',
  'protocol.http.TooBigBody',
  'protocol.http.TooBigHeaders',
  'protocol.http.TooBigLine',
  'protocol.http.UnsupportedEncoding',
  'policies.ratelimit.QuotaViolation',
  'policies.ratelimit.SpikeArrestViolation',
  'policies.ratelimit.InvalidMessageWeight',
  'policies.concurrentratelimit.ConcurrentRatelimitViolation',
  'steps.raisefault.RaiseFault',
  'steps.jsonthreatprotection.ExecutionFailed',
  'steps.regexprotection.ThreatDetected',
  'steps.servicecallout.ExecutionFailed',
  'steps.javascript.ScriptExecutionFailed',
  'oauth.v2.InvalidAccessToken',
  'oauth.v2.InvalidApiKey',
  'oauth.v2.InvalidApiKeyForGivenResource',
  'oauth.v2.FailedToResolveAPIKey',
  'keymanagement.service.access_token_expired',
  'keymanagement.service.access_token_not_approved',
  'keymanagement.service.invalid_access_token',
  'keymanagement.service.consumer_key_expired',
  'keymanagement.service.invalid_consumer_key',
  'keymanagement.service.InvalidAPICallAsNoApiProductMatchFound',
  'security.util.KeyAliasNotFound',
]

/** densable hbv */
const APIGEE_FAULT_PREFIXES = [
  'messaging',
  'protocol',
  'flow',
  'steps',
  'policies',
  'security',
  'keymanagement',
  'oauth',
  'mintstep',
  'scripts',
]

/** densable Abv */
export const BODY_KIND_LABELS = {
  empty: 'empty body',
  'event-stream':
    'body is an event stream (the non-streaming request was answered with a stream)',
  html: 'body is an HTML page',
  xml: 'body is an XML document',
  'json-text': 'body is JSON served under a non-JSON content-type',
  'json-not-message': 'body is JSON but not a Message',
  'other-text': 'body is unrecognized text',
  other: 'body is unrecognized',
} as const

export type BodyKind = keyof typeof BODY_KIND_LABELS

export type ContentTypeKind =
  | 'none'
  | 'json'
  | 'event-stream'
  | 'html'
  | 'text'
  | 'xml'
  | 'aws-eventstream'
  | 'other'
  | string

export type UnexpectedResponseSnapshot = {
  status: number | null
  content_type: ContentTypeKind
  content_length: number | null
  request_id: string | null
  request_id_header: 'anthropic' | 'other' | 'absent'
  server: string
  apigee_fault_source: string | null
  apigee_fault_code: string | null
  intermediary_headers: string[]
}

export type OriginatingStreamFailure = {
  requestId?: string | null
  cause?: string | null
  errorName?: string | null
  connectionCode?: string | null
  stall?: {
    events_received: number
    ms_to_first_event: number | null
    ms_since_last_event: number | null
  } | null
}

export type UnexpectedApiResponseInput = {
  data: unknown
  status?: number | null
  headers?: Headers | { get(name: string): string | null } | null
  originating?: OriginatingStreamFailure | null
}

function firstSegment(value: string, sep: string): string {
  const i = value.indexOf(sep)
  return i === -1 ? value : value.slice(0, i)
}

/** densable M2n + Rai/Qr — only Anthropic-shaped request ids are kept */
export function parseAnthropicRequestId(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null
  return ANTHROPIC_REQUEST_ID_RE.test(value) ? value : null
}

/** densable ubv */
export function classifyContentType(
  contentType: string | null | undefined,
): ContentTypeKind {
  const t = contentType
    ? firstSegment(contentType, ';').trim().toLowerCase()
    : ''
  switch (t) {
    case '':
      return 'none'
    case 'application/json':
      return 'json'
    case 'text/event-stream':
      return 'event-stream'
    case 'text/html':
    case 'application/xhtml+xml':
      return 'html'
    case 'text/plain':
      return 'text'
    case 'application/xml':
    case 'text/xml':
      return 'xml'
    case 'application/vnd.amazon.eventstream':
      return 'aws-eventstream'
    default:
      return t.endsWith('+json') ? 'json' : t || 'other'
  }
}

/** densable pbv */
export function classifyServerHeader(
  server: string | null | undefined,
): string {
  if (!server) return 'absent'
  const lower = server.toLowerCase()
  return SERVER_PATTERNS.find(([, re]) => re.test(lower))?.[0] ?? 'other'
}

/** densable gbv */
function classifyApigeeFaultSource(
  value: string | null | undefined,
): string | null {
  if (!value) return null
  const t = value.trim().toLowerCase()
  return APIGEE_FAULT_SOURCES.find(s => s === t) ?? 'other'
}

/** densable ybv */
function classifyApigeeFaultCode(
  value: string | null | undefined,
): string | null {
  if (!value) return null
  const t = value.trim()
  const exact = APIGEE_FAULT_CODES.find(c => c === t)
  if (exact) return exact
  const prefix = firstSegment(t, '.')
  const known = APIGEE_FAULT_PREFIXES.find(p => p === prefix)
  return known ? `${known}.other` : 'other'
}

function headerGet(
  headers: UnexpectedApiResponseInput['headers'],
  name: string,
): string | null {
  if (!headers) return null
  try {
    return headers.get(name)
  } catch {
    return null
  }
}

function forEachHeader(
  headers: UnexpectedApiResponseInput['headers'],
  fn: (value: string, key: string) => void,
): void {
  if (!headers) return
  if (
    typeof (headers as Headers).forEach === 'function' &&
    !(headers instanceof Map)
  ) {
    ;(headers as Headers).forEach(fn)
    return
  }
  // Headers-like with iterators
  const anyHeaders = headers as {
    entries?: () => IterableIterator<[string, string]>
  }
  if (typeof anyHeaders.entries === 'function') {
    for (const [k, v] of anyHeaders.entries()) fn(v, k)
  }
}

/** densable tHa */
export function snapshotUnexpectedResponse(
  status: number | null | undefined,
  headers: UnexpectedApiResponseInput['headers'],
): UnexpectedResponseSnapshot {
  const intermediary = new Set<string>()
  forEachHeader(headers, (_value, key) => {
    const a = key.toLowerCase()
    if (INTERMEDIARY_HEADERS.has(a)) {
      intermediary.add(a)
      return
    }
    const prefix = INTERMEDIARY_HEADER_PREFIXES.find(p => a.startsWith(p))
    if (prefix) intermediary.add(`${prefix}*`)
  })

  const rawLen = headerGet(headers, 'content-length')
  const parsedLen = Number.parseInt(rawLen ?? '', 10)
  const rawRequestId = headerGet(headers, 'request-id')
  const requestId = parseAnthropicRequestId(rawRequestId)

  return {
    status: status ?? null,
    content_type: classifyContentType(headerGet(headers, 'content-type')),
    content_length:
      Number.isFinite(parsedLen) && parsedLen >= 0 ? parsedLen : null,
    request_id: requestId,
    request_id_header: requestId
      ? 'anthropic'
      : rawRequestId
        ? 'other'
        : 'absent',
    server: classifyServerHeader(headerGet(headers, 'server')),
    apigee_fault_source: classifyApigeeFaultSource(
      headerGet(headers, 'x-apigee-fault-source'),
    ),
    apigee_fault_code: classifyApigeeFaultCode(
      headerGet(headers, 'x-apigee-fault-code'),
    ),
    intermediary_headers: [...intermediary].sort(),
  }
}

/** densable Sbv */
export function classifyUnexpectedBody(data: unknown): BodyKind {
  if (data === null || data === undefined) return 'empty'
  if (typeof data === 'string') {
    const lead = data.trimStart().slice(0, 16)
    if (lead.length === 0) return 'empty'
    if (EVENT_STREAM_LEAD_RE.test(lead)) return 'event-stream'
    if (lead.startsWith('<')) {
      return lead.startsWith('<?xml') ? 'xml' : 'html'
    }
    if (lead.startsWith('{') || lead.startsWith('[')) return 'json-text'
    return 'other-text'
  }
  return typeof data === 'object' ? 'json-not-message' : 'other'
}

/** densable OUf — non-streaming body is a Message-shaped object */
export function isAnthropicMessageShape(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'content' in data &&
    'model' in data &&
    'usage' in data &&
    Array.isArray((data as { content: unknown }).content) &&
    typeof (data as { model: unknown }).model === 'string' &&
    typeof (data as { usage: unknown }).usage === 'object'
  )
}

export type UnexpectedResponseDescription = {
  summary: string
  bodyKind: BodyKind
  bodyBytes: number | null
  response: UnexpectedResponseSnapshot
}

/** densable Tbv */
export function describeUnexpectedApiResponse(
  input: UnexpectedApiResponseInput,
): UnexpectedResponseDescription {
  try {
    const response = snapshotUnexpectedResponse(input.status, input.headers)
    const bodyKind = classifyUnexpectedBody(input.data)
    const bodyBytes =
      typeof input.data === 'string'
        ? Buffer.byteLength(input.data, 'utf8')
        : bodyKind === 'empty'
          ? 0
          : response.content_length

    const parts = [
      ` Response: content-type ${response.content_type}`,
      BODY_KIND_LABELS[bodyKind],
      bodyBytes === null ? 'size unknown' : `${bodyBytes} bytes`,
      `request-id ${
        response.request_id ??
        (response.request_id_header === 'other'
          ? 'present but not Anthropic-issued'
          : 'absent')
      }`,
      ...(response.server === 'absent' ? [] : [`server ${response.server}`]),
      ...(response.intermediary_headers.length > 0
        ? [`intermediary headers ${response.intermediary_headers.join(' ')}`]
        : []),
    ]
    const responseSummary = parts.join(', ')

    const originating = input.originating
    const failBits = originating
      ? [originating.cause, originating.errorName, originating.connectionCode]
          .filter(p => p && p !== 'Error')
          .join(', ')
      : ''
    const stall = originating?.stall
    const stallSuffix = stall
      ? `; ${[
          `${stall.events_received} stream ${plural(stall.events_received, 'event')} received`,
          ...(stall.ms_to_first_event === null
            ? []
            : [`first after ${stall.ms_to_first_event} ms`]),
          ...(stall.ms_since_last_event === null
            ? []
            : [`none in the final ${stall.ms_since_last_event} ms`]),
        ].join(', ')}`
      : ''
    const originatingSuffix = originating
      ? ` This was the non-streaming retry of streaming request ${
          originating.requestId ?? '(no Anthropic request-id)'
        }, which failed with: ${failBits}${stallSuffix}.`
      : ''

    return {
      summary: `${responseSummary}.${originatingSuffix}`,
      bodyKind,
      bodyBytes,
      response,
    }
  } catch (err) {
    logForDebugging(
      `unexpected-response description failed: ${errorMessage(err)}`,
      { level: 'error' },
    )
    return {
      summary: '',
      bodyKind: 'other',
      bodyBytes: null,
      response: snapshotUnexpectedResponse(undefined, undefined),
    }
  }
}

/**
 * densable Pai extends wt (TelemetrySafeError).
 * User message embeds diagnostics; telemetryMessage stays the short gold string.
 */
export class UnexpectedApiResponseError extends TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  readonly bodyKind: BodyKind
  readonly bodyBytes: number | null
  readonly response: UnexpectedResponseSnapshot

  constructor(input: UnexpectedApiResponseInput) {
    const described = describeUnexpectedApiResponse(input)
    super(
      `API returned an empty or malformed response (HTTP ${input.status ?? 'unknown'}) — check for a proxy or gateway intercepting the request.${described.summary}`,
      'API returned an empty or malformed response',
    )
    this.name = 'UnexpectedApiResponseError'
    this.bodyKind = described.bodyKind
    this.bodyBytes = described.bodyBytes
    this.response = described.response
  }
}
