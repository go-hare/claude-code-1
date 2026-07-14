/**
 * Official WebFetch/WebSearch CCR proxy densables (2.1.207).
 *
 * Session-worker path (product truth in 207):
 *   X0d / s_d gate: firstParty + CLAUDE_CODE_WEB{SEARCH,FETCH}_USE_CCR_PROXY +
 *   CLAUDE_CODE_SESSION_ID matching cse_*|session_*
 *   ECs POST {ANTHROPIC_BASE_URL}/v1/code/sessions/{id}/worker/{web-search|web-fetch}
 *
 * Legacy shttp densables (session_ingress URL rewrite) remain for portable
 * plan/unwrap helpers and tests; WebSearch/WebFetch product consumers prefer
 * the session-worker path when the 207 gate is on.
 */

import axios from 'axios'
import { isEnvTruthy } from './envUtils.js'
import { isAbortError } from './errors.js'
import { logForDebugging } from './debug.js'
import { getAPIProvider } from './model/providers.js'
import { getSessionIngressAuthHeaders } from './sessionIngressAuth.js'

export function shouldWebFetchUseCcrProxy(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_WEBFETCH_USE_CCR_PROXY)
}

export function shouldWebSearchUseCcrProxy(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_WEBSEARCH_USE_CCR_PROXY)
}

/** Official densable path marker for session-ingress shttp webfetch proxy. */
export const CCR_WEBFETCH_PROXY_PATH = '/v2/session_ingress/shttp/webfetch'

/** Official densable path marker for session-ingress shttp websearch proxy. */
export const CCR_WEBSEARCH_PROXY_PATH = '/v2/session_ingress/shttp/websearch'

/**
 * Official densable — resolve CCR session ingress base URL.
 * Prefer SESSION_INGRESS_URL, then CLAUDE_BRIDGE_SESSION_INGRESS_URL,
 * then ANTHROPIC_BASE_URL / CLAUDE_CODE_API_BASE_URL.
 */
export function resolveCcrIngressBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const candidates = [
    env.SESSION_INGRESS_URL,
    env.CLAUDE_BRIDGE_SESSION_INGRESS_URL,
    env.CLAUDE_CODE_API_BASE_URL,
    env.ANTHROPIC_BASE_URL,
  ]
  for (const c of candidates) {
    const v = c?.trim()
    if (v) return v.replace(/\/+$/, '')
  }
  return undefined
}

/**
 * Official densable — rewrite target URL through CCR shttp webfetch proxy.
 * Original URL is preserved in the `url` query param (same pattern as MCP
 * mcp_url rewriter).
 */
export function buildCcrWebFetchProxyUrl(input: {
  targetUrl: string
  ingressBaseUrl: string
  sessionId?: string | null
}): string {
  const base = input.ingressBaseUrl.replace(/\/+$/, '')
  const u = new URL(`${base}${CCR_WEBFETCH_PROXY_PATH}`)
  u.searchParams.set('url', input.targetUrl)
  const sid = input.sessionId?.trim()
  if (sid) u.searchParams.set('session_id', sid)
  return u.toString()
}

/**
 * Official densable — rewrite search through CCR shttp websearch proxy.
 */
export function buildCcrWebSearchProxyUrl(input: {
  query: string
  ingressBaseUrl: string
  sessionId?: string | null
}): string {
  const base = input.ingressBaseUrl.replace(/\/+$/, '')
  const u = new URL(`${base}${CCR_WEBSEARCH_PROXY_PATH}`)
  u.searchParams.set('q', input.query)
  const sid = input.sessionId?.trim()
  if (sid) u.searchParams.set('session_id', sid)
  return u.toString()
}

export type WebFetchCcrProxyPlan =
  | {
      useProxy: true
      fetchUrl: string
      headers: Record<string, string>
      originalUrl: string
    }
  | {
      useProxy: false
      fetchUrl: string
      headers: Record<string, string>
      originalUrl: string
      reason: 'gate_off' | 'no_ingress_base' | 'invalid_target'
    }

/**
 * Official densable plan — whether WebFetch should route through CCR proxy.
 * Pure: no I/O. Callers inject env/ingress/token/sessionId.
 */
export function planWebFetchCcrProxy(input: {
  targetUrl: string
  env?: NodeJS.ProcessEnv
  ingressBaseUrl?: string | null
  sessionId?: string | null
  authToken?: string | null
  forceUseProxy?: boolean
}): WebFetchCcrProxyPlan {
  const env = input.env ?? process.env
  const originalUrl = input.targetUrl
  const headers: Record<string, string> = {}
  const useGate = input.forceUseProxy === true || shouldWebFetchUseCcrProxy(env)
  if (!useGate) {
    return {
      useProxy: false,
      fetchUrl: originalUrl,
      headers,
      originalUrl,
      reason: 'gate_off',
    }
  }
  let targetOk = false
  try {
    // eslint-disable-next-line no-new
    new URL(originalUrl)
    targetOk = true
  } catch {
    targetOk = false
  }
  if (!targetOk) {
    return {
      useProxy: false,
      fetchUrl: originalUrl,
      headers,
      originalUrl,
      reason: 'invalid_target',
    }
  }
  const base =
    input.ingressBaseUrl?.trim() || resolveCcrIngressBaseUrl(env) || undefined
  if (!base) {
    return {
      useProxy: false,
      fetchUrl: originalUrl,
      headers,
      originalUrl,
      reason: 'no_ingress_base',
    }
  }
  const fetchUrl = buildCcrWebFetchProxyUrl({
    targetUrl: originalUrl,
    ingressBaseUrl: base,
    sessionId: input.sessionId,
  })
  const token = input.authToken?.trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return {
    useProxy: true,
    fetchUrl,
    headers,
    originalUrl,
  }
}

/**
 * Official densable — unwrap CCR webfetch proxy URL back to original target
 * when the path matches shttp/webfetch (mirror of unwrapCcrProxyUrl for MCP).
 */
export function unwrapCcrWebFetchProxyUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.pathname.includes('/shttp/webfetch')) return url
    return parsed.searchParams.get('url') || url
  } catch {
    return url
  }
}

// ---------------------------------------------------------------------------
// Official 2.1.207 session-worker CCR (Jho / X0d / s_d / ECs / Q0d / a_d)
// ---------------------------------------------------------------------------

/**
 * Official Jho — CCR cloud session id for worker proxy routes.
 * Only accepts cse_* or session_* prefixes from CLAUDE_CODE_SESSION_ID.
 */
export function resolveCcrCodeSessionId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const e = env.CLAUDE_CODE_SESSION_ID?.trim()
  if (e && (e.startsWith('cse_') || e.startsWith('session_'))) return e
  return undefined
}

/**
 * Official X0d — WebSearch uses CCR session worker when firstParty + env + session id.
 */
export function shouldWebSearchUseCcrSessionWorker(input?: {
  env?: NodeJS.ProcessEnv
  provider?: string
  sessionId?: string | null
}): boolean {
  const env = input?.env ?? process.env
  const provider = input?.provider ?? getAPIProvider()
  if (provider !== 'firstParty') return false
  if (!shouldWebSearchUseCcrProxy(env)) return false
  const sid =
    input?.sessionId !== undefined
      ? input.sessionId?.trim() || undefined
      : resolveCcrCodeSessionId(env)
  return !!sid
}

/**
 * Official s_d — WebFetch uses CCR session worker when firstParty + env + session id.
 */
export function shouldWebFetchUseCcrSessionWorker(input?: {
  env?: NodeJS.ProcessEnv
  provider?: string
  sessionId?: string | null
}): boolean {
  const env = input?.env ?? process.env
  const provider = input?.provider ?? getAPIProvider()
  if (provider !== 'firstParty') return false
  if (!shouldWebFetchUseCcrProxy(env)) return false
  const sid =
    input?.sessionId !== undefined
      ? input.sessionId?.trim() || undefined
      : resolveCcrCodeSessionId(env)
  return !!sid
}

export type CcrSessionWorkerError = {
  ok: false
  source: 'proxy' | 'target'
  statusCode: number
  errorType: string
  errorMessage: string
}

export type CcrSessionWorkerOk<T> = { ok: true; data: T }

export type CcrSessionWorkerResult<T> =
  | CcrSessionWorkerOk<T>
  | CcrSessionWorkerError

export type CcrWebSearchResult =
  | {
      ok: true
      results: Array<{ title: string; url: string; snippet?: string }>
    }
  | CcrSessionWorkerError

export type CcrWebFetchResult =
  | {
      ok: true
      content: string
      contentType: string
      destinationUrl?: string
    }
  | CcrSessionWorkerError

type CcrWorkerEnvelope = {
  results?: Array<{ title?: string; url?: string; snippet?: string }>
  url?: string
  destination_url?: string | null
  title?: string
  text?: string
  content_type?: string | null
  error?: {
    error_type: string
    error_message: string
  } | null
}

/**
 * Official ECs densable — POST session worker route under /v1/code/sessions/{id}/worker/{route}.
 */
export async function postCcrSessionWorker(input: {
  route: 'web-search' | 'web-fetch'
  toolName: string
  logLabel: string
  targetErrorLabel: string
  body: Record<string, unknown>
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  sessionId?: string | null
  baseUrl?: string | null
  authHeaders?: Record<string, string>
  /** Injectable POST for tests. */
  post?: typeof axios.post
}): Promise<CcrSessionWorkerResult<CcrWorkerEnvelope>> {
  const env = input.env ?? process.env
  const sessionId =
    (input.sessionId?.trim() || resolveCcrCodeSessionId(env)) ?? undefined
  if (!sessionId) {
    return {
      ok: false,
      source: 'proxy',
      statusCode: 502,
      errorType: 'PROXY_TRANSPORT',
      errorMessage: `Request to the ${input.toolName} proxy failed (no session id).`,
    }
  }
  const base = (
    input.baseUrl?.trim() ||
    env.ANTHROPIC_BASE_URL ||
    'https://api.anthropic.com'
  ).replace(/\/+$/, '')
  const auth =
    input.authHeaders ??
    (() => {
      try {
        return getSessionIngressAuthHeaders()
      } catch {
        return {}
      }
    })()
  const url = `${base}/v1/code/sessions/${encodeURIComponent(sessionId)}/worker/${input.route}`
  const post = input.post ?? axios.post
  let response: {
    status: number
    data: unknown
  }
  try {
    response = await post(url, input.body, {
      signal: input.signal,
      timeout: 40_000,
      maxContentLength: 12_582_912,
      headers: {
        ...auth,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      validateStatus: () => true,
    })
  } catch (err) {
    if (isAbortError(err)) throw err
    const code =
      err instanceof Error && 'code' in err
        ? String((err as { code?: unknown }).code)
        : undefined
    logForDebugging(`ccr ${input.logLabel} transport error: ${code ?? ''}`, {
      level: 'warn',
    })
    return {
      ok: false,
      source: 'proxy',
      statusCode: 502,
      errorType: 'PROXY_TRANSPORT',
      errorMessage: `Request to the ${input.toolName} proxy failed (${code ?? 'transport error'}).`,
    }
  }
  if (response.status !== 200) {
    const data = response.data as { message?: unknown } | null
    const msg =
      typeof data?.message === 'string' ? data.message.slice(0, 200) : undefined
    logForDebugging(
      `ccr ${input.logLabel} returned HTTP ${response.status}${msg ? `: ${msg}` : ''}`,
      { level: 'warn' },
    )
    return {
      ok: false,
      source: 'proxy',
      statusCode: response.status,
      errorType: 'PROXY_REJECTED',
      errorMessage: `The ${input.toolName} proxy rejected the request (HTTP ${response.status}${msg ? `: ${msg}` : ''}).`,
    }
  }
  const data = response.data as CcrWorkerEnvelope | null
  if (!data || typeof data !== 'object') {
    logForDebugging(`ccr ${input.logLabel} returned unparseable body`, {
      level: 'warn',
    })
    return {
      ok: false,
      source: 'proxy',
      statusCode: 502,
      errorType: 'PROXY_BAD_RESPONSE',
      errorMessage: `The ${input.toolName} proxy returned a malformed response.`,
    }
  }
  if (data.error) {
    logForDebugging(
      `ccr ${input.logLabel} ${input.targetErrorLabel}: ${data.error.error_type}`,
      { level: 'warn' },
    )
    return {
      ok: false,
      source: 'target',
      statusCode: 502,
      errorType: data.error.error_type,
      errorMessage: data.error.error_message,
    }
  }
  return { ok: true, data }
}

/**
 * Official Q0d — web-search via CCR session worker.
 */
export async function searchViaCcrSessionWorker(input: {
  query: string
  signal?: AbortSignal
  allowedDomains?: string[]
  blockedDomains?: string[]
  env?: NodeJS.ProcessEnv
  sessionId?: string | null
  baseUrl?: string | null
  authHeaders?: Record<string, string>
  post?: typeof axios.post
}): Promise<CcrWebSearchResult> {
  const body: Record<string, unknown> = { query: input.query }
  if (input.allowedDomains?.length) {
    body.allowed_domains = input.allowedDomains
  }
  if (input.blockedDomains?.length) {
    body.blocked_domains = input.blockedDomains
  }
  const n = await postCcrSessionWorker({
    route: 'web-search',
    toolName: 'WebSearch',
    logLabel: 'websearch-proxy',
    targetErrorLabel: 'search error',
    body,
    signal: input.signal,
    env: input.env,
    sessionId: input.sessionId,
    baseUrl: input.baseUrl,
    authHeaders: input.authHeaders,
    post: input.post,
  })
  if (!n.ok) return n
  const results = (n.data.results ?? [])
    .filter((o): o is { title?: string; url: string; snippet?: string } =>
      Boolean(o?.url),
    )
    .map(o => ({
      title: o.title ?? '',
      url: o.url,
      ...(o.snippet ? { snippet: o.snippet } : {}),
    }))
  return { ok: true, results }
}

/**
 * Official a_d — web-fetch via CCR session worker.
 */
export async function fetchViaCcrSessionWorker(input: {
  url: string
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  sessionId?: string | null
  baseUrl?: string | null
  authHeaders?: Record<string, string>
  post?: typeof axios.post
}): Promise<CcrWebFetchResult> {
  const n = await postCcrSessionWorker({
    route: 'web-fetch',
    toolName: 'WebFetch',
    logLabel: 'webfetch-proxy',
    targetErrorLabel: 'fetch error',
    body: { url: input.url },
    signal: input.signal,
    env: input.env,
    sessionId: input.sessionId,
    baseUrl: input.baseUrl,
    authHeaders: input.authHeaders,
    post: input.post,
  })
  if (!n.ok) return n
  return {
    ok: true,
    content: n.data.text ?? '',
    contentType: n.data.content_type || 'text/plain',
    ...(n.data.destination_url
      ? { destinationUrl: n.data.destination_url }
      : {}),
  }
}

/**
 * Format CCR proxy failure for tool throw (official Bn(ke(...)) shape).
 */
export function formatCcrProxyToolError(err: CcrSessionWorkerError): string {
  return JSON.stringify({
    error_type: err.errorType,
    source: err.source,
    message: err.errorMessage,
  })
}
