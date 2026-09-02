/**
 * densable rxl / wMw / EMw / AMw — artifact asset blob transport (2.1.239).
 * Not DL: always gs.post (raw body). sEe → ccr-gateway session-jwt + wDi;
 * !sEe → frame OAuth. REMOTE without sEe → relay_unavailable.
 */
import { getOauthConfig } from '../../constants/oauth.js'
import { getClaudeAIOAuthTokens } from '../../utils/auth.js'
import {
  getSessionIngressAuthHeaders,
  getSessionIngressAuthToken,
} from '../../utils/sessionIngressAuth.js'
import { resolveCcrIngressBaseUrl } from '../../utils/ccrProxyGates.js'
import {
  artifactRelayFramePath,
  isArtifactFrameRelayOpen,
  isClaudeCodeRemoteEnv,
  resolveSessionGatewayBaseUrl,
} from './frameRelay.js'
import { DL, setFrameDlDepsForTests } from './frameDl.js'
import { frameControlPlaneHeaders } from './mint.js'
import { un } from './store.js'

/** densable Nee — per-asset upload cap (non-SVG). */
export const ASSET_UPLOAD_MAX_BYTES = 20_971_520
/** densable pMw — SVG upload cap. */
export const ASSET_SVG_UPLOAD_MAX_BYTES = 2_097_152
/** densable hGi */
export const ASSET_SVG_CONTENT_TYPE = 'image/svg+xml'
/** densable mMw — list page size. */
export const ASSET_LIST_LIMIT = 50
/** densable vCm / SMw / vMw (retry-after cap). */
const LIST_DELETE_TIMEOUT_MS = 30_000
const UPLOAD_TIMEOUT_MS = 90_000
const RETRY_AFTER_CAP_MS = 20_000
const RESPONSE_MAX_BYTES = 262_144
const ROSTER_TIMEOUT_MS = 5_000

export type AssetRxlVerb = 'upload' | 'list' | 'delete'

export type AssetRxlFail = {
  kind: 'error'
  code: string
  message: string
  reason: string
}

export type AssetRxlReplied = {
  replied: true
  status: number
  data: unknown
  retryAfter?: string | null
}

export type AssetRxlSilent = {
  replied: false
  failure: AssetRxlFail
}

export type AssetRxlResult = AssetRxlReplied | AssetRxlSilent

export type AssetRxlDeps = {
  fetch?: typeof globalThis.fetch
  oauthBearer?: () => string | null | Promise<string | null>
  claudeAiOrigin?: () => string
  resolveRelayBase?: () => string | undefined
  getRelayAuthHeaders?: () => Record<string, string>
  getRelayAuthToken?: () => string | null
  isRelayOpen?: () => boolean
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

let depsOverride: AssetRxlDeps | null = null

export function setAssetRxlDepsForTests(deps: AssetRxlDeps | null): void {
  depsOverride = deps
  // densable Lwt uses the same gs/DL transport stack — keep test fetch/auth in sync.
  if (deps === null) {
    setFrameDlDepsForTests(null)
    return
  }
  setFrameDlDepsForTests({
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...(deps.oauthBearer !== undefined
      ? { oauthBearer: deps.oauthBearer }
      : {}),
    ...(deps.claudeAiOrigin !== undefined
      ? { claudeAiOrigin: deps.claudeAiOrigin }
      : {}),
    ...(deps.resolveRelayBase !== undefined
      ? { resolveRelayBase: deps.resolveRelayBase }
      : {}),
    ...(deps.getRelayAuthHeaders !== undefined
      ? { getRelayAuthHeaders: deps.getRelayAuthHeaders }
      : {}),
    ...(deps.getRelayAuthToken !== undefined
      ? { getRelayAuthToken: deps.getRelayAuthToken }
      : {}),
    ...(deps.isRelayOpen !== undefined
      ? { isRelayOpen: deps.isRelayOpen }
      : {}),
  })
}

function d(): AssetRxlDeps {
  return depsOverride ?? {}
}

/** densable wMw */
export function assetAgentUploadRoute(slug: string): string {
  return `/api/frame/blob/${encodeURIComponent(slug)}/agent-upload`
}

/** densable EMw */
export function assetAgentListRoute(slug: string): string {
  return `/api/frame/blob/${encodeURIComponent(slug)}/agent-list`
}

/** densable AMw */
export function assetAgentDeleteRoute(slug: string, id: string): string {
  return `/api/frame/blob/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/agent-delete`
}

/** densable yGi */
export function assetUploadByteLimit(contentType: string): number {
  return contentType === ASSET_SVG_CONTENT_TYPE
    ? ASSET_SVG_UPLOAD_MAX_BYTES
    : ASSET_UPLOAD_MAX_BYTES
}

/** densable sle — Retry-After → ms. */
export function parseRetryAfterMs(
  raw: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!raw) return undefined
  const asNum = Number(raw)
  if (Number.isFinite(asNum) && asNum >= 0) return asNum * 1000
  const abs = Date.parse(raw)
  if (Number.isFinite(abs)) {
    const delta = abs - now
    return delta > 0 ? delta : undefined
  }
  return undefined
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
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

function isRelayOpen(): boolean {
  return d().isRelayOpen?.() ?? isArtifactFrameRelayOpen()
}

async function readBodyCapped(
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
  if (buf.length > maxBytes) throw new Error('max_content_length')
  if (buf.length === 0) return undefined
  const ct = (res.headers.get('content-type') ?? '').toLowerCase()
  if (ct.includes('application/json') || ct === '') {
    try {
      return JSON.parse(buf.toString('utf8'))
    } catch {
      return buf.toString('utf8')
    }
  }
  return buf.toString('utf8')
}

type PostOk = {
  ok: true
  status: number
  data: unknown
  headers: Headers
  reason?: undefined
  detail?: undefined
}
type PostErr = {
  ok: false
  reason: string
  detail?: string
  status?: number
  data?: unknown
  headers?: Headers
}

async function postOnce(input: {
  route: string
  body: BodyInit
  contentType: string
  timeoutMs: number
  signal?: AbortSignal
  viaRelay: boolean
}): Promise<PostOk | PostErr> {
  const fetchImpl = d().fetch ?? globalThis.fetch
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  if (input.signal) {
    if (input.signal.aborted) controller.abort()
    else input.signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  try {
    let url: string
    let headers: Record<string, string>
    if (input.viaRelay) {
      const token = d().getRelayAuthToken
        ? d().getRelayAuthToken!()
        : getSessionIngressAuthToken()
      if (!token) {
        return {
          ok: false,
          reason: 'no-auth',
          detail: 'No session access token',
        }
      }
      const base = relayBase()
      if (!base) {
        return { ok: false, reason: 'relay-unavailable' }
      }
      url = `${base.replace(/\/+$/, '')}${artifactRelayFramePath(input.route)}`
      headers = {
        ...(d().getRelayAuthHeaders?.() ?? getSessionIngressAuthHeaders()),
        Accept: 'application/json',
        'Content-Type': input.contentType,
        ...frameControlPlaneHeaders(),
      }
    } else {
      const token = await resolveOauthBearer()
      if (!token) {
        return { ok: false, reason: 'no-auth', detail: 'No claude.ai login' }
      }
      url = `${claudeAiOrigin().replace(/\/+$/, '')}${input.route}`
      headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': input.contentType,
        ...frameControlPlaneHeaders(),
      }
    }
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: input.body,
      signal: controller.signal,
      redirect: 'manual',
    })
    const data = await readBodyCapped(res, RESPONSE_MAX_BYTES)
    return { ok: true, status: res.status, data, headers: res.headers }
  } catch (e) {
    // densable / frameDl: only user cancel aborts; timeout → request_error soft-fail.
    if (input.signal?.aborted) {
      throw e instanceof DOMException && e.name === 'AbortError'
        ? e
        : new DOMException('Aborted', 'AbortError')
    }
    if (e instanceof Error && e.message === 'max_content_length') {
      return { ok: false, reason: 'max_content_length' }
    }
    return { ok: false, reason: 'request_error' }
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
  }
}

/** densable $nt — frame contract version. */
const CONTRACT_VERSION_RE =
  /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,5})$/
/** densable fJr — capability name. */
const CONTRACT_CAP_RE = /^[a-z][a-z0-9]{0,23}$/

/**
 * densable Fuw portable — version + capabilities[]; malformed → null (soft-fail).
 */
export function parseFrameContractLatest(
  data: unknown,
): { version: string; capabilities: string[] } | null {
  if (!data || typeof data !== 'object') return null
  const body = data as { version?: unknown; capabilities?: unknown }
  if (
    typeof body.version !== 'string' ||
    !CONTRACT_VERSION_RE.test(body.version)
  ) {
    return null
  }
  if (!Array.isArray(body.capabilities) || body.capabilities.length > 256) {
    return null
  }
  const capabilities: string[] = []
  for (const c of body.capabilities) {
    if (typeof c !== 'string' || !CONTRACT_CAP_RE.test(c)) return null
    capabilities.push(c)
  }
  return { version: body.version, capabilities }
}

/** densable oO portable — no-auth wrapper. */
export function formatAssetNoAuthMessage(detail?: string): string {
  const d = detail?.trim()
  return d
    ? `Not authenticated — run /login (${d})`
    : 'Not authenticated — run /login'
}

/**
 * densable Lwt portable — GET /api/frame/contract/latest via DL;
 * soft-fail marks on transport/malformed; hard-fail only when Fuw-ok and
 * capabilities omit "assets".
 */
async function ensureAssetsOnRoster(
  signal: AbortSignal | undefined,
  marks: Record<string, boolean>,
  verb: AssetRxlVerb,
): Promise<AssetRxlFail | null> {
  const store = un()
  if (store.assetsOnRoster) return null
  try {
    const res = await DL.get('/api/frame/contract/latest', {
      signal,
      timeoutMs: ROSTER_TIMEOUT_MS,
      headers: frameControlPlaneHeaders(),
      maxContentLength: 16_384,
    })
    if (!res.ok) {
      marks[`roster_${res.reason.replace(/-/g, '_')}`] = true
      return null
    }
    if (!res.fromFrame) {
      marks.roster_relay = true
      return null
    }
    if (res.status < 200 || res.status >= 300) {
      marks[`roster_http_${res.status}`] = true
      return null
    }
    const parsed = parseFrameContractLatest(res.data)
    if (parsed === null) {
      // densable Lwt cause:"malformed" → mark and still POST
      marks.roster_malformed = true
      return null
    }
    if (!parsed.capabilities.includes('assets')) {
      return {
        kind: 'error',
        code: 'unavailable_to_account',
        reason: 'roster_no_assets',
        // densable l(...,"roster_no_assets") — reason stays machine-facing; no detail.
        message: formatAssetFail('unavailable_to_account', undefined, verb),
      }
    }
    store.assetsOnRoster = true
    return null
  } catch (e) {
    // Match postOnce: only user cancel aborts; other AbortError → soft roster mark.
    if (signal?.aborted) {
      throw e instanceof DOMException && e.name === 'AbortError'
        ? e
        : new DOMException('Aborted', 'AbortError')
    }
    marks.roster_transport = true
    return null
  }
}

const KNOWN_ERROR_CODES = new Set([
  'invalid_request',
  'too_large',
  'unsupported_type',
  'quota_or_state',
  'rate_limited',
  'capability_disabled',
  'store_unavailable',
  'upstream_error',
  'credential_rejected',
])

/** densable SCm portable. */
export function classifyAssetHttpError(
  status: number,
  data: unknown,
): { code: string; reason: string; detail?: string } {
  if (data && typeof data === 'object') {
    const err = (data as { error?: unknown }).error
    if (err && typeof err === 'object') {
      const code = (err as { code?: unknown }).code
      const message = (err as { message?: unknown }).message
      if (typeof code === 'string' && KNOWN_ERROR_CODES.has(code)) {
        return {
          code,
          reason: code,
          ...(typeof message === 'string' && message
            ? { detail: message.slice(0, 200) }
            : {}),
        }
      }
      if (typeof code === 'string') {
        return { code: 'upstream_error', reason: 'unknown_code' }
      }
    }
    if (
      (status === 403 || status === 503) &&
      typeof (err as { error?: unknown } | undefined) === 'undefined'
    ) {
      const policy = data as { error?: unknown; reason?: unknown }
      if (
        typeof policy.error === 'string' &&
        typeof policy.reason === 'string'
      ) {
        return {
          code: 'policy_denied',
          reason: 'policy_denied',
          detail: policy.error.slice(0, 200),
        }
      }
    }
  }
  if (status === 403 || status === 503) {
    if (data && typeof data === 'object') {
      const policy = data as { error?: unknown; reason?: unknown }
      if (
        typeof policy.error === 'string' &&
        typeof policy.reason === 'string'
      ) {
        return {
          code: 'policy_denied',
          reason: 'policy_denied',
          detail: policy.error.slice(0, 200),
        }
      }
    }
  }
  if (status === 403) {
    if (typeof data === 'string' && data.trim() === 'not a writer') {
      return { code: 'not_writer', reason: 'not_writer' }
    }
    if (typeof data === 'string' && /^\s*</.test(data)) {
      return { code: 'upstream_error', reason: 'http_403_page' }
    }
    return { code: 'credential_rejected', reason: 'http_403' }
  }
  if (status === 404) {
    if (typeof data === 'string' && data.trim() === 'not found') {
      return { code: 'not_found', reason: 'http_404' }
    }
    return {
      code: 'store_unavailable',
      reason: 'unrouted',
      detail:
        'this asset route is not served on this path yet (an older deployment, or a cloud session whose gateway does not relay it) — nothing changed; retry later',
    }
  }
  if (status === 401) return { code: 'upstream_auth', reason: 'http_401' }
  if (status === 409) return { code: 'quota_or_state', reason: 'http_409' }
  if (status === 413) return { code: 'too_large', reason: 'http_413' }
  if (status === 415) return { code: 'unsupported_type', reason: 'http_415' }
  if (status === 429) return { code: 'rate_limited', reason: 'http_429' }
  if (status === 502 || status === 503 || status === 504) {
    return { code: 'store_unavailable', reason: `http_${status}` }
  }
  return { code: 'upstream_error', reason: `http_${status}` }
}

/** densable TMw portable. */
export function formatAssetFail(
  code: string,
  detail: string | undefined,
  verb: AssetRxlVerb,
): string {
  const n = `asset ${verb} failed (${code})`
  switch (code) {
    case 'invalid_request':
      return `${n}: ${detail ?? 'the server could not accept the request as shaped'}`
    case 'too_large':
      return `${n}: ${detail ?? 'rejected as too large by the server or an intermediary although under the client limit — compress or split it'}`
    case 'unsupported_type':
      return `${n}: ${detail ?? 'only these file types are accepted: png, jpg, jpeg, gif, webp, svg, mp4, webm, pdf, woff2, woff, ttf, otf'}`
    case 'quota_or_state':
      return `${n}: ${detail ?? (verb === 'upload' ? 'the Artifact cannot take uploads right now — it is a live document, unpublished, retired, being deleted, or over its asset storage quota' : 'the Artifact has no asset store right now — it is a live document, unpublished, retired, or being deleted')}`
    case 'rate_limited':
      return `${n}: calling too often — wait${detail ? ` ${detail}` : ''} before retrying, and never loop`
    case 'upstream_auth':
      return `${n}: could not authenticate — the session's credential may need a refresh; try again`
    case 'capability_disabled':
      return `${n}: the Artifact's published version does not declare the assets capability — republish it with assets: {} added to its declared capabilities, then retry`
    case 'store_unavailable':
      return `${n}: ${detail ?? `the asset store is unavailable right now — retry once after a short wait${verb === 'upload' ? ' (an upload that timed out upstream may already be stored; a duplicate costs only quota)' : ''}`}`
    case 'upstream_error':
      return `${n}: unexpected answer from the server${detail ? ` (${detail})` : ''}`
    case 'not_found':
      return `${n}: no such Artifact, or artifact assets are not available to this account or Artifact — the cases are deliberately indistinguishable; check the url with action "list"`
    case 'not_writer':
      return `${n}: this account can open the Artifact but not edit it — only writers can ${verb} assets`
    case 'credential_rejected':
      return `${n}: the server refused this session's credential at the asset door — not an access or existence answer; report this as a client/server integration fault${detail ? ` (${detail})` : ''}`
    case 'policy_denied':
      return `${n}: ${detail ?? "blocked by the organization's artifact policy"}`
    case 'unavailable_to_account':
      // densable TMw — fixed string; no detail override
      return `${n}: artifact assets are not available to this account`
    default:
      return `${n}${detail ? `: ${detail}` : ''}`
  }
}

/** densable nxl */
export function mapAssetHttpToFail(
  replied: AssetRxlReplied,
  verb: AssetRxlVerb,
): AssetRxlFail {
  const { code, reason, detail } = classifyAssetHttpError(
    replied.status,
    replied.data,
  )
  const retryMs = parseRetryAfterMs(replied.retryAfter ?? undefined)
  let extra = detail
  if (code === 'rate_limited') {
    extra =
      retryMs !== undefined
        ? `${Math.max(1, Math.ceil(retryMs / 1000))}s`
        : undefined
  } else if (code === 'upstream_error' && detail === undefined) {
    extra = `HTTP ${replied.status}`
  }
  return {
    kind: 'error',
    code,
    reason,
    message: formatAssetFail(code, extra, verb),
  }
}

function toBodyInit(
  body: Buffer | Uint8Array | string | Record<string, unknown>,
): BodyInit {
  if (typeof body === 'string') return body
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return body as BodyInit
  }
  return JSON.stringify(body)
}

/**
 * densable rxl — POST asset blob routes (upload/list/delete).
 */
export async function assetRxl(
  input: {
    verb: AssetRxlVerb
    route: string
    body: Buffer | Uint8Array | string | Record<string, unknown>
    contentType: string
    timeoutMs?: number
    maxBodyLength?: number
    marks?: Record<string, boolean>
    credentials?: unknown
  },
  signal?: AbortSignal,
): Promise<AssetRxlResult> {
  const marks = input.marks ?? {}
  const fail = (
    code: string,
    reason: string,
    detail?: string,
  ): AssetRxlSilent => ({
    replied: false,
    failure: {
      kind: 'error',
      code,
      reason,
      message: formatAssetFail(code, detail, input.verb),
    },
  })

  const viaRelay = isRelayOpen()
  // densable V.CLAUDE_CODE_REMOTE === true — only 1/true, not any non-empty string.
  if (!viaRelay && isClaudeCodeRemoteEnv()) {
    return fail(
      'store_unavailable',
      'relay_unavailable',
      'asset uploads, listing, and deletes run only from a local session or an Anthropic-hosted cloud session with its gateway relay enabled; retrying from here will not help',
    )
  }

  if (!viaRelay) {
    const rosterFail = await ensureAssetsOnRoster(signal, marks, input.verb)
    if (rosterFail) {
      return { replied: false, failure: rosterFail }
    }
  }

  const timeoutMs =
    input.timeoutMs ??
    (input.verb === 'upload' ? UPLOAD_TIMEOUT_MS : LIST_DELETE_TIMEOUT_MS)
  const body = toBodyInit(input.body)
  if (
    input.maxBodyLength !== undefined &&
    typeof body !== 'string' &&
    'byteLength' in body &&
    body.byteLength > input.maxBodyLength
  ) {
    return fail('too_large', 'size', 'request body exceeds maxBodyLength')
  }

  const sleep = d().sleep ?? defaultSleep
  const run = (): Promise<PostOk | PostErr> =>
    postOnce({
      route: input.route,
      body,
      contentType: input.contentType,
      timeoutMs,
      signal,
      viaRelay,
    })

  let res: PostOk | PostErr
  try {
    res = await run()
    if (
      res.ok &&
      (res.status === 429 || res.status === 503) &&
      classifyAssetHttpError(res.status, res.data).code !== 'policy_denied'
    ) {
      const wait = parseRetryAfterMs(res.headers.get('retry-after'))
      if (wait !== undefined && wait <= RETRY_AFTER_CAP_MS) {
        await sleep(wait, signal)
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        marks.retried = true
        res = await run()
      }
    }
  } catch (e) {
    // Only propagate user cancel; wall-clock timeout already soft-failed in postOnce.
    if (signal?.aborted) {
      throw e instanceof DOMException && e.name === 'AbortError'
        ? e
        : new DOMException('Aborted', 'AbortError')
    }
    return fail(
      'store_unavailable',
      'request_error',
      input.verb === 'upload'
        ? 'the request failed in transit or timed out — a timed-out upload may already be stored; one retry is safe (a duplicate costs only quota)'
        : 'the request failed in transit or timed out — one retry is safe',
    )
  }

  if (!res.ok) {
    // densable gs timeout/transport lands in catch with this detail; tip maps soft.
    if (res.reason === 'request_error') {
      return fail(
        'store_unavailable',
        'request_error',
        input.verb === 'upload'
          ? 'the request failed in transit or timed out — a timed-out upload may already be stored; one retry is safe (a duplicate costs only quota)'
          : 'the request failed in transit or timed out — one retry is safe',
      )
    }
    const base = fail(
      'store_unavailable',
      res.reason.replace(/-/g, '_'),
      undefined,
    )
    if (res.reason === 'no-auth') {
      base.failure.message = formatAssetNoAuthMessage(res.detail)
    } else {
      base.failure.message = `asset ${input.verb} unavailable: ${res.reason}`
    }
    return base
  }

  return {
    replied: true,
    status: res.status,
    data: res.data,
    retryAfter: res.headers.get('retry-after'),
  }
}

export const assetRxlTimeouts = {
  listDeleteMs: LIST_DELETE_TIMEOUT_MS,
  uploadMs: UPLOAD_TIMEOUT_MS,
} as const
