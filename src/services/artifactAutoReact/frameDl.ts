/**
 * densable DL shared frame client (2.1.239) — get / post / getRelayOnly / postRelayOnly.
 * Gold: gold-sEe-relay (hqe / o$i / DL=…).
 *
 * Direct: claude.ai OAuth (host:"frame", auth:"claude-ai-oauth").
 * Relay: ccr-gateway session-jwt via agent-proxy/frame (wDi + sEe).
 */
import { getOauthConfig } from '../../constants/oauth.js'
import { getClaudeAIOAuthTokens } from '../../utils/auth.js'
import {
  getSessionIngressAuthHeaders,
  getSessionIngressAuthToken,
} from '../../utils/sessionIngressAuth.js'
import { resolveCcrIngressBaseUrl } from '../../utils/ccrProxyGates.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../analytics/index.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  artifactRelayFramePath,
  declineFrameRelay,
  isArtifactFrameRelayOpen,
  isFrameRelayDeclined,
  isFrameRelayServed,
  markFrameRelayServed,
  resolveSessionGatewayBaseUrl,
} from './frameRelay.js'
import {
  resolveFrameRelayFamily,
  type FrameRelayFamily,
} from './frameRelayFamily.js'

/** densable xlw — soft-fail statuses that fall back to direct. */
const RELAY_SOFT_FAIL = new Set([401, 403, 404, 413])
const RELAY_PROBE_TIMEOUT_MS = 15_000
/** densable Ilw — probe maxContentLength. */
export const RELAY_PROBE_MAX_BYTES = 65_536
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_CONTENT_BYTES = 8_000_000

/** densable dR — avoid mint↔frameDl cycle. */
function frameControlPlaneHeaders(): Record<string, string> {
  const desktop = process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop'
  return {
    'X-Frame-CP': 'go',
    'X-Frame-Surface': 'code',
    'X-Frame-Platform': desktop ? 'desktop' : 'cli',
    'X-Frame-Client-Version':
      typeof MACRO !== 'undefined' && MACRO.VERSION ? MACRO.VERSION : 'unknown',
  }
}
export type FrameDlRoute = 'direct' | 'relay'

export type FrameDlOk = {
  ok: true
  status: number
  data: unknown
  fromFrame: boolean
  route: FrameDlRoute
  headers: Headers
}

export type FrameDlErr = {
  ok: false
  reason: string
  status?: number
  fromFrame: boolean
  route: FrameDlRoute
  detail?: string
}

export type FrameDlResult = FrameDlOk | FrameDlErr

export type FrameDlRequestOpts = {
  signal?: AbortSignal
  timeoutMs?: number
  headers?: Record<string, string>
  /** densable refreshOAuth — tip: re-read tokens each call (always). */
  refreshOAuth?: boolean
  credentials?: unknown
  /**
   * densable relayProbe — GET this path first when family not yet served
   * (o$i probe path before the real request).
   */
  relayProbe?: string
  /** densable maxContentLength — reject oversized bodies. */
  maxContentLength?: number
}

export type FrameDlDeps = {
  fetch?: typeof globalThis.fetch
  oauthBearer?: () => string | null | Promise<string | null>
  claudeAiOrigin?: () => string
  resolveRelayBase?: () => string | undefined
  getRelayAuthHeaders?: () => Record<string, string>
  getRelayAuthToken?: () => string | null
  isRelayOpen?: () => boolean
}

let depsOverride: FrameDlDeps | null = null

export function setFrameDlDepsForTests(deps: FrameDlDeps | null): void {
  depsOverride = deps
}

function d(): FrameDlDeps {
  return depsOverride ?? {}
}

async function resolveOauthBearer(): Promise<string | null> {
  const custom = d().oauthBearer
  if (custom) return await custom()
  return getClaudeAIOAuthTokens()?.accessToken ?? null
}

function claudeAiOrigin(): string {
  return d().claudeAiOrigin?.() ?? getOauthConfig().CLAUDE_AI_ORIGIN
}

function relayBase(): string | undefined {
  return (
    d().resolveRelayBase?.() ??
    resolveSessionGatewayBaseUrl() ??
    resolveCcrIngressBaseUrl()
  )
}

async function readResponseBodyCapped(
  res: Response,
  maxBytes: number,
): Promise<unknown> {
  const cl = res.headers.get('content-length')
  if (cl !== null) {
    const n = Number(cl)
    if (Number.isFinite(n) && n > maxBytes) {
      throw new Error('max_content_length')
    }
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) {
    throw new Error('max_content_length')
  }
  const ct = (res.headers.get('content-type') ?? '').toLowerCase()
  if (ct.includes('application/json') || ct === '' || buf.length === 0) {
    if (buf.length === 0) return undefined
    try {
      return JSON.parse(buf.toString('utf8'))
    } catch {
      return buf.toString('utf8')
    }
  }
  return buf.toString('utf8')
}

async function fetchJson(input: {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: unknown
  signal?: AbortSignal
  timeoutMs: number
  maxContentLength?: number
}): Promise<{ status: number; data: unknown; headers: Headers }> {
  const fetchImpl = d().fetch ?? globalThis.fetch
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  if (input.signal) {
    if (input.signal.aborted) controller.abort()
    else input.signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  const maxBytes = input.maxContentLength ?? DEFAULT_MAX_CONTENT_BYTES
  try {
    const res = await fetchImpl(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller.signal,
      redirect: 'manual',
    })
    const data = await readResponseBodyCapped(res, maxBytes)
    return { status: res.status, data, headers: res.headers }
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
  }
}

async function directFrame(
  method: 'GET' | 'POST',
  path: string,
  body: unknown | undefined,
  opts: FrameDlRequestOpts,
): Promise<FrameDlResult> {
  const token = await resolveOauthBearer()
  if (!token) {
    return {
      ok: false,
      reason: 'no-auth',
      fromFrame: false,
      route: 'direct',
      detail: 'No claude.ai login',
    }
  }
  const url = `${claudeAiOrigin().replace(/\/+$/, '')}${path}`
  try {
    const res = await fetchJson({
      url,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...frameControlPlaneHeaders(),
        ...opts.headers,
      },
      body,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxContentLength: opts.maxContentLength,
    })
    return {
      ok: true,
      status: res.status,
      data: res.data,
      fromFrame: true,
      route: 'direct',
      headers: res.headers,
    }
  } catch (e) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (e instanceof Error && e.message === 'max_content_length') {
      return {
        ok: false,
        reason: 'max_content_length',
        fromFrame: false,
        route: 'direct',
      }
    }
    return {
      ok: false,
      reason: 'request_error',
      fromFrame: false,
      route: 'direct',
    }
  }
}

function familyMeta(
  family: FrameRelayFamily,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return family as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/** densable be("artifact_frame_relay", …) portable. */
function debugFrameRelay(
  kind: string,
  meta: Record<string, string | number | boolean | undefined>,
): void {
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ')
  logForDebugging(`artifact_frame_relay ${kind}${parts ? ` ${parts}` : ''}`)
}

function relayOnlyUnavailable(
  family: FrameRelayFamily | null,
  status: number,
  probed: boolean,
): FrameDlErr {
  debugFrameRelay('relay_only_unavailable', {
    ...(family !== null ? { family } : {}),
    status,
    probed,
  })
  return {
    ok: false,
    reason: 'relay-unavailable',
    status,
    fromFrame: false,
    route: 'relay',
  }
}

async function fetchViaRelayPath(
  method: 'GET' | 'POST',
  path: string,
  body: unknown | undefined,
  opts: FrameDlRequestOpts,
  timeoutMs: number,
  maxContentLength?: number,
): Promise<{ status: number; data: unknown; headers: Headers } | FrameDlErr> {
  const token = d().getRelayAuthToken
    ? d().getRelayAuthToken!()
    : getSessionIngressAuthToken()
  if (!token) {
    return {
      ok: false,
      reason: 'no-auth',
      fromFrame: false,
      route: 'relay',
      detail: 'No session access token',
    }
  }
  const base = relayBase()
  if (!base) {
    return {
      ok: false,
      reason: 'relay-unavailable',
      status: 0,
      fromFrame: false,
      route: 'relay',
    }
  }
  const auth = d().getRelayAuthHeaders?.() ?? getSessionIngressAuthHeaders()
  const url = `${base.replace(/\/+$/, '')}${artifactRelayFramePath(path)}`
  try {
    return await fetchJson({
      url,
      method,
      headers: {
        ...auth,
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...frameControlPlaneHeaders(),
        ...opts.headers,
      },
      body,
      signal: opts.signal,
      timeoutMs,
      maxContentLength,
    })
  } catch (e) {
    if (
      opts.signal?.aborted ||
      (e instanceof DOMException && e.name === 'AbortError')
    ) {
      throw e instanceof DOMException
        ? e
        : new DOMException('Aborted', 'AbortError')
    }
    if (e instanceof Error && e.message === 'max_content_length') {
      return {
        ok: false,
        reason: 'max_content_length',
        fromFrame: false,
        route: 'relay',
      }
    }
    throw e
  }
}

function hasUpstreamHeader(headers: Headers): boolean {
  return headers.get('x-ccr-relay-upstream') !== null
}

/** densable bZf — soft-fail only when upstream header absent. */
function isRelaySoftFail(status: number, headers: Headers): boolean {
  return !hasUpstreamHeader(headers) && RELAY_SOFT_FAIL.has(status)
}

/**
 * densable o$i — prefer relay when sEe + Mlw family; probe/family telemetry;
 * soft-fail → direct unless relayOnly.
 */
async function frameDlRequest(
  method: 'GET' | 'POST',
  path: string,
  body: unknown | undefined,
  opts: FrameDlRequestOpts = {},
  relayOnly = false,
): Promise<FrameDlResult> {
  const { relayProbe, ...rest } = opts
  const open = d().isRelayOpen?.() ?? isArtifactFrameRelayOpen()
  const family = open ? resolveFrameRelayFamily(method, path) : null

  if (family === null) {
    // densable: o&&l → relay_only_unavailable; tip also fails closed when
    // relayOnly && !sEe (safer than densable falling through to direct).
    if (relayOnly) return relayOnlyUnavailable(null, 0, false)
    return directFrame(method, path, body, rest)
  }

  if (!relayOnly && isFrameRelayDeclined(family)) {
    return directFrame(method, path, body, rest)
  }

  const fallBackDirect = async (
    status: number,
    probed: boolean,
  ): Promise<FrameDlResult> => {
    declineFrameRelay(family)
    if (relayOnly) return relayOnlyUnavailable(family, status, probed)
    let directStatus: number | undefined
    try {
      const k = await directFrame(method, path, body, rest)
      if (k.ok) directStatus = k.status
      return k
    } finally {
      debugFrameRelay('relay_unavailable', {
        family,
        status,
        probed,
        ...(directStatus !== undefined ? { direct_status: directStatus } : {}),
      })
    }
  }

  // densable probe GET before first served request for this family
  if (relayProbe !== undefined && !isFrameRelayServed(family)) {
    try {
      const probe = await fetchViaRelayPath(
        'GET',
        relayProbe,
        undefined,
        rest,
        RELAY_PROBE_TIMEOUT_MS,
        RELAY_PROBE_MAX_BYTES,
      )
      if ('ok' in probe && probe.ok === false) {
        return relayOnly ? probe : fallBackDirect(0, true)
      }
      const S = probe as { status: number; headers: Headers }
      if (
        isRelaySoftFail(S.status, S.headers) ||
        (!hasUpstreamHeader(S.headers) && (S.status >= 500 || S.status === 499))
      ) {
        return fallBackDirect(S.status, true)
      }
      if (!hasUpstreamHeader(S.headers) && S.status >= 300) {
        return relayOnly
          ? relayOnlyUnavailable(family, S.status, true)
          : directFrame(method, path, body, rest)
      }
      markFrameRelayServed(family)
    } catch (w) {
      if (
        opts.signal?.aborted ||
        (w instanceof DOMException && w.name === 'AbortError')
      ) {
        throw w instanceof DOMException
          ? w
          : new DOMException('Aborted', 'AbortError')
      }
      return fallBackDirect(0, true)
    }
  }

  try {
    const y = await fetchViaRelayPath(
      method,
      path,
      body,
      rest,
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      opts.maxContentLength,
    )
    if ('ok' in y && y.ok === false) {
      return relayOnly ? y : directFrame(method, path, body, rest)
    }
    const res = y as { status: number; data: unknown; headers: Headers }
    if (isRelaySoftFail(res.status, res.headers)) {
      return fallBackDirect(res.status, false)
    }
    const upstream = hasUpstreamHeader(res.headers)
    const fromFrame = upstream || res.status < 300
    if (fromFrame) {
      markFrameRelayServed(family)
      logEvent('artifact_frame_relay', {
        family: familyMeta(family),
        status: res.status,
        upstream,
      })
    } else if (res.status >= 500 || res.status === 499) {
      declineFrameRelay(family)
      debugFrameRelay('relay_error', { family, status: res.status })
    } else {
      debugFrameRelay('relay_refused', { family, status: res.status })
    }
    return {
      ok: true,
      status: res.status,
      data: res.data,
      fromFrame,
      route: 'relay',
      headers: res.headers,
    }
  } catch (S) {
    if (
      opts.signal?.aborted ||
      (S instanceof DOMException && S.name === 'AbortError')
    ) {
      throw S instanceof DOMException
        ? S
        : new DOMException('Aborted', 'AbortError')
    }
    declineFrameRelay(family)
    debugFrameRelay('request_error', { family })
    if (relayOnly) return relayOnlyUnavailable(family, 0, false)
    return directFrame(method, path, body, rest)
  }
}

/** densable DL.get */
export function frameDlGet(
  path: string,
  opts?: FrameDlRequestOpts,
): Promise<FrameDlResult> {
  return frameDlRequest('GET', path, undefined, opts, false)
}

/** densable DL.getRelayOnly */
export function frameDlGetRelayOnly(
  path: string,
  opts?: FrameDlRequestOpts,
): Promise<FrameDlResult> {
  return frameDlRequest('GET', path, undefined, opts, true)
}

/** densable DL.post */
export function frameDlPost(
  path: string,
  body: unknown,
  opts?: FrameDlRequestOpts,
): Promise<FrameDlResult> {
  return frameDlRequest('POST', path, body, opts, false)
}

/** densable DL.postRelayOnly */
export function frameDlPostRelayOnly(
  path: string,
  body: unknown,
  opts?: FrameDlRequestOpts,
): Promise<FrameDlResult> {
  return frameDlRequest('POST', path, body, opts, true)
}

/** densable DL object surface. */
export const DL = {
  get: frameDlGet,
  post: frameDlPost,
  getRelayOnly: frameDlGetRelayOnly,
  postRelayOnly: frameDlPostRelayOnly,
}
