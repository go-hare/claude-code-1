/**
 * Official En_ — CRI org-policy webhook precheck (densable 2.1.239 #44).
 *
 * When cri.enabled && cri.policy.webhook is set, POST the request to the
 * webhook. block:true → 400 policy_blocked + x-should-retry:false so Cew
 * does not resend before the rejection is shown.
 *
 * Official strings / shape only. No second host / KFy MITM. Config is the
 * official `e.cri` bag — but ONLY from admin-managed policySettings.
 * Merged settings are passthrough, so project `.claude/settings.json` must
 * not be able to point this webhook at an attacker URL.
 */

import { APIError } from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { isIP } from 'net'

export const ORG_POLICY_BLOCKED_MESSAGE =
  "blocked by your organization's policy"
export const ORG_POLICY_REASON_MAX = 500
export const ORG_POLICY_BLOCKED_STATUS = 400
export const ORG_POLICY_BLOCKED_TYPE = 'policy_blocked'

export type CriPolicyWebhookConfig = {
  url: string
  timeout_ms?: number
  /** Official: fail_closed !== false → fail-closed. unset/true = closed. */
  fail_closed?: boolean
}

export type CriConfig = {
  enabled?: boolean
  policy?: {
    webhook?: CriPolicyWebhookConfig
  }
}

export type CriPolicyPrincipal = {
  sub: string
}

export type CriPolicyRequestMeta = {
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
}

export type CriPolicyWebhookDecision = {
  block?: unknown
  reason?: unknown
  rule_id?: unknown
}

export type OrgPolicyBlockedResponse = {
  status: typeof ORG_POLICY_BLOCKED_STATUS
  type: typeof ORG_POLICY_BLOCKED_TYPE
  message: string
  request_id: string
  headers: { 'x-should-retry': 'false' }
  cause: 'policy_hit' | 'engine_error'
  rule_id?: string
}

/** densable vIT — trim control chars, cap reason at 500, else wn_. */
export function sanitizeOrgPolicyReason(raw: string): string {
  const t = raw.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim()
  if (t.length === 0) return ORG_POLICY_BLOCKED_MESSAGE
  const r = Array.from(t)
  return r.length > ORG_POLICY_REASON_MAX
    ? r.slice(0, ORG_POLICY_REASON_MAX).join('') + '\u2026'
    : t
}

/** densable En_ gate: cri.enabled ? cri.policy.webhook : undefined. */
export function resolveCriPolicyWebhook(
  config: CriConfig | undefined | null,
): CriPolicyWebhookConfig | null {
  const t = config?.enabled ? config.policy?.webhook : undefined
  return t ?? null
}

export function isCriPolicyFailClosed(
  webhook: CriPolicyWebhookConfig,
): boolean {
  return webhook.fail_closed !== false
}

/** densable En_ i() — 400 policy_blocked + x-should-retry:false. */
export function buildOrgPolicyBlockedResponse(input: {
  requestId: string
  message: string
  cause: OrgPolicyBlockedResponse['cause']
  ruleId?: string
}): OrgPolicyBlockedResponse {
  return {
    status: ORG_POLICY_BLOCKED_STATUS,
    type: ORG_POLICY_BLOCKED_TYPE,
    message: input.message,
    request_id: input.requestId,
    headers: { 'x-should-retry': 'false' },
    cause: input.cause,
    ...(input.ruleId !== undefined ? { rule_id: input.ruleId } : {}),
  }
}

export type CriPolicyPrecheckResult =
  | { action: 'allow' }
  | { action: 'skip'; cause: 'decision_shape' | 'engine_error' }
  | { action: 'block'; response: OrgPolicyBlockedResponse }

/**
 * Official En_ precheck decision after the webhook returns (or throws).
 * Network I/O stays in the caller so tests lock the machine without a host.
 */
export function decideCriPolicyWebhookResult(input: {
  failClosed: boolean
  requestId: string
  principalSub: string
  error?: unknown
  httpOk?: boolean
  decision?: unknown
}): CriPolicyPrecheckResult {
  if (input.error !== undefined || input.httpOk === false) {
    if (input.failClosed) {
      return {
        action: 'block',
        response: buildOrgPolicyBlockedResponse({
          requestId: input.requestId,
          message: 'policy check unavailable',
          cause: 'engine_error',
        }),
      }
    }
    return { action: 'skip', cause: 'engine_error' }
  }

  const h = input.decision
  if (typeof h !== 'object' || h === null || Array.isArray(h)) {
    if (input.failClosed) {
      return {
        action: 'block',
        response: buildOrgPolicyBlockedResponse({
          requestId: input.requestId,
          message: 'policy check unavailable',
          cause: 'engine_error',
        }),
      }
    }
    return { action: 'skip', cause: 'engine_error' }
  }

  const p = h as CriPolicyWebhookDecision
  if (typeof p.block !== 'boolean') {
    if (input.failClosed) {
      return {
        action: 'block',
        response: buildOrgPolicyBlockedResponse({
          requestId: input.requestId,
          message: 'policy check unavailable',
          cause: 'engine_error',
        }),
      }
    }
    return { action: 'skip', cause: 'decision_shape' }
  }

  if (p.block !== true) {
    return { action: 'allow' }
  }

  const reason =
    typeof p.reason === 'string' && p.reason.length > 0
      ? sanitizeOrgPolicyReason(p.reason)
      : ORG_POLICY_BLOCKED_MESSAGE
  const ruleId = typeof p.rule_id === 'string' ? p.rule_id : undefined
  return {
    action: 'block',
    response: buildOrgPolicyBlockedResponse({
      requestId: input.requestId,
      message: reason,
      cause: 'policy_hit',
      ruleId,
    }),
  }
}

/** Official x-principal-sub: strip non-printable ASCII. */
export function sanitizePrincipalSub(sub: string): string {
  return sub.replace(/[^\x21-\x7e]/g, '')
}

export function orgPolicyBlockedToAPIError(
  response: OrgPolicyBlockedResponse,
): APIError {
  return new APIError(
    ORG_POLICY_BLOCKED_STATUS,
    {
      type: 'error',
      error: { type: ORG_POLICY_BLOCKED_TYPE, message: response.message },
    },
    response.message,
    new Headers(response.headers),
  )
}

function pickCri(bag: unknown): CriConfig | undefined {
  if (bag === null || typeof bag !== 'object' || Array.isArray(bag)) {
    return undefined
  }
  const cri = (bag as { cri?: unknown }).cri
  if (cri === null || typeof cri !== 'object' || Array.isArray(cri)) {
    return undefined
  }
  return cri as CriConfig
}

/** Admin-managed policy origins that may install a CRI webhook. */
export function isTrustedCriPolicyOrigin(
  origin: string | null | undefined,
): boolean {
  return (
    origin === 'remote' ||
    origin === 'helper' ||
    origin === 'plist' ||
    origin === 'hklm' ||
    origin === 'file'
  )
}

/**
 * Read cri only from a policy bag + trusted origin. Merged/project/user
 * settings are ignored — that is the clone-repo exfil guard.
 */
export function resolveCriPolicyConfigFromSources(input: {
  policy: unknown
  origin: string | null | undefined
}): CriConfig | undefined {
  if (!isTrustedCriPolicyOrigin(input.origin)) return undefined
  return pickCri(input.policy)
}

const CRI_REDACT_HEADER_NAMES = new Set([
  'authorization',
  'x-api-key',
  'proxy-authorization',
  'cookie',
  'set-cookie',
])

/** Strip credentials before the webhook sees the Anthropic request meta. */
export function redactCriForwardedHeaders(
  headers?: Record<string, string>,
): Record<string, string> | undefined {
  if (!headers) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (!CRI_REDACT_HEADER_NAMES.has(key.toLowerCase())) {
      out[key] = value
    }
  }
  return out
}

/** Bun/WHATWG rewrite ::ffff:127.0.0.1 → ::ffff:7f00:1. Expand either form. */
function ipv4FromMapped6(host: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host)
  if (dotted?.[1]) return dotted[1]
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (!hex?.[1] || !hex[2]) return null
  const hi = parseInt(hex[1], 16)
  const lo = parseInt(hex[2], 16)
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
}

function isBlockedCriWebhookHostname(hostname: string): boolean {
  let t = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (t.endsWith('.')) t = t.slice(0, -1)
  if (t === '' || t === 'localhost' || t.endsWith('.localhost')) return true

  const kind = isIP(t)
  if (kind === 4) {
    const [a, b] = t.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true
    return false
  }

  if (kind === 6) {
    const mapped = ipv4FromMapped6(t)
    if (mapped) return isBlockedCriWebhookHostname(mapped)
    if (t === '::1' || t === '::') return true
    // fe80::/10 link-local; fc00::/7 ULA — only on IPv6 literals, not DNS names.
    const first = parseInt(/^([0-9a-f]{1,4}):/.exec(t)?.[1] ?? '0', 16)
    return (
      (first >= 0xfe80 && first <= 0xfebf) ||
      (first >= 0xfc00 && first <= 0xfdff)
    )
  }

  return false
}

/** https + public host only. http / loopback / RFC1918 / metadata → reject. */
export function isAllowedCriWebhookUrl(urlString: string): boolean {
  try {
    const u = new URL(urlString)
    if (u.protocol !== 'https:') return false
    if (u.username !== '' || u.password !== '') return false
    return !isBlockedCriWebhookHostname(u.hostname)
  } catch {
    return false
  }
}

/** undefined = read settings; null = force off; object = inject. */
let injectedCriConfig: CriConfig | null | undefined

export function setCriPolicyConfigForTests(
  config: CriConfig | null | undefined,
): void {
  injectedCriConfig = config
}

/**
 * Official En_ `e.cri` — policySettings + admin origin only.
 * Project/user/local passthrough cri is ignored (fail-open).
 */
export function getCriPolicyConfig(): CriConfig | undefined {
  if (injectedCriConfig !== undefined) {
    return injectedCriConfig ?? undefined
  }
  try {
    // Lazy: settings → auth SCC must not load from this leaf at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSettingsForSource, getPolicySettingsOrigin } =
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    return resolveCriPolicyConfigFromSources({
      policy: getSettingsForSource('policySettings'),
      origin: getPolicySettingsOrigin(),
    })
  } catch {
    return undefined
  }
}

export type CriPolicyPrecheck = {
  precheck: (
    principal: CriPolicyPrincipal,
    body: unknown,
    requestId: string,
    meta: CriPolicyRequestMeta,
    org?: string,
    act?: string,
  ) => Promise<void>
}

function isAbortTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' ||
      error.message === 'The operation timed out.')
  )
}

/**
 * Official En_(e) — `{ precheck }` or null when webhook is unset.
 */
export function createCriPolicyPrecheck(
  config: CriConfig | undefined | null,
  fetchImpl: typeof fetch = fetch,
): CriPolicyPrecheck | null {
  const webhook = resolveCriPolicyWebhook(config)
  if (!webhook) return null
  const failClosed = isCriPolicyFailClosed(webhook)

  return {
    async precheck(principal, body, requestId, meta) {
      const principalSub = sanitizePrincipalSub(principal.sub)
      let result: CriPolicyPrecheckResult
      if (!isAllowedCriWebhookUrl(webhook.url)) {
        result = decideCriPolicyWebhookResult({
          failClosed,
          requestId,
          principalSub,
          error: new Error('policy webhook url is not allowed'),
        })
        if (result.action === 'block') {
          throw orgPolicyBlockedToAPIError(result.response)
        }
        return
      }
      try {
        const init: RequestInit = {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-request-id': requestId,
            'x-principal-sub': principalSub,
          },
          body: JSON.stringify({
            path: meta.path,
            query: meta.query,
            headers: redactCriForwardedHeaders(meta.headers),
            body,
          }),
        }
        if (
          typeof webhook.timeout_ms === 'number' &&
          Number.isFinite(webhook.timeout_ms)
        ) {
          init.signal = AbortSignal.timeout(webhook.timeout_ms)
        }
        const response = await fetchImpl(webhook.url, init)
        if (!response.ok) {
          throw new Error('policy webhook returned a non-OK status')
        }
        const decision: unknown = await response.json()
        result = decideCriPolicyWebhookResult({
          failClosed,
          requestId,
          principalSub,
          httpOk: true,
          decision,
        })
      } catch (error) {
        result = decideCriPolicyWebhookResult({
          failClosed,
          requestId,
          principalSub,
          error: isAbortTimeout(error)
            ? new Error('policy webhook timed out')
            : error,
        })
      }
      if (result.action === 'block') {
        throw orgPolicyBlockedToAPIError(result.response)
      }
    },
  }
}

export async function assertCriPolicyAllowsRequest(input?: {
  requestId?: string
  principalSub?: string
  org?: string
  act?: string
  path?: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
  fetchImpl?: typeof fetch
}): Promise<void> {
  const precheck = createCriPolicyPrecheck(
    getCriPolicyConfig(),
    input?.fetchImpl,
  )
  if (!precheck) return

  let principalSub = input?.principalSub
  let org = input?.org
  if (principalSub === undefined || org === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getOauthAccountInfo } =
        require('./auth.js') as typeof import('./auth.js')
      const account = getOauthAccountInfo()
      principalSub ??= account?.accountUuid ?? ''
      org ??= account?.organizationUuid
    } catch {
      principalSub ??= ''
    }
  }

  await precheck.precheck(
    { sub: principalSub },
    input?.body,
    input?.requestId ?? randomUUID(),
    {
      path: input?.path ?? '/v1/messages',
      ...(input?.query !== undefined ? { query: input.query } : {}),
      ...(input?.headers !== undefined ? { headers: input.headers } : {}),
    },
    org,
    input?.act,
  )
}

/**
 * Official En_ intercept — real path/query/headers/body from the outgoing
 * Anthropic SDK fetch. Call before gzip so the webhook sees JSON, not bytes.
 * leftover factory is request-scoped; no leftover `.precheck(` site.
 */
export async function criPolicyPrecheckFetchInput(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetchImpl?: typeof fetch,
): Promise<void> {
  // Official En_(e) is null when webhook is unset — no intercept, no body parse.
  const webhook = resolveCriPolicyWebhook(getCriPolicyConfig())
  if (!webhook) return
  const failClosed = isCriPolicyFailClosed(webhook)

  const throwOrSkipParseError = (error: unknown, requestId?: string): void => {
    const result = decideCriPolicyWebhookResult({
      failClosed,
      requestId: requestId ?? randomUUID(),
      principalSub: '',
      error,
    })
    if (result.action === 'block') {
      throw orgPolicyBlockedToAPIError(result.response)
    }
  }

  let path: string
  let query: Record<string, string>
  let headers: Record<string, string>
  let body: unknown
  let requestId: string | undefined

  if (typeof Request !== 'undefined' && input instanceof Request) {
    let url: URL
    try {
      url = new URL(input.url)
    } catch (error) {
      throwOrSkipParseError(error)
      return
    }
    path = url.pathname
    query = Object.fromEntries(url.searchParams)
    const merged = new Headers(input.headers)
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => {
        merged.set(key, value)
      })
    }
    headers = Object.fromEntries(merged)
    requestId =
      merged.get('x-client-request-id') ??
      merged.get('x-request-id') ??
      undefined
    try {
      body = await input.clone().json()
    } catch (error) {
      throwOrSkipParseError(error, requestId)
      return
    }
  } else {
    let url: URL
    try {
      url = new URL(String(input))
    } catch (error) {
      throwOrSkipParseError(error)
      return
    }
    path = url.pathname
    query = Object.fromEntries(url.searchParams)
    const parsedHeaders = new Headers(init?.headers)
    headers = Object.fromEntries(parsedHeaders)
    requestId =
      parsedHeaders.get('x-client-request-id') ??
      parsedHeaders.get('x-request-id') ??
      undefined
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch (error) {
        throwOrSkipParseError(error, requestId)
        return
      }
    }
  }

  await assertCriPolicyAllowsRequest({
    path,
    query,
    headers,
    body,
    requestId,
    fetchImpl,
  })
}
